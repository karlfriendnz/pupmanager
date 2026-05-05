import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Detail view for a single enquiry. Marks viewedAt the first time the trainer
// opens it so the dashboard "new enquiries" badge clears without requiring an
// explicit action.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const enquiry = await prisma.enquiry.findFirst({
    where: { id, trainerId },
    include: {
      form: { select: { id: true, title: true, customFieldIds: true } },
      messages: { orderBy: { createdAt: 'asc' } },
      clientProfile: { select: { id: true } },
    },
  })
  if (!enquiry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!enquiry.viewedAt) {
    await prisma.enquiry.update({ where: { id }, data: { viewedAt: new Date() } })
  }

  // Resolve labels for snapshotted custom-field values so the trainer doesn't
  // see opaque IDs in the detail view.
  const customSnap = (enquiry.customFieldValues ?? {}) as Record<string, string>
  const fieldIds = Object.keys(customSnap)
  const fields = fieldIds.length
    ? await prisma.customField.findMany({
        where: { id: { in: fieldIds } },
        select: { id: true, label: true, type: true },
      })
    : []

  return NextResponse.json({ ...enquiry, customFields: fields })
}
