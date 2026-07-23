import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  address: z.string().max(300).nullable().optional(),
  imageUrl: z.string().max(2000).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
})

// Tenant-scoped fetch: only the caller's own location matches {id, trainerId},
// so a row owned by another company is invisible → 404 (no cross-tenant leak).
async function ownedLocation(id: string) {
  const ctx = await guardPermission('settings.edit')
  if (ctx instanceof NextResponse) return { error: ctx }
  const location = await prisma.location.findFirst({
    where: { id, trainerId: ctx.companyId },
    select: { id: true },
  })
  if (!location) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { ctx, locationId: location.id }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await ownedLocation(id)
  if (res.error) return res.error

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const updated = await prisma.location.update({
    where: { id: res.locationId },
    data: parsed.data,
  })
  return NextResponse.json({ location: updated })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await ownedLocation(id)
  if (res.error) return res.error
  await prisma.location.delete({ where: { id: res.locationId } })
  return NextResponse.json({ ok: true })
}
