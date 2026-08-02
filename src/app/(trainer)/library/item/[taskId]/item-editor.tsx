'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, MoreHorizontal, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ActionSheet, type SheetAction } from '@/components/shared/action-sheet'
import { ConfirmSheet } from '@/components/shared/confirm-sheet'
import { FlatBlock, SectionHeader } from '@/components/shared/flat-list'
import { RichTextEditor } from '@/components/shared/rich-text-editor'
import { isRichTextEmpty } from '@/lib/rich-text'
import type { MediaItem } from '@/lib/library-media'
import { ItemMedia } from './item-media'
import { ErrorNote } from '../../library-forms'
import { Switch } from '@/components/ui/switch'

export interface EditableItem {
  id: string
  title: string
  description: string | null
  repetitions: number | null
  wantsLog?: boolean
  /** Everything attached, in one ordered list — see lib/library-media.ts. */
  media: MediaItem[]
}

export function ItemEditor({
  item,
  themeHref,
  heading,
  leading,
  actions,
}: {
  item: EditableItem
  themeHref: string
  /** The tab strip, in place of a plain "Item" label. */
  heading?: React.ReactNode
  /** Sits BEFORE Save — the screen's primary action, e.g. Assign. */
  leading?: React.ReactNode
  /** Duplicate / Delete — owned by the screen, so both tabs show the same one. */
  actions?: React.ReactNode
}) {
  const router = useRouter()
  const [title, setTitle] = useState(item.title)
  const [description, setDescription] = useState(item.description ?? '')
  const [repetitions, setRepetitions] = useState(item.repetitions?.toString() ?? '')
  // Default true for an item saved before this existed — it behaved as homework,
  // so it keeps behaving as homework.
  const [wantsLog, setWantsLog] = useState(item.wantsLog ?? true)
  const [media, setMedia] = useState<MediaItem[]>(item.media)

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function touched() { setSaved(false) }

  async function save() {
    if (!title.trim() || saving) return
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/library/tasks/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        description: isRichTextEmpty(description) ? null : description,
        repetitions: repetitions.trim() ? Number.parseInt(repetitions, 10) : null,
        wantsLog,
        media,
      }),
    })
    setSaving(false)
    if (!res.ok) { setError('Could not save this item. Check every link is a full http(s) URL.'); return }
    setSaved(true)
    router.refresh()
  }

  const headerActions = (
    <>
      {leading}
      {saved && <span className="text-[13px] text-slate-500">Saved.</span>}
      <Button onClick={save} loading={saving} disabled={!title.trim()}>
        Save
      </Button>
      {actions ?? <ItemActions item={item} themeHref={themeHref} />}
    </>
  )

  return (
    <>
      <section>
        {/* With tabs the heading row is the tab strip; without them it falls
            back to a SectionHeader, which is the same 36px row the Library
            rail's heading uses so the two columns start level.

            The tabs can't go THROUGH SectionHeader: it wraps its children in a
            <p>, which can't legally hold the strip's <div> and would style the
            tabs as a tiny uppercase caption. */}
        {heading ? (
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-200">
            {heading}
            <span className="flex items-center gap-1.5 pb-1.5">{headerActions}</span>
          </div>
        ) : (
          <SectionHeader action={<span className="flex items-center gap-1.5">{headerActions}</span>}>
            Item
          </SectionHeader>
        )}
        {error && <div className="mb-3"><ErrorNote>{error}</ErrorNote></div>}
        <FlatBlock>
          <div className="px-4 py-4">
            <label htmlFor="item-title" className="block text-[13px] font-medium text-slate-700">Name</label>
            <input
              id="item-title"
              value={title}
              onChange={e => { setTitle(e.target.value); touched() }}
              className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>

          <div className="px-4 py-4">
            <label className="block text-[13px] font-medium text-slate-700">Instructions</label>
            <div className="mt-2">
              {/* Rich text everywhere (AGENTS.md): one editor in, <RichText/> out. */}
              <RichTextEditor
                value={description}
                onChange={html => { setDescription(html); touched() }}
                theme="light"
                minHeight={160}
              />
            </div>
          </div>

          <div className="px-4 py-4">
            {/* What the CLIENT is asked to do with this — a different question from
                what the item contains, so it gets its own row. The library isn't
                only a homework source: plenty of it is reference material ("how to
                fit a harness") where asking for reps and a rating is noise. */}
            <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
              <div className="min-w-0">
                <span className="block text-[13px] font-medium text-slate-700">Ask the client to log sessions</span>
                <span className="block text-xs text-slate-500">
                  {wantsLog
                    ? 'They record what they did and how it went, and it counts towards their progress.'
                    : 'Reading material — it appears in their app with nothing to fill in.'}
                </span>
              </div>
              <Switch
                checked={wantsLog}
                onChange={() => { setWantsLog(v => !v); touched() }}
                onColor="bg-teal-600"
                aria-label={`Ask the client to log sessions — ${wantsLog ? 'on' : 'off'}`}
              />
            </div>
            {/* Repetitions gets the row to itself. It is one small number and it
                belongs to the LOG question above it — how many times they should
                do this — not to the three attachments below, which are what the
                item contains. */}
            <div className="w-full sm:w-32">
              <label htmlFor="item-reps" className="block text-[13px] font-medium text-slate-700">Repetitions</label>
              <input
                id="item-reps"
                type="number"
                min={1}
                inputMode="numeric"
                value={repetitions}
                onChange={e => { setRepetitions(e.target.value); touched() }}
                className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>
          </div>

          {/* ── What's attached ──────────────────────────────────────────
              ONE ordered list, not a picture slot beside a handout slot beside
              a list of videos. Those were the same job in three shapes: you
              could not attach a second handout at all, and you had no say in
              which of the three a client met first. Now a row is a row — drag
              it, name it, delete it — and the order is the order a client
              meets them in. */}
          <div className="px-4 py-4">
            <ItemMedia
              media={media}
              onChange={next => { setMedia(next); touched() }}
              videoUploadUrl={`/api/library/items/${item.id}/video-upload`}
            />
          </div>
        </FlatBlock>
      </section>
    </>
  )
}

