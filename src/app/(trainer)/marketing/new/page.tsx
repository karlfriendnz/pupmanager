import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { notArchived, whereForView, VIEW_LABEL } from '@/lib/client-activity'
import { getTrainerContext, scopeForMember, hasPermission } from '@/lib/membership'
import { hasAddon } from '@/lib/billing'
import { PageHeader } from '@/components/shared/page-header'
import { NewEmailView } from './new-email-view'
import { addonSettingsHref } from '@/lib/configurable-features'

export const metadata: Metadata = { title: 'New email' }

const NO_EMAIL_DOMAIN = '@no-email.pupmanager.app'

// Full-page email composer — the dedicated `/marketing/new` route opened from
// the "New email" button. Mirrors `/marketing`'s context loading + gating, then
// renders the shared <EmailComposer mode="page"> with a live branded preview.
export default async function NewEmailPage() {
  const ctx = await getTrainerContext()
  if (!ctx) redirect('/login')
  const trainerId = ctx.companyId
  // Marketing is a paid add-on — send trainers without it to the add-ons tab.
  if (!(await hasAddon(trainerId, 'marketing'))) redirect(addonSettingsHref('marketing'))
  // Composing requires send permission; non-senders go back to the overview.
  if (!(await hasPermission('messages.send'))) redirect('/marketing')
  const memberScope = scopeForMember(ctx, 'clients.viewAll')

  const [trainer, candidates, customFields] = await Promise.all([
    prisma.trainerProfile.findUnique({
      where: { id: trainerId },
      select: { businessName: true, logoUrl: true, emailAccentColor: true },
    }),
    prisma.clientProfile.findMany({
      // Everyone except the people you've archived.
      //
      // This used to read `status: 'ACTIVE'`, back when status carried activity.
      // Now that activity is derived (lib/client-activity), the only thing status
      // still says is "hidden by hand" — so leaving the old filter here would have
      // quietly kept out every client sitting at status NEW, which is precisely
      // the never-booked group, and the one a trainer most wants to email.
      //
      // Nobody is emailed by this query: it fills the audience PICKER, and the
      // trainer chooses and reviews the recipients before anything sends.
      where: { trainerId, ...notArchived, isSample: false, marketingEmailOptOut: false, ...memberScope },
      select: {
        id: true,
        dogId: true,
        user: { select: { name: true, email: true } },
        dog: { select: { name: true, breed: true } },
        classEnrollments: {
          where: { status: 'ENROLLED' },
          select: { classRunId: true, classRun: { select: { name: true } } },
        },
        customFieldValues: { select: { fieldId: true, value: true, dogId: true } },
      },
      orderBy: { user: { name: 'asc' } },
    }),
    prisma.customField.findMany({
      where: { trainerId },
      select: { id: true, label: true, appliesTo: true },
      orderBy: [{ order: 'asc' }, { label: 'asc' }],
    }),
  ])

  // Where each of them is up to, from the same filters the clients list uses —
  // so "Past" here means exactly what the Past tab means over there, rather
  // than a second definition that drifts.
  const now = new Date()
  const [currentIds, neverIds] = await Promise.all([
    prisma.clientProfile.findMany({
      where: { trainerId, ...whereForView('current', now), ...memberScope },
      select: { id: true },
    }),
    prisma.clientProfile.findMany({
      where: { trainerId, ...whereForView('never', now), ...memberScope },
      select: { id: true },
    }),
  ])
  const currentSet = new Set(currentIds.map(c => c.id))
  const neverSet = new Set(neverIds.map(c => c.id))
  const stageOf = (id: string): 'current' | 'past' | 'never' =>
    currentSet.has(id) ? 'current' : neverSet.has(id) ? 'never' : 'past'

  // Only clients with a real (non-synthetic) email address are mailable.
  const eligibleCandidates = candidates
    .filter(c => c.user.email && !c.user.email.endsWith(NO_EMAIL_DOMAIN))
    .map(c => {
      // Custom-field map: for DOG-applied values, keep only the primary dog's
      // (mirrors the clients-list logic); OWNER values have dogId null.
      const custom: Record<string, string> = {}
      for (const v of c.customFieldValues) {
        if (v.dogId && c.dogId && v.dogId !== c.dogId) continue
        if (v.value) custom[v.fieldId] = v.value
      }
      return {
        id: c.id,
        name: c.user.name,
        email: c.user.email,
        dogName: c.dog?.name ?? null,
        breed: c.dog?.breed ?? null,
        classIds: c.classEnrollments.map(e => e.classRunId),
        custom,
        stage: stageOf(c.id),
      }
    })

  // Filter facets — only surface options that actually apply to eligible clients.
  const breeds = Array.from(new Set(eligibleCandidates.map(c => c.breed).filter((b): b is string => !!b))).sort()
  const classMap = new Map<string, string>()
  for (const c of candidates) for (const e of c.classEnrollments) classMap.set(e.classRunId, e.classRun.name)
  const usedClassIds = new Set(eligibleCandidates.flatMap(c => c.classIds))
  const classes = Array.from(classMap.entries())
    .filter(([id]) => usedClassIds.has(id))
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const facetCustomFields = customFields
    .map(f => ({
      id: f.id,
      label: f.label,
      values: Array.from(new Set(eligibleCandidates.map(c => c.custom[f.id]).filter((v): v is string => !!v))).sort(),
    }))
    .filter(f => f.values.length > 0)
  // Only offer a stage that somebody mailable is actually in.
  const stages = (['current', 'past', 'never'] as const)
    .map(v => ({ value: v, label: VIEW_LABEL[v], count: eligibleCandidates.filter(c => c.stage === v).length }))
    .filter(st => st.count > 0)
  const facets = { stages, breeds, classes, customFields: facetCustomFields }

  return (
    <>
      <PageHeader title="New email" back={{ href: '/marketing' }} />
      <div className="p-4 md:p-8 w-full max-w-6xl mx-auto">
        <NewEmailView
          candidates={eligibleCandidates}
          facets={facets}
          brand={{
            businessName: trainer?.businessName ?? '',
            logoUrl: trainer?.logoUrl ?? null,
            accentColor: trainer?.emailAccentColor ?? null,
          }}
        />
      </div>
    </>
  )
}
