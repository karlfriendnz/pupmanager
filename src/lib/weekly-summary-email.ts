// Renders the Sunday-evening "your week" email. Two tables — what you
// did, what's coming up — wrapped in a branded shell with a warm
// founder-voice intro that flexes based on how the week went, plus a
// short outro encouraging the trainer back into the app.
//
// All HTML is inline-styled, table-driven where layout matters, and
// safe across Gmail / Apple Mail / Outlook (no flexbox, no external
// stylesheets). The PupManager logo lives on the platform domain so
// we can reference it absolutely from the email.

import { escapeHtml } from './enquiries'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.pupmanager.com'

export interface SessionRow {
  scheduledAt: Date
  title: string
  durationMins: number
  status: 'UPCOMING' | 'COMPLETED' | 'COMMENTED' | 'CANCELLED'
  invoicedAt: Date | null
  hasNotes: boolean
  clientName: string | null
  dogName: string | null
  packageName: string | null
}

export interface TaskRow {
  date: Date
  title: string
  clientName: string | null
  dogName: string | null
}

export interface WeeklySummaryData {
  weekStart: Date          // Mon 00:00
  weekEnd: Date            // Sun 23:59
  nextWeekStart: Date
  nextWeekEnd: Date
  trainerFirstName: string
  businessName: string
  sessionsCompleted: SessionRow[]
  revenueCents: number
  nextWeekSessions: SessionRow[]
  nextWeekTasks: TaskRow[]
  tz: string
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export function renderWeeklySummaryEmail(d: WeeklySummaryData): RenderedEmail {
  const completedCount = d.sessionsCompleted.length
  const revenueLabel = d.revenueCents > 0 ? formatCents(d.revenueCents) : null
  const upcomingCount = d.nextWeekSessions.length
  const taskCount = d.nextWeekTasks.length

  const intro = chooseIntro(completedCount, revenueLabel, d.trainerFirstName)
  const outro = chooseOutro(upcomingCount, taskCount)
  const dateRange = `${formatShortDate(d.weekStart, d.tz)} – ${formatShortDate(d.weekEnd, d.tz)}`
  const nextRange = `${formatShortDate(d.nextWeekStart, d.tz)} – ${formatShortDate(d.nextWeekEnd, d.tz)}`

  const subject = completedCount === 0
    ? `Your week — ${dateRange} (a quiet one)`
    : `Your week — ${completedCount} session${completedCount === 1 ? '' : 's'} done${revenueLabel ? `, ${revenueLabel} earned` : ''}`

  const text = renderText(d, { intro, outro, dateRange, nextRange })
  const html = renderHtml(d, { intro, outro, dateRange, nextRange, subject, completedCount, revenueLabel, upcomingCount, taskCount })

  return { subject, html, text }
}

// ─── Copy variations ────────────────────────────────────────────────────────

function chooseIntro(completed: number, revenue: string | null, name: string): string {
  if (completed === 0) {
    return `${name}, this week was on the quieter side — and that's totally fine. Some weeks are about resting up, some are about building the next thing. Let's pick the right move below.`
  }
  if (completed >= 12) {
    return `${name}, that's a serious week. ${completed} sessions done${revenue ? ` and ${revenue} in the door` : ''} — your dogs (and clients) are lucky to have you. Sunday's for stretching out the back; here's the snapshot.`
  }
  if (completed >= 6) {
    return `Solid week, ${name}. ${completed} sessions in the bag${revenue ? ` and ${revenue} earned` : ''}. The little wins stack up — here's what they look like.`
  }
  return `Hey ${name}, here's how your week landed. ${completed} session${completed === 1 ? '' : 's'} completed${revenue ? `, ${revenue} earned` : ''}. Every one moves a dog forward.`
}

function chooseOutro(upcomingSessions: number, upcomingTasks: number): string {
  if (upcomingSessions === 0 && upcomingTasks === 0) {
    return `Nothing on the calendar yet for next week — perfect chance to send out a quick "hey, time to lock in your next session?" to a couple of clients tomorrow morning.`
  }
  if (upcomingSessions >= 8) {
    return `Big week ahead — block out a coffee window or two between sessions, you'll need it. We'll be here when you're back.`
  }
  if (upcomingSessions === 0 && upcomingTasks > 0) {
    return `No sessions booked yet but ${upcomingTasks} task${upcomingTasks === 1 ? '' : 's'} on the go for clients — those quiet wins compound. See you Monday.`
  }
  return `Have a good Sunday evening — kick back, reset, and we'll catch you Monday. The dogs are in good hands.`
}

// ─── Layout helpers ─────────────────────────────────────────────────────────

interface RenderCtx {
  intro: string
  outro: string
  dateRange: string
  nextRange: string
}

interface RenderHtmlCtx extends RenderCtx {
  subject: string
  completedCount: number
  revenueLabel: string | null
  upcomingCount: number
  taskCount: number
}

function renderHtml(d: WeeklySummaryData, ctx: RenderHtmlCtx): string {
  const completedRows = ctx.completedCount === 0
    ? `<tr><td colspan="4" style="padding:18px 16px;font-size:13px;color:#94a3b8;text-align:center;">No completed sessions this week.</td></tr>`
    : d.sessionsCompleted
        .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
        .map(s => sessionRowHtml(s, d.tz, 'done'))
        .join('')

  const upcomingSessionRows = ctx.upcomingCount === 0
    ? `<tr><td colspan="4" style="padding:18px 16px;font-size:13px;color:#94a3b8;text-align:center;">No sessions booked yet.</td></tr>`
    : d.nextWeekSessions
        .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
        .map(s => sessionRowHtml(s, d.tz, 'next'))
        .join('')

  const taskRows = ctx.taskCount === 0
    ? `<tr><td colspan="3" style="padding:18px 16px;font-size:13px;color:#94a3b8;text-align:center;">No tasks scheduled for next week.</td></tr>`
    : d.nextWeekTasks
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .slice(0, 12)
        .map(t => taskRowHtml(t, d.tz))
        .join('')

  const revenuePill = ctx.revenueLabel
    ? `<span style="display:inline-block;margin:6px 4px;padding:6px 12px;border-radius:999px;background:#ecfdf5;color:#047857;font-size:13px;font-weight:600;">${escapeHtml(ctx.revenueLabel)} earned</span>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(ctx.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${ctx.completedCount} sessions, ${ctx.upcomingCount} coming up.</div>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8FAFC;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:600px;">
          <tr>
            <td style="background:#ffffff;border-radius:18px;box-shadow:0 1px 3px rgba(15,23,42,0.04),0 8px 24px rgba(15,23,42,0.06);overflow:hidden;">
              <!-- Header with logo + accent strip -->
              <div style="height:4px;background:linear-gradient(to right,#2563eb,#6366f1,#7c3aed);"></div>
              <div style="padding:28px 32px 8px;text-align:center;">
                <img src="${APP_URL}/logo.png" alt="PupManager" width="56" height="56" style="display:inline-block;border:0;border-radius:14px;" />
                <p style="margin:14px 0 0;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#94a3b8;">Sunday wrap-up · ${escapeHtml(ctx.dateRange)}</p>
                <h1 style="margin:8px 0 0;font-size:26px;font-weight:700;color:#0f172a;line-height:1.2;">Your week, ${escapeHtml(d.trainerFirstName)}.</h1>
                <div style="margin-top:10px;">
                  <span style="display:inline-block;margin:6px 4px;padding:6px 12px;border-radius:999px;background:#eef2ff;color:#4338ca;font-size:13px;font-weight:600;">${ctx.completedCount} session${ctx.completedCount === 1 ? '' : 's'} done</span>
                  ${revenuePill}
                  <span style="display:inline-block;margin:6px 4px;padding:6px 12px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:13px;font-weight:600;">${ctx.upcomingCount} coming up</span>
                </div>
              </div>

              <!-- Intro -->
              <div style="padding:18px 32px 0;">
                <p style="margin:0;font-size:15px;line-height:1.6;color:#0f172a;">${escapeHtml(ctx.intro)}</p>
              </div>

              <!-- What you did -->
              <div style="padding:24px 32px 0;">
                <h2 style="margin:0 0 10px;font-size:14px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#475569;">What you did</h2>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                  <thead>
                    <tr style="background:#f8fafc;">
                      <th align="left" style="padding:10px 12px;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0;">When</th>
                      <th align="left" style="padding:10px 12px;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0;">Client &amp; dog</th>
                      <th align="left" style="padding:10px 12px;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0;">Session</th>
                      <th align="left" style="padding:10px 12px;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0;">Status</th>
                    </tr>
                  </thead>
                  <tbody>${completedRows}</tbody>
                </table>
              </div>

              <!-- Coming up -->
              <div style="padding:24px 32px 0;">
                <h2 style="margin:0 0 10px;font-size:14px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#475569;">What's coming up · ${escapeHtml(ctx.nextRange)}</h2>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                  <thead>
                    <tr style="background:#f8fafc;">
                      <th align="left" style="padding:10px 12px;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0;">When</th>
                      <th align="left" style="padding:10px 12px;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0;">Client &amp; dog</th>
                      <th align="left" style="padding:10px 12px;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0;">Session</th>
                      <th align="left" style="padding:10px 12px;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0;">Length</th>
                    </tr>
                  </thead>
                  <tbody>${upcomingSessionRows}</tbody>
                </table>
              </div>

              <!-- Tasks -->
              <div style="padding:20px 32px 0;">
                <h2 style="margin:0 0 10px;font-size:14px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#475569;">Tasks on the go</h2>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                  <thead>
                    <tr style="background:#f8fafc;">
                      <th align="left" style="padding:10px 12px;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0;">When</th>
                      <th align="left" style="padding:10px 12px;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0;">Client &amp; dog</th>
                      <th align="left" style="padding:10px 12px;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0;">Task</th>
                    </tr>
                  </thead>
                  <tbody>${taskRows}</tbody>
                </table>
                ${ctx.taskCount > 12 ? `<p style="margin:8px 0 0;font-size:11px;color:#94a3b8;text-align:right;">Showing 12 of ${ctx.taskCount} — see the rest in the app.</p>` : ''}
              </div>

              <!-- Outro + CTA -->
              <div style="padding:24px 32px 8px;">
                <p style="margin:0;font-size:15px;line-height:1.6;color:#0f172a;">${escapeHtml(ctx.outro)}</p>
              </div>
              <div style="padding:8px 32px 28px;text-align:center;">
                <a href="${APP_URL}/dashboard" style="display:inline-block;padding:12px 22px;border-radius:12px;background:linear-gradient(to right,#2563eb,#6366f1,#7c3aed);color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">Open this week →</a>
              </div>

              <!-- Footer -->
              <div style="padding:18px 32px;background:#fafaf9;border-top:1px solid #f1f5f9;">
                <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5;">
                  ${escapeHtml(d.businessName)} · weekly wrap from PupManager. Adjust which channels (push / email) get this in <a href="${APP_URL}/settings#notifications" style="color:#475569;font-weight:600;text-decoration:none;">notification settings</a>.
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 8px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#333333;letter-spacing:0.04em;text-transform:uppercase;">
                Sent with <a href="https://pupmanager.com" style="color:#333333;text-decoration:none;font-weight:600;">PupManager</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function sessionRowHtml(s: SessionRow, tz: string, kind: 'done' | 'next'): string {
  const when = formatDateTimeShort(s.scheduledAt, tz)
  const who = [s.dogName, s.clientName].filter(Boolean).join(' · ')
  const dur = `${s.durationMins} min`

  let statusCell: string
  if (kind === 'done') {
    if (s.invoicedAt && s.hasNotes) {
      statusCell = pill('Wrapped', '#ecfdf5', '#047857')
    } else if (s.invoicedAt) {
      statusCell = pill('Invoiced · notes due', '#fef3c7', '#92400e')
    } else if (s.hasNotes) {
      statusCell = pill('Notes done · invoice due', '#fef3c7', '#92400e')
    } else {
      statusCell = pill('To wrap up', '#fee2e2', '#991b1b')
    }
  } else {
    statusCell = escapeHtml(dur)
  }

  return `<tr>
    <td style="padding:10px 12px;font-size:13px;color:#0f172a;border-bottom:1px solid #f1f5f9;vertical-align:top;white-space:nowrap;">${escapeHtml(when)}</td>
    <td style="padding:10px 12px;font-size:13px;color:#0f172a;border-bottom:1px solid #f1f5f9;vertical-align:top;">${escapeHtml(who || '—')}</td>
    <td style="padding:10px 12px;font-size:13px;color:#475569;border-bottom:1px solid #f1f5f9;vertical-align:top;">${escapeHtml(s.title)}${s.packageName ? `<br><span style="font-size:11px;color:#94a3b8;">${escapeHtml(s.packageName)}</span>` : ''}</td>
    <td style="padding:10px 12px;font-size:13px;border-bottom:1px solid #f1f5f9;vertical-align:top;">${statusCell}</td>
  </tr>`
}

function taskRowHtml(t: TaskRow, tz: string): string {
  const when = formatShortDate(t.date, tz)
  const who = [t.dogName, t.clientName].filter(Boolean).join(' · ')
  return `<tr>
    <td style="padding:10px 12px;font-size:13px;color:#0f172a;border-bottom:1px solid #f1f5f9;vertical-align:top;white-space:nowrap;">${escapeHtml(when)}</td>
    <td style="padding:10px 12px;font-size:13px;color:#0f172a;border-bottom:1px solid #f1f5f9;vertical-align:top;">${escapeHtml(who || '—')}</td>
    <td style="padding:10px 12px;font-size:13px;color:#475569;border-bottom:1px solid #f1f5f9;vertical-align:top;">${escapeHtml(t.title)}</td>
  </tr>`
}

function pill(label: string, bg: string, fg: string): string {
  return `<span style="display:inline-block;padding:3px 8px;border-radius:999px;background:${bg};color:${fg};font-size:11px;font-weight:600;">${escapeHtml(label)}</span>`
}

// ─── Plain-text fallback ────────────────────────────────────────────────────
// Email clients without HTML support, plus accessibility readers, use this.
// Mirrors the HTML structure but flat — no boxes, no colour.
function renderText(d: WeeklySummaryData, ctx: RenderCtx): string {
  const lines: string[] = []
  lines.push(`Your week — ${ctx.dateRange}`)
  lines.push('')
  lines.push(ctx.intro)
  lines.push('')
  lines.push('— What you did —')
  if (d.sessionsCompleted.length === 0) {
    lines.push('No completed sessions this week.')
  } else {
    for (const s of d.sessionsCompleted.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())) {
      const who = [s.dogName, s.clientName].filter(Boolean).join(' · ')
      lines.push(`• ${formatDateTimeShort(s.scheduledAt, d.tz)} — ${who || '—'} — ${s.title}`)
    }
  }
  lines.push('')
  lines.push(`— Coming up · ${ctx.nextRange} —`)
  if (d.nextWeekSessions.length === 0) {
    lines.push('No sessions booked yet.')
  } else {
    for (const s of d.nextWeekSessions.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())) {
      const who = [s.dogName, s.clientName].filter(Boolean).join(' · ')
      lines.push(`• ${formatDateTimeShort(s.scheduledAt, d.tz)} — ${who || '—'} — ${s.title} (${s.durationMins} min)`)
    }
  }
  if (d.nextWeekTasks.length > 0) {
    lines.push('')
    lines.push('— Tasks on the go —')
    for (const t of d.nextWeekTasks.sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 12)) {
      const who = [t.dogName, t.clientName].filter(Boolean).join(' · ')
      lines.push(`• ${formatShortDate(t.date, d.tz)} — ${who || '—'} — ${t.title}`)
    }
  }
  lines.push('')
  lines.push(ctx.outro)
  lines.push('')
  lines.push(`Open this week → ${APP_URL}/dashboard`)
  return lines.join('\n')
}

// ─── Date helpers ───────────────────────────────────────────────────────────

function formatShortDate(d: Date, tz: string): string {
  return d.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz })
}

function formatDateTimeShort(d: Date, tz: string): string {
  return d.toLocaleString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz })
}

function formatCents(cents: number): string {
  const dollars = Math.round(cents / 100)
  return '$' + dollars.toLocaleString('en-NZ')
}
