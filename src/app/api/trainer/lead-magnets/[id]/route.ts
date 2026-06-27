import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { hasAddon } from '@/lib/billing'

const patchSchema = z.object({
  title: z.string().min(1).max(140).optional(),
  description: z.string().max(2000).nullable().optional(),
  headline: z.string().max(200).nullable().optional(),
  intro: z.string().max(2000).nullable().optional(),
  layout: z.enum(['classic', 'split', 'spotlight', 'minimal']).optional(),
  imageUrl: z.string().url().max(2000).nullable().optional(),
  fileUrl: z.string().url().max(2000).optional(),
  fileName: z.string().min(1).max(255).optional(),
  fileSizeBytes: z.number().int().nonnegative().nullable().optional(),
  emailSubject: z.string().max(200).nullable().optional(),
  emailIntro: z.string().max(4000).nullable().optional(),
  thankYouTitle: z.string().max(200).nullable().optional(),
  thankYouMessage: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
})

// Tenant-scoped fetch: only the owning company's magnet, gated by the add-on.
async function ownedMagnet(id: string) {
  const ctx = await guardPermission('forms.manage')
  if (ctx instanceof NextResponse) return { error: ctx }
  if (!(await hasAddon(ctx.companyId, 'leadmagnets'))) {
    return { error: NextResponse.json({ error: 'This add-on isn\'t enabled.', code: 'ADDON_REQUIRED' }, { status: 403 }) }
  }
  const magnet = await prisma.leadMagnet.findFirst({ where: { id, trainerId: ctx.companyId }, select: { id: true } })
  if (!magnet) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { ctx, magnetId: magnet.id }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await ownedMagnet(id)
  if (res.error) return res.error

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  try {
    const updated = await prisma.leadMagnet.update({
      where: { id: res.magnetId },
      data: parsed.data,
    })
    return NextResponse.json({ leadMagnet: updated })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not save'
    console.error('[lead-magnets update]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await ownedMagnet(id)
  if (res.error) return res.error
  await prisma.leadMagnet.delete({ where: { id: res.magnetId } })
  return NextResponse.json({ ok: true })
}
