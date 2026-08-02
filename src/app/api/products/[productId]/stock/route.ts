import { NextResponse } from 'next/server'
import { z } from 'zod'

import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { addStock, adjustStock, setStockCount } from '@/lib/stock'

// One product's stock: what it is now, and how it got there.
//
// Everything is scoped to guard.companyId, never just the product id — the
// ledger carries who bought what, and a movement history that can be fetched
// by id alone is a list of another business's customers.
export const runtime = 'nodejs'

/** How many lines the modal shows. A stock history is read to answer "what
 *  happened lately", not to audit a year — a full ledger is a report. */
const HISTORY_LIMIT = 25

const postSchema = z.object({
  // A magnitude, not a signed number. The REASON decides the direction, which
  // is the only way "3" and "damaged" can't be typed into contradiction.
  quantity: z.number().int().min(0).max(1_000_000),
  reason: z.enum(['RECEIVED', 'RETURNED', 'SOLD', 'DAMAGED', 'LOST', 'CORRECTION']),
  note: z.string().max(500).nullable().optional(),
  // Which shelf. Absent = the product's own count, which is what a product
  // with no variants has and always had.
  variantId: z.string().nullable().optional(),
})

/** Reasons that put units ON the shelf. Everything else takes them off, except
 *  CORRECTION, which sets the count to what was actually counted. */
const ADDING = new Set(['RECEIVED', 'RETURNED'])

async function ownedProduct(productId: string, companyId: string) {
  return prisma.product.findFirst({
    where: { id: productId, trainerId: companyId },
    select: { id: true, stockCount: true },
  })
}

/**
 * The shelf this request is about: a variant of the product, or the product
 * itself. Scoped by productId as well as its own id so a variant id from
 * another product (or another business) resolves to nothing.
 */
async function ownedVariant(productId: string, variantId: string) {
  return prisma.productVariant.findFirst({
    where: { id: variantId, productId },
    select: { id: true, stockCount: true },
  })
}

/**
 * One shelf's history. A variant's movements are its own — mixing every size
 * into one list is how "we're three short" becomes unanswerable.
 */
async function history(productId: string, companyId: string, variantId?: string | null) {
  const rows = await prisma.stockMovement.findMany({
    where: { productId, trainerId: companyId, ...(variantId ? { variantId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT,
    select: {
      id: true,
      delta: true,
      reason: true,
      note: true,
      balanceAfter: true,
      createdAt: true,
      client: { select: { user: { select: { name: true } } } },
      user: { select: { name: true } },
    },
  })
  return rows.map(r => ({
    id: r.id,
    delta: r.delta,
    reason: r.reason,
    note: r.note,
    balanceAfter: r.balanceAfter,
    at: r.createdAt.toISOString(),
    clientName: r.client?.user?.name ?? null,
    userName: r.user?.name ?? null,
  }))
}

export async function GET(req: Request, { params }: { params: Promise<{ productId: string }> }) {
  const guard = await guardPermission('products.manage')
  if (guard instanceof NextResponse) return guard

  const { productId } = await params
  const product = await ownedProduct(productId, guard.companyId)
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const variantId = new URL(req.url).searchParams.get('variantId')
  const variant = variantId ? await ownedVariant(productId, variantId) : null
  if (variantId && !variant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    stockCount: variant ? variant.stockCount : product.stockCount,
    movements: await history(productId, guard.companyId, variantId),
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ productId: string }> }) {
  const guard = await guardPermission('products.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  const userId = session?.user?.id ?? null

  const { productId } = await params
  const product = await ownedProduct(productId, guard.companyId)
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = postSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const { quantity, reason } = parsed.data
  const note = parsed.data.note?.trim() || null

  // Which shelf moved. A variant's count is its own; the product's is what a
  // product without variants has.
  const variantId = parsed.data.variantId ?? null
  const variant = variantId ? await ownedVariant(productId, variantId) : null
  if (variantId && !variant) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const before = variant ? variant.stockCount : product.stockCount

  // An untracked shelf has no balance to add to or take from. CORRECTION is
  // the exception, and the point of it: it is how a trainer STARTS counting
  // something they never counted before, opening balance and all.
  if (before === null && reason !== 'CORRECTION') {
    return NextResponse.json(
      { error: 'This isn’t being counted yet. Set a count first.' },
      { status: 409 },
    )
  }

  const stockCount = await prisma.$transaction(async tx => {
    if (reason === 'CORRECTION') {
      // The number typed IS the new count, not an amount to add — "I counted,
      // there are nine" is the only reading of a correction that fixes drift.
      return setStockCount(tx, productId, quantity, { userId, note, variantId })
    }
    if (ADDING.has(reason)) {
      return addStock(tx, productId, quantity, {
        userId,
        note,
        variantId,
        reason: reason as 'RECEIVED' | 'RETURNED',
      })
    }
    return adjustStock(tx, productId, { delta: -quantity, reason, userId, note, variantId })
  })

  return NextResponse.json({
    stockCount,
    movements: await history(productId, guard.companyId, variantId),
  })
}
