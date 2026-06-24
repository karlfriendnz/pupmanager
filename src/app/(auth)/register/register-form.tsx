'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Mail, CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { OAuthButtons, type EnabledOAuth } from '../oauth-buttons'
import { AppleNativeButton } from '../apple-native-button'
import { useNativePlatform } from '@/lib/native'

const schema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    businessName: z.string().min(2, 'Business name is required'),
    phone: z.string().trim().min(6, 'Phone number is required'),
    showPhoneToClients: z.boolean().optional(),
    email: z.string().email('Please enter a valid email address'),
    publicEmail: z.union([z.string().email('Please enter a valid email address'), z.literal('')]).optional(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
    promoCode: z.string().optional(),
  })
  .refine(d => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type FormData = z.infer<typeof schema>

export function RegisterForm({ enabledOAuth }: { enabledOAuth: EnabledOAuth }) {
  const [serverError, setServerError] = useState<string | null>(null)
  // iOS uses the native Sign in with Apple sheet instead of web OAuth.
  const isIOS = useNativePlatform() === 'ios'
  // Once the signup transaction succeeds we hold the email and switch the
  // form into a 6-digit code-entry state. The trainer can type the code from
  // the email or click the verify-button in the email which lands on
  // /verify-account?email=&code= and finishes the same flow.
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null)
  // Actual trial length granted (default 14, or the promo's period) — drives
  // the success copy so it reflects the date the trial really ends.
  const [trialDays, setTrialDays] = useState(14)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  async function onSubmit(data: FormData) {
    setServerError(null)
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: data.name,
        businessName: data.businessName,
        phone: data.phone,
        showPhoneToClients: data.showPhoneToClients ?? false,
        email: data.email,
        publicEmail: data.publicEmail,
        password: data.password,
        promoCode: data.promoCode,
      }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setServerError(body.error ?? 'Registration failed. Please try again.')
      return
    }

    const body = await res.json().catch(() => ({}))
    if (typeof body.trialDays === 'number') setTrialDays(body.trialDays)
    setVerifyEmail(data.email)
  }

  if (verifyEmail) {
    return <VerifyStep email={verifyEmail} trialDays={trialDays} />
  }

  return (
    <Card>
      <CardBody className="pt-6">
        {serverError && (
          <Alert variant="error" className="mb-4">{serverError}</Alert>
        )}
        {isIOS
          ? <AppleNativeButton callbackUrl="/dashboard" />
          : <OAuthButtons enabledOAuth={enabledOAuth} ctaPrefix="Sign up with" />}
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <Input
            label="Your name"
            type="text"
            autoComplete="name"
            placeholder="Jane Smith"
            error={errors.name?.message}
            {...register('name')}
          />
          <Input
            label="Business name"
            type="text"
            placeholder="Pawsome Dog Training"
            error={errors.businessName?.message}
            {...register('businessName')}
          />
          <div>
            <Input
              label="Phone number"
              type="tel"
              autoComplete="tel"
              placeholder="021 234 5678"
              error={errors.phone?.message}
              {...register('phone')}
            />
            <label className="mt-2 flex items-start gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                {...register('showPhoneToClients')}
              />
              <span>Show my phone number to clients. Leave unticked to keep it private.</span>
            </label>
          </div>
          <Input
            label="Your email"
            type="email"
            autoComplete="email"
            placeholder="jane@pawsome.co.nz"
            hint="You'll use this to sign in. Kept private — not shown to clients."
            error={errors.email?.message}
            {...register('email')}
          />
          <Input
            label="Business email (optional)"
            type="email"
            autoComplete="email"
            placeholder="hello@pawsome.co.nz"
            hint="Shown to clients as your business contact. Leave blank to skip."
            error={errors.publicEmail?.message}
            {...register('publicEmail')}
          />
          <Input
            label="Password"
            type="password"
            autoComplete="new-password"
            hint="At least 8 characters"
            error={errors.password?.message}
            {...register('password')}
          />
          <Input
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            {...register('confirmPassword')}
          />
          <Input
            label="Promo code"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="e.g. LAUNCH"
            hint="Optional — extends your free trial."
            className="uppercase placeholder:normal-case"
            error={errors.promoCode?.message}
            {...register('promoCode')}
          />
          <Button type="submit" size="lg" className="w-full mt-1" loading={isSubmitting}>
            Create account
          </Button>
          <p className="text-center text-sm text-slate-500">
            Already have an account?{' '}
            <Link href="/login" className="text-blue-600 font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </CardBody>
    </Card>
  )
}

// ─── OTP step ──────────────────────────────────────────────────────────────

function VerifyStep({ email, trialDays }: { email: string; trialDays: number }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [resentAt, setResentAt] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resending, setResending] = useState(false)
  const [verified, setVerified] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Autofocus the code input the moment we enter this step so the trainer
  // can paste straight from the email.
  useEffect(() => { inputRef.current?.focus() }, [])

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your email.')
      return
    }
    setSubmitting(true)
    const res = await fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not verify the code. Try again.')
      setSubmitting(false)
      return
    }
    setVerified(true)
  }

  async function handleResend() {
    setError(null)
    setResending(true)
    await fetch('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    setResentAt(Date.now())
    setResending(false)
  }

  if (verified) {
    return (
      <Card>
        <CardBody className="pt-8 pb-8 text-center flex flex-col items-center gap-3">
          <div className="h-14 w-14 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900">Account verified 🎉</h2>
          <p className="text-sm text-slate-600 max-w-sm">
            Your {trialDays}-day free trial has started. Sign in to set up your first programme.
          </p>
          <Link
            href="/login"
            className="mt-4 inline-flex items-center justify-center w-full max-w-xs rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-3 transition-colors"
          >
            Sign in to PupManager
          </Link>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardBody className="pt-6 flex flex-col gap-4">
        <div className="text-center flex flex-col items-center gap-2">
          <div className="h-14 w-14 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
            <Mail className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900">Check your email</h2>
          <p className="text-sm text-slate-500 max-w-sm">
            We&apos;ve sent a 6-digit code to{' '}
            <span className="font-medium text-slate-700">{email}</span>. Pop it in below
            to finish setting up your account.
          </p>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <form onSubmit={handleVerify} className="flex flex-col gap-3">
          <input
            ref={inputRef}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            aria-label="Verification code"
            className="w-full text-center text-3xl tracking-[0.5em] font-mono font-bold rounded-xl border border-slate-200 bg-white px-4 py-4 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <Button type="submit" size="lg" disabled={submitting || code.length !== 6}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify'}
          </Button>
        </form>

        <div className="text-center text-xs text-slate-500">
          {resentAt
            ? <span className="text-emerald-600">Sent! Check your inbox.</span>
            : (
              <>
                Didn&apos;t get it?{' '}
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resending}
                  className="text-blue-600 font-medium hover:underline disabled:opacity-60"
                >
                  {resending ? 'Sending…' : 'Resend code'}
                </button>
              </>
            )}
        </div>
      </CardBody>
    </Card>
  )
}
