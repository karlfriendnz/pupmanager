'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { upload } from '@vercel/blob/client'
import { Copy, FileText, ImageIcon, Loader2, MoreHorizontal, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ActionSheet, type SheetAction } from '@/components/shared/action-sheet'
import { ConfirmSheet } from '@/components/shared/confirm-sheet'
import { FlatBlock, SectionHeader } from '@/components/shared/flat-list'
import { RichTextEditor } from '@/components/shared/rich-text-editor'
import { compressImageFile, isDisplayableImage } from '@/lib/compress-image'
import { isRichTextEmpty } from '@/lib/rich-text'
import type { InstructionalVideo } from '@/lib/instructional-videos'
import { ItemVideos } from './item-videos'
import { ErrorNote } from '../../library-forms'
import { Switch } from '@/components/ui/switch'

export interface EditableItem {
  id: string
  title: string
  description: string | null
  repetitions: number | null
  wantsLog?: boolean
  videos: InstructionalVideo[]
  imageUrl: string | null
  fileUrl: string | null
  fileName: string | null
}

// A handout has to clear Vercel Blob's client-upload ceiling, not the ~4.5 MB
// serverless body cap — client uploads go straight to Blob. 20 MB matches the
// token's maximumSizeInBytes in /api/library/upload, so an oversized file is
// refused here with a sentence rather than a network error.
const MAX_FILE_BYTES = 20 * 1024 * 1024

function humanSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function ItemEditor({ item, themeHref }: { item: EditableItem; themeHref: string }) {
  const router = useRouter()
  const [title, setTitle] = useState(item.title)
  const [description, setDescription] = useState(item.description ?? '')
  const [repetitions, setRepetitions] = useState(item.repetitions?.toString() ?? '')
  // Default true for an item saved before this existed — it behaved as homework,
  // so it keeps behaving as homework.
  const [wantsLog, setWantsLog] = useState(item.wantsLog ?? true)
  const [videos, setVideos] = useState<InstructionalVideo[]>(item.videos)
  const [imageUrl, setImageUrl] = useState(item.imageUrl)
  const [fileUrl, setFileUrl] = useState(item.fileUrl)
  const [fileName, setFileName] = useState(item.fileName)

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<null | 'image' | 'file'>(null)

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
        videos,
        imageUrl,
        fileUrl,
        fileName,
      }),
    })
    setSaving(false)
    if (!res.ok) { setError('Could not save this item. Check every video link is a full http(s) URL.'); return }
    setSaved(true)
    router.refresh()
  }

  // ── Uploads ────────────────────────────────────────────────────────────────
  // Both go DIRECT to Blob via a one-shot token (/api/library/upload). Images
  // are compressed first — a raw phone photo is several MB and that's what has
  // caused "upload broken" reports elsewhere in the app.

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setUploading('image')
    try {
      const compressed = await compressImageFile(file)
      if (!(await isDisplayableImage(compressed))) {
        setError('That image format can\'t be shown in a browser. Try a JPEG or PNG.')
        return
      }
      const blob = await upload(compressed.name, compressed, {
        access: 'public',
        handleUploadUrl: '/api/library/upload',
      })
      setImageUrl(blob.url)
      touched()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed.')
    } finally {
      setUploading(null)
    }
  }

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    if (file.type !== 'application/pdf') {
      setError('Handouts need to be a PDF.')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(`That PDF is ${humanSize(file.size)} — the limit is 20 MB.`)
      return
    }
    setUploading('file')
    try {
      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: '/api/library/upload',
      })
      setFileUrl(blob.url)
      setFileName(file.name)
      touched()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(null)
    }
  }

  return (
    <>
      <section>
        {/* SectionHeader, not SectionLabel — it is the same 36px row the rail's
            heading uses, so the two columns start level. A bare label sits a
            few pixels higher than the tree beside it, which is what made the
            two headings look out of true. */}
        <SectionHeader
          action={
            <span className="flex items-center gap-1.5">
              {saved && <span className="text-[13px] text-slate-500">Saved.</span>}
              <Button onClick={save} loading={saving} disabled={!title.trim() || uploading !== null}>
                Save
              </Button>
              <ItemActions item={item} themeHref={themeHref} />
            </span>
          }
        >
          Item
        </SectionHeader>
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

          {/* ── What's attached: video, picture, handout ──────────────────────
              Three columns across on a wide screen, stacked below. They are the
              same KIND of thing — the media a trainer hangs off this exercise —
              so they read as one row of choices rather than three sections of
              one control each, which is what made the page long.

              A CONTAINER query, not a viewport one: this sits beside a 17rem
              rail, so a wide window is not a wide column. */}
          <div className="px-4 py-4">
            <div className="grid gap-5 @2xl:grid-cols-3">
              {/* ── Videos ── */}
              <ItemVideos
                videos={videos}
                onChange={next => { setVideos(next); touched() }}
                uploadUrl={`/api/library/items/${item.id}/video-upload`}
              />

              {/* ── Picture ── */}
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-slate-700">Picture</p>
                {imageUrl ? (
                  <div className="mt-2 flex items-start gap-3">
                    <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl border border-slate-200">
                      <Image src={imageUrl} alt="" fill sizes="80px" className="object-cover" unoptimized />
                    </div>
                    <button
                      type="button"
                      onClick={() => { setImageUrl(null); touched() }}
                      className="flex items-center gap-1.5 py-2 text-sm text-slate-500"
                    >
                      <X className="h-4 w-4" strokeWidth={1.75} />
                      Remove picture
                    </button>
                  </div>
                ) : (
                  <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700 active:bg-slate-50">
                    {uploading === 'image'
                      ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                      : <ImageIcon className="h-4 w-4" strokeWidth={1.75} />}
                    {uploading === 'image' ? 'Uploading…' : 'Add a picture'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploading !== null}
                      onChange={pickImage}
                    />
                  </label>
                )}
              </div>

              {/* ── Handout ── */}
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-slate-700">Handout (PDF)</p>
                {fileUrl ? (
              <div className="mt-2">
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 items-center gap-2 text-sm text-slate-900"
                >
                  <FileText className="h-4 w-4 flex-shrink-0 text-slate-700" strokeWidth={1.75} />
                  <span className="truncate underline underline-offset-2">{fileName ?? 'View handout'}</span>
                </a>
                <div className="mt-2 flex items-center gap-4 pl-6">
                  <a
                    href={fileUrl}
                    download={fileName ?? undefined}
                    className="text-sm text-slate-500 underline underline-offset-2"
                  >
                    Download
                  </a>
                  <button
                    type="button"
                    onClick={() => { setFileUrl(null); setFileName(null); touched() }}
                    className="flex items-center gap-1.5 text-sm text-slate-500"
                  >
                    <X className="h-4 w-4" strokeWidth={1.75} />
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700 active:bg-slate-50">
                {uploading === 'file'
                  ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                  : <Upload className="h-4 w-4" strokeWidth={1.75} />}
                {uploading === 'file' ? 'Uploading…' : 'Attach a PDF'}
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  disabled={uploading !== null}
                  onChange={pickFile}
                />
              </label>
                )}
                <p className="mt-2 text-[13px] text-slate-500">Up to 20 MB.</p>
              </div>
            </div>
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
function ItemActions({ item, themeHref }: { item: EditableItem; themeHref: string }) {
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
