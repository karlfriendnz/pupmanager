import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import crypto from 'crypto'
import { getTrainerContext, requirePermission, PermissionError } from '@/lib/membership'
import { can, asPermissionMap } from '@/lib/permissions'
import { sendEmail, fromTrainer } from '@/lib/email'
import { renderTeamInviteEmail } from '@/lib/team-invite-email'

// GET — the team roster for the current business, plus seat usage and whether
// the caller may manage the team. Visible to any trainer in the business.
export async function GET() {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const [members, company] = await Promise.all([
    prisma.trainerMembership.findMany({
      where: { companyId: ctx.companyId },
      select: {
        id: true,
        role: true,
        title: true,
        permissions: true,
        acceptedAt: true,
        invitedAt: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: [{ role: 'asc' }, { invitedAt: 'asc' }],
    }),
    prisma.trainerProfile.findUnique({
      where: { id: ctx.companyId },
      select: { seatCount: true },
    }),
  ])

  return NextResponse.json({
    canManage: can('team.manage', ctx.role, ctx.permissions),
    isOwner: ctx.role === 'OWNER',
    seatCount: company?.seatCount ?? 1,
    seatsUsed: members.length,
    members: members.map((m) => ({
      id: m.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      title: m.title,
      permissions: asPermissionMap(m.permissions),
      status: m.acceptedAt ? 'ACTIVE' : 'PENDING',
      invitedAt: m.invitedAt,
      isOwner: m.role === 'OWNER',
      isSelf: m.id === ctx.membershipId,
    })),
  })
}

const inviteSchema = z.object({
  name: z.string().min(2, 'Enter their name'),
  email: z.string().email('Enter a valid email'),
  role: z.enum(['MANAGER', 'STAFF']),
  title: z.string().max(80).optional().nullable(),
  // Per-member permission overrides (validated/sanitised to known keys below).
  permissions: z.record(z.string(), z.boolean()).optional(),
})

// POST — invite a trainer to the business. Creates a pending TRAINER user +
// TrainerMembership and emails them a branded accept link (reuses the existing
// /invite + magic-link flow). team.manage required.
export async function POST(req: Request) {
  let ctx
  try {
    ctx = await requirePermission('team.manage')
  } catch (e) {
    if (e instanceof PermissionError) return NextResponse.json({ error: 'You don’t have permission to manage the team.' }, { status: 403 })
    throw e
  }

  const parsed = inviteSchema.safeParse(await req.json())
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors
    const first = Object.values(msg)[0]?.[0] ?? 'Invalid input'
    return NextResponse.json({ error: first }, { status: 400 })
  }
  const { name, email, role, title } = parsed.data
  const permissions = asPermissionMap(parsed.data.permissions)

  // One account per email. A person who already has a PupManager login (their
  // own business, a client, or already on a team) can't be invited as a member
  // here — that's a future "link existing account" flow.
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (existing) {
    return NextResponse.json({ error: 'Someone with this email already has a PupManager account.' }, { status: 409 })
  }

  // Branding for the email + inviter name + seat allowance.
  const company = await prisma.trainerProfile.findUnique({
    where: { id: ctx.companyId },
    select: {
      businessName: true,
      logoUrl: true,
      emailAccentColor: true,
      seatCount: true,
      user: { select: { name: true, email: true } },
    },
  })
  if (!company) return NextResponse.json({ error: 'Business not found' }, { status: 404 })

  // Seat cap: owner + members must fit within seatCount. (Stripe seat
  // purchasing isn't wired yet; the owner adjusts seatCount via PATCH below.)
  const seatsUsed = await prisma.trainerMembership.count({ where: { companyId: ctx.companyId } })
  if (seatsUsed >= company.seatCount) {
    return NextResponse.json(
      { error: `All ${company.seatCount} seat${company.seatCount === 1 ? '' : 's'} are in use. Add more seats before inviting another trainer.` },
      { status: 403 },
    )
  }

  const inviteToken = crypto.randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name, email, role: 'TRAINER', emailVerified: null },
    })
    await tx.trainerMembership.create({
      data: {
        companyId: ctx.companyId,
        userId: user.id,
        role,
        title: title?.trim() || null,
        permissions,
        // acceptedAt stays null until they accept (see accept-invite route).
      },
    })
    await tx.verificationToken.create({
      data: { identifier: email, token: inviteToken, expires },
    })
  })

  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite?token=${inviteToken}&email=${encodeURIComponent(email)}`
  const inviterName = company.user.name?.trim() || company.businessName
  const rendered = renderTeamInviteEmail({
    inviteeName: name,
    businessName: company.businessName,
    inviterName,
    roleLabel: role === 'MANAGER' ? 'Manager' : 'Staff',
    inviteUrl,
    logoUrl: company.logoUrl,
    accentColor: company.emailAccentColor,
  })

  let emailError: string | null = null
  try {
    const result = await sendEmail({
      to: email,
      subject: rendered.subject,
      from: fromTrainer(inviterName),
      replyTo: company.user.email ?? undefined,
      text: rendered.text,
      html: rendered.html,
    })
    if (result.error) emailError = result.error.message
  } catch (err) {
    emailError = err instanceof Error ? err.message : 'Failed to send invite email'
  }

  return NextResponse.json({ ok: true, ...(emailError ? { emailError } : {}) }, { status: 201 })
}

const seatSchema = z.object({ seatCount: z.number().int().min(1).max(100) })

// PATCH — set the number of trainer seats for the business. Owner-only.
// NOTE: this updates seatCount directly; it does NOT yet change the Stripe
// subscription quantity (the seat slider on /billing was shelved). When real
// seat billing lands, this becomes a Stripe quantity update. Can't drop below
// the number of seats currently in use.
export async function PATCH(req: Request) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'Only the business owner can change seats.' }, { status: 403 })
  }

  const parsed = seatSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid seat count' }, { status: 400 })

  const used = await prisma.trainerMembership.count({ where: { companyId: ctx.companyId } })
  if (parsed.data.seatCount < used) {
    return NextResponse.json(
      { error: `You have ${used} trainers — remove some before reducing seats below ${used}.` },
      { status: 400 },
    )
  }

  await prisma.trainerProfile.update({
    where: { id: ctx.companyId },
    data: { seatCount: parsed.data.seatCount },
  })
  return NextResponse.json({ ok: true, seatCount: parsed.data.seatCount })
}
