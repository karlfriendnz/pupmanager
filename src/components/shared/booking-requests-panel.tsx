import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { CalendarClock, ChevronRight } from 'lucide-react'
import { BookingRequestActions } from './booking-request-actions'
import { schedulePreviewHref } from '@/lib/booking-request-preview'

// Trainer dashboard panel: pending client self-booking requests awaiting
// confirm/decline. Renders nothing when there are none, so it's safe to
// drop on the dashboard unconditionally.
export async function BookingRequestsPanel({ trainerId }: { trainerId: string }) {
  const requests = await prisma.bookingRequest.findMany({
    where: { trainerId, status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    include: {
      client: { select: { user: { select: { name: true } } } },
      package: { select: { name: true } },
    },
  })
  if (requests.length === 0) return null

  return (
    <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
          <CalendarClock className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-semibold text-indigo-900">
          {requests.length} booking request{requests.length === 1 ? '' : 's'} to review
        </h2>
      </div>
      <ul className="flex flex-col gap-2">
        {requests.map(r => {
          const dates = Array.isArray(r.sessionDates) ? (r.sessionDates as string[]) : []
          const first = dates.length > 0 ? new Date(String(dates[0])) : null
          return (
            <li
              key={r.id}
              className="flex items-center gap-3 rounded-lg bg-white border border-indigo-100 px-3 py-2.5"
            >
              {/* Click the request to preview its proposed sessions on the
                  schedule (ghost overlay) before confirming. */}
              <Link
                href={schedulePreviewHref(r.id)}
                className="group min-w-0 flex-1 -my-2.5 -ml-3 py-2.5 pl-3 pr-1 rounded-l-lg hover:bg-indigo-50/60"
                title="Preview these sessions on your schedule"
              >
                <p className="text-sm font-medium text-slate-900 truncate group-hover:text-indigo-900">
                  {r.client.user.name ?? 'Client'} · {r.package.name}
                </p>
                <p className="text-xs text-slate-500 flex items-center gap-1">
                  {dates.length} session{dates.length === 1 ? '' : 's'}
                  {first && !Number.isNaN(first.getTime())
                    ? ` · from ${first.toLocaleDateString()} ${first.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                    : ''}
                  <span className="inline-flex items-center text-indigo-600 font-medium">
                    <ChevronRight className="h-3 w-3" />
                    View on schedule
                  </span>
                </p>
              </Link>
              <BookingRequestActions requestId={r.id} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
