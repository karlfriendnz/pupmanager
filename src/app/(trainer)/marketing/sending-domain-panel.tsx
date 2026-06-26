'use client'

import { useEffect, useState } from 'react'
import { Loader2, Check, Copy, Trash2, RefreshCw, ShieldCheck, Send, FlaskConical } from 'lucide-react'
import { Button } from '@/components/ui/button'

// One DNS record the trainer must add at their registrar to verify the domain.
type DnsRecord = {
  record?: string
  name?: string
  type?: string
  ttl?: string
  status?: string
  value?: string
  priority?: string
}

type DomainState = {
  sendingDomain: string | null
  sendingFromEmail: string | null
  verified: boolean
  trialDomain: boolean
  status: string | null
  records: DnsRecord[]
}

const EMPTY: DomainState = { sendingDomain: null, sendingFromEmail: null, verified: false, trialDomain: false, status: null, records: [] }

// Trainer-facing setup for sending bulk client emails from their own domain.
// Backed by /api/trainer/sending-domain (GET status / POST connect / PUT
// re-check / DELETE disconnect). Resend handles the DNS verification; we just
// surface the records and poll status. Three states: not set up, pending
// verification, and verified. `onChange` fires whenever the verified state may
// have changed so the host page (Marketing) can refresh.
export function SendingDomainPanel({ onChange }: { onChange?: (verified: boolean) => void }) {
  const [state, setState] = useState<DomainState | null>(null)
  const [domain, setDomain] = useState('')
  const [busy, setBusy] = useState(false)
  const [checkedPending, setCheckedPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // "Email these records to your developer" sub-flow.
  const [devEmail, setDevEmail] = useState('')
  const [sharing, setSharing] = useState(false)
  const [sharedTo, setSharedTo] = useState<string | null>(null)
  const [shareError, setShareError] = useState<string | null>(null)

  // Initial status load.
  useEffect(() => {
    let active = true
    fetch('/api/trainer/sending-domain')
      .then(r => r.json())
      .then((d: DomainState) => { if (active) setState({ ...EMPTY, ...d }) })
      .catch(() => { if (active) setError('Couldn’t load your sending domain.') })
    return () => { active = false }
  }, [])

  async function setup() {
    const trimmed = domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!trimmed) { setError('Enter your domain first.'); return }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/trainer/sending-domain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: trimmed }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Couldn’t set up that domain.')
      setState({ ...EMPTY, ...data })
      setCheckedPending(false)
      onChange?.(!!data?.verified)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t set up that domain.')
    } finally {
      setBusy(false)
    }
  }

  async function recheck() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/trainer/sending-domain', { method: 'PUT' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Couldn’t check verification.')
      setState({ ...EMPTY, ...data })
      setCheckedPending(!data?.verified)
      onChange?.(!!data?.verified)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t check verification.')
    } finally {
      setBusy(false)
    }
  }

  async function toggleTrial(enabled: boolean) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/trainer/sending-domain/trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) throw new Error('Couldn’t update the test domain.')
      setState(s => (s ? { ...s, trialDomain: enabled } : s))
      // Enabling unblocks sending; refresh the host page so the send card shows.
      onChange?.(enabled)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t update the test domain.')
    } finally {
      setBusy(false)
    }
  }

  async function shareWithDeveloper() {
    const email = devEmail.trim()
    if (!email) { setShareError('Enter their email address.'); return }
    setSharing(true)
    setShareError(null)
    try {
      const res = await fetch('/api/trainer/sending-domain/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Couldn’t send the email.')
      setSharedTo(email)
      setDevEmail('')
    } catch (e) {
      setShareError(e instanceof Error ? e.message : 'Couldn’t send the email.')
    } finally {
      setSharing(false)
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect this sending domain? You’ll go back to sending from the PupManager address.')) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/trainer/sending-domain', { method: 'DELETE' })
      if (!res.ok) throw new Error('Couldn’t disconnect the domain.')
      setState(EMPTY)
      setDomain('')
      setCheckedPending(false)
      onChange?.(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t disconnect the domain.')
    } finally {
      setBusy(false)
    }
  }

  if (state === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400 py-8">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }

  const verified = state.verified
  const pending = !!state.sendingDomain && !verified

  return (
    <div className="flex flex-col gap-6">
      {/* ── Trial / test sender active (and no verified own domain) ──── */}
      {state.trialDomain && !verified && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-sky-900">Testing with the PupManager address</p>
              <p className="mt-1 text-sm text-sky-800">
                Your emails send from <code className="rounded bg-white/70 px-1.5 py-0.5">“your name” via PupManager</code>{' '}
                for now. Great for a test — verify your own domain below for the best deliverability and your branding.
              </p>
            </div>
            <button
              type="button"
              onClick={() => toggleTrial(false)}
              disabled={busy}
              className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-50"
            >
              Turn off
            </button>
          </div>
        </div>
      )}

      {/* ── Not set up yet ─────────────────────────────────────────── */}
      {!state.sendingDomain && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Your sending domain</p>
          <p className="mt-2 text-sm text-slate-600">
            Send bulk emails to your clients from your own address — better deliverability and branding.
            You’ll send from <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">hello@mail.yourdomain.com</code>.
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="sending-domain" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Your domain
              </label>
              <input
                id="sending-domain"
                value={domain}
                onChange={e => setDomain(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') setup() }}
                placeholder="pawsandthrive.com"
                disabled={busy}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <Button type="button" onClick={setup} loading={busy} className="shrink-0">
              {!busy && <Check className="h-4 w-4" />} Set up
            </Button>
          </div>
          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

          {!state.trialDomain && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <p className="text-sm text-slate-500">
                Just want to try it first? Send a test using the PupManager address — no DNS setup needed.
              </p>
              <Button type="button" variant="secondary" onClick={() => toggleTrial(true)} loading={busy} className="mt-3">
                {!busy && <FlaskConical className="h-4 w-4" />} Use the PupManager test domain
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Pending verification ───────────────────────────────────── */}
      {pending && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Verify your domain</p>
              <p className="mt-2 text-sm text-slate-600">
                Add these DNS records to <strong className="text-slate-800">{state.sendingDomain}</strong>, then verify.
                DNS changes are made at your domain registrar (e.g. GoDaddy, Cloudflare, Namecheap).
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
              Pending
            </span>
          </div>

          {/* Hand the records to whoever manages the trainer's DNS. */}
          <div className="mt-4 rounded-xl bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-700">Don’t manage your own DNS?</p>
            <p className="mt-0.5 text-sm text-slate-500">
              Email these records to your developer or web host and they can add them for you.
            </p>
            {sharedTo ? (
              <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600">
                <Check className="h-4 w-4" /> Sent to {sharedTo}.{' '}
                <button type="button" onClick={() => setSharedTo(null)} className="font-normal text-slate-500 underline hover:no-underline">
                  Send to someone else
                </button>
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  type="email"
                  value={devEmail}
                  onChange={e => setDevEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') shareWithDeveloper() }}
                  placeholder="developer@example.com"
                  disabled={sharing}
                  className="h-11 flex-1 rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <Button type="button" variant="secondary" onClick={shareWithDeveloper} loading={sharing} className="shrink-0">
                  {!sharing && <Send className="h-4 w-4" />} Email records
                </Button>
              </div>
            )}
            {shareError && <p className="mt-2 text-sm text-rose-600">{shareError}</p>}
          </div>

          <DnsTable records={state.records} />

          {checkedPending && (
            <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
              Still pending — DNS can take a few minutes (sometimes longer) to propagate. Check again shortly.
            </p>
          )}

          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button type="button" onClick={recheck} loading={busy}>
              {!busy && <RefreshCw className="h-4 w-4" />} Check verification
            </Button>
            <button
              type="button"
              onClick={disconnect}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" /> Remove / start over
            </button>
          </div>
        </div>
      )}

      {/* ── Verified ───────────────────────────────────────────────── */}
      {verified && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-emerald-800">Your domain is verified ✓</p>
              <p className="mt-1 text-sm text-emerald-700">
                Bulk emails to your clients now send from{' '}
                <code className="rounded bg-white/70 px-1.5 py-0.5 text-emerald-900">{state.sendingFromEmail}</code>.
              </p>
            </div>
          </div>
          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
          <div className="mt-5">
            <button
              type="button"
              onClick={disconnect}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Clean, copyable table of the DNS records Resend returns. Priority/TTL columns
// only appear when at least one record carries them (MX records do; most don't).
function DnsTable({ records }: { records: DnsRecord[] }) {
  if (!records.length) {
    return (
      <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
        No DNS records were returned. Try removing and setting the domain up again.
      </p>
    )
  }
  const hasPriority = records.some(r => r.priority)
  const hasTtl = records.some(r => r.ttl)

  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[560px] border-collapse text-left text-sm">
        <thead>
          <tr className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-3 py-2.5">Type</th>
            <th className="px-3 py-2.5">Name</th>
            <th className="px-3 py-2.5">Value</th>
            {hasPriority && <th className="px-3 py-2.5">Priority</th>}
            {hasTtl && <th className="px-3 py-2.5">TTL</th>}
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 align-top">
              <td className="px-3 py-2.5 font-medium text-slate-700">{r.type ?? '—'}</td>
              <td className="px-3 py-2.5">
                <CopyCell value={r.name} />
              </td>
              <td className="px-3 py-2.5">
                <CopyCell value={r.value} />
              </td>
              {hasPriority && <td className="px-3 py-2.5 text-slate-600">{r.priority ?? '—'}</td>}
              {hasTtl && <td className="px-3 py-2.5 text-slate-600">{r.ttl ?? '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// A monospace value with a copy-to-clipboard button. Shows a brief check tick
// after copying.
function CopyCell({ value }: { value?: string }) {
  const [copied, setCopied] = useState(false)
  if (!value) return <span className="text-slate-400">—</span>
  async function copy() {
    try {
      await navigator.clipboard.writeText(value!)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — no-op */
    }
  }
  return (
    <div className="flex items-start gap-2">
      <code className="block max-w-[280px] break-all font-mono text-xs text-slate-700">{value}</code>
      <button
        type="button"
        onClick={copy}
        title="Copy"
        className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}
