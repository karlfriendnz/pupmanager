import { NextResponse } from 'next/server'
import { getTrainerContext } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { resolveClientFieldConfig } from '@/lib/client-fields'

// The per-company client-field config — built-in field flags (required /
// quickAdd) + custom fields with their required/inQuickAdd flags. Used by the
// quick-add contact modal (client-side) to know which fields to show.
export async function GET() {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const [tp, customFields] = await Promise.all([
    prisma.trainerProfile.findUnique({ where: { id: ctx.companyId }, select: { clientFieldConfig: true } }),
    prisma.customField.findMany({
      where: { trainerId: ctx.companyId },
      orderBy: { order: 'asc' },
      select: { id: true, label: true, type: true, options: true, required: true, inQuickAdd: true, appliesTo: true },
    }),
  ])

  return NextResponse.json({
    config: resolveClientFieldConfig(tp?.clientFieldConfig),
    customFields: customFields.map(f => ({
      id: f.id, label: f.label, type: f.type,
      options: Array.isArray(f.options) ? f.options : [],
      required: f.required, inQuickAdd: f.inQuickAdd, appliesTo: f.appliesTo,
    })),
  })
}
