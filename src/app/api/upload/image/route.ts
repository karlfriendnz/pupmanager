import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { put } from '@vercel/blob'
import crypto from 'crypto'
import { getGroupAccess, canPost } from '@/lib/message-group-access'
import { canAccessDirectThread } from '@/lib/chat-access'
import {
  MAX_ATTACHMENT_BYTES,
  buildAttachmentPath,
  sniffImageType,
  type ChatScope,
} from '@/lib/message-attachments'

// THE image upload route. Two callers, two authorisation stories, one blob
// write — which is the whole reason chat photos were added here rather than in
// a route of their own.
//
//   • default (`target` absent) — a TRAINER uploading into their own business:
//     session images, product shots, branding. Public blob, trainer-scoped
//     path. Unchanged.
//
//   • `target=chat` — a photo for a message thread. The caller may be a
//     TRAINER **or a CLIENT**, which is exactly why the old `role !== 'TRAINER'`
//     guard at the top of this file could not simply be reused: a dog owner
//     sending a picture of a rash is not a trainer and never will be. So the
//     check is not "what role are you", it is "are you a party to THIS thread".
//     Private blob, thread-scoped path.
//
// The 4.5 MB serverless request-body cap applies to both. compressImageFile()
// runs in the browser before either.

const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB per image (trainer uploads)
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Missing file' }, { status: 400 })

  if (formData.get('target') === 'chat') {
    return uploadChatPhoto({
      userId: session.user.id,
      file,
      clientId: (formData.get('clientId') as string | null) ?? null,
      groupId: (formData.get('groupId') as string | null) ?? null,
    })
  }

  // ── Trainer-scoped upload (unchanged behaviour) ────────────────────────────
  if (session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  // Defence in depth — make sure the trainerId on the session is real.
  const owns = await prisma.trainerProfile.findUnique({ where: { id: trainerId }, select: { id: true } })
  if (!owns) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  // Caller-supplied context: only used as path scoping, never trusted.
  const sessionId = (formData.get('sessionId') as string | null) ?? 'misc'
  const taskId = (formData.get('taskId') as string | null) ?? null

  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: 'Image too large (max 10 MB)' }, { status: 413 })
  }
  if (file.type && !ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: `Unsupported image type: ${file.type}` }, { status: 415 })
  }

  // trainer-images/<trainerId>/<sessionId>/<taskId|inline>/<uuid>.<ext>
  const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
  const safeExt = ext.length > 0 && ext.length <= 5 ? ext : 'jpg'
  const subdir = taskId ?? 'inline'
  const pathname = `trainer-images/${trainerId}/${sessionId}/${subdir}/${crypto.randomUUID()}.${safeExt}`

  try {
    // `addRandomSuffix: false` keeps the path exactly as constructed — our
    // UUID already guarantees uniqueness and we want predictable URLs.
    const blob = await put(pathname, file, {
      access: 'public',
      addRandomSuffix: false,
      contentType: file.type || 'image/jpeg',
    })
    return NextResponse.json({ url: blob.url })
  } catch (err) {
    // Real cause goes to the server logs; keep the client message honest (the
    // Blob store is connected — the old "not connected" copy misled triage).
    console.error('Blob upload failed:', err)
    return NextResponse.json(
      { error: 'Upload failed — please try again, or use a smaller image.' },
      { status: 502 },
    )
  }
}

/**
 * A photo destined for a chat thread.
 *
 * Order matters here and each step is doing real work:
 *
 *  1. RESOLVE THE THREAD FROM ITS OWN ID, not from anything else in the body.
 *     There is no `messageId` and no free-form path in this contract — the only
 *     things the caller may name are a clientId or a groupId, and both are
 *     immediately checked against the signed-in user.
 *  2. PROVE PARTICIPATION. A client posting into another client's thread, or a
 *     trainer reaching into another business's, dies here with a 404 — the same
 *     answer an id that doesn't exist gets, so probing tells you nothing.
 *  3. DECIDE THE TYPE FROM THE BYTES. `file.type` is a claim; the magic bytes
 *     are the fact, and the serving route later answers with the sniffed value.
 *  4. WRITE IT PRIVATE. See lib/message-attachments for why.
 */
