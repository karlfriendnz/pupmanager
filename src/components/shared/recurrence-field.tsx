'use client'

import { useState } from 'react'
import { X, Info } from 'lucide-react'
import { ModalPortal } from '@/components/shared/modal-portal'
import {
  buildRepeatOptions, rruleToSummary, parseRule,
  WEEKDAY_CODES, WEEKDAY_LABELS,
} from '@/lib/recurrence'

// Repeating-schedule picker, ported from the FM-Events design: a preset
// dropdown (Daily / Weekly on X / Monthly / Every weekday / Custom…) that opens
// a Google-Calendar-style custom dialog — repeat-every interval + unit, a
// weekday picker, an end condition, and a live plain-English summary. Emits an
// RRULE string (see lib/recurrence.ts); '' means "does not repeat".
export function RecurrenceField({
  value,
  onChange,
  baseDate = null,
}: {
  value: string
  onChange: (rrule: string) => void
  /** When known, presets name the actual day ("Weekly on Tuesday"). */
  baseDate?: Date | null
}) {
  const [customOpen, setCustomOpen] = useState(false)
  const presets = buildRepeatOptions(baseDate)
  const current = value || 'NONE'
  // A rule the presets don't list (a custom one) gets its own summarised row so
  // the select can show it as selected.
  const known = presets.some(o => o.value === current)
  const options = known
    ? presets
    : [
        ...presets.slice(0, presets.length - 1),
        { label: rruleToSummary(current), value: current },
        presets[presets.length - 1],
      ]

  function onSelect(v: string) {
    if (v === 'CUSTOM') setCustomOpen(true)
    else onChange(v === 'NONE' ? '' : v)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <select
        value={current}
        onChange={e => onSelect(e.target.value)}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      {value && value !== 'NONE' && (
        <p className="text-[11px] text-slate-400">{rruleToSummary(value)}</p>
      )}

      {customOpen && (
        <CustomRecurrenceDialog
          value={value}
          baseDate={baseDate}
          onClose={() => setCustomOpen(false)}
          onSave={rule => { onChange(rule); setCustomOpen(false) }}
        />
      )}
    </div>
  )
}

const FREQ_OPTIONS = [
  { label: 'days', value: 'DAILY' },
  { label: 'weeks', value: 'WEEKLY' },
  { label: 'months', value: 'MONTHLY' },
  { label: 'years', value: 'YEARLY' },
] as const

type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
type EndKind = 'NEVER' | 'UNTIL' | 'COUNT'

