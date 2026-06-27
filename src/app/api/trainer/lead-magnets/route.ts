import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { hasAddon } from '@/lib/billing'
import { uniqueLeadMagnetSlug, DEFAULT_CONSENT_TEXT } from '@/lib/lead-magnet'

const LAYOUTS = ['classic', 'split', 'spotlight', 'minimal'] as const

const schema = z.object({
  title: z.string().min(1).max(140),
  description: z.string().max(2000).optional().nullable(),
  headline: z.string().max(200).optional().nullable(),
  intro: z.string().max(2000).optional().nullable(),
  layout: z.enum(LAYOUTS).default('classic'),
  imageUrl: z.string().url().max(2000).optional().nullable(),
  fileUrl: z.string().url().max(2000),
  fileName: z.string().min(1).max(255),
  fileSizeBytes: z.number().int().nonnegative().optional().nullable(),
  // Consent text is platform-standard — not accepted from the client.
  emailSubject: z.string().max(200).optional().nullable(),
  emailIntro: z.string().max(4000).optional().nullable(),
  thankYouTitle: z.string().max(200).optional().nullable(),
  thankYouMessage: z.string().max(2000).optional().nullable(),
  isActive: z.boolean().default(true),
})

export async function GET() {
  const ctx = await guardPermission('forms.manage')
  if (ctx instanceof NextResponse) return ctx
  if (!(await hasAddon(ctx.companyId, 'leadmagnets'))) {
    return NextResponse.json({ error: 'This add-on isn\'t enabled.', code: 'ADDON_REQUIRED' }, { status: 403 })
  }

  const magnets = await prisma.leadMagnet.findMany({
    where: { trainerId: ctx.companyId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { subscribers: true } } },
  })
  return NextResponse.json({ leadMagnets: magnets })
}

export async function POST(req: Request) {
  const ctx = await guardPermission('forms.manage')
  if (ctx instanceof NextResponse) return ctx
  if (!(await hasAddon(ctx.companyId, 'leadmagnets'))) {
    return NextResponse.json({ error: 'This add-on isn\'t enabled.', code: 'ADDON_REQUIRED' }, { status: 403 })
  }

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const d = parsed.data

  const slug = await uniqueLeadMagnetSlug(ctx.companyId, d.title)
  const magnet = await prisma.leadMagnet.create({
    data: {
      trainerId: ctx.companyId,
      slug,
      title: d.title,
      description: d.description ?? null,
      headline: d.headline ?? null,
      intro: d.intro ?? null,
      layout: d.layout,
      imageUrl: d.imageUrl ?? null,
      fileUrl: d.fileUrl,
      fileName: d.fileName,
      fileSizeBytes: d.fileSizeBytes ?? null,
      consentText: DEFAULT_CONSENT_TEXT,
      emailSubject: d.emailSubject ?? null,
      emailIntro: d.emailIntro ?? null,
      thankYouTitle: d.thankYouTitle ?? null,
      thankYouMessage: d.thankYouMessage ?? null,
      isActive: d.isActive,
    },
  })
  return NextResponse.json({ leadMagnet: magnet }, { status: 201 })
}
