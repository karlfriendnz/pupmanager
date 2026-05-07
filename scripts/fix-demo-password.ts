// Two credentials accounts exist for demo@pupmanager.com — clean up to one
// with a known password, then verify bcrypt round-trips correctly.

import { PrismaClient } from '../src/generated/prisma'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // Sanity: bcrypt itself works
  const sanityHash = await bcrypt.hash('demo1234', 12)
  const sanityOK = await bcrypt.compare('demo1234', sanityHash)
  console.log('bcrypt sanity (round-trip):', sanityOK)
  if (!sanityOK) { console.error('bcrypt itself is broken — abort'); process.exit(1) }

  const user = await prisma.user.findUnique({
    where: { email: 'demo@pupmanager.com' },
    include: { accounts: true },
  })
  if (!user) { console.error('No user'); process.exit(1) }

  const credAccounts = user.accounts.filter(a => a.provider === 'credentials')
  console.log(`Found ${credAccounts.length} credentials account(s)`)

  // Delete duplicates, then upsert a single clean one
  if (credAccounts.length > 1) {
    const idsToDelete = credAccounts.slice(1).map(a => a.id)
    const del = await prisma.account.deleteMany({ where: { id: { in: idsToDelete } } })
    console.log(`Deleted ${del.count} duplicate credentials account(s)`)
  }

  // Set the surviving one (or create if none)
  const fresh = await bcrypt.hash('demo1234', 12)
  if (credAccounts.length === 0) {
    await prisma.account.create({
      data: { userId: user.id, type: 'credentials', provider: 'credentials', providerAccountId: fresh },
    })
    console.log('Created fresh credentials account')
  } else {
    await prisma.account.update({
      where: { id: credAccounts[0].id },
      data: { providerAccountId: fresh },
    })
    console.log('Updated surviving credentials account')
  }

  // Verify by re-reading and round-tripping
  const verify = await prisma.account.findFirst({
    where: { userId: user.id, provider: 'credentials' },
  })
  if (!verify) { console.error('No credentials account after update'); process.exit(1) }
  const ok = await bcrypt.compare('demo1234', verify.providerAccountId)
  console.log(`Final verify (re-read DB + bcrypt.compare): ${ok ? 'PASS' : 'FAIL'}`)
  console.log(`Hash in DB starts with: ${verify.providerAccountId.slice(0, 30)}...`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
