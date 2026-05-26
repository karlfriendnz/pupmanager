'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'

const schema = z.object({
  category: z.string().min(1),
  subject: z.string().min(5, 'Add a short subject (5+ characters).'),
  body: z.string().min(20, 'Please add a little more detail (20+ characters).'),
})

type FormData = z.infer<typeof schema>
export type SupportFormType = 'support' | 'feedback' | 'feature' | 'bug'

const CONFIG: Record<SupportFormType, {
  categories: string[]
  subjectPlaceholder: string
  bodyPlaceholder: string
  submitLabel: string
  success: string
}> = {
  support: {
    categories: ['Account issue', 'Billing question', 'Something looks wrong', 'Other'],
    subjectPlaceholder: 'Brief description of what you need help with',
    bodyPlaceholder: 'What were you trying to do? What happened instead?',
    submitLabel: 'Send message',
    success: "✅ Got it! We've emailed you a confirmation and will reply soon.",
  },
  feedback: {
    categories: ['General feedback', 'UI improvement', 'Something you love'],
    subjectPlaceholder: 'Your feedback in a few words',
    bodyPlaceholder: 'Tell us more...',
    submitLabel: 'Send feedback',
    success: '🙏 Thanks for the feedback!',
  },
  feature: {
    categories: ['New feature', 'Improve an existing feature', 'Integration'],
    subjectPlaceholder: 'What would you like PupManager to do?',
    bodyPlaceholder: "Describe the feature and how it would help you. The more detail, the better!",
    submitLabel: 'Send request',
    success: '💡 Thanks! Your feature request is on its way to our team.',
  },
  bug: {
    categories: ['Something is broken', 'Wrong information', 'App is slow', 'Other'],
    subjectPlaceholder: 'Brief description of the bug',
    bodyPlaceholder: 'What happened? What did you expect? What page were you on?',
    submitLabel: 'Report bug',
    success: "🐛 Thanks for the report! We've logged it and will take a look.",
  },
}

export function SupportTicketForm({ type, onDone }: { type: SupportFormType; onDone?: () => void }) {
  const [sent, setSent] = useState(false)
  const cfg = CONFIG[type]

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { category: cfg.categories[0] },
  })

  async function onSubmit(data: FormData) {
    await fetch('/api/support', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, type }),
    })
    setSent(true)
    reset({ category: cfg.categories[0], subject: '', body: '' })
  }

  if (sent) {
    return (
      <Alert variant="success">
        {cfg.success}
        <button onClick={() => { setSent(false); onDone?.() }} className="block text-xs underline mt-1">
          Done
        </button>
      </Alert>
    )
  }

  const inputCls = 'rounded-xl border border-slate-200 bg-white px-4 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]'

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">Category</label>
        <select className={`h-11 ${inputCls}`} {...register('category')}>
          {cfg.categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">Subject</label>
        <input className={`h-11 ${inputCls}`} placeholder={cfg.subjectPlaceholder} {...register('subject')} />
        {errors.subject && <p className="text-xs text-red-500">{errors.subject.message}</p>}
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">Details</label>
        <textarea
          rows={4}
          className={`w-full py-3 resize-none ${inputCls}`}
          placeholder={cfg.bodyPlaceholder}
          {...register('body')}
        />
        {errors.body && <p className="text-xs text-red-500">{errors.body.message}</p>}
      </div>
      <Button type="submit" size="sm" className="self-start" loading={isSubmitting}>
        {cfg.submitLabel}
      </Button>
    </form>
  )
}
