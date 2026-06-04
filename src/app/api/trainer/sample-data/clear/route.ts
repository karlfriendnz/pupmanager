import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { clearSampleData } from '@/lib/demo-seed'

// Removes ONLY the trainer's tagged sample data, leaving anything real they've
// added intact.
export async function POST() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  try {
    const result = await clearSampleData(prisma, session.user.trainerId)
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    console.error('[sample-data/clear] failed:', err)
    return NextResponse.json({ error: 'Could not remove sample data. Please try again.' }, { status: 500 })
  }
}
