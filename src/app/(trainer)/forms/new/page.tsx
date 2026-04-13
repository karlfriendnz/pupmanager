import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { FormBuilder } from '../form-builder'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'New intake form' }

export default async function NewFormPage() {
  const session = await auth()
  if (!session) redirect('/login')

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">New intake form</h1>
        <p className="text-sm text-slate-500 mt-0.5">Build a form to embed on your website and capture leads.</p>
      </div>
      <FormBuilder appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ''} />
    </div>
  )
}
