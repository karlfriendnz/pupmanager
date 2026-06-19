import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  createExpressAccount,
  createOnboardingLink,
  currencyForCountry,
  isConnectConfigured,
} from '@/lib/connect'

// Stripe Connect onboarding for the trainer's payout account (Flow B).
// Owner-only (mirrors Billing) — onboarding a payout account is an account
// owner action. POST creates-or-resumes the Express account and returns a
// hosted onboarding link; PATCH flips the "accept payments" master switch.

async function ownerTrainerId(): Promise<string | null> {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return null
  return session.user.trainerId ?? null
}

export async function POST() {
  const trainerId = await ownerTrainerId()
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: {
      connectAccountId: true,
      sandboxBilling: true,
      payoutCurrency: true,
      signupCountry: true,
      addressCountry: true,
      businessName: true,
      user: { select: { email: true } },
    },
  })
  if (!trainer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sandbox = trainer.sandboxBilling
  if (!isConnectConfigured(sandbox)) {
    return NextResponse.json({ error: 'Payments are not configured yet' }, { status: 503 })
  }

  let accountId = trainer.connectAccountId

  // First time through: create the Express account and stamp the payout
  // currency from the trainer's country. Subsequent calls just re-mint a fresh
  // onboarding link to resume where they left off.
  if (!accountId) {
    const country = trainer.addressCountry ?? trainer.signupCountry ?? 'NZ'
    const account = await createExpressAccount({
      sandbox,
      trainerId,
      email: trainer.user?.email,
      country,
    })
    accountId = account.id
    await prisma.trainerProfile.update({
      where: { id: trainerId },
      data: {
        connectAccountId: account.id,
        payoutCurrency: trainer.payoutCurrency ?? currencyForCountry(country),
      },
    })
  }

  const url = await createOnboardingLink(accountId, sandbox)
  return NextResponse.json({ url })
}

const patchSchema = z.object({ acceptPaymentsEnabled: z.boolean() })

export async function PATCH(req: Request) {
  const trainerId = await ownerTrainerId()
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  // Only allow switching payments ON once the account can actually take charges.
  if (parsed.data.acceptPaymentsEnabled) {
    const t = await prisma.trainerProfile.findUnique({
      where: { id: trainerId },
      select: { connectChargesEnabled: true },
    })
    if (!t?.connectChargesEnabled) {
      return NextResponse.json({ error: 'Finish payment setup first' }, { status: 409 })
    }
  }

  await prisma.trainerProfile.update({
    where: { id: trainerId },
    data: { acceptPaymentsEnabled: parsed.data.acceptPaymentsEnabled },
  })
  return NextResponse.json({ acceptPaymentsEnabled: parsed.data.acceptPaymentsEnabled })
}
