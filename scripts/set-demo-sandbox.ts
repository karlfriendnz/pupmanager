/**
 * Flip the demo trainer (demo@pupmanager.com) to sandbox billing, so it bills
 * against Stripe TEST mode while every real trainer is on live. The demo seed
 * sets this too — this is the targeted one-off for an already-seeded prod DB,
 * without regenerating the rest of the demo data.
 *
 *   npx tsx scripts/set-demo-sandbox.ts
 *
 * NB: writes to PROD Supabase (no dev DB) — treat as a production write.
 * Requires the 20260604_dual_mode_billing migration to be applied first.
 */
import fs from 'node:fs'
import { PrismaClient } from '../src/generated/prisma'

// Load .env.local into process.env (no .env in this repo). Don't override
// anything already set in the ambient environment.
try {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* rely on ambient environment */ }

const DEMO_EMAIL = 'demo@pupmanager.com'
const prisma = new PrismaClient()

async function main() {
  const user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL }, select: { id: true } })
  if (!user) {
    console.error(`No user found for ${DEMO_EMAIL} — seed the demo first.`)
    process.exitCode = 1
    return
  }
  const updated = await prisma.trainerProfile.update({
    where: { userId: user.id },
    data: { sandboxBilling: true },
    select: { id: true, sandboxBilling: true },
  })
  console.log(`✓ ${DEMO_EMAIL} trainer ${updated.id} → sandboxBilling = ${updated.sandboxBilling}`)
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
