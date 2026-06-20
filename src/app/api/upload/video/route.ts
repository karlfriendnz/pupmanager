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

const MAX_SIZE_BYTES = 100 * 1024 * 1024 // 100 MB

// Whitelist of video MIME types we accept, each mapped to the extension we
// store under. Both the Content-Type AND the extension are derived from this
// map, NEVER from the client's filename/type — otherwise a client could upload
// an HTML/SVG/JS file labelled text/html and get a stored-XSS URL on the public
// asset domain. (iOS reports .mov as video/quicktime.)
const VIDEO_TYPES: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/ogg': 'ogv',
  'video/3gpp': '3gp',
  'video/x-m4v': 'm4v',
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'CLIENT') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const taskId = formData.get('taskId') as string | null

  if (!file || !taskId) {
    return NextResponse.json({ error: 'Missing file or taskId' }, { status: 400 })
  }

  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: 'File too large (max 100 MB)' }, { status: 413 })
  }

  // Enforce the video MIME whitelist; derive the stored content-type + extension
  // from it, not from the untrusted upload.
  const safeExt = VIDEO_TYPES[file.type]
  if (!safeExt) {
    return NextResponse.json({ error: `Unsupported video type: ${file.type || 'unknown'}` }, { status: 415 })
  }

  const task = await prisma.trainingTask.findFirst({
    where: { id: taskId, client: { userId: session.user.id } },
    select: { id: true, clientId: true },
  })
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const key = `videos/${task.clientId}/${taskId}/${crypto.randomUUID()}.${safeExt}`

  const buffer = Buffer.from(await file.arrayBuffer())

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET!,
      Key: key,
      Body: buffer,
      ContentType: file.type,
      ServerSideEncryption: 'AES256',
    })
  )

  return NextResponse.json({ key })
}
