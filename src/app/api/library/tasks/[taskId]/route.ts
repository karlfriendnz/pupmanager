import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { sanitizeVideos } from '@/lib/instructional-videos'
import { legacyRows, mediaColumns, sanitizeMedia } from '@/lib/library-media'
import { z } from 'zod'

// z.url() happily accepts `javascript:…`, and these values end up in href/src —
// so every link field is pinned to http(s).
const webUrl = z.string().url().refine(u => /^https?:\/\//i.test(u), 'Must be a http(s) link')

const schema = z.object({
  title: z.string().min(1),
  // Rich text (Tiptap HTML). Sanitized on the way out by <RichText />.
  description: z.string().optional().nullable(),
  repetitions: z.number().int().positive().optional().nullable(),
  // Does a client log sessions against this, or just read it? Plenty of the
  // library is reference material where reps and a rating are noise.
  wantsLog: z.boolean().optional(),
  // Everything attached, in order. Left loose here and cleaned by
  // sanitizeMedia, which is the one place the http(s) rule and the cap live —
  // a second copy of that rule in a zod schema is a second copy to get wrong.
  media: z.array(z.unknown()).optional(),
  // ── The pre-list fields ────────────────────────────────────────────────────
  // Still accepted, and folded into the list, so a browser holding the old page
  // through a rolling deploy still saves what a trainer typed rather than
  // wiping their attachments. Ignored the moment `media` is present.
  videos: z.array(z.unknown()).optional(),
  videoUrl: webUrl.optional().nullable().or(z.literal('')),
  imageUrl: webUrl.optional().nullable().or(z.literal('')),
  fileUrl: webUrl.optional().nullable().or(z.literal('')),
  fileName: z.string().max(255).optional().nullable(),
})

async function getTask(taskId: string, userId: string) {
  const trainer = await prisma.trainerProfile.findUnique({ where: { userId }, select: { id: true } })
  if (!trainer) return null
  return prisma.libraryTask.findFirst({
    where: { id: taskId, theme: { type: { trainerId: trainer.id } } },
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const guard = await guardPermission('forms.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { taskId } = await params
  const task = await getTask(taskId, session.user.id)
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const updated = await prisma.libraryTask.update({
    where: { id: taskId },
    data: {
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      repetitions: parsed.data.repetitions ?? null,
      ...(parsed.data.wantsLog !== undefined && { wantsLog: parsed.data.wantsLog }),
      // ONE write for everything attached. mediaColumns derives videos,
      // videoUrl, imageUrl, fileUrl and fileName from the list, so the list and
      // the columns that older readers still select can never disagree.
      //
      // A body with no `media` came from the pre-list page, so its separate
      // fields are read as a list in the same order the screen showed them.
      ...mediaColumns(
        parsed.data.media !== undefined
          ? sanitizeMedia(parsed.data.media)
          : legacyRows({
              videos: parsed.data.videos !== undefined ? sanitizeVideos(parsed.data.videos) : [],
              videoUrl: parsed.data.videoUrl || null,
              imageUrl: parsed.data.imageUrl || null,
              fileUrl: parsed.data.fileUrl || null,
              fileName: parsed.data.fileName || null,
            }),
      ),
    },
  })
  return NextResponse.json(updated)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const guard = await guardPermission('forms.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { taskId } = await params
  const task = await getTask(taskId, session.user.id)
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.libraryTask.delete({ where: { id: taskId } })
  return NextResponse.json({ ok: true })
}
