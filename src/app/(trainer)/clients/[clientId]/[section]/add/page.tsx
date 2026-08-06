import { redirect, notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getClientAccess } from '@/lib/trainer-access'
import { mergeClientDogs } from '@/lib/dogs'
import { personLabel } from '@/lib/utils'
import { PageHeader } from '@/components/shared/page-header'
import { ClientSectionChrome } from '../../client-section-chrome'
import { ClientAddProductScreen } from '../../client-add-product-screen'

export const metadata: Metadata = { title: 'Add product' }

/**
 * Adding something to a client's Products list, as a page.
 *
 * It was a bottom sheet off the Products page (Karl, 2026-08-06: "should be a
 * page"). Same chrome as every other screen inside a client — back arrow, the
 * one-band header, no bottom tab bar — so the trainer never leaves the client.
 *
 * It lives under `[section]/add` rather than a static `products/` folder on
 * purpose: a literal `products` segment there would take precedence over
 * `[section]` and break `/clients/:id/products` itself. Only `products` has an
 * add screen, so every other section 404s here.
 */
export default async function ClientSectionAddPage({
  params,
}: {
  params: Promise<{ clientId: string; section: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const { clientId, section } = await params
  if (section !== 'products') notFound()

  const access = await getClientAccess(clientId, session.user.id)
  // canEdit, not just access: a read-only co-manager cannot set anything aside,
  // and a screen they can reach by URL is not gated by a hidden button.
  if (!access || !access.canEdit) notFound()

  const [client, products, pending] = await Promise.all([
    prisma.clientProfile.findUnique({
      where: { id: clientId },
      select: { user: { select: { name: true, email: true } }, dog: true, dogs: true },
    }),
    prisma.product.findMany({
      // No `active` filter — a trainer can hand over ANY of their own products,
      // including hidden ones; the row badges them.
      where: { trainerId: access.client.trainerId },
      orderBy: [{ category: 'asc' }, { order: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true, name: true, kind: true, priceCents: true, salePriceCents: true,
        imageUrl: true, category: true, active: true,
        // Active options only: this RECORDS a handover, and handing over a size
        // the trainer has retired isn't something to make easy.
        variants: {
          where: { active: true },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, name: true, priceCents: true, salePriceCents: true, stockCount: true },
        },
      },
    }),
    prisma.productRequest.findMany({
      where: { clientId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: {
        // quantity: the picker's stepper starts from what is actually on the
        // order, so a trainer coming back to a client who already has three
        // sees three rather than a control that has forgotten.
        id: true, note: true, quantity: true,
        variant: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, kind: true, imageUrl: true } },
      },
    }),
  ])
  if (!client) notFound()

  const clientName = personLabel(client.user)
  const dogLine = mergeClientDogs(client.dog, client.dogs).map(d => d.name).join(', ')

  return (
    <>
      <PageHeader
        title="Add product"
        subtitle={dogLine ? `${clientName} · ${dogLine}` : clientName}
        back={{ href: `/clients/${clientId}/products`, label: 'Back to products' }}
      />
      <ClientSectionChrome />
      <div className="p-4 md:p-8 w-full max-w-5xl xl:max-w-7xl mx-auto">
        <ClientAddProductScreen
          clientId={clientId}
          products={products.map(p => ({
            id: p.id, name: p.name, kind: p.kind as 'PHYSICAL' | 'DIGITAL',
            priceCents: p.priceCents, salePriceCents: p.salePriceCents,
            imageUrl: p.imageUrl, category: p.category, active: p.active,
            variants: p.variants,
          }))}
          pending={pending.map(r => ({
            id: r.id,
            note: r.note,
            quantity: r.quantity,
            variant: r.variant,
            product: {
              id: r.product.id,
              name: r.product.name,
              kind: r.product.kind as 'PHYSICAL' | 'DIGITAL',
              imageUrl: r.product.imageUrl,
            },
          }))}
        />
      </div>
    </>
  )
}
