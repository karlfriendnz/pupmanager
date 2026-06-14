import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  title: z.string().min(1).max(300).optional(),
  body: z.string().min(1).optional(),
  ctaLabel: z.string().min(1).max(200).optional(),
  ctaHref: z.string().min(1).max(500).optional(),
  skippable: z.boolean().optional(),
  skipWarning: z.string().max(2000).nullable().optional(),
  published: z.boolean().optional(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const { title, body, ctaLabel, ctaHref, skippable, skipWarning, published } = parsed.data
  const step = await prisma.onboardingStep.update({
    where: { id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(body !== undefined ? { body } : {}),
      ...(ctaLabel !== undefined ? { ctaLabel } : {}),
      ...(ctaHref !== undefined ? { ctaHref } : {}),
      ...(skippable !== undefined ? { skippable } : {}),
      ...(skipWarning !== undefined ? { skipWarning: skipWarning === '' ? null : skipWarning } : {}),
      ...(published !== undefined ? { publishedAt: published ? new Date() : null } : {}),
    },
  })
  return NextResponse.json(step)
}
