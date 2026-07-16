import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { hasAddon } from '@/lib/billing'
import { ensureTrainerSlug } from '@/lib/slug'
import { env } from '@/lib/env'
import { PageHeader } from '@/components/shared/page-header'
import type { LinkButtonType } from '@/lib/link-page'
import { InstagramEditor } from './instagram-editor'

export const metadata: Metadata = { title: 'Instagram link' }

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const DEFAULT_ACCENT = 'var(--pm-brand-600)'

export default async function InstagramPage() {
  const ctx = await getTrainerContext()
  if (!ctx) redirect('/login')
  if (!(await hasAddon(ctx.companyId, 'instagram'))) redirect('/settings?tab=addons')

  // Ensure the trainer has a public slug (lazily generated on first need).
  const slug = await ensureTrainerSlug(ctx.companyId)

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: ctx.companyId },
    select: {
      businessName: true,
      logoUrl: true,
      iconUrl: true,
      emailAccentColor: true,
      website: true,
      publicEmail: true,
      phone: true,
      showPhoneToClients: true,
      linkPage: { include: { links: { orderBy: { order: 'asc' } } } },
    },
  })
  if (!trainer) redirect('/dashboard')

  // Create a default config row on first visit so the editor always has one.
  let linkPage = trainer.linkPage
  if (!linkPage) {
    linkPage = await prisma.linkPage.create({
      data: { trainerId: ctx.companyId },
      include: { links: { orderBy: { order: 'asc' } } },
    })
  }

  // Lists the "Add link" modal pickers need: the trainer's booking pages,
  // active get-in-touch forms, and (only when the add-on is on) lead magnets.
  const hasLeadMagnets = await hasAddon(ctx.companyId, 'leadmagnets')
  const [bookingPages, embedForms, leadMagnets] = await Promise.all([
    prisma.bookingPage.findMany({
      where: { trainerId: ctx.companyId },
      select: { slug: true, name: true, headline: true },
      orderBy: { order: 'asc' },
    }),
    prisma.embedForm.findMany({
      where: { trainerId: ctx.companyId, isActive: true },
      select: { id: true, title: true },
      orderBy: { createdAt: 'asc' },
    }),
    hasLeadMagnets
      ? prisma.leadMagnet.findMany({
          where: { trainerId: ctx.companyId },
          select: { slug: true, title: true },
          orderBy: { createdAt: 'asc' },
        })
      : Promise.resolve([]),
  ])

  const accent =
    trainer.emailAccentColor && HEX.test(trainer.emailAccentColor)
      ? trainer.emailAccentColor
      : DEFAULT_ACCENT

  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  const publicUrl = slug ? `${appUrl}/l/${slug}` : null

  return (
    <>
      <PageHeader title="Instagram link" />
      <div className="p-4 md:p-8">
        <InstagramEditor
          publicUrl={publicUrl}
          brand={{
            businessName: trainer.businessName,
            avatarUrl: trainer.iconUrl || trainer.logoUrl || null,
            accent,
            slug: slug ?? '',
            website: trainer.website,
            publicEmail: trainer.publicEmail,
            phone: trainer.phone,
            showPhoneToClients: trainer.showPhoneToClients,
          }}
          pickers={{
            bookingPages: bookingPages.map((b) => ({
              slug: b.slug,
              name: b.headline?.trim() || b.name,
            })),
            leadMagnets: leadMagnets.map((m) => ({ slug: m.slug, title: m.title })),
            embedForms: embedForms.map((f) => ({ id: f.id, title: f.title })),
          }}
          initial={{
            headline: linkPage.headline,
            bio: linkPage.bio,
            instagram: linkPage.instagram,
            facebook: linkPage.facebook,
            tiktok: linkPage.tiktok,
            socialsLabel: linkPage.socialsLabel,
            font: linkPage.font,
            backgroundUrl: linkPage.backgroundUrl,
            buttons: linkPage.links.map((l) => ({
              id: l.id,
              type: l.type as LinkButtonType,
              label: l.label,
              url: l.url,
              targetId: l.targetId,
              imageUrl: l.imageUrl,
              bgColor: l.bgColor,
              textColor: l.textColor,
            })),
          }}
        />
      </div>
    </>
  )
}
