import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CompleteProfileForm } from './complete-profile-form'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Complete your profile' }

// Hard gate shown by (trainer)/layout when a business owner is missing their
// name, business name, or phone. The layout has already decided they belong
// here; this page just renders the form, prefilled with whatever we do have
// (e.g. a name from Google) so they only fill the gaps.
export default async function CompleteProfilePage() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')

  const owned = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    select: {
      businessName: true, phone: true, showPhoneToClients: true, publicEmail: true,
      user: { select: { name: true } },
    },
  })
  // No owned business (invited staff) or already complete → nothing to do here.
  if (!owned) redirect('/dashboard')
  const complete = owned.user.name?.trim() && owned.businessName.trim() && owned.phone?.trim()
  if (complete) redirect('/dashboard')

  return (
    <div className="mx-auto w-full max-w-md px-5 py-10">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold text-slate-900">Finish setting up your account</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          We just need a few details to set up your PupManager account. Your phone
          number stays private unless you choose to show it to your clients.
        </p>
      </div>
      <CompleteProfileForm
        defaultName={owned.user.name ?? ''}
        defaultBusinessName={owned.businessName ?? ''}
        defaultPhone={owned.phone ?? ''}
        defaultShowPhoneToClients={owned.showPhoneToClients}
        defaultPublicEmail={owned.publicEmail ?? ''}
      />
    </div>
  )
}
