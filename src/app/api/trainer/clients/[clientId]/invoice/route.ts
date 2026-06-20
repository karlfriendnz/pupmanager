import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getClientAccess } from '@/lib/trainer-access'
import { isConnectConfigured } from '@/lib/connect'
import { createAndSendInvoice } from '@/lib/invoice'

// Trainer-issued invoices for a client: GET lists what's invoiceable (unpaid
// package assignments + priced products); POST creates one and sends the client
// a pay link by notification + email.

async function resolve(clientId: string) {
  const session = await auth()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorised' }, { status: 401 }) }
  const access = await getClientAccess(clientId, session.user.id)
  if (!access || !access.canEdit) return { error: NextResponse.json({ error: 'Not allowed' }, { status: 403 }) }
  return { access }
}

export async function GET(_req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params
  const r = await resolve(clientId)
  if (r.error) return r.error
  const trainerId = r.access.trainerId

  const [packages, products, trainer] = await Promise.all([
    prisma.clientPackage.findMany({
      where: { clientId, invoicedAt: null },
      orderBy: { assignedAt: 'desc' },
      select: { id: true, package: { select: { name: true, priceCents: true, specialPriceCents: true } } },
    }),
    prisma.product.findMany({
      where: { trainerId, active: true, priceCents: { not: null } },
      orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, name: true, priceCents: true },
    }),
    prisma.trainerProfile.findUnique({
      where: { id: trainerId },
      select: { acceptPaymentsEnabled: true, connectChargesEnabled: true, payoutCurrency: true },
    }),
  ])

  const accepting = !!(trainer?.acceptPaymentsEnabled && trainer.connectChargesEnabled)
  return NextResponse.json({
    accepting,
    currency: trainer?.payoutCurrency ?? null,
    packages: packages
      .map(p => ({ clientPackageId: p.id, name: p.package.name, amount: p.package.specialPriceCents ?? p.package.priceCents }))
      .filter(p => p.amount && p.amount > 0),
    products: products.map(p => ({ productId: p.id, name: p.name, amount: p.priceCents })),
  })
}

const schema = z.object({
  clientPackageId: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
}).refine(d => !!d.clientPackageId !== !!d.productId, { message: 'Pick exactly one item' })

export async function POST(req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params
  const r = await resolve(clientId)
  if (r.error) return r.error
  const trainerId = r.access.trainerId

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Pick one item to invoice.' }, { status: 400 })

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: {
      acceptPaymentsEnabled: true, connectChargesEnabled: true, connectAccountId: true,
      payoutCurrency: true, sandboxBilling: true, businessName: true,
    },
  })
  if (!trainer?.acceptPaymentsEnabled || !trainer.connectChargesEnabled || !trainer.connectAccountId) {
    return NextResponse.json({ error: 'Turn on payments in Settings → Payments first.' }, { status: 409 })
  }
  if (!isConnectConfigured(trainer.sandboxBilling)) {
    return NextResponse.json({ error: 'Payments are not configured yet' }, { status: 503 })
  }

  // Resolve the item, its price + description.
  let kind: 'PACKAGE' | 'PRODUCT'
  let amount: number
  let description: string
  let clientPackageId: string | undefined
  let productId: string | undefined

  if (parsed.data.clientPackageId) {
    const cp = await prisma.clientPackage.findFirst({
      where: { id: parsed.data.clientPackageId, clientId },
      select: { id: true, invoicedAt: true, package: { select: { name: true, priceCents: true, specialPriceCents: true } } },
    })
    if (!cp) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })
    if (cp.invoicedAt) return NextResponse.json({ error: 'That package is already paid/invoiced.' }, { status: 409 })
    const price = cp.package.specialPriceCents ?? cp.package.priceCents
    if (!price || price <= 0) return NextResponse.json({ error: 'That package has no price set.' }, { status: 400 })
    kind = 'PACKAGE'; amount = price; description = cp.package.name; clientPackageId = cp.id
  } else {
    const product = await prisma.product.findFirst({
      where: { id: parsed.data.productId, trainerId },
      select: { id: true, name: true, priceCents: true },
    })
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    if (!product.priceCents || product.priceCents <= 0) return NextResponse.json({ error: 'That product has no price set.' }, { status: 400 })
    kind = 'PRODUCT'; amount = product.priceCents; description = product.name; productId = product.id
  }

  // The client's contact details for the notification + email.
  const clientUser = await prisma.user.findUnique({ where: { id: r.access.client.userId ?? '__none__' }, select: { id: true, email: true } })

  await createAndSendInvoice({
    trainerId,
    connectAccountId: trainer.connectAccountId,
    sandbox: trainer.sandboxBilling,
    clientId,
    clientUserId: clientUser?.id ?? null,
    clientEmail: clientUser?.email ?? null,
    currency: trainer.payoutCurrency ?? 'nzd',
    businessName: trainer.businessName ?? 'Your trainer',
    kind,
    clientPackageId,
    productId,
    amount,
    description,
  })

  return NextResponse.json({ ok: true })
}
