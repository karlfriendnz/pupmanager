import { NextResponse } from 'next/server'
import { z } from 'zod'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'

// Toggle the shared "PupManager test domain" sender. Lets a trainer try bulk
// email immediately on our verified sender ("<Name> via PupManager") before
// (or instead of) verifying their own domain. The trial daily cap still applies.
export async function POST(req: Request) {
  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard

  const parsed = z.object({ enabled: z.boolean() }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  await prisma.trainerProfile.update({
    where: { id: guard.companyId },
    data: { useTrialSendingDomain: parsed.data.enabled },
  })

  return NextResponse.json({ trialDomain: parsed.data.enabled })
}
