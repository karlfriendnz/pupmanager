import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@/generated/prisma'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { requireSameOrigin } from '@/lib/csrf'
import { safeExternalUrl, isLinkPageFontId, HEX_COLOR, type ButtonStyle } from '@/lib/link-page'

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

// ── Per-button style overrides ───────────────────────────────────────────────
// Optional hex colour: absent/empty → undefined, else must be #rgb / #rrggbb.
const optionalHex = z
  .string()
  .nullable()
  .optional()
  .transform((v) => {
    if (v === undefined || v === null) return undefined
    const t = v.trim()
    return t === '' ? undefined : t
  })
  .refine((v) => v === undefined || HEX_COLOR.test(v), 'Invalid colour')

// Optional font id (must be a known LINK_PAGE_FONTS id when present).
const optionalStyleFont = z
  .string()
  .nullable()
  .optional()
  .transform((v) => {
    if (v === undefined || v === null) return undefined
    const t = v.trim()
    return t === '' ? undefined : t
  })
  .refine((v) => v === undefined || isLinkPageFontId(v), 'Unknown font')

// Optional image URL (safe http(s), normalised) or absent.
const optionalImageUrl = z
  .string()
  .max(2000)
  .nullable()
  .optional()
  .transform((v) => {
    if (v === undefined || v === null) return undefined
    const t = v.trim()
    return t === '' ? undefined : t
  })
  .refine((v) => v === undefined || safeExternalUrl(v) !== null, 'Invalid image URL')
  .transform((v) => (typeof v === 'string' ? safeExternalUrl(v)! : undefined))

// One button's style entry → a tidy ButtonStyle (empty sub-fields dropped).
const buttonStyleSchema = z
  .object({
    imageUrl: optionalImageUrl,
    bgColor: optionalHex,
    textColor: optionalHex,
    font: optionalStyleFont,
  })
  .transform((s): ButtonStyle => {
    const out: ButtonStyle = {}
    if (s.imageUrl) out.imageUrl = s.imageUrl
    if (s.bgColor) out.bgColor = s.bgColor
    if (s.textColor) out.textColor = s.textColor
    if (s.font) out.font = s.font
    return out
  })

// The whole map, keyed by button key. Entries that end up empty are stripped so
// the JSON stays tidy and empty buttons cleanly inherit the page defaults.
const buttonStylesField = z
  .record(z.string().max(120), buttonStyleSchema)
  .optional()
  .transform((rec) => {
    if (rec === undefined) return undefined
    const out: Record<string, ButtonStyle> = {}
    for (const [k, v] of Object.entries(rec)) {
      if (v && Object.keys(v).length > 0) out[k] = v
    }
    return out
  })
  .refine((rec) => rec === undefined || Object.keys(rec).length <= 60, 'Too many button styles')

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
  // Per-button style overrides keyed by button key ('book' | 'website' |
  // 'contact' | 'custom:<id>'). 'custom:*' keys carry placeholder ids when
  // `links` is also present and are reconciled to the new ids below.
  buttonStyles: buttonStylesField,
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
  const { links, itemOrder, buttonStyles, ...fields } = parsed.data

  const page = await prisma.$transaction(async (tx) => {
    // When links are NOT being replaced, the 'custom:*' keys in itemOrder AND in
    // buttonStyles already reference live ids, so both can be stored verbatim in
    // the upsert. When links ARE replaced the ids change, so we defer both to a
    // reconciling update once the new ids exist.
    const verbatimOrder = links === undefined && itemOrder !== undefined ? { itemOrder } : {}
    const verbatimStyles =
      links === undefined && buttonStyles !== undefined
        ? { buttonStyles: buttonStyles as Prisma.InputJsonValue }
        : {}

    // Upsert the config row, scoped to the caller's own trainer only.
    const lp = await tx.linkPage.upsert({
      where: { trainerId },
      create: { trainerId, ...fields, ...verbatimOrder, ...verbatimStyles },
      update: { ...fields, ...verbatimOrder, ...verbatimStyles },
    })

    // Replace the whole link set when provided, assigning order by array index.
    if (links !== undefined) {
      await tx.linkPageButton.deleteMany({ where: { linkPageId: lp.id } })
      if (links.length > 0) {
        await tx.linkPageButton.createMany({
          data: links.map((l, i) => ({ linkPageId: lp.id, label: l.label, url: l.url, order: i })),
        })
      }

      // Reconcile itemOrder AND buttonStyles against the freshly-assigned ids.
      // The client sends 'custom:*' keys in itemOrder in the SAME order as
      // `links`, so the Nth custom key in itemOrder maps to the Nth new id. We
      // build that placeholder→new-id map once and use it to rewrite BOTH
      // itemOrder and the buttonStyles keys, so per-button styles survive a save
      // that re-creates (and re-ids) every link.
      if (itemOrder !== undefined || buttonStyles !== undefined) {
        const created =
          links.length > 0
            ? await tx.linkPageButton.findMany({
                where: { linkPageId: lp.id },
                orderBy: { order: 'asc' },
                select: { id: true },
              })
            : []
        const newIds = created.map((c) => c.id)

        // placeholder id (from itemOrder's custom keys, in links order) → new id.
        const placeholderToNew = new Map<string, string>()
        let ci = 0
        for (const key of itemOrder ?? []) {
          if (key.startsWith('custom:')) {
            const ph = key.slice('custom:'.length)
            if (ci < newIds.length) placeholderToNew.set(ph, newIds[ci++])
          }
        }

        const updateData: Prisma.LinkPageUpdateInput = {}

        if (itemOrder !== undefined) {
          // Built-in keys pass through; each placeholder → its real id; leftover
          // / stale customs (no matching new id) are dropped.
          const reconciled: string[] = []
          for (const key of itemOrder) {
            if (key.startsWith('custom:')) {
              const newId = placeholderToNew.get(key.slice('custom:'.length))
              if (newId) reconciled.push(`custom:${newId}`)
            } else {
              reconciled.push(key)
            }
          }
          updateData.itemOrder = reconciled
        }

        if (buttonStyles !== undefined) {
          // Same remap for the style map keys: built-ins pass through, customs
          // are rewritten to the new id (stale customs dropped).
          const remapped: Record<string, ButtonStyle> = {}
          for (const [key, val] of Object.entries(buttonStyles)) {
            if (key.startsWith('custom:')) {
              const newId = placeholderToNew.get(key.slice('custom:'.length))
              if (newId) remapped[`custom:${newId}`] = val
            } else {
              remapped[key] = val
            }
          }
          updateData.buttonStyles = remapped as Prisma.InputJsonValue
        }

        await tx.linkPage.update({ where: { id: lp.id }, data: updateData })
      }
    }

    return tx.linkPage.findUnique({
      where: { id: lp.id },
      include: { links: { orderBy: { order: 'asc' } } },
    })
  })

  return NextResponse.json(page)
}
