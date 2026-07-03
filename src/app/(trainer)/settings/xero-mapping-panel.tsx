'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { Loader2, Check, ExternalLink } from 'lucide-react'

// Deep links into the trainer's own Xero org (Xero redirects to their tenant).
const XERO_BANK_ACCOUNTS = 'https://go.xero.com/app/manage-bank-accounts'
const XERO_CHART_OF_ACCOUNTS = 'https://go.xero.com/app/chart-of-accounts'

// One numbered step in the setup flow. Hidden until the previous step is done
// (progressive reveal) so the trainer only ever sees one thing to do next.
function Step({ n, title, required, hint, visible = true, children }: { n: number; title: string; required?: boolean; hint?: string; visible?: boolean; children: ReactNode }) {
  if (!visible) return null
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-white">{n}</div>
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        <div>
          <p className="text-sm font-semibold text-slate-800">{title}{required && <span className="text-rose-500"> *</span>}</p>
          {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
        </div>
        {children}
      </div>
    </div>
  )
}

// A "do this in Xero" outbound link.
function XeroLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-[#13B5EA] hover:underline">
      {label} <ExternalLink className="h-3 w-3" />
    </a>
  )
}

type AccountOption = { code: string; name: string }
type TaxOption = { taxType: string; name: string }
type Item = { id: string; name: string; xeroAccountCode: string | null }

type MappingData = {
  options: { revenueAccounts: AccountOption[]; bankAccounts: AccountOption[]; taxRates: TaxOption[] }
  mapping: {
    bankAccountCode: string | null
    salesAccountCode: string | null
    taxType: string | null
    accountShortlist: AccountOption[]
    products: Item[]
    packages: Item[]
  }
}

