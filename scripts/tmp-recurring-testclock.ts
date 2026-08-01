/**
 * Prove recurring membership billing end to end, against a Stripe test clock.
 *
 * Recurring memberships are code-complete and have never taken a payment. The
 * parts that have NEVER run anywhere are the ones that only happen on the
 * second month: renewal, a card that fails, dunning, cancellation. A test clock
 * is the only way to see them without waiting thirty days.
 *
 * The trick that makes this work: a Customer can only be put on a test clock at
 * CREATION. So this creates the Customer on the clock first and pins it to the
 * client's `stripeCustomerIdTest`, which is exactly the field `ensureCustomer`
 * reads before it would mint one. From then on the app's own code path — buy
 * route, checkout, webhooks — runs unchanged, and everything it creates hangs
 * off the clock.
 *
 * Local sandbox only. Refuses to run against anything but pupmanager_dev.
 *
 * ORDER MATTERS: with dotenv-cli the LAST file wins, and `.env.local` carries a
 * production DATABASE_URL. `.env.development.local` must come second so the
 * local database overrides it — the Stripe test keys come from `.env.local`,
 * which is the only reason both are loaded at all. The guard below is what
 * actually enforces this; the order is just so it passes.
 *
 *   ./node_modules/.bin/dotenv -e .env.local -e .env.development.local -o -- \
 *     npx tsx scripts/tmp-recurring-testclock.ts <command>
 *
 * Webhooks must be forwarded for ANY of this to reach the app:
 *
 *   stripe listen --forward-connect-to localhost:7777/api/webhooks/stripe/connect
 *
 * Commands:
 *   setup     create the client, the clock, the customer, attach a card
 *   subscribe complete the open Checkout Session the buy route created
 *   status    show the purchase, invoices and what Stripe thinks
 *   advance   move the clock forward one month and wait for it to settle
 *   fail      swap the card for one that always declines
 *   ok        swap it back for one that always works
 *   cancel    cancel at period end, then advance past it
 *
 * Temporary — delete once recurring has been proven and shipped.
 */
import Stripe from 'stripe'
import bcrypt from 'bcryptjs'
import { scriptPrisma } from '../src/lib/prisma-script'
import { applicationFeePercentFor } from '../src/lib/connect-subscriptions'

const EMAIL = 'recurring-test@example.com'
const PASSWORD = 'TestPup2026!'
const TRAINER_EMAIL = 'demo@pupmanager.com'
const MEMBERSHIP = 'Juniors'

const db = scriptPrisma()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY_TEST!)

function guardLocal() {
  const url = process.env.DATABASE_URL ?? ''
  if (!/localhost|127\.0\.0\.1/.test(url) || !/pupmanager_dev/.test(url)) {
    console.error('\n✋ Local sandbox only — DATABASE_URL is not pupmanager_dev on localhost.\n')
    process.exit(1)
  }
  if (!process.env.STRIPE_SECRET_KEY_TEST?.startsWith('sk_test_')) {
    console.error('\n✋ STRIPE_SECRET_KEY_TEST is not a test key.\n')
    process.exit(1)
  }
}

async function context() {
  const trainer = await db.trainerProfile.findFirst({
    where: { user: { email: TRAINER_EMAIL } },
    select: { id: true, connectAccountId: true, businessName: true },
  })
  if (!trainer?.connectAccountId) throw new Error('Demo trainer has no Connect account')

  const membership = await db.membership.findFirst({
    where: { trainerId: trainer.id, name: MEMBERSHIP },
    select: { id: true, name: true, plans: { select: { id: true, interval: true, priceCents: true } } },
  })
  if (!membership) throw new Error(`No membership named ${MEMBERSHIP}`)

  const client = await db.clientProfile.findFirst({
    where: { trainerId: trainer.id, user: { email: EMAIL } },
    select: { id: true, stripeCustomerIdTest: true },
  })

  return { trainer, membership, client, acct: { stripeAccount: trainer.connectAccountId } }
}

/** The clock is found by metadata rather than stored, so this stays re-runnable. */
async function findClock(acct: Stripe.RequestOptions) {
  const clocks = await stripe.testHelpers.testClocks.list({ limit: 20 }, acct)
  return clocks.data.find(c => c.name === 'pm-recurring-proof') ?? null
}

