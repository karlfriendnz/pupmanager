import { z } from 'zod'

// Centralised, validated env. Import `env` from here instead of touching
// `process.env` directly so missing/empty values fail loudly at boot rather
// than producing silent runtime errors deep in a request handler.
//
// To add a new variable: add it to the schema, then reference `env.MY_VAR`
// from the consumer code.

const optionalString = z.string().min(1).optional().or(z.literal('').transform(() => undefined))

const schema = z.object({
  // Postgres
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),

  // NextAuth
  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 chars (run: openssl rand -base64 32)'),
  AUTH_URL: z.string().url().optional(),
  AUTH_TRUST_HOST: z.string().optional(),

  // App URL — used in emails, redirects, native shell config
  NEXT_PUBLIC_APP_URL: z.string().url(),

  // Cron auth — both Vercel cron and Supabase pg_cron send this as Bearer
  CRON_SECRET: z.string().min(16, 'CRON_SECRET must be at least 16 chars (run: openssl rand -hex 32)'),

  // Email (Resend)
  RESEND_API_KEY: z.string().startsWith('re_', 'RESEND_API_KEY must start with re_'),
  RESEND_FROM_EMAIL: z.string().email(),

  // S3 — only needed for the legacy video upload route. The main upload path
  // is Vercel Blob (BLOB_READ_WRITE_TOKEN). Marked optional so a project that
  // doesn't use the S3 route can deploy without these.
  AWS_REGION: optionalString,
  AWS_ACCESS_KEY_ID: optionalString,
  AWS_SECRET_ACCESS_KEY: optionalString,
  AWS_S3_BUCKET: optionalString,

  // APNs — required because push notifications are now a first-class feature.
  APNS_KEY_ID: z.string().min(1),
  APNS_TEAM_ID: z.string().min(1),
  APNS_BUNDLE_ID: z.string().min(1),
  APNS_PRIVATE_KEY: z.string().includes('BEGIN PRIVATE KEY', { message: 'APNS_PRIVATE_KEY must be the full .p8 contents' }),

  // Google OAuth — used for both Sign in with Google AND Calendar API.
  // Optional: providers register only when both ID and secret are present.
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,

  // Sign in with Apple. APPLE_CLIENT_ID is the Services ID identifier (not the
  // app bundle ID). All four are required together for the provider to register.
  APPLE_CLIENT_ID: optionalString,
  APPLE_TEAM_ID: optionalString,
  APPLE_KEY_ID: optionalString,
  APPLE_PRIVATE_KEY: optionalString,

  // Stripe (billing). Optional — when missing, /billing/plans renders a
  // "billing coming soon" state and the trial banner has no CTA. Hard
  // fields once we ship public pricing.
  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  // Founders Circle coupon. Create in the Stripe dashboard as a coupon
  // with duration = "repeating", duration_in_months = 12, the founder
  // discount (percent_off or amount_off), and max_redemptions = 10 — the
  // 12-month duration auto-reverts subscriptions to standard pricing and
  // max_redemptions is the hard cap. Optional: when unset the founder
  // path is simply off and checkout behaves exactly as before.
  STRIPE_FOUNDER_COUPON_ID: optionalString,

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export type Env = z.infer<typeof schema>

function parse(): Env {
  const parsed = schema.safeParse(process.env)
  if (parsed.success) return parsed.data

  const issues = parsed.error.issues.map(i => `  • ${i.path.join('.')}: ${i.message}`).join('\n')
  const message = `Environment validation failed:\n${issues}\n\nFix the env vars in Vercel (or .env.local for dev) and redeploy.`

  // Throw only when STRICT_ENV=1 (set in Vercel project env). Locally we warn
  // so that an incomplete .env.local never blocks a developer's build, but the
  // moment code reaches a real deploy the validation is hard.
  if (process.env.STRICT_ENV === '1') throw new Error(message)

  console.warn('\n⚠️  ' + message + '\n')
  // Return whatever did parse so consumers get partial data — anything missing
  // will surface as `undefined` and crash where it's actually used.
  return parsed.error.issues.reduce(
    (acc, _) => acc,
    process.env as unknown as Env,
  )
}

export const env: Env = parse()
