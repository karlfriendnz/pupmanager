import { prisma } from './prisma'
import { sendEmail } from './email'
import { escapeHtml } from './html-escape'

// Internal heads-up when a business converts from trial to paying. Goes to the
// PupManager team, never to the customer.
//
// Fired from the Stripe webhook the first time a subscription reaches ACTIVE —
// i.e. money actually moved. Deliberately NOT fired when someone merely
// completes checkout, because we carry their remaining free-trial days into
// Stripe, so a brand-new subscriber sits at `trialing` for a while first.
const RECIPIENTS = ['info@pupmanager.com', 'brooke@pupmanager.com']

/**
 * Tell the team a business just started paying — exactly once, ever.
 *
 * Idempotency is a conditional write, not a read-then-write: `updateMany` with
 * `convertedAt: null` in the WHERE means only one caller can ever win, so
 * Stripe's webhook retries (and the several subscription.updated events that
 * follow a conversion) can't produce duplicate emails.
 *
 * Best-effort: a failed send is logged, never thrown — a flaky Resend must not
 * make us 500 at Stripe and trigger yet more retries.
 */
export async function notifyConversion(trainerId: string): Promise<void> {
  try {
    const claimed = await prisma.trainerProfile.updateMany({
      where: { id: trainerId, convertedAt: null },
      data: { convertedAt: new Date() },
    })
    if (claimed.count === 0) return // already announced

    const t = await prisma.trainerProfile.findUnique({
      where: { id: trainerId },
      select: {
        businessName: true,
        payoutCurrency: true,
        seatCount: true,
        signupCountry: true,
        createdAt: true,
        subscriptionPlan: { select: { name: true, priceMonthly: true } },
        user: { select: { name: true, email: true } },
        _count: { select: { clients: true } },
      },
    })
    if (!t) return

    const cur = (t.payoutCurrency ?? 'nzd').toUpperCase()
    const daysToConvert = Math.max(
      0,
      Math.round((Date.now() - t.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
    )

    const rows: [string, string][] = [
      ['Business', t.businessName],
      ['Owner', `${t.user.name ?? '—'} (${t.user.email})`],
      ['Plan', t.subscriptionPlan?.name ?? 'Core software'],
      ['Currency', cur],
      ['Seats', String(t.seatCount)],
      ['Clients', String(t._count.clients)],
      ['Country', t.signupCountry ?? '—'],
      ['Signed up', `${t.createdAt.toISOString().slice(0, 10)} (${daysToConvert} days to convert)`],
    ]

    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:28px 16px;">
        <h2 style="color:#0f172a;margin:0 0 4px;">🎉 ${escapeHtml(t.businessName)} just went paid</h2>
        <p style="color:#475569;margin:0 0 20px;">Their first payment has gone through — they're a paying customer now.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          ${rows.map(([k, v]) => `
            <tr>
              <td style="padding:7px 0;color:#94a3b8;width:120px;">${escapeHtml(k)}</td>
              <td style="padding:7px 0;color:#0f172a;font-weight:600;">${escapeHtml(v)}</td>
            </tr>`).join('')}
        </table>
        <p style="color:#94a3b8;font-size:12px;margin-top:24px;">
          Sent once per business, the first time their subscription goes active.
        </p>
      </div>`

    await sendEmail({
      to: RECIPIENTS,
      subject: `💰 ${t.businessName} converted to paid (${cur})`,
      html,
    })
  } catch (err) {
    console.error('[conversion alert] failed for', trainerId, err)
  }
}
