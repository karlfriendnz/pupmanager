import { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: string
      // The business (tenant) this user operates within. For owners this is
      // their own TrainerProfile.id; for invited members it's the company they
      // belong to. Every `where: { trainerId }` query keys off this.
      trainerId?: string
      // The user's TrainerMembership.id within that business (owner or member).
      membershipId?: string
      // CompanyRole hint (OWNER/MANAGER/STAFF). Authoritative role + permissions
      // are re-read per request by getTrainerContext (avoids stale JWT access).
      companyRole?: string
      businessName?: string
      logoUrl?: string | null
      // Set only during admin impersonation: the User.id of the admin who
      // started the "log in as trainer" session. Carried in the (encrypted)
      // JWT so it can't be forged; powers the exit banner + restore route.
      impersonatorId?: string
      // True when this session is a throwaway trade-show "Try It" sandbox.
      // Stamped in the jwt callback from TrainerProfile.demoSessionId, so it is
      // signed and cannot be set by the browser. Read by lib/demo-guard to
      // block every outbound email and push, and by the chrome to show the
      // "you're in a demo" bar. See lib/demo-tenant.
      isDemo?: boolean
      // When this sandbox stops working (ISO string). Drives the countdown in
      // the demo bar. Absent for every normal session.
      demoExpiresAt?: string
    } & DefaultSession['user']
  }
  interface User {
    role?: string
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string
    role?: string
    trainerId?: string
    membershipId?: string
    companyRole?: string
    businessName?: string
    logoUrl?: string | null
    impersonatorId?: string
    isDemo?: boolean
    demoExpiresAt?: string
  }
}
