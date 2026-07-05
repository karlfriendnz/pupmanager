import { NextResponse } from 'next/server'
import { getActiveClient } from '@/lib/client-context'
import { getTrainerAvailabilityForClient } from '@/lib/client-availability'

// GET /api/my/self-book/availability
// The trainer's published availability (recurring + one-off slots, blackouts)
// and their timezone, so the self-book modal can offer ONLY in-window start
// times instead of a free datetime-local. Read-only; the same data the
// my-availability page already shows this client.
export async function GET() {
  const active = await getActiveClient()
  if (!active) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const avail = await getTrainerAvailabilityForClient(active.clientId)
  if (!avail) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  return NextResponse.json({
    tz: avail.tz,
    slots: avail.slots,
    blackouts: avail.blackouts,
    busy: avail.busy,
  })
}
