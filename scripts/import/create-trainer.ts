/**
 * Create (idempotent) a trainer account to import a client's data into.
 *
 * Generalised from scripts/prime/create-trainer.ts, which is hard-coded to
 * Journey Dog Training and is left alone as the worked example. This one takes
 * the account as arguments, so onboarding the next client does not mean
 * copying a script and editing four constants — the mistake being avoided is
 * the copy that gets edited in three places out of four and quietly creates
 * the new client's data under the old client's login.
 *
 *   ./node_modules/.bin/dotenv -e .env.development.local -o -- \
 *     npx tsx scripts/import/create-trainer.ts \
 *       --email dukes@pupmanager.dev \
 *       --password 'DukesDaycare2026!' \
 *       --business 'Dukes' \
 *       --roles puppyschool \
 *       --addons puppyschool
 *
 * Arguments
 *   --email      required, the login
 *   --password   required, set (or reset) on every run
 *   --business   required, the business name shown in the app
 *   --name       optional, the user's display name (defaults to --business)
 *   --phone      optional
 *   --timezone   optional, defaults to Pacific/Auckland
 *   --roles      optional, comma-separated businessRoles
 *   --addons     optional, comma-separated add-ons to switch on as comps
 *
 * Re-runnable: upserts by email, refreshes the password, never duplicates.
 *
 * LOCAL ONLY. This refuses anything but the local sandbox — deliberately a
 * stricter test than loader/guard.ts's assertWritableTarget, which the repo
 * owner has widened to name a live host. Creating a login is account
 * administration, not an import step, and it has no business running anywhere
 * but a developer's machine.
 */
import bcrypt from 'bcryptjs'

import { scriptPrisma } from '../../src/lib/prisma-script'
import { arg, heading, table } from './loader/cli'
import { describeUrl, isLocalSandbox, maskUrl } from './loader/guard'

const prisma = scriptPrisma()

function requireLocalSandbox(): void {
  const url = process.env.DATABASE_URL ?? ''
  if (isLocalSandbox(url)) return
  const { host, database } = describeUrl(url)
  console.error('\n✋ Refusing to create an account: DATABASE_URL is not the local sandbox.')
  console.error(`   host     : ${host}`)
  console.error(`   database : ${database}`)
  console.error(`   url      : ${maskUrl(url)}`)
  console.error('\n   Run it through the dotenv wrapper, and keep the -o:')
  console.error('     ./node_modules/.bin/dotenv -e .env.development.local -o -- \\')
  console.error('       npx tsx scripts/import/create-trainer.ts --email … --password … --business …\n')
  process.exit(1)
}

function csv(value: string | undefined): string[] {
  return (value ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

async function main() {
  requireLocalSandbox()

  const email = (arg('email') ?? '').trim().toLowerCase()
  const password = arg('password') ?? ''
  const business = (arg('business') ?? '').trim()
  const name = (arg('name') ?? business).trim()
  const phone = arg('phone') ?? null
  const timezone = arg('timezone') ?? 'Pacific/Auckland'
  const roles = csv(arg('roles'))
  const addons = csv(arg('addons'))

  const missing = [
    !email && '--email',
    !password && '--password',
    !business && '--business',
  ].filter(Boolean)
  if (missing.length) {
    console.error(`\n✋ Missing required argument(s): ${missing.join(', ')}\n`)
    process.exit(1)
  }

  const hash = await bcrypt.hash(password, 12)

  const user = await prisma.user.upsert({
    where: { email },
    create: { name, email, role: 'TRAINER', emailVerified: new Date(), timezone },
    update: { role: 'TRAINER', emailVerified: new Date(), timezone },
  })

  // The credentials hash lives in providerAccountId — see src/lib/auth.ts.
  const credential = await prisma.account.findFirst({
    where: { userId: user.id, provider: 'credentials' },
  })
  if (credential) {
    await prisma.account.update({
      where: { id: credential.id },
      data: { providerAccountId: hash },
    })
  } else {
    await prisma.account.create({
      data: { userId: user.id, type: 'credentials', provider: 'credentials', providerAccountId: hash },
    })
  }

  const profile = await prisma.trainerProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      businessName: business,
      phone,
      showPhoneToClients: false,
      // A long trial so a sandbox account is never gated behind billing.
      trialEndsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      payoutCurrency: 'nzd',
      businessRoles: roles,
    },
    update: {
      businessName: business,
      ...(phone ? { phone } : {}),
      ...(roles.length ? { businessRoles: roles } : {}),
    },
  })

  // Founding OWNER membership of its own company.
  const owner = await prisma.trainerMembership.findFirst({
    where: { companyId: profile.id, userId: user.id },
  })
  if (!owner) {
    await prisma.trainerMembership.create({
      data: { companyId: profile.id, userId: user.id, role: 'OWNER', acceptedAt: new Date() },
    })
  }

  // Add-ons gate whole surfaces (a daycare's day-booking screen is behind
  // one). Granted as comps so the sandbox account is not waiting on Stripe,
  // and skipped with a warning when the billing catalogue has no such item —
  // an unknown add-on id should say so rather than create a dead row.
  const enabled: string[] = []
  for (const itemId of addons) {
    const item = await prisma.billingItem.findUnique({ where: { id: itemId }, select: { id: true } })
    if (!item) {
      console.warn(`  ! no billing item "${itemId}" — add-on skipped`)
      continue
    }
    await prisma.trainerAddon.upsert({
      where: { trainerId_itemId: { trainerId: profile.id, itemId } },
      create: { trainerId: profile.id, itemId, active: true, grantedByAdmin: true },
      update: { active: true, grantedByAdmin: true },
    })
    enabled.push(itemId)
  }

  heading(`${business} — trainer ready`)
  table({
    'trainer id (companyId)': profile.id,
    'user id': user.id,
    'login email': email,
    'login password': password,
    'business roles': roles.length ? roles.join(', ') : '(none)',
    'add-ons enabled': enabled.length ? enabled.join(', ') : '(none)',
  })
  console.log('\n   → use this login to see the imported data, and this email as --trainer.\n')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
