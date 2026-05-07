import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

// Shared chrome for the form editor pages — a "Back to forms" link and a
// single H1. Keeps each route file lean and consistent.
export function FormEditorPageChrome({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      <Link
        href="/settings?tab=forms"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to forms
      </Link>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">{title}</h1>
      {children}
    </div>
  )
}
