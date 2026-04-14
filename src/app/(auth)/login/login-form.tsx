'use client'

import { useState } from 'react'
import Link from 'next/link'
import { signIn } from 'next-auth/react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
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

export function LoginForm({ error, callbackUrl }: { error?: string; callbackUrl?: string }) {
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
      callbackUrl: callbackUrl ?? '/my-profile',
    })
    setMagicLinkSent(true)
  }

  return (
    <Card>
      <CardBody className="pt-6">
        {/* Role toggle */}
        <div className="mb-6 flex rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setMode('trainer')}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all ${
              mode === 'trainer'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            I&apos;m a trainer
          </button>
          <button
            type="button"
            onClick={() => setMode('client')}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all ${
              mode === 'client'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            I&apos;m a client
          </button>
        </div>

        {errorMessage && <Alert variant="error" className="mb-4">{errorMessage}</Alert>}

        {mode === 'trainer' ? (
          <form onSubmit={trainerForm.handleSubmit(onTrainerSubmit)} className="flex flex-col gap-4">
            <Input
              label="Email address"
              type="email"
              autoComplete="email"
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
            <div className="flex justify-end">
              <Link
                href="/forgot-password"
                className="text-xs text-blue-600 hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <Button
              type="submit"
              size="lg"
              className="w-full mt-1"
              loading={trainerForm.formState.isSubmitting}
            >
              Sign in
            </Button>
            <p className="text-center text-sm text-slate-500">
              New trainer?{' '}
              <Link href="/register" className="text-red-600 font-medium hover:underline">
                Create an account
              </Link>
            </p>
          </form>
        ) : magicLinkSent ? (
          <Alert variant="success">
            <p className="font-medium">Check your inbox!</p>
            <p className="mt-1 text-xs">
              We&apos;ve sent a login link to your email. It expires in 15 minutes.
            </p>
          </Alert>
        ) : (
          <form onSubmit={clientForm.handleSubmit(onClientSubmit)} className="flex flex-col gap-4">
            <Alert variant="info">
              Enter your email and we&apos;ll send you a one-tap login link — no password needed.
            </Alert>
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
