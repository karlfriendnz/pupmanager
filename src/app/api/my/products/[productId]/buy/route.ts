import { NextResponse } from 'next/server'
import { effectivePriceCents, isOnSale, resolveVariantPricing } from '@/lib/product-price'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { createConnectCheckout } from '@/lib/connect-checkout'
import { isConnectConfigured } from '@/lib/connect'
import { placeProductOrder } from '@/lib/product-requests'
import { enoughStock, MAX_PRODUCT_QUANTITY, normaliseQuantity, shortStockMessage } from '@/lib/product-quantity'
import { resolveRequirePayment } from '@/lib/require-payment'
import { enforceRateLimit } from '@/lib/rate-limit'
import { notifyTrainer } from '@/lib/trainer-notify'
import { env } from '@/lib/env'

// Buy a shop product (Flow B, Phase 2). The sibling /request route stays for
// unpriced products / trainers who haven't switched payments on. On success the
// connect webhook marks the Payment paid and creates a FULFILLED ProductRequest.

async function resolveActingClient() {
  const active = await getActiveClient()
  if (!active) return null
  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: {
      id: true, trainerId: true,
      // Names + trainer routing for the "shop order" notification.
      user: { select: { name: true } },
      dog: { select: { name: true } },
      trainer: { select: { user: { select: { id: true } } } },
      assignedTrainer: { select: { user: { select: { id: true } } } },
    },
  })
  return profile ? { ...profile, isPreview: active.isPreview } : null
}

