import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import crypto from 'crypto'

const s3 = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB per image
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])

export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  // Verify the trainer profile is real (defence in depth — auth shape might
  // include a trainerId from a stale session).
  const owns = await prisma.trainerProfile.findUnique({ where: { id: trainerId }, select: { id: true } })
  if (!owns) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  // Optional caller-provided context (sessionId, taskId) — used only for
  // bucketing the storage path so files are easy to locate. Both are
  // verified-by-prefix; we don't trust them for authorisation.
  const sessionId = (formData.get('sessionId') as string | null) ?? 'misc'
  const taskId = (formData.get('taskId') as string | null) ?? null

  if (!file) return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: 'Image too large (max 10 MB)' }, { status: 413 })
  }
  if (file.type && !ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: `Unsupported image type: ${file.type}` }, { status: 415 })
  }

  // Path layout: trainer-images/<trainerId>/<sessionId>/<taskId|inline>/<uuid>.<ext>
  const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
  const safeExt = ext.length > 0 && ext.length <= 5 ? ext : 'jpg'
  const subdir = taskId ?? 'inline'
  const key = `trainer-images/${trainerId}/${sessionId}/${subdir}/${crypto.randomUUID()}.${safeExt}`
  const buffer = Buffer.from(await file.arrayBuffer())

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET!,
      Key: key,
      Body: buffer,
      ContentType: file.type || 'image/jpeg',
      ServerSideEncryption: 'AES256',
    })
  )

  // Public URL — assumes the bucket is configured for public read on this
  // prefix (matching the existing video pattern). If the bucket policy is
  // tighter, swap this for a signed-URL endpoint.
  const url = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`
  return NextResponse.json({ url, key })
}
