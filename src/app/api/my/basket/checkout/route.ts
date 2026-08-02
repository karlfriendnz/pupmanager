import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { createPaymentRecord, mintCheckoutSession, type CheckoutLine } from '@/lib/connect-checkout'
import { isConnectConfigured } from '@/lib/connect'
import { enforceRateLimit } from '@/lib/rate-limit'
import { effectivePriceCents, isOnSale, resolveVariantPricing } from '@/lib/product-price'
import { quoteOfferingDiscount, scaleLinesToNet } from '@/lib/discounts/quote'
import { quoteClassLine, type ClassQuote } from '@/lib/basket-quote'
import { checkoutFingerprint, MAX_BASKET_LINES, MAX_PRODUCT_QUANTITY } from '@/lib/basket'
import { MAX_TICKET_QUANTITY } from '@/lib/class-runs'
import { env } from '@/lib/env'

// ONE payment for a whole basket — products and classes together.
//
// Clients kept being thrown at Stripe per item: a harness, back, a lead, back,
// then three Saturdays of the casual class, three separate card charges and
// three receipts for one Sunday-night sit-down. The webhook has always been
// able to fulfil a Payment holding a MIX of item kinds (it switches per item),
// so nothing downstream needed changing — what was missing was a route that
// builds the mixed line set in the first place. This is it.
//
// THREE THINGS THIS ROUTE IS CAREFUL ABOUT
//
// 1. NOTHING IS TRUSTED FROM THE BASKET. The basket lives in the client's own
//    browser, so it sends CHOICES (which product, which variant, which
//    sessions, which dogs) and never amounts. Every price is read off the row
//    again here.
//
// 2. A STALE LINE REFUSES THE WHOLE BASKET. Stock is taken at purchase and
//    class seats are limited, so a basket can go off between adding and paying.
//    We check everything first and, if anything has gone, charge NOTHING and
//    name what went (`unavailable[]`, keyed so the review screen can strike
//    through the exact row). Taking "what's still available" is the tempting
//    option and it is wrong: the client is mid-redirect to Stripe and cannot be
//    asked, and people buy baskets, not lines — someone who added the treats
//    because they were also booking the class should not silently end up
//    holding only the treats. One extra tap beats a refund.
//
// 3. A DOUBLE-TAPPED PAY BUTTON BUYS ONCE. See the fingerprint block below.

const lineSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('PRODUCT'),
    /** Echoed back untouched in `unavailable[]` so the UI can find the row. */
    key: z.string().min(1).max(300),
    productId: z.string().min(1),
    variantId: z.string().min(1).nullable().optional(),
    quantity: z.number().int().min(1).max(MAX_PRODUCT_QUANTITY),
  }),
  z.object({
    kind: z.literal('CLASS'),
    key: z.string().min(1).max(300),
    classRunId: z.string().min(1),
    type: z.enum(['FULL', 'DROP_IN']),
    sessionIds: z.array(z.string().min(1)).max(52).optional(),
    dogIds: z.array(z.string().min(1).nullable()).max(20).optional(),
    ticketTierId: z.string().min(1).nullable().optional(),
    quantity: z.number().int().min(1).max(MAX_TICKET_QUANTITY).optional(),
  }),
])

const schema = z.object({ lines: z.array(lineSchema).min(1).max(MAX_BASKET_LINES) })

/** One line that can't be bought right now, and why, in the client's words. */
interface Unavailable { key: string; reason: string }

