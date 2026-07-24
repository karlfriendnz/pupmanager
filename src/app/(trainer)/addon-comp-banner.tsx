import Link from 'next/link'
import { Gift } from 'lucide-react'
import type { ActiveComp } from '@/lib/addon-grants'

// Slim informational strip shown while an admin has comped an add-on with an
// expiry: tells the trainer how many days of the free trial are left. Purely
// time-limited and informative (no dismissal) — it disappears on its own once
// the comp lapses. Turns amber in the final few days.
export function AddonCompBanner({ comps }: { comps: ActiveComp[] }) {
  if (comps.length === 0) return null
  return (
    <div className="mb-4 flex flex-col gap-2">
      {comps.map(c => {
        const soon = c.daysLeft <= 3
        return (
          <div
            key={c.itemId}
            className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border px-3.5 py-2.5 text-sm ${
              soon ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-teal-200 bg-teal-50 text-teal-900'
            }`}
          >
            <Gift className="h-4 w-4 shrink-0" />
            <span>
              <strong>{c.daysLeft} day{c.daysLeft === 1 ? '' : 's'} left</strong> of your free <strong>{c.name}</strong> trial.
            </span>
            <span className={soon ? 'text-amber-700' : 'text-teal-700'}>It’ll switch off after that — no charge.</span>
            <Link href="/settings?tab=addons" className="ml-auto font-medium underline underline-offset-2 hover:no-underline">
              Keep it on
            </Link>
          </div>
        )
      })}
    </div>
  )
}
