import { z } from 'zod'

// Everything the "photos in chat" feature knows about a photo, in one place, so
// the upload route, the two message-POST routes, the two SSE streams and the
// serving route cannot drift apart.
//
// The security story, stated once:
//
//  1. The BLOB IS PRIVATE. `put(..., { access: 'private' })`, so the object has
//     no publicly fetchable url at all. What we persist is the blob PATHNAME,
//     which does nothing without the store's token. This is the difference
//     between "a photo of a dog" and "a photo of the vet's letter someone
//     snapped" — the second one is why a permanent public url would have been a
//     decision made by accident.
//
//  2. THE PATH CARRIES ITS THREAD. `chat/direct/<clientId>/<uuid>.jpg` or
//     `chat/group/<groupId>/<uuid>.jpg`. The upload route only writes a path
//     after checking the caller is a participant of that thread; the message
//     POST only accepts a path whose prefix matches the thread it is posting
//     into. So the worst a participant can do is re-attach an image already
//     visible to everyone in the same conversation.
//
//  3. SIZE AND TYPE ARE DECIDED FROM THE BYTES. `File.type` is whatever the
//     browser (or curl) said. We sniff the magic bytes and refuse anything that
//     isn't one of the four formats a chat bubble can actually render.

// ─── Limits ──────────────────────────────────────────────────────────────────

/**
 * 5 MB per image, AFTER compressImageFile() has run in the browser (which
 * targets ~2 MB / 2048px). The ceiling is not the storage cost, it is Vercel's
 * ~4.5 MB serverless request body — a raw 12 MP phone photo clears that on its
 * own and the upload dies with an opaque 413. The composer compresses first;
 * this is the check that means it had to.
 */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024

/** Four per message. More than that is an album, and an album is not a chat. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 4

/**
 * Formats a bubble can render. HEIC/HEIF are deliberately ABSENT: Chrome and
 * Android cannot decode them, so one would upload happily and then show as a
 * broken image for half the recipients. compressImageFile() converts a
 * decodable HEIC to JPEG before it gets here; an undecodable one is refused
 * with a message that says so.
 */
export const ALLOWED_ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
export type AllowedAttachmentType = (typeof ALLOWED_ATTACHMENT_TYPES)[number]

/** Layout hints are clamped to something a real photo could be. */
const MAX_DIMENSION = 20_000

// ─── Sniffing ────────────────────────────────────────────────────────────────

/**
 * What is this file, REALLY?
 *
 * "Validation in the browser is not validation" (AGENTS.md #3). `file.type` is
 * a string the caller chose; a `.jpg` label on an HTML document is a stored-XSS
 * attempt waiting for something to serve it back with the wrong Content-Type.
 * The serving route answers with the type this function returned, so a file
 * that isn't one of the four never gets a Content-Type that a browser would
 * execute.
 *
 * Returns null when the bytes are not a supported image.
 */
export function sniffImageType(bytes: Uint8Array): AllowedAttachmentType | null {
  const at = (i: number) => bytes[i]
  // JPEG — FF D8 FF
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg'
  // PNG — 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 &&
    at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a
  ) return 'image/png'
  // GIF — "GIF87a" / "GIF89a"
  if (
    bytes.length >= 6 &&
    at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38 &&
    (at(4) === 0x37 || at(4) === 0x39) && at(5) === 0x61
  ) return 'image/gif'
  // WEBP — "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) return 'image/webp'
  return null
}

// ─── Paths ───────────────────────────────────────────────────────────────────

export type ChatScope =
  | { kind: 'direct'; clientId: string }
  | { kind: 'group'; groupId: string }

/** The one place a chat blob path is constructed. */
export function attachmentPathPrefix(scope: ChatScope): string {
  return scope.kind === 'direct'
    ? `chat/direct/${scope.clientId}/`
    : `chat/group/${scope.groupId}/`
}

/**
 * A path this thread is allowed to attach.
 *
 * The uuid is what makes it unguessable (122 bits of randomness), but note that
 * unguessability is NOT the control here — the blob is private, so even the
 * exact path fetches nothing without the store token. The uuid's job is just to
 * stop two uploads colliding.
 */
