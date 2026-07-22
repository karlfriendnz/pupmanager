import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // `{ restore: true }` un-hides the checklist (Help → Continue setup), so
  // closing the card from the dashboard is reversible rather than a one-way
  // door. Body is optional — a bare POST still means "dismiss".
  let restore = false
  try {
    const body = await req.json()
    restore = body?.restore === true
  } catch {
    // No/!JSON body — treat as a plain dismiss.
  }

  // upsert, NOT updateMany: a trainer who hasn't triggered progress-row
  // creation yet has no row, and updateMany would match nothing — the click
  // appeared to do nothing and the checklist came straight back on refresh.
  // trainerId is @unique so the upsert is safe.
  await prisma.trainerOnboardingProgress.upsert({
    where: { trainerId },
    create: { trainerId, checklistDismissedAt: restore ? null : new Date() },
    update: { checklistDismissedAt: restore ? null : new Date() },
  })

  return NextResponse.json({ ok: true, dismissed: !restore })
}
