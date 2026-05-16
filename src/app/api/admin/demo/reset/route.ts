import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ensureDemoTrainer, resetDemoData } from '@/lib/demo-seed'

// POST /api/admin/demo/reset
//
// Wipes every client-facing record for the demo trainer (sessions,
// clients, packages, library, products, achievements, enquiries,
// forms, availability) but leaves the trainer's User + TrainerProfile
// rows in place so they can still log in. Admin-only.
export async function POST() {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const trainerId = await ensureDemoTrainer(prisma)
  const result = await resetDemoData(prisma, trainerId)

  return NextResponse.json({ ok: true, result })
}
