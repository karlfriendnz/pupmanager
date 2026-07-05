'use client'

import { useState } from 'react'
import Link from 'next/link'
import { signIn } from 'next-auth/react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { MailCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { OAuthButtons, type EnabledOAuth } from '../oauth-buttons'
import { AppleNativeButton } from '../apple-native-button'
import { useNativePlatform } from '@/lib/native'

const schema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

type Form = z.infer<typeof schema>

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
  const [linkSent, setLinkSent] = useState(false)
  const [sendingLink, setSendingLink] = useState(false)
  // iOS uses the native Sign in with Apple sheet (no system-browser redirect).
  const isIOS = useNativePlatform() === 'ios'

  const form = useForm<Form>({ resolver: zodResolver(schema) })

  const errorMessage = error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.default) : null

  // Single sign-in for everyone — trainers and clients both have a password.
  // Land on '/', which the middleware redirects to the right home by role
  // (CLIENT → /home, TRAINER → /dashboard).
  async function onSubmit(data: Form) {
    await signIn('credentials', {
      email: data.email,
      password: data.password,
      callbackUrl: callbackUrl ?? '/',
    })
  }

  // Magic-link backup — works for anyone (forgot password, signed up with a
  // social provider, etc.). Only needs the email field.
  async function sendLink() {
    const valid = await form.trigger('email')
    if (!valid) return
    setSendingLink(true)
    try {
      await signIn('resend', {
        email: form.getValues('email'),
        redirect: false,
        callbackUrl: callbackUrl ?? '/',
      })
      setLinkSent(true)
    } finally {
      setSendingLink(false)
    }
  }

  return (
    <Card className="border-slate-100/80 shadow-md shadow-slate-900/5">
      <CardBody className="pt-6">
        {errorMessage && (
          <Alert variant="error" className="mb-4">
            {errorMessage}
          </Alert>
        )}

        {linkSent ? (
          <CheckInbox />
        ) : (
          <>
            {isIOS
              ? <AppleNativeButton callbackUrl={callbackUrl} />
              : <OAuthButtons enabledOAuth={enabledOAuth} callbackUrl={callbackUrl} />}

            <form method="post" onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
              <Input
                label="Email address"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                error={form.formState.errors.email?.message}
                {...form.register('email')}
              />
              <Input
                label="Password"
                type="password"
                autoComplete="current-password"
                error={form.formState.errors.password?.message}
                {...form.register('password')}
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
                loading={form.formState.isSubmitting}
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
                onClick={sendLink}
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
          </>
        )}
      </CardBody>
    </Card>
  )
}

// Shown after a one-tap login link is emailed.
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