/**
 * Duplicate and Delete for one item, behind a ⋯ .
 *
 * Save is the thing a trainer presses every visit, so it stays a labelled
 * button. These two are occasional and one of them is unrecoverable, so they go
 * in the house sheet — full width off the bottom edge on a phone, a small panel
 * on desktop — rather than a 56px menu hanging off the corner. Same component
 * every offering screen uses.
 *
 * Delete used to be a permanent red row at the foot of the page. It was the
 * last thing on the longest screen in the Library, which is a strange amount of
 * room to give the one action nobody wants to hit.
 */
export function ItemActions({ item, themeHref }: { item: EditableItem; themeHref: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function clone() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/library/tasks/${item.id}/clone`, { method: 'POST' })
      const body = await res.json().catch(() => null) as { id?: string } | null
      if (res.ok && body?.id) {
        // Land on the copy — a duplicate is never finished as it stands.
        router.push(`/library/item/${body.id}`)
        router.refresh()
        return
      }
      setError('Could not copy this item.')
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  async function remove() {
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/library/tasks/${item.id}`, { method: 'DELETE' })
    if (!res.ok) {
      setBusy(false)
      setConfirming(false)
      setError('Could not delete this item.')
      return
    }
    // refresh() first so the theme re-renders without it — pushing alone can
    // serve the cached (stale) render.
    router.refresh()
    router.replace(themeHref)
  }

  const actions: SheetAction[] = [
    {
      key: 'clone',
      label: 'Duplicate this item',
      hint: 'Opens a copy for you to change',
      icon: <Copy className="h-5 w-5" strokeWidth={1.75} />,
      onSelect: clone,
      disabled: busy,
    },
    {
      key: 'delete',
      label: 'Delete this item',
      hint: 'Asks first — homework already handed out is kept',
      icon: <Trash2 className="h-5 w-5" strokeWidth={1.75} />,
      onSelect: () => { setOpen(false); setConfirming(true) },
      disabled: busy,
      danger: true,
    },
  ]

  return (
    <>
      {error && (
        <span role="alert" className="max-w-[12rem] truncate text-xs text-red-600" title={error}>{error}</span>
      )}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="More actions for this item"
        aria-haspopup="dialog"
        className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
      </button>

      {open && <ActionSheet title={item.title} actions={actions} onClose={() => setOpen(false)} />}

      {confirming && (
        <ConfirmSheet
          title={`Delete “${item.title}”?`}
          body="Homework already handed out to clients is kept — only the library copy goes."
          confirmLabel="Delete"
          danger
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={remove}
        />
      )}
    </>
  )
}
