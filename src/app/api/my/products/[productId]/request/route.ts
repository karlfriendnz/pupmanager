import { NextResponse } from 'next/server'
import { takeStock } from '@/lib/stock'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { createInvoiceForAssignment } from '@/lib/invoicing'
import { releaseCancelledRequest } from '@/lib/product-requests'
import { notifyTrainer } from '@/lib/trainer-notify'
import { z } from 'zod'

const postSchema = z.object({
  note: z.string().max(500).optional(),
  // Which size/colour. Resolved against the product's own variants below — an
  // id on its own is never trusted.
  variantId: z.string().nullable().optional(),
}).optional()

// Verify the product belongs to the client's trainer (no cross-trainer leakage).
async function verifyProductOwnership(productId: string, trainerId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true, trainerId: true, active: true, name: true,
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

  // Body is optional — empty body => no note.
  let note: string | undefined
  let variantId: string | null = null
  try {
    const text = await req.text()
    if (text) {
      const parsed = postSchema.safeParse(JSON.parse(text))
      if (parsed.success) {
        note = parsed.data?.note
        variantId = parsed.data?.variantId ?? null
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

  // Idempotent: if a PENDING request already exists, return it. Avoids
  // tripping the partial unique index on duplicate taps. Scoped to the VARIANT
  // as well, because asking for a Large when a Small is already on order is a
  // second thing wanted, not a duplicate tap.
  const existing = await prisma.productRequest.findFirst({
    where: { clientId: profile.id, productId, variantId, status: 'PENDING' },
  })
  if (existing) return NextResponse.json(existing)

  if (!(await takeStock(prisma, product.id, { clientId: profile.id, variantId, note: 'Requested in the client app' }))) {
    return NextResponse.json({ error: 'That item is out of stock.' }, { status: 409 })
  }
  const created = await prisma.productRequest.create({
    data: {
      clientId: profile.id,
      productId,
      variantId,
      note: note ?? null,
      status: 'PENDING',
    },
  })

  // Best-effort receivable for the self-requested product (idempotent, skips
  // unpriced). Never blocks the request.
  await createInvoiceForAssignment({
    trainerId: profile.trainerId,
    clientId: profile.id,
    sourceType: 'PRODUCT',
    productId,
    productVariantId: variantId,
  })

  // Tell the trainer a client requested a product (skip trainer-in-preview so a
  // trainer walking the shop doesn't notify themselves).
  const trainerUserId = profile.assignedTrainer?.user?.id ?? profile.trainer?.user?.id ?? null
  if (trainerUserId && !profile.isPreview) {
    await notifyTrainer(
      trainerUserId,
      'CLIENT_SHOP_ORDER',
      {
        clientName: profile.user?.name ?? 'A client',
        dogName: profile.dog?.name ?? '',
        // Naming the variant is the point of the alert — "a harness" is not
        // something the trainer can go and pick up.
        detail: `requested “${variant ? `${product.name} — ${variant.name}` : product.name}”`,
      },
      `/clients/${profile.id}`,
      profile.trainerId,
    )
  }

  return NextResponse.json(created, { status: 201 })
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
  // variant to put back or which receivable to cancel.
  const pending = await prisma.productRequest.findMany({
    where: { clientId: profile.id, productId, status: 'PENDING', ...(variantId ? { variantId } : {}) },
    select: { id: true, variantId: true },
  })

  // Hard delete the PENDING row. Keeps the (clientId, productId, variant) pair
  // available for fresh re-requests later. FULFILLED rows are preserved.
  await prisma.productRequest.deleteMany({ where: { id: { in: pending.map(r => r.id) } } })

  // Then undo the other two things ordering did — the unit off the shelf and
  // the receivable. Cancelling only the request row left the client owing for
  // something they cancelled and the stock count short by one (audit C-3).
  for (const row of pending) {
    await releaseCancelledRequest({
      trainerId: profile.trainerId,
      clientId: profile.id,
      productId,
      variantId: row.variantId,
    })
  }

  return NextResponse.json({ ok: true })
}
