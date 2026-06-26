import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { guardPermission, scopeForMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { buildClientEmail } from '@/lib/client-email'
import { sendEmailBatch, fromTrainerDomain, fromTrainer } from '@/lib/email'
import { htmlHasText } from '@/lib/email-html'
import { unsubscribeUrl } from '@/lib/unsubscribe-token'
import { hasAddon } from '@/lib/billing'

// Per-day send caps, counted by *recipient* over a rolling 24h window. Trial
// trainers are tightly capped to protect deliverability while they evaluate;
// paid trainers get a high backstop that exists only to catch abuse/bugs.
export const TRIAL_DAILY_RECIPIENT_LIMIT = 5
export const PAID_DAILY_RECIPIENT_LIMIT = 500

// Resend's batch endpoint accepts up to 100 messages per call.
const BATCH_SIZE = 100

// Synthetic address handed to clients with no real email — must never be mailed.
const NO_EMAIL_DOMAIN = '@no-email.pupmanager.app'

const schema = z.object({
  clientIds: z.array(z.string().min(1)).min(1).max(2000),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(50_000), // rich-text HTML
  headerImageUrl: z.string().url().max(2000).optional(), // optional hero image
})

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// Compose & send a bulk email to a trainer-selected set of their clients. Sends
// off the trainer's OWN verified sending subdomain (hard-blocked until verified),
// respects per-client opt-out, enforces the trial/paid daily cap, records an
// EmailBroadcast (+ a recipient row each) for tracking, and logs a Message to
// every recipient's thread — mirroring the one-off composer at messages/email.
export async function POST(req: Request) {
  const guard = await guardPermission('messages.send')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = guard.companyId

  // Bulk client email is the Marketing add-on — gate the capability on it.
  if (!(await hasAddon(trainerId, 'marketing'))) {
    return NextResponse.json({ error: 'The Marketing add-on is required to email clients in bulk.', code: 'ADDON_REQUIRED' }, { status: 403 })
  }

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  // Body is the composer's blocks serialized to HTML — accept it if it has text
  // OR an image block (an image-only email is valid).
  if (!htmlHasText(parsed.data.body) && !/<img/i.test(parsed.data.body)) {
    return NextResponse.json({ error: 'Add some content before sending' }, { status: 400 })
  }

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: {
      businessName: true,
      logoUrl: true,
      emailAccentColor: true,
      sendingFromEmail: true,
      domainVerifiedAt: true,
      useTrialSendingDomain: true,
      subscriptionStatus: true,
      user: { select: { name: true, email: true } },
    },
  })
  if (!trainer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Sender gate. Either the trainer verified their own domain (production path)
  // or they opted into the shared PupManager test sender. Otherwise, blocked.
  const ownDomainReady = !!trainer.domainVerifiedAt && !!trainer.sendingFromEmail
  const trialReady = trainer.useTrialSendingDomain
  if (!ownDomainReady && !trialReady) {
    return NextResponse.json(
      { error: 'Verify your sending domain before sending bulk email', code: 'DOMAIN_NOT_VERIFIED' },
      { status: 403 },
    )
  }

  // Refetch clients scoped to this tenant AND this member's visibility — a
  // spoofed id from another trainer can never resolve here.
  const memberScope = scopeForMember(guard, 'clients.viewAll')
  const candidates = await prisma.clientProfile.findMany({
    where: { trainerId, id: { in: parsed.data.clientIds }, ...memberScope },
    select: {
      id: true,
      isSample: true,
      marketingEmailOptOut: true,
      user: { select: { name: true, email: true } },
      dog: { select: { name: true } },
    },
  })

  const skipped: { clientId: string; reason: string }[] = []
  const recipients: typeof candidates = []
  const seenIds = new Set(candidates.map(c => c.id))
  // Any requested id we couldn't resolve (wrong tenant, not visible, deleted).
  for (const id of parsed.data.clientIds) {
    if (!seenIds.has(id)) skipped.push({ clientId: id, reason: 'NOT_FOUND' })
  }
  for (const c of candidates) {
    if (c.isSample) { skipped.push({ clientId: c.id, reason: 'SAMPLE' }); continue }
    if (!c.user.email || c.user.email.endsWith(NO_EMAIL_DOMAIN)) {
      skipped.push({ clientId: c.id, reason: 'NO_EMAIL' }); continue
    }
    if (c.marketingEmailOptOut) { skipped.push({ clientId: c.id, reason: 'OPTED_OUT' }); continue }
    recipients.push(c)
  }

  if (recipients.length === 0) {
    return NextResponse.json({ sent: 0, skipped, error: 'No eligible recipients' }, { status: 422 })
  }

  // Daily cap (rolling 24h), counted by recipient across this trainer's sends.
  const isTrial = trainer.subscriptionStatus === 'TRIALING'
  const dailyLimit = isTrial ? TRIAL_DAILY_RECIPIENT_LIMIT : PAID_DAILY_RECIPIENT_LIMIT
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const sentLast24h = await prisma.emailBroadcastRecipient.count({
    where: { broadcast: { trainerId }, createdAt: { gte: since } },
  })
  const remaining = Math.max(0, dailyLimit - sentLast24h)
  if (recipients.length > remaining) {
    return NextResponse.json(
      {
        error: isTrial
          ? `Trial accounts can email ${dailyLimit} clients per day. You have ${remaining} left today — upgrade to send more.`
          : `Daily send limit reached (${dailyLimit}/day). ${remaining} left today.`,
        code: isTrial ? 'TRIAL_LIMIT' : 'DAILY_LIMIT',
        limit: dailyLimit,
        remaining,
        attempted: recipients.length,
      },
      { status: 429 },
    )
  }

  const displayName = trainer.user.name?.trim() || trainer.businessName
  // Prefer the trainer's own verified domain; fall back to the shared
  // "<Name> via PupManager" sender when they're only on the trial domain.
  const from = ownDomainReady
    ? fromTrainerDomain(displayName, trainer.sendingFromEmail!)
    : fromTrainer(displayName)
  const replyTo = trainer.user.email ?? undefined

  // Record the broadcast up-front so recipient rows have a parent.
  const broadcast = await prisma.emailBroadcast.create({
    data: {
      trainerId,
      senderId: session.user.id,
      subject: parsed.data.subject,
      body: parsed.data.body,
      recipientCount: recipients.length,
    },
    select: { id: true },
  })

  // Build one fully-substituted message per recipient (each carries its own
  // unsubscribe link), then send in batches of 100.
  const built = recipients.map(c => {
    const email = buildClientEmail({
      recipient: { name: c.user.name, dogName: c.dog?.name },
      trainer: {
        displayName,
        businessName: trainer.businessName,
        logoUrl: trainer.logoUrl,
        emailAccentColor: trainer.emailAccentColor,
      },
      subject: parsed.data.subject,
      body: parsed.data.body,
      unsubscribeUrl: unsubscribeUrl(c.id),
      headerImageUrl: parsed.data.headerImageUrl ?? null,
    })
    return { client: c, to: c.user.email as string, email }
  })

  type RecipientRow = {
    broadcastId: string
    clientProfileId: string
    email: string
    resendEmailId: string | null
    status: string
  }
  const recipientRows: RecipientRow[] = []
  // We've already emailed each recipient directly, so stamp emailFallbackSentAt
  // to keep the message-email-fallback cron from sending a second "unread
  // messages" nudge for every one of these logged rows.
  const fallbackHandledAt = new Date()
  const messageRows: { clientId: string; senderId: string; channel: 'TRAINER_CLIENT'; body: string; bodyHtml: string; emailFallbackSentAt: Date }[] = []
  let sent = 0

  for (const group of chunk(built, BATCH_SIZE)) {
    let ids: (string | undefined)[] = []
    try {
      const res = await sendEmailBatch(
        group.map(g => ({ to: g.to, subject: g.email.subject, html: g.email.html, text: g.email.text, from, replyTo })),
      )
      if (res.error) throw new Error(res.error.message)
      ids = (res.data?.data ?? []).map(d => d.id)
    } catch (err) {
      console.error('[email-bulk] batch failed', err instanceof Error ? err.message : err)
      // Whole chunk failed — record the recipients as FAILED and move on.
      for (const g of group) {
        recipientRows.push({ broadcastId: broadcast.id, clientProfileId: g.client.id, email: g.to, resendEmailId: null, status: 'FAILED' })
      }
      continue
    }
    group.forEach((g, i) => {
      const resendEmailId = ids[i] ?? null
      sent += 1
      recipientRows.push({ broadcastId: broadcast.id, clientProfileId: g.client.id, email: g.to, resendEmailId, status: 'SENT' })
      messageRows.push({
        clientId: g.client.id,
        senderId: session.user.id,
        channel: 'TRAINER_CLIENT',
        body: `📧 ${g.email.subject}\n\n${g.email.text}`,
        bodyHtml: g.email.bodyHtml,
        emailFallbackSentAt: fallbackHandledAt,
      })
    })
  }

  await prisma.$transaction([
    prisma.emailBroadcastRecipient.createMany({ data: recipientRows }),
    ...(messageRows.length ? [prisma.message.createMany({ data: messageRows })] : []),
  ])

  return NextResponse.json({ broadcastId: broadcast.id, sent, skipped }, { status: 201 })
}
