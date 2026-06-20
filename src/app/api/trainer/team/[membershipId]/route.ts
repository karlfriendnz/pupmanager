import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { requirePermission, PermissionError } from '@/lib/membership'
import { asPermissionMap, can, type PermissionKey } from '@/lib/permissions'
import { requireSameOrigin } from '@/lib/csrf'
import { recordAudit, auditRequestMeta } from '@/lib/audit'

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
  const csrf = requireSameOrigin(req); if (csrf) return csrf
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
  if (parsed.data.permissions) {
    // asPermissionMap drops unknown keys. Privilege-escalation guard: a non-OWNER
    // actor cannot GRANT a permission they don't themselves hold (an OWNER can
    // grant anything). Without this a MANAGER could hand out billing.seats /
    // team.manage they lack and escalate via a member they control.
    const requested = asPermissionMap(parsed.data.permissions)
    if (ctx.role !== 'OWNER') {
      const overreach = (Object.keys(requested) as PermissionKey[]).filter(
        k => requested[k] === true && !can(k, ctx.role, ctx.permissions),
      )
      if (overreach.length) {
        return NextResponse.json({ error: 'You can only grant permissions you hold yourself.' }, { status: 403 })
      }
    }
    data.permissions = requested
  }

  await prisma.trainerMembership.update({ where: { id: membershipId }, data })
  await recordAudit({
    action: data.permissions ? 'PERMISSIONS_CHANGED' : 'ROLE_CHANGED',
    companyId: ctx.companyId,
    actorUserId: ctx.userId,
    targetType: 'membership',
    targetId: membershipId,
    meta: { role: data.role, changedPermissions: !!data.permissions },
    ...auditRequestMeta(req),
  })
  return NextResponse.json({ ok: true })
}

// DELETE — remove a member from the business. Their assigned sessions/clients
// fall back to unassigned (FK is SET NULL). The OWNER can't be removed. Also
// deletes the member's user account if it was never accepted (pending invite),
// so a re-invite to the same email works; accepted members keep their account.
export async function DELETE(req: Request, { params }: { params: Promise<{ membershipId: string }> }) {
  const csrf = requireSameOrigin(req); if (csrf) return csrf
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

  await recordAudit({
    action: 'MEMBER_REMOVED',
    companyId: ctx.companyId,
    actorUserId: ctx.userId,
    targetType: 'membership',
    targetId: membershipId,
    meta: { removedUserId: m.userId, wasPending: !m.acceptedAt },
    ...auditRequestMeta(req),
  })
  return NextResponse.json({ ok: true })
}
