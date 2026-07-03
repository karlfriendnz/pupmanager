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

  const [products, packages] = await Promise.all([
    prisma.product.findMany({
      where: { trainerId, active: true },
      select: { id: true, name: true, xeroAccountCode: true },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    }),
    prisma.package.findMany({
      where: { trainerId },
      select: { id: true, name: true, xeroAccountCode: true },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    }),
  ])

  return NextResponse.json({
    options,
    mapping: {
      bankAccountCode: connection.bankAccountCode,
      salesAccountCode: connection.salesAccountCode,
      taxType: connection.taxType,
      accountShortlist: (connection.accountShortlist as { code: string; name: string }[] | null) ?? [],
      products,
      packages,
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
  accountShortlist: z.array(z.object({ code: z.string().trim().max(50), name: z.string().trim().max(200) })).max(50).optional(),
  products: z.record(z.string(), code).default({}),
  packages: z.record(z.string(), code).default({}),
})

export async function PUT(req: Request) {
  const csrf = requireSameOrigin(req)
  if (csrf) return csrf

  const trainerId = await settingsTrainerId()
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = putSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const { bankAccountCode, bankAccountName, salesAccountCode, taxType, accountShortlist, products, packages } = parsed.data

  // Per-item updates are scoped by trainerId in the filter so a trainer can only
  // ever touch their own products/packages (updateMany ignores foreign ids).
  await prisma.$transaction([
    prisma.xeroConnection.update({
      where: { trainerId },
      data: {
        bankAccountCode, bankAccountName, salesAccountCode, taxType,
        ...(accountShortlist ? { accountShortlist } : {}),
      },
    }),
    ...Object.entries(products).map(([id, xeroAccountCode]) =>
      prisma.product.updateMany({ where: { id, trainerId }, data: { xeroAccountCode } }),
    ),
    ...Object.entries(packages).map(([id, xeroAccountCode]) =>
      prisma.package.updateMany({ where: { id, trainerId }, data: { xeroAccountCode } }),
    ),
  ])

  return NextResponse.json({ ok: true })
}
