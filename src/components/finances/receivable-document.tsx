'use client'

import { useCallback, useEffect, useState } from 'react'
import { X, Loader2, Check, Send, Printer, Pencil, Plus, Trash2 } from 'lucide-react'

// Shared receivable (invoice) helpers + the printable invoice-document modal.
// Used by BOTH the Finances → Invoices tab and the client profile's Invoices
// tab, so keep it presentation-only + endpoint-driven (no page-specific state).

const CURRENCY_SYMBOLS: Record<string, string> = { nzd: '$', aud: '$', cad: '$', usd: '$', gbp: '£', eur: '€', zar: 'R' }

export function money(minor: number, currency: string): string {
  const sym = CURRENCY_SYMBOLS[currency.toLowerCase()] ?? ''
  return `${sym}${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

// The list-row shape (a receivable summary), returned by
// /api/trainer/finances/receivables.
export interface Rcv {
  id: string; description: string | null; clientName: string | null
  amountCents: number; amountPaidCents: number; currency: string; status: string
  sentAt: string | null; paidAt: string | null; createdAt: string
  xeroInvoiceId: string | null; xeroSyncStatus: 'SYNCED' | 'ERROR' | null; xeroSyncError: string | null
}

export function receivableBadge(r: { status: string; sentAt: string | null }): { label: string; cls: string } {
  if (r.status === 'CANCELLED') return { label: 'Cancelled', cls: 'bg-rose-50 text-rose-600' }
  if (r.status === 'PAID') return { label: 'Paid', cls: 'bg-emerald-100 text-emerald-700' }
  if (r.status === 'PARTIAL') return { label: 'Partially paid', cls: 'bg-amber-100 text-amber-700' }
  if (!r.sentAt) return { label: 'Unsent', cls: 'bg-slate-100 text-slate-500' }
  return { label: 'Sent', cls: 'bg-sky-100 text-sky-700' }
}

// Deep link to an invoice inside the trainer's Xero org.
export const xeroInvoiceUrl = (xeroInvoiceId: string) => `https://go.xero.com/app/invoicing/view/${xeroInvoiceId}`

// Small round Xero logo that links out to the invoice in Xero (new tab).
// stopPropagation so clicking it inside a list row doesn't also open the modal.
export function XeroLink({ xeroInvoiceId, className = '' }: { xeroInvoiceId: string; className?: string }) {
  return (
    <a
      href={xeroInvoiceUrl(xeroInvoiceId)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      title="View in Xero"
      aria-label="View in Xero"
      className={`inline-flex shrink-0 ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logos/xero-icon.webp" alt="View in Xero" className="h-6 w-6 rounded-full" />
    </a>
  )
}

export interface RcvLine { id: string; description: string; quantity: number; unitAmountCents: number; amountCents: number }

export interface RcvDetail {
  id: string; reference: string; description: string | null
  amountCents: number; amountPaidCents: number; currency: string; status: string
  createdAt: string; sentAt: string | null; paidAt: string | null
  xeroInvoiceId: string | null; xeroSyncStatus: 'SYNCED' | 'ERROR' | null; xeroSyncError: string | null
  lines: RcvLine[]
  client: { name: string | null; email: string | null; address: string | null; phone: string | null }
  business: { name: string | null; logoUrl: string | null; email: string | null; address: string | null }
}

// A draft line during edit (string-typed inputs → parsed on save).
interface DraftLine { description: string; quantity: string; unitDollars: string }

// Parsed cents for a draft line, or null when the inputs aren't valid yet.
function draftLineCents(l: DraftLine): number | null {
  const qty = parseInt(l.quantity, 10)
  const unit = parseFloat(l.unitDollars)
  if (!Number.isInteger(qty) || qty < 1) return null
  if (!Number.isFinite(unit) || unit < 0) return null
  return Math.round(unit * 100) * qty
}

// Full printable invoice document, shown as a centered modal dialog (backdrop +
// card, Esc/backdrop to close, body scroll-locked). Fetches the richer detail on
// open; the chrome is `print:hidden` so window.print() yields just the invoice.
// UNPAID invoices are editable in place — a full multi-line editor (add/remove
// lines, edit description/qty/unit; Subtotal/Total = sum).
export function ReceivableDocument({ summary, onClose, onSent }: { summary: Rcv; onClose: () => void; onSent: () => void }) {
  const [data, setData] = useState<RcvDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draftLines, setDraftLines] = useState<DraftLine[]>([])

  const load = useCallback(async () => {
    const d = await fetch(`/api/trainer/finances/receivables/${summary.id}`).then(r => (r.ok ? r.json() : null)).catch(() => null)
    return d as RcvDetail | null
  }, [summary.id])

  useEffect(() => {
    let alive = true
    setLoading(true)
    load().then(d => { if (alive) { setData(d); setLoading(false) } })
    return () => { alive = false }
  }, [load])

  // Lock body scroll + close on Escape while the dialog is open.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editing) onClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prevOverflow; window.removeEventListener('keydown', onKey) }
  }, [onClose, editing])

  // Prefer the fetched detail; fall back to the list summary while loading.
  const view = data ?? summary
  const badge = receivableBadge(view)
  const unpaidUnsent = view.status === 'UNPAID' && !view.sentAt
  // A paid or cancelled invoice is locked — only UNPAID is editable.
  const editable = view.status === 'UNPAID'

  // Live draft totals + validity.
  const draftCents = draftLines.map(draftLineCents)
  const draftValid = draftLines.length > 0 && draftCents.every(c => c !== null) && draftLines.every(l => l.description.trim().length > 0)
  const previewTotal = draftCents.reduce<number>((sum, c) => sum + (c ?? 0), 0)

  function startEdit() {
    if (!data) return
    const seed: DraftLine[] = data.lines.length
      ? data.lines.map(l => ({ description: l.description, quantity: String(l.quantity), unitDollars: (l.unitAmountCents / 100).toFixed(2) }))
      : [{ description: data.description ?? '', quantity: '1', unitDollars: (data.amountCents / 100).toFixed(2) }]
    setDraftLines(seed)
    setMsg(null)
    setEditing(true)
  }
  function updateLine(i: number, patch: Partial<DraftLine>) {
    setDraftLines(ls => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }
  function addLine() {
    setDraftLines(ls => [...ls, { description: '', quantity: '1', unitDollars: '0.00' }])
  }
  function removeLine(i: number) {
    setDraftLines(ls => (ls.length <= 1 ? ls : ls.filter((_, idx) => idx !== i)))
  }

  async function send() {
    setSending(true); setMsg(null)
    try {
      const res = await fetch(`/api/trainer/finances/receivables/${summary.id}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (res.ok) {
        setMsg('Sent to the client.')
        onSent()
        const d = await load()
        if (d) setData(d)
      } else {
        setMsg('Could not send — try again.')
      }
    } catch {
      setMsg('Could not send — try again.')
    } finally {
      setSending(false)
    }
  }

  async function save() {
    if (!draftValid) { setMsg('Check each line has a description, a quantity ≥ 1, and a valid amount.'); return }
    setSaving(true); setMsg(null)
    try {
      const res = await fetch(`/api/trainer/finances/receivables/${summary.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines: draftLines.map(l => ({
            description: l.description.trim(),
            quantity: parseInt(l.quantity, 10),
            unitAmountCents: Math.round(parseFloat(l.unitDollars) * 100),
          })),
        }),
      })
      if (res.ok) {
        onSent() // refresh the underlying list (amount/desc changed)
        const d = await load()
        if (d) setData(d)
        setEditing(false)
      } else {
        const b = await res.json().catch(() => ({}))
        setMsg(typeof b.error === 'string' ? b.error : 'Could not save — try again.')
      }
    } catch {
      setMsg('Could not save — try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 print:p-0 print:static print:block">
      {/* Backdrop — click to close (disabled mid-edit to avoid losing changes). */}
      <div className="absolute inset-0 bg-slate-900/40 print:hidden" onClick={() => { if (!editing) onClose() }} />

      <div role="dialog" aria-modal="true" aria-label="Invoice" className="relative w-full max-w-2xl max-h-[90vh] flex flex-col bg-white rounded-2xl shadow-xl overflow-hidden print:max-h-none print:max-w-none print:rounded-none print:shadow-none print:overflow-visible">
        {/* Action bar — hidden when printing. */}
        <div className="print:hidden flex items-center gap-2 px-3 sm:px-5 min-h-[3.5rem] border-b border-slate-100 flex-shrink-0">
          <button type="button" onClick={onClose} aria-label="Close" className="p-2 -ml-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><X className="h-5 w-5" /></button>
          <p className="flex-1 min-w-0 truncate text-sm font-semibold text-slate-900">{editing ? 'Edit invoice' : 'Invoice'}</p>
          {editing ? (
            <>
              <button type="button" onClick={() => { setEditing(false); setMsg(null) }} disabled={saving} className="inline-flex items-center rounded-lg border border-slate-200 px-3 h-9 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">Cancel</button>
              <button type="button" onClick={save} disabled={saving || !draftValid} className="inline-flex items-center gap-1.5 rounded-lg bg-accent hover:bg-accent-strong text-white px-3 h-9 text-sm font-semibold disabled:opacity-60">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : (
            <>
              {editable && data && (
                <button type="button" onClick={startEdit} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 h-9 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  <Pencil className="h-4 w-4" /> Edit
                </button>
              )}
              <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 h-9 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <Printer className="h-4 w-4" /> Print
              </button>
              {unpaidUnsent && (
                <button type="button" onClick={send} disabled={sending} className="inline-flex items-center gap-1.5 rounded-lg bg-accent hover:bg-accent-strong text-white px-3 h-9 text-sm font-semibold disabled:opacity-60">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {sending ? 'Sending…' : 'Send'}
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex-1 overflow-y-auto print:overflow-visible">
          {loading && !data ? (
            <div className="flex items-center gap-2 text-sm text-slate-400 px-6 py-10"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : !data ? (
            <p className="text-sm text-slate-400 px-6 py-10">Could not load this invoice.</p>
          ) : (
            <div className="mx-auto w-full max-w-2xl px-6 sm:px-10 py-8 print:py-2">
              {/* Header: business identity + invoice meta. */}
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {data.business.logoUrl && <img src={data.business.logoUrl} alt="" className="h-10 w-auto mb-3 object-contain" />}
                  <p className="text-lg font-bold text-slate-900">{data.business.name ?? 'Your business'}</p>
                  {data.business.address && <p className="mt-1 text-xs text-slate-500 whitespace-pre-line">{data.business.address}</p>}
                  {data.business.email && <p className="text-xs text-slate-500">{data.business.email}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Invoice</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 tabular-nums">{data.reference}</p>
                  <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                </div>
              </div>

              {/* Bill-to + dates. */}
              <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Bill to</p>
                  <p className="mt-1.5 text-sm font-medium text-slate-800">{data.client.name ?? '—'}</p>
                  {data.client.email && <p className="text-xs text-slate-500">{data.client.email}</p>}
                  {data.client.phone && <p className="text-xs text-slate-500">{data.client.phone}</p>}
                  {data.client.address && <p className="text-xs text-slate-500 whitespace-pre-line">{data.client.address}</p>}
                </div>
                <div className="sm:text-right">
                  <div className="flex sm:justify-end gap-2 text-xs"><span className="text-slate-400">Issued</span><span className="text-slate-700 tabular-nums">{fmtDate(data.createdAt)}</span></div>
                  {data.sentAt && <div className="flex sm:justify-end gap-2 text-xs mt-1"><span className="text-slate-400">Sent</span><span className="text-slate-700 tabular-nums">{fmtDate(data.sentAt)}</span></div>}
                  {data.paidAt && <div className="flex sm:justify-end gap-2 text-xs mt-1"><span className="text-slate-400">Paid</span><span className="text-slate-700 tabular-nums">{fmtDate(data.paidAt)}</span></div>}
                </div>
              </div>

              {/* Line items — invoices can carry multiple lines. */}
              <table className="mt-8 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-slate-400 border-b border-slate-200">
                    <th className="py-2 font-medium">Description</th>
                    <th className="py-2 font-medium text-right w-16">Qty</th>
                    <th className="py-2 font-medium text-right w-28">Unit</th>
                    <th className="py-2 font-medium text-right w-28">Amount</th>
                    {editing && <th className="py-2 w-8 print:hidden" />}
                  </tr>
                </thead>
                <tbody>
                  {editing ? (
                    draftLines.map((l, i) => {
                      const cents = draftCents[i]
                      return (
                        <tr key={i} className="border-b border-slate-100 align-top">
                          <td className="py-2 pr-3">
                            <input
                              type="text"
                              value={l.description}
                              onChange={e => updateLine(i, { description: e.target.value })}
                              maxLength={200}
                              placeholder="Description"
                              className="w-full h-9 px-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                            />
                          </td>
                          <td className="py-2 pl-2">
                            <input
                              type="number" inputMode="numeric" min={1} step="1"
                              value={l.quantity}
                              onChange={e => updateLine(i, { quantity: e.target.value })}
                              className="w-14 h-9 px-2 rounded-lg border border-slate-200 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
                            />
                          </td>
                          <td className="py-2 pl-2">
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-[10px] text-slate-400">{(data.currency || '').toUpperCase()}</span>
                              <input
                                type="number" inputMode="decimal" min={0} step="0.01"
                                value={l.unitDollars}
                                onChange={e => updateLine(i, { unitDollars: e.target.value })}
                                className="w-24 h-9 px-2 rounded-lg border border-slate-200 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
                              />
                            </div>
                          </td>
                          <td className="py-2 text-right tabular-nums text-slate-900 whitespace-nowrap">{cents === null ? '—' : money(cents, data.currency)}</td>
                          <td className="py-2 pl-1 text-right print:hidden">
                            <button type="button" onClick={() => removeLine(i)} disabled={draftLines.length <= 1} aria-label="Remove line" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  ) : (
                    data.lines.map(l => (
                      <tr key={l.id} className="border-b border-slate-100">
                        <td className="py-3 text-slate-700">{l.description}</td>
                        <td className="py-3 text-right tabular-nums text-slate-500">{l.quantity}</td>
                        <td className="py-3 text-right tabular-nums text-slate-500 whitespace-nowrap">{money(l.unitAmountCents, data.currency)}</td>
                        <td className="py-3 text-right tabular-nums text-slate-900 whitespace-nowrap">{money(l.amountCents, data.currency)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              {editing && (
                <button type="button" onClick={addLine} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 h-9 text-sm font-medium text-slate-600 hover:bg-slate-50 print:hidden">
                  <Plus className="h-4 w-4" /> Add line
                </button>
              )}

              {/* Totals — follow the (draft) lines. Paid/balance shown once
                  something's been settled (and never mid-edit). */}
              {(() => {
                const totalCents = editing ? previewTotal : data.amountCents
                const showPaid = !editing && data.amountPaidCents > 0
                const balance = Math.max(0, data.amountCents - data.amountPaidCents)
                return (
                  <div className="mt-4 flex flex-col items-end gap-1.5">
                    <div className="flex justify-between gap-12 text-sm w-full max-w-[220px]"><span className="text-slate-500">Subtotal</span><span className="tabular-nums text-slate-700">{money(totalCents, data.currency)}</span></div>
                    <div className="flex justify-between gap-12 text-base font-semibold w-full max-w-[220px] border-t border-slate-200 pt-1.5"><span className="text-slate-900">Total</span><span className="tabular-nums text-slate-900">{money(totalCents, data.currency)}</span></div>
                    {showPaid && (
                      <>
                        <div className="flex justify-between gap-12 text-sm w-full max-w-[220px]"><span className="text-slate-500">Amount paid</span><span className="tabular-nums text-emerald-600">− {money(data.amountPaidCents, data.currency)}</span></div>
                        <div className="flex justify-between gap-12 text-sm font-semibold w-full max-w-[220px] border-t border-slate-200 pt-1.5"><span className="text-slate-900">Balance due</span><span className="tabular-nums text-slate-900">{money(balance, data.currency)}</span></div>
                      </>
                    )}
                  </div>
                )
              })()}

              {/* Xero — deep link to the invoice in Xero when synced. */}
              {data.xeroInvoiceId && (
                <a href={xeroInvoiceUrl(data.xeroInvoiceId)} target="_blank" rel="noopener noreferrer" className="mt-8 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 hover:underline print:hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logos/xero-icon.webp" alt="View in Xero" className="h-[18px] w-[18px] rounded-full" /> View in Xero
                </a>
              )}
              {!data.xeroInvoiceId && data.xeroSyncError && (
                <p className="mt-8 text-xs text-slate-400 print:hidden">Xero sync pending — {data.xeroSyncError}</p>
              )}

              {msg && <p className="mt-4 text-sm text-slate-600 print:hidden">{msg}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
