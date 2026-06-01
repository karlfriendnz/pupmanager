import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'

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
        imageUrl: true, downloadUrl: true, category: true, featured: true,
      },
    }),
    prisma.productRequest.findMany({
      where: { clientId: profile.id, status: 'PENDING' },
      select: { productId: true },
    }),
  ])

  const requestedIds = new Set(pendingRequests.map(r => r.productId))
  return NextResponse.json(
    products.map(p => ({ ...p, requested: requestedIds.has(p.id) }))
  )
}
