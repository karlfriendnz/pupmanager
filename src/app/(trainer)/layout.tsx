import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { AppShell } from '@/components/shared/app-shell'
import { OnboardingFab } from './onboarding-fab'
import { getOnboardingFabState } from '@/lib/onboarding/state'

export default async function TrainerLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')

  // Read logo + business name fresh from DB on every render so settings updates
  // are reflected immediately. The JWT caches these only at sign-in.
  const tp = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    select: { businessName: true, logoUrl: true },
  })

  const fabState = session.user.trainerId
    ? await getOnboardingFabState(session.user.trainerId)
    : { show: false, nextStep: null, steps: [], totalSteps: 0 }

  return (
    <AppShell
      role="TRAINER"
      userName={session.user.name ?? ''}
      userEmail={session.user.email ?? ''}
      trainerLogo={tp?.logoUrl ?? null}
      businessName={tp?.businessName ?? session.user.businessName}
    >
      {/* FAB sits above the page content so when it's a sticky banner it
          appears at the top of <main> rather than way below at the bottom. */}
      {fabState.show && fabState.nextStep && (
        <OnboardingFab
          nextStep={fabState.nextStep}
          steps={fabState.steps}
          totalSteps={fabState.totalSteps}
        />
      )}
      {children}
    </AppShell>
  )
}
