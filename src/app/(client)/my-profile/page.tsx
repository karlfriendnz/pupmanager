import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ClientProfileForm } from './client-profile-form'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'My Profile' }

export default async function ClientProfilePage() {
  const session = await auth()
  if (!session) redirect('/login')

  const [user, clientProfile] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true, timezone: true, notifyEmail: true, notifyPush: true },
    }),
    prisma.clientProfile.findUnique({
      where: { userId: session.user.id },
      include: { dog: true },
    }),
  ])

  if (!user || !clientProfile) redirect('/login')

  return (
    <div className="p-4 md:p-8 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-8">My Profile</h1>
      <ClientProfileForm user={user} dog={clientProfile.dog} />
    </div>
  )
}
