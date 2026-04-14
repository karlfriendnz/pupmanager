'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Play, X } from 'lucide-react'

const schema = z.object({
  clientId: z.string().min(1, 'Select a client'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

type FormData = z.infer<typeof schema>

interface Client {
  id: string
  user: { name: string | null; email: string }
  dog: { name: string } | null
}

export function ApplyTemplateModal({
  templateId,
  templateName,
  clients,
}: {
  templateId: string
  templateName: string
  clients: Client[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { startDate: new Date().toISOString().split('T')[0] },
  })

  async function onSubmit(data: FormData) {
    setError(null)
    const res = await fetch(`/api/templates/${templateId}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) { setError('Failed to apply template.'); return }
    setSuccess(true)
    setTimeout(() => { setOpen(false); setSuccess(false); router.push(`/clients/${data.clientId}`) }, 1500)
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Play className="h-4 w-4" />Apply to client
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-slate-900">Apply "{templateName}"</h2>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
            </div>

            {success ? (
              <Alert variant="success">Template applied! Tasks have been added to the client&apos;s diary.</Alert>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
                {error && <Alert variant="error">{error}</Alert>}

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-slate-700">Client</label>
                  <select className="h-12 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" {...register('clientId')}>
                    <option value="">Select a client…</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.user.name ?? c.user.email}{c.dog ? ` · ${c.dog.name}` : ''}
                      </option>
                    ))}
                  </select>
                  {errors.clientId && <p className="text-xs text-red-500">{errors.clientId.message}</p>}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-slate-700">Start date (day 1)</label>
                  <input type="date" className="h-12 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" {...register('startDate')} />
                </div>

                <p className="text-xs text-slate-400">
                  Tasks will be added to the client&apos;s diary based on their day offset from the start date. You can edit individual tasks afterwards.
                </p>

                <Button type="submit" className="w-full" loading={isSubmitting}>Apply template</Button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
