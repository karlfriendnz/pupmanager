import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import Credentials from 'next-auth/providers/credentials'
import Resend from 'next-auth/providers/resend'
import Google from 'next-auth/providers/google'
import Apple from 'next-auth/providers/apple'
import { prisma } from '@/lib/prisma'
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

export const { handlers, auth, signIn, signOut } = NextAuth({
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
      // businessName starts empty — required field on /settings forces the
      // trainer to enter a real one. Onboarding step 1 (business_profile)
      // flips to completed only when this field is set.
      await prisma.trainerProfile.upsert({
        where: { userId: user.id! },
        create: { userId: user.id!, businessName: '' },
        update: {},
      })
    },
    // Aha trigger — when a CLIENT user signs in, mark their trainer's onboarding
    // as aha-reached (idempotent via the null filter). This is fire-and-forget;
    // failure must not block sign-in. Sample-data clients will need to be
    // excluded once the demo system (Phase 3) lands.
    async signIn({ user }) {
      try {
        if (user.role !== 'CLIENT' || !user.id) return
        const client = await prisma.clientProfile.findUnique({
          where: { userId: user.id },
          select: { trainerId: true },
        })
        if (!client) return
        await prisma.trainerOnboardingProgress.updateMany({
          where: { trainerId: client.trainerId, ahaReachedAt: null },
          data: { ahaReachedAt: new Date() },
        })
      } catch {
        // Swallow — aha tracking should never block a client sign-in.
      }
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role
        token.id = user.id
      }
      // Fetch trainer profile and cache in JWT (runs on sign-in and backfills old JWTs missing trainerId)
      if (token.role === 'TRAINER' && token.id && !token.trainerId) {
        const tp = await prisma.trainerProfile.findUnique({
          where: { userId: token.id as string },
          select: { id: true, businessName: true, logoUrl: true },
        })
        if (tp) {
          token.trainerId = tp.id
          token.businessName = tp.businessName
          token.logoUrl = tp.logoUrl
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as string
        session.user.trainerId = token.trainerId as string | undefined
        session.user.businessName = token.businessName as string | undefined
        session.user.logoUrl = token.logoUrl as string | null | undefined
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
            clientProfile: {
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

        const trainer = user?.clientProfile?.trainer ?? user?.trainerProfile ?? null
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
    // Email/password for trainers
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const parsed = z.object({
          email: z.string().email(),
          password: z.string().min(8),
        }).safeParse(credentials)

        if (!parsed.success) return null

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
