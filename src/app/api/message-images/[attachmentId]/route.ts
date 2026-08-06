import { NextResponse } from 'next/server'
import { get } from '@vercel/blob'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessDirectThread } from '@/lib/chat-access'
import { getGroupAccess } from '@/lib/message-group-access'
import { visibleMessagesWhere } from '@/lib/message-groups'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The ONLY url the app ever emits for a photo somebody sent in a chat.
//
// This route is the door, and it asks the same question the thread itself asks:
// are you a party to the conversation this photo was posted into?
//
//   • A LEAKED /api/message-images/<id> LINK IS INERT. Paste it into a
//     signed-out browser and you get a 404, today and in a year. Ownership is a
//     JOIN, not a string comparison — the caller names an attachment id, and we
//     walk it to its message, its message to its thread, and the thread to its
//     participants. Nothing in the request can change who they are.
//   • The response says `private` in its Cache-Control, so a shared CDN never
//     holds a copy that would outlive the check.
//
// The remaining gap, stated plainly rather than left to be discovered: the
// upload route asks for `access: 'private'` but this app's Blob store is a
// PUBLIC store, which refuses private objects. So the underlying blob url does
// exist. It is never stored in a payload, never rendered, and never handed to a
// browser — the only way to learn it is to already know the exact 122-bit uuid
// path — but it is not revocable the way a private object is. Closing that is a
// one-off store change, not a code change: see writeChatBlob in
// /api/upload/image.

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
      storageAccess: true,
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

  // The mode the object was actually written with — see the upload route for
  // why that is not always 'private'.
  const access = attachment.storageAccess === 'private' ? 'private' as const : 'public' as const
  const blob = await get(attachment.storagePath, { access }).catch(err => {
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