export async function POST(req: Request) {
  const active = await getActiveClient()
  if (!active) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  // A trainer previewing a client's app must never trigger a real charge — the
  // same guard the single-item buy and enrol routes carry.
  if (active.isPreview) return NextResponse.json({ error: 'Preview mode — payment disabled' }, { status: 403 })

  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: {
      id: true, trainerId: true, dogId: true,
      dogs: { select: { id: true, deceasedAt: true } },
      dog: { select: { deceasedAt: true } },
    },
  })
  if (!profile) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  // Each attempt writes a PENDING Payment and mints a Stripe session before any
  // money moves, so cap it per acting client exactly as /buy does.
  const limited = await enforceRateLimit({ key: `basket:${profile.id}`, limit: 10, windowMs: 10 * 60_000 })
  if (limited) return limited

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const requested = parsed.data.lines

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: profile.trainerId },
    select: {
      acceptPaymentsEnabled: true, connectChargesEnabled: true, connectAccountId: true,
      payoutCurrency: true, sandboxBilling: true,
    },
  })
  if (!trainer?.acceptPaymentsEnabled || !trainer.connectChargesEnabled || !trainer.connectAccountId) {
    // A basket is a card payment by definition. Without one, the per-item
    // "request"/"book now, pay later" flows are still there and unchanged.
    return NextResponse.json({ error: 'This trainer isn’t taking card payments yet.' }, { status: 409 })
  }
  const sandbox = trainer.sandboxBilling
  if (!isConnectConfigured(sandbox)) {
    return NextResponse.json({ error: 'Payments are not configured yet' }, { status: 503 })
  }

  const unavailable: Unavailable[] = []
  /** Built in basket order, so the Stripe page reads like the review screen. */
  const lines: CheckoutLine[] = []
  let hasClassLine = false

  // ── Products ───────────────────────────────────────────────────────────────
  const productIds = requested.filter(l => l.kind === 'PRODUCT').map(l => l.productId)
  const products = productIds.length
    ? await prisma.product.findMany({
        // Tenant-scoped in the query, not after it: a product id belonging to
        // another business must resolve to nothing at all.
        where: { id: { in: productIds }, trainerId: profile.trainerId, active: true },
        select: {
          id: true, name: true, kind: true, priceCents: true, salePriceCents: true, stockCount: true,
          variants: {
            where: { active: true },
            select: { id: true, name: true, priceCents: true, salePriceCents: true, stockCount: true },
          },
        },
      })
    : []
  const productById = new Map(products.map(p => [p.id, p]))

  // Apple Guideline 3.1.1 — no in-app purchase of digital goods. The app tells
  // us what it is; the web is unaffected.
  const platform = req.headers.get('x-pm-platform')
  const nativeApp = platform === 'ios' || platform === 'android'

  // ── Classes ────────────────────────────────────────────────────────────────
  const ownDogIds = new Set([profile.dogId, ...profile.dogs.map(d => d.id)].filter(Boolean) as string[])
  const deceasedDogIds = new Set(profile.dogs.filter(d => d.deceasedAt).map(d => d.id))
  if (profile.dogId && profile.dog?.deceasedAt) deceasedDogIds.add(profile.dogId)

  for (const line of requested) {
    if (line.kind === 'PRODUCT') {
      const product = productById.get(line.productId)
      if (!product) {
        unavailable.push({ key: line.key, reason: 'This item isn’t in the shop any more.' })
        continue
      }
      const variants = product.variants ?? []
      const variantId = line.variantId ?? null
      const variant = variantId ? variants.find(v => v.id === variantId) ?? null : null
      if (variantId && !variant) {
        unavailable.push({ key: line.key, reason: `That option of ${product.name} isn’t available any more.` })
        continue
      }
      if (variants.length > 0 && !variant) {
        unavailable.push({ key: line.key, reason: `Choose an option for ${product.name}.` })
        continue
      }
      if (product.kind === 'DIGITAL' && nativeApp) {
        unavailable.push({ key: line.key, reason: `${product.name} can only be bought on the web.` })
        continue
      }

      const pricing = resolveVariantPricing(product, variant)
      const unitAmount = effectivePriceCents(pricing)
      if (!unitAmount || unitAmount <= 0) {
        unavailable.push({ key: line.key, reason: `${product.name} isn’t for sale online.` })
        continue
      }

      // Enough on the shelf for the WHOLE line — `inStock` only answers "any
      // left?", which would happily sell three of the last one. Null = an item
      // that can't run out (a service, a download) and is always available.
      const shelf = variant ? variant.stockCount : product.stockCount
      const saleName = variant ? `${product.name} — ${variant.name}` : product.name
      if (shelf !== null && shelf < line.quantity) {
        unavailable.push({
          key: line.key,
          reason: shelf <= 0
            ? `${saleName} sold out.`
            : `Only ${shelf} of ${saleName} left — you asked for ${line.quantity}.`,
        })
        continue
      }

      lines.push({
        kind: 'PRODUCT',
        description: isOnSale(pricing) ? `${saleName} (sale)` : saleName,
        unitAmount,
        quantity: line.quantity,
        productId: product.id,
        // On the line AND in the intent: the line is what the trainer reads back
        // as "who bought which size", the intent is what the webhook fulfils.
        variantId,
        intent: { productId: product.id, variantId, quantity: line.quantity },
      })
      continue
    }

    // ── One class booking ────────────────────────────────────────────────────
    const result = await quoteClassLine({
      trainerId: profile.trainerId,
      clientId: profile.id,
      ownDogIds,
      deceasedDogIds,
      line: {
        classRunId: line.classRunId,
        type: line.type,
        sessionIds: line.sessionIds ?? [],
        dogIds: line.dogIds ?? [],
        ticketTierId: line.ticketTierId ?? null,
        quantity: line.quantity ?? 1,
      },
    })
    if (!result.ok) {
      unavailable.push({ key: line.key, reason: result.reason })
      continue
    }
    hasClassLine = true
    lines.push(...(await applyClassDiscount(profile.trainerId, result.quote)))
  }

  // Nothing is charged unless everything is still there. See (2) at the top.
  if (unavailable.length > 0) {
    return NextResponse.json({
      error: unavailable.length === 1
        ? unavailable[0].reason
        : `${unavailable.length} things in your basket are no longer available.`,
      unavailable,
    }, { status: 409 })
  }
  if (lines.length === 0) return NextResponse.json({ error: 'Your basket is empty.' }, { status: 400 })

  // ── Idempotency ────────────────────────────────────────────────────────────
  // A second tap on Pay must not become a second payment. With the basket in
  // the browser there is no id to key on, so the lines themselves are the key:
  // if an identical PENDING Payment was raised in the last half hour we hand
  // back a fresh Stripe session for THAT one. Re-minting is safe — the new
  // session supersedes the old, both point at the same Payment row, and
  // fulfilment is gated on the row's PENDING→PAID transition, so only one of
  // them can ever result in a charge being fulfilled.
  const fingerprint = checkoutFingerprint(lines)
  const recent = await prisma.payment.findMany({
    where: {
      clientId: profile.id, trainerId: profile.trainerId, status: 'PENDING', sandbox,
      createdAt: { gte: new Date(Date.now() - 30 * 60_000) },
    },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  })
  const reusable = recent.find(p => checkoutFingerprint(p.items) === fingerprint)

  const appUrl = env.NEXT_PUBLIC_APP_URL
  // `basketPaid` is what empties the basket on the way back in — read by the
  // provider, not by a page, so it works whichever screen we land on.
  const successUrl = `${appUrl}${hasClassLine ? '/my-sessions' : '/my-shop'}?basketPaid=1`
  const cancelUrl = `${appUrl}/my-shop?basket=cancelled`

  const paymentId = reusable?.id ?? await createPaymentRecord({
    sandbox,
    trainerId: profile.trainerId,
    connectAccountId: trainer.connectAccountId,
    clientId: profile.id,
    currency: trainer.payoutCurrency ?? 'nzd',
    description: describeBasket(lines),
    lines,
  })

  const url = await mintCheckoutSession(paymentId, { successUrl, cancelUrl })
  if (!url) return NextResponse.json({ error: 'Could not start checkout' }, { status: 502 })
  return NextResponse.json({ url, paymentId, reused: !!reusable }, { status: 201 })
}

