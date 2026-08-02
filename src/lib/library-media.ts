// Everything hanging off one library item, as ONE ordered list.
//
// ── Why one list ────────────────────────────────────────────────────────────
// The item used to carry a picture, a handout and a list of videos as three
// separate columns with three separate controls. They are the same job — "the
// stuff a client looks at while they do this exercise" — laid out three
// different ways, and the shape made a second handout impossible to attach and
// gave the trainer no say in what a client meets first. A row is a row: it has
// a kind, a URL, a name, and a place in the order.
//
// ── Why a Json column and not a child table ─────────────────────────────────
// Nothing in this app ever asks a question OF a media row. There is no "find
// every video in the library", no filter, no join, no page of them — every read
// is `libraryTask.findFirst(...)` followed by rendering the whole list, and
// every write is the editor replacing the whole list in one PATCH. A child
// table buys foreign keys and per-row queries we would not use, and charges an
// `order` column to renumber on every drag plus a create/update/delete diff on
// every save.
//
// The decider is the SNAPSHOT. Homework (TrainingTask) is a copy of the library
// item taken at hand-out time, so the media has to copy across with the title
// sitting beside it. As a Json column that is one assignment; as child rows it
// is N inserts into a second child table, per client, on every one of the paths
// that hand an item out. TrainingTask already carries `videos` and `imageUrls`
// this way for exactly that reason.
//
// ── The old columns are still written ───────────────────────────────────────
// `videoUrl`, `videos`, `imageUrl`, `fileUrl` and `fileName` all remain, and
// `mediaColumns()` writes every one of them from the list on every save. The
// default-homework builder, the offering's suggestion list, the demo seed and
// the assign path all still select them; a column dropped from under a reader
// is a silent blank on a client's screen, which is exactly the failure this
// change exists to stop. They are DERIVED now — first image, first document,
// videos in order — and nothing writes them directly.

import { readVideos, type InstructionalVideo } from '@/lib/instructional-videos'

export const MEDIA_KINDS = ['image', 'video', 'document', 'link'] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

export interface MediaItem {
  kind: MediaKind
  url: string
  /** What this row shows. Optional — the UI falls back to "Video 1", "Image 2". */
  title?: string
  /** A document's original filename, for the download link's label. */
  fileName?: string
  /**
   * Rows in a Json column, and Prisma's `InputJsonValue` only accepts objects
   * that declare an index signature. Without it every write needs an
   * `as unknown as` at the call site. It really is a plain string record.
   */
  [key: string]: string | undefined
}

/** More than this on one exercise isn't a lesson, it's a folder. */
export const MAX_MEDIA = 20
const MAX_TITLE = 80
const MAX_FILENAME = 255

function isWebUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function isMediaKind(value: unknown): value is MediaKind {
  return typeof value === 'string' && (MEDIA_KINDS as readonly string[]).includes(value)
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/**
 * Guess a row's kind from its URL, for anything that arrives without one.
 *
 * Only ever a fallback — the editor always states the kind, because a trainer
 * pasting a Loom link knows it is a video and a file extension does not.
 */
export function guessKind(url: string): MediaKind {
  if (/\.(mp4|webm|mov|m4v|ogg)(\?|$)/i.test(url)) return 'video'
  if (/\.(jpe?g|png|webp|gif|avif|heic|heif)(\?|$)/i.test(url)) return 'image'
  if (/\.(pdf|docx?|pptx?|xlsx?)(\?|$)/i.test(url)) return 'document'
  let host = ''
  try { host = new URL(url).hostname.replace(/^www\./, '') } catch { /* not a URL — it's a link */ }
  if (/^(youtube\.com|m\.youtube\.com|youtu\.be|vimeo\.com|loom\.com)$/i.test(host)) return 'video'
  return 'link'
}

/**
 * Clean a list coming from anywhere untrusted — a request body, or a Json
 * column written before these rules existed.
 *
 * Drops a bad row rather than throwing: a malformed entry should cost the
 * trainer that one attachment, not the whole save. Every URL is pinned to
 * http(s) because these land in `<img src>`, `<video src>` and `<a href>` on a
 * client's screen, and `javascript:` passes a naive URL check.
 */
export function sanitizeMedia(input: unknown): MediaItem[] {
  if (!Array.isArray(input)) return []
  const out: MediaItem[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (out.length >= MAX_MEDIA) break
    const row = typeof raw === 'string' ? { url: raw } : (raw as Record<string, unknown> | null)
    if (!row) continue
    const url = row.url
    if (!isWebUrl(url)) continue
    // The same file twice is always a mistake, and it would give a client the
    // same step to watch twice.
    if (seen.has(url)) continue
    seen.add(url)

    const item: MediaItem = {
      kind: isMediaKind(row.kind) ? row.kind : guessKind(url),
      url,
    }
    const title = text(row.title, MAX_TITLE)
    if (title) item.title = title
    const fileName = text(row.fileName, MAX_FILENAME)
    if (fileName) item.fileName = fileName
    out.push(item)
  }
  return out
}

/**
 * The media on a row, whichever era it was saved in.
 *
 * A row saved before the list existed has only the single columns, and it must
 * still show everything it had — so the fallback is not an afterthought, it is
 * the whole reason this function exists. The order it builds — videos, then the
 * picture, then the handout — is the left-to-right order those three controls
 * sat in on the item screen, so an item a trainer already knows comes back
 * looking the way they left it.
 */
export function readMedia(
  row:
    | {
        media?: unknown
        videos?: unknown
        videoUrl?: string | null
        imageUrl?: string | null
        imageUrls?: unknown
        fileUrl?: string | null
        fileName?: string | null
      }
    | null
    | undefined,
): MediaItem[] {
  if (!row) return []
  const stored = sanitizeMedia(row.media)
  if (stored.length > 0) return stored
  return sanitizeMedia(legacyRows(row))
}

/** The old columns, read as media rows. Exported so the backfill uses one rule. */
export function legacyRows(row: {
  videos?: unknown
  videoUrl?: string | null
  imageUrl?: string | null
  imageUrls?: unknown
  fileUrl?: string | null
  fileName?: string | null
}): MediaItem[] {
  const out: MediaItem[] = []
  for (const v of readVideos(row)) {
    out.push(v.title ? { kind: 'video', url: v.url, title: v.title } : { kind: 'video', url: v.url })
  }
  // LibraryTask holds one picture; TrainingTask holds a list of them. Both feed
  // the same shape so one backfill covers both models.
  const images = [
    ...(typeof row.imageUrl === 'string' ? [row.imageUrl] : []),
    ...(Array.isArray(row.imageUrls) ? row.imageUrls.filter((u): u is string => typeof u === 'string') : []),
  ]
  for (const url of images) out.push({ kind: 'image', url })
  if (typeof row.fileUrl === 'string' && row.fileUrl) {
    out.push(
      row.fileName
        ? { kind: 'document', url: row.fileUrl, fileName: row.fileName }
        : { kind: 'document', url: row.fileUrl },
    )
  }
  return out
}

/** Just the videos, for the readers that only ever wanted those. */
export function mediaVideos(list: MediaItem[]): InstructionalVideo[] {
  return list
    .filter(m => m.kind === 'video')
    .map(m => (m.title ? { url: m.url, title: m.title } : { url: m.url }))
}

/**
 * What to write for a given list — the list AND every column derived from it,
 * every time.
 *
 * Always spread into the create/update data so the derived columns can never
 * disagree with the list:  `data: { title, ...mediaColumns(media) }`
 *
 * The FIRST image is the item's picture and the FIRST document is its handout.
 * That makes "the cover" a consequence of the order the trainer already drags
 * into, rather than a checkbox on a row asking them to say the same thing
 * twice — and it means a reorder changes the thumbnail, which is what dragging
 * something to the top is meant to mean.
 */
export function mediaColumns(list: MediaItem[]): {
  media: MediaItem[]
  videos: InstructionalVideo[]
  videoUrl: string | null
  imageUrl: string | null
  fileUrl: string | null
  fileName: string | null
} {
  const media = sanitizeMedia(list)
  const videos = mediaVideos(media)
  const firstImage = media.find(m => m.kind === 'image') ?? null
  const firstDoc = media.find(m => m.kind === 'document') ?? null
  return {
    media,
    videos,
    videoUrl: videos[0]?.url ?? null,
    imageUrl: firstImage?.url ?? null,
    fileUrl: firstDoc?.url ?? null,
    fileName: firstDoc?.fileName ?? null,
  }
}

/**
 * The same, for a homework snapshot. TrainingTask has no handout column and
 * keeps its images as a LIST, so the shape differs — but the rule is the same:
 * one function writes the list and everything derived from it.
 */
export function homeworkMediaColumns(list: MediaItem[]): {
  media: MediaItem[]
  videos: InstructionalVideo[]
  videoUrl: string | null
  imageUrls: string[]
} {
  const media = sanitizeMedia(list)
  const videos = mediaVideos(media)
  return {
    media,
    videos,
    videoUrl: videos[0]?.url ?? null,
    imageUrls: media.filter(m => m.kind === 'image').map(m => m.url),
  }
}

const KIND_NOUN: Record<MediaKind, string> = {
  image: 'Image',
  video: 'Video',
  document: 'Document',
  link: 'Link',
}

/**
 * What to call a row with no name of its own.
 *
 * Numbered WITHIN its kind — "Video 2" next to "Image 1" reads as the second
 * clip, which is what a trainer means, where numbering across the whole list
 * would call it "Item 4" and tell nobody anything.
 */
export function mediaLabel(list: MediaItem[], index: number): string {
  const item = list[index]
  if (!item) return ''
  if (item.title?.trim()) return item.title.trim()
  if (item.kind === 'document' && item.fileName) return item.fileName
  const nth = list.slice(0, index + 1).filter(m => m.kind === item.kind).length
  return `${KIND_NOUN[item.kind]} ${nth}`
}
