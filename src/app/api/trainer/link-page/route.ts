import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { requireSameOrigin } from '@/lib/csrf'
import { safeExternalUrl } from '@/lib/link-page'

// GET/PATCH the current trainer's "link in bio" config (Instagram add-on).
// The public page lives at /l/<slug>; this is the owner-facing editor's API.

// Empty / whitespace-only string → null. Applied to the optional text fields.
const nullableText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined
      const t = (v ?? '').trim()
      return t === '' ? null : t
    })

const linkSchema = z.object({
  label: z.string().trim().min(1, 'Label required').max(60),
  // Must normalise to a safe http(s) URL — bare domains are assumed https,
  // anything non-http(s) (mailto:, javascript:, …) is rejected.
  url: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .transform((v) => safeExternalUrl(v))
    .refine((v): v is string => v !== null, 'Links must be a valid web address'),
})

const patchSchema = z.object({
  headline: nullableText(80),
  bio: nullableText(300),
  showBooking: z.boolean().optional(),
  showWebsite: z.boolean().optional(),
  showContact: z.boolean().optional(),
  instagram: nullableText(200),
  facebook: nullableText(200),
  tiktok: nullableText(200),
  links: z.array(linkSchema).max(20).optional(),
})

export async function GET() {
  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard

  const page = await prisma.linkPage.findUnique({
    where: { trainerId: guard.companyId },
    include: { links: { orderBy: { order: 'asc' } } },
  })

  return NextResponse.json(page)
}

export async function PATCH(req: Request) {
  const csrf = requireSameOrigin(req)
  if (csrf) return csrf

  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard
  const trainerId = guard.companyId

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }
  const { links, ...fields } = parsed.data

  const page = await prisma.$transaction(async (tx) => {
    // Upsert the config row, scoped to the caller's own trainer only.
    const lp = await tx.linkPage.upsert({
      where: { trainerId },
      create: { trainerId, ...fields },
      update: fields,
    })

    // Replace the whole link set when provided, assigning order by array index.
    if (links !== undefined) {
      await tx.linkPageButton.deleteMany({ where: { linkPageId: lp.id } })
      if (links.length > 0) {
        await tx.linkPageButton.createMany({
          data: links.map((l, i) => ({ linkPageId: lp.id, label: l.label, url: l.url, order: i })),
        })
      }
    }

    return tx.linkPage.findUnique({
      where: { id: lp.id },
      include: { links: { orderBy: { order: 'asc' } } },
    })
  })

  return NextResponse.json(page)
}
