import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ensureDemoTrainer, seedDemoData } from '@/lib/demo-seed'

// POST /api/admin/demo/seed
//
// Wipes the demo trainer's current data and rebuilds a populated demo
// dataset (≈50 clients + dogs + packages + sessions + library + products
// + achievements + enquiries). Admin-only — guarded by session role.
//
// Body (all optional):
//   { clientCount?: number, seed?: number }
//
// Returns the SeedResult counts from src/lib/demo-seed.ts so the admin
// UI can show what was created.
export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  let opts: { clientCount?: number; seed?: number } = {}
  try {
    if (req.headers.get('content-length')) {
      opts = await req.json()
    }
  } catch {
    // Empty body is fine; fall through with defaults.
  }

  const trainerId = await ensureDemoTrainer(prisma)
  const result = await seedDemoData(prisma, trainerId, opts)

  return NextResponse.json({ ok: true, result })
}
