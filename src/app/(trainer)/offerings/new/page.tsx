import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isConnectConfigured } from '@/lib/connect'
import { PageHeader } from '@/components/shared/page-header'
import { trainerRegionCode } from '@/lib/country'
import { NewPackageForm } from './new-package-form'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'New offering' }

const KINDS = ['onetoone', 'group', 'dropin', 'oneoff'] as const
type OfferingKind = (typeof KINDS)[number]

// What to call the page, and where Back goes, once the kind is known.
const KIND_PAGE: Record<OfferingKind, { title: string; list: string; listLabel: string }> = {
  onetoone: { title: 'New 1:1 session', list: '/packages', listLabel: '1:1 sessions' },
  group: { title: 'New class', list: '/classes', listLabel: 'classes' },
  dropin: { title: 'New casual class', list: '/casual-classes', listLabel: 'casual classes' },
  oneoff: { title: 'New event', list: '/events', listLabel: 'events' },
}

export default async function NewPackagePage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const sp = await searchParams
  const initialKind = KINDS.includes(sp.kind as OfferingKind) ? (sp.kind as OfferingKind) : undefined
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const [sessionForms, trainer] = await Promise.all([
    prisma.sessionForm.findMany({
      where: { trainerId },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      select: { id: true, name: true },
    }),
    prisma.trainerProfile.findUnique({
      where: { id: trainerId },
      select: { connectChargesEnabled: true, sandboxBilling: true, addressCountry: true, signupCountry: true },
    }),
  ])
  // Localise Google address suggestions to the trainer's country (global rule).
  const region = trainer ? trainerRegionCode(trainer) : undefined

  // Whether to nudge Stripe Connect after a priced package is created. Only when
  // payments aren't already live AND the trainer can actually onboard right now
  // (Connect configured + allowed for their account) — so it's never a dead end.
  const sandbox = trainer?.sandboxBilling ?? false
  const promptConnect =
    !trainer?.connectChargesEnabled &&
    isConnectConfigured(sandbox)

  return (
    <>
      {/* When the link already said what they're making, the page says it too —
          arriving at "New offering" after tapping "New 1:1 session" reads as having
          landed somewhere else. */}
      <PageHeader
        title={initialKind ? KIND_PAGE[initialKind].title : 'New offering'}
        back={initialKind
          ? { href: KIND_PAGE[initialKind].list, label: `Back to ${KIND_PAGE[initialKind].listLabel}` }
          : { href: '/packages', label: 'Back to offerings' }}
      />
      <div className="p-4 md:p-8 w-full max-w-[872px] mx-auto pm-centered">
        <NewPackageForm sessionForms={sessionForms} promptConnect={promptConnect} region={region} initialKind={initialKind} />
      </div>
    </>
  )
}
