'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  Check, ChevronLeft, ChevronRight, Loader2, Minus, Plus, QrCode, Receipt, Search,
  ShoppingBag, Trash2, UserPlus, UserRound, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ModalPortal } from '@/components/shared/modal-portal'
import { FlatBlock, FlatRow, FlatTileGrid, SectionLabel } from '@/components/shared/flat-list'
import { currencySymbol, formatMoney } from '@/lib/money'
import { effectivePriceCents, isOnSale } from '@/lib/product-price'
import {
  addProductToLines, cartTotalCents, filterProducts, lineTotalCents, parseAmountToCents,
  quantityInCart, removeLine, sellableProducts, setLineQuantity, shouldOfferProductSearch,
  type SaleLine, type SaleProduct,
} from '@/lib/sale-cart'

// The "instant sale" (POS) composer — ring up a sale standing in front of a
// client. THREE steps, one screen each, in the order the counter actually goes:
//
//   1. Who's it for   — search clients, add one on the spot, or sell to a guest
//   2. What are they buying — a picture grid of the catalogue, plus a search
//   3. How are they paying  — QR now, or record it and settle later
//
// Every step is steppable-back and nothing is lost doing it: the cart, both
// search boxes, the client list and the half-typed custom line all live HERE,
// in the composer, not inside the step that renders them. A step component
// unmounts when you leave it; the sale must not.
//
// Shaped for a phone held one-handed mid-groom: big tap targets, a pinned
// action bar, and no typing required for catalogue items.
//
// Payment needs nothing new — the sale raises an ordinary Invoice, and every
// invoice already carries a payToken, so /pay/<token> is a working pay page we
// render as a QR. The client's own phone does the Stripe part.

type ClientRow = { id: string; name: string | null; dogName: string | null; dogPhotoUrl: string | null }
type ProductRow = SaleProduct
type Line = SaleLine
type Created = { id: string; payToken: string | null; amountCents: number }

type Step = 'client' | 'items' | 'payment' | 'done'
type PayMode = 'record' | 'charge'

/** The half-typed one-off line. Parent-owned so stepping away doesn't bin it. */
type CustomDraft = { open: boolean; description: string; amount: string }
const EMPTY_DRAFT: CustomDraft = { open: false, description: '', amount: '' }

// A sale is either FOR a client (→ an invoice, payable now or later) or for a
// GUEST — a walk-up who isn't a client and doesn't need to become one. A guest
// sale has no invoice (Invoice.clientId is required) and no "pay later" (nobody
// to chase), so it goes straight to Stripe Checkout and is card-only.
const GUEST = { id: '__guest__', name: 'Guest', dogName: null, dogPhotoUrl: null } as const
type Target = ClientRow | typeof GUEST
const isGuest = (t: Target | null): boolean => t?.id === GUEST.id

/**
 * Opens the composer already knowing who it's for, and optionally what's on it.
 *
 * `settle` is the "take payment for something they already booked" case: a
 * pay-later package ALREADY raised an UNPAID invoice (createInvoiceForAssignment
 * runs even when payment isn't required — "not required" only skips the up-front
 * Stripe charge). So we must edit THAT invoice rather than raise a second one for
 * money already owed. With `settle` set the composer PATCHes the existing invoice
 * and QRs its existing payToken; without it, it POSTs a new MANUAL sale.
 *
 * Note the invoice is per PACKAGE, not per session — one invoice covers all N
 * sessions of an assignment — so settling from any one session settles the lot.
 */
export type SalePrefill = {
  client: ClientRow
  /** Lines to start with. For `settle`, these are the invoice's CURRENT lines. */
  lines?: { description: string; quantity: number; unitAmountCents: number; xeroAccountCode?: string | null }[]
  settle?: { invoiceId: string; payToken: string | null }
}

