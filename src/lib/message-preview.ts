// One sentence for "what did they say", for every surface that isn't the thread
// itself.
//
// Why this file exists: a message can now be a PHOTO WITH NO TEXT. Every place
// that previously read `message.body` straight out of the row would render that
// as a blank line — the messages list, the trainer's thread list, the client's
// thread list, the in-app notification feed, the push notification and the
// deferred email fallback. A push notification with an empty body is the one
// people notice, and it looks like the app is broken rather than like someone
// sent a picture.
//
// So there is exactly ONE function, and every one of those surfaces calls it.
// Adding a second attachment kind later (a video, a PDF) means changing the
// label here and nowhere else.

/** What a photo-only message says when it can't say its own body. */
export const PHOTO_ONLY_PREVIEW = '📷 Photo'

/** Lock-screen length: long enough to read the gist, short enough that iOS
 *  doesn't truncate it at an awkward boundary. */
const PREVIEW_MAX = 120

export interface PreviewInput {
  /** The typed body. Empty string / null for a photo-only message. */
  body: string | null | undefined
  /** How many images ride with it. 0 for an ordinary text message. */
  attachmentCount?: number | null
}

/**
 * The one-line summary of a message.
 *
 *   text only           → the text, collapsed and clipped
 *   photo only          → "📷 Photo" / "📷 3 photos"
 *   text AND photo(s)   → "📷 the text"   (the camera earns its place because a
 *                          thread list that hides the picture reads as if there
 *                          isn't one; the words still lead, because they're
 *                          what the person actually chose to say)
 *   neither             → "" (shouldn't exist — the routes refuse it — but a
 *                          legacy row must not crash a list)
 */
export function messagePreview({ body, attachmentCount }: PreviewInput): string {
  const text = (body ?? '').trim().replace(/\s+/g, ' ')
  const photos = Math.max(0, attachmentCount ?? 0)

  if (photos === 0) return clip(text)
  if (!text) return photos === 1 ? PHOTO_ONLY_PREVIEW : `📷 ${photos} photos`
  return clip(`📷 ${text}`)
}

function clip(s: string): string {
  return s.length <= PREVIEW_MAX ? s : s.slice(0, PREVIEW_MAX - 3) + '…'
}