function CustomRecurrenceDialog({
  value, baseDate, onClose, onSave,
}: {
  value: string
  baseDate: Date | null
  onClose: () => void
  onSave: (rrule: string) => void
}) {
  // Seed from the current rule, else sensible defaults off the base date.
  const [state] = useState(() => {
    const p = parseRule(value)
    const seedDow = baseDate ? WEEKDAY_CODES[(baseDate.getDay() + 6) % 7] : 'MO'
    return {
      interval: parseInt(p['INTERVAL'] ?? '1') || 1,
      freq: (p['FREQ'] as Freq) || 'WEEKLY',
      byDay: p['BYDAY'] ? p['BYDAY'].split(',').map(d => d.replace(/^-?\d+/, '')) : [seedDow],
      byMonthDay: p['BYMONTHDAY'] ? parseInt(p['BYMONTHDAY']) : (baseDate?.getDate() ?? 1),
      end: (p['UNTIL'] ? 'UNTIL' : p['COUNT'] ? 'COUNT' : 'NEVER') as EndKind,
      until: p['UNTIL']
        ? `${p['UNTIL'].slice(0, 4)}-${p['UNTIL'].slice(4, 6)}-${p['UNTIL'].slice(6, 8)}`
        : '',
      count: p['COUNT'] ? parseInt(p['COUNT']) : 10,
    }
  })
  const [interval, setInterval] = useState(state.interval)
  const [freq, setFreq] = useState<Freq>(state.freq)
  const [byDay, setByDay] = useState<string[]>(state.byDay)
  const [byMonthDay, setByMonthDay] = useState<number>(state.byMonthDay)
  const [end, setEnd] = useState<EndKind>(state.end)
  const [until, setUntil] = useState<string>(state.until)
  const [count, setCount] = useState<number>(state.count)

  function toggleDay(code: string) {
    setByDay(d => d.includes(code) ? d.filter(c => c !== code) : [...d, code])
  }

  function buildRule(): string {
    const parts: string[] = [`FREQ=${freq}`]
    if (interval > 1) parts.push(`INTERVAL=${interval}`)
    if (freq === 'WEEKLY' && byDay.length) {
      parts.push(`BYDAY=${WEEKDAY_CODES.filter(c => byDay.includes(c)).join(',')}`)
    }
    if (freq === 'MONTHLY' && byMonthDay) parts.push(`BYMONTHDAY=${byMonthDay}`)
    if (end === 'UNTIL' && until) parts.push(`UNTIL=${until.replaceAll('-', '')}T235959Z`)
    else if (end === 'COUNT' && count) parts.push(`COUNT=${count}`)
    return parts.join(';')
  }

  const summary = rruleToSummary(buildRule(), d => d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }))

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 p-0 sm:p-4" onClick={onClose}>
        <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-xl max-h-[90dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white">
            <h2 className="font-semibold text-slate-900">Custom recurrence</h2>
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>

          {/* Repeat every N [unit] */}
          <div className="px-5 py-4 border-b border-slate-100">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Repeat every</p>
            <div className="flex items-center gap-2">
              <input
                type="number" min={1} max={99} value={interval}
                onChange={e => setInterval(Math.max(1, Number(e.target.value) || 1))}
                className="h-11 w-20 rounded-xl border border-slate-200 bg-white px-3 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <select
                value={freq} onChange={e => setFreq(e.target.value as Freq)}
                className="h-11 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {FREQ_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* Weekly → day picker */}
          {freq === 'WEEKLY' && (
            <div className="px-5 py-4 border-b border-slate-100">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Repeat on</p>
              <div className="flex gap-1.5">
                {WEEKDAY_CODES.map((code, i) => (
                  <button
                    key={code} type="button" onClick={() => toggleDay(code)}
                    className={`w-9 h-9 rounded-full text-xs font-semibold transition-colors ${
                      byDay.includes(code) ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {WEEKDAY_LABELS[i]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Monthly → day-of-month */}
          {freq === 'MONTHLY' && (
            <div className="px-5 py-4 border-b border-slate-100">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Repeat on</p>
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <span>Day</span>
                <input
                  type="number" min={1} max={31} value={byMonthDay}
                  onChange={e => setByMonthDay(Math.min(31, Math.max(1, Number(e.target.value) || 1)))}
                  className="h-11 w-20 rounded-xl border border-slate-200 bg-white px-3 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span>of the month</span>
              </div>
            </div>
          )}

          {/* Ends */}
          <div className="px-5 py-4">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-3">Ends</p>
            <div className="flex flex-col gap-2.5">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="radio" name="rec-end" checked={end === 'NEVER'} onChange={() => setEnd('NEVER')} className="h-4 w-4" />
                <span className="text-sm text-slate-700">Never</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="radio" name="rec-end" checked={end === 'UNTIL'} onChange={() => setEnd('UNTIL')} className="h-4 w-4" />
                <span className="text-sm text-slate-700 w-12">On</span>
                <input
                  type="date" value={until} disabled={end !== 'UNTIL'}
                  onChange={e => { setUntil(e.target.value); setEnd('UNTIL') }}
                  className="h-11 flex-1 max-w-[200px] rounded-xl border border-slate-200 bg-white px-3 text-sm disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="radio" name="rec-end" checked={end === 'COUNT'} onChange={() => setEnd('COUNT')} className="h-4 w-4" />
                <span className="text-sm text-slate-700 w-12">After</span>
                <input
                  type="number" min={1} max={999} value={count} disabled={end !== 'COUNT'}
                  onChange={e => { setCount(Math.max(1, Number(e.target.value) || 1)); setEnd('COUNT') }}
                  className="h-11 w-20 rounded-xl border border-slate-200 bg-white px-3 text-sm text-center disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-500">occurrences</span>
              </label>
            </div>
          </div>

          {/* Live summary */}
          <div className="px-5 py-3 bg-blue-50 border-t border-blue-100 flex items-center gap-2">
            <Info className="h-3.5 w-3.5 text-blue-600 shrink-0" />
            <p className="text-xs text-blue-700 font-medium">{summary}</p>
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-700">Cancel</button>
            <button type="button" onClick={() => onSave(buildRule())} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Save</button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
