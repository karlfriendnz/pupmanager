'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

const schema = z.object({
  businessName: z.string().min(2, 'Business name is required'),
  name: z.string().min(2, 'Your name is required'),
  phone: z.string().trim().min(6, 'Phone number is required'),
  showPhoneToClients: z.boolean().optional(),
  email: z.string().email('Enter a valid email'),
  publicEmail: z.union([z.string().email('Enter a valid email'), z.literal('')]).optional(),
  password: z.string().min(8, 'At least 8 characters'),
  promoCode: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface Props {
  planId: string | null
  planName: string
  perSeatPrice: number
  purchasable: boolean
}

// Minimal, single-column account creation. Captures only what auth needs
// — name, email, password, business name — and stamps the trainer in
// TRIALING state. Business address + seat count + Stripe Checkout get
// captured later inside the platform on /billing/setup, so we don't
// burn the trainer's first 90 seconds on a long form. Props (planId,
// price, etc.) are still threaded through so we can show a small "your
// plan after the free trial" footer for context.
//
// `purchasable` left in the Props for parity with /billing/plans but
// not used here — Stripe never runs from this page anymore.
export function SignupForm({ planId: _planId, planName, perSeatPrice, purchasable: _purchasable }: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(values: FormValues) {
    setServerError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `Signup failed (${res.status})`)
      window.location.href = `/verify-account?email=${encodeURIComponent(values.email)}`
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <Field label="Business name" error={errors.businessName?.message}>
        <input
          {...register('businessName')}
          type="text"
          placeholder="Pawsome Dog Training"
          autoComplete="organization"
          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </Field>

      <Field label="Your name" error={errors.name?.message}>
        <input
          {...register('name')}
          type="text"
          placeholder="Sarah Carter"
          autoComplete="name"
          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </Field>

      <Field label="Phone number" error={errors.phone?.message}>
        <input
          {...register('phone')}
          type="tel"
          placeholder="021 234 5678"
          autoComplete="tel"
          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <label className="mt-2 flex items-start gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            {...register('showPhoneToClients')}
          />
          <span>Show my phone number to clients. Leave unticked to keep it private.</span>
        </label>
      </Field>

      <Field label="Your email" error={errors.email?.message} hint="You'll use this to sign in. Kept private — not shown to clients.">
        <input
          {...register('email')}
          type="email"
          placeholder="you@yourbusiness.com"
          autoComplete="email"
          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </Field>

      <Field label="Business email (optional)" error={errors.publicEmail?.message} hint="Shown to clients as your business contact. Leave blank to skip.">
        <input
          {...register('publicEmail')}
          type="email"
          placeholder="hello@yourbusiness.com"
          autoComplete="email"
          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </Field>

      <Field label="Password" error={errors.password?.message} hint="At least 8 characters.">
        <input
          {...register('password')}
          type="password"
          autoComplete="new-password"
          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </Field>

      <Field label="Promo code" error={errors.promoCode?.message} hint="Optional — extends your free trial.">
        <input
          {...register('promoCode')}
          type="text"
          placeholder="e.g. LAUNCH"
          autoComplete="off"
          autoCapitalize="characters"
          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm uppercase placeholder:normal-case focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </Field>

      <button
        type="submit"
        disabled={submitting}
        className="mt-2 inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm font-semibold text-white transition disabled:opacity-60"
        style={{ background: 'var(--pm-brand-600)' }}
      >
        {submitting ? 'Creating account…' : 'Start your free trial'}
      </button>

      <p className="text-center text-[11px] text-slate-500">
        10-day free trial · {planName} from ${perSeatPrice} NZD per trainer per month after.
      </p>

      {serverError && (
        <p className="text-center text-xs text-red-600">{serverError}</p>
      )}
    </form>
  )
}

function Field({
  label, error, hint, children,
}: {
  label: string
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      {children}
      {error
        ? <p className="text-xs text-red-600">{error}</p>
        : hint
          ? <p className="text-xs text-slate-400">{hint}</p>
          : null}
    </div>
  )
}
