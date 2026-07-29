import { NextResponse } from 'next/server'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { reviewToolsEnabled } from '@/lib/review-enabled'

// POST /api/review/upload — a screenshot dropped on a review comment.
//
// Writes to the WORKING TREE (public/review-uploads), not to Blob storage, on
// purpose: the agent reading the brief needs to OPEN the image with its own file
// tools, and a remote URL is something it can only be handed a link to. Under
// public/ so the widget can show a thumbnail off the same path. The folder is
// gitignored — these are notes about a moment, not repo content.
//
// Dev-gated like everything else that touches the tree.

export const runtime = 'nodejs'

const DIR = 'public/review-uploads'
const MAX_BYTES = 12 * 1024 * 1024
// What a screenshot can be. Anything else is a mistake or a probe, and this
// endpoint writes files to disk — the allowlist is the whole defence.
const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export async function POST(req: Request) {
  if (!reviewToolsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Attach an image.' }, { status: 400 })
  }
  if (file.size === 0) return NextResponse.json({ error: 'That file is empty.' }, { status: 400 })
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'That image is over 12MB — take a smaller shot.' }, { status: 400 })
  }
  const ext = EXT_BY_TYPE[file.type]
  if (!ext) {
    return NextResponse.json({ error: 'PNG, JPG, WebP or GIF only.' }, { status: 400 })
  }

  // The name is ours, never the client's: a caller-supplied filename is a path
  // traversal waiting to happen, and the original name is kept as metadata on the
  // comment instead.
  const name = `${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`
  const dir = join(process.cwd(), DIR)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, name), Buffer.from(await file.arrayBuffer()))

  return NextResponse.json({
    // Repo-relative, because that is what the brief cites and what an agent Reads.
    path: `${DIR}/${name}`,
    // Servable, for the widget's thumbnail.
    url: `/review-uploads/${name}`,
    name: file.name || null,
  }, { status: 201 })
}
