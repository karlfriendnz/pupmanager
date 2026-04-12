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
import { TIMEZONES } from '@/lib/timezones'

const schema = z.object({
  name: z.string().min(2),
  timezone: z.string(),
  notifyEmail: z.boolean(),
  notifyPush: z.boolean(),
  dogName: z.string().min(1).optional(),
  dogBreed: z.string().optional(),
  dogWeight: z.coerce.number().positive().optional().or(z.literal('')),
})

type FormData = z.infer<typeof schema>

interface Dog {
  id: string
  name: string
  breed: string | null
  weight: number | null
}

export function ClientProfileForm({
  user,
  dog,
}: {
  user: { name: string | null; email: string; timezone: string; notifyEmail: boolean; notifyPush: boolean }
  dog: Dog | null
}) {
  const router = useRouter()
  const [msg, setMsg] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: user.name ?? '',
      timezone: user.timezone,
      notifyEmail: user.notifyEmail,
      notifyPush: user.notifyPush,
      dogName: dog?.name ?? '',
      dogBreed: dog?.breed ?? '',
      dogWeight: dog?.weight ?? '',
    },
  })

  async function onSubmit(data: FormData) {
    setMsg(null)
    const [r1, r2] = await Promise.all([
      fetch('/api/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: data.name, timezone: data.timezone, notifyEmail: data.notifyEmail, notifyPush: data.notifyPush }),
      }),
      dog
        ? fetch(`/api/dogs/${dog.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: data.dogName, breed: data.dogBreed, weight: data.dogWeight || null }),
          })
        : Promise.resolve({ ok: true }),
    ])
    setMsg(r1.ok && r2.ok ? 'Saved!' : 'Failed to save.')
    router.refresh()
  }

  async function deleteAccount() {
    setDeleting(true)
    await fetch('/api/user/delete', { method: 'DELETE' })
    router.push('/login')
  }

  return (
    <div className="flex flex-col gap-6">
      {msg && <Alert variant={msg === 'Saved!' ? 'success' : 'error'}>{msg}</Alert>}

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
        <Card>
          <CardBody className="pt-5 flex flex-col gap-4">
            <h2 className="font-semibold text-slate-900">My details</h2>
            <Input label="Your name" error={errors.name?.message} {...register('name')} />
            <Input label="Email" type="email" disabled defaultValue={user.email} />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">Timezone</label>
              <select className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" {...register('timezone')}>
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
            <label className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Email reminders</span>
              <input type="checkbox" className="h-5 w-5" {...register('notifyEmail')} />
            </label>
          </CardBody>
        </Card>

        {dog && (
          <Card>
            <CardBody className="pt-5 flex flex-col gap-4">
              <h2 className="font-semibold text-slate-900">🐕 {dog.name}&apos;s profile</h2>
              <Input label="Dog's name" error={errors.dogName?.message} {...register('dogName')} />
              <Input label="Breed" error={errors.dogBreed?.message} {...register('dogBreed')} />
              <Input label="Weight (kg)" type="number" step="0.1" error={errors.dogWeight?.message} {...register('dogWeight')} />
            </CardBody>
          </Card>
        )}

        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Save changes</Button>
      </form>

      <Card className="border-red-100">
        <CardBody className="pt-5">
          <h2 className="font-semibold text-red-700 mb-2">Delete account</h2>
          <p className="text-sm text-slate-500 mb-4">This will permanently remove your account and all training history.</p>
          {!deleteConfirm ? (
            <Button variant="danger" size="sm" onClick={() => setDeleteConfirm(true)}>Delete my account</Button>
          ) : (
            <div className="flex flex-col gap-3">
              <Alert variant="error">Are you sure? This cannot be undone.</Alert>
              <div className="flex gap-2">
                <Button variant="danger" size="sm" loading={deleting} onClick={deleteAccount}>Yes, delete</Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
