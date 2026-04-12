import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { TrainerSettingsForm } from './trainer-settings-form'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Settings' }

export default async function TrainerSettingsPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const [user, trainerProfile] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true, timezone: true, notifyEmail: true, notifyPush: true },
    }),
    prisma.trainerProfile.findUnique({
      where: { userId: session.user.id },
      select: { businessName: true, phone: true, logoUrl: true, inviteTemplate: true },
    }),
  ])

  if (!user || !trainerProfile) redirect('/login')

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-8">Settings</h1>
      <TrainerSettingsForm user={user} profile={trainerProfile} />
    </div>
  )
}
