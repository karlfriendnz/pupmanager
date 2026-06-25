import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { can } from '@/lib/permissions'
import { loadBillingConfig } from '@/lib/billing'

// POST /api/addons — enable/disable an add-on for the current trainer's
// business by upserting its TrainerAddon row (the active set drives feature
// gating; the Stripe webhook reconciles billing against the live subscription).
//
// itemId is a BillingItem.id where kind = ADDON. Those ids are the same short
// AddonId strings used in pricing.ts ('achievements' | 'shop' | 'ai'), so the
// page can pass the add-on id straight through. We still validate the id
// against the live BillingConfig so a trainer can't switch on an item that
// isn't actually a sellable add-on.
const schema = z.object({
  itemId: z.string().min(1),
  active: z.boolean(),
})

export async function POST(req: Request) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  // Gate on the same permission used by the rest of billing.
  if (!can('billing.view', ctx.role, ctx.permissions)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { itemId, active } = parsed.data

  // Only allow toggling items that are real, active add-ons right now.
  const { addons } = await loadBillingConfig()
  if (!addons.some((a) => a.id === itemId)) {
    return NextResponse.json({ error: 'Unknown add-on' }, { status: 404 })
  }

  await prisma.trainerAddon.upsert({
    where: { trainerId_itemId: { trainerId: ctx.companyId, itemId } },
    create: { trainerId: ctx.companyId, itemId, active },
    update: { active },
  })

  return NextResponse.json({ ok: true, itemId, active })
}
