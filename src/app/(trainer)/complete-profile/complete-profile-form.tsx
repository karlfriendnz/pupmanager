'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { formatPhoneInput } from '@/lib/format-phone'
import { useState } from 'react'

const schema = z.object({
  name: z.string().trim().min(2, 'Your name is required'),
  businessName: z.string().trim().min(2, 'Business name is required'),
  phone: z.string().trim().min(6, 'Phone number is required'),
  showPhoneToClients: z.boolean().optional(),
  // Optional company email shown to clients. Empty is allowed.
  publicEmail: z.union([z.string().email('Enter a valid email'), z.literal('')]).optional(),
})

type FormData = z.infer<typeof schema>

export function CompleteProfileForm({
  defaultName,
  defaultBusinessName,
  defaultPhone,
  defaultShowPhoneToClients,
  defaultPublicEmail,
}: {
  defaultName: string
  defaultBusinessName: string
  defaultPhone: string
  defaultShowPhoneToClients: boolean
  defaultPublicEmail: string
}) {
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: defaultName,
      businessName: defaultBusinessName,
      phone: defaultPhone,
      showPhoneToClients: defaultShowPhoneToClients,
      publicEmail: defaultPublicEmail,
    },
  })

  const phoneField = register('phone')

  async function onSubmit(data: FormData) {
    setServerError(null)
    const res = await fetch('/api/trainer/complete-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setServerError(body.error ?? 'Could not save. Please try again.')
      return
    }
    // Full reload so the layout re-runs its gate with the now-complete profile
    // and lands the trainer on the dashboard.
    window.location.assign('/dashboard')
  }

  return (
    <Card>
      <CardBody className="pt-6">
        {serverError && <Alert variant="error" className="mb-4">{serverError}</Alert>}
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
            autoComplete="organization"
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
              {...phoneField}
              onChange={e => {
                e.target.value = formatPhoneInput(e.target.value)
                void phoneField.onChange(e)
              }}
            />
            <label className="mt-2 flex items-start gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                {...register('showPhoneToClients')}
              />
              <span>Show my phone number to clients (so they can call you). Leave unticked to keep it private.</span>
            </label>
          </div>
          <Input
            label="Business email (optional)"
            type="email"
            autoComplete="email"
            placeholder="hello@yourbusiness.com"
            hint="Shown to clients as your business contact. Separate from your sign-in email."
            error={errors.publicEmail?.message}
            {...register('publicEmail')}
          />
          <Button type="submit" size="lg" className="w-full mt-1" loading={isSubmitting}>
            Save and continue
          </Button>
        </form>
      </CardBody>
    </Card>
  )
}
