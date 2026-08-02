'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Check, ChevronRight, Pencil, Tag as TagIcon, Trash2, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  AddOfferingButton,
  OfferingItems,
  OfferingListBar,
  SortableOfferingCard,
  SortableOfferingList,
  useOfferingView,
} from '@/components/shared/offering-card'
import { ConfirmSheet } from '@/components/shared/confirm-sheet'
import { readApiError } from '@/lib/api-error'

export interface TagRow {
  id: string
  name: string
  /** How many things carry it — offerings and products together, because that
   *  mixture is the point of a tag. */
  items: number
}

/**
 * The trainer's one flat list of tags.
 *
 * Deliberately the SAME row shape as the shop's category rail
 * (products/category-rail.tsx) — a hairline-divided block, a grip on the left,
 * the count on the right — because they are the same gesture and a trainer
 * should not have to learn two. What is different is that a tag can be renamed
 * and deleted here: a category rail hands that off to the product form, and a
 * tag has no single form to hand it to.
 */
export function TagsView({ tags: initial }: { tags: TagRow[] }) {
  const [tags, setTags] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<TagRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [view, setView] = useOfferingView('tags')

  const ids = tags.map(t => t.id)

  async function create() {
    const name = newName.trim()
    if (!name) return
    setError(null)
    const res = await fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { setError(readApiError(body, 'Could not add that tag.')); return }
    setTags(prev => [...prev, { id: body.id, name: body.name, items: 0 }])
    setNewName('')
    setAdding(false)
  }

  async function rename(id: string) {
    const name = editName.trim()
    const before = tags
    if (!name || name === tags.find(t => t.id === id)?.name) { setEditingId(null); return }
    setError(null)
    // Renaming moves nothing: the assignments point at the id, never the word,
    // so everything in the tag is still in it a moment later.
    setTags(prev => prev.map(t => (t.id === id ? { ...t, name } : t)))
    setEditingId(null)
    const res = await fetch(`/api/tags/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setTags(before)
      setError(readApiError(body, 'Could not rename that tag.'))
    }
  }

  async function remove(tag: TagRow) {
    setDeleting(true)
    setError(null)
    const before = tags
    setTags(prev => prev.filter(t => t.id !== tag.id))
    const res = await fetch(`/api/tags/${tag.id}`, { method: 'DELETE' })
    setDeleting(false)
    setConfirmDelete(null)
    if (!res.ok) { setTags(before); setError('Could not delete that tag.') }
  }

  function reorder(next: string[]) {
    const before = tags
    setTags(next.map(id => before.find(t => t.id === id)!).filter(Boolean))
    void (async () => {
      const res = await fetch('/api/tags/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: next }),
      }).catch(() => null)
      if (!res?.ok) { setTags(before); setError('Could not save that order.') }
    })()
  }

  /**
   * One row, and only one — the same markup whether it is sitting in the
   * hairline block or in its own card in the grid. What the view changes is how
   * many of them sit across the page, never what is inside one (AGENTS.md: let
   * the CONTAINER be responsive, keep the component fixed).
   */
  function tagRow(t: TagRow, handle: ReactNode) {
    return (
      <div className="flex items-center gap-1">
        <span className="pl-1.5">{handle}</span>
        {editingId === t.id ? (
          <span className="flex min-w-0 flex-1 items-center gap-1.5 py-2 pr-2">
            <input
              autoFocus
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void rename(t.id)
                if (e.key === 'Escape') setEditingId(null)
              }}
              aria-label={`Rename ${t.name}`}
              className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-600)]"
            />
            <button type="button" onClick={() => void rename(t.id)} aria-label="Save name" className="rounded-lg p-2 text-[var(--pm-brand-600)] hover:bg-slate-100">
              <Check className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <button type="button" onClick={() => setEditingId(null)} aria-label="Cancel rename" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </span>
        ) : (
          <>
            {/* The row OPENS the tag — "3 things" is a promise the row has to
                be able to keep. Renaming lives on the pencil beside it: a tap
                that used to put a text box under the finger now answers "what
                is in here?", which is what a trainer taps a tag to find out. */}
            <Link
              href={`/offerings/tags/${t.id}`}
              className="flex min-w-0 flex-1 items-center gap-2.5 py-3 pr-1 text-left"
            >
              <TagIcon className="h-4 w-4 flex-shrink-0 text-slate-400" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{t.name}</span>
              <span className="flex-shrink-0 text-xs text-slate-400">
                {t.items === 0 ? 'Empty' : `${t.items} ${t.items === 1 ? 'thing' : 'things'}`}
              </span>
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-300" strokeWidth={1.75} />
            </Link>
            <button
              type="button"
              onClick={() => { setEditingId(t.id); setEditName(t.name) }}
              aria-label={`Rename ${t.name}`}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <Pencil className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(t)}
              aria-label={`Delete ${t.name}`}
              className="mr-1.5 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="w-full p-4 md:p-8">
      {error && (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}

      {/* No heading here — the page is already called Tags at the top of the
          screen, and saying it twice is chrome, not information. */}
      <OfferingListBar
        view={view}
        onView={setView}
        action={<AddOfferingButton label="New tag" onClick={() => { setAdding(true); setNewName('') }} />}
      />

      {/* The field opens directly under the button that asked for it, so the
          eye does not have to travel to the bottom of forty tags to find what
          it just pressed. Creating a tag is still a deliberate two-step —
          press, then name it — which is what keeps "Puppy", "Puppies" and
          "puppy class" from all existing at once. */}
      {adding && (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void create()
              if (e.key === 'Escape') { setAdding(false); setNewName('') }
            }}
            placeholder="Tag name (e.g. Puppy)"
            aria-label="New tag name"
            className="h-11 w-full min-w-0 rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-600)] sm:max-w-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void create()}
              className="inline-flex h-10 flex-1 items-center justify-center rounded-xl bg-[var(--pm-brand-600)] px-4 text-sm font-semibold text-white hover:bg-[var(--pm-brand-700)] sm:flex-none"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setNewName('') }}
              className="inline-flex h-10 items-center justify-center rounded-xl px-3 text-sm text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {tags.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
          No tags yet. A tag like “Puppy” can hold a course, a 1:1 session and a product at once.
        </p>
      ) : (
        <SortableOfferingList ids={ids} onReorder={reorder}>
          {view === 'grid' ? (
            // Four abreast on a wide screen. A tag is a short word and a count,
            // so one to a row across 1400px is mostly empty page — the grid is
            // how a trainer with thirty of them sees them all at once.
            <OfferingItems view="grid">
              {tags.map(t => (
                <SortableOfferingCard key={t.id} id={t.id}>
                  {handle => (
                    <div className="rounded-xl border border-slate-200 bg-white">{tagRow(t, handle)}</div>
                  )}
                </SortableOfferingCard>
              ))}
            </OfferingItems>
          ) : (
            // One bordered block split by hairlines, not a stack of cards —
            // the same shape as the shop's category rail, because it is the
            // same gesture and a trainer should not have to learn two.
            <div className={cn('overflow-hidden rounded-xl border border-slate-200 bg-white', '[&>*+*]:border-t [&>*+*]:border-slate-200')}>
              {tags.map(t => (
                <SortableOfferingCard key={t.id} id={t.id}>
                  {handle => tagRow(t, handle)}
                </SortableOfferingCard>
              ))}
            </div>
          )}
        </SortableOfferingList>
      )}

      {confirmDelete && (
        <ConfirmSheet
          title={`Delete “${confirmDelete.name}”?`}
          // Said out loud because "delete" next to a count of things reads like
          // it takes them with it. It does not — only the label goes.
          body={
            confirmDelete.items === 0
              ? 'Nothing is in this tag.'
              : `The ${confirmDelete.items} ${confirmDelete.items === 1 ? 'thing' : 'things'} in it stay exactly as they are — only the tag goes.`
          }
          confirmLabel="Delete tag"
          danger
          busy={deleting}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void remove(confirmDelete)}
        />
      )}
    </div>
  )
}
