'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { Check, ChevronRight, Loader2 } from 'lucide-react'
import type { ConsentBlock } from '@/lib/demo-consent'
import type { Persona } from '@/lib/onboarding-recommendations'

/**
 * Two screens and a wait, on a phone somebody is holding at a stand.
 *
 * Kept as one component with a `step` rather than two routes: a page transition
 * on trade-show wifi is a blank screen at the exact moment we are asking a
 * stranger for their email, and the "setting up" state has to live somewhere
 * that survives the launch request anyway.
 *
 * Designed at 390px. One bordered block per group of fields, hairline dividers,
 * no tinted icon tiles, one full-width action at the bottom of each step.
 */

type Step = 'details' | 'persona' | 'launching'

export function TryFlow({
  terms,
  marketing,
  personas,
  source,
  campaign,
}: {
  terms: ConsentBlock
  marketing: ConsentBlock
  personas: Persona[]
  source: string
  campaign: string
}) {
  const [step, setStep] = useState<Step>('details')
  const [name, setName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [email, setEmail] = useState('')
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [marketingOptIn, setMarketingOptIn] = useState(false)
  const [showTerms, setShowTerms] = useState(false)
  const [showMarketing, setShowMarketing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submitDetails(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/try/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          companyName,
          email,
          acceptTerms,
          termsVersion: terms.id,
          marketingOptIn,
          marketingVersion: marketing.id,
          source,
          campaign: campaign || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.')
        return
      }
      setStep('persona')
    } catch {
      setError('We could not reach PupManager. Check your signal and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function launch(persona: string) {
    setError(null)
    setStep('launching')
    try {
      const res = await fetch('/api/try/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.token) {
        setError(data.error ?? 'Something went wrong. Please try again.')
        setStep(data.restart ? 'details' : 'persona')
        return
      }
      // Exchange the one-time token for a session and land in the app. The
      // token is single-use and expires in five minutes; see the `demo-entry`
      // provider in lib/auth.
      await signIn('demo-entry', { token: data.token, callbackUrl: '/dashboard' })
    } catch {
      setError('We could not reach PupManager. Check your signal and try again.')
      setStep('persona')
    }
  }

  // ─── Step 3: the wait ──────────────────────────────────────────────────────
  if (step === 'launching') {
    return (
      <div data-review-scope="Step 3 of 3 · Setting up" className="flex flex-col items-center gap-4 py-16 text-center">
        <Loader2 className="h-7 w-7 animate-spin text-slate-400" strokeWidth={1.75} />
        <h1 className="text-lg font-semibold text-slate-900">Setting up your workspace</h1>
        <p className="max-w-xs text-sm text-slate-600">
          We are filling it with practice clients, dogs and bookings so it looks like a real week.
          This takes a few seconds.
        </p>
      </div>
    )
  }

  // ─── Step 2: what kind of dog pro are you? ─────────────────────────────────
  if (step === 'persona') {
    return (
      <div data-review-scope="Step 2 of 2 · Pick your trade" className="flex flex-col gap-5">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            See the platform as a…
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Pick the closest one. We fill your demo with the right kind of work.
          </p>
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white [&>*+*]:border-t [&>*+*]:border-slate-200">
          {personas.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => launch(p.id)}
              className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors active:bg-slate-50"
            >
              <span aria-hidden className="text-xl leading-none">{p.icon}</span>
              <span className="flex-1 text-sm font-medium text-slate-900">{p.label}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.75} />
            </button>
          ))}
        </div>

        <p className="text-center text-xs text-slate-500">
          Nothing you do in the demo is real, and it is deleted when you leave.
        </p>
      </div>
    )
  }

  // ─── Step 1: who are you? ──────────────────────────────────────────────────
  const canSubmit = !!name.trim() && !!companyName.trim() && !!email.trim() && acceptTerms && !busy

  return (
    <form
      data-review-scope="Step 1 of 2 · Your details"
      onSubmit={submitDetails}
      className="flex flex-col gap-5"
      noValidate
    >
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Have a play with PupManager
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Your own copy of the app, on your own phone, with practice data. Takes a few seconds to set up.
        </p>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white [&>*+*]:border-t [&>*+*]:border-slate-200">
        <Field id="try-name" label="Your name" value={name} onChange={setName} autoComplete="name" />
        <Field id="try-company" label="Business name" value={companyName} onChange={setCompanyName} autoComplete="organization" />
        <Field
          id="try-email"
          label="Email"
          value={email}
          onChange={setEmail}
          type="email"
          inputMode="email"
          autoComplete="email"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white [&>*+*]:border-t [&>*+*]:border-slate-200">
        <ConsentRow
          block={terms}
          checked={acceptTerms}
          onChange={setAcceptTerms}
          open={showTerms}
          onToggleOpen={() => setShowTerms(v => !v)}
          required
        />
        <ConsentRow
          block={marketing}
          checked={marketingOptIn}
          onChange={setMarketingOptIn}
          open={showMarketing}
          onToggleOpen={() => setShowMarketing(v => !v)}
        />
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3.5 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />}
        Next
      </button>

      {/* Two ticks, two different questions. Saying no to the second one still
          gets you the product — spelled out here so nobody feels cornered into
          a mailing list at a stand. */}
      <p className="text-center text-xs text-slate-500">
        You can try PupManager whether or not you want emails from us.
      </p>
    </form>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  inputMode,
  autoComplete,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  inputMode?: 'email' | 'text'
  autoComplete?: string
}) {
  return (
    <div className="px-4 py-3">
      {/* A real <label> — the review widget reads it, and it is just correct HTML. */}
      <label htmlFor={id} className="block text-xs font-medium text-slate-500">
        {label}
      </label>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full border-0 bg-transparent p-0 text-base text-slate-900 outline-none placeholder:text-slate-400"
        placeholder={label}
      />
    </div>
  )
}

function ConsentRow({
  block,
  checked,
  onChange,
  open,
  onToggleOpen,
  required,
}: {
  block: ConsentBlock
  checked: boolean
  onChange: (v: boolean) => void
  open: boolean
  onToggleOpen: () => void
  required?: boolean
}) {
  return (
    <div className="px-4 py-3">
      <label className="flex cursor-pointer items-start gap-3">
        <span className="relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-300 bg-white">
          <input
            type="checkbox"
            checked={checked}
            onChange={e => onChange(e.target.checked)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
          {checked && <Check className="h-3.5 w-3.5 text-slate-900" strokeWidth={2.5} />}
        </span>
        <span className="text-sm text-slate-900">
          {block.label}
          {required && <span className="ml-1 text-slate-400">(required)</span>}
        </span>
      </label>
      <button
        type="button"
        onClick={onToggleOpen}
        className="mt-1.5 pl-8 text-xs font-medium text-slate-500 underline underline-offset-2"
      >
        {open ? 'Hide the details' : 'Read what this means'}
      </button>
      {open && <p className="mt-2 pl-8 text-xs leading-relaxed text-slate-600">{block.text}</p>}
    </div>
  )
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      {children}
    </p>
  )
}
