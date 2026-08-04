// Audit-only: create a throwaway trainer account on the LOCAL dev DB.
// Never touches the demo login. Run: npx dotenv -e .env.development.local -o -- npx tsx tests/audit/setup-trainer.ts
import { scriptPrisma } from '../../src/lib/prisma-script'
import bcrypt from 'bcryptjs'

const prisma = scriptPrisma()
export const AUDIT_EMAIL = 'audit.settings@pupaudit.test'
export const AUDIT_PASSWORD = 'AuditSet2026!'

async function main() {
  const hash = await bcrypt.hash(AUDIT_PASSWORD, 12)
  let user = await prisma.user.findUnique({ where: { email: AUDIT_EMAIL } })
  if (!user) {
    user = await prisma.user.create({
      data: { name: 'Audit Settings', email: AUDIT_EMAIL, role: 'TRAINER', emailVerified: new Date() },
    })
  }
  await prisma.account.deleteMany({ where: { userId: user.id, provider: 'credentials' } })
  await prisma.account.create({
    data: { userId: user.id, type: 'credentials', provider: 'credentials', providerAccountId: hash },
  })
  const existing = await prisma.trainerProfile.findFirst({ where: { userId: user.id } })
  if (!existing) {
    await prisma.trainerProfile.create({
      data: {
        userId: user.id,
        businessName: 'Audit Settings Co',
        trialEndsAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        phone: '+64 21 555 0199',
      },
    })
  } else {
    await prisma.trainerProfile.update({
      where: { id: existing.id },
      data: { trialEndsAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) },
    })
  }
  const p = await prisma.trainerProfile.findFirst({ where: { userId: user.id } })
  console.log(JSON.stringify({ userId: user.id, companyId: p?.id, email: AUDIT_EMAIL, password: AUDIT_PASSWORD }))
}
main().finally(() => prisma.$disconnect())
