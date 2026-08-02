'use client'

import { useState } from 'react'
import Image from 'next/image'
import { upload } from '@vercel/blob/client'
import { FileText, ImageIcon, Link2, Loader2, Plus, Video, X } from 'lucide-react'

import { SortableOfferingCard, SortableOfferingList } from '@/components/shared/offering-card'
import { FullScreenSheet } from '@/components/shared/full-screen-sheet'
import { VideoUploadButton } from '@/components/video-upload-button'
import { compressImageFile, isDisplayableImage } from '@/lib/compress-image'
import {
  MAX_MEDIA,
  mediaLabel,
  sanitizeMedia,
  type MediaItem,
  type MediaKind,
} from '@/lib/library-media'

/**
 * Everything attached to one library item, as rows you can order and delete.
 *
 * It replaced three controls — a picture slot, a handout slot, and a list of
 * videos — which were the same job in three shapes. A trainer could not attach
 * a second handout at all, and had no say in which of the three a client met
 * first. Here a row is a row: it has a kind, a name, a place in the order, and
 * an X.
 *
 * ORDER IS THE FEATURE, not a convenience. It is the sequence a client is
 * taught in, and it is also what decides the item's picture and its handout —
 * the first image and the first document win (see `mediaColumns`). Dragging
 * something to the top is how you say "this one".
 *
 * Adding asks the KIND first, then only what that kind needs — a full screen,
 * because four choices each wanting a sentence is not a dropdown (AGENTS.md).
 */
