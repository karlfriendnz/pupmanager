import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { requirePermission, PermissionError } from '@/lib/membership'
import { asPermissionMap } from '@/lib/permissions'

// Resolve the membership and confirm it belongs to the caller's business.
// Returns null if missing or cross-tenant (treated as 404 either way).
async function loadMembership(membershipId: string, companyId: string) {
  const m = await prisma.trainerMembership.findUnique({
    where: { id: membershipId },
    select: { id: true, companyId: true, role: true },
  })
  if (!m || m.companyId !== companyId) return null
  return m
}

const patchSchema = z.object({
  role: z.enum(['MANAGER', 'STAFF']).optional(),
  title: z.string().max(80).nullable().optional(),
  permissions: z.record(z.string(), z.boolean()).optional(),
})

// PATCH — update a member's role / title / permissions. Cannot target the
// OWNER (their access is fixed) and cannot promote anyone to OWNER.
export async function PATCH(req: Request, { params }: { params: Promise<{ membershipId: string }> }) {
  let ctx
  try {
    ctx = await requirePermission('team.manage')
  } catch (e) {
    if (e instanceof PermissionError) return NextResponse.json({ error: 'You don’t have permission to manage the team.' }, { status: 403 })
    throw e
  }

  const { membershipId } = await params
  const member = await loadMembership(membershipId, ctx.companyId)
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (member.role === 'OWNER') {
    return NextResponse.json({ error: 'The owner’s access can’t be changed.' }, { status: 400 })
  }

  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const data: { role?: 'MANAGER' | 'STAFF'; title?: string | null; permissions?: object } = {}
  if (parsed.data.role) data.role = parsed.data.role
  if (parsed.data.title !== undefined) data.title = parsed.data.title?.trim() || null
  if (parsed.data.permissions) data.permissions = asPermissionMap(parsed.data.permissions)

  await prisma.trainerMembership.update({ where: { id: membershipId }, data })
  return NextResponse.json({ ok: true })
}

// DELETE — remove a member from the business. Their assigned sessions/clients
// fall back to unassigned (FK is SET NULL). The OWNER can't be removed. Also
// deletes the member's user account if it was never accepted (pending invite),
// so a re-invite to the same email works; accepted members keep their account.
export async function DELETE(_req: Request, { params }: { params: Promise<{ membershipId: string }> }) {
  let ctx
  try {
    ctx = await requirePermission('team.manage')
  } catch (e) {
    if (e instanceof PermissionError) return NextResponse.json({ error: 'You don’t have permission to manage the team.' }, { status: 403 })
    throw e
  }

  const { membershipId } = await params
  const m = await prisma.trainerMembership.findUnique({
    where: { id: membershipId },
    select: { id: true, companyId: true, role: true, acceptedAt: true, userId: true },
  })
  if (!m || m.companyId !== ctx.companyId) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (m.role === 'OWNER') return NextResponse.json({ error: 'The owner can’t be removed.' }, { status: 400 })

  if (!m.acceptedAt) {
    // Pending invite — tear down the placeholder user too (cascades the
    // membership) so the email is free to re-invite.
    await prisma.user.delete({ where: { id: m.userId } })
  } else {
    await prisma.trainerMembership.delete({ where: { id: membershipId } })
  }

  return NextResponse.json({ ok: true })
}
