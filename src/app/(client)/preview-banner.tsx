import { Eye, ArrowLeft } from 'lucide-react'
import { exitClientPreview } from '@/app/preview-as/actions'

// Sticky banner shown above the AppShell whenever a trainer is browsing the
// client app via preview cookie. The exit button is a server-action form so
// the cookie clears reliably without JS.
export function PreviewBanner({ clientName }: { clientName: string }) {
  return (
    <div className="sticky top-0 z-50 flex items-center justify-between gap-3 px-4 py-2 bg-amber-100 border-b border-amber-200 text-amber-900 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <Eye className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="font-medium truncate">
          Previewing as <span className="font-semibold">{clientName}</span>
        </span>
        <span className="hidden sm:inline text-xs text-amber-700/80">
          · what your client sees · actions are disabled
        </span>
      </div>
      <form action={async () => { 'use server'; await exitClientPreview() }}>
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/70 hover:bg-white text-amber-800 text-xs font-medium transition-colors shrink-0"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Exit preview
        </button>
      </form>
    </div>
  )
}
