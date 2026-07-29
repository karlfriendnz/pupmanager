import { NextResponse } from 'next/server'
import { z } from 'zod'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { prisma } from '@/lib/prisma'
import { reviewToolsEnabled } from '@/lib/review-enabled'
import { buildBriefMarkdown, selectForBrief, type BriefComment } from '@/lib/review-brief'

// POST /api/review/brief — write the approved review comments out as a task brief
// at docs/review-tasks.md, and return the markdown.
//
// This is the "hand it to Claude" button. It writes a FILE rather than just
// returning text for two reasons: the brief survives the tab closing and can be
// re-read mid-job, and nothing in a browser can wake a CLI — the agent watches
// this path for a change (see AGENTS.md).
//
// Dev-gated like everything else that touches the working tree.

export const runtime = 'nodejs'

const BRIEF_PATH = 'docs/review-tasks.md'

const bodySchema = z.object({
  /** Only these comments. Omitted = everything approved. */
  ids: z.array(z.string().min(1)).max(500).nullable().optional(),
  /** Only this page. Ignored when ids are given. */
  pageKey: z.string().min(1).nullable().optional(),
})

export async function POST(req: Request) {
  if (!reviewToolsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const { ids, pageKey } = parsed.data

  const rows = await prisma.reviewComment.findMany({
    where: { resolved: false },
    orderBy: [{ createdAt: 'asc' }],
  })

  const open: BriefComment[] = rows.map(r => ({
    id: r.id,
    seq: r.seq,
    pageKey: r.pageKey,
    body: r.body,
    x: r.x,
    y: r.y,
    parentId: r.parentId,
    authorName: r.authorName,
    context: (r.context as Record<string, unknown> | null) ?? null,
    attachments: (r.attachments as { path: string; name?: string | null }[] | null) ?? null,
    claudeStatus: r.claudeStatus,
    claudeNote: r.claudeNote,
    createdAt: r.createdAt,
  }))

  // The gate lives in selectForBrief, applied to what the DATABASE says is ready
  // rather than to what the client asked for. Ticking a box in the panel is a
  // request to include something; being approved is what makes it work.
  const readyById = new Map(rows.map(r => [r.id, r.ready]))
  const comments = selectForBrief(open, {
    ids: ids ?? null,
    pageKey: pageKey ?? null,
    ready: c => readyById.get(c.id) === true,
  })

  if (comments.length === 0) {
    return NextResponse.json(
      { error: 'Nothing approved to send. Tick the comments you want built first.' },
      { status: 400 },
    )
  }

  // Stamp the origin this was served from into the brief, so the hand-back
  // PATCHes name the port the app is ACTUALLY on.
  const baseUrl = new URL(req.url).origin
  const { markdown, taskCount, pageCount } = buildBriefMarkdown(comments, { pageKey, baseUrl })

  const file = join(process.cwd(), BRIEF_PATH)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, markdown, 'utf8')

  // Stamp what was handed over. Two reasons: the panel can show "sent, not
  // started" instead of it looking identical to untouched work, and there's a
  // durable record of the batch that survives the file being regenerated.
  await prisma.reviewComment.updateMany({
    where: { id: { in: comments.filter(c => !c.parentId).map(c => c.id) } },
    data: { queuedAt: new Date() },
  })

  return NextResponse.json({ file: BRIEF_PATH, taskCount, pageCount, markdown })
}
