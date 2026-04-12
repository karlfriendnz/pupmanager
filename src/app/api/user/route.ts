import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const patchSchema = z.object({
  name: z.string().min(2).optional(),
  timezone: z.string().optional(),
  notifyEmail: z.boolean().optional(),
  notifyPush: z.boolean().optional(),
})

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: parsed.data,
  })

  return NextResponse.json(user)
}
