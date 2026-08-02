import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { legacyRows, mediaColumns, sanitizeMedia } from '@/lib/library-media'
import { z } from 'zod'

// z.url() happily accepts `javascript:…`, and these values end up in href/src —
// so every link field is pinned to http(s).
const webUrl = z.string().url().refine(u => /^https?:\/\//i.test(u), 'Must be a http(s) link')

const schema = z.object({
  themeId: z.string().min(1),
  title: z.string().min(1),
  // Rich text (Tiptap HTML). Sanitized on the way out by <RichText />.
  description: z.string().optional().nullable(),
  repetitions: z.number().int().positive().optional().nullable(),
  // Everything attached, in order — cleaned by sanitizeMedia, which is the one
  // place the http(s) rule and the cap live.
  media: z.array(z.unknown()).optional(),
  // The pre-list fields, still accepted and folded into the list. New items are
  // created from a title alone today, so these only matter to an older caller.
  videoUrl: webUrl.optional().nullable().or(z.literal('')),
  imageUrl: webUrl.optional().nullable().or(z.literal('')),
  fileUrl: webUrl.optional().nullable().or(z.literal('')),
  fileName: z.string().max(255).optional().nullable(),
})

export async function POST(req: Request) {
  const guard = await guardPermission('forms.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const trainer = await prisma.trainerProfile.findUnique({ where: { id: session.user.trainerId ?? '' }, select: { id: true } })
  if (!trainer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // Verify the theme belongs to this trainer
  const theme = await prisma.libraryTheme.findFirst({
    where: { id: parsed.data.themeId, type: { trainerId: trainer.id } },
  })
  if (!theme) return NextResponse.json({ error: 'Theme not found' }, { status: 404 })

  const maxOrder = await prisma.libraryTask.aggregate({ where: { themeId: theme.id }, _max: { order: true } })
  const task = await prisma.libraryTask.create({
    data: {
      themeId: theme.id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      repetitions: parsed.data.repetitions ?? null,
      // One write for everything attached; the derived columns come with it.
      ...mediaColumns(
        parsed.data.media !== undefined
          ? sanitizeMedia(parsed.data.media)
          : legacyRows({
              videoUrl: parsed.data.videoUrl || null,
              imageUrl: parsed.data.imageUrl || null,
              fileUrl: parsed.data.fileUrl || null,
              fileName: parsed.data.fileName || null,
            }),
      ),
      order: (maxOrder._max.order ?? -1) + 1,
    },
  })

  return NextResponse.json(task, { status: 201 })
}
