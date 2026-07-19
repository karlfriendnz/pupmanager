import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getTrainerContext, guardPermission } from '@/lib/membership'
import { resolveFieldKeys } from '@/lib/field-packs'
import { applyFieldPackKeys } from '@/lib/onboarding/apply-field-packs'

// POST /api/custom-fields/packs — create a batch of starter fields from the
// field packs the trainer ticked, and add each pack's section to the intake
// form's section order. This is what turns an empty field list into a working
// intake form in one step.
//
// Selections arrive as `packId:fieldKey` strings and are resolved against the
// server-side catalog — a client can't invent a field definition here.
const schema = z.object({
  keys: z.array(z.string().min(1)).min(1).max(200),
})

export async function POST(req: Request) {
  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const picked = resolveFieldKeys(parsed.data.keys)
  if (picked.length === 0) return NextResponse.json({ error: 'No known fields selected' }, { status: 400 })

  // Idempotent create + intake-section wiring lives in the shared helper (also
  // used to auto-seed persona fields at onboarding).
  const created = await applyFieldPackKeys(prisma, ctx.companyId, parsed.data.keys)

  return NextResponse.json({
    ok: true,
    created,
    skipped: picked.length - created,
  })
}
