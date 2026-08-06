import { describe, it, expect, vi, beforeEach } from 'vitest'

// Photos in chat, at the routes.
//
// Four things have to be true, and none of them is enforced by the browser:
//   1. only a PARTY TO THE THREAD may upload into it;
//   2. size and type are decided server-side from the bytes;
//   3. a message may not attach a photo belonging to another conversation;
//   4. a photo is only served to someone who may read the message carrying it.
//
// Prisma is mocked; lib/chat-access runs for REAL against it, so the ownership
// rule under test is the one the app actually uses rather than a restatement.

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  guardPermission: vi.fn(),
  put: vi.fn(),
  blobGet: vi.fn(),
  getGroupAccess: vi.fn(),
  trainerFindUnique: vi.fn(),
  clientFindFirst: vi.fn(),
  shareFindFirst: vi.fn(),
  messageCreate: vi.fn(),
  attachmentFindUnique: vi.fn(),
  groupMessageFindFirst: vi.fn(),
  safeEvaluate: vi.fn(),
  notifyMessageRecipient: vi.fn(),
  /** Whatever the route deferred with `after()`, so a test can await it. */
  deferred: [] as Promise<unknown>[],
}))

// Run the deferred work rather than dropping it — the notification preview is
// exactly what happens inside `after()`, and it is the thing under test.
vi.mock('next/server', async orig => ({
  ...(await orig() as object),
  after: (fn: () => unknown) => { h.deferred.push(Promise.resolve(fn())) },
}))
vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@vercel/blob', () => ({ put: h.put, get: h.blobGet }))
vi.mock('@/lib/message-group-access', () => ({
  getGroupAccess: h.getGroupAccess,
  canPost: (a: { archivedAt?: unknown; isTrainerSide?: boolean; participant?: { joinedAt?: unknown } }) =>
    !a.archivedAt && (!!a.isTrainerSide || !!a.participant?.joinedAt),
}))
vi.mock('@/lib/achievements', () => ({ safeEvaluate: h.safeEvaluate }))
vi.mock('@/lib/notify-message-recipient', () => ({ notifyMessageRecipient: h.notifyMessageRecipient }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: { findUnique: h.trainerFindUnique },
    clientProfile: { findFirst: h.clientFindFirst },
    clientShare: { findFirst: h.shareFindFirst },
    message: { create: h.messageCreate, findMany: vi.fn(), updateMany: vi.fn() },
    messageAttachment: { findUnique: h.attachmentFindUnique },
    groupMessage: { findFirst: h.groupMessageFindFirst },
  },
}))

import { POST as uploadPOST } from '@/app/api/upload/image/route'
import { POST as messagePOST } from '@/app/api/messages/route'
import { GET as imageGET } from '@/app/api/message-images/[attachmentId]/route'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const OWNER_CLIENT = 'cl_1'
const STRANGER_CLIENT = 'cl_other'

const CLIENT_SESSION = { user: { id: 'u_client', role: 'CLIENT' } }
const TRAINER_SESSION = { user: { id: 'u_trainer', role: 'TRAINER', trainerId: 'co1' } }

/** A 1x1-ish JPEG: the magic bytes are what the sniffer reads. */
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
const HTML_BYTES = new TextEncoder().encode('<!DOCTYPE html><script>alert(1)</script>')

function chatUpload(bytes: Uint8Array, over: Record<string, string> = {}, name = 'photo.jpg') {
  const form = new FormData()
  form.append('file', new File([bytes as unknown as BlobPart], name, { type: 'image/jpeg' }))
  form.append('target', 'chat')
  for (const [k, v] of Object.entries(over)) form.append(k, v)
  return new Request('https://app.pupmanager.com/api/upload/image', { method: 'POST', body: form })
}

