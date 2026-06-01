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
const PLATFORM_DOMAIN = '@pupmanager.com'

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
    user: { name: string | null; email: string | null }
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
  tmpl: { subject: string; body: string; topText: string | null; imageUrl: string | null; imageHeight: number | null; senderKey: string },
  ctx: Record<string, string>,
) {
  const subject = fillTokens(tmpl.subject, ctx)
  const topText = tmpl.topText?.trim() ? fillTokens(tmpl.topText, ctx) : ''
  const body = fillTokens(tmpl.body, ctx)

  const topInner = topText ? emailBodyToHtml(topText) : ''
  const topHtml = topInner ? `<div style="padding:18px 28px 0;">${topInner}</div>` : ''
  const imgStyle = tmpl.imageHeight
    ? `display:block;height:${tmpl.imageHeight}px;width:auto;max-width:100%;margin:0 auto;border:0;border-radius:12px;`
    : `display:block;width:100%;border:0;border-radius:12px;`
  const imageHtml = tmpl.imageUrl
    ? `<div style="padding:16px 28px 0;text-align:center;"><img src="${escapeHtml(tmpl.imageUrl)}" alt="" style="${imgStyle}" /></div>`
    : ''

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

  const text = [emailHtmlToText(topText), emailHtmlToText(body)].filter(Boolean).join('\n\n')

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
          user: { select: { name: true, email: true } },
        },
      },
    },
  })

  base.trainersScanned = progresses.length

  for (const p of progresses) {
    const t = p.trainer
    const email = t?.user?.email
    if (!email || email.toLowerCase().endsWith(PLATFORM_DOMAIN)) continue

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
      base.evaluated++
      if (!(await isEligible(tmpl.triggerRule as Trigger, p as ProgressRow, now))) {
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
