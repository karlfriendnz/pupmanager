import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireSameOrigin } from '@/lib/csrf'
import { fetchMappingOptions } from '@/lib/xero'

// Phase 1 — the account/tax mapping a trainer configures once after connecting
// Xero. GET returns the live pick-lists from their org plus their current
// choices (connection-level defaults + per-product/package account codes). PUT
// saves them. Owner-only, mirroring the rest of the Xero + Billing surface.

async function ownerTrainerId(): Promise<string | null> {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) return null
  return session.user.trainerId
}

export async function GET() {
  const trainerId = await ownerTrainerId()
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
  products: z.record(z.string(), code).default({}),
  packages: z.record(z.string(), code).default({}),
})

export async function PUT(req: Request) {
  const csrf = requireSameOrigin(req)
  if (csrf) return csrf

  const trainerId = await ownerTrainerId()
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = putSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const { bankAccountCode, bankAccountName, salesAccountCode, taxType, products, packages } = parsed.data

  // Per-item updates are scoped by trainerId in the filter so a trainer can only
  // ever touch their own products/packages (updateMany ignores foreign ids).
  await prisma.$transaction([
    prisma.xeroConnection.update({
      where: { trainerId },
      data: { bankAccountCode, bankAccountName, salesAccountCode, taxType },
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
