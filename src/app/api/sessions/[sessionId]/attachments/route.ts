import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { accessibleSessionWhere } from '@/lib/session-access'

// POST creates the row immediately after the browser-side `upload()`
// resolves with a Blob URL. We use this rather than relying solely on
// handleUpload's `onUploadCompleted` callback because that callback is
// a webhook from Vercel → your domain and never reaches localhost in
// dev — uploads would succeed but nothing would persist. In prod the
// callback still fires too; the createMany-style guard in the body
// (skip if a row with this URL already exists for this session)
// keeps duplicate inserts from sneaking through.
const createSchema = z.object({
  kind: z.enum(['IMAGE', 'VIDEO']),
  url: z.string().url(),
  sizeBytes: z.number().int().min(1).max(120 * 1024 * 1024),
  durationMs: z.number().int().min(0).optional().nullable(),
  caption: z.string().max(500).optional().nullable(),
  thumbnailUrl: z.string().url().optional().nullable(),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const trainerId = ctx.companyId

  const { sessionId } = await params

  const owns = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId, ...accessibleSessionWhere(ctx) },
    select: { id: true },
  })
  if (!owns) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  // Only accept Blob URLs that look like ours — quick guard against a
  // trainer trying to inject an arbitrary URL via this endpoint. Any
  // *.public.blob.vercel-storage.com host is acceptable.
  const host = new URL(parsed.data.url).hostname
  if (!host.endsWith('blob.vercel-storage.com')) {
    return NextResponse.json({ error: 'Invalid URL host' }, { status: 400 })
  }

  // Idempotent: if the same URL was already recorded for this session
  // (e.g. prod's onUploadCompleted fired first and the client POST
  // arrived second), reuse the existing row.
  const existing = await prisma.sessionAttachment.findFirst({
    where: { sessionId, url: parsed.data.url },
  })
  if (existing) {
    return NextResponse.json({ attachment: serialize(existing) })
  }

  const created = await prisma.sessionAttachment.create({
    data: {
      sessionId,
      trainerId,
      kind: parsed.data.kind,
      url: parsed.data.url,
      sizeBytes: parsed.data.sizeBytes,
      durationMs: parsed.data.durationMs ?? null,
      caption: parsed.data.caption ?? null,
      thumbnailUrl: parsed.data.thumbnailUrl ?? null,
    },
  })
  return NextResponse.json({ attachment: serialize(created) })
}

function serialize(a: {
  id: string; kind: 'IMAGE' | 'VIDEO'; url: string; thumbnailUrl: string | null
  caption: string | null; sizeBytes: number; durationMs: number | null; createdAt: Date
}) {
  return { ...a, createdAt: a.createdAt.toISOString() }
}

// Lists attachments for a session. Used by the client component to
// re-sync after an upload completes.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const trainerId = ctx.companyId

  const { sessionId } = await params

  const owns = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId, ...accessibleSessionWhere(ctx) },
    select: { id: true },
  })
  if (!owns) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rows = await prisma.sessionAttachment.findMany({
    where: { sessionId, trainerId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, kind: true, url: true, thumbnailUrl: true,
      caption: true, sizeBytes: true, durationMs: true, createdAt: true,
    },
  })
  return NextResponse.json({
    attachments: rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })),
  })
}
