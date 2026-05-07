import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { ClientProfileForm } from './client-profile-form'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'My Profile' }

export default async function ClientProfilePage() {
  const active = await getActiveClient()
  if (!active) redirect('/login')

  const [user, clientProfile] = await Promise.all([
    prisma.user.findUnique({
      where: { id: active.userId },
      select: { name: true, email: true, timezone: true, notifyEmail: true, notifyPush: true },
    }),
    prisma.clientProfile.findUnique({
      where: { id: active.clientId },
      include: { dog: true, dogs: true },
    }),
  ])

  if (!user || !clientProfile) redirect('/login')

  const allDogs = [
    ...(clientProfile.dog ? [{ ...clientProfile.dog, isPrimary: true }] : []),
    ...clientProfile.dogs.map(d => ({ ...d, isPrimary: false })),
  ]

  return (
    <div className="px-5 lg:px-8 py-6 max-w-3xl mx-auto w-full">
      <h1 className="text-2xl font-bold text-slate-900 mb-8">My Profile</h1>
      <ClientProfileForm clientId={clientProfile.id} user={user} dogs={allDogs} />
    </div>
  )
}
