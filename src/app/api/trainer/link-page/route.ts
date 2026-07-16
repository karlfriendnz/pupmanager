import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { requireSameOrigin } from '@/lib/csrf'
import { safeExternalUrl, isLinkPageFontId } from '@/lib/link-page'

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

// A stored font id, or empty/null → null (use the default font).
const fontField = z
  .string()
  .nullable()
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined
    const t = (v ?? '').trim()
    return t === '' ? null : t
  })
  .refine((v) => v === undefined || v === null || isLinkPageFontId(v), 'Unknown font')

// A background image URL, or empty/null → null. Must be a safe http(s) URL.
const backgroundField = z
  .string()
  .max(2000)
  .nullable()
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined
    const t = (v ?? '').trim()
    return t === '' ? null : t
  })
  .refine((v) => v === undefined || v === null || safeExternalUrl(v) !== null, 'Invalid background URL')
  .transform((v) => (typeof v === 'string' ? safeExternalUrl(v) : v))

const patchSchema = z.object({
  headline: nullableText(80),
  bio: nullableText(300),
  showBooking: z.boolean().optional(),
  showWebsite: z.boolean().optional(),
  showContact: z.boolean().optional(),
  instagram: nullableText(200),
  facebook: nullableText(200),
  tiktok: nullableText(200),
  socialsLabel: nullableText(40),
  font: fontField,
  backgroundUrl: backgroundField,
  links: z.array(linkSchema).max(20).optional(),
  // Global button order. Keys: 'book' | 'website' | 'contact' | 'custom:<id>'.
  // When `links` is also present the 'custom:*' entries carry client-side
  // placeholder ids; they're reconciled to the freshly-created ids below.
  itemOrder: z.array(z.string()).max(60).optional(),
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
  const { links, itemOrder, ...fields } = parsed.data

  const page = await prisma.$transaction(async (tx) => {
    // When links are NOT being replaced, itemOrder's 'custom:*' keys already
    // reference live ids, so it can be stored verbatim in the upsert. When links
    // ARE replaced the ids change, so we defer itemOrder to a reconciling update.
    const verbatimOrder = links === undefined && itemOrder !== undefined ? { itemOrder } : {}

    // Upsert the config row, scoped to the caller's own trainer only.
    const lp = await tx.linkPage.upsert({
      where: { trainerId },
      create: { trainerId, ...fields, ...verbatimOrder },
      update: { ...fields, ...verbatimOrder },
    })

    // Replace the whole link set when provided, assigning order by array index.
    if (links !== undefined) {
      await tx.linkPageButton.deleteMany({ where: { linkPageId: lp.id } })
      if (links.length > 0) {
        await tx.linkPageButton.createMany({
          data: links.map((l, i) => ({ linkPageId: lp.id, label: l.label, url: l.url, order: i })),
        })
      }

      // Reconcile itemOrder against the freshly-assigned ids. The client sends
      // 'custom:*' keys in the SAME order as `links`, so we walk the new ids
      // (fetched back in `order` = array-index order) and swap each placeholder
      // for its real id. Built-in keys pass through; leftover/stale customs drop.
      if (itemOrder !== undefined) {
        const created =
          links.length > 0
            ? await tx.linkPageButton.findMany({
                where: { linkPageId: lp.id },
                orderBy: { order: 'asc' },
                select: { id: true },
              })
            : []
        const newIds = created.map((c) => c.id)
        let ci = 0
        const reconciled: string[] = []
        for (const key of itemOrder) {
          if (key.startsWith('custom:')) {
            if (ci < newIds.length) reconciled.push(`custom:${newIds[ci++]}`)
          } else {
            reconciled.push(key)
          }
        }
        await tx.linkPage.update({ where: { id: lp.id }, data: { itemOrder: reconciled } })
      }
    }

    return tx.linkPage.findUnique({
      where: { id: lp.id },
      include: { links: { orderBy: { order: 'asc' } } },
    })
  })

  return NextResponse.json(page)
}
