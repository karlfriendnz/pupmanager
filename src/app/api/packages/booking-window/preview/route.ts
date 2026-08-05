import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { getTrainerAvailabilityById } from '@/lib/client-availability'
import { bookingWindowSchema } from '@/lib/package-slots'
import {
  bookableStartTimes, bookingWindowInput, validateBookingWindow, packageBookingWindow,
  bookingWindowColumns,
} from '@/lib/package-booking-window'
import { todayInTz } from '@/lib/timezone'

// POST /api/packages/booking-window/preview
//
// "How many times does this window actually offer?" — asked by the offering
// form as the trainer builds one.
//
// A window is a NARROWING, so it is entirely possible to build one that offers
// nothing at all: Sunday mornings when the trainer's availability has no
// Sunday, or 9:00 sharp on a day they start at ten. Left unsaid, that produces
// a client booking screen with no times on it and no clue why — the trainer
// would find out from a client. So the same resolver the picker and the
// self-book route use is run here against the trainer's REAL availability,
// blackouts and diary, and the count comes back for the form to warn on.
//
// Read-only. Nothing is stored.

const DAYS_AHEAD = 28

const schema = z.object({
  window: bookingWindowSchema,
  durationMins: z.number().int().min(1).max(480),
  bufferMins: z.number().int().min(0).max(480).optional(),
})

function addDayStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

export async function POST(req: Request) {
  const guard = await guardPermission('packages.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const input = bookingWindowInput(parsed.data.window)
  const invalid = validateBookingWindow(input)
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })

  const avail = await getTrainerAvailabilityById(trainerId)
  if (!avail) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  // Round-trip the input through the storage columns and back out of the
  // resolver, so the preview is computed from exactly what a save would store —
  // not from a parallel reading of the form's state.
  const window = packageBookingWindow(bookingWindowColumns(input))

  const today = todayInTz(avail.tz)
  let slotCount = 0
  let daysWithSlots = 0
  let firstDate: string | null = null
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const dateStr = addDayStr(today, i)
    const times = bookableStartTimes({
      slots: avail.slots,
      blackouts: avail.blackouts,
      busy: avail.busy,
      dateStr,
      durationMins: parsed.data.durationMins,
      bufferMins: parsed.data.bufferMins ?? 0,
      window,
    })
    if (times.length === 0) continue
    slotCount += times.length
    daysWithSlots++
    if (!firstDate) firstDate = dateStr
  }

  return NextResponse.json({ slotCount, daysWithSlots, firstDate, windowDays: DAYS_AHEAD })
}
