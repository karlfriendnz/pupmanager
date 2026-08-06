'use client'

/**
 * Call the menu what you call it — and put a picture on it.
 *
 * A groomer says "Services", a daycare says "Programmes", we say "Offerings" — and
 * a trainer shouldn't have to translate their own software every time they use it.
 * One row per thing in the left menu, our word on the left, theirs in the
 * box. Blank means ours.
 *
 * Not everything is up for grabs: Stripe is Stripe, and Finances, Reports and
 * Timesheets are words with an accounting meaning that a help article will use
 * (see nav-labels.ts). Those simply aren't listed, rather than listed-and-refused.
 *
 * THE PICTURE (Karl, 2026-08-06) sits on the same row as the word, and only on
 * the four rows a client actually sees as a way in — see NAV_IMAGE_CATALOG. It
 * saves with the names, on the same button, because a trainer setting up "Group
 * Classes" is doing one job. Left empty, the client's row keeps BORROWING the
 * picture off the first class inside it, exactly as it did before.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RowImagePicker } from '@/components/shared/row-image-picker'
import {
  NAV_LABEL_CATALOG, CLIENT_NAV_LABEL_CATALOG, RENAMEABLE_CATALOG, isImageable,
  type NavLabelKey, type RenameableEntry,
} from '@/lib/nav-labels'

const MAX_LABEL = 40

export function NavLabelsPanel({
  initial,
  initialImages,
  canEdit,
}: {
  /** Their current renames — nav key to their word. Everything else is ours. */
  initial: Record<NavLabelKey, string>
  /** Their current pictures — nav key to an image URL. Missing means "borrow". */
  initialImages: Record<NavLabelKey, string>
  canEdit: boolean
}) {
  const router = useRouter()
  const [values, setValues] = useState<Record<NavLabelKey, string>>(initial)
  const [images, setImages] = useState<Record<NavLabelKey, string>>(initialImages)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Compared against what's actually SAVED, not against the defaults — so the
  // button is live exactly when there's something to write. Pictures count:
  // uploading one and not being able to press Save would read as broken.
  const dirty =
    RENAMEABLE_CATALOG.some(e => (values[e.key] ?? '') !== (initial[e.key] ?? '')) ||
    RENAMEABLE_CATALOG.some(e => (images[e.key] ?? '') !== (initialImages[e.key] ?? ''))
  const renamed = RENAMEABLE_CATALOG.filter(e => (values[e.key] ?? '').trim()).length

  function edit(key: NavLabelKey, value: string) {
    setSaved(false)
    setValues(prev => ({ ...prev, [key]: value }))
  }

  // A cleared picture is stored by being ABSENT from the map, not by being
  // present-and-empty — one representation of "no picture", so the server can't
  // be handed two different ways of saying the same thing.
  function editImage(key: NavLabelKey, url: string | null) {
    setSaved(false)
    setImages(prev => {
      const next = { ...prev }
      if (url) next[key] = url
      else delete next[key]
      return next
    })
  }

  async function save() {
    if (!canEdit || saving) return
    setSaving(true); setError(null)
    try {
      // Both whole maps, every time: a rename cleared back to our word — or a
      // picture removed — has to be able to disappear, which a patch can't
      // express. The route treats an ABSENT key as "don't touch that column"
      // and a PRESENT one as the whole truth, so sending both is what makes
      // this button mean "save this form".
      const res = await fetch('/api/trainer/nav-labels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labels: values, images }),
      })
      if (!res.ok) { setError('That did not save — try again.'); return }
      const body = await res.json() as { labels?: Record<string, string>; images?: Record<string, string> }
      // Show what the server KEPT, not what was typed: it drops blanks and
      // anything that just matches our own word, so the boxes settle to the truth.
      if (body.labels) setValues(body.labels)
      if (body.images) setImages(body.images)
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

      {/* Said once, plainly, because the little square beside four of the rows
          otherwise looks like decoration. "Borrows" is the honest word for what
          happens when it is empty — it is not blank, it is the first thing
          inside it. */}
      <p className="mb-3 text-sm text-slate-500">
        The four you sell also take a picture, which is what your clients see on
        the booking screen. Leave it empty and it borrows one off the first thing
        inside it.
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
        {NAV_LABEL_CATALOG.map(entry => (
          <LabelRow
            key={entry.key}
            entry={entry}
            value={values[entry.key] ?? ''}
            imageUrl={images[entry.key] ?? null}
            canEdit={canEdit}
            onEdit={edit}
            onEditImage={editImage}
          />
        ))}
      </div>

      {/* The client app has words of its own that no menu row covers — the
          booking tile on their home screen borrowed the Offerings heading, so
          renaming it meant renaming the whole group. Its own box, in its own
          block, because it is a different audience. */}
      {CLIENT_NAV_LABEL_CATALOG.length > 0 && (
        <>
          <h3 className="mt-6 mb-2 text-sm font-semibold text-slate-900">What your clients see</h3>
          <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
            {CLIENT_NAV_LABEL_CATALOG.map(entry => (
              <LabelRow
                key={entry.key}
                entry={entry}
                value={values[entry.key] ?? ''}
                imageUrl={images[entry.key] ?? null}
                canEdit={canEdit}
                onEdit={edit}
                onEditImage={editImage}
              />
            ))}
          </div>
        </>
      )}

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

function LabelRow({
  entry, value, imageUrl, canEdit, onEdit, onEditImage,
}: {
  entry: RenameableEntry
  value: string
  imageUrl: string | null
  canEdit: boolean
  onEdit: (key: NavLabelKey, value: string) => void
  onEditImage: (key: NavLabelKey, url: string | null) => void
}) {
  // Only the rows a CLIENT sees as a way in carry a picture. A control on
  // /library would upload happily and then change nothing on any screen, which
  // is worse than not offering it — the trainer would go looking for it.
  const imageable = isImageable(entry.key)
  // A group heading renames the whole run of items under it, and a client-side
  // row appears somewhere other than this menu — both worth knowing before you
  // type, and both said plainly rather than with a coloured chip.
  const note = entry.hint ?? (entry.isSection ? 'Group heading' : null)
  // Two rows can carry the same default word (the Offerings heading and the
  // client's booking tile), so the accessible name has to say which is which.
  const ariaName = entry.hint ? `${entry.defaultLabel} — ${entry.hint}` : entry.defaultLabel
  return (
    // py-3.5 rather than py-3: the remove badge sits proud of the thumbnail's
    // top-right corner, and at py-3 it grazed the hairline above the row.
    <div className="flex items-center gap-3 px-4 py-3.5">
      <span className="min-w-0 basis-1/3 sm:basis-1/4">
        <span className="block truncate text-sm font-medium text-slate-900">{entry.defaultLabel}</span>
        {note && <span className="mt-0.5 block text-[11px] text-slate-500">{note}</span>}
      </span>
      <input
        type="text"
        value={value}
        onChange={e => onEdit(entry.key, e.target.value)}
        disabled={!canEdit}
        maxLength={MAX_LABEL}
        placeholder={`e.g. ${entry.examples.join(', ')}`}
        aria-label={`Your word for ${ariaName}`}
        className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent disabled:bg-slate-50"
      />
      {/* The picture your clients see on this row when they open the booking
          screen. Nothing here means it keeps borrowing one off the first thing
          inside it, which is what it has always done. */}
      {imageable ? (
        <RowImagePicker
          value={imageUrl}
          onChange={url => onEditImage(entry.key, url)}
          label={ariaName}
          disabled={!canEdit}
        />
      ) : (
        // Most rows are menu items a client never sees as a picture, so they
        // hold the slot empty rather than letting the reset button slide left
        // and leave the column ragged.
        <span className="h-10 w-10 shrink-0" aria-hidden />
      )}
      {/* Only where there's something to undo — a row of dead buttons down the
          side is noise. */}
      {canEdit && value.trim() !== '' && (
        <button
          type="button"
          onClick={() => onEdit(entry.key, '')}
          aria-label={`Use our word for ${ariaName}`}
          title="Use our word"
          className="shrink-0 rounded-lg p-2 text-slate-400 active:bg-slate-100 active:text-slate-700"
        >
          <RotateCcw className="h-4 w-4" strokeWidth={1.75} />
        </button>
      )}
    </div>
  )
}
