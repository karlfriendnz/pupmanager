'use client'

import { normalizeBufferMins } from '@/lib/buffer'

// The trainer-facing control for a package's / class's turnaround gap — the
// time blocked out AFTER each session so nothing can be booked into travel,
// clean-up or reset. Shared by the package form and the class form so the
// wording and the options never drift.

const PRESETS = [0, 15, 30, 45, 60, 90, 120] as const

function label(mins: number): string {
  if (mins === 0) return 'No gap (back-to-back)'
  if (mins < 60) return `${mins} minutes`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  const hours = `${h} hour${h === 1 ? '' : 's'}`
  return m === 0 ? hours : `${hours} ${m}`
}

/** Preset list, always including the current value (an older/odd value stays visible). */
export function bufferOptions(current: number): { value: number; label: string }[] {
  const mins = normalizeBufferMins(current)
  const values = PRESETS.includes(mins as (typeof PRESETS)[number])
    ? [...PRESETS]
    : [...PRESETS, mins].sort((a, b) => a - b)
  return values.map(v => ({ value: v, label: label(v) }))
}

export function BufferField({
  value,
  onChange,
  id = 'buffer-mins',
  help = 'Time you need after each session — travel, clean-up, a breather. Nothing can be booked into it.',
}: {
  value: number
  onChange: (mins: number) => void
  id?: string
  help?: string
}) {
  const mins = normalizeBufferMins(value)
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-slate-700 block mb-1.5">
        Gap before the next session
      </label>
      <select
        id={id}
        value={String(mins)}
        onChange={e => onChange(normalizeBufferMins(Number(e.target.value)))}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {bufferOptions(mins).map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <p className="text-[11px] text-slate-400 mt-1">{help}</p>
    </div>
  )
}
