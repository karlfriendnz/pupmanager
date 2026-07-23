'use client'

import { Plus, X } from 'lucide-react'

// Really-simple tickets for a one-off event: a few tiers, each with a name, a
// price and a capacity (blank = unlimited). Emits the array; pricing/inventory
// wiring is downstream.

export type TicketTier = {
  id: string
  name: string
  price: string // dollars as typed; '' = free
  capacity: string // '' = unlimited
}

export function newTier(): TicketTier {
  return { id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`, name: '', price: '', capacity: '' }
}

export function TicketTiersEditor({
  value,
  onChange,
}: {
  value: TicketTier[]
  onChange: (tiers: TicketTier[]) => void
}) {
  function update(id: string, patch: Partial<TicketTier>) {
    onChange(value.map(t => (t.id === id ? { ...t, ...patch } : t)))
  }
  const cell = 'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="md:col-span-2 flex flex-col gap-2">
      <div className="hidden sm:grid grid-cols-[1.6fr_1fr_1fr_auto] gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <span>Ticket name</span><span>Price</span><span>Capacity</span><span />
      </div>

      {value.map(t => (
        <div key={t.id} className="grid grid-cols-2 sm:grid-cols-[1.6fr_1fr_1fr_auto] gap-2 items-center rounded-xl border border-slate-100 bg-slate-50/40 sm:bg-transparent sm:border-0 p-2 sm:p-0">
          <label className="flex flex-col gap-1 col-span-2 sm:col-span-1">
            <span className="sm:hidden text-[11px] font-medium text-slate-400">Ticket name</span>
            <input value={t.name} onChange={e => update(t.id, { name: e.target.value })} placeholder="e.g. General, VIP" className={cell} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="sm:hidden text-[11px] font-medium text-slate-400">Price</span>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
              <input value={t.price} onChange={e => update(t.id, { price: e.target.value })} inputMode="decimal" placeholder="0.00" className={cell + ' pl-6'} />
            </div>
          </label>
          <label className="flex flex-col gap-1">
            <span className="sm:hidden text-[11px] font-medium text-slate-400">Capacity</span>
            <input value={t.capacity} onChange={e => update(t.id, { capacity: e.target.value })} type="number" min={1} placeholder="∞" className={cell + ' text-center'} />
          </label>
          <button
            type="button"
            onClick={() => onChange(value.filter(x => x.id !== t.id))}
            className="justify-self-end sm:justify-self-center text-slate-300 hover:text-red-500"
            aria-label="Remove this ticket"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...value, newTier()])}
        className="self-start inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:border-blue-400 hover:text-blue-600"
      >
        <Plus className="h-4 w-4" /> Add ticket
      </button>
    </div>
  )
}
