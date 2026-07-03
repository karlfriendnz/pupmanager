import { Loader2 } from 'lucide-react'

// Shown while the schedule page's (heavy) server-side data fetch is in flight —
// sessions, availability, busy blocks, clients, packages all load in parallel,
// so a route-level fallback gives immediate feedback instead of a blank frame.
export default function ScheduleLoading() {
  return (
    <div className="flex flex-1 items-center justify-center min-h-[70vh]">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
        <p className="text-sm font-medium text-slate-400">Loading your schedule…</p>
      </div>
    </div>
  )
}
