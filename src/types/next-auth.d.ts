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
  }
}
