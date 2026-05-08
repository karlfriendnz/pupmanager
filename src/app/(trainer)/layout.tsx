import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { AppShell } from '@/components/shared/app-shell'
import { OnboardingFab } from './onboarding-fab'
import { OnboardingCelebration } from './onboarding-celebration'
import { getOnboardingFabState } from '@/lib/onboarding/state'
import { STEP_TO_MENU } from '@/lib/onboarding/path-step'

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
    : { show: false, nextStep: null, steps: [], totalSteps: 0, allComplete: false }

  // Highlight the sidebar menu item that corresponds to the next-incomplete
  // step — but only after the trainer has completed their current page's
  // step (the AppShell's path-aware gate decides). Falls back to null when
  // onboarding is done — no dot.
  const highlightMenuHref = fabState.show && fabState.nextStep
    ? STEP_TO_MENU[fabState.nextStep.key] ?? null
    : null

  // Pass the keys of every completed step so AppShell can ask "is the
  // trainer's current page step in this list?" before deciding whether
  // to render the pulsing dot.
  const completedStepKeys = fabState.steps
    .filter(s => s.status === 'completed')
    .map(s => s.key)

  return (
    <AppShell
      role="TRAINER"
      userName={session.user.name ?? ''}
      userEmail={session.user.email ?? ''}
      trainerLogo={tp?.logoUrl ?? null}
      businessName={tp?.businessName ?? session.user.businessName}
      highlightMenuHref={highlightMenuHref}
      completedStepKeys={completedStepKeys}
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
      {/* One-shot fireworks when the wizard hits zero remaining steps. The
          component handles its own sessionStorage gate so this is safe to
          render unconditionally — a no-op when allComplete is false. */}
      <OnboardingCelebration allComplete={fabState.allComplete} />
      {children}
    </AppShell>
  )
}
