import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { createInvoiceForAssignment } from '@/lib/invoicing'
import { notifyTrainer } from '@/lib/trainer-notify'
import { z } from 'zod'

const postSchema = z.object({
  note: z.string().max(500).optional(),
}).optional()

// Verify the product belongs to the client's trainer (no cross-trainer leakage).
async function verifyProductOwnership(productId: string, trainerId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, trainerId: true, active: true, name: true },
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
  try {
    const text = await req.text()
    if (text) {
      const parsed = postSchema.safeParse(JSON.parse(text))
      if (parsed.success) note = parsed.data?.note
    }
  } catch { /* ignore body parse errors — request still valid */ }

  // Idempotent: if a PENDING request already exists, return it. Avoids
  // tripping the partial unique index on duplicate taps.
  const existing = await prisma.productRequest.findFirst({
    where: { clientId: profile.id, productId, status: 'PENDING' },
  })
  if (existing) return NextResponse.json(existing)

  const created = await prisma.productRequest.create({
    data: {
      clientId: profile.id,
      productId,
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
  })

  // Tell the trainer a client requested a product (skip trainer-in-preview so a
  // trainer walking the shop doesn't notify themselves).
  const trainerUserId = profile.assignedTrainer?.user?.id ?? profile.trainer?.user?.id ?? null
  if (trainerUserId && !profile.isPreview) {
    await notifyTrainer(
      trainerUserId,
      'CLIENT_SHOP_ORDER',
      { clientName: profile.user?.name ?? 'A client', dogName: profile.dog?.name ?? '', detail: `requested “${product.name}”` },
      `/clients/${profile.id}`,
      profile.trainerId,
    )
  }

  return NextResponse.json(created, { status: 201 })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const profile = await resolveActingClient()
  if (!profile) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { productId } = await params

  // Hard delete the PENDING row. Keeps the (clientId, productId) pair
  // available for fresh re-requests later. FULFILLED rows are preserved.
  await prisma.productRequest.deleteMany({
    where: { clientId: profile.id, productId, status: 'PENDING' },
  })

  return NextResponse.json({ ok: true })
}
