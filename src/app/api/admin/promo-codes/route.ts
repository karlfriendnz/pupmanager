import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') return null
  return session
}

const createSchema = z.object({
  code: z.string().trim().min(3).max(40),
  trialDays: z.number().int().min(1).max(3650),
  // ISO datetime or null/omitted for no expiry.
  expiresAt: z.union([z.string().datetime(), z.null()]).optional(),
  // Positive integer cap, or null/omitted for unlimited.
  maxRedemptions: z.union([z.number().int().min(1), z.null()]).optional(),
})

export async function GET() {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const codes = await prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' } })
  return NextResponse.json({ codes })
}

export async function POST(req: Request) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const code = parsed.data.code.toUpperCase()
  const existing = await prisma.promoCode.findUnique({ where: { code } })
  if (existing) return NextResponse.json({ error: 'A code with that name already exists.' }, { status: 409 })

  const created = await prisma.promoCode.create({
    data: {
      code,
      trialDays: parsed.data.trialDays,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      maxRedemptions: parsed.data.maxRedemptions ?? null,
    },
  })
  return NextResponse.json({ ok: true, code: created }, { status: 201 })
}
