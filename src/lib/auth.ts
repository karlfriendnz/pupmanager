import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import Credentials from 'next-auth/providers/credentials'
import Resend from 'next-auth/providers/resend'
import Google from 'next-auth/providers/google'
import Apple from 'next-auth/providers/apple'
import { prisma } from '@/lib/prisma'
import { isRateLimited, getClientIp } from '@/lib/rate-limit'
import { recordAudit } from '@/lib/audit'
import { reactivateOnSignIn } from '@/lib/reactivate-account'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { SignJWT, importPKCS8 } from 'jose'
import { authConfig } from './auth.config'

// Apple's "client_secret" is actually a short-lived JWT signed with the .p8
// key — they don't issue a static secret. NextAuth's Apple provider takes the
// JWT in `clientSecret`, so we mint one here at module load. It's valid for
// up to 6 months; we use 60 days for safety. If the server runs longer than
// that it'll be re-minted on next cold start.
async function mintAppleClientSecret(): Promise<string | undefined> {
  const teamId = process.env.APPLE_TEAM_ID
  const keyId = process.env.APPLE_KEY_ID
  const clientId = process.env.APPLE_CLIENT_ID // the Services ID
  const privateKeyPem = process.env.APPLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!teamId || !keyId || !clientId || !privateKeyPem) return undefined

  const key = await importPKCS8(privateKeyPem, 'ES256')
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt(now)
    .setExpirationTime(now + 60 * 24 * 60 * 60) // 60 days
    .setAudience('https://appleid.apple.com')
    .setSubject(clientId)
    .sign(key)
}