export function buildAttachmentPath(scope: ChatScope, contentType: AllowedAttachmentType): string {
  const ext =
    contentType === 'image/png' ? 'png'
    : contentType === 'image/webp' ? 'webp'
    : contentType === 'image/gif' ? 'gif'
    : 'jpg'
  return `${attachmentPathPrefix(scope)}${crypto.randomUUID()}.${ext}`
}

/**
 * Does this path belong to this thread?
 *
 * Called by the message-POST routes on every path the caller hands back. The
 * upload route already proved the caller could write into this prefix; this
 * proves they are not now stapling it onto a DIFFERENT conversation.
 */
export function pathBelongsToScope(path: string, scope: ChatScope): boolean {
  const prefix = attachmentPathPrefix(scope)
  if (!path.startsWith(prefix)) return false
  // Nothing may climb back out of its own folder.
  const rest = path.slice(prefix.length)
  return rest.length > 0 && !rest.includes('/') && !rest.includes('..')
}

// ─── The wire shape ──────────────────────────────────────────────────────────

/** What the upload route hands back, and what a message POST accepts. */
export const attachmentRefSchema = z.object({
  path: z.string().min(1).max(300),
  contentType: z.enum(ALLOWED_ATTACHMENT_TYPES),
  sizeBytes: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
  width: z.number().int().positive().max(MAX_DIMENSION).optional(),
  height: z.number().int().positive().max(MAX_DIMENSION).optional(),
  /**
   * Which access the blob was actually written with, echoed back from the
   * upload route. It is only ever used to tell `get()` how to read the object,
   * so a caller who lies about it breaks nothing but their own image — it
   * grants no access and reveals nothing. Defaults to the conservative value
   * for a caller that omits it.
   */
  access: z.enum(['private', 'public']).default('public'),
})
export type AttachmentRef = z.infer<typeof attachmentRefSchema>

export const attachmentRefsSchema = z
  .array(attachmentRefSchema)
  .max(MAX_ATTACHMENTS_PER_MESSAGE)
  .optional()

/**
 * Turn accepted refs into `createMany`-shaped rows, dropping any whose path
 * doesn't belong to this thread. Returns null when something was rejected, so
 * the caller can 400 rather than quietly sending a message with fewer photos
 * than the sender picked.
 */
export function attachmentCreateRows(
  refs: AttachmentRef[] | undefined,
  scope: ChatScope,
): { ok: true; rows: AttachmentCreateRow[] } | { ok: false } {
  if (!refs || refs.length === 0) return { ok: true, rows: [] }
  if (refs.some(r => !pathBelongsToScope(r.path, scope))) return { ok: false }
  return {
    ok: true,
    rows: refs.map((r, i) => ({
      storagePath: r.path,
      storageAccess: r.access ?? 'public',
      contentType: r.contentType,
      sizeBytes: r.sizeBytes,
      width: r.width ?? null,
      height: r.height ?? null,
      position: i,
    })),
  }
}

export interface AttachmentCreateRow {
  storagePath: string
  storageAccess: string
  contentType: string
  sizeBytes: number
  width: number | null
  height: number | null
  position: number
}

// ─── The read shape ──────────────────────────────────────────────────────────

/**
 * What a thread payload carries per photo. Deliberately NOT the storage path:
 * "props on a 'use client' component are page source" (AGENTS.md #5), and the
 * browser has no use for it — every image is fetched by id through the
 * authorising route. Sending the path would publish the one string the serving
 * route uses internally to every reader of the page.
 */
export interface ChatAttachmentDto {
  id: string
  url: string
  width: number | null
  height: number | null
}

/** The `select` every thread query uses, so they all return the same fields. */
export const CHAT_ATTACHMENT_SELECT = {
  id: true,
  width: true,
  height: true,
  position: true,
} as const

export function toChatAttachments(
  rows: { id: string; width: number | null; height: number | null; position: number }[] | undefined | null,
): ChatAttachmentDto[] {
  if (!rows || rows.length === 0) return []
  return [...rows]
    .sort((a, b) => a.position - b.position)
    .map(r => ({ id: r.id, url: `/api/message-images/${r.id}`, width: r.width, height: r.height }))
}
