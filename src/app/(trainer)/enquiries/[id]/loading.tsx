import { Loader2 } from 'lucide-react'

// Tapping an enquiry row starts a client-side navigation that has to fetch this
// route's payload before anything paints. Without a route-level fallback the
// phone sits on the unchanged list for the length of that round trip, which
// reads as "the row didn't do anything" — the reported "can't click in to any
// enquiries". This guarantees the tap always visibly lands.
export default function EnquiryLoading() {
  return (
    <div className="flex flex-1 items-center justify-center min-h-[70vh]">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-teal-600" strokeWidth={1.75} />
        <p className="text-sm font-medium text-slate-400">Opening enquiry…</p>
      </div>
    </div>
  )
}
