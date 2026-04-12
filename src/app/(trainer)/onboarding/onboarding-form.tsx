'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'

const schema = z.object({
  businessName: z.string().min(2, 'Business name is required'),
  phone: z.string().optional(),
  logoUrl: z.string().url('Please enter a valid URL').optional().or(z.literal('')),
})

type FormData = z.infer<typeof schema>

export function OnboardingForm({ defaultValues }: { defaultValues: FormData }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues,
  })

  async function onSubmit(data: FormData) {
    setError(null)
    const res = await fetch('/api/trainer/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })

    if (!res.ok) {
      setError('Failed to save profile. Please try again.')
      return
    }

    router.push('/dashboard')
  }

  return (
    <Card>
      <CardBody className="pt-6">
        {error && <Alert variant="error" className="mb-4">{error}</Alert>}
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
          <Input
            label="Business name"
            placeholder="Pawsome Dog Training"
            error={errors.businessName?.message}
            {...register('businessName')}
          />

          <Input
            label="Phone number"
            type="tel"
            placeholder="+64 21 123 4567"
            hint="Clients will see this in the Help section"
            error={errors.phone?.message}
            {...register('phone')}
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Business logo</label>
            <p className="text-xs text-slate-400 -mt-1 mb-1">
              Paste a URL to your logo image. You can also upload one from Settings later.
            </p>
            <Input
              type="url"
              placeholder="https://example.com/logo.png"
              error={errors.logoUrl?.message}
              {...register('logoUrl')}
            />
          </div>

          <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-800">
            <p className="font-medium mb-1">What clients see</p>
            <p className="text-xs">
              Your business name and logo appear on every screen your clients see. Your phone
              number appears in their Help section so they can reach you between sessions.
            </p>
          </div>

          <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
            Save and continue →
          </Button>
        </form>
      </CardBody>
    </Card>
  )
}
