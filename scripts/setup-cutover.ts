/**
 * One-shot LIVE billing cutover for PupManager. Run it once, in your own
 * shell, with the live key inline:
 *
 *   STRIPE_SECRET_KEY_LIVE=sk_live_… npx tsx scripts/setup-cutover.ts
 *
 * It does everything that needs the live key or prod access, WITHOUT ever
 * printing a secret to the screen/transcript:
 *
 *   1. Wires the LIVE Stripe products/prices into the live DB columns.
 *   2. Sets STRIPE_SECRET_KEY (live) + STRIPE_SECRET_KEY_TEST in Vercel prod.
 *   3. Creates the live + test webhook endpoints.
 *   4. Pipes their signing secrets straight into Vercel
 *      (STRIPE_WEBHOOK_SECRET / STRIPE_WEBHOOK_SECRET_TEST).
 *
 * After it finishes clean, deploy main and billing is live.
 *
 * - Live key: STRIPE_SECRET_KEY_LIVE (inline — never written to disk).
 * - Test key: STRIPE_SECRET_KEY_TEST from .env.local.
 * - Vercel: uses the already-linked project (.vercel/project.json) + your
 *   authenticated Vercel CLI.
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import Stripe from 'stripe'

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const LIVE_RAW = process.env.STRIPE_SECRET_KEY_LIVE
const TEST = process.env.STRIPE_SECRET_KEY_TEST
if (!LIVE_RAW || !LIVE_RAW.startsWith('sk_live_')) {
  console.error('Pass the live key inline: STRIPE_SECRET_KEY_LIVE=sk_live_… npx tsx scripts/setup-cutover.ts')
  process.exit(1)
}
// Typed as string so the guard's narrowing survives into nested functions.
const LIVE: string = LIVE_RAW

const URL = 'https://app.pupmanager.com/api/webhooks/stripe'
const EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]

// Set a Vercel production env var from a value, without echoing the value.
function setVercel(name: string, value: string) {
  try { execSync(`npx vercel env rm ${name} production -y`, { stdio: 'ignore' }) } catch { /* didn't exist */ }
  execSync(`npx vercel env add ${name} production`, { input: value, stdio: ['pipe', 'ignore', 'ignore'] })
  console.log(`   ✓ ${name} set in Vercel (production)`)
}

// Replace any existing endpoint for our URL, return the fresh signing secret.
async function makeWebhook(label: string, key: string): Promise<string> {
  const stripe = new Stripe(key, { apiVersion: '2026-04-22.dahlia' })
  const existing = await stripe.webhookEndpoints.list({ limit: 100 })
  for (const ep of existing.data) if (ep.url === URL) await stripe.webhookEndpoints.del(ep.id)
  const ep = await stripe.webhookEndpoints.create({ url: URL, enabled_events: EVENTS })
  console.log(`   ✓ ${label} webhook endpoint ${ep.id}`)
  return ep.secret as string
}

async function main() {
  console.log('1/4  Wiring LIVE Stripe products/prices → live DB columns…')
  execSync('npx tsx scripts/create-stripe-products.ts', {
    env: { ...process.env, STRIPE_SECRET_KEY: LIVE },
    stdio: 'inherit',
  })

  console.log('\n2/4  Setting Stripe API keys in Vercel…')
  setVercel('STRIPE_SECRET_KEY', LIVE)
  if (TEST) setVercel('STRIPE_SECRET_KEY_TEST', TEST)

  console.log('\n3/4  Creating webhook endpoints…')
  const liveSecret = await makeWebhook('LIVE', LIVE)
  const testSecret = TEST ? await makeWebhook('TEST', TEST) : null

  console.log('\n4/4  Setting webhook secrets in Vercel…')
  setVercel('STRIPE_WEBHOOK_SECRET', liveSecret)
  if (testSecret) setVercel('STRIPE_WEBHOOK_SECRET_TEST', testSecret)

  console.log('\n✓ Cutover config complete. No secrets were printed. Deploy main to go live.')
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1 })
