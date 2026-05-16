import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { nextPriority } from '@/lib/waitlist'

// GET  /api/waitlist        — the trainer's waitlist, ordered
// POST /api/waitlist        — add an entry (existing client OR a prospect)
export async function GET(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const status = new URL(req.url).searchParams.get('status')
  const where = {
    trainerId,
    ...(status && ['WAITING', 'CONTACTED', 'SCHEDULED', 'REMOVED'].includes(status)
      ? { status: status as 'WAITING' | 'CONTACTED' | 'SCHEDULED' | 'REMOVED' }
      : {}),
  }

  const entries = await prisma.waitlistEntry.findMany({
    where,
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    include: {
      client: { select: { id: true, user: { select: { name: true, email: true } } } },
      package: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json(
    entries.map(e => ({
      id: e.id,
      clientId: e.clientId,
      name: e.client?.user.name ?? e.name,
      email: e.client?.user.email ?? e.email,
      phone: e.phone,
      packageId: e.packageId,
      packageName: e.package?.name ?? null,
      request: e.request,
      sessionType: e.sessionType,
      preferredDays: e.preferredDays,
      preferredTimeStart: e.preferredTimeStart,
      preferredTimeEnd: e.preferredTimeEnd,
      earliestStart: e.earliestStart?.toISOString() ?? null,
      notes: e.notes,
      priority: e.priority,
      status: e.status,
      contactedAt: e.contactedAt?.toISOString() ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
  )
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')

const createSchema = z
  .object({
    clientId: z.string().min(1).nullable().optional(),
    name: z.string().min(1).max(160).optional(),
    email: z.string().email().nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    packageId: z.string().min(1).nullable().optional(),
    request: z.string().max(2000).nullable().optional(),
    sessionType: z.enum(['IN_PERSON', 'VIRTUAL']).nullable().optional(),
    preferredDays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
    preferredTimeStart: hhmm.nullable().optional(),
    preferredTimeEnd: hhmm.nullable().optional(),
    earliestStart: z.string().min(1).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
  })
  // A linked client supplies the name; otherwise name is required.
  .refine(d => !!d.clientId || !!d.name?.trim(), {
    message: 'Either pick a client or enter a name',
    path: ['name'],
  })

export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const d = parsed.data

  // Resolve the subject. A linked client must belong to this trainer; we
  // snapshot their name so the list still reads right if they're later
  // unlinked/deleted.
  let name = d.name?.trim() ?? ''
  let email = d.email ?? null
  if (d.clientId) {
    const client = await prisma.clientProfile.findFirst({
      where: { id: d.clientId, trainerId },
      select: { user: { select: { name: true, email: true } } },
    })
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    name = name || client.user.name || 'Client'
    email = email ?? client.user.email ?? null
  }

  if (d.packageId) {
    const pkg = await prisma.package.findFirst({
      where: { id: d.packageId, trainerId },
      select: { id: true },
    })
    if (!pkg) return NextResponse.json({ error: 'Package not found' }, { status: 404 })
  }

  let earliest: Date | null = null
  if (d.earliestStart) {
    earliest = new Date(d.earliestStart)
    if (Number.isNaN(earliest.getTime())) {
      return NextResponse.json({ error: 'Invalid earliestStart' }, { status: 400 })
    }
  }

  const max = await prisma.waitlistEntry.aggregate({
    where: { trainerId },
    _max: { priority: true },
  })

  const entry = await prisma.waitlistEntry.create({
    data: {
      trainerId,
      clientId: d.clientId ?? null,
      name,
      email,
      phone: d.phone ?? null,
      packageId: d.packageId ?? null,
      request: d.request?.trim() || null,
      sessionType: d.sessionType ?? null,
      preferredDays: d.preferredDays ?? [],
      preferredTimeStart: d.preferredTimeStart ?? null,
      preferredTimeEnd: d.preferredTimeEnd ?? null,
      earliestStart: earliest,
      notes: d.notes?.trim() || null,
      priority: nextPriority(max._max.priority),
    },
  })
  return NextResponse.json({ ok: true, id: entry.id }, { status: 201 })
}
