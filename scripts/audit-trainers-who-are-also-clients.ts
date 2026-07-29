/**
 * Report every PupManager account that ALSO sits on somebody's client list, and
 * whose name a client edit could therefore have rewritten.
 *
 * WHY: a client's name and email live on the shared User row — the same row that
 * person signs in with. PATCH /api/clients/[clientId] refused to write them when
 * the person held a TrainerMembership, but every account created before the team
 * feature has no membership at all ("legacy owners" — see getTrainerContext), so
 * the guard passed for the platform's oldest businesses. One had its name
 * replaced with a client's: every email it sent afterwards went out signed
 * "<client> via PupManager", and its own staff row read as that client.
 * (Found 2026-07-29 on a real customer's booking test.)
 *
 * The code fix (ownsATrainerAccount in lib/membership.ts) closes the hole. This
 * script finds who was already exposed, so a wrong name can be spotted and put
 * back. A trainer can correct their own in Settings → Your name.
 *
 * READ-ONLY. It writes nothing, so it is safe to point at production.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/audit-trainers-who-are-also-clients.ts
 */
import { PrismaClient } from '../src/generated/prisma/index.js'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! }),
})

async function main() {
  // The exposed set: a User that owns a business AND appears as a client
  // somewhere. Only these rows were ever reachable by the client-edit write.
  const owners = await prisma.user.findMany({
    where: {
      trainerProfile: { isNot: null },
      clientProfiles: { some: {} },
    },
    select: {
      id: true,
      name: true,
      email: true,
      trainerProfile: { select: { id: true, businessName: true, publicEmail: true } },
      memberships: { select: { id: true, role: true } },
      clientProfiles: {
        select: {
          id: true,
          createdAt: true,
          trainer: { select: { businessName: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  if (owners.length === 0) {
    console.log('No account is also on a client list. Nothing was exposed.')
    return
  }

  console.log(`${owners.length} account(s) also sit on a client list.\n`)
  console.log('Check the NAME on each: it is what their outbound email is signed with.')
  console.log('"legacy owner" means no membership row, which is what the old guard missed.\n')

  for (const o of owners) {
    const legacy = o.memberships.length === 0
    console.log(`— ${o.trainerProfile?.businessName ?? '(no business name)'}`)
    console.log(`  name on the account: ${o.name ?? '(none)'}${legacy ? '   ⚠ legacy owner — was unprotected' : ''}`)
    console.log(`  login email:         ${o.email ?? '(none)'}`)
    console.log(`  trainerId:           ${o.trainerProfile?.id}`)
    for (const c of o.clientProfiles) {
      console.log(`  client of:           ${c.trainer?.businessName ?? '(unknown)'} (profile ${c.id}, since ${c.createdAt.toISOString().slice(0, 10)})`)
    }
    console.log('')
  }
}

main()
  .catch(err => { console.error(err); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
