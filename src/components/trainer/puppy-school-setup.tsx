'use client'

// Dead-simple Puppy School setup. The Holiday-Programme idea: don't make the
// trainer build every day — define the day as a few parts (Morning / Afternoon…)
// and pick which weekdays EACH part runs on. Each part becomes a bookable
// session slot per day it runs, so parts can differ day to day (e.g. mornings
// every weekday, afternoons only Mon/Wed/Fri).
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Loader2, Sun, PawPrint } from 'lucide-react'
import { useCurrency } from '@/components/currency-context'
import { currencySymbol } from '@/lib/money'

interface Part { key: string; name: string; start: string; end: string; price: string; capacity: string; days: number[] }

const WEEKDAYS: { d: number; label: string }[] = [
  { d: 1, label: 'Mon' }, { d: 2, label: 'Tue' }, { d: 3, label: 'Wed' },
  { d: 4, label: 'Thu' }, { d: 5, label: 'Fri' }, { d: 6, label: 'Sat' }, { d: 0, label: 'Sun' },
]
const WEEKDAYS_ONLY = [1, 2, 3, 4, 5]
let seq = 0
const newPart = (name = '', start = '09:00', end = '12:00', days: number[] = WEEKDAYS_ONLY): Part =>
  ({ key: `p${seq++}`, name, start, end, price: '', capacity: '8', days: [...days] })

function todayISO(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

export function PuppySchoolSetup() {
  const router = useRouter()
  const currency = useCurrency()
  const sym = currencySymbol(currency)

  const [name, setName] = useState('')
  const [parts, setParts] = useState<Part[]>([newPart('Morning', '09:00', '12:00'), newPart('Afternoon', '13:00', '17:00')])
  const [startFrom, setStartFrom] = useState(todayISO())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patchPart = (key: string, p: Partial<Part>) => setParts(prev => prev.map(x => (x.key === key ? { ...x, ...p } : x)))
  const removePart = (key: string) => setParts(prev => prev.filter(x => x.key !== key))
  const togglePartDay = (key: string, d: number) => setParts(prev => prev.map(x =>
    x.key === key ? { ...x, days: x.days.includes(d) ? x.days.filter(v => v !== d) : [...x.days, d] } : x))
  // New parts inherit the previous part's days — the common case (same days) stays one tap.
  const addPart = () => setParts(prev => [...prev, newPart('', '13:00', '17:00', prev[prev.length - 1]?.days ?? WEEKDAYS_ONLY)])

  const validParts = parts.filter(p => p.start && p.end && p.end > p.start && p.days.length > 0)
  const canCreate = !!name.trim() && validParts.length > 0 && !!startFrom

  async function create() {
    setError(null)
    if (validParts.length === 0) return setError('Add at least one part with an end time after the start and at least one day.')

    // Each part → one session slot per weekday it runs on.
    const sessionSlots = validParts.flatMap(part =>
      [...part.days].sort().map(day => ({
        day,
        startTime: part.start,
        endTime: part.end,
        priceCents: part.price.trim() ? Math.round(Number(part.price) * 100) : null,
        capacity: part.capacity.trim() ? Number(part.capacity) : null,
        startDate: startFrom,
        recurrenceRule: 'FREQ=WEEKLY',
      })),
    )

    setSaving(true)
    try {
      const res = await fetch('/api/packages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          sessionCount: 0, // ongoing
          weeksBetween: 1,
          durationMins: 60,
          isGroup: true,
          isPuppySchool: true,
          allowWaitlist: true,
          clientSelfBook: true,
          selfBookRequiresApproval: false,
          sessionSlots,
        }),
      })
      if (!res.ok) { setError('Could not create the school — please check the fields and try again.'); return }
      router.push('/puppy-school')
      router.refresh()
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl">
      {error && <div className="mb-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">{error}</div>}

      <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
        {/* Name */}
        <div className="p-5">
          <label className="block text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5"><PawPrint className="h-4 w-4 text-teal-600" /> School name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Waggy Tails Doggy Daycare" className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm" />
        </div>

        {/* Parts of the day — each with its own days */}
        <div className="p-5">
          <div className="text-sm font-medium text-slate-700 mb-1 flex items-center gap-1.5"><Sun className="h-4 w-4 text-amber-500" /> Parts of the day</div>
          <p className="text-xs text-slate-500 mb-3">Split the day however you like — parents book the parts they want. Pick which days <em>each</em> part runs, so parts can differ day to day.</p>
          <div className="flex flex-col gap-2.5">
            {parts.map(part => (
              <div key={part.key} className="rounded-xl border border-slate-200 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <input value={part.name} onChange={e => patchPart(part.key, { name: e.target.value })} placeholder="Name (e.g. Morning)" className="h-9 flex-1 min-w-[8rem] rounded-lg border border-slate-200 px-2.5 text-sm" />
                  <input type="time" value={part.start} onChange={e => patchPart(part.key, { start: e.target.value })} className="h-9 rounded-lg border border-slate-200 px-2 text-sm" />
                  <span className="text-slate-400 text-sm">→</span>
                  <input type="time" value={part.end} onChange={e => patchPart(part.key, { end: e.target.value })} className="h-9 rounded-lg border border-slate-200 px-2 text-sm" />
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{sym}</span>
                    <input value={part.price} onChange={e => patchPart(part.key, { price: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" placeholder="Price" className="h-9 w-20 rounded-lg border border-slate-200 pl-6 pr-2 text-sm" />
                  </div>
                  <input value={part.capacity} onChange={e => patchPart(part.key, { capacity: e.target.value.replace(/[^0-9]/g, '') })} inputMode="numeric" placeholder="Cap" title="Max dogs" className="h-9 w-16 rounded-lg border border-slate-200 px-2 text-sm" />
                  <button onClick={() => removePart(part.key)} disabled={parts.length === 1} title="Remove" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
                </div>
                {/* Per-part weekdays */}
                <div className="flex flex-wrap items-center gap-1 mt-2">
                  <span className="text-[11px] text-slate-400 mr-1">Runs</span>
                  {WEEKDAYS.map(({ d, label }) => {
                    const on = part.days.includes(d)
                    return (
                      <button key={d} onClick={() => togglePartDay(part.key, d)} className={`h-7 px-2.5 rounded-md text-xs font-medium border ${on ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}>{label}</button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <button onClick={addPart} className="mt-2 inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-dashed border-slate-300 text-slate-600 hover:bg-slate-50"><Plus className="h-4 w-4" /> Add a part</button>
        </div>

        {/* Start from */}
        <div className="p-5">
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Starts from</label>
          <input type="date" value={startFrom} onChange={e => setStartFrom(e.target.value)} className="h-10 rounded-lg border border-slate-200 px-3 text-sm" />
          <p className="text-xs text-slate-500 mt-1.5">The school runs on an ongoing basis from this date. You can change day-parts and prices later.</p>
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <button onClick={create} disabled={saving || !canCreate} className="inline-flex items-center gap-2 h-11 px-5 text-sm font-semibold rounded-xl bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PawPrint className="h-4 w-4" />} Create doggy daycare
        </button>
      </div>
    </div>
  )
}