async function uploadChatPhoto({
  userId,
  file,
  clientId,
  groupId,
}: {
  userId: string
  file: File
  clientId: string | null
  groupId: string | null
}): Promise<NextResponse> {
  // Exactly one thread, named exactly once.
  if ((clientId && groupId) || (!clientId && !groupId)) {
    return NextResponse.json({ error: 'Name one thread' }, { status: 400 })
  }

  let scope: ChatScope
  if (clientId) {
    const allowed = await canAccessDirectThread(userId, clientId)
    if (!allowed) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    scope = { kind: 'direct', clientId }
  } else {
    const access = await getGroupAccess(groupId!)
    // getGroupAccess answers 401/404 itself, and a group from another business
    // already looks like it does not exist.
    if (access instanceof NextResponse) return access
    // Uploading a photo is the first half of posting one. Someone who may not
    // post — an unaccepted COMMUNITY invitation, an archived group — must not
    // be able to put bytes in the store either.
    if (!canPost(access)) {
      return NextResponse.json({ error: 'You cannot post in this group.' }, { status: 403 })
    }
    scope = { kind: 'group', groupId: groupId! }
  }

  // Size, from the bytes we were actually handed. The browser compresses first
  // (compressImageFile), so anything arriving over the cap either skipped the
  // composer or failed to compress — both are refusals, not warnings.
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json(
      { error: 'That photo is too large. Please try a smaller one.' },
      { status: 413 },
    )
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'That file is empty.' }, { status: 400 })
  }

  const buffer = new Uint8Array(await file.arrayBuffer())
  const contentType = sniffImageType(buffer)
  if (!contentType) {
    return NextResponse.json(
      { error: 'That file is not a photo we can show. Try a JPEG, PNG, GIF or WebP.' },
      { status: 415 },
    )
  }

  const pathname = buildAttachmentPath(scope, contentType)

  const written = await writeChatBlob(pathname, Buffer.from(buffer), contentType)
  if (!written) {
    return NextResponse.json(
      { error: 'Upload failed — please try again.' },
      { status: 502 },
    )
  }

  // The PATH goes back to the sender so they can hand it to the message POST.
  // It is worthless to anyone else: the POST refuses a path that doesn't belong
  // to the thread being posted into, and nothing in the app ever turns a path
  // back into a blob url.
  return NextResponse.json({
    path: pathname,
    contentType,
    sizeBytes: file.size,
    access: written,
  })
}

/**
 * Write the photo, as privately as this Blob store will allow.
 *
 * A Vercel Blob store is public OR private for its entire life; there is no
 * per-object choice on a public store, and asking for one is refused outright:
 *
 *   "Vercel Blob: Cannot use private access on a public store."
 *
 * Private is what a chat photo wants — the difference between a picture of a
 * dog and the vet's letter someone snapped in the same conversation. So we ASK
 * for it every time, and this is the ONE place that knows we didn't get it.
 * The fallback is deliberately loud and recorded per row rather than silent:
 *
 *   • it logs, once per upload, with the reason;
 *   • the mode is stored on the attachment, so `get()` uses the right one and
 *     old rows keep resolving if the store is ever switched;
 *   • the moment the store IS private, this starts returning 'private' with no
 *     code change at all.
 *
 * What does NOT change with the fallback: the blob url is never stored, never
 * sent to a browser and never rendered. Every photo is fetched through
 * /api/message-images/<id>, which re-checks that the caller is a party to the
 * conversation. On a public store that url still EXISTS and would work for
 * anyone who somehow learned the exact path — 122 bits of uuid that the app
 * never emits — so it is weaker than a private store, and the difference is
 * worth closing. It is not, however, the "public url pasted into the page"
 * that the rest of this app's images are.
 */
async function writeChatBlob(
  pathname: string,
  body: Buffer,
  contentType: string,
): Promise<'private' | 'public' | null> {
  try {
    await put(pathname, body, { access: 'private', addRandomSuffix: false, contentType })
    return 'private'
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!/private access on a public store/i.test(message)) {
      console.error('[chat photo upload] blob write failed:', err)
      return null
    }
    console.warn(
      '[chat photo upload] this Blob store is PUBLIC, so the photo was written public. ' +
      'The app never emits its url — every read goes through /api/message-images/<id> — ' +
      'but a private store is the stronger answer. To get one: create a Blob store with ' +
      'private access and point BLOB_READ_WRITE_TOKEN at it; this code then needs no change.',
    )
  }

  try {
    await put(pathname, body, { access: 'public', addRandomSuffix: false, contentType })
    return 'public'
  } catch (err) {
    console.error('[chat photo upload] blob write failed:', err)
    return null
  }
}
