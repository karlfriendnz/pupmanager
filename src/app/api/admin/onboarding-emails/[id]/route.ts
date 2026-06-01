import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  subject: z.string().min(1).max(300).optional(),
  body: z.string().min(1).optional(),
  topText: z.string().max(2000).nullable().optional(),
  senderKey: z.enum(['karl', 'brooke']).optional(),
  published: z.boolean().optional(),
  imageUrl: z.string().url().nullable().optional().or(z.literal('')),
  imageHeight: z.number().int().min(40).max(2000).nullable().optional(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const { subject, body, topText, senderKey, published, imageUrl, imageHeight } = parsed.data
  const email = await prisma.onboardingEmail.update({
    where: { id },
    data: {
      ...(subject !== undefined ? { subject } : {}),
      ...(body !== undefined ? { body } : {}),
      ...(topText !== undefined ? { topText: topText === '' ? null : topText } : {}),
      ...(senderKey !== undefined ? { senderKey } : {}),
      ...(published !== undefined ? { publishedAt: published ? new Date() : null } : {}),
      ...(imageUrl !== undefined ? { imageUrl: imageUrl === '' ? null : imageUrl } : {}),
      ...(imageHeight !== undefined ? { imageHeight } : {}),
    },
  })
  return NextResponse.json(email)
}
