import { NextResponse } from 'next/server'
import { requireSameOrigin } from '@/lib/csrf'
import { createConnectionToken, ensureTerminalLocation } from '@/lib/terminal'
import { guardTapToPay } from '../_guard'

// The endpoint the Stripe Terminal SDK calls for itself, over and over, for as
// long as a reader session is alive. It is not called by our own UI.
//
// It returns a secret that authorises taking money on the trainer's connected
// account, so it is guarded exactly as hard as the sale routes are — the SDK
// calling it is not a reason to relax anything. The trainer's own session
// cookie is what authorises it; there is no token or key in the client.
//
// Creating the Location here (rather than at Connect onboarding) means a
// trainer's first ever tap costs one extra Stripe call and every tap after that
// costs none.

export async function POST(req: Request) {
  const csrf = requireSameOrigin(req); if (csrf) return csrf
  const guard = await guardTapToPay()
  if (guard instanceof NextResponse) return guard

  const locationId = guard.terminalLocationId ?? (await ensureTerminalLocation(guard.trainerId))

  const secret = await createConnectionToken({
    sandbox: guard.sandbox,
    connectAccountId: guard.connectAccountId,
    locationId,
  })

  // `location` goes back too: the SDK needs it again at connectReader() time,
  // and making the client ask twice for the same fact is how they end up
  // disagreeing.
  return NextResponse.json({ secret, locationId })
}
