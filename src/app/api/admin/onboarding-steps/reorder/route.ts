import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  ids: z.array(z.string()).min(1),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const { ids } = parsed.data
  await prisma.$transaction(
    ids.map((id, i) => prisma.onboardingStep.update({ where: { id }, data: { order: i } })),
  )
  return NextResponse.json({ ok: true })
}
