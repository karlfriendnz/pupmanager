'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { Share2, X } from 'lucide-react'

const schema = z.object({
  partnerEmail: z.string().email('Enter a valid trainer email address'),
  shareType: z.enum(['READ_ONLY', 'CO_MANAGE', 'TRANSFER']),
})

type FormData = z.infer<typeof schema>

// External `open` + `onOpenChange` make this controllable from the
// new ClientActionsMenu — when provided, the internal Share button
// is hidden and the modal opens/closes from outside. Without them
// (legacy callers) the component renders its own trigger and manages
// state itself, unchanged.
export function ShareClientModal({
  clientId,
  clientName,
  open: externalOpen,
  onOpenChange,
}: {
  clientId: string
  clientName: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = externalOpen !== undefined
  const open = isControlled ? externalOpen : internalOpen
  const setOpen = (v: boolean) => {
    if (isControlled) onOpenChange?.(v)
    else setInternalOpen(v)
  }
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { shareType: 'READ_ONLY' },
  })

  async function onSubmit(data: FormData) {
    setError(null)
    const res = await fetch(`/api/clients/${clientId}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })

    if (!res.ok) {
      const body = await res.json()
      setError(body.error ?? 'Failed to share client.')
      return
    }

    setSuccess(true)
    setTimeout(() => {
      setOpen(false)
      setSuccess(false)
      reset()
    }, 2000)
  }

  return (
    <>
      {!isControlled && (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <Share2 className="h-4 w-4" />
          Share
        </Button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">
                Share {clientName}
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {success ? (
              <Alert variant="success">Share request sent successfully!</Alert>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
                {error && <Alert variant="error">{error}</Alert>}

                <Input
                  label="Partner trainer's email"
                  type="email"
                  placeholder="partner@trainer.co.nz"
                  error={errors.partnerEmail?.message}
                  {...register('partnerEmail')}
                />

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-slate-700">Share type</label>
                  <div className="flex flex-col gap-2">
                    <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 cursor-pointer hover:border-blue-300">
                      <input
                        type="radio"
                        value="READ_ONLY"
                        className="mt-0.5"
                        {...register('shareType')}
                      />
                      <div>
                        <p className="text-sm font-medium text-slate-700">Read-only access</p>
                        <p className="text-xs text-slate-400">Partner can view but not edit this client's data</p>
                      </div>
                    </label>
                    <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 cursor-pointer hover:border-blue-300">
                      <input
                        type="radio"
                        value="CO_MANAGE"
                        className="mt-0.5"
                        {...register('shareType')}
                      />
                      <div>
                        <p className="text-sm font-medium text-slate-700">Co-manage</p>
                        <p className="text-xs text-slate-400">Both trainers can view and edit this client's data</p>
                      </div>
                    </label>
                    <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 cursor-pointer hover:border-blue-300">
                      <input
                        type="radio"
                        value="TRANSFER"
                        className="mt-0.5"
                        {...register('shareType')}
                      />
                      <div>
                        <p className="text-sm font-medium text-slate-700">Transfer client</p>
                        <p className="text-xs text-slate-400">Partner becomes the primary trainer for this client</p>
                      </div>
                    </label>
                  </div>
                </div>

                <Button type="submit" className="w-full" loading={isSubmitting}>
                  Send request
                </Button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
