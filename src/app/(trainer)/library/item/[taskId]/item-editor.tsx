'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { upload } from '@vercel/blob/client'
import { FileText, ImageIcon, Loader2, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FlatBlock, SectionLabel } from '@/components/shared/flat-list'
import { RichTextEditor } from '@/components/shared/rich-text-editor'
import { compressImageFile, isDisplayableImage } from '@/lib/compress-image'
import { isRichTextEmpty } from '@/lib/rich-text'
import { ErrorNote } from '../../library-forms'
import { VideoUploadButton } from '@/components/video-upload-button'
import { Switch } from '@/components/ui/switch'

export interface EditableItem {
  id: string
  title: string
  description: string | null
  repetitions: number | null
  wantsLog?: boolean
  videoUrl: string | null
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

export function ItemEditor({ item }: { item: EditableItem }) {
  const router = useRouter()
  const [title, setTitle] = useState(item.title)
  const [description, setDescription] = useState(item.description ?? '')
  const [repetitions, setRepetitions] = useState(item.repetitions?.toString() ?? '')
  // Default true for an item saved before this existed — it behaved as homework,
  // so it keeps behaving as homework.
  const [wantsLog, setWantsLog] = useState(item.wantsLog ?? true)
  const [videoUrl, setVideoUrl] = useState(item.videoUrl ?? '')
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
        videoUrl: videoUrl.trim() || null,
        imageUrl,
        fileUrl,
        fileName,
      }),
    })
    setSaving(false)
    if (!res.ok) { setError('Could not save this item. Check the video link is a full URL.'); return }
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
        <SectionLabel>Item</SectionLabel>
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
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="sm:w-32">
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
              <div className="min-w-0 flex-1">
                <label htmlFor="item-video" className="block text-[13px] font-medium text-slate-700">Video</label>
                <input
                  id="item-video"
                  type="url"
                  placeholder="Paste a link, or upload below"
                  value={videoUrl}
                  onChange={e => { setVideoUrl(e.target.value); touched() }}
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                />
                {/* Two ways to get a video on an item, because trainers have both:
                    a YouTube link they already share, or a clip they filmed and
                    have nowhere to host. The upload writes into the same field, so
                    everything downstream (the client app, the plan) is unchanged. */}
                <VideoUploadButton
                  uploadUrl={`/api/library/items/${item.id}/video-upload`}
                  onUploaded={url => { setVideoUrl(url); touched() }}
                  label={videoUrl ? 'Replace with an upload' : 'Upload a clip'}
                  className="mt-2"
                />
              </div>
            </div>
          </div>

          {/* ── Picture ── */}
          <div className="px-4 py-4">
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
          <div className="px-4 py-4">
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

          <div className="px-4 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={save} loading={saving} disabled={!title.trim() || uploading !== null}>
                Save item
              </Button>
              {saved && <span className="text-[13px] text-slate-500">Saved.</span>}
            </div>
            {error && <ErrorNote>{error}</ErrorNote>}
          </div>
        </FlatBlock>
      </section>

    </>
  )
}

/** Delete, kept apart so it sits at the very bottom of the item page. */
export function ItemDangerZone({ item, themeHref }: { item: { id: string; title: string }; themeHref: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setDeleting(true)
    const res = await fetch(`/api/library/tasks/${item.id}`, { method: 'DELETE' })
    if (!res.ok) { setDeleting(false); setError('Could not delete this item.'); return }
    router.replace(themeHref)
    router.refresh()
  }

  return (
    <section className="mt-8">
      <SectionLabel>Item settings</SectionLabel>
      <FlatBlock>
        <div className="px-4 py-4">
          {confirming ? (
            <>
              <p className="text-sm font-medium text-slate-900">Delete &ldquo;{item.title}&rdquo;?</p>
              <p className="mt-1 text-[13px] text-slate-500">
                Homework already handed out to clients is kept — only the library copy goes.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Button variant="danger" onClick={remove} loading={deleting}>Delete</Button>
                <button type="button" onClick={() => setConfirming(false)} className="px-2 py-2 text-sm text-slate-500">
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
              Delete this item
            </button>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
      </FlatBlock>
    </section>
  )
}
