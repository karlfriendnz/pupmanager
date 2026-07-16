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
// A curated "Accounts you use" entry. `default` marks the one that acts as the
// fallback income account (persisted to the connection's salesAccountCode).
type ShortlistEntry = { code: string; name: string; default?: boolean }
type TaxOption = { taxType: string; name: string }

type MappingData = {
  options: {
    revenueAccounts: AccountOption[]
    bankAccounts: AccountOption[]
    expenseAccounts: AccountOption[]
    taxRates: TaxOption[]
  }
  mapping: {
    bankAccountCode: string | null
    salesAccountCode: string | null
    taxType: string | null
    clearingAccountCode: string | null
    feeAccountCode: string | null
    surchargeAccountCode: string | null
    accountShortlist: ShortlistEntry[]
  }
}

// A labelled account <select>. Used by every picker below.
function AccountSelect({
  value, onChange, options, placeholder,
}: { value: string; onChange: (v: string) => void; options: AccountOption[]; placeholder: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full max-w-md rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#13B5EA] focus:outline-none focus:ring-1 focus:ring-[#13B5EA]"
    >
      <option value="">{placeholder}</option>
      {options.map((a) => (
        <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
      ))}
    </select>
  )
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
  const [tax, setTax] = useState('')
  // Stripe clearing model: the gross card payment lands in `clearing`, both fees
  // are expensed to `feeAccount`, and a client-paid card surcharge is income to
  // `surchargeAccount` (optional — falls back to the default income account).
  const [clearing, setClearing] = useState('')
  const [feeAccount, setFeeAccount] = useState('')
  const [surchargeAccount, setSurchargeAccount] = useState('')
  const [shortlist, setShortlist] = useState<ShortlistEntry[]>([])
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
      setTax(d.mapping.taxType ?? '')
      setClearing(d.mapping.clearingAccountCode ?? '')
      setFeeAccount(d.mapping.feeAccountCode ?? '')
      setSurchargeAccount(d.mapping.surchargeAccountCode ?? '')
      // Hydrate the shortlist; if no entry is flagged default yet (older data),
      // mark the one matching the saved salesAccountCode as the default.
      const list = d.mapping.accountShortlist ?? []
      const hasFlag = list.some((a) => a.default)
      setShortlist(
        hasFlag ? list : list.map((a) => ({ ...a, default: a.code === d.mapping.salesAccountCode })),
      )
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
      // Per-item accounts are set on the items themselves (product/package/class
      // forms), so the panel never sends products/packages here.
      const bankName = data.options.bankAccounts.find((a) => a.code === bank)?.name ?? null
      const clearingName = data.options.bankAccounts.find((a) => a.code === clearing)?.name ?? null
      const res = await fetch('/api/xero/mapping', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankAccountCode: bank || null,
          bankAccountName: bankName,
          salesAccountCode: shortlist.find((a) => a.default)?.code ?? null,
          taxType: tax || null,
          clearingAccountCode: clearing || null,
          clearingAccountName: clearingName,
          feeAccountCode: feeAccount || null,
          surchargeAccountCode: surchargeAccount || null,
          accountShortlist: shortlist,
        }),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      } else {
        const json = await res.json().catch(() => ({}))
        setError(json.error ?? 'Couldn’t save your Xero setup.')
      }
    } finally {
      setSaving(false)
    }
  }

  // "Accounts you use" names must each be non-empty AND unique (they're the
  // labels people pick from on the create forms, so a duplicate is ambiguous).
  const normNames = shortlist.map((a) => a.name.trim().toLowerCase())
  const dupeNames = new Set(normNames.filter((n, i) => n && normNames.indexOf(n) !== i))
  const isDupe = (name: string) => dupeNames.has(name.trim().toLowerCase())
  const shortlistValid = shortlist.every((a) => a.name.trim().length > 0) && dupeNames.size === 0
  // One curated account must be the default (the fallback income account).
  const hasDefault = shortlist.some((a) => a.default)

  // Clearing MUST be a different account from the bank — pointing it at the bank
  // reintroduces the exact mismatch it exists to fix (gross posted to the bank,
  // fees taken back out of it).
  const clearingIsBank = !!clearing && clearing === bank

  const complete = !!bank && !!clearing && !clearingIsBank && !!feeAccount && !!tax && hasDefault

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
          <Step n={1} title="Your real bank account" required hint="The account Stripe pays your money out into — the one with the bank feed in Xero.">
            {data.options.bankAccounts.length === 0 ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                You don’t have a bank account in Xero yet. Add one in Xero, then reload this page.
              </p>
            ) : (
              <AccountSelect value={bank} onChange={setBank} options={data.options.bankAccounts} placeholder="Select a bank account…" />
            )}
            <div><XeroLink href={XERO_BANK_ACCOUNTS} label="Add or manage bank accounts in Xero" /></div>
          </Step>

          <Step n={2} title="Your Stripe clearing account" required visible={!!bank}>
            <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-900">
              Stripe doesn’t pay the full invoice into your bank — it takes its fee first. If a client pays a $150 invoice,
              about $145 turns up in your bank, so a payment recorded as $150 straight to your bank account will never
              match your bank feed.
              <br /><br />
              A <strong>clearing account</strong> fixes that. We record the payment there in full, then record Stripe’s fee
              and PupManager’s fee coming out of it. What’s left is exactly what Stripe pays you — so when the payout hits
              your bank feed, it matches to the cent, and both fees land in your books as expenses you can claim.
              <br /><br />
              In Xero, add a new <strong>bank account</strong> called something like “Stripe Clearing” (Xero → Add Bank Account →
              choose the manual option), then pick it below.
            </p>
            <AccountSelect value={clearing} onChange={setClearing} options={data.options.bankAccounts} placeholder="Select your Stripe clearing account…" />
            {clearingIsBank && (
              <p className="text-xs text-rose-600">
                This has to be a different account from your real bank account — otherwise nothing is fixed. Add a separate
                “Stripe Clearing” bank account in Xero.
              </p>
            )}
            <div><XeroLink href={XERO_BANK_ACCOUNTS} label="Add a clearing account in Xero" /></div>
          </Step>

          <Step
            n={3}
            title="Where card fees are recorded"
            required
            visible={!!bank && !!clearing && !clearingIsBank}
            hint="The expense account for Stripe’s processing fee and PupManager’s fee. Most trainers use something like “Bank Fees” or “Merchant Fees”."
          >
            {data.options.expenseAccounts.length === 0 ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                You don’t have an expense account in Xero yet. Add one (e.g. “Merchant Fees”), then reload this page.
              </p>
            ) : (
              <AccountSelect value={feeAccount} onChange={setFeeAccount} options={data.options.expenseAccounts} placeholder="Select an expense account…" />
            )}
            <div><XeroLink href={XERO_CHART_OF_ACCOUNTS} label="Manage your chart of accounts in Xero" /></div>
          </Step>

          <Step n={4} title="Your default tax rate" required visible={!!bank && !!clearing && !clearingIsBank && !!feeAccount}>
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

          <Step n={5} title="Accounts you use" visible={!!bank && !!clearing && !clearingIsBank && !!feeAccount && !!tax} hint="Add the income accounts you sell against and name each one however makes sense to you. Mark one as the default — it’s the fallback for anything without its own account. You can add the same Xero account more than once under different names.">
            {shortlist.length > 0 && (
              <div className="flex flex-col gap-1.5">
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
                    <button
                      type="button"
                      onClick={() => setShortlist((s) => s.map((x, j) => ({ ...x, default: j === i })))}
                      title="Use this as the default (fallback) income account"
                      style={{ minHeight: 0, minWidth: 0, height: 24 }}
                      className={`inline-flex items-center shrink-0 rounded-full px-2.5 text-[11px] font-semibold leading-none transition-colors ${
                        a.default ? 'bg-[#13B5EA] text-white' : 'text-slate-400 hover:text-[#13B5EA]'
                      }`}
                    >
                      {a.default ? 'Default' : 'Set default'}
                    </button>
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
              <p className="text-xs text-rose-500">Give every account a name, and make each name different from the others.</p>
            )}
            {shortlistValid && shortlist.length > 0 && !hasDefault && (
              <p className="text-xs text-amber-600">Mark one account as the default.</p>
            )}
            <div className="flex items-center gap-2">
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
            <div><XeroLink href={XERO_CHART_OF_ACCOUNTS} label="Manage your chart of accounts in Xero" /></div>
          </Step>

          <Step
            n={6}
            title="Card surcharge income"
            visible={!!bank && !!clearing && !clearingIsBank && !!feeAccount && !!tax && hasDefault}
            hint="Optional. If you pass the card fee on to clients, that surcharge is income you received — pick the account it should be recorded as. Leave it blank to use your default income account."
          >
            <AccountSelect
              value={surchargeAccount}
              onChange={setSurchargeAccount}
              options={data.options.revenueAccounts}
              placeholder="Use my default income account"
            />
          </Step>

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
