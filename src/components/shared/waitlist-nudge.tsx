import Link from 'next/link'
import { ListChecks, ArrowRight } from 'lucide-react'
import { waitingCount } from '@/lib/waitlist'

// Persistent nudge: when people are waiting, prompt the trainer to work
// the list (the "you have availability — N are waiting" cue). Renders
// nothing when the waitlist is empty, so it's safe to drop anywhere.
export async function WaitlistNudge({ trainerId }: { trainerId: string }) {
  const count = await waitingCount(trainerId)
  if (count === 0) return null

  return (
    <Link
      href="/clients?tab=waitlist"
      className="mb-6 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 hover:bg-amber-100/70 transition-colors"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700 flex-shrink-0">
        <ListChecks className="h-4 w-4" />
      </span>
      <span className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-900">
          {count} {count === 1 ? 'person is' : 'people are'} on your waitlist
        </p>
        <p className="text-xs text-amber-700">
          Got a slot free? Review who&apos;s waiting and book them in.
        </p>
      </span>
      <ArrowRight className="h-4 w-4 text-amber-700 flex-shrink-0" />
    </Link>
  )
}
