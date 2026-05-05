'use client'

import { useState } from 'react'
import Link from 'next/link'
import { signIn } from 'next-auth/react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ShieldCheck, PawPrint, MailCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'

const trainerSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

const clientSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
})

type TrainerForm = z.infer<typeof trainerSchema>
type ClientForm = z.infer<typeof clientSchema>

const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: 'Incorrect email or password.',
  default: 'Something went wrong. Please try again.',
}

interface LoginFormProps {
  error?: string
  callbackUrl?: string
  // Server-side checks which OAuth providers have credentials configured;
  // hides the buttons when not. Avoids dead UI in dev/preview.
  enabledOAuth: { google: boolean; apple: boolean }
}

export function LoginForm({ error, callbackUrl, enabledOAuth }: LoginFormProps) {
  const [mode, setMode] = useState<'trainer' | 'client'>('trainer')
  const [magicLinkSent, setMagicLinkSent] = useState(false)

  const trainerForm = useForm<TrainerForm>({ resolver: zodResolver(trainerSchema) })
  const clientForm = useForm<ClientForm>({ resolver: zodResolver(clientSchema) })

  const errorMessage = error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.default) : null

  async function onTrainerSubmit(data: TrainerForm) {
    await signIn('credentials', {
      email: data.email,
      password: data.password,
      callbackUrl: callbackUrl ?? '/dashboard',
    })
  }

  async function onClientSubmit(data: ClientForm) {
    await signIn('resend', {
      email: data.email,
      redirect: false,
      callbackUrl: callbackUrl ?? '/home',
    })
    setMagicLinkSent(true)
  }

  return (
    <Card className="border-slate-100/80 shadow-md shadow-slate-900/5">
      <CardBody className="pt-6">
        <div
          role="tablist"
          aria-label="Choose account type"
          className="mb-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'trainer'}
            onClick={() => setMode('trainer')}
            className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors duration-200 ${
              mode === 'trainer'
                ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/5'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShieldCheck className="h-4 w-4" aria-hidden />
            Trainer
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'client'}
            onClick={() => setMode('client')}
            className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors duration-200 ${
              mode === 'client'
                ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/5'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <PawPrint className="h-4 w-4" aria-hidden />
            Client
          </button>
        </div>

        {errorMessage && (
          <Alert variant="error" className="mb-4">
            {errorMessage}
          </Alert>
        )}

        {mode === 'trainer' && (enabledOAuth.apple || enabledOAuth.google) && (
          <div className="mb-4 flex flex-col gap-2">
            {enabledOAuth.apple && (
              <button
                type="button"
                onClick={() => signIn('apple', { callbackUrl: callbackUrl ?? '/dashboard' })}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-black text-white text-sm font-medium hover:bg-slate-800 transition-colors"
              >
                <AppleLogo className="h-4 w-4" /> Continue with Apple
              </button>
            )}
            {enabledOAuth.google && (
              <button
                type="button"
                onClick={() => signIn('google', { callbackUrl: callbackUrl ?? '/dashboard' })}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                <GoogleLogo className="h-4 w-4" /> Continue with Google
              </button>
            )}
            <div className="my-2 flex items-center gap-3 text-[11px] uppercase tracking-wider text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              or
              <span className="h-px flex-1 bg-slate-200" />
            </div>
          </div>
        )}

        {mode === 'trainer' ? (
          <form
            onSubmit={trainerForm.handleSubmit(onTrainerSubmit)}
            className="flex flex-col gap-4"
          >
            <Input
              label="Email address"
              type="email"
              autoComplete="email"
              placeholder="you@yourbusiness.com"
              error={trainerForm.formState.errors.email?.message}
              {...trainerForm.register('email')}
            />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              error={trainerForm.formState.errors.password?.message}
              {...trainerForm.register('password')}
            />
            <div className="-mt-2 flex justify-end">
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-blue-600 transition-colors hover:text-blue-700 hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <Button
              type="submit"
              size="lg"
              className="mt-1 w-full"
              loading={trainerForm.formState.isSubmitting}
            >
              Sign in
            </Button>
            <p className="text-center text-sm text-slate-500">
              New trainer?{' '}
              <Link
                href="/register"
                className="font-medium text-blue-600 transition-colors hover:text-blue-700 hover:underline"
              >
                Create an account
              </Link>
            </p>
          </form>
        ) : magicLinkSent ? (
          <div className="flex flex-col items-center gap-3 rounded-xl bg-green-50/70 px-4 py-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-700">
              <MailCheck className="h-6 w-6" aria-hidden />
            </div>
            <div>
              <p className="text-base font-semibold text-slate-900">Check your inbox</p>
              <p className="mt-1 text-sm text-slate-600">
                We&apos;ve sent a one-tap login link to your email. It expires in 15 minutes.
              </p>
            </div>
          </div>
        ) : (
          <form
            onSubmit={clientForm.handleSubmit(onClientSubmit)}
            className="flex flex-col gap-4"
          >
            <p className="text-sm text-slate-600">
              Enter your email and we&apos;ll send you a one-tap login link — no password needed.
            </p>
            <Input
              label="Email address"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              error={clientForm.formState.errors.email?.message}
              {...clientForm.register('email')}
            />
            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={clientForm.formState.isSubmitting}
            >
              Send login link
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  )
}

function AppleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M16.365 1.43c0 1.14-.42 2.22-1.124 3.02-.85.97-2.23 1.72-3.34 1.63-.13-1.16.42-2.34 1.13-3.13.81-.92 2.18-1.6 3.34-1.62l-.01.1zM20.74 17.74c-.49 1.13-.72 1.63-1.35 2.63-.88 1.39-2.12 3.13-3.66 3.14-1.36.01-1.71-.89-3.56-.88-1.85.01-2.24.9-3.6.89-1.55-.01-2.72-1.58-3.6-2.97C2.06 16.65 1.83 12 4.12 9.5c1.04-1.13 2.66-1.83 4.18-1.83 1.55 0 2.52.85 3.79.85 1.23 0 1.98-.85 3.78-.85 1.36 0 2.81.74 3.84 2.02-3.37 1.85-2.82 6.66.93 8.05z" />
    </svg>
  )
}

function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  )
}
