import { NextResponse } from 'next/server'
import { getTrainerContext } from '@/lib/membership'
import { prisma } from '@/lib/prisma'

// The custom fields the quick-add contact modal may show.
//
// It used to also serve a per-company config for the BUILT-IN details — which were
// required, which appeared on quick-add. That's gone: quick-add asks for the same
// three every time (QUICK_ADD_KEYS), and requiredness belongs to a form's own
// questions rather than to a global setting.
export async function GET() {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const customFields = await prisma.customField.findMany({
    where: { trainerId: ctx.companyId },
    orderBy: { order: 'asc' },
    select: { id: true, label: true, type: true, options: true, required: true, inQuickAdd: true, appliesTo: true },
  })

  return NextResponse.json({
    customFields: customFields.map(f => ({
      id: f.id, label: f.label, type: f.type,
      options: Array.isArray(f.options) ? f.options : [],
      required: f.required, inQuickAdd: f.inQuickAdd, appliesTo: f.appliesTo,
    })),
  })
}
