'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { GraduationCap, Users, MapPin, CalendarDays, Repeat, Pencil, Copy, UserCog } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { ConnectPaymentsModal } from '../settings/connect-payments-prompt'
import {
  OfferingCard, OfferingTabs, OfferingEmpty, OfferingTabEmpty, AddOfferingLink, OfferingPage,
  type OfferingFact, type OfferingBadge,
} from '@/components/shared/offering-card'
import { formatMoney } from '@/lib/money'

type RunRow = {
  id: string
  packageId: string
  name: string
  description: string | null
  scheduleNote: string | null
  startLabel: string
  location: string | null
  status: 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED'
  sessionCount: number
  durationMins: number
  priceCents: number | null
  enrolledCount: number
  capacity: number | null
  imageUrl: string | null
  trainerNames: string[]
  isPast: boolean
}

const STATUS_TONE: Record<RunRow['status'], OfferingBadge['tone']> = {
  SCHEDULED: 'accent',
  RUNNING: 'good',
  COMPLETED: 'muted',
  CANCELLED: 'bad',
}

// Creating a class lives in the offerings wizard (/offerings/new?kind=group) —
// the one place a class is defined AND scheduled. This list only links to it.
export function ClassesView({
  runs,
  connectName: initialConnectName = null,
  currency = 'NZD',
}: {
  runs: RunRow[]
  connectName?: string | null
  currency?: string
}) {
  const router = useRouter()
  // Set (to the new class's name) when the wizard bounced back here after
  // creating a priced class and Stripe isn't connected yet.
  const [connectName, setConnectName] = useState<string | null>(initialConnectName)
  const [tab, setTab] = useState<'current' | 'past'>('current')
  const [cloning, setCloning] = useState<string | null>(null)

  // Server hands the list back newest-start-first. Current classes read better
  // soonest-first (what's on next), past ones most-recent-first.
  const current = runs.filter(r => !r.isPast).reverse()
  const past = runs.filter(r => r.isPast)
  const shown = tab === 'past' ? past : current

  async function clone(packageId: string) {
    if (cloning) return
    setCloning(packageId)
    try {
      const res = await fetch(`/api/packages/${packageId}/clone`, { method: 'POST' })
      if (!res.ok) { alert('Could not duplicate that class.'); return }
      const created = await res.json() as { id: string }
      router.push(`/packages/${created.id}/edit`)
    } finally { setCloning(null) }
  }

  return (
    <>
      <PageHeader
        title="Group Classes"
        subtitle="Run a class — pick the day, time and how many weeks. Clients enrol into one shared timetable with a roster, capacity and waitlist."
      />
      <OfferingPage>
        {runs.length === 0 ? (
          <OfferingEmpty
            icon={<GraduationCap className="h-6 w-6" />}
            title="No classes yet"
            body="Create your first class — e.g. “Puppy Class, Thursdays 4pm for 6 weeks”. Clients enrol into one shared timetable."
            action={{ href: '/offerings/new?kind=group', label: 'New class' }}
          />
        ) : (
          <>
            <OfferingTabs
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'current', label: 'Current', count: current.length },
                { id: 'past', label: 'Past', count: past.length },
              ]}
            />

            {shown.length === 0 ? (
              <OfferingTabEmpty
                icon={<GraduationCap className="mx-auto h-10 w-10" />}
                title={tab === 'past' ? 'No past classes' : 'No current classes'}
                body={tab === 'past'
                  ? 'Classes move here once their last session has been, or when you mark them complete or cancelled.'
                  : 'Every class you have has finished. Start a new one to fill the calendar.'}
              />
            ) : (
              shown.map(r => (
                <OfferingCard
                  key={r.id}
                  href={`/classes/${r.id}`}
                  title={r.name}
                  description={r.description}
                  imageUrl={r.imageUrl}
                  tile={{ icon: <GraduationCap className="h-5 w-5" />, className: 'bg-blue-50 text-blue-600' }}
                  dimmed={r.isPast}
                  badges={[
                    { label: r.status.charAt(0) + r.status.slice(1).toLowerCase(), tone: STATUS_TONE[r.status] },
                    ...(r.priceCents != null ? [{ label: formatMoney(r.priceCents, currency), tone: 'accent' as const }] : []),
                  ]}
                  facts={classFacts(r)}
                  actions={[
                    { icon: <Pencil className="h-4 w-4" />, label: 'Edit', onClick: () => router.push(`/packages/${r.packageId}/edit`) },
                    { icon: <Copy className="h-4 w-4" />, label: 'Duplicate', onClick: () => clone(r.packageId), disabled: cloning === r.packageId },
                  ]}
                />
              ))
            )}

            <AddOfferingLink href="/offerings/new?kind=group" label="New class" />
          </>
        )}
      </OfferingPage>

      {connectName && (
        <ConnectPaymentsModal onClose={() => setConnectName(null)} currency={currency} />
      )}
    </>
  )
}

function classFacts(r: RunRow): OfferingFact[] {
  const facts: OfferingFact[] = [
    { icon: <CalendarDays className="h-3.5 w-3.5" />, label: r.startLabel },
    {
      icon: <Repeat className="h-3.5 w-3.5" />,
      label: r.scheduleNote || `${r.sessionCount} session${r.sessionCount === 1 ? '' : 's'} · ${r.durationMins} min`,
    },
  ]
  if (r.location) facts.push({ icon: <MapPin className="h-3.5 w-3.5" />, label: r.location })

  const left = r.capacity == null ? null : Math.max(0, r.capacity - r.enrolledCount)
  facts.push({
    icon: <Users className="h-3.5 w-3.5" />,
    label: r.capacity == null ? `${r.enrolledCount} enrolled` : `${r.enrolledCount} of ${r.capacity} enrolled`,
    tone: left === 0 ? 'bad' : left != null && left <= 2 ? 'warn' : 'default',
  })

  if (r.trainerNames.length > 0) {
    facts.push({ icon: <UserCog className="h-3.5 w-3.5" />, label: r.trainerNames.join(', ') })
  }
  return facts
}
