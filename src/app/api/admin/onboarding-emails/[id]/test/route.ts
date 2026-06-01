import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import { renderOnboardingEmail } from '@/lib/onboarding/send-emails'

const TEST_RECIPIENT = 'karlfriend.nz@gmail.com'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.pupmanager.com'

// Sample token values so the test reads like a real send.
const SAMPLE_CTX: Record<string, string> = {
  trainerName: 'Sarah',
  businessName: 'Sarah’s Dog Training',
  daysLeft: '3',
  trialEndDate: 'Friday 14 June',
  billingUrl: `${APP_URL}/billing/setup`,
}

// POST → render this email (using any current edits passed in the body, else
// the saved row) and send a one-off test to the founder inbox. Admin-only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const email = await prisma.onboardingEmail.findUnique({ where: { id } })
  if (!email) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const tmpl = {
    subject: typeof o.subject === 'string' ? o.subject : email.subject,
    body: typeof o.body === 'string' ? o.body : email.body,
    topText: o.topText !== undefined ? (o.topText as string | null) : email.topText,
    senderKey: typeof o.senderKey === 'string' ? o.senderKey : email.senderKey,
    imageUrl: o.imageUrl !== undefined ? (o.imageUrl as string | null) : email.imageUrl,
    imageHeight: o.imageHeight !== undefined ? (o.imageHeight as number | null) : email.imageHeight,
  }

  const r = renderOnboardingEmail(tmpl, SAMPLE_CTX)
  try {
    await sendEmail({ to: TEST_RECIPIENT, subject: `[TEST] ${r.subject}`, html: r.html, text: r.text, from: r.from, replyTo: r.replyTo })
  } catch (err) {
    console.error('[onboarding-emails] test send failed:', err)
    return NextResponse.json({ error: 'Send failed' }, { status: 502 })
  }
  return NextResponse.json({ ok: true, sentTo: TEST_RECIPIENT })
}
