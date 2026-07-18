import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') return null
  return session
}

const linkSchema = z
  .string()
  .trim()
  .refine((v) => v === '' || v.startsWith('/'), 'Link must be an app path starting with "/"')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional()

const updateSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  body: z.string().trim().min(1).max(2000).optional(),
  link: linkSchema,
  audience: z.enum(['ALL_TRAINERS', 'ALL_CLIENTS', 'EVERYONE']).optional(),
})

// Edit a DRAFT announcement. A SENT announcement is history — its wording has
// already reached trainers' bells, so it can't be changed.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { id } = await params

  const parsed = updateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const existing = await prisma.announcement.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status === 'SENT') {
    return NextResponse.json({ error: 'This announcement has already been sent and can’t be edited.' }, { status: 409 })
  }

  const updated = await prisma.announcement.update({
    where: { id },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.body !== undefined ? { body: parsed.data.body } : {}),
      ...(parsed.data.link !== undefined ? { link: parsed.data.link ?? null } : {}),
      ...(parsed.data.audience !== undefined ? { audience: parsed.data.audience } : {}),
    },
  })
  return NextResponse.json({ ok: true, announcement: updated })
}

// Delete a DRAFT. Sent announcements are kept as history.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { id } = await params

  const existing = await prisma.announcement.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status === 'SENT') {
    return NextResponse.json({ error: 'Sent announcements are kept as history.' }, { status: 409 })
  }

  await prisma.announcement.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
