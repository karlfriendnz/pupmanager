import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { put } from '@vercel/blob'
import crypto from 'crypto'

const MAX_SIZE_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])
const ALLOWED_KINDS = new Set(['logo', 'icon', 'background', 'product'])

export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const owns = await prisma.trainerProfile.findUnique({ where: { id: trainerId }, select: { id: true } })
  if (!owns) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const kind = (formData.get('kind') as string | null) ?? 'logo'

  if (!file) return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  if (!ALLOWED_KINDS.has(kind)) {
    return NextResponse.json({ error: `Unsupported kind: ${kind}` }, { status: 400 })
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: 'Image too large (max 10 MB)' }, { status: 413 })
  }
  if (file.type && !ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: `Unsupported image type: ${file.type}` }, { status: 415 })
  }

  const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
  const safeExt = ext.length > 0 && ext.length <= 5 ? ext : 'jpg'
  const pathname = `trainer-branding/${trainerId}/${kind}/${crypto.randomUUID()}.${safeExt}`

  try {
    const blob = await put(pathname, file, {
      access: 'public',
      addRandomSuffix: false,
      contentType: file.type || 'image/jpeg',
    })
    return NextResponse.json({ url: blob.url })
  } catch (err) {
    console.error('Branding upload failed:', err)
    return NextResponse.json(
      { error: 'Upload failed. Make sure a Vercel Blob store is connected to this project.' },
      { status: 502 },
    )
  }
}
