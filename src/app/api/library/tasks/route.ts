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
  // Where it goes. A theme is optional grouping now, so an item can be created
  // straight into a category — one of these two is required and `.refine()`
  // below is what enforces it (zod can't say "at least one of" in the shape).
  // themeId wins when both arrive: it is the more specific place, and it
  // carries the category with it.
  themeId: z.string().min(1).optional(),
  typeId: z.string().min(1).optional(),
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
}).refine(v => Boolean(v.themeId || v.typeId), {
  message: 'A theme or a category is required',
  path: ['typeId'],
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

  // Resolve WHERE this goes, and check the trainer owns it. The category is
  // always resolved — an item stores it directly (LibraryTask.typeId), because
  // an item with no theme has nothing to walk up through and every ownership
  // filter in the app is `type.trainerId`.
  let themeId: string | null = null
  let typeId: string
  if (parsed.data.themeId) {
    const theme = await prisma.libraryTheme.findFirst({
      where: { id: parsed.data.themeId, type: { trainerId: trainer.id } },
      select: { id: true, typeId: true },
    })
    if (!theme) return NextResponse.json({ error: 'Theme not found' }, { status: 404 })
    themeId = theme.id
    typeId = theme.typeId
  } else {
    const type = await prisma.libraryType.findFirst({
      where: { id: parsed.data.typeId!, trainerId: trainer.id },
      select: { id: true },
    })
    if (!type) return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    typeId = type.id
  }

  // Order is per LIST, and the loose items are their own list on the category
  // page — so a new loose item goes after the last loose one, not after the
  // last item in some theme.
  const maxOrder = await prisma.libraryTask.aggregate({
    where: themeId ? { themeId } : { typeId, themeId: null },
    _max: { order: true },
  })
  const task = await prisma.libraryTask.create({
    data: {
      typeId,
      themeId,
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
