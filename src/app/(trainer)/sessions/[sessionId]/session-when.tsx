import Link from 'next/link'
import { Calendar } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * When the session is — and, on a tap, the schedule with this session in hand
 * (Karl: "when you click on the date, be taken to the schedule view where you
 * can select a time for that session and then be redirected back").
 *
 * It used to edit in place: date field, time field, minutes, Save. That asked
 * the trainer to know a time was free. The grid already knows — it is the one
 * screen that shows what else is on — so picking there is picking with the
 * answer in front of you, and the schedule sends them straight back when the
 * session lands.
 *
 * Server-side, because it is now only a link, and a server component cannot
 * hand a Lucide icon to a client one.
 */
export function SessionWhenRow({
  sessionId,
  scheduledAt,
  durationMins,
  extra,
  accent,
  backHref,
}: {
  sessionId: string
  /** ISO string. */
  scheduledAt: string
  durationMins: number
  /** Place, "Virtual", buddy count — whatever else rides on the time line. */
  extra?: string | null
  accent?: string | null
  /** Where the schedule returns to once the session has moved. */
  backHref: string
}) {
  const d = new Date(scheduledAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const href = `/schedule?date=${dateStr}&move=${sessionId}&back=${encodeURIComponent(backHref)}`

  const Icon: LucideIcon = Calendar

  return (
    <Link
      href={href}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
    >
      <Icon
        className="h-[18px] w-[18px] flex-shrink-0 text-slate-700"
        style={accent ? { color: `color-mix(in srgb, ${accent} 78%, #0f172a)` } : undefined}
        strokeWidth={1.75}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">
          {d.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-slate-500">
          {[
            `${d.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })} · ${durationMins} min`,
            extra || null,
          ].filter(Boolean).join(' · ')}
        </span>
      </span>
    </Link>
  )
}
