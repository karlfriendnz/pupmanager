'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Trash2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FlatBlock, SectionLabel } from '@/components/shared/flat-list'

// Small, shared pieces of the Library screens. Kept flat and neutral per
// AGENTS.md — one bordered block, hairline dividers, no tinted chips.

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 flex items-start gap-2 text-[13px] text-red-600">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" strokeWidth={1.75} />
      <span>{children}</span>
    </p>
  )
}

/**
 * "Add a <thing>" — a link-weight button that opens one field in place.
 * Used for new categories on the index and new themes inside a category.
 */
export function AddNameInline({
  label,
  placeholder,
  onAdd,
  fullWidth = false,
}: {
  label: string
  placeholder: string
  onAdd: (name: string) => Promise<string | null>
  /** Under a list rather than beside its heading — the shape the shop's rail uses. */
  fullWidth?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!value.trim() || saving) return
    setSaving(true)
    setError(null)
    const err = await onAdd(value.trim())
    setSaving(false)
    if (err) { setError(err); return }
    setValue('')
    setOpen(false)
  }

  // Collapsed, this is the same solid action every other list carries, at the
  // top and to the right. Open, it becomes a full-width field — the row it is
  // about to add is full width, so the thing you type into should be too.
  // Collapsed this is JUST the button, with no margin of its own, so the
  // caller can sit it on the same line as the section heading. Open, it becomes
  // the field — which is why it cannot simply be an <AddOfferingButton>.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          fullWidth
            ? 'mt-3 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--pm-brand-600)] px-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--pm-brand-700)]'
            : 'inline-flex h-9 flex-shrink-0 items-center gap-1.5 rounded-xl bg-[var(--pm-brand-600)] px-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--pm-brand-700)]'
        }
      >
        <Plus className="h-4 w-4 flex-shrink-0" strokeWidth={2.25} />
        {label}
      </button>
    )
  }

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') setOpen(false) }}
          placeholder={placeholder}
          aria-label={label}
          className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
        <Button onClick={submit} loading={saving} disabled={!value.trim()}>Add</Button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Cancel"
          className="grid h-11 w-9 place-items-center text-slate-400"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  )
}

/**
 * Rename + delete for a category, rendered INSIDE the category's own page.
 *
 * This replaces the pencil that used to sit on each row of the list/grid: you
 * open a category to change it, the same way you open an item to change it, so
 * a row's only job is to take you somewhere.
 */
export function CategorySettings({
  kind,
  id,
  name,
  afterDeleteHref,
  childCountNote,
}: {
  kind: 'type' | 'theme'
  id: string
  name: string
  /** Where to land once it's gone — the parent category, or the index. */
  afterDeleteHref: string
  /** e.g. "3 themes and 12 items will be deleted too." */
  childCountNote?: string
}) {
  const router = useRouter()
  const [draft, setDraft] = useState(name)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const endpoint = kind === 'type' ? `/api/library/types/${id}` : `/api/library/themes/${id}`
  const noun = kind === 'type' ? 'category' : 'theme'

  async function save() {
    const next = draft.trim()
    if (!next || next === name || saving) return
    setSaving(true)
    setError(null)
    const res = await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: next }),
    })
    setSaving(false)
    if (!res.ok) { setError(`Could not rename this ${noun}.`); return }
    setSaved(true)
    router.refresh()
  }

  async function remove() {
    setDeleting(true)
    setError(null)
    const res = await fetch(endpoint, { method: 'DELETE' })
    if (!res.ok) { setDeleting(false); setError(`Could not delete this ${noun}.`); return }
    router.replace(afterDeleteHref)
    router.refresh()
  }

  return (
    <section className="mt-8">
      <SectionLabel>{noun === 'category' ? 'Category' : 'Theme'} settings</SectionLabel>
      <FlatBlock>
        <div className="px-4 py-4">
          <label htmlFor={`name-${id}`} className="block text-[13px] font-medium text-slate-700">
            Name
          </label>
          <div className="mt-2 flex items-center gap-2">
            <input
              id={`name-${id}`}
              value={draft}
              onChange={e => { setDraft(e.target.value); setSaved(false) }}
              onKeyDown={e => { if (e.key === 'Enter') void save() }}
              className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
            <Button onClick={save} loading={saving} disabled={!draft.trim() || draft.trim() === name}>
              Save
            </Button>
          </div>
          {saved && <p className="mt-2 text-[13px] text-slate-500">Name saved.</p>}
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>

        <div className="px-4 py-4">
          {confirming ? (
            <>
              <p className="text-sm font-medium text-slate-900">Delete &ldquo;{name}&rdquo;?</p>
              {childCountNote && <p className="mt-1 text-[13px] text-slate-500">{childCountNote}</p>}
              <div className="mt-3 flex items-center gap-2">
                <Button variant="danger" onClick={remove} loading={deleting}>Delete</Button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="px-2 py-2 text-sm text-slate-500"
                >
                  Keep it
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="flex items-center gap-2 text-sm text-red-600"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              Delete this {noun}
            </button>
          )}
        </div>
      </FlatBlock>
    </section>
  )
}
