import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { clearSampleData, seedDemoData } from '@/lib/demo-seed'

// Loads a compact set of tagged sample data into the trainer's OWN account so
// they can explore a populated app during their trial. Never resets their real
// data and never touches their subscription/branding/onboarding (reset +
// finalize off). Replaces any existing sample set first, so re-loading is safe.
export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId

  // Onboarding roles (dog walker / trainer / …) tailor the sample package set.
  const body = await req.json().catch(() => ({}))
  const roles = Array.isArray(body?.roles) ? body.roles.filter((r: unknown): r is string => typeof r === 'string') : []

  try {
    await clearSampleData(prisma, trainerId)
    const result = await seedDemoData(prisma, trainerId, {
      reset: false,
      markSample: true,
      finalize: false,
      clientCount: 12,
      roles,
    })
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    console.error('[sample-data/seed] failed:', err)
    return NextResponse.json({ error: 'Could not load sample data. Please try again.' }, { status: 500 })
  }
}
