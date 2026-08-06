'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, X, Loader2 } from 'lucide-react'
import { ModalPortal } from '@/components/shared/modal-portal'
import { compressImageFile, isDisplayableImage } from '@/lib/compress-image'
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  type AttachmentRef,
  type ChatAttachmentDto,
} from '@/lib/message-attachments'

// Photos in chat, as ONE component, mounted by all four threads (client 1:1,
// client group, trainer 1:1, trainer group) and by anything that mounts a
// thread later — the /clients/[clientId]/communication page being built right
// now, for instance. Nothing in here knows which screen it is on: it is handed
// a thread scope and it gets on with it.
//
// Three pieces, deliberately in one file so they cannot be half-adopted:
//   usePhotoDrafts()    the picking / compressing / uploading state machine
//   <PhotoComposer>     the camera button + the strip of pending thumbnails
//   <ChatPhotos>        the thumbnails inside a bubble, and the full-screen view

export type ChatThreadScope = { clientId: string } | { groupId: string }

// ─── The draft state machine ────────────────────────────────────────────────

interface PhotoDraft {
  key: string
  /** Object URL for the local preview — shown while (and after) it uploads. */
  previewUrl: string
  status: 'uploading' | 'ready' | 'failed'
  /** Set once the upload lands. This is what the message POST sends. */
  ref: AttachmentRef | null
  error: string | null
}

export interface PhotoDraftsApi {
  drafts: PhotoDraft[]
  /** Refs for every photo that uploaded cleanly, in the order they were picked. */
  refs: AttachmentRef[]
  /** True while anything is still going up — the Send button waits on it. */
  busy: boolean
  /** True when there is at least one photo to send. */
  hasPhotos: boolean
  add: (files: FileList | File[]) => void
  remove: (key: string) => void
  clear: () => void
  /** How many more they may add. */
  remaining: number
}

/**
 * Upload happens on PICK, not on send.
 *
 * A trainer standing in a field on 3G who types a sentence and hits send should
 * not then wait ten seconds staring at a spinner — by the time they have
 * finished typing, the photo is already in the store. It also means a failed
 * upload is reported next to the thumbnail that failed, while they can still do
 * something about it, rather than as one opaque "message failed to send".
 */
export function usePhotoDrafts(scope: ChatThreadScope): PhotoDraftsApi {
  const [drafts, setDrafts] = useState<PhotoDraft[]>([])
  // Object URLs are a leak if nobody revokes them; this survives re-renders and
  // is drained on unmount.
  const objectUrls = useRef<string[]>([])
  // Callers pass an object literal (`{ clientId }`), which is a new identity
  // every render. Held in a ref so `add` stays stable and nobody has to
  // remember to useMemo at four call sites. Every thread is keyed on its id and
  // remounts when it changes, so the scope never changes under a live hook —
  // the effect keeps the ref honest anyway.
  const scopeRef = useRef(scope)
  useEffect(() => { scopeRef.current = scope }, [scope])

  useEffect(() => {
    const urls = objectUrls.current
    return () => { urls.forEach(u => URL.revokeObjectURL(u)) }
  }, [])

  const add = useCallback((incoming: FileList | File[]) => {
    const files = Array.from(incoming)
    if (files.length === 0) return

    setDrafts(prev => {
      const room = MAX_ATTACHMENTS_PER_MESSAGE - prev.length
      if (room <= 0) return prev
      const taking = files.slice(0, room)

      const started: PhotoDraft[] = taking.map(file => {
        const previewUrl = URL.createObjectURL(file)
        objectUrls.current.push(previewUrl)
        const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        void uploadOne(file, scopeRef.current).then(result => {
          setDrafts(cur =>
            cur.map(d =>
              d.key !== key ? d
                : result.ok
                  ? { ...d, status: 'ready', ref: result.ref, error: null }
                  : { ...d, status: 'failed', error: result.error },
            ),
          )
        })
        return { key, previewUrl, status: 'uploading', ref: null, error: null }
      })

      return [...prev, ...started]
    })
  }, [])

  const remove = useCallback((key: string) => {
    setDrafts(prev => prev.filter(d => d.key !== key))
  }, [])

  const clear = useCallback(() => setDrafts([]), [])

  return {
    drafts,
    refs: drafts.filter(d => d.ref).map(d => d.ref!),
    busy: drafts.some(d => d.status === 'uploading'),
    hasPhotos: drafts.some(d => d.status === 'ready'),
    add,
    remove,
    clear,
    remaining: MAX_ATTACHMENTS_PER_MESSAGE - drafts.length,
  }
}

