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
      select: { seatCount: true, stripeSubscriptionId: true },
    }),
  ])

  return NextResponse.json({
    canManage: can('team.manage', ctx.role, ctx.permissions),
    isOwner: ctx.role === 'OWNER',
    // Whether the caller holds the "Add seats" permission (owner-granted).
    canAddSeats: can('billing.seats', ctx.role, ctx.permissions),
    seatCount: company?.seatCount ?? 1,
    seatsUsed: members.length,
    // Whether the owner can buy seats (has a subscription) — drives the
    // team page's "add seats" action vs a prompt to subscribe.
    hasSubscription: !!company?.stripeSubscriptionId,
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

  // Privilege-escalation guard (mirrors the PATCH route): a non-OWNER inviter
  // must not GRANT a capability they don't themselves hold — otherwise a MANAGER
  // with team.manage could mint a member carrying billing.seats / team.manage and
  // escalate through that controlled account.
  if (ctx.role !== 'OWNER') {
    const overreach = (Object.keys(permissions) as (keyof typeof permissions)[])
      .filter((k) => permissions[k] === true && !can(k, ctx.role, ctx.permissions))
    if (overreach.length > 0) {
      return NextResponse.json({ error: 'You can only grant permissions you hold yourself.' }, { status: 403 })
    }
  }

  // One login per email, but a person is not limited to one relationship: they
  // can own a business, contract for another, and be somebody's client, all on
  // the same account. So an existing user is LINKED to this business rather
  // than refused (this is the "link existing account" flow the old 409 said was
  // coming). Their existing role/name are never touched — access comes from the
  // membership row, and lib/account-access derives what they can reach.
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true },
  })

  // Already on THIS team — nothing to link, and re-inviting would violate the
  // (companyId, userId) unique. Say so plainly instead of 500ing.
  if (existing) {
    const alreadyMember = await prisma.trainerMembership.findUnique({
      where: { companyId_userId: { companyId: ctx.companyId, userId: existing.id } },
      select: { acceptedAt: true },
    })
    if (alreadyMember) {
      return NextResponse.json(
        {
          error: alreadyMember.acceptedAt
            ? 'They are already on your team.'
            : 'They have already been invited — resend the invite instead.',
        },
        { status: 409 },
      )
    }
  }

  // Branding for the email + inviter name + seat allowance.
  const company = await prisma.trainerProfile.findUnique({
    where: { id: ctx.companyId },
    select: {
      businessName: true,
      logoUrl: true,
      emailAccentColor: true,
      seatCount: true,
      subscriptionStatus: true,
      user: { select: { name: true, email: true } },
    },
  })
  if (!company) return NextResponse.json({ error: 'Business not found' }, { status: 404 })

  // Seat cap: owner + members must fit within seatCount, and adding a seat is a
  // paid upgrade (POST /api/billing/seats). EXCEPTION: during the free trial,
  // seats are free — trialing businesses can invite their whole team to try it
  // out, and seat billing reconciles when the trial converts.
  const isTrialing = company.subscriptionStatus === 'TRIALING'
  const seatsUsed = await prisma.trainerMembership.count({ where: { companyId: ctx.companyId } })
  if (!isTrialing && seatsUsed >= company.seatCount) {
    return NextResponse.json(
      { error: `All ${company.seatCount} seat${company.seatCount === 1 ? '' : 's'} are in use. Add more seats before inviting another trainer.` },
      { status: 403 },
    )
  }

  const inviteToken = crypto.randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

  await prisma.$transaction(async (tx) => {
    // Link the existing person, or create them. Never clobber an existing
    // user's role or name — a CLIENT who contracts for a business stays a
    // CLIENT by default and gains trainer access via the membership below.
    const user = existing
      ? existing
      : await tx.user.create({
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

// Seats are no longer settable for free here — adding a seat is a paid
// upgrade handled by POST /api/billing/seats (Stripe quantity update). This
// keeps team size tied to what the business actually pays for.
