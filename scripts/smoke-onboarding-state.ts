// Smoke test: exercise the onboarding state helpers against the demo trainer
// and confirm they return without errors. Logs query timing so we can spot
// regressions in pool pressure.

import { PrismaClient } from '../src/generated/prisma'
import { getOnboardingState, getOnboardingFabState } from '../src/lib/onboarding/state'

const prisma = new PrismaClient({ log: ['query'] })

async function main() {
  const trainer = await prisma.trainerProfile.findFirst({
    where: { user: { email: 'demo@pupmanager.com' } },
    select: { id: true },
  })
  if (!trainer) { console.error('No demo trainer'); process.exit(1) }

  let queryCount = 0
  prisma.$on('query' as never, () => { queryCount++ })

  console.log('--- getOnboardingState ---')
  queryCount = 0
  const t1 = Date.now()
  const state = await getOnboardingState(trainer.id)
  console.log(`OK in ${Date.now() - t1}ms, ${queryCount} queries`)
  console.log(`Steps: ${state.steps.length}, statuses: ${state.steps.map(s => `${s.key}=${s.status}`).join(', ')}`)
  console.log(`aha=${state.ahaReachedAt} backfill=${state.backfilledAt} dismissed=${state.checklistDismissedAt}`)
  console.log(`limboClient=${state.limboClient?.name ?? 'null'}`)

  console.log('\n--- getOnboardingFabState ---')
  queryCount = 0
  const t2 = Date.now()
  const fab = await getOnboardingFabState(trainer.id)
  console.log(`OK in ${Date.now() - t2}ms, ${queryCount} queries`)
  console.log(`show=${fab.show} nextStep=${fab.nextStep?.title ?? 'null'} (${fab.nextStep?.order ?? '-'} of ${fab.totalSteps})`)

  console.log('\n--- both in sequence (simulating layout + dashboard in one request) ---')
  queryCount = 0
  const t3 = Date.now()
  const [s, f] = await Promise.all([getOnboardingState(trainer.id), getOnboardingFabState(trainer.id)])
  console.log(`OK in ${Date.now() - t3}ms, ${queryCount} queries (cache should make second call free)`)
  console.log(`state.steps.length=${s.steps.length} fab.show=${f.show}`)
}

main().catch(err => {
  console.error('SMOKE FAILED:', err)
  process.exit(1)
}).finally(() => prisma.$disconnect())
