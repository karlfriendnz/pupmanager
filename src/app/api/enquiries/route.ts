import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// List enquiries for the signed-in trainer. Filters by status if ?status= is
// passed (NEW | ACCEPTED | DECLINED | ARCHIVED), otherwise returns everything
// most-recent-first so the trainer can scan their pipeline.
export async function GET(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const validStatus = status && ['NEW', 'ACCEPTED', 'DECLINED', 'ARCHIVED'].includes(status) ? status : undefined

  const enquiries = await prisma.enquiry.findMany({
    where: {
      trainerId,
      ...(validStatus ? { status: validStatus as 'NEW' | 'ACCEPTED' | 'DECLINED' | 'ARCHIVED' } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, name: true, email: true, phone: true,
      dogName: true, dogBreed: true, message: true,
      status: true, viewedAt: true, createdAt: true,
      clientProfileId: true,
      form: { select: { id: true, title: true } },
    },
  })

  return NextResponse.json(enquiries)
}