const jsonReq = (body: unknown) =>
  new Request('https://app.pupmanager.com/api/messages', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

/**
 * Wire the mocked prisma so `u_client` owns OWNER_CLIENT and nothing else.
 * chat-access runs for real over this.
 */
function clientOwnsOnlyTheirThread() {
  h.trainerFindUnique.mockResolvedValue(null) // not a trainer
  h.shareFindFirst.mockResolvedValue(null)
  h.clientFindFirst.mockImplementation(async (args: { where: { id: string; userId?: string } }) =>
    args.where.id === OWNER_CLIENT && (!args.where.userId || args.where.userId === 'u_client')
      ? { id: OWNER_CLIENT }
      : null,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.deferred.length = 0
  h.guardPermission.mockResolvedValue(undefined)
  h.put.mockResolvedValue({ url: 'https://blob.invalid/x' })
})

/** Let anything the route handed to `after()` finish. */
const settleDeferred = () => Promise.all(h.deferred)

// ─── 1 · Only a party to the thread may upload ───────────────────────────────

describe('upload — a stranger cannot attach to someone else\'s thread', () => {
  it('lets the client upload into their OWN thread', async () => {
    h.auth.mockResolvedValue(CLIENT_SESSION)
    clientOwnsOnlyTheirThread()

    const res = await uploadPOST(chatUpload(JPEG_BYTES, { clientId: OWNER_CLIENT }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.path).toMatch(new RegExp(`^chat/direct/${OWNER_CLIENT}/`))
    expect(h.put).toHaveBeenCalledTimes(1)
  })

  it('REFUSES a client uploading into another client\'s thread', async () => {
    h.auth.mockResolvedValue(CLIENT_SESSION)
    clientOwnsOnlyTheirThread()

    const res = await uploadPOST(chatUpload(JPEG_BYTES, { clientId: STRANGER_CLIENT }))
    // 404, not 403 — an id that isn't yours looks like one that doesn't exist.
    expect(res.status).toBe(404)
    expect(h.put).not.toHaveBeenCalled()
  })

  it('REFUSES a trainer reaching into another business\'s thread', async () => {
    h.auth.mockResolvedValue(TRAINER_SESSION)
    h.trainerFindUnique.mockResolvedValue({ id: 'co1' })
    h.clientFindFirst.mockResolvedValue(null) // not theirs
    h.shareFindFirst.mockResolvedValue(null)  // not shared with them either

    const res = await uploadPOST(chatUpload(JPEG_BYTES, { clientId: STRANGER_CLIENT }))
    expect(res.status).toBe(404)
    expect(h.put).not.toHaveBeenCalled()
  })

  it('refuses a signed-out caller outright', async () => {
    h.auth.mockResolvedValue(null)
    const res = await uploadPOST(chatUpload(JPEG_BYTES, { clientId: OWNER_CLIENT }))
    expect(res.status).toBe(401)
    expect(h.put).not.toHaveBeenCalled()
  })

  it('refuses a request that names both a thread and a group, or neither', async () => {
    h.auth.mockResolvedValue(CLIENT_SESSION)
    clientOwnsOnlyTheirThread()

    expect((await uploadPOST(chatUpload(JPEG_BYTES, { clientId: OWNER_CLIENT, groupId: 'g1' }))).status).toBe(400)
    expect((await uploadPOST(chatUpload(JPEG_BYTES))).status).toBe(400)
    expect(h.put).not.toHaveBeenCalled()
  })

  it('refuses a group member who has not accepted the invitation', async () => {
    h.auth.mockResolvedValue(CLIENT_SESSION)
    h.getGroupAccess.mockResolvedValue({
      userId: 'u_client', groupId: 'g1', trainerId: 'co1', mode: 'COMMUNITY',
      isTrainerSide: false, archivedAt: null,
      participant: { id: 'p1', role: 'CLIENT', displayName: 'Sam', joinedAt: null, lastReadAt: null },
    })
    const res = await uploadPOST(chatUpload(JPEG_BYTES, { groupId: 'g1' }))
    expect(res.status).toBe(403)
    expect(h.put).not.toHaveBeenCalled()
  })

  it('ASKS for a private blob every time', async () => {
    h.auth.mockResolvedValue(CLIENT_SESSION)
    clientOwnsOnlyTheirThread()

    const res = await uploadPOST(chatUpload(JPEG_BYTES, { clientId: OWNER_CLIENT }))
    expect(h.put.mock.calls[0][2]).toMatchObject({ access: 'private' })
    expect((await res.json()).access).toBe('private')
  })

  it('falls back to public ONLY on a public store, and says so per row', async () => {
    // A Vercel Blob store is public or private for its whole life. Asking for a
    // private object on a public one is refused outright, and 502ing every chat
    // photo because of it would be worse than the weaker object — but the
    // fallback has to be recorded, not silent, or `get()` reads it wrong.
    h.auth.mockResolvedValue(CLIENT_SESSION)
    clientOwnsOnlyTheirThread()
    h.put
      .mockRejectedValueOnce(new Error('Vercel Blob: Cannot use private access on a public store.'))
      .mockResolvedValueOnce({ url: 'https://blob.invalid/x' })

    const res = await uploadPOST(chatUpload(JPEG_BYTES, { clientId: OWNER_CLIENT }))
    expect(res.status).toBe(200)
    expect((await res.json()).access).toBe('public')
    expect(h.put.mock.calls[0][2]).toMatchObject({ access: 'private' })
    expect(h.put.mock.calls[1][2]).toMatchObject({ access: 'public' })
  })

  it('does NOT fall back on any other failure — that would hide a real error', async () => {
    h.auth.mockResolvedValue(CLIENT_SESSION)
    clientOwnsOnlyTheirThread()
    h.put.mockRejectedValue(new Error('network exploded'))

    const res = await uploadPOST(chatUpload(JPEG_BYTES, { clientId: OWNER_CLIENT }))
    expect(res.status).toBe(502)
    expect(h.put).toHaveBeenCalledTimes(1)
  })

  it('never returns a blob url to the caller — only the path it may quote back', async () => {
    h.auth.mockResolvedValue(CLIENT_SESSION)
    clientOwnsOnlyTheirThread()
    h.put.mockResolvedValue({ url: 'https://blob.invalid/chat/direct/cl_1/leaky.jpg' })

    const body = await (await uploadPOST(chatUpload(JPEG_BYTES, { clientId: OWNER_CLIENT }))).json()
    expect(JSON.stringify(body)).not.toContain('blob.invalid')
    expect(body.url).toBeUndefined()
  })
})

// ─── 2 · Size and type are decided from the bytes ────────────────────────────

describe('upload — the browser check is not the check', () => {
  beforeEach(() => {
    h.auth.mockResolvedValue(CLIENT_SESSION)
    clientOwnsOnlyTheirThread()
  })

  it('refuses an oversize file server-side', async () => {
    const big = new Uint8Array(6 * 1024 * 1024)
    big.set(JPEG_BYTES) // valid magic bytes, still too big
    const res = await uploadPOST(chatUpload(big, { clientId: OWNER_CLIENT }))
    expect(res.status).toBe(413)
    expect(h.put).not.toHaveBeenCalled()
  })

  it('refuses an HTML document named photo.jpg and declared image/jpeg', async () => {
    // The name and the Content-Type are both the caller's claim; the bytes are not.
    const res = await uploadPOST(chatUpload(HTML_BYTES, { clientId: OWNER_CLIENT }))
    expect(res.status).toBe(415)
    expect(h.put).not.toHaveBeenCalled()
  })

  it('refuses an empty file', async () => {
    const res = await uploadPOST(chatUpload(new Uint8Array(0), { clientId: OWNER_CLIENT }))
    expect(res.status).toBe(400)
    expect(h.put).not.toHaveBeenCalled()
  })

  it('stores the SNIFFED content type, never the declared one', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const form = new FormData()
    // Declared jpeg, actually a PNG.
    form.append('file', new File([png as unknown as BlobPart], 'x.jpg', { type: 'image/jpeg' }))
    form.append('target', 'chat')
    form.append('clientId', OWNER_CLIENT)
    const res = await uploadPOST(
      new Request('https://app.pupmanager.com/api/upload/image', { method: 'POST', body: form }),
    )
    expect((await res.json()).contentType).toBe('image/png')
    expect(h.put.mock.calls[0][2]).toMatchObject({ contentType: 'image/png' })
  })
})

// ─── 3 · A message cannot attach another conversation's photo ────────────────

describe('POST /api/messages — attachments are scoped to the thread', () => {
  beforeEach(() => {
    h.auth.mockResolvedValue(CLIENT_SESSION)
    h.trainerFindUnique.mockResolvedValue(null)
    h.clientFindFirst.mockResolvedValue({ id: OWNER_CLIENT })
    h.messageCreate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: 'm1',
      body: args.data.body,
      senderId: 'u_client',
      createdAt: new Date(),
      sender: { name: 'Sam', email: 's@x.test' },
      attachments: [{ id: 'att1', width: null, height: null, position: 0 }],
    }))
  })

  it('accepts a photo whose path belongs to this thread', async () => {
    const res = await messagePOST(jsonReq({
      clientId: OWNER_CLIENT,
      body: '',
      attachments: [{ path: `chat/direct/${OWNER_CLIENT}/a.jpg`, contentType: 'image/jpeg', sizeBytes: 100 }],
    }))
    expect(res.status).toBe(201)
    const created = h.messageCreate.mock.calls[0][0].data
    expect(created.attachments.create).toHaveLength(1)
  })

  it('REFUSES a path from another client\'s thread', async () => {
    const res = await messagePOST(jsonReq({
      clientId: OWNER_CLIENT,
      body: 'nice try',
      attachments: [{ path: `chat/direct/${STRANGER_CLIENT}/a.jpg`, contentType: 'image/jpeg', sizeBytes: 100 }],
    }))
    expect(res.status).toBe(400)
    expect(h.messageCreate).not.toHaveBeenCalled()
  })

  it('a PHOTO-ONLY message is allowed', async () => {
    const res = await messagePOST(jsonReq({
      clientId: OWNER_CLIENT,
      attachments: [{ path: `chat/direct/${OWNER_CLIENT}/a.jpg`, contentType: 'image/jpeg', sizeBytes: 100 }],
    }))
    expect(res.status).toBe(201)
  })

  it('an EMPTY message — no words, no photo — is refused by the ROUTE', async () => {
    // The Send button is disabled on screen; that is not the check (AGENTS.md #3).
    expect((await messagePOST(jsonReq({ clientId: OWNER_CLIENT, body: '   ' }))).status).toBe(400)
    expect((await messagePOST(jsonReq({ clientId: OWNER_CLIENT }))).status).toBe(400)
    expect(h.messageCreate).not.toHaveBeenCalled()
  })

  it('refuses more photos than the cap allows', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      path: `chat/direct/${OWNER_CLIENT}/${i}.jpg`, contentType: 'image/jpeg' as const, sizeBytes: 10,
    }))
    const res = await messagePOST(jsonReq({ clientId: OWNER_CLIENT, body: 'x', attachments: many }))
    expect(res.status).toBe(400)
    expect(h.messageCreate).not.toHaveBeenCalled()
  })

  it('tells the notifier how many photos there are, so the push is not blank', async () => {
    await messagePOST(jsonReq({
      clientId: OWNER_CLIENT,
      attachments: [{ path: `chat/direct/${OWNER_CLIENT}/a.jpg`, contentType: 'image/jpeg', sizeBytes: 100 }],
    }))
    await settleDeferred()
    expect(h.notifyMessageRecipient).toHaveBeenCalledWith(
      expect.objectContaining({ body: '', attachmentCount: 1 }),
    )
  })

  it('never puts the storage path in the response', async () => {
    const res = await messagePOST(jsonReq({
      clientId: OWNER_CLIENT,
      attachments: [{ path: `chat/direct/${OWNER_CLIENT}/a.jpg`, contentType: 'image/jpeg', sizeBytes: 100 }],
    }))
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain('chat/direct')
    expect(text).toContain('/api/message-images/att1')
  })
})

