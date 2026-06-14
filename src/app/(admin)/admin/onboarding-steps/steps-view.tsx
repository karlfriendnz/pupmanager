'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'
import { GripVertical, ChevronDown, Loader2, Check, ArrowRight } from 'lucide-react'

export type OnboardingStepItem = {
  id: string
  key: string
  order: number
  title: string
  body: string
  ctaLabel: string
  ctaHref: string
  skippable: boolean
  skipWarning: string | null
  published: boolean
}

export function StepsView({ steps: initialSteps }: { steps: OnboardingStepItem[] }) {
  const router = useRouter()
  const [steps, setSteps] = useState(initialSteps)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = steps.findIndex(s => s.id === active.id)
    const newIndex = steps.findIndex(s => s.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(steps, oldIndex, newIndex)
    setSteps(reordered) // optimistic
    void fetch('/api/admin/onboarding-steps/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: reordered.map(s => s.id) }),
    }).then(() => router.refresh())
  }

  function applyUpdate(id: string, patch: Partial<OnboardingStepItem>) {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
  }

  async function togglePublished(step: OnboardingStepItem) {
    const next = !step.published
    applyUpdate(step.id, { published: next }) // optimistic
    const res = await fetch(`/api/admin/onboarding-steps/${step.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ published: next }),
    })
    if (!res.ok) {
      applyUpdate(step.id, { published: !next }) // roll back
      alert('Failed to update')
      return
    }
    router.refresh()
  }

  if (steps.length === 0) return <p className="text-slate-500 py-8">No onboarding steps seeded.</p>

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={steps.map(s => s.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-3">
          {steps.map((step, i) => (
            <SortableStepCard
              key={step.id}
              step={step}
              displayOrder={i + 1}
              expanded={expandedId === step.id}
              onToggleExpand={() => setExpandedId(prev => prev === step.id ? null : step.id)}
              onTogglePublished={() => togglePublished(step)}
              onSaved={patch => applyUpdate(step.id, patch)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function SortableStepCard({
  step,
  displayOrder,
  expanded,
  onToggleExpand,
  onTogglePublished,
  onSaved,
}: {
  step: OnboardingStepItem
  displayOrder: number
  expanded: boolean
  onToggleExpand: () => void
  onTogglePublished: () => void
  onSaved: (patch: Partial<OnboardingStepItem>) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id })
  const style = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-2xl border border-slate-700 bg-slate-800 overflow-hidden"
    >
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="text-slate-500 hover:text-slate-300 cursor-grab active:cursor-grabbing shrink-0"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-full bg-slate-700 text-slate-300 text-xs font-semibold">
          {displayOrder}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white truncate">{step.title}</p>
          <p className="text-xs text-slate-500 font-mono truncate">{step.key}</p>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1 text-xs text-slate-400 max-w-[40%] truncate">
          {step.ctaLabel}
          <ArrowRight className="h-3 w-3 shrink-0" />
          <span className="font-mono truncate">{step.ctaHref}</span>
        </span>
        <button
          type="button"
          onClick={onTogglePublished}
          className={cn(
            'shrink-0 inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full text-xs font-medium transition-colors',
            step.published
              ? 'bg-green-500/15 text-green-400 hover:bg-green-500/25'
              : 'bg-slate-700 text-slate-400 hover:bg-slate-600',
          )}
          title={step.published ? 'Click to unpublish' : 'Click to publish'}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', step.published ? 'bg-green-400' : 'bg-slate-500')} />
          {step.published ? 'Published' : 'Draft'}
        </button>
        <button
          type="button"
          onClick={onToggleExpand}
          className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          aria-label={expanded ? 'Collapse' : 'Edit'}
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
        </button>
      </div>

      {expanded && <StepEditor step={step} onSaved={onSaved} />}
    </div>
  )
}

function StepEditor({
  step,
  onSaved,
}: {
  step: OnboardingStepItem
  onSaved: (patch: Partial<OnboardingStepItem>) => void
}) {
  const router = useRouter()
  const [form, setForm] = useState({
    title: step.title,
    body: step.body,
    ctaLabel: step.ctaLabel,
    ctaHref: step.ctaHref,
    skippable: step.skippable,
    skipWarning: step.skipWarning ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function save() {
    setSaving(true); setSaved(false)
    try {
      const res = await fetch(`/api/admin/onboarding-steps/${step.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          body: form.body,
          ctaLabel: form.ctaLabel,
          ctaHref: form.ctaHref,
          skippable: form.skippable,
          skipWarning: form.skipWarning,
        }),
      })
      if (res.ok) {
        setSaved(true)
        onSaved({
          title: form.title,
          body: form.body,
          ctaLabel: form.ctaLabel,
          ctaHref: form.ctaHref,
          skippable: form.skippable,
          skipWarning: form.skipWarning.trim() === '' ? null : form.skipWarning,
        })
        router.refresh()
      } else {
        alert('Save failed')
      }
    } finally {
      setSaving(false)
    }
  }

  const inputClass = 'w-full rounded-xl bg-slate-900 border border-slate-700 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="border-t border-slate-700 p-5 space-y-4">
      <div>
        <label className="block text-xs text-slate-400 mb-1">Title</label>
        <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={cn(inputClass, 'h-11')} />
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1">Body</label>
        <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} rows={4} className={cn(inputClass, 'py-2 resize-y')} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1">CTA label</label>
          <input value={form.ctaLabel} onChange={e => setForm(f => ({ ...f, ctaLabel: e.target.value }))} className={cn(inputClass, 'h-11')} />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">CTA link</label>
          <input value={form.ctaHref} onChange={e => setForm(f => ({ ...f, ctaHref: e.target.value }))} className={cn(inputClass, 'h-11 font-mono')} />
        </div>
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
          <input type="checkbox" checked={form.skippable} onChange={e => setForm(f => ({ ...f, skippable: e.target.checked }))} className="h-4 w-4 accent-blue-500" />
          Skippable
        </label>
      </div>

      {form.skippable && (
        <div>
          <label className="block text-xs text-slate-400 mb-1">Skip warning <span className="text-slate-600">(optional — shown when a trainer skips this step)</span></label>
          <textarea value={form.skipWarning} onChange={e => setForm(f => ({ ...f, skipWarning: e.target.value }))} rows={2} className={cn(inputClass, 'py-2 resize-y')} />
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 h-10 rounded-xl disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {saving ? 'Saving…' : 'Save changes'}
        </button>
        {saved && <span className="text-xs text-green-400">Saved ✓</span>}
      </div>
    </div>
  )
}
