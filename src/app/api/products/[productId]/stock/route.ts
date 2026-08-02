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

async function history(productId: string, companyId: string) {
  const rows = await prisma.stockMovement.findMany({
    where: { productId, trainerId: companyId },
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

export async function GET(_req: Request, { params }: { params: Promise<{ productId: string }> }) {
  const guard = await guardPermission('products.manage')
  if (guard instanceof NextResponse) return guard

  const { productId } = await params
  const product = await ownedProduct(productId, guard.companyId)
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    stockCount: product.stockCount,
    movements: await history(productId, guard.companyId),
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

  // An untracked product has no balance to add to or take from. CORRECTION is
  // the exception, and the point of it: it is how a trainer STARTS counting
  // something they never counted before, opening balance and all.
  if (product.stockCount === null && reason !== 'CORRECTION') {
    return NextResponse.json(
      { error: 'This product isn’t being counted yet. Set a count first.' },
      { status: 409 },
    )
  }

  const stockCount = await prisma.$transaction(async tx => {
    if (reason === 'CORRECTION') {
      // The number typed IS the new count, not an amount to add — "I counted,
      // there are nine" is the only reading of a correction that fixes drift.
      return setStockCount(tx, productId, quantity, { userId, note })
    }
    if (ADDING.has(reason)) {
      return addStock(tx, productId, quantity, {
        userId,
        note,
        reason: reason as 'RECEIVED' | 'RETURNED',
      })
    }
    return adjustStock(tx, productId, { delta: -quantity, reason, userId, note })
  })

  return NextResponse.json({
    stockCount,
    movements: await history(productId, guard.companyId),
  })
}
