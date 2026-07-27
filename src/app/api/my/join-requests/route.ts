import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit'
import { notifyEnquiryTrainer } from '@/lib/notify-enquiry-trainer'
import {
  requestToJoinTrainer,
  getPendingJoinRequests,
  ClientSignupError,
} from '@/lib/client-signup'

// GET/POST /api/my/join-requests — a dog owner asking a trainer to add them.
//
// This is the same approval pipeline as an enquiry (it writes an Enquiry with
// source SELF_SIGNUP); the trainer accepts from /enquiries and acceptEnquiry
// creates the ClientProfile. Nothing here writes to a trainer's client list.
//
// Tenancy: the acting user is ALWAYS read from the session — there is no userId
// in the body — so one person can never raise (or read) a request on behalf of
// another. Role is not checked: a person can be a trainer AND somebody else's
// client, so "may I ask to join a trainer" is true for any signed-in account.

const schema = z.object({
  trainerId: z.string().trim().min(1).max(60),
  message: z.string().trim().max(2000).optional(),
})

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  return NextResponse.json({ requests: await getPendingJoinRequests(session.user.id) })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  // A signed-in account can still spam every trainer on the platform, so the
  // per-IP cap applies here too.
  const limited = await enforceRateLimit({
    key: `join-request:${getClientIp(req)}`,
    limit: 20,
    windowMs: 60 * 60_000,
  })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  try {
    const result = await requestToJoinTrainer({
      userId: session.user.id,
      trainerId: parsed.data.trainerId,
      message: parsed.data.message,
    })
    // Only ping the trainer for a NEW request — re-tapping an outstanding one
    // must not re-notify them.
    if (result.enquiryId && !result.pending) {
      await notifyEnquiryTrainer({ enquiryId: result.enquiryId })
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof ClientSignupError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 404 })
    }
    throw err
  }
}