type UploadResult = { ok: true; ref: AttachmentRef } | { ok: false; error: string }

/**
 * Compress, THEN upload. `compressImageFile` is not optional and not an
 * optimisation: a modern phone photo is 4–8 MB and the serverless request body
 * caps at ~4.5 MB, so an uncompressed one fails with an unexplained error. This
 * has bitten production before (see the memory note on upload body limits).
 */
async function uploadOne(file: File, scope: ChatThreadScope): Promise<UploadResult> {
  if (!file.type.startsWith('image/')) {
    return { ok: false, error: 'That is not a photo.' }
  }

  const compressed = await compressImageFile(file)

  // HEIC that this browser cannot decode comes back UNCOMPRESSED and unchanged,
  // which would upload fine and then render as a broken image for everyone on
  // Chrome or Android. Say so now instead.
  if (!(await isDisplayableImage(compressed))) {
    return { ok: false, error: 'That photo format cannot be shown. Try a JPEG or PNG.' }
  }
  if (compressed.size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: 'That photo is too large.' }
  }

  const size = await measure(compressed)

  const form = new FormData()
  form.append('file', compressed)
  form.append('target', 'chat')
  if ('clientId' in scope) form.append('clientId', scope.clientId)
  else form.append('groupId', scope.groupId)

  try {
    const res = await fetch('/api/upload/image', { method: 'POST', body: form })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return { ok: false, error: typeof data?.error === 'string' ? data.error : 'Upload failed.' }
    }
    return {
      ok: true,
      ref: {
        path: data.path as string,
        contentType: data.contentType,
        sizeBytes: data.sizeBytes as number,
        ...(size ?? {}),
      },
    }
  } catch {
    return { ok: false, error: 'Upload failed.' }
  }
}

/** Intrinsic pixels, so the bubble can reserve the right box before it loads. */
async function measure(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function') return null
  try {
    const bitmap = await createImageBitmap(file)
    const out = { width: bitmap.width, height: bitmap.height }
    bitmap.close?.()
    return out
  } catch {
    return null
  }
}

// ─── The composer half ──────────────────────────────────────────────────────

/**
 * The camera button, and the strip of pending thumbnails above the text box.
 *
 * Rendered as a sibling of the input rather than wrapping it, so each thread
 * keeps its own composer layout — a `variant` prop that reflows this two
 * different ways is exactly what AGENTS.md forbids.
 */
export function PhotoAttachButton({
  photos,
  disabled,
  accentClassName,
}: {
  photos: PhotoDraftsApi
  disabled?: boolean
  /** Hover tint, so the trainer side can stay blue and the client side accent. */
  accentClassName?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const full = photos.remaining <= 0

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        className="hidden"
        data-testid="chat-photo-input"
        onChange={e => {
          if (e.target.files) photos.add(e.target.files)
          // Reset so picking the SAME file twice in a row still fires change.
          e.target.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || full}
        aria-label={full ? `Up to ${MAX_ATTACHMENTS_PER_MESSAGE} photos` : 'Add a photo'}
        title={full ? `Up to ${MAX_ATTACHMENTS_PER_MESSAGE} photos` : 'Add a photo'}
        data-testid="chat-photo-button"
        className={`grid h-11 w-11 flex-shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-500 transition-colors disabled:opacity-40 ${accentClassName ?? 'hover:border-accent hover:text-accent'}`}
      >
        <ImagePlus className="h-4 w-4" strokeWidth={1.75} />
      </button>
    </>
  )
}

/** The pending photos, above the text box. Renders nothing when there are none. */
export function PhotoDraftStrip({ photos }: { photos: PhotoDraftsApi }) {
  if (photos.drafts.length === 0) return null
  return (
    <div className="mb-2 flex flex-wrap gap-2" data-testid="chat-photo-drafts">
      {photos.drafts.map(d => (
        <div key={d.key} className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- a blob: object URL has nothing for next/image to optimise */}
          <img
            src={d.previewUrl}
            alt=""
            className={`h-16 w-16 rounded-lg border border-slate-200 object-cover ${d.status === 'failed' ? 'opacity-40' : ''}`}
          />
          {d.status === 'uploading' && (
            <span className="absolute inset-0 grid place-items-center rounded-lg bg-white/60">
              <Loader2 className="h-4 w-4 animate-spin text-slate-600" strokeWidth={1.75} />
            </span>
          )}
          {d.status === 'failed' && (
            <span className="absolute inset-x-0 bottom-0 rounded-b-lg bg-rose-600 px-1 py-0.5 text-center text-[9px] font-semibold leading-tight text-white">
              Failed
            </span>
          )}
          <button
            type="button"
            onClick={() => photos.remove(d.key)}
            aria-label="Remove this photo"
            className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-slate-900 text-white shadow-sm"
          >
            <X className="h-3 w-3" strokeWidth={2.5} />
          </button>
        </div>
      ))}
      {photos.drafts.some(d => d.status === 'failed') && (
        <p className="w-full text-[11px] text-rose-600">
          {photos.drafts.find(d => d.status === 'failed')?.error}
        </p>
      )}
    </div>
  )
}

