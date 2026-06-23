'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'

const schema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  })

type FormData = z.infer<typeof schema>

export function ResetPasswordForm({ token, email }: { token: string; email: string }) {
  const router = useRouter()
  const [done, setDone] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  async function onSubmit(data: FormData) {
    setServerError(null)
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, token, password: data.password }),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setServerError(json.error ?? 'Something went wrong. Please try again.')
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <Card>
        <CardBody className="pt-6 text-center flex flex-col gap-3">
          <p className="text-4xl">✅</p>
          <Alert variant="success">Your password has been updated. You can now sign in.</Alert>
          <Button size="lg" className="w-full" onClick={() => router.push('/login')}>
            Go to sign in
          </Button>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardBody className="pt-6">
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {serverError && <Alert variant="error">{serverError}</Alert>}
          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            error={errors.password?.message}
            {...register('password')}
          />
          <Input
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            error={errors.confirm?.message}
            {...register('confirm')}
          />
          <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
            Set new password
          </Button>
          <Link
            href="/login"
            className="text-center text-sm text-slate-500 hover:text-slate-700"
          >
            Back to sign in
          </Link>
        </form>
      </CardBody>
    </Card>
  )
}