async function setup() {
  const { trainer, membership, acct } = await context()

  // The client. A real-looking email, deliberately NOT @pupmanager.test —
  // that domain is treated as a placeholder by isPlaceholderEmail and would be
  // filtered out of every email this flow is supposed to send.
  const user = await db.user.upsert({
    where: { email: EMAIL },
    update: { name: 'Recurring Test' },
    create: { email: EMAIL, name: 'Recurring Test', role: 'CLIENT' },
    select: { id: true },
  })
  const hash = await bcrypt.hash(PASSWORD, 12)
  await db.account.deleteMany({ where: { userId: user.id, provider: 'credentials' } })
  await db.account.create({
    data: { userId: user.id, type: 'credentials', provider: 'credentials', providerAccountId: hash },
  })

  let client = await db.clientProfile.findFirst({
    where: { trainerId: trainer.id, userId: user.id },
    select: { id: true, stripeCustomerIdTest: true },
  })
  if (!client) {
    client = await db.clientProfile.create({
      // Name and email live on the User — a ClientProfile is the tenant link.
      data: { trainerId: trainer.id, userId: user.id, status: 'ACTIVE' },
      select: { id: true, stripeCustomerIdTest: true },
    })
  }

  // The clock. Frozen at now; nothing moves until `advance` says so.
  let clock = await findClock(acct)
  if (!clock) {
    clock = await stripe.testHelpers.testClocks.create(
      { frozen_time: Math.floor(Date.now() / 1000), name: 'pm-recurring-proof' },
      acct,
    )
    console.log(`  clock     ${clock.id} (new)`)
  } else {
    console.log(`  clock     ${clock.id} (existing, ${new Date(clock.frozen_time * 1000).toISOString().slice(0, 16)})`)
  }

  // The customer must be born on the clock — it cannot be moved onto one later.
  // If the client already points at a customer that is NOT on this clock, that
  // pin is stale and gets replaced.
  let customerId = client.stripeCustomerIdTest
  if (customerId) {
    const existing = await stripe.customers.retrieve(customerId, {}, acct).catch(() => null)
    const onClock = existing && !existing.deleted && (existing as Stripe.Customer).test_clock
    if (!onClock) customerId = null
  }
  if (!customerId) {
    const customer = await stripe.customers.create(
      { email: EMAIL, name: 'Recurring Test', test_clock: clock.id, metadata: { clientProfileId: client.id } },
      acct,
    )
    customerId = customer.id
    await db.clientProfile.update({ where: { id: client.id }, data: { stripeCustomerIdTest: customerId } })
    console.log(`  customer  ${customerId} (new, on clock)`)
  } else {
    console.log(`  customer  ${customerId} (existing, on clock)`)
  }

  await useCard(customerId, 'tok_visa', acct)

  console.log(`\n  trainer   ${trainer.businessName}`)
  console.log(`  package   ${membership.name} — ${membership.plans.map(p => `${p.interval} ${p.priceCents / 100}`).join(', ')}`)
  console.log(`  client    ${client.id}`)
  console.log(`\n  Sign in at http://localhost:7777/login as`)
  console.log(`    ${EMAIL} / ${PASSWORD}`)
  console.log(`  then go to /my-memberships and subscribe to ${MEMBERSHIP}.`)
  console.log(`  Card 4242 4242 4242 4242, any future expiry, any CVC.\n`)
}

/** Attach a payment method and make it the default for invoices AND subscriptions. */
async function useCard(customerId: string, token: string, acct: Stripe.RequestOptions) {
  const pm = await stripe.paymentMethods.create({ type: 'card', card: { token } }, acct)
  await stripe.paymentMethods.attach(pm.id, { customer: customerId }, acct)
  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pm.id } }, acct)

  // A Subscription created by Checkout carries its OWN default_payment_method,
  // which wins over the customer's. Swapping the card on the customer alone
  // would change nothing about what the next renewal actually charges.
  const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 }, acct)
  for (const sub of subs.data) {
    if (sub.status === 'canceled' || sub.status === 'incomplete_expired') continue
    await stripe.subscriptions.update(sub.id, { default_payment_method: pm.id }, acct)
  }
  console.log(`  card      ${token} → ${pm.id}${subs.data.length ? ` (also set on ${subs.data.length} subscription(s))` : ''}`)
  return pm.id
}

/**
 * Stand in for a human finishing the hosted Checkout page.
 *
 * Stripe has no API to complete a Checkout Session — it is a hosted page by
 * design. So this reads the OPEN session the buy route actually created and
 * builds the Subscription it would have built: same Price, same metadata, same
 * application fee, same customer. Everything downstream — the webhooks, the
 * MembershipPurchase, every renewal — is then the app's own code, untouched.
 *
 * What this does NOT prove is the hosted page itself (card entry, 3DS). That
 * is Stripe's, and it is the same page the one-off Connect checkout already
 * uses in production.
 */