export function SaleComposer({
  open,
  onClose,
  currency = 'nzd',
  prefill,
}: {
  open: boolean
  onClose: () => void
  currency?: string
  prefill?: SalePrefill
}) {
  const [step, setStep] = useState<Step>('client')
  const [client, setClient] = useState<Target | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [created, setCreated] = useState<Created | null>(null)
  const [guestUrl, setGuestUrl] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)
  const [saving, setSaving] = useState(false)
  /** Which payment choice is in flight — so only that row spins. */
  const [pending, setPending] = useState<PayMode | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ─── Step 1's state, held here so going back re-shows the list you left ────
  const [clientQuery, setClientQuery] = useState('')
  const [clientRows, setClientRows] = useState<ClientRow[]>([])
  const [clientsLoading, setClientsLoading] = useState(true)
  const [addClientOpen, setAddClientOpen] = useState(false)

  // ─── Step 2's state, ditto: catalogue, its search, and the custom-line draft ─
  const [products, setProducts] = useState<ProductRow[]>([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [productQuery, setProductQuery] = useState('')
  const [customDraft, setCustomDraft] = useState<CustomDraft>(EMPTY_DRAFT)

  // One key per composer session. Regenerated only on a fresh open, so a
  // double-tap (or a retry on a flaky connection) resolves to the same sale
  // instead of ringing it up twice.
  const idempotencyKey = useRef<string>('')

  // Read through a ref so `prefill`'s identity can NEVER retrigger the reset
  // below. It's built inline by the calling server component, so it gets a new
  // identity whenever that page's data refreshes — including immediately after
  // we settle an invoice, when the refreshed prefill also carries the lines we
  // just wrote. Keying the reset on it snapped the composer back to the items
  // step (showing the merged lines) instead of the QR, even though the PATCH
  // had succeeded. Only opening should reset.
  const prefillRef = useRef(prefill)
  prefillRef.current = prefill

  useEffect(() => {
    if (!open) return
    const p = prefillRef.current
    // With a prefill we already know who it's for, so skip straight to the
    // items — making a trainer re-pick the client they just clicked "Pay" on
    // would be busywork.
    setStep(p ? 'items' : 'client')
    setClient(p?.client ?? null)
    setLines(
      (p?.lines ?? []).map((l, i) => ({
        // Prefilled lines get stable keys so the steppers work on them like any
        // other; `s_` marks them as seeded (vs `p_` product / `c_` custom).
        key: `s_${i}`,
        description: l.description,
        quantity: l.quantity,
        unitAmountCents: l.unitAmountCents,
        xeroAccountCode: l.xeroAccountCode ?? null,
      })),
    )
    setCreated(null)
    setGuestUrl(null)
    setShowQr(false)
    setSaving(false)
    setPending(null)
    setError(null)
    setClientQuery('')
    setClientRows([])
    setAddClientOpen(false)
    setProductQuery('')
    setCustomDraft(EMPTY_DRAFT)
    // One key per composer session, so a double-tap (or a retry on a flaky
    // connection) resolves to the same sale instead of ringing it up twice.
    idempotencyKey.current = `sale_${crypto.randomUUID().replace(/-/g, '')}`
    // Reset ONLY when the modal opens — see prefillRef above.
  }, [open])

  // The client list. Lives here rather than in the step so stepping back from
  // the cart doesn't blank the list and re-fetch it under the trainer's thumb.
  // Skipped entirely when prefilled — there's no client step to fill.
  useEffect(() => {
    if (!open || prefillRef.current) return
    let cancelled = false
    setClientsLoading(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients?q=${encodeURIComponent(clientQuery)}`)
        const body = await res.json().catch(() => ({ items: [] }))
        if (!cancelled) setClientRows(body.items ?? [])
      } finally {
        if (!cancelled) setClientsLoading(false)
      }
    }, clientQuery ? 200 : 0) // debounce typing; load immediately on open
    return () => { cancelled = true; clearTimeout(t) }
  }, [open, clientQuery])

  // The catalogue, fetched once per open. Searching filters what we already
  // have rather than round-tripping per keystroke — a trainer's product list is
  // tens of items, not thousands, and instant filtering beats a spinner.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setProductsLoading(true)
    ;(async () => {
      try {
        const res = await fetch('/api/products')
        const body = await res.json().catch(() => [])
        if (!cancelled) setProducts(Array.isArray(body) ? body : [])
      } finally {
        if (!cancelled) setProductsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open])

  // Escape closes — except mid-save, where bailing out would leave the trainer
  // unsure whether the sale landed.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !saving) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, saving, onClose])

  const total = useMemo(() => cartTotalCents(lines), [lines])

  // A prefilled composer has no client step behind it, so it's a two-step flow.
  const stepOrder: Step[] = useMemo(
    () => (prefill ? ['items', 'payment'] : ['client', 'items', 'payment']),
    [prefill],
  )
  const stepIndex = stepOrder.indexOf(step)
  const canGoBack = step === 'payment' || (step === 'items' && !prefill)

  function goBack() {
    if (saving) return
    if (step === 'payment') setStep('items')
    else if (step === 'items') setStep('client')
  }

  // Buzz the client's phone with a tap-through to this invoice's pay screen, so
  // they can pay from their own hand instead of scanning the QR. Best-effort and
  // deliberately un-awaited in the UI sense: the QR is already on screen and
  // works regardless, so a client with no app / push off changes nothing. Never
  // for a guest — there's no one to notify.
  function pingClientToPay(invoiceId: string) {
    void fetch(`/api/trainer/finances/receivables/${invoiceId}/request-payment`, { method: 'POST' })
      .catch(() => {})
  }

  // A guest sale can't be an invoice, so it takes the Stripe Checkout path and
  // we QR that URL instead of a /pay/<token> one. Card-only — the caller never
  // offers "Record" for a guest.
  async function submitGuest() {
    // Already minted — don't create a second Checkout Session.
    if (guestUrl) { setShowQr(true); setStep('done'); return }

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
      return
    }
    const body = await res.json()
    setGuestUrl(body.url)
    setCreated({ id: 'guest', payToken: null, amountCents: body.amountCents })
    setShowQr(true)
    setStep('done')
  }

  // Settling an invoice that already exists (a pay-later booking). PATCH
  // replaces the invoice's ENTIRE line set, so we always send the full merged
  // list — the seeded lines plus whatever was upsold. Sending only the new
  // lines would silently delete what they already owed.
  async function submitSettle(settle: NonNullable<SalePrefill['settle']>, thenShowQr: boolean) {
    if (created) { setShowQr(thenShowQr); setStep('done'); return }

    const res = await fetch(`/api/trainer/finances/receivables/${settle.invoiceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
      // 409 = it stopped being editable while they were adding items (someone
      // paid it, or part-paid it). Surface the endpoint's own wording — it
      // explains which of those happened.
      setError(typeof body?.error === 'string' && body.error
        ? body.error
        : 'That didn’t go through. Nothing was charged — try again.')
      return
    }
    setCreated({
      id: settle.invoiceId,
      payToken: settle.payToken,
      amountCents: cartTotalCents(lines),
    })
    // Only when actually asking for the money — "Save" is just filing the
    // upsell, and pinging them then would be a nag out of nowhere.
    if (thenShowQr) pingClientToPay(settle.invoiceId)
    setShowQr(thenShowQr)
    setStep('done')
  }

  async function submitNewSale(clientId: string, thenShowQr: boolean) {
    // Already rung up (e.g. "Record" then "Take payment") — reuse it rather
    // than posting again.
    if (created) { setShowQr(thenShowQr); setStep('done'); return }

    const res = await fetch('/api/trainer/finances/receivables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
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
      return
    }
    const made: Created = await res.json()
    setCreated(made)
    // Same rule as settling: only ping when we're asking to be paid now.
    if (thenShowQr) pingClientToPay(made.id)
    setShowQr(thenShowQr)
    setStep('done')
  }

  /**
   * Take the money (or file it). Gated on an EXPLICIT intent: `mode` says which
   * of the two choices was tapped, and nothing but the payment step can call it
   * at all. A composer that can ring up a sale from any step is how a wizard
   * ends up charging someone the moment they tap "Next" — see commit 8ec9c36.
   */
  async function submit(mode: PayMode) {
    if (step !== 'payment') return
    if (!client || lines.length === 0 || saving) return
    const thenShowQr = mode === 'charge'
    setSaving(true)
    setPending(mode)
    setError(null)
    try {
      if (isGuest(client)) await submitGuest()
      else if (prefill?.settle) await submitSettle(prefill.settle, thenShowQr)
      else await submitNewSale(client.id, thenShowQr)
    } catch {
      setError('That didn’t go through. Nothing was charged — try again.')
    } finally {
      setSaving(false)
      setPending(null)
    }
  }

  if (!open) return null

  const title = step === 'done'
    ? showQr ? 'Take payment' : prefill?.settle ? 'Invoice updated' : 'Sale recorded'
    : step === 'client' ? 'Who’s it for?'
      : step === 'items' ? 'What are they buying?'
        : 'How are they paying?'

  const who = client
    ? isGuest(client)
      ? 'Guest · card only'
      : client.name ?? 'This client'
    : null

  // "Step 2 of 3 · Sarah Client" — one line that says where you are and who
  // you're here for. The name is left off step one, where picking them IS the
  // step (it lingers in state after stepping back, and echoing it there would
  // read as already-decided).
  const subtitle = stepIndex < 0
    ? null
    : [`Step ${stepIndex + 1} of ${stepOrder.length}`, step === 'client' ? null : who]
      .filter(Boolean).join(' · ')

  return (
    <ModalPortal>
      {/* A whole screen on a phone — taking a payment is the task, not an
          interruption to one, and the 8vh of scrim above the old sheet only
          made the keyboard-plus-form squeeze worse. Still a centred card with
          a scrim from sm: up. */}
      <div className="pm-overlay fixed inset-0 z-[60] flex justify-center bg-white sm:items-center sm:bg-slate-900/40 sm:backdrop-blur-sm">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="New sale"
          className="flex h-full w-full flex-col overflow-hidden bg-white sm:h-[min(46rem,88vh)] sm:max-w-lg sm:rounded-3xl sm:shadow-xl"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <header className="flex items-center gap-1 border-b border-slate-100 px-2 py-2">
            {/* Back is the left-hand control on any step you can leave. Step one
                has nowhere to go back to, so it keeps only the way out. */}
            {canGoBack ? (
              <button
                type="button"
                onClick={goBack}
                disabled={saving}
                aria-label="Back"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-500 active:bg-slate-100 disabled:opacity-40"
              >
                <ChevronLeft className="h-5 w-5" strokeWidth={1.75} />
              </button>
            ) : (
              <span className="h-11 w-2 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-semibold text-slate-900">{title}</h2>
              {subtitle && <p className="truncate text-xs text-slate-400">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 active:bg-slate-100 disabled:opacity-40"
              aria-label="Close"
            >
              <X className="h-5 w-5" strokeWidth={1.75} />
            </button>
          </header>

          {stepIndex >= 0 && <StepRail count={stepOrder.length} index={stepIndex} />}

          {step === 'client' && (
            <ClientStep
              query={clientQuery}
              onQuery={setClientQuery}
              rows={clientRows}
              loading={clientsLoading}
              addOpen={addClientOpen}
              onAddOpen={setAddClientOpen}
              onPick={(c) => { setClient(c); setStep('items') }}
              onGuest={() => { setClient(GUEST); setStep('items') }}
            />
          )}

          {step === 'items' && (
            <ItemsStep
              lines={lines}
              products={products}
              loading={productsLoading}
              query={productQuery}
              onQuery={setProductQuery}
              draft={customDraft}
              onDraft={setCustomDraft}
              currency={currency}
              total={total}
              onAddProduct={(p) => setLines((prev) => addProductToLines(prev, p))}
              onQuantity={(key, next) => setLines((prev) => setLineQuantity(prev, key, next))}
              onRemove={(key) => setLines((prev) => removeLine(prev, key))}
              onAddCustom={(line) => setLines((prev) => [...prev, line])}
              onNext={() => setStep('payment')}
            />
          )}

          {step === 'payment' && (
            <PaymentStep
              who={who}
              lines={lines}
              total={total}
              currency={currency}
              guest={isGuest(client)}
              // Settling an existing invoice — "Record" would be a no-op, it's
              // already recorded. Saving the upsell IS the record.
              recordLabel={prefill?.settle ? 'Save to the invoice' : 'Record as unpaid'}
              recordHint={prefill?.settle
                ? 'File the extras and settle later'
                : 'Save it to Finances and settle later'}
              saving={saving}
              pending={pending}
              error={error}
              onRecord={() => submit('record')}
              onCharge={() => submit('charge')}
            />
          )}

          {step === 'done' && created && (
            <DoneStep
              created={created}
              currency={currency}
              showQr={showQr}
              guestUrl={guestUrl}
              clientName={isGuest(client) ? null : client?.name ?? null}
              // "Take payment now instead" after recording it IS asking to be
              // paid, so it pings too — otherwise the QR screen's "we've also
              // sent a payment request" line would be a lie on this path.
              onShowQr={() => {
                setShowQr(true)
                if (created && !isGuest(client) && created.id !== 'guest') pingClientToPay(created.id)
              }}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </ModalPortal>
  )
}

/**
 * Where you are, in three hairlines. Deliberately not a numbered stepper with
 * circles and connectors — that's chrome for a form you fill once, not a till
 * you use forty times a day.
 */
function StepRail({ count, index }: { count: number; index: number }) {
  return (
    <div className="flex gap-1 px-4 pb-3 pt-2" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={i <= index ? 'h-0.5 flex-1 rounded-full bg-slate-900' : 'h-0.5 flex-1 rounded-full bg-slate-200'}
        />
      ))}
    </div>
  )
}

/** The flat search field both steps use — one bordered row, one line icon. */
function SearchField({
  value, onChange, placeholder, autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  autoFocus?: boolean
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3">
      <Search className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.75} />
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="grid h-11 w-11 shrink-0 place-items-center text-slate-400"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      )}
    </div>
  )
}

// Step 1 — who's it for. Search-as-you-type over the trainer's clients; the
// server narrows restricted staff to their own assigned clients. Two escape
// hatches sit above the list, because the person in front of you often isn't in
// it: add them as a client on the spot, or sell to them as a guest.
//
// Presentational: every piece of its state belongs to the composer, so coming
// back from the cart lands you exactly where you left.
function ClientStep({
  query, onQuery, rows, loading, addOpen, onAddOpen, onPick, onGuest,
}: {
  query: string
  onQuery: (v: string) => void
  rows: ClientRow[]
  loading: boolean
  addOpen: boolean
  onAddOpen: (v: boolean) => void
  onPick: (c: ClientRow) => void
  onGuest: () => void
}) {
  return (
    <>
      <div className="px-4 pb-3">
        <SearchField autoFocus value={query} onChange={onQuery} placeholder="Search clients or dogs" />
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-6">
        {/* The two ways out of "they're not on this list". */}
        {addOpen ? (
          <NewClientForm
            initialName={query}
            onCancel={() => onAddOpen(false)}
            onCreated={onPick}
          />
        ) : (
          <FlatBlock className="mb-4">
            <FlatRow
              icon={UserPlus}
              label="New client"
              sub="Add them as you sell"
              onClick={() => onAddOpen(true)}
            />
            <FlatRow
              icon={UserRound}
              label="Guest"
              sub="No details, card only"
              onClick={onGuest}
            />
          </FlatBlock>
        )}

        {loading ? (
          <div className="flex justify-center py-10 text-slate-300"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-slate-400">
            {query ? 'No clients match that.' : 'No clients yet.'}
          </p>
        ) : (
          <>
            <SectionLabel>Clients</SectionLabel>
            <FlatBlock>
              {/* Hand-rolled rather than FlatRow because the dog's photo is the
                  fastest way a trainer spots the right person, and FlatRow's
                  leading slot only takes a line icon. */}
              {rows.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onPick(c)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-50"
                >
                  <Avatar url={c.dogPhotoUrl} name={c.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">
                      {c.name ?? 'Unnamed client'}
                    </span>
                    {c.dogName && <span className="mt-0.5 block truncate text-[13px] text-slate-500">{c.dogName}</span>}
                  </span>
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" strokeWidth={1.75} />
                </button>
              ))}
            </FlatBlock>
          </>
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
    <div className="mb-4 flex flex-col gap-2 rounded-xl border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">New client</p>
        <button type="button" onClick={onCancel} className="text-xs text-slate-500 hover:text-slate-900">Cancel</button>
      </div>
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={120}
        placeholder="Name"
        aria-label="Name"
        className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none placeholder:text-slate-400"
      />
      <div className="flex gap-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="Email (optional)"
          aria-label="Email (optional)"
          className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none placeholder:text-slate-400"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          type="tel"
          placeholder="Phone (optional)"
          aria-label="Phone (optional)"
          className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none placeholder:text-slate-400"
        />
      </div>
      <Button type="button" size="sm" onClick={create} loading={busy} disabled={!name.trim() || busy}>
        Add and continue
      </Button>
    </div>
  )
}

function Avatar({ url, name }: { url: string | null; name: string | null }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary blob host, sized tiny
    return <img src={url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
  }
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-sm font-semibold text-slate-400">
      {name?.[0]?.toUpperCase() ?? '?'}
    </span>
  )
}

// Step 2 — what they're buying. The catalogue is a picture grid: a trainer
// recognises the tub of treats long before they read its name, so the image is
// the tile and the words sit under it. Anything not in the catalogue is a
// free-text line, so nobody is blocked by a product they never set up.
function ItemsStep({
  lines, products, loading, query, onQuery, draft, onDraft, currency, total,
  onAddProduct, onQuantity, onRemove, onAddCustom, onNext,
}: {
  lines: Line[]
  products: ProductRow[]
  loading: boolean
  query: string
  onQuery: (v: string) => void
  draft: CustomDraft
  onDraft: (d: CustomDraft) => void
  currency: string
  total: number
  onAddProduct: (p: ProductRow) => void
  onQuantity: (key: string, next: number) => void
  onRemove: (key: string) => void
  onAddCustom: (l: Line) => void
  onNext: () => void
}) {
  const sellable = useMemo(() => sellableProducts(products), [products])
  // Search earns its space only once the grid stops being scannable. Below the
  // threshold the tiles ARE the search, and an empty box would be chrome.
  const searchable = shouldOfferProductSearch(sellable.length)
  const shown = useMemo(
    () => (searchable ? filterProducts(sellable, query) : sellable),
    [searchable, sellable, query],
  )

  return (
    <>
      <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-6">
        {/* The cart, first — it's what the trainer is checking against. */}
        {lines.length > 0 && (
          <div className="mb-5">
            <SectionLabel>In this sale</SectionLabel>
            <FlatBlock>
              {lines.map((l) => (
                <CartRow
                  key={l.key}
                  line={l}
                  currency={currency}
                  onQuantity={(next) => onQuantity(l.key, next)}
                  onRemove={() => onRemove(l.key)}
                />
              ))}
            </FlatBlock>
          </div>
        )}

        <div className="flex items-center justify-between">
          <SectionLabel>Add items</SectionLabel>
          <button
            type="button"
            onClick={() => onDraft({ ...draft, open: !draft.open })}
            className="mb-2 -mr-2 px-2 text-xs font-semibold text-slate-700 hover:text-slate-900"
          >
            {draft.open ? 'Cancel' : 'Something else'}
          </button>
        </div>

        {draft.open && (
          <CustomLineForm
            draft={draft}
            onDraft={onDraft}
            currency={currency}
            onAdd={(line) => { onAddCustom(line); onDraft(EMPTY_DRAFT) }}
          />
        )}

        {searchable && (
          <div className="mb-3">
            <SearchField value={query} onChange={onQuery} placeholder="Search products" />
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-10 text-slate-300"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : sellable.length === 0 ? (
          <p className="rounded-xl border border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
            No priced products yet — use “Something else” to type a one-off item.
          </p>
        ) : shown.length === 0 ? (
          <p className="rounded-xl border border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
            Nothing matches “{query.trim()}”.
          </p>
        ) : (
          <FlatTileGrid count={shown.length}>
            {shown.map((p) => (
              <ProductTile
                key={p.id}
                product={p}
                currency={currency}
                inCart={quantityInCart(lines, p.id)}
                onAdd={() => onAddProduct(p)}
              />
            ))}
          </FlatTileGrid>
        )}
      </div>

      {/* Pinned action bar — total always visible, thumb-reachable. */}
      {/* Full-screen on a phone means this footer sits on the screen edge —
          pad past the home indicator so the pay button isn't under it. */}
      <footer
        className="border-t border-slate-100 bg-white px-4 py-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
      >
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-sm text-slate-500">Total</span>
          <span className="text-xl font-semibold tabular-nums text-slate-900">{formatMoney(total, currency)}</span>
        </div>
        {/* Keyed per step: a footer button that changes identity between steps
            gets reused as the same DOM node, and the click that ends one step
            lands on whatever the button has just become (commit 8ec9c36). */}
        <Button key="next-items" type="button" className="w-full" onClick={onNext} disabled={total <= 0}>
          Continue to payment
        </Button>
      </footer>
    </>
  )
}

/**
 * One line in the cart, on two rows.
 *
 * Karl's markup of the old one-row version: name, "$8.00 each", a bin, a
 * quantity, a "+" and a total all fighting for 358px, with the bin inflating
 * into a big circle the moment it took focus. globals.css gives EVERY button a
 * 44px minimum, so the fix is to design at 44 rather than fight it — the
 * −/qty/+ group is a single 44px-tall bordered control with hairlines between
 * its parts, and remove is its own square button beside it (square, not round,
 * so focus doesn't blow a circle across the row).
 *
 * "−" stops at 1 instead of turning into a bin: two different meanings on one
 * button is what made the row hard to read.
 */
function CartRow({
  line, currency, onQuantity, onRemove,
}: {
  line: Line
  currency: string
  onQuantity: (next: number) => void
  onRemove: () => void
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 text-sm font-medium text-slate-900">{line.description}</p>
        <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
          {formatMoney(lineTotalCents(line), currency)}
        </p>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-xs tabular-nums text-slate-500">
          {formatMoney(line.unitAmountCents, currency)} each
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <div className="flex h-11 items-stretch overflow-hidden rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => onQuantity(line.quantity - 1)}
              disabled={line.quantity <= 1}
              aria-label={`One fewer ${line.description}`}
              className="grid w-11 place-items-center text-slate-700 active:bg-slate-100 disabled:text-slate-300"
            >
              <Minus className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <span
              aria-label={`Quantity of ${line.description}`}
              className="grid w-10 place-items-center border-x border-slate-200 text-sm font-semibold tabular-nums text-slate-900"
            >
              {line.quantity}
            </span>
            <button
              type="button"
              onClick={() => onQuantity(line.quantity + 1)}
              aria-label={`One more ${line.description}`}
              className="grid w-11 place-items-center text-slate-700 active:bg-slate-100"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${line.description}`}
            className="grid h-11 w-11 place-items-center rounded-lg text-slate-400 active:bg-slate-100"
          >
            <Trash2 className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  )
}

/** A catalogue product: picture on top, name and price under it. */
function ProductTile({
  product, currency, inCart, onAdd,
}: {
  product: ProductRow
  currency: string
  inCart: number
  onAdd: () => void
}) {
  return (
    <button
      type="button"
      onClick={onAdd}
      aria-label={`Add ${product.name}`}
      className="flex min-w-0 flex-col text-left active:bg-slate-50"
    >
      {/* 4:3 rather than square: on a phone it keeps two-and-a-bit rows of the
          catalogue in view, and in the 512px desktop card it stops one tin of
          treats filling a quarter of the screen. */}
      <span className="grid aspect-[4/3] w-full place-items-center overflow-hidden bg-slate-50">
        {product.imageUrl
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary blob host, sized small
          ? <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
          : <ShoppingBag className="h-6 w-6 text-slate-300" strokeWidth={1.75} />}
      </span>
      <span className="block w-full min-w-0 px-3 py-2.5">
        <span className="block truncate text-sm font-medium text-slate-900">{product.name}</span>
        <span className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-xs tabular-nums">
          <span className="text-slate-500">{formatMoney(effectivePriceCents(product) ?? 0, currency)}</span>
          {isOnSale(product) && <s className="text-slate-300">{formatMoney(product.priceCents ?? 0, currency)}</s>}
        </span>
        {inCart > 0 && (
          <span className="mt-1 block text-[11px] font-medium text-slate-500">{inCart} in this sale</span>
        )}
      </span>
    </button>
  )
}

// A one-off line for anything not in the catalogue — the usual case for a
// groomer charging for a tidy-up that isn't a product. The draft lives in the
// composer, so half-typing one and stepping back to change the client doesn't
// lose it.
function CustomLineForm({
  draft, onDraft, currency, onAdd,
}: {
  draft: CustomDraft
  onDraft: (d: CustomDraft) => void
  currency: string
  onAdd: (l: Line) => void
}) {
  const cents = parseAmountToCents(draft.amount)
  const valid = draft.description.trim().length > 0 && cents != null

  function add() {
    if (!valid || cents == null) return
    onAdd({ key: `c_${crypto.randomUUID()}`, description: draft.description.trim(), quantity: 1, unitAmountCents: cents })
  }

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-xl border border-slate-200 p-3">
      <input
        autoFocus
        value={draft.description}
        onChange={(e) => onDraft({ ...draft, description: e.target.value })}
        maxLength={200}
        placeholder="What are they paying for?"
        aria-label="What are they paying for?"
        className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none placeholder:text-slate-400"
      />
      <div className="flex gap-2">
        <div className="flex flex-1 items-center gap-1 rounded-xl border border-slate-200 px-3">
          <span className="text-sm text-slate-400">{currencySymbol(currency)}</span>
          <input
            value={draft.amount}
            onChange={(e) => onDraft({ ...draft, amount: e.target.value.replace(/[^\d.]/g, '') })}
            inputMode="decimal"
            placeholder="0.00"
            aria-label="Amount"
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
        </div>
        <Button type="button" size="sm" onClick={add} disabled={!valid}>Add</Button>
      </div>
    </div>
  )
}

// Step 3 — how it gets paid. Two choices, each with room to say what it does,
// rather than two buttons in a footer racing for the same thumb. The sale
// itself is identical either way; this only decides whether we ask for the
// money now.
function PaymentStep({
  who, lines, total, currency, guest, recordLabel, recordHint, saving, pending, error, onRecord, onCharge,
}: {
  who: string | null
  lines: Line[]
  total: number
  currency: string
  /** Guest sale — card only, so no "Record" (there's nobody to invoice later). */
  guest: boolean
  recordLabel: string
  recordHint: string
  saving: boolean
  pending: PayMode | null
  error: string | null
  onRecord: () => void
  onCharge: () => void
}) {
  const itemCount = lines.reduce((n, l) => n + l.quantity, 0)
  const spinner = <Loader2 className="h-4 w-4 animate-spin text-slate-400" />

  return (
    <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-6">
      <SectionLabel>This sale</SectionLabel>
      <FlatBlock className="mb-5">
        <FlatRow label="For" trailing={<span className="text-sm text-slate-500">{who ?? '—'}</span>} />
        <FlatRow
          label="Items"
          trailing={<span className="text-sm tabular-nums text-slate-500">{itemCount}</span>}
        />
        <FlatRow
          label="Total"
          trailing={
            <span className="text-lg font-semibold tabular-nums text-slate-900">
              {formatMoney(total, currency)}
            </span>
          }
        />
      </FlatBlock>

      {error && <p className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <SectionLabel>How are they paying?</SectionLabel>
      <FlatBlock className={saving ? 'pointer-events-none opacity-60' : undefined}>
        <FlatRow
          icon={QrCode}
          label="Take payment now"
          sub="Show a QR they scan on their phone"
          onClick={onCharge}
          trailing={pending === 'charge' ? spinner : undefined}
        />
        {/* No "Record" for a guest — an unpaid sale with no one attached to it
            is just a number nobody can chase. */}
        {!guest && (
          <FlatRow
            icon={Receipt}
            label={recordLabel}
            sub={recordHint}
            onClick={onRecord}
            trailing={pending === 'record' ? spinner : undefined}
          />
        )}
      </FlatBlock>

      {guest && (
        <p className="mt-3 px-1 text-xs text-slate-500">
          A guest sale is card only — there’s no account to invoice later.
        </p>
      )}
    </div>
  )
}

// The outcome — the sale exists either way; this is just how it gets paid. The
// QR points at the invoice's public pay page, which the client opens on their
// own phone and pays with their own card.
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
      <div className="no-scrollbar flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-6 text-center">
        {showQr && payUrl ? (
          <>
            <div className="rounded-xl border border-slate-200 bg-white p-5">
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
            {/* Only clients get the push — a guest has no account to send it to.
                Worded as a maybe, because we can't know from here whether they
                have the app or have push switched on; the QR is the sure thing. */}
            {clientName && (
              <p className="mt-1 max-w-xs text-xs text-slate-400">
                We’ve also sent a payment request to their phone.
              </p>
            )}
            <button type="button" onClick={copy} className="mt-4 text-sm font-semibold text-slate-700 underline underline-offset-4">
              {copied ? 'Link copied' : 'Copy pay link instead'}
            </button>
          </>
        ) : (
          <>
            <Check className="h-8 w-8 text-slate-700" strokeWidth={1.75} />
            <p className="mt-4 text-lg font-semibold tabular-nums text-slate-900">
              {formatMoney(created.amountCents, currency)}
            </p>
            <p className="mt-1 max-w-xs text-sm text-slate-500">
              Saved as an unpaid invoice for {clientName ?? 'your client'}. It’s in Finances whenever they’re ready.
            </p>
            {payUrl && (
              <button type="button" onClick={onShowQr} className="mt-4 text-sm font-semibold text-slate-700 underline underline-offset-4">
                Take payment now instead
              </button>
            )}
          </>
        )}
      </div>

      <footer
        className="border-t border-slate-100 px-4 py-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
      >
        <Button key="done-close" type="button" className="w-full" onClick={onClose}>Done</Button>
      </footer>
    </>
  )
}
