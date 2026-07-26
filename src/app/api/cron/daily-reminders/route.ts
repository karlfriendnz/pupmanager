import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Resend } from 'resend'
import { trainerMailStopped } from '@/lib/access'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

// Called by Vercel Cron at 6 PM UTC daily (configure in vercel.json)
// Authorization via CRON_SECRET header
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  // Find all clients who: have tasks today, haven't completed all of them, and have email notifications on
  const clients = await prisma.clientProfile.findMany({
    where: {
      // Never email demo/sample clients (their addresses are @pupmanager.test).
      isSample: false,
      user: { notifyEmail: true },
      diaryEntries: {
        some: {
          date: today,
          completion: null, // at least one incomplete task today
        },
      },
    },
    include: {
      user: { select: { email: true, name: true, timezone: true } },
      // subscriptionStatus & co. drive the access check below: this cron talks
      // to Resend directly, so it never passes through sendEmail() and does NOT
      // inherit the trainerMailStopped guard that stops mail to lapsed trainers.
      // deactivatedAt lives on User, not TrainerProfile — a deactivated account
      // is a deactivated person. Selecting it on the profile silently
      // invalidates the whole select (tsc caught it as 9 cascading errors).
      trainer: {
        select: {
          businessName: true, subscriptionStatus: true, trialEndsAt: true,
          stripeSubscriptionId: true, gracePeriodUntil: true,
          user: { select: { deactivatedAt: true } },
        },
      },
      diaryEntries: {
        where: { date: today },
        include: { completion: true },
      },
    },
  })

  let sent = 0
  const errors: string[] = []

  let skippedLapsed = 0

  for (const client of clients) {
    const pendingTasks = client.diaryEntries.filter(t => !t.completion)
    if (pendingTasks.length === 0) continue

    // Karl's call (2026-07-27): when a trainer's subscription lapses, their
    // clients stop getting these too. The homework is the trainer's programme —
    // nagging an owner about tasks for a trainer who can no longer open the app,
    // reply, or mark anything off is a reminder nobody can act on, sent under
    // that trainer's business name. Same helper as the paywall and sendEmail(),
    // so the three can't drift apart.
    if (trainerMailStopped({ ...client.trainer, deactivatedAt: client.trainer.user?.deactivatedAt ?? null })) {
      skippedLapsed++
      continue
    }

    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: client.user.email,
        subject: `🐕 Don't forget — ${pendingTasks.length} training task${pendingTasks.length > 1 ? 's' : ''} to complete today`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
            <h2 style="color:#1e3a5f;">Hi ${escapeHtml(client.user.name ?? 'there')} 👋</h2>
            <p>You still have <strong>${pendingTasks.length} training task${pendingTasks.length > 1 ? 's' : ''}</strong> to complete today from ${escapeHtml(client.trainer.businessName)}:</p>
            <ul>
              ${pendingTasks.map(t => `<li>${escapeHtml(t.title)}${t.repetitions ? ` (${t.repetitions} reps)` : ''}</li>`).join('')}
            </ul>
            <p style="margin-top:24px;">
              <a href="${process.env.NEXT_PUBLIC_APP_URL}/my-profile" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">
                View your training →
              </a>
            </p>
            <p style="color:#94a3b8;font-size:12px;margin-top:32px;">
              You're receiving this because you have email reminders enabled.
              <a href="${process.env.NEXT_PUBLIC_APP_URL}/my-profile" style="color:#94a3b8;">Manage preferences</a>
            </p>
          </div>
        `,
      })
      sent++
    } catch (err) {
      errors.push(client.user.email)
    }
  }

  // skippedLapsed is reported so a sudden drop in `sent` is explainable rather
  // than looking like the cron silently breaking.
  return NextResponse.json({ sent, skippedLapsed, errors })
}