export function ItemMedia({
  media,
  onChange,
  videoUploadUrl,
}: {
  media: MediaItem[]
  onChange: (next: MediaItem[]) => void
  /** The route that authorises a video upload for THIS item. */
  videoUploadUrl: string
}) {
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const full = media.length >= MAX_MEDIA

  function add(row: MediaItem) {
    setError(null)
    if (full) { setError(`That's the limit — ${MAX_MEDIA} things on one item.`); return }
    // The same rules the server applies, so anything it would reject is refused
    // here with a sentence instead of silently vanishing on save.
    const [clean] = sanitizeMedia([row])
    if (!clean) { setError('That needs to be a full http(s) link.'); return }
    if (media.some(m => m.url === clean.url)) { setError('That is already on this item.'); return }
    onChange([...media, clean])
    setAdding(false)
  }

  function setTitle(index: number, title: string) {
    onChange(media.map((m, i) => (i === index ? { ...m, title } : m)))
  }

  function remove(index: number) {
    setError(null)
    onChange(media.filter((_, i) => i !== index))
  }

  function reorder(urls: string[]) {
    onChange(urls.map(u => media.find(m => m.url === u)!).filter(Boolean))
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium text-slate-700">Media</p>
        <button
          type="button"
          onClick={() => { setError(null); setAdding(true) }}
          disabled={full}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          Add media
        </button>
      </div>

      {media.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-slate-200 px-3.5 py-4 text-[13px] text-slate-500">
          Nothing attached yet. Pictures, clips, handouts and links all go here — in the order you want a
          client to meet them.
        </p>
      ) : (
        // Keyed by URL, which is what makes a row identifiable to dnd-kit: an
        // index would renumber on every drag and the wrong row would move.
        // Through the shared sortable helpers, never a bare DndContext.
        <SortableOfferingList ids={media.map(m => m.url)} onReorder={reorder}>
          <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white [&>*+*]:border-t [&>*+*]:border-slate-200">
            {media.map((row, i) => (
              <SortableOfferingCard key={row.url} id={row.url}>
                {handle => (
                  <div className="flex items-center gap-1.5 px-1.5 py-2">
                    {handle}
                    <MediaThumb row={row} />
                    <div className="min-w-0 flex-1">
                      <input
                        value={row.title ?? ''}
                        onChange={e => setTitle(i, e.target.value)}
                        placeholder={mediaLabel(media, i)}
                        aria-label={`Name for ${mediaLabel(media, i)}`}
                        className="h-8 w-full rounded-lg border border-transparent bg-transparent px-1.5 text-sm text-slate-900 hover:border-slate-200 focus:border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-300"
                      />
                      {/* The link itself, quietly — enough to tell two rows
                          apart when neither has been named. */}
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={row.url}
                        className="block truncate px-1.5 text-[11px] text-slate-400 underline-offset-2 hover:underline"
                      >
                        {row.fileName ?? row.url}
                      </a>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      aria-label={`Remove ${mediaLabel(media, i)}`}
                      className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    >
                      <X className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  </div>
                )}
              </SortableOfferingCard>
            ))}
          </div>
        </SortableOfferingList>
      )}

      {media.length > 1 && (
        <p className="mt-2 text-[13px] text-slate-500">
          Drag to reorder. The first picture is the item&rsquo;s thumbnail.
        </p>
      )}

      {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}

      {adding && (
        <AddMediaSheet
          videoUploadUrl={videoUploadUrl}
          onAdd={add}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  )
}

/** A picture shows itself; everything else gets its line icon. */
function MediaThumb({ row }: { row: MediaItem }) {
  if (row.kind === 'image') {
    return (
      <div className="relative h-9 w-9 flex-shrink-0 overflow-hidden rounded-lg border border-slate-200">
        <Image src={row.url} alt="" fill sizes="36px" className="object-cover" unoptimized />
      </div>
    )
  }
  const Icon = row.kind === 'video' ? Video : row.kind === 'document' ? FileText : Link2
  return (
    <span className="grid h-9 w-9 flex-shrink-0 place-items-center text-slate-700">
      <Icon className="h-4 w-4" strokeWidth={1.75} />
    </span>
  )
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

const KIND_CHOICES: { kind: MediaKind; label: string; hint: string; icon: typeof ImageIcon }[] = [
  { kind: 'image', label: 'A picture', hint: 'A photo or diagram. The first one is the item’s thumbnail.', icon: ImageIcon },
  { kind: 'video', label: 'A video', hint: 'Paste a YouTube or Vimeo link, or upload a clip you filmed.', icon: Video },
  { kind: 'document', label: 'A handout', hint: 'A PDF the client can read and download. Up to 20 MB.', icon: FileText },
  { kind: 'link', label: 'A link', hint: 'Anything else on the web — an article, a shop, a booking page.', icon: Link2 },
]

/**
 * Ask what kind, then ask only for what that kind needs.
 *
 * One screen rather than four permanent controls on the page: a trainer adding
 * a handout should not have to look at a video field, and "pick a kind" is the
 * question they can actually answer. Full screen on a phone, a centred panel on
 * desktop, body scroll locked — the house sheet does all of that.
 */
function AddMediaSheet({
  videoUploadUrl,
  onAdd,
  onClose,
}: {
  videoUploadUrl: string
  onAdd: (row: MediaItem) => void
  onClose: () => void
}) {
  const [kind, setKind] = useState<MediaKind | null>(null)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chosen = KIND_CHOICES.find(c => c.kind === kind) ?? null

  function submit(row: Partial<MediaItem> & { url: string }) {
    onAdd({
      kind: kind ?? 'link',
      url: row.url,
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(row.fileName ? { fileName: row.fileName } : {}),
    })
  }

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      // Compressed BEFORE it goes anywhere — a raw phone photo is several MB
      // and that is what has caused "upload broken" reports elsewhere.
      const compressed = await compressImageFile(file)
      if (!(await isDisplayableImage(compressed))) {
        setError('That image format can’t be shown in a browser. Try a JPEG or PNG.')
        return
      }
      const blob = await upload(compressed.name, compressed, {
        access: 'public',
        handleUploadUrl: '/api/library/upload',
      })
      submit({ url: blob.url })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed.')
    } finally {
      setBusy(false)
    }
  }

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    if (file.type !== 'application/pdf') { setError('Handouts need to be a PDF.'); return }
    if (file.size > MAX_FILE_BYTES) {
      setError(`That PDF is ${humanSize(file.size)} — the limit is 20 MB.`)
      return
    }
    setBusy(true)
    try {
      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: '/api/library/upload',
      })
      submit({ url: blob.url, fileName: file.name })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <FullScreenSheet
      title="Add media"
      sub={chosen ? chosen.label : 'What are you attaching?'}
      onClose={onClose}
    >
      {!chosen ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white [&>*+*]:border-t [&>*+*]:border-slate-200">
          {KIND_CHOICES.map(choice => (
            <button
              key={choice.kind}
              type="button"
              onClick={() => { setKind(choice.kind); setError(null) }}
              className="flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-slate-50"
            >
              <choice.icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-slate-700" strokeWidth={1.75} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900">{choice.label}</span>
                <span className="block text-[13px] text-slate-500">{choice.hint}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => { setKind(null); setUrl(''); setError(null) }}
            className="text-[13px] text-slate-500 underline underline-offset-2"
          >
            Choose something else
          </button>

          <div>
            <label htmlFor="media-title" className="block text-[13px] font-medium text-slate-700">
              Name <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="media-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={kind === 'video' ? 'e.g. Step 1 — approach' : 'What this shows'}
              className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>

          {kind === 'image' && (
            <label className="flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 active:bg-slate-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} /> : <ImageIcon className="h-4 w-4" strokeWidth={1.75} />}
              {busy ? 'Uploading…' : 'Choose a picture'}
              <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={pickImage} />
            </label>
          )}

          {kind === 'document' && (
            <label className="flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 active:bg-slate-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} /> : <FileText className="h-4 w-4" strokeWidth={1.75} />}
              {busy ? 'Uploading…' : 'Choose a PDF'}
              <input type="file" accept="application/pdf" className="hidden" disabled={busy} onChange={pickFile} />
            </label>
          )}

          {(kind === 'video' || kind === 'link') && (
            <div>
              <label htmlFor="media-url" className="block text-[13px] font-medium text-slate-700">
                {kind === 'video' ? 'Video link' : 'Web address'}
              </label>
              <input
                id="media-url"
                type="url"
                value={url}
                onChange={e => { setUrl(e.target.value); setError(null) }}
                onKeyDown={e => { if (e.key === 'Enter' && url.trim()) { e.preventDefault(); submit({ url: url.trim() }) } }}
                placeholder={kind === 'video' ? 'Paste a YouTube link' : 'https://…'}
                className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
              <button
                type="button"
                onClick={() => submit({ url: url.trim() })}
                disabled={!url.trim()}
                className="mt-3 inline-flex h-11 items-center rounded-xl bg-teal-600 px-4 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-40"
              >
                Add it
              </button>
            </div>
          )}

          {kind === 'video' && (
            // The other half of "a video": a trainer who filmed the exercise
            // themselves and has nowhere to host it.
            <VideoUploadButton
              uploadUrl={videoUploadUrl}
              onUploaded={u => submit({ url: u })}
              label="or upload a clip"
              hint="Recommended for clips under 5 minutes"
            />
          )}

          {error && <p className="text-[13px] text-red-600">{error}</p>}
        </div>
      )}
    </FullScreenSheet>
  )
}
