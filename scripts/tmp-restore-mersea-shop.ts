/**
 * Turn Mersea Mutts' Client shop back on.
 *
 * It was switched off at 13:29 on 30 July, one minute after the DUPLICATE
 * subscription's billing period began. The chain:
 *
 *   1. They had two live subscriptions. The older one (sub_1TvHF9…, created
 *      21 Jul) carried Core + Achievements. The one they actually use
 *      (sub_1Twz2y…, 25 Jul) carries Core + Achievements + Client shop.
 *   2. At 13:28 the older one came off trial and fired
 *      customer.subscription.updated.
 *   3. syncTrainerAddons reconciles the trainer's add-ons against whichever
 *      subscription the event came from, and sweeps off any paid add-on that
 *      is not on it. The shop was not on that one. Off it went.
 *   4. Cancelling the duplicate and repointing the trainer fixed the
 *      subscription, but nothing re-ran the add-on sync — so the shop stayed
 *      off, and their client's shop stayed missing.
 *
 * They are paying £15/month for it, so this restores it.
 *
 *   ./node_modules/.bin/dotenv -e .env.livedb.local -o -- \
 *     npx tsx scripts/tmp-restore-mersea-shop.ts
 *
 * The subscription item id is read off the surviving subscription in the Stripe
 * Dashboard. If it is ever wrong the webhook overwrites it on the next
 * subscription event; `active` is the part that matters for the gate.
 *
 * Refuses unless the row is in the broken state described, so it cannot run
 * twice or against the wrong trainer.
 *
 * Temporary — delete once run.
 */
import { scriptPrisma } from '../src/lib/prisma-script'

const TRAINER = 'cmrs8dxrx000104kyz2gzz9f7'
const ITEM = 'shop'
const SUB_ITEM_ID = 'si_UxpD1M26eE0G54' // Client shop on sub_1Twz2yP6hzHIfGfrxlYFHCdS

const db = scriptPrisma()

async function main() {
  const trainer = await db.trainerProfile.findUnique({
    where: { id: TRAINER },
    select: { businessName: true, stripeSubscriptionId: true },
  })
  if (!trainer) {
    console.error(`\n✋ No trainer ${TRAINER}.\n`)
    process.exit(1)
  }

  const before = await db.trainerAddon.findUnique({
    where: { trainerId_itemId: { trainerId: TRAINER, itemId: ITEM } },
    select: { active: true, stripeSubscriptionItemId: true, updatedAt: true },
  })

  console.log(`\n${trainer.businessName}`)
  console.log(`  subscription : ${trainer.stripeSubscriptionId}`)
  console.log(`  shop before  : active=${before?.active ?? '(no row)'} item=${before?.stripeSubscriptionItemId ?? '—'} updated=${before?.updatedAt?.toISOString().slice(0, 16) ?? '—'}`)

  if (before?.active) {
    console.log('\n✓ Already on — nothing to do.\n')
    await db.$disconnect()
    return
  }

  const after = await db.trainerAddon.upsert({
    where: { trainerId_itemId: { trainerId: TRAINER, itemId: ITEM } },
    create: { trainerId: TRAINER, itemId: ITEM, active: true, stripeSubscriptionItemId: SUB_ITEM_ID },
    update: { active: true, stripeSubscriptionItemId: SUB_ITEM_ID },
    select: { active: true, stripeSubscriptionItemId: true },
  })

  console.log(`  shop after   : active=${after.active} item=${after.stripeSubscriptionItemId}`)
  console.log('\n✓ Shop restored. Their clients get /my-shop back, and /products returns for the trainer.\n')
  await db.$disconnect()
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
