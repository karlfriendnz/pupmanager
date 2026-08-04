import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { mayDownloadProduct } from '@/lib/product-price'

export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== 'CLIENT') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const active = await getActiveClient()
  const profile = active ? await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: { id: true, trainerId: true },
  }) : null
  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [products, pendingRequests] = await Promise.all([
    prisma.product.findMany({
      where: { trainerId: profile.trainerId, active: true },
      orderBy: [{ featured: 'desc' }, { order: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true, name: true, description: true, kind: true, priceCents: true,
        salePriceCents: true, stockCount: true,
        imageUrl: true, downloadUrl: true, category: true, featured: true,
        // The sizes/colours a client picks between. Active only — a hidden
        // variant is off the shop, exactly as a hidden product is.
        variants: {
          where: { active: true },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, name: true, priceCents: true, salePriceCents: true, stockCount: true },
        },
      },
    }),
    prisma.productRequest.findMany({
      where: { clientId: profile.id, status: { in: ['PENDING', 'FULFILLED'] } },
      select: { productId: true, status: true },
    }),
  ])

  const requestedIds = new Set(
    pendingRequests.filter(r => r.status === 'PENDING').map(r => r.productId),
  )
  const purchasedIds = new Set(
    pendingRequests.filter(r => r.status === 'FULFILLED').map(r => r.productId),
  )
  return NextResponse.json(
    products.map(p => ({
      ...p,
      // Never hand out the file of a paid download this client hasn't bought.
      // These Blob URLs are unguessable but public and permanent — the URL IS
      // the paywall (audit C-4).
      downloadUrl: mayDownloadProduct(p, p.variants, purchasedIds.has(p.id)) ? p.downloadUrl : null,
      requested: requestedIds.has(p.id),
      purchased: purchasedIds.has(p.id),
    }))
  )
}
