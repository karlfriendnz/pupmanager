import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(_req: Request, { params }: { params: Promise<{ formId: string }> }) {
  const { formId } = await params

  const form = await prisma.embedForm.findFirst({
    where: { id: formId, isActive: true },
    include: {
      trainer: {
        select: { businessName: true, logoUrl: true },
      },
    },
  })
  if (!form) return NextResponse.json({ error: 'Form not found' }, { status: 404 })

  // Fetch custom fields for this form
  const customFieldIds = Array.isArray(form.customFieldIds) ? form.customFieldIds as string[] : []
  const customFields = customFieldIds.length > 0
    ? await prisma.customField.findMany({
        where: { id: { in: customFieldIds } },
        orderBy: { order: 'asc' },
      })
    : []

  return NextResponse.json({ form, customFields })
}
