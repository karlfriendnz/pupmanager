import { scriptPrisma } from '../src/lib/prisma-script'
import { ADDONS } from '../src/lib/pricing'

// One-off: prod's billing_items table was seeded before several add-ons were
// added to pricing.ts (googlecalendar, xero, clientapp, notes, classes,
// library, payments), so toggling any of them 500s on a TrainerAddon → BillingItem
// FK violation. This idempotently upserts every ADDON catalog entry as a
// BillingItem (NZD reference price), mirroring prisma/seed.ts exactly. Additive:
// creates missing rows, refreshes name/price on existing ones. Nothing deleted.
const prisma = scriptPrisma()

async function main() {
  const rows = ADDONS.map((a, i) => ({
    id: a.id,
    kind: 'ADDON' as const,
    name: a.name,
    description: a.description,
    priceMonthly: a.price.NZD,
    sortOrder: i + 1,
  }))

  const before = new Set(
    (await prisma.billingItem.findMany({ where: { kind: 'ADDON' }, select: { id: true } })).map((r) => r.id),
  )

  for (const item of rows) {
    await prisma.billingItem.upsert({
      where: { id: item.id },
      create: item,
      update: { ...item, isActive: true },
    })
  }

  const created = rows.filter((r) => !before.has(r.id)).map((r) => r.id)
  console.log(`Upserted ${rows.length} ADDON billing items.`)
  console.log(`Newly created: ${created.length ? created.join(', ') : '(none — all already existed)'}`)

  const after = (await prisma.billingItem.findMany({ where: { kind: 'ADDON' }, select: { id: true }, orderBy: { sortOrder: 'asc' } })).map((r) => r.id)
  console.log(`ADDON billing items now present: ${after.join(', ')}`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
