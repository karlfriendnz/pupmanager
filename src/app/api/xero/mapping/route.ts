import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getTrainerContext } from '@/lib/membership'
import { can } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { requireSameOrigin } from '@/lib/csrf'
import { fetchMappingOptions } from '@/lib/xero'

// Phase 1 — the account/tax mapping a trainer configures once after connecting
// Xero. GET returns the live pick-lists from their org plus their current
// choices (connection-level defaults + per-product/package account codes). PUT
// saves them. Owner-only, mirroring the rest of the Xero + Billing surface.

// The Xero mapping surface (chart-of-accounts pull + per-product mapping + tax)
// is settings.edit-gated in the UI; enforce the same here so a staff member
// can't read the org's accounts or change tax/account mapping via the API.
async function settingsTrainerId(): Promise<string | null> {
  const ctx = await getTrainerContext()
  if (!ctx || !can('settings.edit', ctx.role, ctx.permissions)) return null
  return ctx.companyId
}

export async function GET() {
  const trainerId = await settingsTrainerId()
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const connection = await prisma.xeroConnection.findUnique({ where: { trainerId } })
  if (!connection) return NextResponse.json({ error: 'Not connected' }, { status: 409 })

  let options
  try {
    options = await fetchMappingOptions(connection)
  } catch (err) {
    console.error('[xero] fetchMappingOptions failed', err)
    return NextResponse.json({ error: 'Couldn’t load your Xero accounts. Try reconnecting.' }, { status: 502 })
  }

  // Per-item accounts are set on the items themselves (product/package/class
  // forms) — the mapping panel no longer lists them, so we don't fetch them here
  // (a trainer could have hundreds).
  return NextResponse.json({
    options,
    mapping: {
      bankAccountCode: connection.bankAccountCode,
      salesAccountCode: connection.salesAccountCode,
      taxType: connection.taxType,
      accountShortlist: (connection.accountShortlist as { code: string; name: string; default?: boolean }[] | null) ?? [],
    },
  })
}

// Empty string from a "Use default" <option> normalises to null (clear the code).
const code = z.string().trim().max(50).nullish().transform((v) => v || null)

const putSchema = z.object({
  bankAccountCode: code,
  bankAccountName: z.string().trim().max(200).nullish().transform((v) => v || null),
  salesAccountCode: code,
  taxType: code,
  // Curated income-account shortlist offered on the create forms.
  accountShortlist: z.array(z.object({ code: z.string().trim().max(50), name: z.string().trim().max(200), default: z.boolean().optional() })).max(50).optional(),
})

export async function PUT(req: Request) {
  const csrf = requireSameOrigin(req)
  if (csrf) return csrf

  const trainerId = await settingsTrainerId()
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = putSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const { bankAccountCode, bankAccountName, salesAccountCode, taxType, accountShortlist } = parsed.data

  // Per-item accounts live on the items (set via their own forms), not here.
  await prisma.xeroConnection.update({
    where: { trainerId },
    data: {
      bankAccountCode, bankAccountName, salesAccountCode, taxType,
      ...(accountShortlist ? { accountShortlist } : {}),
    },
  })

  return NextResponse.json({ ok: true })
}
