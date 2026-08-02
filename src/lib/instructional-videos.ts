// The trainer's instructional videos on one exercise — the library item, and
// the homework snapshot taken from it.
//
// ── Why a list, and why a Json column ───────────────────────────────────────
// One exercise is usually several short clips ("Step 1 — approach", "Step 2 —
// reward"), which teaches better than one long take and keeps each file small
// enough to upload and play on mobile data. Homework is a SNAPSHOT of the item,
// so the videos have to copy across at hand-out time — with a Json array that
// is one assignment, where child rows would be N inserts to keep in step with
// the copy of the title and description sitting beside them. TrainingTask
// already carries `imageUrls` this way.
//
// ── The videoUrl column ─────────────────────────────────────────────────────
// Both models keep their original single `videoUrl`. Plenty of readers still
// select it — the session screen, templates, default homework, the client's
// task page — so every write sets it to the FIRST video rather than dropping
// it. Nothing breaks while the list spreads; `videoUrl` retires when nothing
// reads it.
//
// ── The URL rule ────────────────────────────────────────────────────────────
// These land in <video src> and <a href>, and a trainer types them, so they are
// pinned to http(s). `javascript:` passes a naive URL check and would run in
// the client's app.

export interface InstructionalVideo {
  url: string
  /** What this clip shows. Optional — the UI falls back to "Video 1". */
  title?: string
  /**
   * These are rows in a Json column, and Prisma's `InputJsonValue` only accepts
   * objects that declare an index signature. Without it every write needs an
   * `as unknown as` at the call site, which is a cast this shape doesn't
   * deserve — it really is a plain string record.
   */
  [key: string]: string | undefined
}

/** More than this on one exercise isn't a lesson, it's a playlist. */
export const MAX_VIDEOS = 10
const MAX_TITLE = 80

function isWebUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Clean a list of videos coming from anywhere untrusted — a request body, or a
 * Json column written before these rules existed.
 *
 * Drops anything that isn't a usable http(s) video rather than throwing: a
 * malformed entry should cost the trainer that one clip, not the whole save.
 */
export function sanitizeVideos(input: unknown): InstructionalVideo[] {
  if (!Array.isArray(input)) return []
  const out: InstructionalVideo[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (out.length >= MAX_VIDEOS) break
    const url = typeof raw === 'string' ? raw : (raw as { url?: unknown })?.url
    if (!isWebUrl(url)) continue
    // The same clip twice is always a mistake, and it would give a client the
    // same step to watch twice.
    if (seen.has(url)) continue
    seen.add(url)
    const rawTitle = typeof raw === 'object' && raw !== null ? (raw as { title?: unknown }).title : undefined
    const title = typeof rawTitle === 'string' ? rawTitle.trim().slice(0, MAX_TITLE) : ''
    out.push(title ? { url, title } : { url })
  }
  return out
}

/**
 * The videos on a row, whichever era it was saved in.
 *
 * An item saved before the list existed has only `videoUrl`, and it must still
 * show its video — so the single column is the fallback, not an afterthought.
 */
export function readVideos(row: { videos?: unknown; videoUrl?: string | null } | null | undefined): InstructionalVideo[] {
  if (!row) return []
  const list = sanitizeVideos(row.videos)
  if (list.length > 0) return list
  return isWebUrl(row.videoUrl) ? [{ url: row.videoUrl }] : []
}

/**
 * What to write for a given list — BOTH columns, every time.
 *
 * Always spread into the update/create data so the two can never disagree:
 *   data: { title, ...videoColumns(videos) }
 */
export function videoColumns(list: InstructionalVideo[]): { videos: InstructionalVideo[]; videoUrl: string | null } {
  const videos = sanitizeVideos(list)
  return { videos, videoUrl: videos[0]?.url ?? null }
}

/** What to call a clip with no title of its own. */
export function videoLabel(video: InstructionalVideo, index: number): string {
  return video.title?.trim() || `Video ${index + 1}`
}