export async function POST(req: Request, { params }: { params: Promise<{ productId: string }> }) {
  const profile = await resolveActingClient()
  if (!profile) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  // A trainer previewing the client app must never trigger a real charge.
  if (profile.isPreview) return NextResponse.json({ error: 'Preview mode — payment disabled' }, { status: 403 })

  // Cap abuse: each Buy creates a PENDING Payment + Stripe session before any
  // money moves, so rate-limit per acting client.
  const limited = await enforceRateLimit({ key: `buy:${profile.id}`, limit: 10, windowMs: 10 * 60_000 })
  if (limited) return limited

  const { productId } = await params

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true, trainerId: true, active: true, name: true, kind: true,
      priceCents: true, salePriceCents: true, requirePayment: true, stockCount: true,
      // Which sizes/colours exist at all. Read here so a product WITH variants
      // can never be bought without naming one — the alternative is a paid
      // order nobody can fulfil.
      variants: {
        where: { active: true },
        select: { id: true, name: true, priceCents: true, salePriceCents: true, stockCount: true },
      },
    },
  })
  if (!product || product.trainerId !== profile.trainerId || !product.active) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Which one they picked, and how many. Read from the body, then resolved
  // against the product's OWN variants — never trusted as an id on its own.
  let variantId: string | null = null
  let quantity = 1
  try {
    const text = await req.text()
    if (text) {
      const body = JSON.parse(text) as { variantId?: unknown; quantity?: unknown }
      if (typeof body?.variantId === 'string' && body.variantId) variantId = body.variantId
      if (body?.quantity !== undefined) {
        // Refused, not rounded. A quantity of 0, -1, 2.5 or 500 is a request to
        // turn down — this is the money path, and guessing what someone meant
        // is how a charge ends up for a number nobody chose (AGENTS.md #3).
        const q = body.quantity
        if (typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > MAX_PRODUCT_QUANTITY) {
          return NextResponse.json({ error: 'Invalid quantity' }, { status: 400 })
        }
        quantity = normaliseQuantity(q)
      }
    }
  } catch { /* no body — a product with no variants doesn't need one */ }

  const variants = product.variants ?? []
  const variant = variantId ? variants.find(v => v.id === variantId) ?? null : null
  if (variantId && !variant) {
    return NextResponse.json({ error: 'That option isn’t available.' }, { status: 404 })
  }
  if (variants.length > 0 && !variant) {
    return NextResponse.json({ error: 'Choose an option first.' }, { status: 400 })
  }

  // The sale price, when there is one, is what the client is charged — the
  // VARIANT's when they picked one, inheriting the product's where it has none.
  // Resolved server-side from the rows, never taken from the request.
  const pricing = resolveVariantPricing(product, variant)
  const chargeCents = effectivePriceCents(pricing)
  if (!chargeCents || chargeCents <= 0) {
    return NextResponse.json({ error: 'This item isn’t for sale online.' }, { status: 400 })
  }

  /** What the client sees on the Stripe page, the invoice and the trainer's alert. */
  const saleName = variant ? `${product.name} — ${variant.name}` : product.name

  // Nothing is sold that can't be handed over. Checked here, BEFORE any money
  // moves; the actual decrement happens once the payment settles (or, on the
  // pay-later branch below, when the request is created). With variants the
  // count that matters is the picked one's — the product's is ignored.
  //
  // Enough for the WHOLE order, not just "any at all": charging for three and
  // having two is a refund conversation, and it is avoidable right here. Same
  // rule and same wording as the basket checkout.
  const shelf = variant ? variant.stockCount : product.stockCount
  if (!enoughStock(shelf, quantity)) {
    return NextResponse.json({ error: shortStockMessage(saleName, shelf, quantity) }, { status: 409 })
  }

  // Apple: no in-app purchase of digital goods. We hide the button in the
  // native app; this is the server-side backstop — the app reports itself via
  // x-pm-platform, and a digital buy from iOS/Android is refused.
  const platform = req.headers.get('x-pm-platform')
  if (product.kind === 'DIGITAL' && (platform === 'ios' || platform === 'android')) {
    return NextResponse.json({ error: 'Digital items can only be bought on the web.' }, { status: 403 })
  }

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: profile.trainerId },
    select: {
      acceptPaymentsEnabled: true,
      connectChargesEnabled: true,
      connectAccountId: true,
      payoutCurrency: true,
      sandboxBilling: true,
      defaultRequirePayment: true,
    },
  })
  if (!trainer?.acceptPaymentsEnabled || !trainer.connectChargesEnabled || !trainer.connectAccountId) {
    // Payments off — unchanged: the client uses the /request (pay-later) route.
    return NextResponse.json({ error: 'This trainer isn’t taking payments yet.' }, { status: 409 })
  }

  // Payments ON but this product resolves to "don't require payment" — book now,
  // pay later: create (or grow) a PENDING request and raise a receivable
  // instead of charging a card. Mirrors the /request route, through the same
  // helper, so the two cannot answer "how many did that order take off the
  // shelf" differently.
  if (!resolveRequirePayment(product.requirePayment, trainer.defaultRequirePayment)) {
    const result = await placeProductOrder({
      trainerId: profile.trainerId,
      clientId: profile.id,
      // Per VARIANT, not per product: a Small already on order must not swallow
      // an order for a Large.
      product: {
        id: product.id,
        name: product.name,
        stockCount: product.stockCount,
        variant: variant ? { id: variant.id, name: variant.name, stockCount: variant.stockCount } : null,
      },
      quantity,
      stockNote: 'Bought in the client app, pay later',
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    // Tell the trainer their client bought this item (book-now-pay-later path).
    // The card-checkout path below finishes in the connect webhook, so it isn't
    // notified here — that completion lives outside this route.
    const trainerUserId = profile.assignedTrainer?.user?.id ?? profile.trainer?.user?.id ?? null
    if (trainerUserId) {
      await notifyTrainer(
        trainerUserId,
        'CLIENT_SHOP_ORDER',
        { clientName: profile.user?.name ?? 'A client', dogName: profile.dog?.name ?? '', detail: `bought “${saleName}”` },
        `/clients/${profile.id}`,
        profile.trainerId,
      )
    }
    return NextResponse.json({ ok: true, mode: 'requested' })
  }

  const sandbox = trainer.sandboxBilling
  if (!isConnectConfigured(sandbox)) {
    return NextResponse.json({ error: 'Payments are not configured yet' }, { status: 503 })
  }

  const currency = trainer.payoutCurrency ?? 'nzd'
  const shop = `${env.NEXT_PUBLIC_APP_URL}/my-shop`

  const { url } = await createConnectCheckout({
    sandbox,
    trainerId: profile.trainerId,
    connectAccountId: trainer.connectAccountId,
    clientId: profile.id,
    currency,
    description: saleName,
    lines: [
      {
        kind: 'PRODUCT',
        description: isOnSale(pricing) ? `${saleName} (sale)` : saleName,
        unitAmount: chargeCents,
        quantity,
        productId: product.id,
        // Carried on the line AND in the intent: the line is what the trainer
        // reads back as "who bought which size", the intent is what the
        // webhook fulfils from. The webhook already loops the line's quantity
        // (the basket buys three of a thing in one payment), so a straight Buy
        // of three lands on exactly the same path.
        variantId,
        intent: { productId: product.id, variantId, quantity },
      },
    ],
    successUrl: `${shop}?purchase=success`,
    cancelUrl: `${shop}?purchase=cancelled`,
  })

  if (!url) return NextResponse.json({ error: 'Could not start checkout' }, { status: 502 })
  return NextResponse.json({ url })
}
