import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slotId: string }> }
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { slotId } = await params

  const slot = await prisma.availabilitySlot.findFirst({
    where: { id: slotId, trainerId },
  })
  if (!slot) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.availabilitySlot.delete({ where: { id: slotId } })
  return NextResponse.json({ ok: true })
}
