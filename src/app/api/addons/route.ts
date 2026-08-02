import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getTrainerContext } from '@/lib/membership'
import { can } from '@/lib/permissions'
import { addonById } from '@/lib/pricing'
import { applyAddonChange, PERMANENT_FAILURES } from '@/lib/addon-change'
import { auditRequestMeta } from '@/lib/audit'

// POST /api/addons — enable/disable an add-on for the current trainer's
// business. The business is ALWAYS the caller's own (ctx.companyId); there is
// deliberately no trainer id in the body to forge. An admin acting for a
// customer uses PATCH /api/admin/trainers/[trainerId]/addons, which runs the
// same applyAddonChange.
//
// Everything about HOW the change is made — Stripe line items, the trial path,
// sandbox comps, and what to say when Stripe refuses — lives in
// src/lib/addon-change.ts. What stays here is who is allowed to ask.
//
// itemId is a BillingItem.id == the pricing AddonId ('achievements' | 'shop' |
// 'marketing' | …). Coming-soon previews (e.g. 'ai') are refused.
const schema = z.object({
  itemId: z.string().min(1),
  active: z.boolean(),
})

export async function POST(req: Request) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { itemId, active } = parsed.data

  // The permission depends on what's being toggled, so it's checked AFTER we know
  // which add-on this is. A paid one commits to a recurring charge — that needs the
  // spend permission. A FREE one costs nothing and is just a feature switch on the
  // Configure page, so requiring "add paid team seats" to flip it locked managers
  // out of turning on things the business already owns.
  const def = addonById(itemId)
  if (def && !def.comingSoon) {
    const permission = def.free ? 'settings.edit' : 'billing.seats'
    if (!can(permission, ctx.role, ctx.permissions)) {
      return NextResponse.json({ error: 'You don\'t have permission to change this.' }, { status: 403 })
    }
  }

  const result = await applyAddonChange({
    trainerId: ctx.companyId,
    itemId,
    active,
    // Recorded against the SIGNED-IN user, not the business — "who turned this
    // on" has to name a person, and on a team account the owner is often not who
    // tapped it.
    actor: { kind: 'trainer', userId: ctx.userId, ...auditRequestMeta(req) },
  })

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        // The client needs to tell "this will never work" from "Stripe hiccuped",
        // because only one of those is worth tapping again.
        reason: result.reason,
        permanent: PERMANENT_FAILURES.has(result.reason),
        ...result.body,
      },
      { status: result.status },
    )
  }

  return NextResponse.json(result.body)
}
