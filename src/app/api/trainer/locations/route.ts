import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'

// Reusable locations library — a small set of places the trainer works from,
// curated in Settings and picked from when creating packages/classes/sessions.
// Every query is scoped by companyId so a trainer only ever sees/edits their own.

const schema = z.object({
  name: z.string().min(1).max(120),
  address: z.string().max(300).optional().nullable(),
  imageUrl: z.string().max(2000).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
})

export async function GET() {
  const ctx = await guardPermission('settings.edit')
  if (ctx instanceof NextResponse) return ctx

  const locations = await prisma.location.findMany({
    where: { trainerId: ctx.companyId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })
  return NextResponse.json({ locations })
}

export async function POST(req: Request) {
  const ctx = await guardPermission('settings.edit')
  if (ctx instanceof NextResponse) return ctx

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const d = parsed.data

  // New locations land at the end of the list.
  const last = await prisma.location.findFirst({
    where: { trainerId: ctx.companyId },
    orderBy: { order: 'desc' },
    select: { order: true },
  })

  const location = await prisma.location.create({
    data: {
      trainerId: ctx.companyId,
      name: d.name,
      address: d.address ?? null,
      imageUrl: d.imageUrl ?? null,
      description: d.description ?? null,
      order: (last?.order ?? -1) + 1,
    },
  })
  return NextResponse.json({ location }, { status: 201 })
}
