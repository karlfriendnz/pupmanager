import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { placeProductOrder, releaseCancelledRequest } from '@/lib/product-requests'
import { quantitySchema } from '@/lib/product-quantity'
import { notifyTrainer } from '@/lib/trainer-notify'
import { z } from 'zod'

const postSchema = z.object({
  note: z.string().max(500).optional(),
  // Which size/colour. Resolved against the product's own variants below — an
  // id on its own is never trusted.
  variantId: z.string().nullable().optional(),
  // How many. Bounds-checked here, not in the stepper (AGENTS.md #3).
  quantity: quantitySchema,
}).optional()

// Verify the product belongs to the client's trainer (no cross-trainer leakage).
async function verifyProductOwnership(productId: string, trainerId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true, trainerId: true, active: true, name: true, stockCount: true,
      variants: { where: { active: true }, select: { id: true, name: true, stockCount: true } },
    },
  })
  if (!product || product.trainerId !== trainerId || !product.active) return null
  return product
}

// The client we're acting as — either the signed-in client themselves, or
// the previewed client when a trainer is walking through the app via the
// preview cookie. Trainer-in-preview gets full mutation rights so they can
// validate the shop / homework / messaging flows end-to-end.
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
  // isPreview: a trainer previewing the client app must NOT notify themselves.
  return profile ? { ...profile, isPreview: active.isPreview } : null
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const profile = await resolveActingClient()
  if (!profile) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { productId } = await params

  const product = await verifyProductOwnership(productId, profile.trainerId)
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Body is optional — empty body => no note, one of it.
  let note: string | undefined
  let variantId: string | null = null
  let quantity: number | undefined
  try {
    const text = await req.text()
    if (text) {
      const parsed = postSchema.safeParse(JSON.parse(text))
      if (parsed.success) {
        note = parsed.data?.note
        variantId = parsed.data?.variantId ?? null
        quantity = parsed.data?.quantity
      } else {
        // A body that names a quantity the schema refuses (0, -1, 2.5, 500) is
        // a request to be turned down, not one to quietly treat as "one". The
        // old code swallowed every parse failure, which is fine for a note and
        // is not fine for a number that moves stock and money.
        return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
      }
    }
  } catch { /* ignore body parse errors — request still valid */ }

  const variants = product.variants ?? []
  const variant = variantId ? variants.find(v => v.id === variantId) ?? null : null
  if (variantId && !variant) {
    return NextResponse.json({ error: 'That option isn’t available.' }, { status: 404 })
  }
  // A product that HAS variants can't be asked for in the abstract — the
  // trainer would have nothing to put in the bag.
  if (variants.length > 0 && !variant) {
    return NextResponse.json({ error: 'Choose an option first.' }, { status: 400 })
  }

  // The three effects of ordering, in one place. Asking for the same thing
  // again ADDS to the pending order rather than returning it untouched —
  // scoped to the VARIANT, because asking for a Large when a Small is already
  // on order is a second thing wanted, not more of the same. A CANCELLED row is
  // never a match, so a re-order after a cancellation is a new order
  // (AGENTS.md #7).
  const result = await placeProductOrder({
    trainerId: profile.trainerId,
    clientId: profile.id,
    product: {
      id: product.id,
      name: product.name,
      stockCount: product.stockCount,
      variant: variant ? { id: variant.id, name: variant.name, stockCount: variant.stockCount } : null,
    },
    quantity,
    note: note ?? null,
    stockNote: 'Requested in the client app',
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  // Tell the trainer a client requested a product (skip trainer-in-preview so a
  // trainer walking the shop doesn't notify themselves).
  const trainerUserId = profile.assignedTrainer?.user?.id ?? profile.trainer?.user?.id ?? null
  if (trainerUserId && !profile.isPreview) {
    const name = variant ? `${product.name} — ${variant.name}` : product.name
    await notifyTrainer(
      trainerUserId,
      'CLIENT_SHOP_ORDER',
      {
        clientName: profile.user?.name ?? 'A client',
        dogName: profile.dog?.name ?? '',
        // Naming the variant is the point of the alert — "a harness" is not
        // something the trainer can go and pick up. Nor is "a harness" when
        // they wanted three, so the count rides along whenever it isn't one.
        detail: `requested “${name}”${result.added > 1 ? ` × ${result.added}` : ''}`,
      },
      `/clients/${profile.id}`,
      profile.trainerId,
    )
  }

  return NextResponse.json(result.request, { status: result.created ? 201 : 200 })
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const profile = await resolveActingClient()
  if (!profile) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { productId } = await params
  // Cancelling the Large must leave the Small on order, so the variant narrows
  // the delete when one is named. No variantId = every pending row for this
  // product, which is what a product without variants has always done.
  const variantId = new URL(req.url).searchParams.get('variantId')

  // Read the rows first: once they're gone there's nothing left to say which
  // variant to put back, HOW MANY, or which receivable to cancel.
  const pending = await prisma.productRequest.findMany({
    where: { clientId: profile.id, productId, status: 'PENDING', ...(variantId ? { variantId } : {}) },
    select: { id: true, variantId: true, quantity: true },
  })

  // Hard delete the PENDING row. Keeps the (clientId, productId, variant) pair
  // available for fresh re-requests later. FULFILLED rows are preserved.
  await prisma.productRequest.deleteMany({ where: { id: { in: pending.map(r => r.id) } } })

  // Then undo the other two things ordering did — the units off the shelf and
  // the receivable. Cancelling only the request row left the client owing for
  // something they cancelled and the stock count short by one (audit C-3).
  //
  // `row.quantity`, not 1: an order for three puts three back. Cancelling three
  // and returning one is the same class of bug as cancelling one and returning
  // none, two thirds of the way along.
  for (const row of pending) {
    await releaseCancelledRequest({
      trainerId: profile.trainerId,
      clientId: profile.id,
      productId,
      variantId: row.variantId,
      quantity: row.quantity,
    })
  }

  return NextResponse.json({ ok: true })
}
