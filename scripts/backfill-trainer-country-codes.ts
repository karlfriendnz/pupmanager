/**
 * Normalise TrainerProfile.addressCountry to an ISO 3166-1 alpha-2 code.
 *
 * WHY: addressCountry is free text from the billing-address form, so it holds
 * display names ("United Kingdom ", "New Zealand"). Stripe wants the alpha-2
 * code — both for the Connect account and for the billing customer address —
 * and the old Connect route handed this value straight to Stripe. A trainer
 * whose address had been filled in therefore got an "invalid country" throw on
 * account creation and could never turn payments on. (Found 2026-07-25 on a UK
 * customer who couldn't switch Stripe on at all.)
 *
 * The code fix (countryCodeFor in lib/connect.ts) makes the app tolerant of
 * either form, so this backfill is only about tidying the stored data — and
 * about unblocking affected trainers BEFORE that fix is deployed.
 *
 * Safe to re-run: it only rewrites rows whose value isn't already a 2-letter
 * code, and only when the name maps to a code we recognise.
 *
 *   DRY RUN:  npx dotenv -e .env -- npx tsx scripts/backfill-trainer-country-codes.ts
 *   APPLY:    npx dotenv -e .env -- npx tsx scripts/backfill-trainer-country-codes.ts --apply
 */
import { PrismaClient } from '../src/generated/prisma/index.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { countryCodeFor } from '../src/lib/connect'

const apply = process.argv.includes('--apply')
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! }),
})

async function main() {
  const profiles = await prisma.trainerProfile.findMany({
    select: {
      id: true, businessName: true, addressCountry: true, signupCountry: true, connectAccountId: true,
    },
  })

  const needsFix = profiles.filter(p => p.addressCountry && p.addressCountry.trim().length !== 2)
  console.log(`${profiles.length} businesses, ${needsFix.length} with a non-code addressCountry\n`)

  for (const p of needsFix) {
    // Resolve from the stored name, falling back to signupCountry (always a code).
    const code = countryCodeFor(p.addressCountry, p.signupCountry)
    const blocked = !p.connectAccountId ? ' ← cannot connect Stripe until fixed' : ''
    console.log(`${p.businessName}: ${JSON.stringify(p.addressCountry)} → ${code}${blocked}`)
    if (apply) {
      await prisma.trainerProfile.update({ where: { id: p.id }, data: { addressCountry: code } })
    }
  }

  console.log(apply ? '\nApplied.' : '\nDry run — pass --apply to write.')
}

main().finally(() => prisma.$disconnect())
