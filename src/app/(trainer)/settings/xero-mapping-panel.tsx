'use client'

import { useState } from 'react'
import { ChevronDown, Loader2, Check } from 'lucide-react'

type AccountOption = { code: string; name: string }
type TaxOption = { taxType: string; name: string }
type Item = { id: string; name: string; xeroAccountCode: string | null }

type MappingData = {
  options: { revenueAccounts: AccountOption[]; bankAccounts: AccountOption[]; taxRates: TaxOption[] }
  mapping: {
    bankAccountCode: string | null
    salesAccountCode: string | null
    taxType: string | null
    products: Item[]
    packages: Item[]
  }
}

// Settings → Integrations: the account + tax mapping a trainer sets once after
// connecting Xero. Collapsed by default; opening it loads the org's accounts /
// tax rates on demand (one Xero API call, not on every settings visit).
export function XeroMappingPanel() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<MappingData | null>(null)

  // Editable state, hydrated from the fetched mapping.
  const [bank, setBank] = useState('')
  const [sales, setSales] = useState('')
  const [tax, setTax] = useState('')
  const [itemCodes, setItemCodes] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function load() {
    if (data) { setOpen((o) => !o); return }
    setOpen(true)
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/xero/mapping')
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Couldn’t load Xero accounts.'); return }
      const d = json as MappingData
      setData(d)
      setBank(d.mapping.bankAccountCode ?? '')
      setSales(d.mapping.salesAccountCode ?? '')
      setTax(d.mapping.taxType ?? '')
      const codes: Record<string, string> = {}
      for (const p of [...d.mapping.products, ...d.mapping.packages]) codes[p.id] = p.xeroAccountCode ?? ''
      setItemCodes(codes)
    } catch {
      setError('Couldn’t load Xero accounts.')
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    if (!data) return
    setSaving(true)
    setSaved(false)
    try {
      const products: Record<string, string> = {}
      for (const p of data.mapping.products) products[p.id] = itemCodes[p.id] ?? ''
      const packages: Record<string, string> = {}
      for (const p of data.mapping.packages) packages[p.id] = itemCodes[p.id] ?? ''
      const bankName = data.options.bankAccounts.find((a) => a.code === bank)?.name ?? null
      const res = await fetch('/api/xero/mapping', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankAccountCode: bank || null,
          bankAccountName: bankName,
          salesAccountCode: sales || null,
          taxType: tax || null,
          products,
          packages,
        }),
      })
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
    } finally {
      setSaving(false)
    }
  }

  function AccountSelect({ value, onChange, withDefault }: { value: string; onChange: (v: string) => void; withDefault?: boolean }) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#13B5EA] focus:outline-none focus:ring-1 focus:ring-[#13B5EA]"
      >
        {withDefault && <option value="">Use default income account</option>}
        {!withDefault && <option value="">Select an account…</option>}
        {data!.options.revenueAccounts.map((a) => (
          <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
        ))}
      </select>
    )
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60">
      <button
        type="button"
        onClick={load}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-slate-700"
      >
        Accounts &amp; tax mapping
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-slate-200 px-4 py-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading your Xero accounts…
            </div>
          )}
          {error && <p className="text-sm text-rose-600">{error}</p>}

          {data && !loading && (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Where client payments land</span>
                  <select
                    value={bank}
                    onChange={(e) => setBank(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#13B5EA] focus:outline-none focus:ring-1 focus:ring-[#13B5EA]"
                  >
                    <option value="">Select a bank account…</option>
                    {data.options.bankAccounts.map((a) => (
                      <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Default tax rate</span>
                  <select
                    value={tax}
                    onChange={(e) => setTax(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#13B5EA] focus:outline-none focus:ring-1 focus:ring-[#13B5EA]"
                  >
                    <option value="">No tax</option>
                    {data.options.taxRates.map((t) => (
                      <option key={t.taxType} value={t.taxType}>{t.name}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">Default income account</span>
                <span className="mb-1.5 block text-xs text-slate-400">Used for any line item without its own account below.</span>
                <AccountSelect value={sales} onChange={setSales} />
              </label>

              {(data.mapping.packages.length > 0 || data.mapping.products.length > 0) && (
                <div className="space-y-3">
                  <span className="block text-xs font-semibold text-slate-600">Per-item income accounts</span>
                  {[...data.mapping.packages, ...data.mapping.products].map((item) => (
                    <div key={item.id} className="grid grid-cols-1 items-center gap-1.5 sm:grid-cols-[1fr_1.4fr]">
                      <span className="truncate text-sm text-slate-700">{item.name}</span>
                      <AccountSelect
                        value={itemCodes[item.id] ?? ''}
                        onChange={(v) => setItemCodes((m) => ({ ...m, [item.id]: v }))}
                        withDefault
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#13B5EA] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#0f9fce] disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save mapping
                </button>
                {saved && (
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
                    <Check className="h-4 w-4" /> Saved
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
