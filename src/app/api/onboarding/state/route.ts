import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { initTrainerOnboarding } from '@/lib/onboarding/init'
import { getOnboardingState } from '@/lib/onboarding/state'

export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await initTrainerOnboarding(trainerId)
  const state = await getOnboardingState(trainerId)
  return NextResponse.json(state)
}
