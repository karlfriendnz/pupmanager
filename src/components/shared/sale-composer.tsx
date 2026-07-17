'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Check, Loader2, Minus, Plus, Search, ShoppingBag, Trash2, UserPlus, UserRound, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ModalPortal } from '@/components/shared/modal-portal'
import { currencySymbol, formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'

// The "instant sale" (POS) composer — ring up a sale standing in front of a
// client. Three steps, one screen each: pick who it's for, add what they're
// buying, then either show a QR they scan to pay on their own phone or record
// it to settle later.
//
// Shaped for a phone held one-handed mid-groom: big tap targets, a pinned
// action bar, and no typing required for catalogue items.
//
// Payment needs nothing new — the sale raises an ordinary Invoice, and every
// invoice already carries a payToken, so /pay/<token> is a working pay page we
// render as a QR. The client's own phone does the Stripe part.

type ClientRow = { id: string; name: string | null; dogName: string | null; dogPhotoUrl: string | null }
type ProductRow = { id: string; name: string; priceCents: number | null; imageUrl: string | null; active: boolean; xeroAccountCode?: string | null }
type Line = { key: string; description: string; quantity: number; unitAmountCents: number; xeroAccountCode?: string | null }
type Created = { id: string; payToken: string | null; amountCents: number }

type Step = 'client' | 'items' | 'done'

// A sale is either FOR a client (→ an invoice, payable now or later) or for a
// GUEST — a walk-up who isn't a client and doesn't need to become one. A guest
// sale has no invoice (Invoice.clientId is required) and no "pay later" (nobody
// to chase), so it goes straight to Stripe Checkout and is card-only.
const GUEST = { id: '__guest__', name: 'Guest', dogName: null, dogPhotoUrl: null } as const
type Target = ClientRow | typeof GUEST
const isGuest = (t: Target | null): boolean => t?.id === GUEST.id

export function SaleComposer({
  open,
  onClose,
  currency = 'nzd',
}: {
  open: boolean
  onClose: () => void
  currency?: string
}) {
  const [step, setStep] = useState<Step>('client')
  const [client, setClient] = useState<Target | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [created, setCreated] = useState<Created | null>(null)
  const [guestUrl, setGuestUrl] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // One key per composer session. Regenerated only on a fresh open, so a
  // double-tap (or a retry on a flaky connection) resolves to the same sale
  // instead of ringing it up twice.
  const idempotencyKey = useRef<string>('')

  const reset = useCallback(() => {
    setStep('client')
    setClient(null)
    setLines([])
    setCreated(null)
    setGuestUrl(null)
    setShowQr(false)
    setSaving(false)
    setError(null)
  }, [])

  useEffect(() => {
    if (open) {
      reset()
      idempotencyKey.current = `sale_${crypto.randomUUID().replace(/-/g, '')}`
    }
  }, [open, reset])

  // Escape closes — except mid-save, where bailing out would leave the trainer
  // unsure whether the sale landed.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !saving) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, saving, onClose])

  const total = useMemo(
    () => lines.reduce((sum, l) => sum + l.quantity * l.unitAmountCents, 0),
    [lines],
  )

  // A guest sale can't be an invoice, so it takes the Stripe Checkout path and
  // we QR that URL instead of a /pay/<token> one. Card-only — the caller never
  // offers "Record" for a guest.
  async function submitGuest() {
    if (lines.length === 0 || saving) return
    setSaving(true)
    setError(null)

    // Already minted — don't create a second Checkout Session.
    if (guestUrl) { setShowQr(true); setStep('done'); setSaving(false); return }

    try {
      const res = await fetch('/api/trainer/finances/sales/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines: lines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitAmountCents: l.unitAmountCents,
          })),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(
          body?.error === 'PAYMENTS_REQUIRED'
            ? 'A guest sale needs card payments switched on — connect Stripe in Settings → Payments, or sell to a client instead.'
            : body?.error === 'ADDON_REQUIRED'
              ? 'Instant sale is switched off. Turn it on in Settings → Add-ons.'
              : 'That didn’t go through. Nothing was charged — try again.',
        )
        setSaving(false)
        return
      }
      const body = await res.json()
      setGuestUrl(body.url)
      setCreated({ id: 'guest', payToken: null, amountCents: body.amountCents })
      setShowQr(true)
      setStep('done')
    } catch {
      setError('That didn’t go through. Nothing was charged — try again.')
    } finally {
      setSaving(false)
    }
  }

  async function submit(thenShowQr: boolean) {
    if (!client || lines.length === 0 || saving) return
    if (isGuest(client)) { await submitGuest(); return }
    setSaving(true)
    setError(null)

    // Already rung up (e.g. "Record" then "Take payment") — reuse it rather
    // than posting again.
    if (created) {
      setShowQr(thenShowQr)
      setStep('done')
      setSaving(false)
      return
    }

    try {
      const res = await fetch('/api/trainer/finances/receivables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: client.id,
          idempotencyKey: idempotencyKey.current,
          lines: lines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitAmountCents: l.unitAmountCents,
            xeroAccountCode: l.xeroAccountCode ?? null,
          })),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body?.error === 'ADDON_REQUIRED'
          ? 'Instant sale is switched off. Turn it on in Settings → Add-ons.'
          : 'That didn’t go through. Nothing was charged — try again.')
        setSaving(false)
        return
      }
      setCreated(await res.json())
      setShowQr(thenShowQr)
      setStep('done')
    } catch {
      setError('That didn’t go through. Nothing was charged — try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center">
        {/* Full-height sheet on a phone, a centred card on desktop. */}
        <div className="flex h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-xl sm:h-[min(46rem,88vh)] sm:max-w-lg sm:rounded-3xl">
          <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900">
                {step === 'done' ? (showQr ? 'Take payment' : 'Sale recorded') : 'New sale'}
              </h2>
              {client && step !== 'done' && (
                <p className="truncate text-xs text-slate-400">
                  {isGuest(client)
                    ? 'Guest sale · card only'
                    : `For ${client.name ?? 'this client'}${client.dogName ? ` · ${client.dogName}` : ''}`}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              disabled={saving}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          {step === 'client' && (
            <ClientStep
              onPick={(c) => { setClient(c); setStep('items') }}
              onGuest={() => { setClient(GUEST); setStep('items') }}
            />
          )}

          {step === 'items' && (
            <ItemsStep
              lines={lines}
              setLines={setLines}
              currency={currency}
              total={total}
              saving={saving}
              error={error}
              guest={isGuest(client)}
              onBack={() => setStep('client')}
              onRecord={() => submit(false)}
              onCharge={() => submit(true)}
            />
          )}

          {step === 'done' && created && (
            <DoneStep
              created={created}
              currency={currency}
              showQr={showQr}
              guestUrl={guestUrl}
              clientName={isGuest(client) ? null : client?.name ?? null}
              onShowQr={() => setShowQr(true)}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </ModalPortal>
  )
}

// Step 1 — who's it for. Search-as-you-type over the trainer's clients; the
// server narrows restricted staff to their own assigned clients. Two escape
// hatches sit above the list, because the person in front of you often isn't in
// it: add them as a client on the spot, or sell to them as a guest.
function ClientStep({ onPick, onGuest }: { onPick: (c: ClientRow) => void; onGuest: () => void }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<ClientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients?q=${encodeURIComponent(q)}`)
        const body = await res.json().catch(() => ({ items: [] }))
        if (!cancelled) setRows(body.items ?? [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, q ? 200 : 0) // debounce typing; load immediately on open
    return () => { cancelled = true; clearTimeout(t) }
  }, [q])

  return (
    <>
      <div className="border-b border-slate-100 px-5 py-3">
        <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search clients or dogs"
            className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {/* The two ways out of "they're not on this list". */}
        {addOpen ? (
          <NewClientForm
            initialName={q}
            onCancel={() => setAddOpen(false)}
            onCreated={onPick}
          />
        ) : (
          <div className="mb-2 flex flex-col gap-1">
            <button
              onClick={() => setAddOpen(true)}
              className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--pm-brand-50,#f0fdfa)] text-[var(--pm-brand-600)]">
                <UserPlus className="h-[18px] w-[18px]" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-slate-900">New client</p>
                <p className="text-xs text-slate-400">Add them as you sell</p>
              </div>
            </button>
            <button
              onClick={onGuest}
              className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <UserRound className="h-[18px] w-[18px]" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-slate-900">Guest</p>
                <p className="text-xs text-slate-400">No details, card only</p>
              </div>
            </button>
            <div className="my-1 border-t border-slate-100" />
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-10 text-slate-300"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-slate-400">
            {q ? 'No clients match that.' : 'No clients yet.'}
          </p>
        ) : (
          rows.map((c) => (
            <button
              key={c.id}
              onClick={() => onPick(c)}
              className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
            >
              <Avatar url={c.dogPhotoUrl} name={c.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900">{c.name ?? 'Unnamed client'}</p>
                {c.dogName && <p className="truncate text-xs text-slate-400">{c.dogName}</p>}
              </div>
            </button>
          ))
        )}
      </div>
    </>
  )
}

// Add a client without leaving the sale. Intentionally the bare minimum — name
// only, with email/phone optional — because this is used with a real person
// waiting. Anything else can be filled in later on their profile. Reuses the
// same quick-add API as the Clients page (which mints a placeholder email when
// one isn't given), so there's one client-creation path, not two.
function NewClientForm({
  initialName,
  onCancel,
  onCreated,
}: {
  initialName: string
  onCancel: () => void
  onCreated: (c: ClientRow) => void
}) {
  // Whatever they typed in the search box was probably the person's name.
  const [name, setName] = useState(initialName)
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'quick',
          name: trimmed,
          email: email.trim(),
          phone: phone.trim(),
          sendInvite: false,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        // Quick-add validates against the trainer's own client-field config, so
        // it can legitimately reject this (e.g. "Dog's name is required" when
        // they've made it mandatory). Show what it actually said — a generic
        // "couldn't add them" would leave them with no idea what to fix.
        setError(
          res.status === 403
            ? 'You don’t have permission to add clients.'
            : typeof body?.error === 'string' && body.error
              ? body.error
              : 'Couldn’t add them. Try again, or sell to them as a guest.',
        )
        setBusy(false)
        return
      }
      const { clientId } = await res.json()
      if (!clientId) {
        setError('Couldn’t add them. Try again, or sell to them as a guest.')
        setBusy(false)
        return
      }
      onCreated({ id: clientId, name: trimmed, dogName: null, dogPhotoUrl: null })
    } catch {
      setError('Couldn’t add them. Try again, or sell to them as a guest.')
      setBusy(false)
    }
  }

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-2xl border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">New client</p>
        <button onClick={onCancel} className="text-xs text-slate-400 hover:text-slate-700">Cancel</button>
      </div>
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={120}
        placeholder="Name"
        className="h-10 rounded-xl bg-slate-50 px-3 text-sm outline-none placeholder:text-slate-400"
      />
      <div className="flex gap-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="Email (optional)"
          className="h-10 min-w-0 flex-1 rounded-xl bg-slate-50 px-3 text-sm outline-none placeholder:text-slate-400"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          type="tel"
          placeholder="Phone (optional)"
          className="h-10 min-w-0 flex-1 rounded-xl bg-slate-50 px-3 text-sm outline-none placeholder:text-slate-400"
        />
      </div>
      <Button size="sm" onClick={create} loading={busy} disabled={!name.trim() || busy}>
        Add and continue
      </Button>
    </div>
  )
}

function Avatar({ url, name }: { url: string | null; name: string | null }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary blob host, sized tiny
    return <img src={url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-400">
      {name?.[0]?.toUpperCase() ?? '?'}
    </div>
  )
}

// Step 2 — what they're buying. Catalogue items are one tap; anything else is a
// free-text line so a trainer is never blocked by a product they never set up.
function ItemsStep({
  lines, setLines, currency, total, saving, error, guest, onBack, onRecord, onCharge,
}: {
  lines: Line[]
  setLines: (fn: (prev: Line[]) => Line[]) => void
  currency: string
  total: number
  saving: boolean
  error: string | null
  /** Guest sale — card only, so no "Record" (there's nobody to invoice later). */
  guest: boolean
  onBack: () => void
  onRecord: () => void
  onCharge: () => void
}) {
  const [products, setProducts] = useState<ProductRow[]>([])
  const [loading, setLoading] = useState(true)
  const [customOpen, setCustomOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/products')
        const body = await res.json().catch(() => [])
        if (!cancelled) setProducts(Array.isArray(body) ? body : [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Only priced, active products can be tapped in — an unpriced one ("contact
  // trainer") has no amount to ring up.
  const sellable = useMemo(
    () => products.filter((p) => p.active && p.priceCents != null && p.priceCents > 0),
    [products],
  )

  function addProduct(p: ProductRow) {
    setLines((prev) => {
      const existing = prev.find((l) => l.key === `p_${p.id}`)
      if (existing) {
        return prev.map((l) => (l.key === existing.key ? { ...l, quantity: l.quantity + 1 } : l))
      }
      return [...prev, {
        key: `p_${p.id}`,
        description: p.name,
        quantity: 1,
        unitAmountCents: p.priceCents ?? 0,
        xeroAccountCode: p.xeroAccountCode ?? null,
      }]
    })
  }

  function setQuantity(key: string, next: number) {
    setLines((prev) =>
      next <= 0
        ? prev.filter((l) => l.key !== key)
        : prev.map((l) => (l.key === key ? { ...l, quantity: Math.min(1000, next) } : l)),
    )
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {/* The cart, first — it's what the trainer is checking against. */}
        {lines.length > 0 && (
          <div className="mb-5 flex flex-col gap-2">
            {lines.map((l) => (
              <div key={l.key} className="flex items-center gap-3 rounded-2xl border border-slate-200 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">{l.description}</p>
                  <p className="text-xs text-slate-400">{formatMoney(l.unitAmountCents, currency)} each</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Stepper label="Remove one" onClick={() => setQuantity(l.key, l.quantity - 1)}>
                    {l.quantity === 1 ? <Trash2 className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                  </Stepper>
                  <span className="w-6 text-center text-sm font-semibold tabular-nums">{l.quantity}</span>
                  <Stepper label="Add one" onClick={() => setQuantity(l.key, l.quantity + 1)}>
                    <Plus className="h-4 w-4" />
                  </Stepper>
                </div>
                <p className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-900">
                  {formatMoney(l.quantity * l.unitAmountCents, currency)}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Add items</h3>
          <button
            onClick={() => setCustomOpen((v) => !v)}
            className="text-xs font-semibold text-[var(--pm-brand-600)] hover:underline"
          >
            {customOpen ? 'Cancel' : 'Something else'}
          </button>
        </div>

        {customOpen && (
          <CustomLineForm
            currency={currency}
            onAdd={(line) => { setLines((prev) => [...prev, line]); setCustomOpen(false) }}
          />
        )}

        {loading ? (
          <div className="flex justify-center py-10 text-slate-300"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : sellable.length === 0 ? (
          <p className="rounded-2xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
            No priced products yet — use “Something else” to type a one-off item.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {sellable.map((p) => (
              <button
                key={p.id}
                onClick={() => addProduct(p)}
                className="flex items-center gap-2 rounded-2xl border border-slate-200 p-3 text-left transition-colors hover:border-[var(--pm-brand-600)] hover:bg-slate-50 active:bg-slate-100"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100">
                  {p.imageUrl
                    // eslint-disable-next-line @next/next/no-img-element -- arbitrary blob host, sized tiny
                    ? <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                    : <ShoppingBag className="h-4 w-4 text-slate-400" />}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{p.name}</p>
                  <p className="text-xs text-slate-400 tabular-nums">{formatMoney(p.priceCents ?? 0, currency)}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Pinned action bar — total always visible, thumb-reachable. */}
      <footer className="border-t border-slate-100 bg-white px-5 py-4">
        {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="mb-3 flex items-baseline justify-between">
          <button onClick={onBack} disabled={saving} className="text-sm text-slate-500 hover:text-slate-900 disabled:opacity-40">
            Back
          </button>
          <div className="text-right">
            <p className="text-xs text-slate-400">Total</p>
            <p className="text-2xl font-bold tabular-nums text-slate-900">{formatMoney(total, currency)}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {/* No "Record" for a guest — an unpaid sale with no one attached to it
              is just a number nobody can chase. */}
          {!guest && (
            <Button variant="secondary" className="flex-1" onClick={onRecord} disabled={saving || total <= 0}>
              Record
            </Button>
          )}
          <Button className="flex-1" onClick={onCharge} loading={saving} disabled={saving || total <= 0}>
            Take payment
          </Button>
        </div>
      </footer>
    </>
  )
}

function Stepper({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 active:bg-slate-200"
    >
      {children}
    </button>
  )
}

// A one-off line for anything not in the catalogue — the usual case for a
// groomer charging for a tidy-up that isn't a product.
function CustomLineForm({ currency, onAdd }: { currency: string; onAdd: (l: Line) => void }) {
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState('')

  // Dollars in the field, cents on the wire. Round rather than truncate so
  // 12.345 doesn't quietly become 12.34.
  const cents = Math.round(parseFloat(amount || '0') * 100)
  const valid = desc.trim().length > 0 && Number.isFinite(cents) && cents > 0

  function add() {
    if (!valid) return
    onAdd({ key: `c_${crypto.randomUUID()}`, description: desc.trim(), quantity: 1, unitAmountCents: cents })
    setDesc('')
    setAmount('')
  }

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-2xl border border-slate-200 p-3">
      <input
        autoFocus
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        maxLength={200}
        placeholder="What are they paying for?"
        className="h-10 rounded-xl bg-slate-50 px-3 text-sm outline-none placeholder:text-slate-400"
      />
      <div className="flex gap-2">
        <div className="flex flex-1 items-center gap-1 rounded-xl bg-slate-50 px-3">
          <span className="text-sm text-slate-400">{currencySymbol(currency)}</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            placeholder="0.00"
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
        </div>
        <Button size="sm" onClick={add} disabled={!valid}>Add</Button>
      </div>
    </div>
  )
}

// Step 3 — the sale exists either way; this is just how it gets paid. The QR
// points at the invoice's public pay page, which the client opens on their own
// phone and pays with their own card.
function DoneStep({
  created, currency, showQr, guestUrl, clientName, onShowQr, onClose,
}: {
  created: Created
  currency: string
  showQr: boolean
  /** Stripe Checkout URL for a guest sale — QR'd directly, no invoice behind it. */
  guestUrl: string | null
  clientName: string | null
  onShowQr: () => void
  onClose: () => void
}) {
  // A client sale points at its invoice's pay page; a guest sale points straight
  // at Stripe Checkout.
  const payUrl = guestUrl
    ?? (created.payToken
      ? `${typeof window !== 'undefined' ? window.location.origin : ''}/pay/${created.payToken}`
      : null)
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (!payUrl) return
    await navigator.clipboard.writeText(payUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <>
      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-6 text-center">
        {showQr && payUrl ? (
          <>
            <div className="rounded-3xl border border-slate-200 bg-white p-5">
              <QRCodeSVG value={payUrl} size={196} level="M" />
            </div>
            <p className="mt-5 text-lg font-semibold tabular-nums text-slate-900">
              {formatMoney(created.amountCents, currency)}
            </p>
            <p className="mt-1 max-w-xs text-sm text-slate-500">
              {/* No name for a guest — and calling them "your client" would be
                  wrong, since not being one is the whole point. */}
              {clientName
                ? `Point ${clientName}’s camera at this to pay on their phone.`
                : 'Point their camera at this to pay on their phone.'}
            </p>
            <button onClick={copy} className="mt-4 text-sm font-semibold text-[var(--pm-brand-600)] hover:underline">
              {copied ? 'Link copied' : 'Copy pay link instead'}
            </button>
          </>
        ) : (
          <>
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-700">
              <Check className="h-7 w-7" />
            </div>
            <p className="mt-4 text-lg font-semibold tabular-nums text-slate-900">
              {formatMoney(created.amountCents, currency)}
            </p>
            <p className="mt-1 max-w-xs text-sm text-slate-500">
              Saved as an unpaid invoice for {clientName ?? 'your client'}. It’s in Finances whenever they’re ready.
            </p>
            {payUrl && (
              <button onClick={onShowQr} className="mt-4 text-sm font-semibold text-[var(--pm-brand-600)] hover:underline">
                Take payment now instead
              </button>
            )}
          </>
        )}
      </div>

      <footer className="border-t border-slate-100 px-5 py-4">
        <Button className={cn('w-full')} onClick={onClose}>Done</Button>
      </footer>
    </>
  )
}
