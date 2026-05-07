'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { Plus, X } from 'lucide-react'

const schema = z.object({
  clientName: z.string().min(2, 'Client name is required'),
  dogs: z.array(z.object({ name: z.string().min(1, "Dog's name is required") })).min(1),
  clientEmail: z.string().email('Please enter a valid email address'),
  emailBody: z.string().optional(),
})

type FormData = z.infer<typeof schema>

export function InviteClientForm({ defaultTemplate }: { defaultTemplate: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [emailWarning, setEmailWarning] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [sendInvite, setSendInvite] = useState(true)

  const {
    register,
    handleSubmit,
    watch,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    defaultValues: {
      emailBody: defaultTemplate,
      dogs: [{ name: '' }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'dogs' })

  const clientName = watch('clientName') || '{{clientName}}'
  const dogs = watch('dogs')

  const dogNamesList = dogs
    ?.map(d => d.name.trim())
    .filter(Boolean) ?? []

  const dogNamesFormatted = dogNamesList.length === 0
    ? '{{dogName}}'
    : dogNamesList.length === 1
      ? dogNamesList[0]
      : dogNamesList.slice(0, -1).join(', ') + ' and ' + dogNamesList[dogNamesList.length - 1]

  const emailBody = watch('emailBody')
    ?.replace(/{{clientName}}/g, clientName)
    ?.replace(/{{dogName}}/g, dogNamesFormatted)

  async function onSubmit(data: FormData) {
    setError(null)
    setEmailWarning(null)
    const res = await fetch('/api/clients/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientName: data.clientName,
        dogNames: data.dogs.map(d => d.name),
        clientEmail: data.clientEmail,
        emailBody: data.emailBody,
        sendInvite,
      }),
    })

    if (!res.ok) {
      const body = await res.json()
      setError(body.error ?? 'Something went wrong.')
      return
    }

    const body = await res.json()
    if (body.emailError) {
      setEmailWarning(`Client added, but the invitation email failed to send: ${body.emailError}`)
    }

    setSent(true)
    // Refresh the trainer layout so the FAB / onboarding state picks up the
    // new client count and the wizard advances past the invite step.
    router.refresh()
    setTimeout(() => router.push('/clients'), 2000)
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-3">
        {emailWarning && <Alert variant="error">{emailWarning}</Alert>}
        <Alert variant="success" className="text-center py-6">
          <p className="text-lg font-semibold">{sendInvite && !emailWarning ? 'Invitation sent! 🎉' : 'Client added!'}</p>
          <p className="text-sm mt-1">Redirecting to your client list…</p>
        </Alert>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
      {error && <Alert variant="error">{error}</Alert>}

      <Card>
        <CardBody className="pt-6 flex flex-col gap-4">
          <h2 className="font-semibold text-slate-900">Client details</h2>
          <Input
            label="Client's name"
            placeholder="Jane Smith"
            error={errors.clientName?.message}
            {...register('clientName')}
          />
          <Input
            label="Client's email address"
            type="email"
            placeholder="jane@example.com"
            error={errors.clientEmail?.message}
            {...register('clientEmail')}
          />
        </CardBody>
      </Card>

      <Card>
        <CardBody className="pt-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Dogs</h2>
            <button
              type="button"
              onClick={() => append({ name: '' })}
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              <Plus className="h-4 w-4" />
              Add another dog
            </button>
          </div>

          {fields.map((field, index) => (
            <div key={field.id} className="flex items-start gap-2">
              <div className="flex-1">
                <Input
                  label={fields.length > 1 ? `Dog ${index + 1} name` : "Dog's name"}
                  placeholder="Buddy"
                  error={errors.dogs?.[index]?.name?.message}
                  {...register(`dogs.${index}.name`)}
                />
              </div>
              {fields.length > 1 && (
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="mt-7 p-2 text-slate-400 hover:text-red-500 transition-colors"
                  aria-label="Remove dog"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="pt-6 flex flex-col gap-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <div
              onClick={() => setSendInvite(v => !v)}
              className={`relative w-10 h-6 rounded-full transition-colors ${sendInvite ? 'bg-blue-600' : 'bg-slate-200'}`}
            >
              <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${sendInvite ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-800">Send invitation email</p>
              <p className="text-xs text-slate-400">{sendInvite ? 'Client will receive a login link by email' : 'Client will be added without being notified'}</p>
            </div>
          </label>

          {sendInvite && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">Invitation email</h2>
                <span className="text-xs text-slate-400">
                  Use <code className="bg-slate-100 px-1 rounded">{'{{clientName}}'}</code> and{' '}
                  <code className="bg-slate-100 px-1 rounded">{'{{dogName}}'}</code>
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-700">Email body</label>
                <textarea
                  rows={8}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                  {...register('emailBody')}
                />
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-100 p-4">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Preview</p>
                <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans">{emailBody}</pre>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
        {sendInvite ? 'Send invitation' : 'Add client'}
      </Button>
    </form>
  )
}
