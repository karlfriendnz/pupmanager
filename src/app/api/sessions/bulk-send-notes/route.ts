import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { releaseRecaps } from '@/lib/recap-notify'
import { z } from 'zod'

const schema = z.object({
  // 1:1 session notes (SessionFormResponse ids).
  responseIds: z.array(z.string()).max(500).optional(),
  // Group-class per-attendee reports (SessionAttendance ids).
  attendanceIds: z.array(z.string()).max(500).optional(),
})

// Release a write-up EARLY — before the session has been marked complete.
//
// Completing a session is now what reveals its notes (see lib/report-visibility),
// so this endpoint is no longer the only door: it is the one a trainer uses when
// they want the client reading tonight's write-up before they have got round to
// ticking the session off. The Draft notes screen and the per-note Send button
// both come here.
//
// The work itself lives in lib/recap-notify, shared with completion, so the two
// paths cannot drift on what "the client has been told" means. Anything already
// announced is skipped, so re-sending can't double-notify.
export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const responseIds = parsed.data.responseIds ?? []
  const attendanceIds = parsed.data.attendanceIds ?? []
  if (responseIds.length === 0 && attendanceIds.length === 0) {
    return NextResponse.json({ error: 'Nothing to send' }, { status: 400 })
  }

  const { sent } = await releaseRecaps({ trainerId, responseIds, attendanceIds })
  return NextResponse.json({ sent })
}
