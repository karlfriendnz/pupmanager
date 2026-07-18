import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// Super-admin authoring of platform "what's new" announcements. Drafts live in
// the Announcement table; POST .../[id]/send fans them out to trainers' bells.
async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') return null
  return session
}

// A link, when present, is an internal deep link the bell card routes to — must
// be an app path (leading slash), never an external URL.
const linkSchema = z
  .string()
  .trim()
  .refine((v) => v === '' || v.startsWith('/'), 'Link must be an app path starting with "/"')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional()

const createSchema = z.object({
  title: z.string().trim().min(3, 'Give it a short title').max(120),
  body: z.string().trim().min(1, 'Write a message').max(2000),
  link: linkSchema,
  // Who the broadcast reaches. Defaults to trainers to match prior behaviour.
  audience: z.enum(['ALL_TRAINERS', 'ALL_CLIENTS', 'EVERYONE']).optional(),
})

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const announcements = await prisma.announcement.findMany({ orderBy: { createdAt: 'desc' } })
  return NextResponse.json({ announcements })
}

export async function POST(req: Request) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  const created = await prisma.announcement.create({
    data: {
      title: parsed.data.title,
      body: parsed.data.body,
      link: parsed.data.link ?? null,
      ...(parsed.data.audience ? { audience: parsed.data.audience } : {}),
      createdById: session.user.id,
    },
  })
  return NextResponse.json({ ok: true, announcement: created }, { status: 201 })
}
