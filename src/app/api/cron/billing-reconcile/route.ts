import { NextResponse } from 'next/server'

import { reconcileBilling, type Finding } from '@/lib/billing-reconcile'
import { sendEmail } from '@/lib/email'
import { escapeHtml } from '@/lib/html-escape'

/**
 * Daily: does Stripe agree with what we think we are billing?
 *
 * Nothing checked, and the gap cost a customer real money. Mersea Mutts held
 * TWO live subscriptions from 21 and 25 July and paid both. Our data showed
 * one, because the billing webhook writes `stripeSubscriptionId` from whatever
 * subscription it last heard about — so the second one's events replaced our
 * reference to the first, and the first carried on charging with nothing
 * pointing at it. Ten days. The only trace was a second PDF in an inbox.
 *
 * The checks live in lib/billing-reconcile so this job and the admin screen run
 * the SAME ones. Two implementations of "is this customer billed twice" would
 * eventually disagree, and the one nobody reads would be the one that was right.
 *
 * Read-only. Which half of a duplicated pair to keep depends on what each has
 * already charged, so it reports and does not act.
 *
 * Wired via Supabase pg_cron + pg_net (never vercel.json), same Bearer secret as
 * every other cron route. NOTE: adding it to scripts/setup-supabase-crons.ts is
 * not the same as scheduling it — that script has to be RUN.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const RECIPIENTS = ['info@pupmanager.com', 'brooke@pupmanager.com']

function row(f: Finding): string {
  const colour = f.kind === 'DUPLICATE' ? '#b91c1c' : f.kind === 'ORPHAN' ? '#c2410c' : '#92400e'
  return (
    `<tr>` +
    `<td style="padding:6px 10px;font-weight:700;color:${colour};white-space:nowrap">${f.kind}</td>` +
    `<td style="padding:6px 10px">${escapeHtml(f.who)}</td>` +
    `<td style="padding:6px 10px">${escapeHtml(f.detail)}</td>` +
    `</tr>`
  )
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const result = await reconcileBilling()

  if (result.findings.length > 0) {
    await sendEmail({
      to: RECIPIENTS,
      subject: result.duplicates
        ? `🚨 ${result.duplicates} customer(s) being billed twice`
        : `Billing reconcile — ${result.findings.length} thing(s) to look at`,
      html:
        `<p>Stripe and PupManager disagree about ${result.findings.length} subscription(s).</p>` +
        `<table style="border-collapse:collapse;font:14px system-ui">${result.findings.map(row).join('')}</table>` +
        `<p style="color:#64748b;font-size:12px">A DUPLICATE means money is being taken more than once, now. ` +
        `Cancel the wrong one in Stripe and refund what it took — which one is wrong depends on what each has ` +
        `already charged, so this job will not guess. Cancelling is safe: the webhook moves the trainer to the ` +
        `surviving subscription rather than marking them cancelled.</p>`,
      alwaysSend: true,
    })
  }

  return NextResponse.json({ ok: true, ...result })
}