// ─── The bubble half ────────────────────────────────────────────────────────

/**
 * Photos inside a message bubble.
 *
 * One photo fills the bubble's width; two or more tile in a 2-up grid, which is
 * what every phone messenger does and what stops four pictures becoming a
 * scroll of their own. Each carries its own aspect ratio when we know it, so
 * the thread does not jump as they load.
 */
export function ChatPhotos({
  attachments,
  className,
}: {
  attachments: ChatAttachmentDto[]
  className?: string
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  if (attachments.length === 0) return null

  const single = attachments.length === 1

  return (
    <>
      <div
        data-testid="chat-photos"
        className={`grid gap-1 ${single ? 'grid-cols-1' : 'grid-cols-2'} ${className ?? ''}`}
      >
        {attachments.map((a, i) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setOpenIndex(i)}
            aria-label="Open this photo"
            data-testid="chat-photo-thumb"
            className="block overflow-hidden rounded-xl bg-slate-200"
            style={
              single && a.width && a.height
                // Cap a portrait photo so one picture can't own the whole screen.
                ? { aspectRatio: `${a.width} / ${Math.max(a.height, Math.round(a.width * 0.75))}` }
                : { aspectRatio: single ? '4 / 3' : '1 / 1' }
            }
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- served by an
                authorising route, not a public url; next/image would have to
                proxy an already-proxied private blob. */}
            <img
              src={a.url}
              alt="Photo in this conversation"
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </button>
        ))}
      </div>

      {openIndex !== null && (
        <PhotoLightbox
          attachments={attachments}
          index={openIndex}
          onIndex={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </>
  )
}

/**
 * The full picture.
 *
 * Portaled to <body> (the mobile header uses backdrop-blur, and a filtered
 * ancestor becomes the containing block for `position: fixed`), and it LOCKS
 * BODY SCROLL for as long as it is open — Karl's standing "never two scrollbars
 * on screen". There is no scrolling region inside it at all: one image, centred,
 * contained.
 */
function PhotoLightbox({
  attachments,
  index,
  onIndex,
  onClose,
}: {
  attachments: ChatAttachmentDto[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
}) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') onIndex(Math.min(index + 1, attachments.length - 1))
      if (e.key === 'ArrowLeft') onIndex(Math.max(index - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose, onIndex, index, attachments.length])

  const current = attachments[index]
  if (!current) return null

  return (
    <ModalPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Photo"
        data-testid="chat-photo-lightbox"
        className="fixed inset-0 z-[95] flex flex-col bg-slate-950"
      >
        <div
          className="flex flex-shrink-0 items-center justify-between px-2 pb-2"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-10 w-10 place-items-center rounded-full text-white/90 active:bg-white/10"
          >
            <X className="h-5 w-5" strokeWidth={1.75} />
          </button>
          {attachments.length > 1 && (
            <span className="pr-2 text-xs tabular-nums text-white/70">
              {index + 1} / {attachments.length}
            </span>
          )}
        </div>

        {/* One image, contained. Nothing here scrolls. */}
        <div className="flex min-h-0 flex-1 items-center justify-center p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- see ChatPhotos */}
          <img
            src={current.url}
            alt="Photo in this conversation"
            className="max-h-full max-w-full object-contain"
          />
        </div>

        {attachments.length > 1 && (
          <div
            className="flex flex-shrink-0 justify-center gap-2 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pt-2"
          >
            {attachments.map((a, i) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onIndex(i)}
                aria-label={`Photo ${i + 1}`}
                className={`h-2 w-2 rounded-full ${i === index ? 'bg-white' : 'bg-white/35'}`}
              />
            ))}
          </div>
        )}
      </div>
    </ModalPortal>
  )
}
