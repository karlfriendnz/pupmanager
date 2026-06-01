import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { put } from '@vercel/blob'
import crypto from 'crypto'

const MAX_SIZE_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

// Admin-only: upload a hero image for an onboarding/trial email, persist the
// public Blob URL on the row, and return it.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const email = await prisma.onboardingEmail.findUnique({ where: { id }, select: { id: true } })
  if (!email) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  if (file.size > MAX_SIZE_BYTES) return NextResponse.json({ error: 'Image too large (max 10 MB)' }, { status: 413 })
  if (file.type && !ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: `Unsupported type: ${file.type}` }, { status: 415 })

  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg'
  const pathname = `onboarding-emails/${id}/${crypto.randomUUID()}.${ext}`
  try {
    const blob = await put(pathname, file, { access: 'public', addRandomSuffix: false, contentType: file.type || 'image/jpeg' })
    await prisma.onboardingEmail.update({ where: { id }, data: { imageUrl: blob.url } })
    return NextResponse.json({ url: blob.url })
  } catch (err) {
    console.error('Onboarding email image upload failed:', err)
    return NextResponse.json({ error: 'Upload failed. Make sure a Vercel Blob store is connected.' }, { status: 502 })
  }
}

// Remove the image.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { id } = await params
  await prisma.onboardingEmail.update({ where: { id }, data: { imageUrl: null } })
  return NextResponse.json({ ok: true })
}
