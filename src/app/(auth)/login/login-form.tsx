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
import { OAuthButtons, type EnabledOAuth } from '../oauth-buttons'
import { AppleNativeButton } from '../apple-native-button'
import { useNativePlatform } from '@/lib/native'

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
  enabledOAuth: EnabledOAuth
}

export function LoginForm({ error, callbackUrl, enabledOAuth }: LoginFormProps) {
  const [mode, setMode] = useState<'trainer' | 'client'>('trainer')
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const [trainerLinkSent, setTrainerLinkSent] = useState(false)
  const [sendingLink, setSendingLink] = useState(false)
  // iOS uses the native Sign in with Apple sheet (no system-browser redirect).
  const isIOS = useNativePlatform() === 'ios'

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

  // Passwordless fallback for trainers — in-app email entry, link returns via
  // Universal Links. Covers trainers who signed up with Google (no password)
  // and can't use Sign in with Apple (different email).
  async function sendTrainerLink() {
    const valid = await trainerForm.trigger('email')
    if (!valid) return
    setSendingLink(true)
    try {
      await signIn('resend', {
        email: trainerForm.getValues('email'),
        redirect: false,
        callbackUrl: callbackUrl ?? '/dashboard',
      })
      setTrainerLinkSent(true)
    } finally {
      setSendingLink(false)
    }
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

        {mode === 'trainer' && (
          isIOS
            ? <AppleNativeButton callbackUrl={callbackUrl} />
            : <OAuthButtons enabledOAuth={enabledOAuth} callbackUrl={callbackUrl} />
        )}

        {mode === 'trainer' ? (
          trainerLinkSent ? (
            <CheckInbox />
          ) : (
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
            <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              or
              <span className="h-px flex-1 bg-slate-200" />
            </div>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="w-full"
              loading={sendingLink}
              onClick={sendTrainerLink}
            >
              Email me a sign-in link
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
          )
        ) : magicLinkSent ? (
          <CheckInbox />
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

// Shown after a one-tap login link is emailed (trainer or client).
function CheckInbox() {
  return (
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
  )
}

