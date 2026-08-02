import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireSameOrigin } from '@/lib/csrf'
import { createTapToPayOnboardingLink } from '@/lib/terminal'
import { guardTapToPay } from '../_guard'

// Mints Apple's terms-and-conditions link for THIS trainer's connected account.
//
// Apple requires every merchant to accept its Tap to Pay terms with a real
// Apple ID before their first tap, and with direct charges that acceptance is
// per connected account — PupManager accepting as a platform does nothing for
// them. Surfaced in Settings → Payments so it happens at a desk, not over a
// customer's shoulder mid-sale.
//
// Safe to call repeatedly: the links are single-use and Apple doesn't re-ask
// once a business has accepted.

const bodySchema = z.object({
  // Only for a trainer who needs to move the business to a different Apple ID.
  allowRelinking: z.boolean().optional(),
})

export async function POST(req: Request) {
  const csrf = requireSameOrigin(req); if (csrf) return csrf
  const guard = await guardTapToPay()
  if (guard instanceof NextResponse) return guard

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const url = await createTapToPayOnboardingLink({
    sandbox: guard.sandbox,
    connectAccountId: guard.connectAccountId,
    businessName: guard.businessName,
    allowRelinking: parsed.data.allowRelinking,
  })

  // We asked; we did not witness. Apple's page is Apple's and there is no
  // webhook back, so this date only ever means "a link was minted for them" —
  // enough for the settings screen to stop nagging a trainer who is mid-flow,
  // and nothing like proof. The proof is tapToPayTermsAcceptedAt, which only a
  // device that actually connected can set.
  await prisma.trainerProfile.update({
    where: { id: guard.trainerId },
    data: { tapToPayTermsLinkedAt: new Date() },
  })

  return NextResponse.json({ url })
}
