import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma'
import { reviewToolsEnabled } from '@/lib/review-enabled'

// The review widget's comment list + create. Dev-only (see review-enabled).
//
// GET  /api/review/comments?pageKey=/clients/:id  → that page's open comments
// GET  /api/review/comments?all=1                → every open comment, for the board
// POST /api/review/comments                       → a pin, a page note, or a reply

export const runtime = 'nodejs'

const createSchema = z.object({
  pageKey: z.string().min(1),
  body: z.string().min(1).max(4000),
  authorName: z.string().max(120).nullable().optional(),
  // Absent for a page-level note and for a reply.
  x: z.number().nullable().optional(),
  y: z.number().nullable().optional(),
  context: z.record(z.string(), z.any()).nullable().optional(),
  parentId: z.string().min(1).nullable().optional(),
  attachments: z.array(z.object({ path: z.string().min(1), name: z.string().nullable().optional() })).nullable().optional(),
  // Karl's own comments are work by definition, so the widget sends ready:true
  // and the triage gate never costs him a second click.
  ready: z.boolean().optional(),
})

export async function GET(req: Request) {
  if (!reviewToolsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const url = new URL(req.url)
  const pageKey = url.searchParams.get('pageKey')
  const all = url.searchParams.get('all') === '1'
  const includeResolved = url.searchParams.get('resolved') === '1'

  // A page's own comments, PLUS every reply to them — a reply carries the
  // clarification, and the panel is wrong without it. Replies are matched by
  // parent rather than by pageKey because a reply has no pin of its own.
  const comments = await prisma.reviewComment.findMany({
    where: {
      ...(includeResolved ? {} : { resolved: false }),
      ...(all || !pageKey ? {} : { OR: [{ pageKey }, { parent: { pageKey } }] }),
    },
    orderBy: [{ createdAt: 'asc' }],
  })

  return NextResponse.json({ comments })
}

export async function POST(req: Request) {
  if (!reviewToolsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const d = parsed.data

  // A reply belongs to its parent's page, whatever page it was typed on.
  let pageKey = d.pageKey
  if (d.parentId) {
    const parent = await prisma.reviewComment.findUnique({
      where: { id: d.parentId },
      select: { pageKey: true },
    })
    if (!parent) return NextResponse.json({ error: 'That comment no longer exists.' }, { status: 404 })
    pageKey = parent.pageKey
  }

  // The pin's PERMANENT number on its page: max+1 over every comment ever made
  // there, resolved ones included. Numbers are never reused, so resolving one
  // comment can't renumber the rest — "pin 7" means the same thing tomorrow.
  // Replies don't take a number; they hang off their parent's.
  let seq: number | null = null
  if (!d.parentId) {
    const top = await prisma.reviewComment.aggregate({
      where: { pageKey, parentId: null },
      _max: { seq: true },
    })
    seq = (top._max.seq ?? 0) + 1
  }

  const ready = d.ready ?? false
  const comment = await prisma.reviewComment.create({
    data: {
      pageKey,
      seq,
      body: d.body.trim(),
      authorName: d.authorName?.trim() || null,
      x: d.parentId ? null : d.x ?? null,
      y: d.parentId ? null : d.y ?? null,
      context: d.parentId ? undefined : (d.context as Prisma.InputJsonValue | undefined),
      attachments: d.attachments?.length ? (d.attachments as Prisma.InputJsonValue) : undefined,
      parentId: d.parentId ?? null,
      ready,
      readyAt: ready ? new Date() : null,
    },
  })

  return NextResponse.json({ comment }, { status: 201 })
}
