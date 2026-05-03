import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import Credentials from 'next-auth/providers/credentials'
import Resend from 'next-auth/providers/resend'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { authConfig } from './auth.config'

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
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
    // Magic link for clients
    Resend({
      from: process.env.RESEND_FROM_EMAIL,
      sendVerificationRequest: async ({ identifier, url }) => {
        const { Resend: ResendClient } = await import('resend')
        const resend = new ResendClient(process.env.RESEND_API_KEY)
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL!,
          to: identifier,
          subject: 'Your PupManager login link',
          html: `
            <p>Click the link below to log in to PupManager. This link expires in 15 minutes.</p>
            <a href="${url}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">
              Log in to PupManager
            </a>
            <p>If you didn't request this, you can safely ignore it.</p>
          `,
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

        return { id: user.id, email: user.email, name: user.name, role: user.role }
      },
    }),
  ],
})
