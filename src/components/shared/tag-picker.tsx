'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'

import { SectionLabel } from '@/components/shared/flat-list'
import { readApiError } from '@/lib/api-error'

export interface TagChoice { id: string; name: string }

/**
 * The Tags field on the offering editor and the product editor.
 *
 * ONE component for both, because a tag is one flat list that reaches both and
 * two pickers would be two chances for the two catalogues to drift apart on
 * what a tag even is.
 *
 * Picking from the list is the easy path — the tags are right there, one tap
 * each. Creating one is a small text button that has to be pressed first,
 * because a trainer who types a new tag every time they add a product ends up
 * with "Puppy", "Puppies" and "puppy class" and a browse screen nobody can
 * use. (The API folds case on top of this, so at worst they get a 409 telling
 * them the tag already exists.)
 */
export function TagPicker({
  value,
  onChange,
  /**
   * When editing, the thing whose current tags should be loaded. Fetched here
   * rather than passed down from the page so that BOTH editors can use this
   * without their server pages having to learn about tags.
   */
  loadFor,
  disabled,
}: {
  value: string[]
  onChange: (ids: string[]) => void
  loadFor?: { packageId: string } | { productId: string }
  disabled?: boolean
}) {
  const [tags, setTags] = useState<TagChoice[]>([])
  const [loaded, setLoaded] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)

  // onChange changes identity on every render of a form that holds its draft in
  // state, so the load effect keys off the target only — otherwise it refetches
  // forever and stamps the trainer's edits back to what was saved.
  const onChangeRef = useRef(onChange)
  // Synced in an effect, not during render — this effect is declared first, so
  // the ref is already current by the time the load below runs.
  useEffect(() => { onChangeRef.current = onChange })
  const targetKey = loadFor ? ('packageId' in loadFor ? `p:${loadFor.packageId}` : `s:${loadFor.productId}`) : ''

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await fetch('/api/tags').catch(() => null)
      const body = await res?.json().catch(() => null)
      if (!cancelled && res?.ok && Array.isArray(body?.tags)) setTags(body.tags)
      if (!cancelled) setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!targetKey) return
    let cancelled = false
    const query = targetKey.startsWith('p:')
      ? `packageId=${encodeURIComponent(targetKey.slice(2))}`
      : `productId=${encodeURIComponent(targetKey.slice(2))}`
    void (async () => {
      const res = await fetch(`/api/tags/assign?${query}`).catch(() => null)
      const body = await res?.json().catch(() => null)
      if (!cancelled && res?.ok && Array.isArray(body?.tagIds)) onChangeRef.current(body.tagIds)
    })()
    return () => { cancelled = true }
  }, [targetKey])

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id])
  }

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
    setTags(prev => [...prev, { id: body.id, name: body.name }])
    onChange([...value, body.id])
    setNewName('')
    setAdding(false)
  }

  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Tags</SectionLabel>
      <p className="-mt-1 text-xs text-slate-500">
        Clients browse by tag. The same tag can hold a class, a 1:1 session and a product.
      </p>

      {loaded && tags.length === 0 && !adding && (
        <p className="text-xs text-slate-500">No tags yet.</p>
      )}

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map(t => {
            const on = value.includes(t.id)
            return (
              <button
                key={t.id}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                onClick={() => toggle(t.id)}
                className={`inline-flex h-8 items-center rounded-full border px-3 text-sm transition-colors disabled:opacity-50 ${
                  on
                    ? 'border-[var(--pm-brand-600)] bg-[color-mix(in_srgb,var(--pm-brand-600)_10%,white)] font-medium text-[var(--pm-brand-700)]'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                {t.name}
              </button>
            )
          })}
        </div>
      )}

      {error && <p className="text-xs text-rose-600">{error}</p>}

      {adding ? (
        <div className="flex gap-2">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); void create() }
              if (e.key === 'Escape') { setAdding(false); setNewName('') }
            }}
            placeholder="Tag name (e.g. Puppy)"
            aria-label="New tag name"
            className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-600)]"
          />
          <button type="button" onClick={() => void create()} className="h-10 rounded-xl bg-[var(--pm-brand-600)] px-3 text-sm font-semibold text-white hover:bg-[var(--pm-brand-700)]">
            Add
          </button>
          <button type="button" onClick={() => { setAdding(false); setNewName('') }} className="h-10 rounded-xl px-2 text-sm text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 self-start text-sm text-[var(--pm-brand-700)] hover:underline disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} /> New tag
        </button>
      )}
    </div>
  )
}

/**
 * Save the picked tags onto a thing, once it has an id.
 *
 * Separate from the item's own save because a brand-new offering has no id
 * until the create returns — and because the tag write must never be able to
 * fail the save it rides on. A tag that didn't stick is a tick box to re-tick;
 * a course that didn't save is an evening's work.
 */
export async function saveTags(
  target: { packageId: string } | { productId: string },
  tagIds: string[],
): Promise<boolean> {
  const res = await fetch('/api/tags/assign', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...target, tagIds }),
  }).catch(() => null)
  return !!res?.ok
}

/**
 * Take ONE tag off a thing, from the tag's own screen.
 *
 * Read-then-write against the SAME endpoint the editors save through, rather
 * than a new "delete this assignment" route. The assign endpoint has set
 * semantics, so the whole list has to be sent — and re-reading it first is what
 * stops this screen, which only knows about one tag, from silently wiping the
 * other tags the thing carries.
 *
 * The alternative was a DELETE route taking a tag id and a target. It would
 * have been one request instead of two, and a second place for the two-ended
 * tenant rule to be got right — on a gesture a trainer performs a handful of
 * times a year. Reusing the proven write was the cheaper answer.
 */
export async function removeTagFrom(
  target: { packageId: string } | { productId: string },
  tagId: string,
): Promise<boolean> {
  const query = 'packageId' in target
    ? `packageId=${encodeURIComponent(target.packageId)}`
    : `productId=${encodeURIComponent(target.productId)}`
  const res = await fetch(`/api/tags/assign?${query}`).catch(() => null)
  const body = await res?.json().catch(() => null)
  if (!res?.ok || !Array.isArray(body?.tagIds)) return false
  const remaining = (body.tagIds as string[]).filter(id => id !== tagId)
  // Nothing to do if it wasn't on there — another tab got here first, and the
  // trainer's screen is already showing the answer they wanted.
  if (remaining.length === body.tagIds.length) return true
  return saveTags(target, remaining)
}
