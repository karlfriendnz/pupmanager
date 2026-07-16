import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { requireSameOrigin } from '@/lib/csrf'
import { safeExternalUrl, isLinkPageFontId, HEX_COLOR, LINK_BUTTON_TYPES } from '@/lib/link-page'

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

// ── Per-button style overrides (now live on each smart-link row) ─────────────
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

// Optional trimmed text → undefined when empty (targetId / custom url pre-check).
const optionalTrimmed = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => {
      if (v === undefined || v === null) return undefined
      const t = v.trim()
      return t === '' ? undefined : t
    })

// ── One smart-link row ───────────────────────────────────────────────────────
// `type` in the enum; CUSTOM requires a valid http(s) `url`; targetId is the
// type-specific reference; imageUrl must be a safe http(s) URL; colours hex.
const buttonSchema = z
  .object({
    type: z.enum(LINK_BUTTON_TYPES as unknown as [string, ...string[]]),
    label: z.string().trim().min(1, 'Label required').max(60),
    url: optionalTrimmed(500),
    targetId: optionalTrimmed(200),
    imageUrl: optionalImageUrl,
    bgColor: optionalHex,
    textColor: optionalHex,
  })
  .superRefine((val, ctx) => {
    if (val.type === 'CUSTOM' && (!val.url || safeExternalUrl(val.url) === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Custom links need a valid web address',
        path: ['url'],
      })
    }
  })

const patchSchema = z.object({
  headline: nullableText(80),
  bio: nullableText(300),
  instagram: nullableText(200),
  facebook: nullableText(200),
  tiktok: nullableText(200),
  socialsLabel: nullableText(40),
  font: fontField,
  backgroundUrl: backgroundField,
  // The full ORDERED smart-link rows. Order IS the array index. Replaces the old
  // built-in toggles + itemOrder + buttonStyles.
  buttons: z.array(buttonSchema).max(30).optional(),
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
  const { buttons, ...fields } = parsed.data

  const page = await prisma.$transaction(async (tx) => {
    // Upsert the config row, scoped to the caller's own trainer only. Order and
    // per-button style now live on the LinkPageButton rows, not the page.
    const lp = await tx.linkPage.upsert({
      where: { trainerId },
      create: { trainerId, ...fields },
      update: { ...fields },
    })

    // Replace the whole button set when provided, assigning order by array index
    // and persisting every field. url is only kept for CUSTOM; targetId only for
    // the types that address a target (booking / lead magnet / form).
    if (buttons !== undefined) {
      await tx.linkPageButton.deleteMany({ where: { linkPageId: lp.id } })
      if (buttons.length > 0) {
        await tx.linkPageButton.createMany({
          data: buttons.map((b, i) => ({
            linkPageId: lp.id,
            type: b.type,
            label: b.label,
            url: b.type === 'CUSTOM' ? safeExternalUrl(b.url ?? null) : null,
            targetId:
              b.type === 'BOOKING' || b.type === 'LEADMAGNET' || b.type === 'FORM'
                ? b.targetId ?? null
                : null,
            imageUrl: b.imageUrl ?? null,
            bgColor: b.bgColor ?? null,
            textColor: b.textColor ?? null,
            order: i,
          })),
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
