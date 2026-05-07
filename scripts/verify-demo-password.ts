import { PrismaClient } from '../src/generated/prisma'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: 'demo@pupmanager.com' },
    include: { accounts: true },
  })
  if (!user) { console.log('NO USER'); return }

  console.log('user.id:', user.id)
  console.log('user.email:', user.email)
  console.log('user.role:', user.role)
  console.log('user.accounts:')
  for (const a of user.accounts) {
    console.log(`  ${a.provider} / ${a.type}  hash="${a.providerAccountId.slice(0, 25)}..." len=${a.providerAccountId.length}`)
  }

  const cred = user.accounts.find(a => a.provider === 'credentials')
  if (!cred) { console.log('NO CREDENTIALS ACCOUNT'); return }

  console.log('\nbcrypt.compare("demo1234", hash):', await bcrypt.compare('demo1234', cred.providerAccountId))
  console.log('bcrypt.compare("wrong", hash):     ', await bcrypt.compare('wrong', cred.providerAccountId))
}

main().catch(console.error).finally(() => prisma.$disconnect())
