import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { amountFor } from '@/lib/timesheets'

// Server-only helpers for time-entry create/update. Kept out of the route files
// (route modules may only export HTTP handlers) and out of lib/timesheets.ts
// (which stays client-safe — no prisma import).

export const entrySchema = z.object({
  date: z.string().min(8),
  task: z.string().min(1).max(300),
  minutes: z.number().int().min(0).max(24 * 60 * 7),
  rateId: z.string().nullable().optional(),
  amountCents: z.number().int().min(0).max(100_000_00).nullable().optional(),
  clientId: z.string().nullable().optional(),
  category: z.string().max(60).nullable().optional(),
  notes: z.string().max(2_000).nullable().optional(),
})

export type EntryInput = z.infer<typeof entrySchema>

// Resolve the rate snapshot + line amount. A chosen rate computes the amount
// (hours × rate); otherwise fall back to a manual amount.
export async function resolveLine(companyId: string, input: EntryInput) {
  let rateName: string | null = null
  let rateCents: number | null = null
  let amountCents = input.amountCents ?? 0
  let rateId: string | null = null
  if (input.rateId) {
    const rate = await prisma.timeRate.findFirst({ where: { id: input.rateId, companyId }, select: { name: true, rateCents: true } })
    if (rate) {
      rateName = rate.name
      rateCents = rate.rateCents
      amountCents = amountFor(input.minutes, rate.rateCents)
      rateId = input.rateId
    }
  }
  return { rateId, rateName, rateCents, amountCents }
}

// Verify a client (if supplied) belongs to this company.
export async function resolveClientId(companyId: string, clientId: string | null | undefined): Promise<string | null> {
  if (!clientId) return null
  const client = await prisma.clientProfile.findFirst({ where: { id: clientId, trainerId: companyId }, select: { id: true } })
  return client?.id ?? null
}
