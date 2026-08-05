import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { put } from '@vercel/blob'
import crypto from 'crypto'
import { completeDogPhotoFlowSteps } from '@/lib/flow-completions'

/**
 * The dog's picture is rendered by more than one server component, so a
 * router.refresh() on whichever screen did the upload leaves the others
 * serving their cached render — the photo saved, and /my-dogs still showed the
 * placeholder. Reported by Karl 2026-08-06, with the blob stored and readable.
 */
function revalidateDogPhotoScreens() {
  // Never allowed to fail the request. The upload's own try/catch answers 502
  // with "Upload failed — please try again", so a throw from here would tell a
  // client their photo hadn't saved when it had, and invite them to upload it
  // again. A stale screen is the smaller problem, and it clears on its own.
  try {
    for (const path of ['/home', '/my-dogs', '/my-profile']) revalidatePath(path)
  } catch (err) {
    console.error('Dog photo revalidation failed (photo itself saved):', err)
  }
}

const MAX_SIZE_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
])

// Upload a photo for a dog and persist the URL on the row. Both clients and
// trainers can call this provided they have edit-rights to the dog.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ dogId: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { dogId } = await params

  // Resolve the owning client for this dog. A dog has either:
  //   - clientProfileId  (additional dog)
  //   - or no link, but is the primary dog of some clientProfile (dogId on
  //     ClientProfile points back here)
  const dog = await prisma.dog.findUnique({
    where: { id: dogId },
    select: { id: true, clientProfileId: true, primaryFor: { select: { id: true, trainerId: true } } },
  })
  if (!dog) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let owningClientProfileId: string | null = dog.clientProfileId
  let owningTrainerId: string | null = null

  if (!owningClientProfileId && dog.primaryFor.length > 0) {
    owningClientProfileId = dog.primaryFor[0].id
    owningTrainerId = dog.primaryFor[0].trainerId
  } else if (owningClientProfileId) {
    const cp = await prisma.clientProfile.findUnique({
      where: { id: owningClientProfileId },
      select: { trainerId: true },
    })
    owningTrainerId = cp?.trainerId ?? null
  }

  if (!owningClientProfileId || !owningTrainerId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Auth: client owns the profile OR the calling trainer owns the client.
  let authorised = false
  if (session.user.role === 'CLIENT') {
    const cp = await prisma.clientProfile.findFirst({
      where: { userId: session.user.id, id: owningClientProfileId },
      select: { id: true },
    })
    authorised = !!cp
  } else if (session.user.role === 'TRAINER') {
    // The caller's business id (works for owners + invited members).
    const myCompanyId = session.user.trainerId
    if (myCompanyId && myCompanyId === owningTrainerId) {
      authorised = true
    } else if (myCompanyId) {
      // Allow CO_MANAGE shares too — same rule as the rest of the app.
      const share = await prisma.clientShare.findFirst({
        where: { clientId: owningClientProfileId, sharedWithId: myCompanyId, shareType: 'CO_MANAGE' },
        select: { id: true },
      })
      authorised = !!share
    }
  }
  if (!authorised) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: 'Image too large (max 10 MB)' }, { status: 413 })
  }
  if (file.type && !ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: `Unsupported image type: ${file.type}` }, { status: 415 })
  }

  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
  const safeExt = ext.length > 0 && ext.length <= 5 ? ext : 'jpg'
  const pathname = `dog-photos/${owningClientProfileId}/${dogId}/${crypto.randomUUID()}.${safeExt}`

  try {
    const blob = await put(pathname, file, {
      access: 'public',
      addRandomSuffix: false,
      contentType: file.type || 'image/jpeg',
    })
    const updated = await prisma.dog.update({
      where: { id: dogId },
      data: { photoUrl: blob.url },
      select: { id: true, photoUrl: true },
    })
    revalidateDogPhotoScreens()
    // The picture has landed, so a journey that asked for one stops waiting.
    // Here rather than on /my-dogs' own upload button because this is the route
    // the photo actually arrives at, whoever pressed it — a trainer adding it
    // for a client still satisfies the ask that was made of that client.
    // Swallows its own errors; the photo is already saved.
    await completeDogPhotoFlowSteps({
      clientId: owningClientProfileId,
      trainerId: owningTrainerId,
      dogId,
      photoUrl: blob.url,
    })
    return NextResponse.json(updated)
  } catch (err) {
    // Log the real cause server-side; don't blame the Blob store in the UI
    // (it's connected — past messaging here was misleading during a report).
    console.error('Dog photo upload failed:', err)
    return NextResponse.json(
      { error: 'Upload failed — please try again, or use a smaller image.' },
      { status: 502 },
    )
  }
}

// Allow removing the photo without re-uploading.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ dogId: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { dogId } = await params

  // Reuse the same auth dance as POST.
  const dog = await prisma.dog.findUnique({
    where: { id: dogId },
    select: { id: true, clientProfileId: true, primaryFor: { select: { id: true, trainerId: true } } },
  })
  if (!dog) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let owningClientProfileId: string | null = dog.clientProfileId
  let owningTrainerId: string | null = null
  if (!owningClientProfileId && dog.primaryFor.length > 0) {
    owningClientProfileId = dog.primaryFor[0].id
    owningTrainerId = dog.primaryFor[0].trainerId
  } else if (owningClientProfileId) {
    const cp = await prisma.clientProfile.findUnique({
      where: { id: owningClientProfileId },
      select: { trainerId: true },
    })
    owningTrainerId = cp?.trainerId ?? null
  }
  if (!owningClientProfileId || !owningTrainerId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let authorised = false
  if (session.user.role === 'CLIENT') {
    const cp = await prisma.clientProfile.findFirst({
      where: { userId: session.user.id, id: owningClientProfileId },
      select: { id: true },
    })
    authorised = !!cp
  } else if (session.user.role === 'TRAINER') {
    if (session.user.trainerId && session.user.trainerId === owningTrainerId) authorised = true
  }
  if (!authorised) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await prisma.dog.update({ where: { id: dogId }, data: { photoUrl: null } })
  revalidateDogPhotoScreens()
  return NextResponse.json({ ok: true })
}
