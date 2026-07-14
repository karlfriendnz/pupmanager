import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getTrainerContext, guardPermission } from '@/lib/membership'
import { resolveFieldKeys } from '@/lib/field-packs'

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

  const trainerId = ctx.companyId

  const [existing, profile] = await Promise.all([
    prisma.customField.findMany({ where: { trainerId }, select: { label: true, order: true } }),
    prisma.trainerProfile.findUnique({ where: { id: trainerId }, select: { intakeSectionOrder: true } }),
  ])

  // Don't create a second "Breed" because they ran the wizard twice.
  const taken = new Set(existing.map(f => f.label.trim().toLowerCase()))
  const fresh = picked.filter(({ field }) => !taken.has(field.label.trim().toLowerCase()))

  let order = existing.reduce((max, f) => Math.max(max, f.order), -1) + 1

  // Sections the chosen fields need, appended to whatever's already there.
  const rawOrder = Array.isArray(profile?.intakeSectionOrder) ? profile.intakeSectionOrder : []
  const sections = rawOrder.map(entry =>
    typeof entry === 'string'
      ? { name: entry, description: null as string | null }
      : { name: (entry as { name: string }).name, description: (entry as { description?: string | null }).description ?? null }
  )
  const haveSection = new Set(sections.map(s => s.name))
  for (const { pack } of fresh) {
    if (!haveSection.has(pack.section)) {
      haveSection.add(pack.section)
      sections.push({ name: pack.section, description: null })
    }
  }

  await prisma.$transaction([
    prisma.customField.createMany({
      data: fresh.map(({ pack, field }) => ({
        trainerId,
        label: field.label,
        type: field.type,
        required: false,
        inQuickAdd: false,
        options: field.type === 'DROPDOWN' && field.options?.length ? field.options : undefined,
        order: order++,
        category: pack.section,
        appliesTo: field.appliesTo,
      })),
    }),
    prisma.trainerProfile.update({
      where: { id: trainerId },
      data: { intakeSectionOrder: sections },
    }),
  ])

  return NextResponse.json({
    ok: true,
    created: fresh.length,
    skipped: picked.length - fresh.length,
  })
}
