import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { addonById } from '@/lib/pricing'

// Admin comp grants: turn an add-on on for a trainer at no cost, optionally
// with an expiry date. The trainer is never billed (this never touches Stripe)
// and the grant is protected from the webhook reconciliation sweep. Past the
// expiry the add-on silently gates off (enforced in getEnabledAddons/hasAddon).
const schema = z.object({
  itemId: z.string().min(1),
  active: z.boolean(),
  // ISO datetime the comp lapses, or null for an open-ended grant.
  expiresAt: z.union([z.string().datetime(), z.null()]).optional(),
})

async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') return null
  return session
}

// Self-heal the FK: TrainerAddon.itemId → BillingItem.id. A comp grant of an
// add-on that's never been sold has no BillingItem row yet, so create one
// (mirrors /api/addons ensureBillingItem). Priced from the catalog; a $0/free
// add-on just carries priceMonthly 0.
async function ensureBillingItem(id: string) {
  const def = addonById(id)!
  await prisma.billingItem.upsert({
    where: { id },
    update: {},
    create: {
      id,
      kind: 'ADDON',
      name: def.name,
      description: def.description,
      priceMonthly: def.price.NZD,
    },
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ trainerId: string }> }) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { trainerId: userId } = await params
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const { itemId, active, expiresAt } = parsed.data

  const def = addonById(itemId)
  if (!def) return NextResponse.json({ error: 'Unknown add-on' }, { status: 400 })
  if (def.comingSoon) return NextResponse.json({ error: 'That add-on isn’t available yet' }, { status: 400 })

  // params.trainerId is the account owner's User id; TrainerAddon keys off the
  // TrainerProfile id.
  const profile = await prisma.trainerProfile.findUnique({
    where: { userId },
    select: { id: true },
  })
  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const existing = await prisma.trainerAddon.findUnique({
    where: { trainerId_itemId: { trainerId: profile.id, itemId } },
    select: { stripeSubscriptionItemId: true, grantedByAdmin: true, expiresAt: true },
  })
  // Don't stomp a real paid subscription line — a comp would flag it free and
  // break its Stripe billing sync.
  if (existing?.stripeSubscriptionItemId) {
    return NextResponse.json(
      { error: 'This trainer already has that add-on through a paid subscription.' },
      { status: 409 },
    )
  }

  await ensureBillingItem(itemId)

  const expiry = expiresAt ? new Date(expiresAt) : null
  // Re-arm the "ends soon" reminder whenever the expiry moves (extend/shorten/
  // clear) so the trainer is warned about the new date.
  const expiryChanged = (existing?.expiresAt?.getTime() ?? null) !== (expiry?.getTime() ?? null)
  await prisma.trainerAddon.upsert({
    where: { trainerId_itemId: { trainerId: profile.id, itemId } },
    create: { trainerId: profile.id, itemId, active, grantedByAdmin: true, expiresAt: expiry },
    // Keep grantedByAdmin true so the webhook never sweeps it; expiry updates
    // freely (extend / shorten / clear).
    update: { active, grantedByAdmin: true, expiresAt: expiry, ...(expiryChanged && { expiryReminderSentAt: null }) },
  })

  return NextResponse.json({ ok: true })
}