// ─── 4 · A photo is only served to a party to the conversation ───────────────

describe('GET /api/message-images/<id> — the url is not the permission', () => {
  const params = { params: Promise.resolve({ attachmentId: 'att1' }) }
  const req = new Request('https://app.pupmanager.com/api/message-images/att1')

  it('refuses a signed-out caller', async () => {
    h.auth.mockResolvedValue(null)
    expect((await imageGET(req, params)).status).toBe(401)
    expect(h.blobGet).not.toHaveBeenCalled()
  })

  it('serves it to the client whose thread it is', async () => {
    h.auth.mockResolvedValue(CLIENT_SESSION)
    clientOwnsOnlyTheirThread()
    h.attachmentFindUnique.mockResolvedValue({
      storagePath: `chat/direct/${OWNER_CLIENT}/a.jpg`,
      storageAccess: 'private',
      contentType: 'image/jpeg',
      message: { clientId: OWNER_CLIENT },
      groupMessage: null,
    })
    h.blobGet.mockResolvedValue({ statusCode: 200, stream: new ReadableStream(), headers: new Headers(), blob: {} })

    const res = await imageGET(req, params)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/jpeg')
    // Never a shared cache — the check must not be bypassable by a CDN copy.
    expect(res.headers.get('Cache-Control')).toContain('private')
    expect(h.blobGet).toHaveBeenCalledWith(`chat/direct/${OWNER_CLIENT}/a.jpg`, { access: 'private' })
  })

  it('reads a public-store row with the mode it was WRITTEN with', async () => {
    // Passing 'private' for an object on a public store fails, so the row has
    // to carry which one it is.
    h.auth.mockResolvedValue(CLIENT_SESSION)
    clientOwnsOnlyTheirThread()
    h.attachmentFindUnique.mockResolvedValue({
      storagePath: `chat/direct/${OWNER_CLIENT}/a.jpg`,
      storageAccess: 'public',
      contentType: 'image/png',
      message: { clientId: OWNER_CLIENT },
      groupMessage: null,
    })
    h.blobGet.mockResolvedValue({ statusCode: 200, stream: new ReadableStream(), headers: new Headers(), blob: {} })

    const res = await imageGET(req, params)
    expect(res.status).toBe(200)
    expect(h.blobGet).toHaveBeenCalledWith(`chat/direct/${OWNER_CLIENT}/a.jpg`, { access: 'public' })
    // Still never cached by a shared CDN, and still only served to a participant.
    expect(res.headers.get('Cache-Control')).toContain('private')
  })

  it('REFUSES a stranger holding the id — 404, and the blob is never read', async () => {
    h.auth.mockResolvedValue(CLIENT_SESSION)
    clientOwnsOnlyTheirThread()
    h.attachmentFindUnique.mockResolvedValue({
      storagePath: `chat/direct/${STRANGER_CLIENT}/a.jpg`,
      storageAccess: 'public',
      contentType: 'image/jpeg',
      message: { clientId: STRANGER_CLIENT },
      groupMessage: null,
    })

    const res = await imageGET(req, params)
    expect(res.status).toBe(404)
    expect(h.blobGet).not.toHaveBeenCalled()
  })

  it('an id that does not exist is the same 404 — probing tells you nothing', async () => {
    h.auth.mockResolvedValue(CLIENT_SESSION)
    h.attachmentFindUnique.mockResolvedValue(null)
    expect((await imageGET(req, params)).status).toBe(404)
  })

  it('refuses a group photo on a post this member may not read', async () => {
    h.auth.mockResolvedValue(CLIENT_SESSION)
    h.attachmentFindUnique.mockResolvedValue({
      storagePath: 'chat/group/g1/a.jpg',
      storageAccess: 'public',
      contentType: 'image/jpeg',
      message: null,
      groupMessage: { id: 'gm1', groupId: 'g1' },
    })
    h.getGroupAccess.mockResolvedValue({
      userId: 'u_client', groupId: 'g1', trainerId: 'co1', mode: 'BROADCAST',
      isTrainerSide: false, archivedAt: null,
      participant: { id: 'p1', role: 'CLIENT', displayName: 'Sam', joinedAt: new Date(), lastReadAt: null },
    })
    // Another client's TRAINER_ONLY reply — visibleMessagesWhere filters it out.
    h.groupMessageFindFirst.mockResolvedValue(null)

    expect((await imageGET(req, params)).status).toBe(404)
    expect(h.blobGet).not.toHaveBeenCalled()
  })
})
