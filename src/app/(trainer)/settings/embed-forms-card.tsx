'use client'

import { useRouter } from 'next/navigation'
import { Plus, Pencil, Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface EmbedFormRow {
  id: string
  title: string
  description: string | null
  isActive: boolean
  fieldCount: number
}

// Lead-capture embed forms — the forms a trainer embeds on their own website.
// Editing happens on the existing dedicated routes; this card is the list +
// entry points, surfaced under the Website tab.
export function EmbedFormsCard({ forms }: { forms: EmbedFormRow[] }) {
  const router = useRouter()
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-slate-500" aria-hidden />
            <h3 className="text-sm font-semibold text-slate-900">Lead-capture forms</h3>
          </div>
          <p className="mt-1 text-sm text-slate-500">Embed a form on your website — submissions land in your enquiries.</p>
        </div>
        <Button type="button" size="sm" onClick={() => router.push('/forms/embed/new')} className="shrink-0">
          <Plus className="h-4 w-4" /> New form
        </Button>
      </div>

      {forms.length === 0 ? (
        <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-400">No embed forms yet.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {forms.map(f => (
            <button
              key={f.id}
              onClick={() => router.push(`/forms/embed/${f.id}`)}
              className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/40"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium text-slate-900">{f.title}</p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${f.isActive ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                    {f.isActive ? 'Published' : 'Draft'}
                  </span>
                </div>
                {f.description && <p className="truncate text-xs text-slate-400">{f.description}</p>}
              </div>
              <Pencil className="h-4 w-4 shrink-0 text-slate-400" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
