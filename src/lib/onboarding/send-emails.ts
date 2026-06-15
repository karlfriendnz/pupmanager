// Onboarding + trial email dispatcher.
//
// Drives BOTH sets of OnboardingEmail templates (activation + trial-process)
// off a single hourly cron tick (/api/cron/onboarding-emails). For every
// trainer that has an onboarding-progress row, each PUBLISHED template is
// evaluated against its triggerRule; eligible-and-not-yet-sent templates are
// rendered, emailed, and logged.
//
// Safety model:
//  - ONLY published templates (publishedAt != null) are ever sent. An empty
//    published set short-circuits to a no-op, so unpublishing everything turns
//    the whole system off while the cron keeps ticking harmlessly.
//  - TrainerOnboardingEmailLog has a unique (progressId, emailKey) — we log
//    AFTER a successful send, so a failed send retries next tick and a raced
//    tick can't double-send.
//  - Platform/demo addresses (@pupmanager.com) are skipped.

import { prisma } from '@/lib/prisma'
import { sendEmail, fromTrainer } from '@/lib/email'
import { escapeHtml } from '@/lib/enquiries'
import { getOnboardingState } from '@/lib/onboarding/state'
import { emailBodyToHtml, emailHtmlToText } from '@/lib/email-html'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.pupmanager.com'
const APP_STORE_URL = 'https://apps.apple.com/app/id6766399138'
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.pupmanager.app'
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
export const PLATFORM_DOMAIN = '@pupmanager.com'
// Deliver onboarding/trial emails in the trainer's morning. The cron ticks
// hourly (top of the hour); we only act during the trainer's 9 o'clock hour in
// their own timezone, so each trainer gets their batch once a day at ~9am local
// — and it tracks DST automatically (computed live, not a fixed UTC time).
const SEND_HOUR = 9

// Hour (0-23) right now in the given IANA timezone, or null if it's invalid.
function localHourIn(tz: string): number | null {
  try {
    const h = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date())
    const n = Number(h)
    return Number.isFinite(n) ? n % 24 : null
  } catch {
    return null
  }
}
// Drip activation cutoff. Trainers who signed up BEFORE this never enter the
// sequence — the system went live 2026-06-07 and we don't retro-blast the
// pre-launch cohort. Signups from this moment on (incl. that day's) get the
// drips normally. This replaces the old "backfill the email log" suppression,
// which wrongly inflated the admin "Emails sent" count. (NZ midnight = UTC+12.)
export const DRIP_ACTIVATION = new Date('2026-06-07T00:00:00+12:00')
// Addresses that should never receive onboarding/trial emails (test/junk accounts).
export const SUPPRESSED_RECIPIENTS = new Set(['t9rc8rb5j8@privaterelay.appleid.com'])

// Where replies to each founder voice land. Mirrors the addresses used by
// notify-new-trainer.ts.
const FOUNDER_REPLY_TO: Record<string, string> = {
  karl: 'karlfriend.nz@gmail.com',
  brooke: 'brookeallise@gmail.com',
}
const FOUNDER_NAME: Record<string, string> = { karl: 'Karl', brooke: 'Brooke' }

type Trigger = {
  type?: string
  hours?: number
  days?: number
  requireStepIncomplete?: string
  requireAhaNotReached?: boolean
  requireNoClientSignedIn?: boolean
}

type ProgressRow = {
  id: string
  trainerId: string
  startedAt: Date
  ahaReachedAt: Date | null
  firstInviteSentAt: Date | null
  trainer: {
    businessName: string
    subscriptionStatus: string
    trialEndsAt: Date | null
    isInternal: boolean
    user: { name: string | null; email: string | null; createdAt: Date; deactivatedAt: Date | null; timezone: string }
  } | null
}

async function isEligible(rule: Trigger, p: ProgressRow, now: number): Promise<boolean> {
  const t = p.trainer!
  switch (rule.type) {
    case 'on_signup':
      // Not-yet-sent is already guaranteed by the caller — fire on the next tick.
      return true

    case 'after_signup': {
      if (now < p.startedAt.getTime() + (rule.hours ?? 0) * HOUR_MS) return false
      if (rule.requireAhaNotReached && p.ahaReachedAt) return false
      if (rule.requireStepIncomplete) {
        const state = await getOnboardingState(p.trainerId)
        const step = state.steps.find(s => s.key === rule.requireStepIncomplete)
        if (step && step.status === 'completed') return false
      }
      return true
    }

    case 'after_first_invite_sent': {
      if (!p.firstInviteSentAt) return false
      if (now < p.firstInviteSentAt.getTime() + (rule.hours ?? 0) * HOUR_MS) return false
      if (rule.requireNoClientSignedIn && p.ahaReachedAt) return false
      return true
    }

    case 'on_aha_reached':
      return !!p.ahaReachedAt

    case 'trial_days_left': {
      if (t.subscriptionStatus !== 'TRIALING' || !t.trialEndsAt) return false
      const ms = t.trialEndsAt.getTime() - now
      if (ms <= 0) return false
      // Exact-day match: fires once during the 24h window for that threshold
      // (dedup via the email log keeps it to one send).
      return Math.ceil(ms / DAY_MS) === (rule.days ?? -1)
    }

    case 'trial_ended': {
      if (t.subscriptionStatus === 'ACTIVE' || !t.trialEndsAt) return false
      return now >= t.trialEndsAt.getTime()
    }

    default:
      return false
  }
}

