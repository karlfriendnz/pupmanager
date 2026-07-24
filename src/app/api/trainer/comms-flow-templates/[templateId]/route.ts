import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'

// Delete a trainer-owned comms-flow template.
export async function DELETE(_req: Request, { params }: { params: Promise<{ templateId: string }> }) {
  const ctx = await guardPermission('classes.manage')
  if (ctx instanceof NextResponse) return ctx
  const { templateId } = await params

  const owned = await prisma.commsFlowTemplate.findFirst({
    where: { id: templateId, trainerId: ctx.companyId },
    select: { id: true },
  })
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.commsFlowTemplate.delete({ where: { id: templateId } })
  return NextResponse.json({ ok: true })
}
