import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// PATCH /api/admin/billing-items/[itemId]
//
// Admin-only toggle for a BillingItem's availability (seat + add-ons).
// Prices themselves are code-governed (src/lib/pricing.ts) to stay in
// sync with the marketing site, so this endpoint only flips isActive —
// e.g. to hide an add-on from /billing/setup without un-wiring Stripe.
const schema = z.object({ isActive: z.boolean() })

export async function PATCH(req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { itemId } = await params
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const item = await prisma.billingItem.update({
    where: { id: itemId },
    data: { isActive: parsed.data.isActive },
    select: { id: true, isActive: true },
  })
  return NextResponse.json(item)
}