function fillTokens(s: string, ctx: Record<string, string>): string {
  let out = s
  for (const [k, v] of Object.entries(ctx)) out = out.split(`{{${k}}}`).join(v)
  return out
}

// Renders one template into a PupManager-branded email matching the admin
// preview (teal strip → logo → optional top text → image at text width → body
// → footer). Card capped at 700px.
export function renderOnboardingEmail(
  tmpl: { subject: string; body: string; topText: string | null; imageUrl: string | null; imageHeight: number | null; linkUrl?: string | null; imageUrl2?: string | null; imageHeight2?: number | null; linkUrl2?: string | null; bottomText?: string | null; senderKey: string },
  ctx: Record<string, string>,
) {
  const subject = fillTokens(tmpl.subject, ctx)
  const topText = tmpl.topText?.trim() ? fillTokens(tmpl.topText, ctx) : ''
  const body = fillTokens(tmpl.body, ctx)
  const bottomText = tmpl.bottomText?.trim() ? fillTokens(tmpl.bottomText, ctx) : ''

  const topInner = topText ? emailBodyToHtml(topText) : ''
  const topHtml = topInner ? `<div style="padding:18px 28px 0;">${topInner}</div>` : ''
  // Shared image renderer for both blocks — height attribute over CSS height
  // because email clients (Gmail) honour the attribute far more reliably.
  const imageBlock = (url: string | null | undefined, height: number | null | undefined, link?: string | null): string => {
    if (!url) return ''
    const style = height
      ? `display:inline-block;height:${height}px;width:auto;max-width:100%;border:0;border-radius:12px;`
      : `display:block;width:100%;border:0;border-radius:12px;`
    const heightAttr = height ? ` height="${height}"` : ''
    const img = `<img src="${escapeHtml(url)}" alt=""${heightAttr} style="${style}" />`
    // Wrap in an anchor so the image is clickable when a link is set (tokens
    // like {{billingUrl}} are filled, same as the body).
    const href = link?.trim() ? fillTokens(link.trim(), ctx) : ''
    const inner = href ? `<a href="${escapeHtml(href)}" target="_blank" style="text-decoration:none;">${img}</a>` : img
    return `<div style="padding:16px 28px 0;text-align:center;">${inner}</div>`
  }
  const imageHtml = imageBlock(tmpl.imageUrl, tmpl.imageHeight, tmpl.linkUrl)
  const image2Html = imageBlock(tmpl.imageUrl2, tmpl.imageHeight2, tmpl.linkUrl2)
  const bottomHtml = bottomText ? `<div style="padding:18px 28px 8px;">${emailBodyToHtml(bottomText)}</div>` : ''

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8FAFC;">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:700px;">
          <tr>
            <td style="background:#ffffff;border-radius:18px;box-shadow:0 1px 3px rgba(15,23,42,0.04),0 8px 24px rgba(15,23,42,0.06);overflow:hidden;">
              <div style="height:4px;background:#2a9da9;"></div>
              <div style="padding:24px 28px 8px;text-align:center;">
                <img src="https://app.pupmanager.com/email-logo.png" alt="PupManager" width="190" style="display:inline-block;border:0;height:auto;max-width:190px;" />
              </div>
              ${topHtml}
              ${imageHtml}
              <div style="padding:18px 28px 8px;">${emailBodyToHtml(body)}</div>
              ${image2Html}
              ${bottomHtml}
              <div style="padding:18px 28px;background:#fafaf9;border-top:1px solid #f1f5f9;text-align:center;">
                <p style="margin:0 0 10px;font-size:12px;color:#64748b;line-height:1.5;">Get the PupManager app on your phone</p>
                <a href="${APP_STORE_URL}" style="display:inline-block;margin:0 3px;"><img src="https://app.pupmanager.com/app-store-badge.png" alt="Download on the App Store" width="135" height="45" style="border:0;height:45px;width:135px;" /></a>
                <a href="${PLAY_STORE_URL}" style="display:inline-block;margin:0 3px;"><img src="https://app.pupmanager.com/google-play-badge.png" alt="Get it on Google Play" width="135" height="45" style="border:0;height:45px;width:135px;" /></a>
                <p style="margin:12px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;">You're receiving this because you started a PupManager trial.</p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 8px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#333333;letter-spacing:0.04em;text-transform:uppercase;">
                <a href="https://pupmanager.com" style="color:#333333;text-decoration:none;font-weight:600;">PupManager</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  const text = [emailHtmlToText(topText), emailHtmlToText(body), emailHtmlToText(bottomText)].filter(Boolean).join('\n\n')

  const senderName = FOUNDER_NAME[tmpl.senderKey] ?? 'Karl'
  return {
    subject,
    html,
    text,
    from: fromTrainer(senderName),
    replyTo: FOUNDER_REPLY_TO[tmpl.senderKey] ?? FOUNDER_REPLY_TO.karl,
  }
}

