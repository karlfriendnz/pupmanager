import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const enquiry = await prisma.enquiry.findFirst({
    where: { id, trainerId },
    select: { id: true, status: true },
  })
  if (!enquiry) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (enquiry.status !== 'NEW') return NextResponse.json({ error: `Enquiry is already ${enquiry.status.toLowerCase()}` }, { status: 400 })

  await prisma.enquiry.update({
    where: { id },
    data: { status: 'DECLINED', viewedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