/**
 * Take the offering's discounts off ONE class booking's lines.
 *
 * Quoted per basket LINE, not across the basket, and that is deliberate. The
 * rules belong to the OFFERING — "three sessions or more, 10% off", "second dog
 * half price" — and the engine reads a `personTotal` off what it is given. Hand
 * it a basket that also holds a harness and a lead and a threshold rule the
 * trainer wrote about a class starts firing on shopping. Per line, the
 * arguments are byte-for-byte what the single-item enrol route passes, so a
 * multi-session drop-in gets exactly the discount it has always got.
 *
 * The saving is scaled INTO the line amounts (rather than added as a negative
 * line) because the platform fee is computed from the line totals — the same
 * reason the enrol route does it this way.
 */
async function applyClassDiscount(trainerId: string, quote: ClassQuote): Promise<CheckoutLine[]> {
  const { discountTotal } = await quoteOfferingDiscount({
    trainerId,
    packageId: quote.packageId,
    dogCount: quote.dogCount,
    perDogAmounts: quote.perDogAmounts,
    dates: quote.dates,
  })
  if (discountTotal <= 0) return quote.lines
  const scaled = scaleLinesToNet(quote.lines.map(l => l.unitAmount), discountTotal)
  return quote.lines.map((l, i) => ({ ...l, unitAmount: scaled[i] }))
}

/** The one-liner the trainer sees against the payment in their earnings list. */
function describeBasket(lines: CheckoutLine[]): string {
  const first = lines[0]?.description ?? 'Basket'
  return lines.length === 1 ? first : `${first} + ${lines.length - 1} more`
}