async function subscribe() {
  const { client, acct } = await context()
  if (!client?.stripeCustomerIdTest) throw new Error('No customer — run `setup` first.')

  const sessions = await stripe.checkout.sessions.list({ limit: 20 }, acct)
  const open = sessions.data.find(
    s => s.status === 'open' && s.mode === 'subscription' && s.customer === client.stripeCustomerIdTest,
  )
  if (!open) throw new Error('No open subscription Checkout Session. Hit the buy route first.')

  const line = (await stripe.checkout.sessions.listLineItems(open.id, { limit: 1 }, acct)).data[0]
  const priceId = line?.price?.id
  if (!priceId) throw new Error('Checkout session has no price')

  const feePercent = applicationFeePercentFor('nzd')
  console.log(`\n  session   ${open.id}`)
  console.log(`  price     ${priceId}`)
  console.log(`  fee       ${feePercent == null ? 'none' : feePercent + '%'}`)

  const sub = await stripe.subscriptions.create(
    {
      customer: client.stripeCustomerIdTest,
      items: [{ price: priceId }],
      metadata: open.metadata as Record<string, string>,
      ...(feePercent != null ? { application_fee_percent: feePercent } : {}),
    },
    acct,
  )
  console.log(`  → ${sub.id} ${sub.status}`)

  // The session it came from is spent; leaving it open invites a second one.
  await stripe.checkout.sessions.expire(open.id, {}, acct).catch(() => {})

  console.log('  waiting for webhooks')
  await new Promise(r => setTimeout(r, 8000))
}

async function status() {
  const { membership, client, acct } = await context()
  if (!client) return console.log('\n  No test client yet — run `setup`.\n')

  const clock = await findClock(acct)
  console.log(`\n  clock     ${clock ? new Date(clock.frozen_time * 1000).toISOString().slice(0, 16) + ' (' + clock.status + ')' : '—'}`)
  console.log(`  now       ${new Date().toISOString().slice(0, 16)}`)

  const purchases = await db.membershipPurchase.findMany({
    where: { clientId: client.id, membershipId: membership.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, status: true, stripeSubscriptionId: true, currentPeriodStart: true,
      currentPeriodEnd: true, cancelAtPeriodEnd: true, cancelledAt: true, cancelReason: true,
      committedUntil: true, applicationFeePercent: true, cardBrand: true, cardLast4: true,
      failedPaymentCount: true, lastPaymentFailedAt: true, accessPausedAt: true,
      accessRestoredAt: true, createdAt: true,
    },
  })
  console.log(`\n  ── our side ──`)
  if (!purchases.length) console.log('  (no MembershipPurchase rows yet)')
  for (const p of purchases) {
    console.log(`  ${p.status.padEnd(10)} ${p.stripeSubscriptionId ?? '—'}`)
    console.log(`    period    ${p.currentPeriodStart?.toISOString().slice(0, 16) ?? '—'} → ${p.currentPeriodEnd?.toISOString().slice(0, 16) ?? '—'}`)
    console.log(`    card      ${p.cardBrand ?? '—'} ••${p.cardLast4 ?? '——'}   fee=${p.applicationFeePercent ?? '—'}`)
    console.log(`    cancel    atPeriodEnd=${p.cancelAtPeriodEnd} at=${p.cancelledAt?.toISOString().slice(0, 16) ?? '—'} reason=${p.cancelReason ?? '—'}`)
    // The dunning state — the whole reason this exercise exists.
    console.log(`    dunning   failures=${p.failedPaymentCount} last=${p.lastPaymentFailedAt?.toISOString().slice(0, 16) ?? '—'} paused=${p.accessPausedAt?.toISOString().slice(0, 16) ?? '—'} restored=${p.accessRestoredAt?.toISOString().slice(0, 16) ?? '—'}`)
    const invs = await db.membershipInvoice.findMany({
      where: { membershipPurchaseId: p.id },
      orderBy: { createdAt: 'asc' },
      select: { stripeInvoiceId: true, status: true, amountDue: true, amountPaid: true, attemptCount: true, periodStart: true, periodEnd: true, actionRequiredAt: true },
    })
    for (const i of invs) {
      console.log(`    invoice ${i.status.padEnd(16)} due ${(i.amountDue / 100).toFixed(2)} paid ${(i.amountPaid / 100).toFixed(2)} attempts=${i.attemptCount} ${i.periodStart?.toISOString().slice(0, 10) ?? '—'}→${i.periodEnd?.toISOString().slice(0, 10) ?? '—'}`)
    }
    if (!invs.length) console.log('    (no MembershipInvoice rows)')
  }

  console.log(`\n  ── Stripe's side ──`)
  if (!client.stripeCustomerIdTest) return console.log('  (no customer)')
  const subs = await stripe.subscriptions.list({ customer: client.stripeCustomerIdTest, status: 'all', limit: 10 }, acct)
  for (const s of subs.data) {
    const item = s.items.data[0]
    console.log(`  ${s.status.padEnd(10)} ${s.id} ${(item?.price?.unit_amount ?? 0) / 100}/${item?.price?.recurring?.interval} cancel_at_period_end=${s.cancel_at_period_end}`)
  }
  if (!subs.data.length) console.log('  (no subscriptions)')
  const invoices = await stripe.invoices.list({ customer: client.stripeCustomerIdTest, limit: 10 }, acct)
  for (const i of invoices.data) {
    console.log(`  invoice ${i.status?.padEnd(10)} ${(i.amount_due / 100).toFixed(2)} attempts=${i.attempt_count} ${i.id}`)
  }
  console.log()
}

