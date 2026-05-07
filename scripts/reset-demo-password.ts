// Sets demo@pupmanager.com password to a known dev value. Idempotent —
// upserts the credentials Account row so it works whether they signed up
// originally with credentials or via OAuth.

import { PrismaClient } from '../src/generated/prisma'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const EMAIL = 'demo@pupmanager.com'
const NEW_PASSWORD = 'demo1234'

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: EMAIL },
    include: { accounts: true },
  })
  if (!user) {
    console.error(`No user with email ${EMAIL}`)
    process.exit(1)
  }

  const hash = await bcrypt.hash(NEW_PASSWORD, 12)

  const existing = user.accounts.find(a => a.provider === 'credentials')
  if (existing) {
    await prisma.account.update({
      where: { id: existing.id },
      data: { providerAccountId: hash },
    })
    console.log('Updated existing credentials account')
  } else {
    await prisma.account.create({
      data: {
        userId: user.id,
        type: 'credentials',
        provider: 'credentials',
        providerAccountId: hash,
      },
    })
    console.log('Created new credentials account')
  }

  console.log('')
  console.log(`Email:    ${EMAIL}`)
  console.log(`Password: ${NEW_PASSWORD}`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
