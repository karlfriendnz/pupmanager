import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { CalendarPlus, Plus } from 'lucide-react'
import { getTrainerContext } from '@/lib/membership'
import { hasAddon } from '@/lib/billing'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = { title: 'Events' }

// Events — one-off things clients buy a ticket to (workshops, seminars,
// meet-ups). An add-on: trainers without it are sent to the Add-ons tab (the
// nav shows a locked "turn it on" row until then). Creating an event runs
// through the shared offering form with the "one-off event" kind preselected.
export default async function EventsPage() {
  const ctx = await getTrainerContext()
  if (!ctx) redirect('/login')
  if (!(await hasAddon(ctx.companyId, 'events'))) redirect('/settings?tab=addons')

  return (
    <>
      <PageHeader
        title="Events"
        subtitle="One-off events clients sign up to — workshops, seminars and meet-ups, with tickets, capacity and a guest list."
      />
      <div className="p-4 md:p-8 w-full max-w-3xl md:max-w-5xl xl:max-w-7xl mx-auto">
        <Card>
          <CardBody>
            <div className="flex flex-col items-center py-12 px-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <CalendarPlus className="h-6 w-6" />
              </div>
              <p className="mt-4 font-medium text-slate-700">No events yet</p>
              <p className="mt-1 max-w-sm text-sm text-slate-400">
                Set up a one-off event on a single date — pick the time, add ticket
                types and a capacity, and share the sign-up with your clients.
              </p>
              <Link href="/offerings/new?kind=oneoff" className="mt-5">
                <Button>
                  <Plus className="h-4 w-4" /> New event
                </Button>
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  )
}