const appleClientSecret = process.env.APPLE_CLIENT_ID ? await mintAppleClientSecret() : undefined

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  ...authConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: PrismaAdapter(prisma as any),
  events: {
    // Social sign-ins (Apple/Google) hit PrismaAdapter.createUser without a
    // trainer profile. Create one so the new trainer hits the dashboard with
    // a usable shell instead of a redirect loop. Existing flows (Credentials
    // sign-up, invite acceptance) create their own profile inline so the
    // upsert here is a no-op.
    async createUser({ user }) {
      if (user.role !== 'TRAINER') return
      // An invited member already has a TrainerMembership (created at invite
      // time) and must NOT get their own business. createUser only fires for
      // brand-new User rows, so a pending member who first signs in via OAuth
      // could land here — bail if they're already a member of any business.
      const existingMembership = await prisma.trainerMembership.findFirst({
        where: { userId: user.id! },
        select: { id: true },
      })
      if (existingMembership) return

      // businessName starts empty — required field on /settings forces the
      // trainer to enter a real one. Onboarding step 1 (business_profile)
      // flips to completed only when this field is set.
      // Stamp a 10-day trial just like the /signup + /register routes — OAuth
      // sign-ups previously got TRIALING with a null trialEndsAt, which the
      // trial banner reads as "Trial finished" on day one.
      const TRIAL_DAYS = 10
      const profile = await prisma.trainerProfile.upsert({
        where: { userId: user.id! },
        create: { userId: user.id!, businessName: '', trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000) },
        update: {},
      })
      // Founding account is an OWNER member of its own business.
      await prisma.trainerMembership.upsert({
        where: { companyId_userId: { companyId: profile.id, userId: user.id! } },
        create: { companyId: profile.id, userId: user.id!, role: 'OWNER', acceptedAt: new Date() },
        update: {},
      })
    },
    // Aha trigger — when a real CLIENT signs in, mark onboarding as aha-reached
    // for each of their trainers (idempotent via the null filter). Sample/demo
    // clients (isSample) do NOT count, per the onboarding brief's aha
    // definition. Fire-and-forget; failure must never block sign-in.
    async signIn({ user }) {
      // Audit every successful sign-in (append-only; never blocks the login).
      if (user?.id) {
        await recordAudit({
          action: 'USER_LOGIN',
          actorUserId: user.id,
          meta: { role: user.role ?? null },
        })
        // Stamp last-seen for the admin trainers table. Best-effort — a write
        // hiccup must never block the sign-in.
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        }).catch(() => {})
      }
      try {
        if (user.role !== 'CLIENT' || !user.id) return
        // One client can belong to multiple trainers (Scenario B), so mark aha
        // for all of them. Exclude sample clients.
        const clients = await prisma.clientProfile.findMany({
          where: { userId: user.id, isSample: false },
          select: { trainerId: true },
        })
        if (clients.length === 0) return
        await prisma.trainerOnboardingProgress.updateMany({
          where: { trainerId: { in: clients.map(c => c.trainerId) }, ahaReachedAt: null },
          data: { ahaReachedAt: new Date() },
        })
      } catch {
        // Swallow — aha tracking should never block a client sign-in.
      }
    },
  },
  callbacks: {
    // Reactivate-on-return: a previously deactivated ("inactive") account that
    // signs back in is reinstated rather than blocked — identity is already
    // proven by the provider (credentials/OAuth/magic link) at this point.
    // Best-effort; a hiccup must never block the sign-in.
    async signIn({ user }) {
      if (user?.id) {
        await reactivateOnSignIn(user.id).catch(() => {})
      }
      return true
    },
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.role = (user as { role?: string }).role
        token.id = user.id
      }
      // Org switch — a multi-org trainer called update({ trainerId }) to change
      // their active business. Never trust the client: only switch if the user
      // actually holds a membership for the requested company. All the cached
      // context (membershipId/role/business) re-points to the new org, so every
      // session.user.trainerId reader follows along.
      if (trigger === 'update' && token.id) {
        const requested = (session as { trainerId?: string } | null)?.trainerId
        if (requested) {
          const m = await prisma.trainerMembership.findUnique({
            where: { companyId_userId: { companyId: requested, userId: token.id as string } },
            select: { id: true, role: true, companyId: true, company: { select: { businessName: true, logoUrl: true } } },
          })
          if (m) {
            token.trainerId = m.companyId
            token.membershipId = m.id
            token.companyRole = m.role
            token.businessName = m.company.businessName
            token.logoUrl = m.company.logoUrl
          }
        }
      }
      // Resolve the business (companyId == legacy trainerId) and cache in the
      // JWT. Runs on sign-in and backfills old JWTs missing trainerId. Members
      // resolve via their TrainerMembership; the owner has an OWNER membership
      // pointing at the business they own. The membership row is authoritative
      // for both owners and invited members. companyRole is a hint only —
      // getTrainerContext re-reads role + permissions fresh per request so an
      // owner revoking access takes effect immediately, not at next sign-in.
      if (token.role === 'TRAINER' && token.id && !token.trainerId) {
        const membership = await prisma.trainerMembership.findFirst({
          where: { userId: token.id as string },
          select: {
            id: true,
            role: true,
            companyId: true,
            company: { select: { businessName: true, logoUrl: true } },
          },
          // Prisma orders enums by definition order (OWNER, MANAGER, STAFF),
          // so 'asc' prefers an OWNER membership if a user has more than one.
          orderBy: { role: 'asc' },
        })
        if (membership) {
          token.trainerId = membership.companyId
          token.membershipId = membership.id
          token.companyRole = membership.role
          token.businessName = membership.company.businessName
          token.logoUrl = membership.company.logoUrl
        } else {
          // Legacy fallback: owner whose membership row hasn't been created yet
          // (account predates this feature and the backfill hasn't run, or a
          // race on first sign-in). Resolve via the owned profile.
          const tp = await prisma.trainerProfile.findUnique({
            where: { userId: token.id as string },
            select: { id: true, businessName: true, logoUrl: true },
          })
          if (tp) {
            token.trainerId = tp.id
            token.companyRole = 'OWNER'
            token.businessName = tp.businessName
            token.logoUrl = tp.logoUrl
          }
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as string
        session.user.trainerId = token.trainerId as string | undefined
        session.user.membershipId = token.membershipId as string | undefined
        session.user.companyRole = token.companyRole as string | undefined
        session.user.businessName = token.businessName as string | undefined
        session.user.logoUrl = token.logoUrl as string | null | undefined
        session.user.impersonatorId = token.impersonatorId as string | undefined
      }
      return session
    },
  },
  providers: [
    // Sign in with Google — scopes default to openid+email+profile, which is
    // separate from the calendar scope so existing calendar OAuth keeps working.
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? [Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // allowDangerousEmailAccountLinking lets a user who first signed up with
      // password and now signs in with Google end up linked to the same User
      // (matched by email) instead of getting a duplicate-account error.
      allowDangerousEmailAccountLinking: true,
    })] : []),
    // Sign in with Apple — required by App Store guideline 4.8 since we offer
    // other social/credential sign-ins. Skipped at boot if env not configured.
    ...(appleClientSecret && process.env.APPLE_CLIENT_ID ? [Apple({
      clientId: process.env.APPLE_CLIENT_ID,
      clientSecret: appleClientSecret,
      allowDangerousEmailAccountLinking: true,
    })] : []),
    // Magic link for clients (and any trainer who chooses email-only
    // sign-in). The email itself is rendered to look like it's *from
    // the trainer*, not from PupManager — for clients, that means the
    // trainer's business name, logo, and accent colour wrap the link;
    // From / Reply-To use `fromTrainer()` so the inbox shows
    // "Sarah Carter via PupManager <noreply@…>" with replies routing
    // back to the trainer's actual address. Trainers get a generic
    // branded fallback.
    Resend({
      from: process.env.RESEND_FROM_EMAIL,
      sendVerificationRequest: async ({ identifier, url }) => {
        const { renderLoginLinkEmail } = await import('@/lib/login-link-email')
        const { sendEmail, fromTrainer } = await import('@/lib/email')

        // Look up the trainer context from the email. Clients have a
        // ClientProfile → trainer relation; trainers have their own
        // TrainerProfile. Either way, we get the branding bits we
        // need (or null, in which case the renderer uses defaults).
        const user = await prisma.user.findUnique({
          where: { email: identifier },
          select: {
            name: true,
            role: true,
            clientProfiles: {
              take: 1,
              orderBy: { createdAt: 'desc' },
              select: {
                trainer: {
                  select: {
                    businessName: true,
                    logoUrl: true,
                    emailAccentColor: true,
                    user: { select: { name: true, email: true } },
                  },
                },
              },
            },
            trainerProfile: {
              select: {
                businessName: true,
                logoUrl: true,
                emailAccentColor: true,
                user: { select: { name: true, email: true } },
              },
            },
          },
        })

        const trainer = user?.clientProfiles?.[0]?.trainer ?? user?.trainerProfile ?? null
        const recipientName = user?.name ?? null

        const rendered = renderLoginLinkEmail({ url, recipientName, trainer })

        await sendEmail({
          to: identifier,
          subject: rendered.subject,
          // From-spoof so the email appears to be from the trainer
          // when we have one. Falls back to the platform sender for
          // trainer accounts (no parent trainer to spoof from).
          from: trainer ? fromTrainer(trainer.user.name?.trim() || trainer.businessName) : undefined,
          replyTo: trainer?.user.email ?? undefined,
          text: rendered.text,
          html: rendered.html,
        })
      },
    }),
    // One-click invite acceptance. The client clicks "Accept" on the branded
    // /invite page (a real human action — a POST, so email-prefetch bots can't
    // trigger it), we validate + consume the one-time invite token, and sign
    // them straight in. Replaces the old two-email dance (accept → second
    // magic-link email → click again).
    Credentials({
      id: 'invite-token',
      name: 'invite',
      credentials: {
        token: { label: 'Token', type: 'text' },
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const parsed = z.object({
          token: z.string().min(1),
          email: z.string().email(),
          // Optional: set a password on accept (the default flow). Omitted when
          // the invitee opts for magic-link sign-in instead.
          password: z.string().min(8).optional(),
        }).safeParse(credentials)
        if (!parsed.success) return null

        const { acceptInvite } = await import('@/lib/accept-invite')
        const result = await acceptInvite(parsed.data.token, parsed.data.email, parsed.data.password)
        if (!result.ok) return null

        return result.user
      },
    }),
    // Email/password for trainers
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, request) {
        const parsed = z.object({
          email: z.string().email(),
          password: z.string().min(8),
        }).safeParse(credentials)

        if (!parsed.success) return null

        // Brute-force guard: cap attempts per IP. Returning null blocks the
        // attempt (even a correct password) once over the limit — generous
        // enough that normal use, including a shared office IP, won't trip it.
        // The cap is env-overridable (LOGIN_RATE_LIMIT_MAX) so the E2E suite,
        // which logs in dozens of times from a single loopback IP, can raise it
        // without weakening the prod default (30).
        const ip = request ? getClientIp(request as Request) : 'unknown'
        const loginMax = Number(process.env.LOGIN_RATE_LIMIT_MAX) || 30
        if (await isRateLimited(`login:${ip}`, loginMax, 15 * 60_000)) return null

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
          include: { accounts: true },
        })

        if (!user) return null

        // Trainers use a stored hashed password in their account record
        const credAccount = user.accounts.find(a => a.provider === 'credentials')
        if (!credAccount?.providerAccountId) return null

        const valid = await bcrypt.compare(parsed.data.password, credAccount.providerAccountId)
        if (!valid) return null

        // Block unverified trainer signups — they get a 6-digit code emailed
        // at register time and need to enter it before login. Existing users
        // (verified pre-2FA-rollout) keep their date so they're unaffected.
        if (user.role === 'TRAINER' && !user.emailVerified) {
          throw new Error('email_not_verified')
        }

        return { id: user.id, email: user.email, name: user.name, role: user.role }
      },
    }),
  ],
})
