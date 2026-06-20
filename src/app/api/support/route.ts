import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { Resend } from 'resend'
import { z } from 'zod'
import { escapeHtml } from '@/lib/enquiries'

const schema = z.object({
  type: z.enum(['support', 'feedback', 'feature', 'bug']),
  category: z.string().max(80),
  subject: z.string().max(200),
  body: z.string().min(5).max(5000),
})

// Friendly noun used in the confirmation email back to the sender.
const TYPE_LABEL: Record<string, string> = {
  support: 'support ticket',
  feedback: 'feedback',
  feature: 'feature request',
  bug: 'bug report',
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const resend = new Resend(process.env.RESEND_API_KEY)

  // Send to support inbox
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: process.env.RESEND_FROM_EMAIL!, // send to self / support inbox
    subject: `[PupManager ${parsed.data.type}] ${escapeHtml(parsed.data.category)}: ${escapeHtml(parsed.data.subject)}`,
    // Escape every interpolated value — the sender's display name + free-text
    // body are user-controlled and must not inject HTML into the staff email.
    html: `
      <p><strong>From:</strong> ${escapeHtml(session.user.name ?? 'Unknown')} (${escapeHtml(session.user.email ?? '')})</p>
      <p><strong>Role:</strong> ${escapeHtml(session.user.role ?? '')}</p>
      <p><strong>Category:</strong> ${escapeHtml(parsed.data.category)}</p>
      <hr />
      <p>${escapeHtml(parsed.data.body).replace(/\n/g, '<br/>')}</p>
    `,
  }).catch(() => null)

  // Confirm to user
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: session.user.email!,
    subject: `We received your ${TYPE_LABEL[parsed.data.type] ?? 'message'} — PupManager`,
    html: `<p>Thanks ${escapeHtml(session.user.name ?? '')}! We've received your message and will follow up if needed.</p>`,
  }).catch(() => null)

  return NextResponse.json({ ok: true })
}
