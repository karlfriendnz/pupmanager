import { NextResponse } from 'next/server'
import { get } from '@vercel/blob'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessDirectThread } from '@/lib/chat-access'
import { getGroupAccess } from '@/lib/message-group-access'
import { visibleMessagesWhere } from '@/lib/message-groups'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The ONLY way to see a photo somebody sent in a chat.
//
// Chat blobs are written with `access: 'private'`, so there is no url a browser
// could fetch and no url that keeps working after the fact. This route is the
// door, and it asks the same question the thread itself asks: are you a party
// to the conversation this photo was posted into?
//
// Consequences worth being explicit about:
//
//   • A leaked link is inert. Paste it into a signed-out browser and you get a
//     404, today and in a year. That is the difference between a photo of a dog
//     and a photo of a vet's letter, and it is why the extra hop is worth it.
//   • Ownership is a JOIN, not a string comparison. The caller names an
//     attachment ID; we walk it to its message, its message to its thread, and
//     the thread to its participants. There is nothing in the request the caller
//     could tamper with to change who they are.
//   • The response says `private` in its Cache-Control, so a shared CDN never
//     holds a copy that would outlive the check.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  const { attachmentId } = await params
  const session = await auth()
  if (!session?.user?.id) return new NextResponse('Unauthorised', { status: 401 })

  const attachment = await prisma.messageAttachment.findUnique({
    where: { id: attachmentId },
    select: {
      storagePath: true,
      contentType: true,
      message: { select: { clientId: true } },
      groupMessage: { select: { id: true, groupId: true } },
    },
  })
  // Everything below answers 404 rather than 403. An id that exists but isn't
  // yours must be indistinguishable from one that doesn't, or the route becomes
  // a way to confirm that a given photo exists.
  if (!attachment) return new NextResponse('Not found', { status: 404 })

  const allowed = await mayView(session.user.id, attachment)
  if (!allowed) return new NextResponse('Not found', { status: 404 })

  const blob = await get(attachment.storagePath, { access: 'private' }).catch(err => {
    console.error('[message-images] blob read failed:', err)
    return null
  })
  if (!blob || blob.statusCode !== 200 || !blob.stream) {
    return new NextResponse('Not found', { status: 404 })
  }

  return new NextResponse(blob.stream, {
    status: 200,
    headers: {
      // The type we SNIFFED at upload, not one the uploader chose. A file that
      // is not one of the four supported images never reached the store, so
      // this can never be text/html.
      'Content-Type': attachment.contentType,
      // Private, but cacheable in the reader's own browser — a thread that
      // re-fetches every thumbnail on every scroll is unusable on mobile data.
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/**
 * The participation check, per thread kind.
 *
 * The group branch is not just "are you in the group": a BROADCAST group's
 * TRAINER_ONLY posts are one client's PRIVATE reply to the business, and the
 * other members must not be able to read them. `visibleMessagesWhere` is the
 * same predicate the group thread, its SSE stream and its unread counts use, so
 * a photo can never be visible where the message carrying it would not be.
 */
async function mayView(
  userId: string,
  attachment: {
    message: { clientId: string } | null
    groupMessage: { id: string; groupId: string } | null
  },
): Promise<boolean> {
  if (attachment.message) {
    return canAccessDirectThread(userId, attachment.message.clientId)
  }
  if (!attachment.groupMessage) return false

  const access = await getGroupAccess(attachment.groupMessage.groupId)
  if (access instanceof NextResponse) return false
  // An unaccepted COMMUNITY invitation gets an empty thread from the API; it
  // must not get the pictures either.
  if (!access.isTrainerSide && !access.participant?.joinedAt) return false

  // Re-derive visibility rather than re-implementing it, and ask about THIS
  // post — not "any post by the same sender", which would let one visible
  // message unlock a hidden one's photos.
  const visible = await prisma.groupMessage.findFirst({
    where: {
      id: attachment.groupMessage.id,
      groupId: attachment.groupMessage.groupId,
      ...visibleMessagesWhere({ userId: access.userId, isTrainerSide: access.isTrainerSide }),
    },
    select: { id: true },
  })
  return !!visible
}
