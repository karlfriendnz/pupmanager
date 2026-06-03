import Stripe from 'stripe'
import { env } from './env'

// Dual-mode Stripe. Real trainers bill against the primary key
// (STRIPE_SECRET_KEY — live in prod, test in local dev); sandbox trainers
// (e.g. the demo) always bill against the test key (STRIPE_SECRET_KEY_TEST),
// so they can show the full flow without ever taking a real charge.
//
// Lazy singletons so we don't crash boot when a key isn't set — most of the
// app runs fine without billing, and surfaces degrade via isStripeConfigured()
// rather than throwing.

function makeClient(key: string): Stripe {
  return new Stripe(key, {
    // Pin the API version so a Stripe-side default bump never surprises us in
    // production. Bump deliberately when we want new features.
    apiVersion: '2026-04-22.dahlia',
    typescript: true,
    appInfo: { name: 'PupManager', url: 'https://app.pupmanager.com' },
  })
}

let _primary: Stripe | null = null
let _sandbox: Stripe | null = null

function keyFor(sandbox: boolean): string | undefined {
  return sandbox ? env.STRIPE_SECRET_KEY_TEST : env.STRIPE_SECRET_KEY
}

/** Is billing configured for this mode? Defaults to the primary (live) key. */
export function isStripeConfigured(sandbox = false): boolean {
  return !!keyFor(sandbox)
}

/** Stripe client for the given mode — test key for sandbox, primary otherwise. */
export function stripeFor(sandbox: boolean): Stripe {
  const key = keyFor(sandbox)
  if (!key) {
    throw new Error(`Stripe is not configured for ${sandbox ? 'sandbox (STRIPE_SECRET_KEY_TEST)' : 'live (STRIPE_SECRET_KEY)'}`)
  }
  if (sandbox) return (_sandbox ??= makeClient(key))
  return (_primary ??= makeClient(key))
}

/** Back-compat: the primary (live) client. */
export function stripe(): Stripe {
  return stripeFor(false)
}
