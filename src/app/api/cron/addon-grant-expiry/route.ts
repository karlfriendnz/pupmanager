import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import { addonById } from '@/lib/pricing'
import { escapeHtml } from '@/lib/html-escape'

// Daily job: warn a trainer 2 days before an admin-granted free add-on trial
// lapses. Wired via Supabase pg_cron + pg_net (never vercel.json) — same
// Bearer/CRON_SECRET auth as the other cron routes. Idempotent: each grant is
// emailed once per expiry (expiryReminderSentAt), and the admin route resets
// that stamp whenever the expiry is changed, so an extended comp re-warns.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const DAY_MS = 24 * 60 * 60 * 1000

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const now = new Date()
  const windowEnd = new Date(now.getTime() + 2 * DAY_MS)

  // Comps entering the final 2 days that haven't been warned yet. Skip internal
  // (our own test) accounts.
  const due = await prisma.trainerAddon.findMany({
    where: {
      grantedByAdmin: true,
      active: true,
      expiryReminderSentAt: null,
      expiresAt: { gt: now, lte: windowEnd },
      trainer: { isInternal: false },
    },
    select: {
      id: true,
      itemId: true,
      expiresAt: true,
      trainer: { select: { businessName: true, user: { select: { email: true, name: true } } } },
    },
  })

  let sent = 0
  for (const g of due) {
    const email = g.trainer?.user?.email
    if (!email || !g.expiresAt) continue
    const name = addonById(g.itemId)?.name ?? g.itemId
    const daysLeft = Math.max(1, Math.ceil((g.expiresAt.getTime() - now.getTime()) / DAY_MS))
    const first = (g.trainer?.user?.name || g.trainer?.businessName || '').split(' ')[0]

    try {
      await sendEmail({
        to: email,
        subject: `Your free ${name} trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
        html: reminderHtml({ first, addonName: name, daysLeft }),
        text: reminderText({ first, addonName: name, daysLeft }),
      })
      await prisma.trainerAddon.update({ where: { id: g.id }, data: { expiryReminderSentAt: now } })
      sent++
    } catch (e) {
      // One bad send shouldn't stop the batch — retried next run (stamp unset).
      console.error('addon-grant-expiry: failed to email', g.id, e)
    }
  }

  return NextResponse.json({ scanned: due.length, sent })
}

function reminderText({ first, addonName, daysLeft }: { first: string; addonName: string; daysLeft: number }): string {
  const hi = first ? `Hi ${first},` : 'Hi,'
  return `${hi}

Your free trial of ${addonName} ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. After that it switches off automatically — you won't be charged.

Want to keep it? Turn it on any time from Settings → Add-ons.

— The PupManager team`
}

function reminderHtml({ first, addonName, daysLeft }: { first: string; addonName: string; daysLeft: number }): string {
  const hi = first ? `Hi ${escapeHtml(first)},` : 'Hi,'
  const addon = escapeHtml(addonName)
  const days = `${daysLeft} day${daysLeft === 1 ? '' : 's'}`
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.6;max-width:520px;margin:0 auto;padding:8px">
  <p>${hi}</p>
  <p>Your free trial of <strong>${addon}</strong> ends in <strong>${days}</strong>. After that it switches off automatically — <strong>you won't be charged</strong>.</p>
  <p>Enjoying it? You can keep ${addon} on any time from <strong>Settings → Add-ons</strong>.</p>
  <p style="color:#475569">— The PupManager team</p>
</div>`
}
