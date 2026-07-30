'use client'

/**
 * Call the menu what you call it.
 *
 * A groomer says "Services", a daycare says "Programmes", we say "Offerings" — and
 * a trainer shouldn't have to translate their own software every time they use it.
 * One row per thing in the left menu, our word as the placeholder, theirs in the
 * box. Blank means ours.
 *
 * Not everything is up for grabs: Stripe is Stripe, and Finances, Reports and
 * Timesheets are words with an accounting meaning that a help article will use
 * (see nav-labels.ts). Those simply aren't listed, rather than listed-and-refused.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NAV_LABEL_CATALOG, type NavLabelKey } from '@/lib/nav-labels'

const MAX_LABEL = 40

export function NavLabelsPanel({
  initial,
  canEdit,
}: {
  /** Their current renames — nav key to their word. Everything else is ours. */
  initial: Record<NavLabelKey, string>
  canEdit: boolean
}) {
  const router = useRouter()
  const [values, setValues] = useState<Record<NavLabelKey, string>>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Compared against what's actually SAVED, not against the defaults — so the
  // button is live exactly when there's something to write.
  const dirty = NAV_LABEL_CATALOG.some(e => (values[e.key] ?? '') !== (initial[e.key] ?? ''))
  const renamed = NAV_LABEL_CATALOG.filter(e => (values[e.key] ?? '').trim()).length

  function edit(key: NavLabelKey, value: string) {
    setSaved(false)
    setValues(prev => ({ ...prev, [key]: value }))
  }

  async function save() {
    if (!canEdit || saving) return
    setSaving(true); setError(null)
    try {
      // The whole map, every time: a rename cleared back to our word has to be
      // able to disappear, which a patch can't express.
      const res = await fetch('/api/trainer/nav-labels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labels: values }),
      })
      if (!res.ok) { setError('That did not save — try again.'); return }
      const body = await res.json() as { labels: Record<string, string> }
      // Show what the server KEPT, not what was typed: it drops blanks and
      // anything that just matches our own word, so the boxes settle to the truth.
      setValues(body.labels)
      setSaved(true)
      // The menu is rendered server-side from this.
      router.refresh()
    } catch {
      setError('That did not save — try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="max-w-3xl" data-review-scope="Tab: What you call things">
      {/* The tab's own TabIntro already says what this page is for, so this line
          only reports where they're up to. */}
      <p className="mb-3 text-sm text-slate-500">
        {renamed === 0
          ? 'Nothing renamed yet — the menu is using our words.'
          : <span className="tabular-nums">{renamed} renamed.</span>}
      </p>

      {error && (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}
      {!canEdit && (
        <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          You can see the names, but only an owner or manager can change them.
        </p>
      )}

      <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
        {NAV_LABEL_CATALOG.map(entry => {
          const value = values[entry.key] ?? ''
          return (
            <div key={entry.key} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 basis-1/3 sm:basis-1/4">
                <span className="block truncate text-sm font-medium text-slate-900">{entry.defaultLabel}</span>
                {/* Said plainly rather than with a coloured chip: a group heading
                    renames the whole run of items under it, which is worth
                    knowing before you type. */}
                {entry.isSection && <span className="mt-0.5 block text-[11px] text-slate-500">Group heading</span>}
              </span>
              <input
                type="text"
                value={value}
                onChange={e => edit(entry.key, e.target.value)}
                disabled={!canEdit}
                maxLength={MAX_LABEL}
                placeholder={entry.defaultLabel}
                aria-label={`Your word for ${entry.defaultLabel}`}
                className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent disabled:bg-slate-50"
              />
              {/* Only where there's something to undo — a row of dead buttons
                  down the side is noise. */}
              {canEdit && value.trim() !== '' && (
                <button
                  type="button"
                  onClick={() => edit(entry.key, '')}
                  aria-label={`Use our word for ${entry.defaultLabel}`}
                  title="Use our word"
                  className="shrink-0 rounded-lg p-2 text-slate-400 active:bg-slate-100 active:text-slate-700"
                >
                  <RotateCcw className="h-4 w-4" strokeWidth={1.75} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {canEdit && (
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={() => void save()} disabled={!dirty || saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" strokeWidth={1.75} />}
            Save names
          </Button>
          {saved && !dirty && <span className="text-sm text-slate-500">Saved.</span>}
        </div>
      )}
    </section>
  )
}
