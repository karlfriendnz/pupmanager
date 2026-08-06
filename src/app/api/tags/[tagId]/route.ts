import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { guardAnyPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { sanitizeImageUrl, IMAGE_URL_MAX } from '@/lib/image-url'
import { TAG_NAME_MAX, normalizeTagName, tagNameKey } from '@/lib/tags'

export const runtime = 'nodejs'

/**
 * ABSENT AND NULL ARE DIFFERENT THINGS HERE, and that is the whole point.
 *
 *   • `imageUrl` not in the body → leave the stored picture exactly as it is.
 *   • `imageUrl: null`           → clear it, and the tag goes back to borrowing
 *                                  one off the first thing inside it.
 *
 * Twice in this codebase a cover image has been silently wiped by a save that
 * simply didn't mention it (AGENTS.md, "a field the user typed must survive a
 * reload"). The rename control on Settings → Tags still sends `{ name }` alone,
 * so `.optional()` — not `.nullable()` alone — is what keeps the picture on the
 * tag. Both directions are tested in tests/unit/tag-image.test.ts.
 *
 * `name` is optional for the same reason in reverse: setting a picture must not
 * force the caller to re-send a name it may not have.
 */
const patchSchema = z.object({
  name: z.string().trim().min(1).max(TAG_NAME_MAX).optional(),
  imageUrl: z.string().max(IMAGE_URL_MAX).nullable().optional(),
})

/** Tenant-scoped: another business's id resolves to nothing and 404s. */
async function owned(trainerId: string, id: string) {
  return prisma.tag.findFirst({ where: { id, trainerId }, select: { id: true } })
}

/**
 * The client's booking screen draws these rows server-side, so a picture set
 * here is invisible until that render is thrown away. Never allowed to fail the
 * request — the tag has already saved, and a throw would report a successful
 * save as failed. (Same pattern as api/dogs/[dogId]/photo.)
 */
function revalidateTagScreens() {
  try {
    for (const path of ['/my-availability', '/offerings/tags']) revalidatePath(path)
  } catch (err) {
    console.error('Tag revalidation failed (the tag itself saved):', err)
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ tagId: string }> }) {
  const guard = await guardAnyPermission('packages.manage', 'products.manage')
  if (guard instanceof NextResponse) return guard
  const { tagId } = await params
  // The ownership guard: another business's tag id resolves to nothing here, so
  // a trainer cannot put a picture (or a name) on someone else's tag.
  if (!(await owned(guard.companyId, tagId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Name the tag' }, { status: 400 })
  const body = parsed.data
  const sendsName = body.name !== undefined
  const sendsImage = 'imageUrl' in body
  if (!sendsName && !sendsImage) {
    return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
  }

  const data: { name?: string; nameKey?: string; imageUrl?: string | null } = {}

  if (sendsName) {
    const name = normalizeTagName(body.name!)
    const nameKey = tagNameKey(name)
    const clash = await prisma.tag.findFirst({
      where: { trainerId: guard.companyId, nameKey, id: { not: tagId } },
      select: { id: true, name: true },
    })
    if (clash) {
      return NextResponse.json({ error: `You already have a “${clash.name}” tag.` }, { status: 409 })
    }
    data.name = name
    data.nameKey = nameKey
  }

  if (sendsImage) {
    // A URL that doesn't survive the sanitizer is stored as null rather than
    // 400ing — it lands in the same place a deliberate clear does, which is the
    // safe answer for a value that was never going to render.
    data.imageUrl = body.imageUrl === null ? null : sanitizeImageUrl(body.imageUrl)
  }

  // Renaming a tag changes only the tag. Everything in it stays in it — the
  // assignments point at the id, never at the word.
  const updated = await prisma.tag.update({
    where: { id: tagId },
    data,
    select: { id: true, name: true, order: true, imageUrl: true },
  })
  revalidateTagScreens()
  return NextResponse.json(updated)
}

/**
 * Delete a tag, NOT what it labelled.
 *
 * The join rows go (the FK cascades from tags → tag_assignments and stops
 * there); every course, session and product it pointed at is untouched and
 * stays on sale. A trainer tidying their labels must never lose their
 * catalogue by removing a word.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ tagId: string }> }) {
  const guard = await guardAnyPermission('packages.manage', 'products.manage')
  if (guard instanceof NextResponse) return guard
  const { tagId } = await params
  if (!(await owned(guard.companyId, tagId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const untagged = await prisma.$transaction(async tx => {
    const n = await tx.tagAssignment.deleteMany({ where: { tagId } })
    await tx.tag.delete({ where: { id: tagId } })
    return n.count
  })

  revalidateTagScreens()
  return NextResponse.json({ ok: true, untagged })
}