/**
 * Advance one month and BLOCK until Stripe has finished replaying everything the
 * jump implies. `advancing` means invoices are still being created and charged;
 * reading our own tables before it settles shows a half-finished renewal.
 */
async function advance(days = 31) {
  const { acct } = await context()
  const clock = await findClock(acct)
  if (!clock) throw new Error('No clock — run `setup` first.')

  const to = clock.frozen_time + days * 86_400
  console.log(`\n  ${new Date(clock.frozen_time * 1000).toISOString().slice(0, 16)} → ${new Date(to * 1000).toISOString().slice(0, 16)}`)
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: to }, acct)

  process.stdout.write('  settling')
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const c = await stripe.testHelpers.testClocks.retrieve(clock.id, {}, acct)
    if (c.status === 'ready') {
      // The clock settling and our webhooks arriving are different events.
      process.stdout.write(' ✓\n  waiting for webhooks')
      await new Promise(r => setTimeout(r, 6000))
      console.log(' ✓\n')
      return
    }
    if (c.status === 'internal_failure') throw new Error('Test clock failed internally')
    process.stdout.write('.')
  }
  throw new Error('Clock did not settle in two minutes')
}

async function main() {
  guardLocal()
  const cmd = process.argv[2] ?? 'status'
  const { client, acct } = await context()

  if (cmd === 'setup') await setup()
  else if (cmd === 'subscribe') { await subscribe(); await status() }
  else if (cmd === 'status') await status()
  else if (cmd === 'advance') { await advance(Number(process.argv[3]) || 31); await status() }
  else if (cmd === 'fail') { await useCard(client!.stripeCustomerIdTest!, 'tok_chargeCustomerFail', acct); console.log() }
  else if (cmd === 'ok') { await useCard(client!.stripeCustomerIdTest!, 'tok_visa', acct); console.log() }
  else if (cmd === 'reset') {
    // Wipe OUR side only, and mint a fresh clock+customer, so the whole
    // lifecycle can be re-run against changed code from a clean slate.
    const c = await db.clientProfile.findFirst({
      where: { user: { email: EMAIL } }, select: { id: true },
    })
    if (c) {
      const ps = await db.membershipPurchase.findMany({ where: { clientId: c.id }, select: { id: true } })
      await db.membershipInvoice.deleteMany({ where: { membershipPurchaseId: { in: ps.map(p => p.id) } } })
      await db.membershipPurchase.deleteMany({ where: { clientId: c.id } })
      await db.membershipConsent.deleteMany({ where: { clientId: c.id } })
      await db.payment.deleteMany({ where: { clientId: c.id } })
      await db.clientProfile.update({ where: { id: c.id }, data: { stripeCustomerIdTest: null } })
      console.log(`  cleared ${ps.length} purchase(s), their invoices, consents and payments`)
    }
    const old = await findClock(acct)
    if (old) { await stripe.testHelpers.testClocks.del(old.id, {}, acct); console.log('  deleted clock ' + old.id) }
    await setup()
  }
  else if (cmd === 'cancel') {
    const subs = await stripe.subscriptions.list({ customer: client!.stripeCustomerIdTest!, status: 'active', limit: 5 }, acct)
    for (const s of subs.data) {
      await stripe.subscriptions.update(s.id, { cancel_at_period_end: true }, acct)
      console.log(`  ${s.id} → cancel_at_period_end`)
    }
    await new Promise(r => setTimeout(r, 4000))
    await status()
  } else {
    console.error(`Unknown command "${cmd}". One of: setup subscribe status advance fail ok cancel reset`)
    process.exit(1)
  }
  await db.$disconnect()
}

main().catch(err => {
  console.error('\n' + (err instanceof Error ? err.message : String(err)) + '\n')
  process.exit(1)
})
