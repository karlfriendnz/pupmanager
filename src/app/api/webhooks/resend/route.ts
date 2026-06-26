import { NextResponse } from 'next/server'
import { Webhook } from 'svix'
import { prisma } from '@/lib/prisma'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

// Inbound Resend delivery events (signed via Svix). Maps each event's email_id
// back to the EmailBroadcastRecipient we recorded at send time and updates its
// status. Hard bounces and spam complaints additionally suppress the client —
// flipping marketingEmailOptOut so future broadcasts skip them — which protects
// the trainer's sender reputation.
type ResendEvent = {
  type: string
  data?: { email_id?: string }
}

export async function POST(req: Request) {
  const secret = env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    // No secret configured — refuse rather than trust an unsigned payload.
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  const payload = await req.text()
  const headers = {
    'svix-id': req.headers.get('svix-id') ?? '',
    'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
    'svix-signature': req.headers.get('svix-signature') ?? '',
  }

  let event: ResendEvent
  try {
    event = new Webhook(secret).verify(payload, headers) as ResendEvent
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const emailId = event.data?.email_id
  if (!emailId) return NextResponse.json({ ok: true, ignored: 'no email_id' })

  const recipient = await prisma.emailBroadcastRecipient.findUnique({
    where: { resendEmailId: emailId },
    select: { id: true, clientProfileId: true },
  })
  if (!recipient) return NextResponse.json({ ok: true, ignored: 'unknown email_id' })

  const now = new Date()
  const updates: Record<string, unknown> = {}
  let suppressReason: string | null = null

  switch (event.type) {
    case 'email.delivered':
      updates.status = 'DELIVERED'
      break
    case 'email.opened':
      updates.status = 'OPENED'
      updates.openedAt = now
      break
    case 'email.clicked':
      updates.status = 'CLICKED'
      updates.clickedAt = now
      break
    case 'email.bounced':
      updates.status = 'BOUNCED'
      updates.bouncedAt = now
      suppressReason = 'BOUNCED'
      break
    case 'email.complained':
      updates.status = 'COMPLAINED'
      updates.complainedAt = now
      suppressReason = 'COMPLAINED'
      break
    default:
      return NextResponse.json({ ok: true, ignored: event.type })
  }

  await prisma.emailBroadcastRecipient.update({ where: { id: recipient.id }, data: updates })

  // Suppress the client for future broadcasts on a bounce/complaint.
  if (suppressReason && recipient.clientProfileId) {
    await prisma.clientProfile.update({
      where: { id: recipient.clientProfileId },
      data: { marketingEmailOptOut: true, marketingOptOutAt: now, marketingOptOutReason: suppressReason },
    })
  }

  return NextResponse.json({ ok: true })
}
