import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { sendClientVerificationEmail } from '@/lib/auth-emails'
import { notifyEnquiryTrainer } from '@/lib/notify-enquiry-trainer'
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit'
import { createClientAccount, ClientSignupError } from '@/lib/client-signup'

// /api/auth/signup-client — the dog owner's half of signup.
//
// /api/auth/signup and /api/auth/register both hardcode role: 'TRAINER'. There
// was no other way to create an account, so a client following their trainer's
// "go sign up" became a trainer on a free trial. This route creates a CLIENT.
//
// It creates a login and NOTHING ELSE. Attaching them to a trainer is the
// trainer's call (their client list is a business record and this endpoint is
// public), so we raise an Enquiry they approve — see lib/client-signup.ts.
//
// Public + unauthenticated, so: rate limited per IP, length-capped strings.

const schema = z.object({
  name: z.string().trim().min(2, 'Your name is required').max(120),
  email: z.string().email('Enter a valid email').max(200),
  password: z.string().min(8, 'At least 8 characters'),
  phone: z.string().trim().max(40).optional(),
  dogName: z.string().trim().max(120).optional(),
  message: z.string().trim().max(2000).optional(),
  // The trainer they're asking to join. Absent when they signed up from the
  // app with no trainer's link — they pick one on /find-trainer afterwards.
  trainerId: z.string().trim().max(60).optional(),
})

function generateCode(): string {
  const n = crypto.randomInt(0, 1_000_000)
  return n.toString().padStart(6, '0')
}

export async function POST(req: Request) {
  const limited = await enforceRateLimit({
    key: `signup-client:${getClientIp(req)}`,
    limit: 5,
    windowMs: 60 * 60_000,
  })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const flat = parsed.error.flatten()
    const firstField = Object.entries(flat.fieldErrors)[0]
    const message = firstField?.[1]?.[0] ?? flat.formErrors[0] ?? 'Invalid input'
    return NextResponse.json({ error: message, details: flat }, { status: 400 })
  }

  const { name, email, password, phone, dogName, message, trainerId } = parsed.data

  let result
  try {
    result = await createClientAccount({
      name,
      email,
      password,
      phone,
      dogName,
      message,
      trainerId: trainerId || null,
    })
  } catch (err) {
    if (err instanceof ClientSignupError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === 'EMAIL_TAKEN' ? 409 : 404 },
      )
    }
    throw err
  }

  const businessName = trainerId
    ? (await prisma.trainerProfile.findUnique({
        where: { id: trainerId },
        select: { businessName: true },
      }))?.businessName ?? null
    : null

  // Confirm-your-email code. Same token shape as the trainer flow so
  // /verify-account and /api/auth/verify-email work unchanged; unlike the
  // trainer flow it does not gate signing in (see lib/client-signup.ts).
  const code = generateCode()
  await prisma.verificationToken.create({
    data: {
      identifier: email.trim().toLowerCase(),
      token: code,
      expires: new Date(Date.now() + 10 * 60 * 1000),
    },
  })
  sendClientVerificationEmail({ to: email.trim().toLowerCase(), name, businessName, code }).catch(err => {
    console.error('[signup-client] verification email failed:', err)
  })

  // Tell the trainer someone is waiting. The helper swallows its own errors so
  // a flaky push/Resend round-trip never fails the signup.
  if (result.enquiryId) {
    await notifyEnquiryTrainer({ enquiryId: result.enquiryId })
  }

  return NextResponse.json(
    { ok: true, email: email.trim().toLowerCase(), businessName, requested: !!result.enquiryId },
    { status: 201 },
  )
}
