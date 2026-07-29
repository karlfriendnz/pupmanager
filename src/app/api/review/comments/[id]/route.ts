import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma'
import { reviewToolsEnabled } from '@/lib/review-enabled'

// PATCH/DELETE one review comment. Dev-only (see review-enabled).
//
// This is also the endpoint an AGENT writes to, by curl, with no session — which
// is exactly why the whole thing is gated off in production rather than
// authenticated. The brief stamps the base URL so those calls reach the right
// port.
//
//   PATCH { claudeStatus: 'done', claudeNote: 'what changed' }      ← built
//   PATCH { claudeStatus: 'needs_info', claudeNote: 'the question' } ← blocked
//   PATCH { ready: true }        ← Karl approving it as real work
//   PATCH { resolved: true }     ← Karl signing it off; it leaves the board
//   PATCH { body: '…' }          ← fixing a typo in his own note

export const runtime = 'nodejs'

const patchSchema = z.object({
  body: z.string().min(1).max(4000).optional(),
  ready: z.boolean().optional(),
  resolved: z.boolean().optional(),
  // Free-form on purpose: 'done' and 'needs_info' are what the brief asks for,
  // but pinning the set here would make a new state a schema change.
  claudeStatus: z.string().max(40).nullable().optional(),
  claudeNote: z.string().max(2000).nullable().optional(),
  x: z.number().nullable().optional(),
  y: z.number().nullable().optional(),
  context: z.record(z.string(), z.any()).nullable().optional(),
  attachments: z.array(z.object({ path: z.string().min(1), name: z.string().nullable().optional() })).nullable().optional(),
}).refine(o => Object.keys(o).length > 0, { message: 'Nothing to change' })

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!reviewToolsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { id } = await params
  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const d = parsed.data

  const existing = await prisma.reviewComment.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const comment = await prisma.reviewComment.update({
    where: { id },
    data: {
      ...(d.body !== undefined ? { body: d.body.trim() } : {}),
      // Each of these three carries its own timestamp, so the panel can say WHEN
      // as well as what — and so "approved but never sent" is distinguishable
      // from "never approved".
      ...(d.ready !== undefined ? { ready: d.ready, readyAt: d.ready ? new Date() : null } : {}),
      ...(d.resolved !== undefined ? { resolved: d.resolved, resolvedAt: d.resolved ? new Date() : null } : {}),
      ...(d.claudeStatus !== undefined
        ? { claudeStatus: d.claudeStatus, claudeAt: d.claudeStatus ? new Date() : null }
        : {}),
      ...(d.claudeNote !== undefined ? { claudeNote: d.claudeNote } : {}),
      ...(d.x !== undefined ? { x: d.x } : {}),
      ...(d.y !== undefined ? { y: d.y } : {}),
      ...(d.context !== undefined ? { context: (d.context ?? Prisma.JsonNull) as Prisma.InputJsonValue } : {}),
      ...(d.attachments !== undefined ? { attachments: (d.attachments ?? Prisma.JsonNull) as Prisma.InputJsonValue } : {}),
    },
  })

  return NextResponse.json({ comment })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!reviewToolsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { id } = await params
  // Replies cascade with the parent (the FK says so): a clarification on its own
  // says nothing.
  await prisma.reviewComment.delete({ where: { id } }).catch(() => null)
  return NextResponse.json({ ok: true })
}
