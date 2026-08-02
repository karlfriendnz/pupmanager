'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Settings, X, Trash2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmSheet } from '@/components/shared/confirm-sheet'
import { ModalPortal } from '@/components/shared/modal-portal'

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
 * Rename + delete for a category or a theme, behind a gear beside the "New …"
 * button on that thing's own page.
 *
 * It used to be a permanent block at the FOOT of the page, under the list. That
 * put the two controls for THIS category below everything inside it — on a
 * category with thirty themes, changing its name meant scrolling past all
 * thirty. The gear sits next to the only other action on the screen.
 *
 * (What it replaced before that was a pencil on every row of the index: you
 * open a category to change it, the same way you open an item to change it, so
 * a row's only job is to take you somewhere.)
 */
export function CategorySettingsButton({
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
  const [open, setOpen] = useState(false)
  const noun = kind === 'type' ? 'category' : 'theme'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${noun === 'category' ? 'Category' : 'Theme'} settings`}
        aria-haspopup="dialog"
        title={`Rename or delete this ${noun}`}
        className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50"
      >
        <Settings className="h-4 w-4" strokeWidth={1.75} />
      </button>

      {open && (
        <CategorySettingsSheet
          kind={kind}
          id={id}
          name={name}
          afterDeleteHref={afterDeleteHref}
          childCountNote={childCountNote}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/**
 * The panel itself. A real panel rather than a menu: renaming needs a text
 * field, which a row in a dropdown has nowhere to put.
 *
 * Body scroll stays locked while it is up (AGENTS.md — never two scrollbars),
 * and it portals to <body> because the header actions it opens from can live
 * inside a `backdrop-blur` bar, which would otherwise become the containing
 * block for its fixed overlay.
 */
function CategorySettingsSheet({
  kind, id, name, afterDeleteHref, childCountNote, onClose,
}: {
  kind: 'type' | 'theme'
  id: string
  name: string
  afterDeleteHref: string
  childCountNote?: string
  onClose: () => void
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

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

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
    if (!res.ok) { setDeleting(false); setConfirming(false); setError(`Could not delete this ${noun}.`); return }
    router.replace(afterDeleteHref)
    router.refresh()
  }

  return (
    <ModalPortal>
      {/* Below ConfirmSheet's z-[95] on purpose — the confirmation opens ON TOP
          of this panel, not behind it. */}
      <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-4">
        <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden />
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${noun === 'category' ? 'Category' : 'Theme'} settings`}
          className="relative w-full rounded-t-2xl border border-slate-200 bg-white p-5 shadow-xl sm:max-w-md sm:rounded-2xl"
          style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900">
              {noun === 'category' ? 'Category' : 'Theme'} settings
            </p>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 -mt-1 grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>

          <label htmlFor={`name-${id}`} className="mt-4 block text-[13px] font-medium text-slate-700">
            Name
          </label>
          <div className="mt-2 flex items-center gap-2">
            <input
              id={`name-${id}`}
              autoFocus
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

          <div className="mt-5 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="flex items-center gap-2 text-sm text-red-600"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              Delete this {noun}
            </button>
          </div>
        </div>
      </div>

      {confirming && (
        <ConfirmSheet
          title={`Delete “${name}”?`}
          body={childCountNote ?? `This ${noun} goes for good.`}
          confirmLabel="Delete"
          danger
          busy={deleting}
          onCancel={() => setConfirming(false)}
          onConfirm={remove}
        />
      )}
    </ModalPortal>
  )
}
