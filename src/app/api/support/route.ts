import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { Resend } from 'resend'
import { z } from 'zod'

const schema = z.object({
  type: z.enum(['support', 'feedback']),
  category: z.string(),
  subject: z.string(),
  body: z.string().min(5),
})

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
    subject: `[PupManager ${parsed.data.type}] ${parsed.data.category}: ${parsed.data.subject}`,
    html: `
      <p><strong>From:</strong> ${session.user.name ?? 'Unknown'} (${session.user.email})</p>
      <p><strong>Role:</strong> ${session.user.role}</p>
      <p><strong>Category:</strong> ${parsed.data.category}</p>
      <hr />
      <p>${parsed.data.body.replace(/\n/g, '<br/>')}</p>
    `,
  }).catch(() => null)

  // Confirm to user
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: session.user.email!,
    subject: `We received your ${parsed.data.type === 'support' ? 'support ticket' : 'feedback'} — PupManager`,
    html: `<p>Thanks ${session.user.name ?? ''}! We've received your message and will follow up if needed.</p>`,
  }).catch(() => null)

  return NextResponse.json({ ok: true })
}
