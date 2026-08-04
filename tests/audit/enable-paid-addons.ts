// Audit-only: force every add-on ON for the throwaway help-doc trainer on the
// LOCAL dev DB, so every screen a help article names is reachable.
// Run: npx dotenv -e .env.development.local -o -- npx tsx tests/audit/enable-paid-addons.ts
import { scriptPrisma } from '../../src/lib/prisma-script'
import { ADDONS } from '../../src/lib/pricing'

const prisma = scriptPrisma()
async function main() {
  const u = await prisma.user.findUnique({ where: { email: 'audit.helpdocs@pupaudit.test' }, select: { id: true } })
  const p = await prisma.trainerProfile.findFirst({ where: { userId: u!.id }, select: { id: true } })
  for (const a of ADDONS) {
    if (a.comingSoon) continue
    await prisma.billingItem.upsert({
      where: { id: a.id },
      update: {},
      create: { id: a.id, name: a.name, kind: 'ADDON', isActive: true, priceMonthly: 0 },
    }).catch(() => {})
    await prisma.trainerAddon.upsert({
      where: { trainerId_itemId: { trainerId: p!.id, itemId: a.id } },
      update: { active: true, expiresAt: null },
      create: { trainerId: p!.id, itemId: a.id, active: true },
    })
  }
  const rows = await prisma.trainerAddon.findMany({ where: { trainerId: p!.id }, select: { itemId: true, active: true } })
  console.log(rows.map(r => r.itemId).join(','))
}
main().finally(() => prisma.$disconnect())
