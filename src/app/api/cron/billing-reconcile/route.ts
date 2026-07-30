import { NextResponse } from 'next/server'

import { sendEmail } from '@/lib/email'
import { escapeHtml } from '@/lib/html-escape'
import { prisma } from '@/lib/prisma'
import { stripeFor } from '@/lib/stripe'

/**
 * Daily: does Stripe agree with what we think we are billing?
 *
 * Nothing checked this, and the gap it left cost a customer real money. Mersea
 * Mutts held TWO live subscriptions from 21 and 25 July and paid both. Our data
 * showed one, because the billing webhook writes `stripeSubscriptionId` from
 * whatever subscription it last heard about — so the second one's events simply
 * replaced our reference to the first, and the first carried on charging with
 * nothing in our data pointing at it. Ten days. The only trace was a second PDF
 * in somebody's inbox.
 *
 * The checkout guard now refuses to open a second subscription and the webhook
 * shouts when one displaces another, but neither repairs a pair that already
 * exists, and neither would notice one created outside the app — in the Stripe
 * Dashboard, or by a migration script. This does: it asks STRIPE what it holds
 * and complains when that disagrees with us.
 *
 * Three findings, worst first:
 *
 *   DUPLICATE  more than one live subscription on one customer. Money is being
 *              taken twice, right now.
 *   ORPHAN     a live subscription in Stripe that no trainer row points at —
 *              billing somebody we are not tracking.
 *   MISMATCH   we name a subscription Stripe considers dead, or we name none
 *              while Stripe has a live one.
 *
 * Read-only. It cancels nothing and refunds nothing: which subscription of a
 * duplicated pair to keep depends on what each one has already charged, and
 * that is a judgement, not a rule. It emails the team and says which is which.
 *
 * Wired via Supabase pg_cron + pg_net (never vercel.json), same Bearer secret
 * as every other cron route. Add to scripts/setup-supabase-crons.ts and RUN it
 * — a job that is only in that list has never been scheduled.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const RECIPIENTS = ['info@pupmanager.com', 'brooke@pupmanager.com']
const LIVE_STATUSES = ['active', 'trialing', 'past_due', 'unpaid']

type Finding = { kind: 'DUPLICATE' | 'ORPHAN' | 'MISMATCH'; who: string; detail: string }

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const stripe = stripeFor(false) // live mode only; sandbox trainers bill in test
  const findings: Finding[] = []

  // Every live subscription Stripe holds, grouped by customer. Walked from
  // STRIPE's side rather than ours precisely so a subscription we have no row
  // for still shows up — that is the orphan case, and iterating our own
  // trainers could never find it.
  const byCustomer = new Map<string, { id: string; status: string; created: number }[]>()
  for await (const sub of stripe.subscriptions.list({ status: 'all', limit: 100 })) {
    if (!LIVE_STATUSES.includes(sub.status)) continue
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
    byCustomer.set(customerId, [
      ...(byCustomer.get(customerId) ?? []),
      { id: sub.id, status: sub.status, created: sub.created },
    ])
  }

  const trainers = await prisma.trainerProfile.findMany({
    where: { sandboxBilling: false, isInternal: false },
    select: {
      id: true, businessName: true, stripeCustomerId: true,
      stripeSubscriptionId: true, subscriptionStatus: true,
    },
  })
  const byStripeCustomer = new Map(
    trainers.filter(t => t.stripeCustomerId).map(t => [t.stripeCustomerId as string, t]),
  )

  for (const [customerId, subs] of byCustomer) {
    const trainer = byStripeCustomer.get(customerId)
    const who = trainer?.businessName ?? `(no trainer row) ${customerId}`

    if (subs.length > 1) {
      const oldestFirst = [...subs].sort((a, b) => a.created - b.created)
      findings.push({
        kind: 'DUPLICATE',
        who,
        detail:
          `${subs.length} live subscriptions on ${customerId}: ` +
          oldestFirst
            .map(s => `${s.id} (${s.status}, created ${new Date(s.created * 1000).toISOString().slice(0, 10)})`)
            .join(' AND ') +
          `. This customer is being charged more than once.`,
      })
    }

    if (!trainer) {
      findings.push({
        kind: 'ORPHAN',
        who,
        detail: `Stripe is billing ${customerId} (${subs.map(s => s.id).join(', ')}) but no trainer row has that customer id.`,
      })
      continue
    }

    const liveIds = subs.map(s => s.id)
    if (trainer.stripeSubscriptionId && !liveIds.includes(trainer.stripeSubscriptionId)) {
      findings.push({
        kind: 'MISMATCH',
        who,
        detail:
          `We hold ${trainer.stripeSubscriptionId} (we say ${trainer.subscriptionStatus}), but Stripe's live ` +
          `subscription${liveIds.length > 1 ? 's are' : ' is'} ${liveIds.join(', ')}.`,
      })
    }
    if (!trainer.stripeSubscriptionId) {
      findings.push({
        kind: 'MISMATCH',
        who,
        detail: `Stripe has a live subscription (${liveIds.join(', ')}) but we hold none — add-ons and seats would have nothing to attach to.`,
      })
    }
  }

  // The other direction: we claim a subscription Stripe has no live record of.
  for (const t of trainers) {
    if (!t.stripeSubscriptionId || !t.stripeCustomerId) continue
    if (byCustomer.has(t.stripeCustomerId)) continue
    if (t.subscriptionStatus === 'CANCELLED') continue
    findings.push({
      kind: 'MISMATCH',
      who: t.businessName,
      detail: `We say ${t.subscriptionStatus} on ${t.stripeSubscriptionId}, but Stripe has no live subscription for ${t.stripeCustomerId}.`,
    })
  }

  const order = { DUPLICATE: 0, ORPHAN: 1, MISMATCH: 2 } as const
  findings.sort((a, b) => order[a.kind] - order[b.kind])
  const duplicates = findings.filter(f => f.kind === 'DUPLICATE').length

  if (findings.length > 0) {
    const rows = findings
      .map(
        f =>
          `<tr><td style="padding:6px 10px;font-weight:700;color:${f.kind === 'DUPLICATE' ? '#b91c1c' : '#92400e'}">${f.kind}</td>` +
          `<td style="padding:6px 10px">${escapeHtml(f.who)}</td>` +
          `<td style="padding:6px 10px">${escapeHtml(f.detail)}</td></tr>`,
      )
      .join('')
    await sendEmail({
      to: RECIPIENTS,
      subject: duplicates
        ? `🚨 ${duplicates} customer(s) being billed twice`
        : `Billing reconcile — ${findings.length} thing(s) to look at`,
      html:
        `<p>Stripe and PupManager disagree about ${findings.length} subscription(s).</p>` +
        `<table style="border-collapse:collapse;font:14px system-ui">${rows}</table>` +
        `<p style="color:#64748b;font-size:12px">A DUPLICATE means money is being taken more than once, now. ` +
        `Cancel the wrong one in Stripe and refund what it took — which one is wrong depends on what each has ` +
        `already charged, so this job will not guess.</p>`,
      alwaysSend: true,
    })
  }

  return NextResponse.json({
    ok: true,
    customersWithLiveSubscriptions: byCustomer.size,
    trainersChecked: trainers.length,
    findings: findings.length,
    duplicates,
    detail: findings,
  })
}
