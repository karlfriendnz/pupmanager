'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { TrainerPicker, type TrainerOption } from '@/components/shared/trainer-picker'

// The dog owner's signup form. Posts to /api/auth/signup-client, which is the
// ONLY endpoint that creates a User with role CLIENT from the outside.
//
// Two entry points share it:
//   • /signup/client       — no trainer known, so they search for one first
//   • /c/<slug>/join       — arrived from a trainer's own page; `lockedTrainer`
//                            is set and there is nothing to choose
//
// A trainer is not mandatory. Someone who genuinely cannot find their trainer
// still gets an account and lands on /find-trainer, which explains what to do —
// see the comment there for why that beats blocking them at this step.

const schema = z.object({
  name: z.string().trim().min(2, 'Your name is required'),
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'At least 8 characters'),
  phone: z.string().trim().optional(),
  dogName: z.string().trim().optional(),
  message: z.string().trim().optional(),
})

type FormValues = z.infer<typeof schema>

export function ClientSignupForm({
  lockedTrainer = null,
  accentColor = null,
}: {
  lockedTrainer?: TrainerOption | null
  accentColor?: string | null
}) {
  const [trainer, setTrainer] = useState<TrainerOption | null>(lockedTrainer)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(values: FormValues) {
    setServerError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/signup-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, trainerId: trainer?.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `Sign up failed (${res.status})`)

      // Sign them straight in — there is no verification gate on a client
      // account (lib/auth.ts only blocks unverified trainers), and bouncing a
      // dog owner to a login screen seconds after they typed the password is
      // the kind of friction that loses them.
      const signedIn = await signIn('credentials', {
        email: values.email.trim().toLowerCase(),
        password: values.password,
        redirect: false,
      })
      if (!signedIn || signedIn.error) {
        window.location.href = '/login'
        return
      }
      // Full navigation so the server layouts re-read the new session.
      window.location.href = '/find-trainer'
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      {!lockedTrainer && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-slate-700">Who&apos;s your trainer?</span>
          <TrainerPicker value={trainer} onChange={setTrainer} />
          {!trainer && (
            <p className="text-xs text-slate-400">
              Optional — you can add them after you sign up.
            </p>
          )}
        </div>
      )}

      <Field htmlFor="cs-name" label="Your name" error={errors.name?.message}>
        <input
          {...register('name')}
          id="cs-name"
          type="text"
          placeholder="Sam Taylor"
          autoComplete="name"
          className={INPUT}
        />
      </Field>

      <Field htmlFor="cs-email" label="Your email" error={errors.email?.message} hint="You'll use this to sign in.">
        <input
          {...register('email')}
          id="cs-email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          className={INPUT}
        />
      </Field>

      <Field htmlFor="cs-password" label="Password" error={errors.password?.message} hint="At least 8 characters.">
        <input {...register('password')} id="cs-password" type="password" autoComplete="new-password" className={INPUT} />
      </Field>

      <Field htmlFor="cs-phone" label="Phone number (optional)" error={errors.phone?.message}>
        <input {...register('phone')} id="cs-phone" type="tel" placeholder="021 234 5678" autoComplete="tel" className={INPUT} />
      </Field>

      <Field htmlFor="cs-dog" label="Your dog's name (optional)" error={errors.dogName?.message}>
        <input {...register('dogName')} id="cs-dog" type="text" placeholder="Bailey" className={INPUT} />
      </Field>

      {trainer && (
        <Field
          htmlFor="cs-message"
          label="Anything they should know? (optional)"
          error={errors.message?.message}
          hint={`Goes to ${trainer.businessName} with your request.`}
        >
          <textarea
            {...register('message')}
            id="cs-message"
            rows={3}
            placeholder="We came to your Tuesday puppy class…"
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </Field>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="mt-2 inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm font-semibold text-white transition disabled:opacity-60"
        style={{ background: accentColor ?? 'var(--pm-brand-600)' }}
      >
        {submitting ? 'Creating your account…' : 'Create my account'}
      </button>

      <p className="text-center text-[11px] leading-snug text-slate-500">
        {trainer
          ? `${trainer.businessName} has to add you to their client list before your sessions show up. We'll ask them as soon as you're signed up.`
          : 'You can find your trainer straight after signing up.'}
      </p>

      {serverError && <p className="text-center text-xs text-red-600">{serverError}</p>}
    </form>
  )
}

const INPUT =
  'h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

// Labels are wired to their input with htmlFor/id, not just sitting above it —
// a screen reader (and Playwright's getByLabel) needs the association.
function Field({
  htmlFor, label, error, hint, children,
}: {
  htmlFor: string
  label: string
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-slate-700">{label}</label>
      {children}
      {error
        ? <p className="text-xs text-red-600">{error}</p>
        : hint
          ? <p className="text-xs text-slate-400">{hint}</p>
          : null}
    </div>
  )
}
