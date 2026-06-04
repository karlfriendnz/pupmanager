'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { MailCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'

const schema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})
type Form = z.infer<typeof schema>

export function ClientLoginForm({
  accentColor = null,
  businessName,
  contactHref = null,
}: {
  accentColor?: string | null
  businessName: string
  contactHref?: string | null
}) {
  const [linkSent, setLinkSent] = useState(false)
  const [sendingLink, setSendingLink] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const form = useForm<Form>({ resolver: zodResolver(schema) })

  // redirect:false so a wrong password keeps them on this branded page with an
  // inline error, instead of bouncing to the generic /login.
  async function onSubmit(data: Form) {
    setError(null)
    const res = await signIn('credentials', {
      email: data.email,
      password: data.password,
      redirect: false,
    })
    if (!res || res.error) {
      setError('Incorrect email or password.')
      return
    }
    window.location.href = '/home'
  }

  // Magic-link backup — doubles as password recovery for clients.
  async function sendLink() {
    const valid = await form.trigger('email')
    if (!valid) return
    setSendingLink(true)
    setError(null)
    try {
      await signIn('resend', {
        email: form.getValues('email'),
        redirect: false,
        callbackUrl: '/home',
      })
      setLinkSent(true)
    } finally {
      setSendingLink(false)
    }
  }

  if (linkSent) return <CheckInbox />

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
      {error && <Alert variant="error">{error}</Alert>}
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
      <Button
        type="submit"
        size="lg"
        className="mt-1 w-full"
        loading={form.formState.isSubmitting}
        style={accentColor ? { backgroundColor: accentColor } : undefined}
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

      {contactHref && (
        <p className="text-center text-sm text-slate-500">
          Not a client yet?{' '}
          <a
            href={contactHref}
            className="font-medium hover:underline"
            style={accentColor ? { color: accentColor } : undefined}
          >
            Contact {businessName}
          </a>
        </p>
      )}
    </form>
  )
}

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
