import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') return null
  return session
}

const patchSchema = z.object({
  isActive: z.boolean().optional(),
  trialDays: z.number().int().min(1).max(3650).optional(),
  expiresAt: z.union([z.string().datetime(), z.null()]).optional(),
  maxRedemptions: z.union([z.number().int().min(1), z.null()]).optional(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ codeId: string }> }) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { codeId } = await params
  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const existing = await prisma.promoCode.findUnique({ where: { id: codeId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { isActive, trialDays, expiresAt, maxRedemptions } = parsed.data
  await prisma.promoCode.update({
    where: { id: codeId },
    data: {
      ...(isActive !== undefined && { isActive }),
      ...(trialDays !== undefined && { trialDays }),
      ...(expiresAt !== undefined && { expiresAt: expiresAt === null ? null : new Date(expiresAt) }),
      ...(maxRedemptions !== undefined && { maxRedemptions }),
    },
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ codeId: string }> }) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { codeId } = await params
  const existing = await prisma.promoCode.findUnique({ where: { id: codeId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Trainers keep their trial; the FK is ON DELETE SET NULL, so deleting a code
  // just detaches the attribution rather than touching any account.
  await prisma.promoCode.delete({ where: { id: codeId } })
  return NextResponse.json({ ok: true })
}