export type OnboardingDispatchStats = {
  publishedTemplates: number
  trainersScanned: number
  evaluated: number
  sent: number
  skipped: number
  errors: number
}

export async function runOnboardingEmailDispatch(): Promise<OnboardingDispatchStats> {
  const published = await prisma.onboardingEmail.findMany({ where: { publishedAt: { not: null } } })
  const base: OnboardingDispatchStats = { publishedTemplates: published.length, trainersScanned: 0, evaluated: 0, sent: 0, skipped: 0, errors: 0 }
  if (published.length === 0) return base // everything unpublished → no-op

  const now = Date.now()
  const progresses = await prisma.trainerOnboardingProgress.findMany({
    select: {
      id: true,
      trainerId: true,
      startedAt: true,
      ahaReachedAt: true,
      firstInviteSentAt: true,
      emails: { select: { emailKey: true } },
      trainer: {
        select: {
          businessName: true,
          subscriptionStatus: true,
          trialEndsAt: true,
          isInternal: true,
          user: { select: { name: true, email: true, createdAt: true, deactivatedAt: true, timezone: true } },
        },
      },
    },
  })

  base.trainersScanned = progresses.length

  for (const p of progresses) {
    const t = p.trainer
    const email = t?.user?.email
    if (!email || email.toLowerCase().endsWith(PLATFORM_DOMAIN) || SUPPRESSED_RECIPIENTS.has(email.toLowerCase())) continue
    // Only "proper" trainers: skip internal/test ("Ours") accounts and any
    // deactivated (soft-deleted) account.
    if (t!.isInternal || t!.user.deactivatedAt) continue
    // Pre-launch cohort: never enter the sequence. Keyed off the onboarding
    // start (set on first dashboard load), NOT the immutable signup date — so
    // an admin can re-enrol a trainer "as if starting today" by resetting
    // TrainerOnboardingProgress.startedAt to now.
    if (p.startedAt < DRIP_ACTIVATION) continue
    // Time-based drips (nudges/chases) are delivered in the trainer's morning —
    // only during their local 9am hour. The welcome (on_signup) is EXEMPT so it
    // lands right after signup, going out on the next hourly tick instead of
    // waiting until the next morning. Gate is applied per-template below.
    const isSendHour = localHourIn(t!.user.timezone || 'Pacific/Auckland') === SEND_HOUR

    const alreadySent = new Set(p.emails.map(e => e.emailKey))
    const firstName = t!.user.name?.split(' ')[0]?.trim() || 'there'
    const daysLeft = t!.trialEndsAt ? Math.max(0, Math.ceil((t!.trialEndsAt.getTime() - now) / DAY_MS)) : 0
    const ctx: Record<string, string> = {
      trainerName: firstName,
      businessName: t!.businessName,
      daysLeft: String(daysLeft),
      trialEndDate: t!.trialEndsAt ? t!.trialEndsAt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : '',
      billingUrl: `${APP_URL}/billing/setup`,
    }

    for (const tmpl of published) {
      if (alreadySent.has(tmpl.key)) continue
      const rule = tmpl.triggerRule as Trigger
      // Welcome (on_signup) sends any hour; everything else waits for the
      // trainer's 9am window. Skip non-immediate templates outside that window.
      const immediate = rule.type === 'on_signup'
      if (!immediate && !isSendHour) continue
      base.evaluated++
      if (!(await isEligible(rule, p as ProgressRow, now))) {
        base.skipped++
        continue
      }
      try {
        const r = renderOnboardingEmail(tmpl, ctx)
        await sendEmail({ to: email, subject: r.subject, html: r.html, text: r.text, from: r.from, replyTo: r.replyTo })
        // Log only after a successful send; unique (progressId, emailKey) guards races.
        await prisma.trainerOnboardingEmailLog.create({ data: { progressId: p.id, emailKey: tmpl.key } }).catch(() => {})
        base.sent++
      } catch (err) {
        console.error(`[onboarding-emails] send failed (${tmpl.key} → ${email}):`, err)
        base.errors++
      }
    }
  }

  return base
}
