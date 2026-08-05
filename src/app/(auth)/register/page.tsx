import { headers, cookies } from 'next/headers'
import type { Metadata } from 'next'
import { RoleChooser } from '../role-chooser'
import { RegisterForm } from './register-form'
import { prisma } from '@/lib/prisma'
import { TRY_PREFILL_COOKIE } from '@/lib/demo-lead'

/**
 * What somebody typed at the trade-show poster, so they do not type it again at
 * the exact moment they have decided to buy.
 *
 * Read from an httpOnly cookie that names a lead, then looked up HERE — the
 * values never travel in a URL, where they would land in browser history and
 * every access log on the way. A cookie naming a lead that no longer exists
 * (expired, erased) simply prefills nothing.
 *
 * Carries NOTHING from the sandbox. The demo tenant was destroyed before the
 * browser ever reached this page; this is three strings off a marketing record.
 */
async function tradeShowPrefill(): Promise<{ name: string; businessName: string; email: string } | null> {
  const leadId = (await cookies()).get(TRY_PREFILL_COOKIE)?.value
  if (!leadId) return null
  try {
    const lead = await prisma.demoLead.findUnique({
      where: { id: leadId },
      select: { name: true, companyName: true, email: true },
    })
    if (!lead) return null
    return { name: lead.name, businessName: lead.companyName, email: lead.email }
  } catch (err) {
    // A prefill is a convenience. Never let it stop somebody signing up.
    console.error('[register] trade-show prefill lookup failed:', err)
    return null
  }
}

export const metadata: Metadata = { title: 'Create account' }

// /register is the IN-APP "Create account" link (from /login and the native
// shells); /signup is the marketing entry from pupmanager.com/pricing. They
// post to different endpoints — /register captures a lead with no password and
// sets one after the OTP, /signup takes a password up front — so they stay
// separate forms. What they now share is step 0: the role chooser. Whichever
// door a dog owner walks through, they end up at the dog-owner form instead of
// silently becoming a trainer on a trial.
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>
}) {
  const { as } = await searchParams
  if (as !== 'pro') {
    return <RoleChooser proHref="/register?as=pro" />
  }

  const prefill = await tradeShowPrefill()

  // Vercel's edge tells us where the request came from. Used ONLY to preselect
  // the country — the trainer confirms it, so a VPN or a missing header just
  // means they pick from the list.
  const geoCountry = (await headers()).get('x-vercel-ip-country')?.toUpperCase() || null
  const enabledOAuth = {
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    apple: Boolean(process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY),
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-slate-900">Create your account</h1>
        <p className="mt-1 text-sm text-slate-500">
          {prefill
            // Says the quiet part out loud rather than letting them wonder why
            // the demo's clients are not here. They were told on the way in;
            // this is the reminder at the moment it becomes true.
            ? 'This is your real account — it starts empty, and the demo’s practice data stays behind.'
            : 'Start managing your clients and training plans'}
        </p>
      </div>
      <RegisterForm enabledOAuth={enabledOAuth} defaultCountry={geoCountry} prefill={prefill} />
    </div>
  )
}