// Settings → Integrations: the account + tax mapping a trainer sets once after
// connecting Xero. Collapsed by default; opening it loads the org's accounts /
// tax rates on demand (one Xero API call, not on every settings visit).
export function XeroMappingPanel() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<MappingData | null>(null)

  // Editable state, hydrated from the fetched mapping.
  const [bank, setBank] = useState('')
  const [sales, setSales] = useState('')
  const [tax, setTax] = useState('')
  const [itemCodes, setItemCodes] = useState<Record<string, string>>({})
  const [shortlist, setShortlist] = useState<AccountOption[]>([])
  const [toAdd, setToAdd] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Load the org's accounts/tax rates once on mount — the panel is always shown
  // now (no accordion), so there's no "open" trigger to hang the fetch off.
  useEffect(() => {
    load()
  }, [])

  async function load() {
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
      setShortlist(d.mapping.accountShortlist ?? [])
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
          accountShortlist: shortlist,
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

  const hasItems = !!data && (data.mapping.packages.length > 0 || data.mapping.products.length > 0)

  // "Accounts you use" names must each be non-empty AND unique (they're the
  // labels people pick from on the create forms, so a duplicate is ambiguous).
  const normNames = shortlist.map((a) => a.name.trim().toLowerCase())
  const dupeNames = new Set(normNames.filter((n, i) => n && normNames.indexOf(n) !== i))
  const isDupe = (name: string) => dupeNames.has(name.trim().toLowerCase())
  const shortlistValid = shortlist.every((a) => a.name.trim().length > 0) && dupeNames.size === 0

  const complete = !!bank && !!tax && !!sales

  return (
    <div className="mt-5 border-t border-slate-100 pt-5">
      <p className="text-sm font-semibold text-slate-800">Finish your Xero setup</p>
      <p className="mt-0.5 text-xs text-slate-500">A few one-time choices so your invoices and payments post to the right places.</p>

      {loading && (
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your Xero accounts…
        </div>
      )}
      {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}

      {data && !loading && (
        <div className="mt-5 space-y-6">
          <Step n={1} title="Where client payments land" required>
            {data.options.bankAccounts.length === 0 ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                You don’t have a bank account in Xero yet. Add one in Xero, then reload this page.
              </p>
            ) : (
              <select
                value={bank}
                onChange={(e) => setBank(e.target.value)}
                className="w-full max-w-md rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#13B5EA] focus:outline-none focus:ring-1 focus:ring-[#13B5EA]"
              >
                <option value="">Select a bank account…</option>
                {data.options.bankAccounts.map((a) => (
                  <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
                ))}
              </select>
            )}
            <div><XeroLink href={XERO_BANK_ACCOUNTS} label="Add or manage bank accounts in Xero" /></div>
          </Step>

          <Step n={2} title="Your default tax rate" required visible={!!bank}>
            <select
              value={tax}
              onChange={(e) => setTax(e.target.value)}
              className="w-full max-w-md rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#13B5EA] focus:outline-none focus:ring-1 focus:ring-[#13B5EA]"
            >
              <option value="">Select a tax rate…</option>
              {data.options.taxRates.map((t) => (
                <option key={t.taxType} value={t.taxType}>{t.name}</option>
              ))}
            </select>
          </Step>

          <Step n={3} title="Your default income account" required hint="Used for any product, package or class without its own account." visible={!!bank && !!tax}>
            <div className="max-w-md"><AccountSelect value={sales} onChange={setSales} /></div>
            <div><XeroLink href={XERO_CHART_OF_ACCOUNTS} label="Manage your chart of accounts in Xero" /></div>
          </Step>

          <Step n={4} title="Accounts you use" visible={complete} hint="Add the income accounts you sell against and name each one however makes sense to you. You can add the same Xero account more than once under different names — they’re offered when you create a product, package or class.">
            {shortlist.length > 0 && (
              <div className="flex max-w-md flex-col gap-1.5">
                {shortlist.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                    <input
                      value={a.name}
                      onChange={(e) => setShortlist((s) => s.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                      placeholder="Name this account"
                      className={`min-w-0 flex-1 rounded-md border bg-white px-2 py-1 text-sm text-slate-700 focus:outline-none focus:ring-1 ${
                        a.name.trim() === '' || isDupe(a.name)
                          ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-400'
                          : 'border-slate-200 focus:border-[#13B5EA] focus:ring-[#13B5EA]'
                      }`}
                    />
                    <span className="shrink-0 text-xs text-slate-400" title="Xero account code">{a.code}</span>
                    <button
                      type="button"
                      onClick={() => setShortlist((s) => s.filter((_, j) => j !== i))}
                      className="shrink-0 text-xs font-medium text-slate-400 hover:text-rose-500"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            {!shortlistValid && shortlist.length > 0 && (
              <p className="max-w-md text-xs text-rose-500">Give every account a name, and make each name different from the others.</p>
            )}
            <div className="flex max-w-md items-center gap-2">
              <select
                value={toAdd}
                onChange={(e) => setToAdd(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#13B5EA] focus:outline-none focus:ring-1 focus:ring-[#13B5EA]"
              >
                <option value="">Add an account…</option>
                {data.options.revenueAccounts.map((a) => (
                  <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={!toAdd}
                onClick={() => {
                  const acc = data.options.revenueAccounts.find((a) => a.code === toAdd)
                  if (acc) { setShortlist((s) => [...s, { code: acc.code, name: acc.name }]); setToAdd('') }
                }}
                className="shrink-0 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </Step>

          {complete && hasItems && (
            <Step n={5} title="Per-item income accounts" hint="Override the account for a specific product or package (optional).">
              <div className="max-w-md space-y-2">
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
            </Step>
          )}

          {complete && (
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5">
              <button
                type="button"
                onClick={save}
                disabled={saving || !shortlistValid}
                className="inline-flex items-center gap-2 rounded-xl bg-[#13B5EA] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#0f9fce] disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save setup
              </button>
              {saved && (
                <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
                  <Check className="h-4 w-4" /> Saved
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
