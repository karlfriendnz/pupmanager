import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { OnboardingForm } from './onboarding-form'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Set up your business' }

export default async function OnboardingPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const profile = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    select: { businessName: true, phone: true, logoUrl: true },
  })

  // If already fully set up, redirect to dashboard
  if (profile?.businessName && profile?.phone) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-3xl shadow-lg">
            🐾
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Welcome to K9Tracker!</h1>
          <p className="mt-2 text-slate-500">
            Let&apos;s set up your business profile. Your clients will see this information.
          </p>
        </div>

        {/* Progress indicator */}
        <div className="mb-8 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-blue-600" />
          <div className="flex-1 h-1.5 rounded-full bg-slate-200" />
          <div className="flex-1 h-1.5 rounded-full bg-slate-200" />
          <span className="ml-2 text-xs text-slate-400">Step 1 of 3</span>
        </div>

        <OnboardingForm
          defaultValues={{
            businessName: profile?.businessName ?? '',
            phone: profile?.phone ?? '',
            logoUrl: profile?.logoUrl ?? '',
          }}
        />
      </div>
    </div>
  )
}
