'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, X, Play, Video as VideoIcon } from 'lucide-react'
import { ModalPortal } from '@/components/shared/modal-portal'
import { SessionAttachments, type SessionAttachmentItem } from '@/components/session-attachments'
import { accentIconStyle } from './session-actions'

/**
 * "Add photos/video" as a row that opens a modal — the same shape as Log time
 * beside it (Karl: "should we do the same for photos and video?").
 *
 * Adding a photo is a moment, not a destination: the camera or file picker
 * takes over the screen anyway, and when it hands back you want to be where
 * you were. The sheet scrolls internally for a session with a lot on it, and
 * body scroll is LOCKED while it's open — two scrollbars is the standing rule.
 *
 * The full-screen viewer inside the list sits at z-[60], above this sheet's
 * z-50, so tapping a photo opens it over the top rather than under it.
 */
export function AddPhotosRow({
  sessionId,
  attachments,
  accent,
}: {
  sessionId: string
  attachments: SessionAttachmentItem[]
  accent?: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])

  function close() {
    setOpen(false)
    // What was added or deleted changes the count on the row behind it.
    router.refresh()
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
      >
        <Camera className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" style={accentIconStyle(accent)} strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">Add photos/video</span>
        {attachments.length > 0 && (
          <span className="flex-shrink-0 text-[13px] text-slate-500">{attachments.length} so far</span>
        )}
      </button>

      {/* What's on the session, without opening anything (Karl: "then we can
          display them on the main page as small thumbnails?"). A count tells
          you there are three photos; the thumbnails tell you WHICH three, which
          is the thing you actually wanted to know. Scrolls sideways rather than
          wrapping, so a session with twenty doesn't push the buttons below it
          off the screen — capped at 8 with the remainder shown as "+N", because
          this is a glance, not the gallery. */}
      {attachments.length > 0 && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3.5">
          {attachments.slice(0, 8).map(a => (
            <button
              key={a.id}
              type="button"
              onClick={() => setOpen(true)}
              className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
              aria-label={a.caption ?? (a.kind === 'VIDEO' ? 'Video' : 'Photo')}
            >
              {a.thumbnailUrl || a.kind === 'IMAGE' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={a.thumbnailUrl ?? a.url}
                  alt={a.caption ?? ''}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center">
                  <VideoIcon className="h-5 w-5 text-slate-400" strokeWidth={1.75} />
                </span>
              )}
              {a.kind === 'VIDEO' && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                  <Play className="h-4 w-4 text-white" fill="currentColor" strokeWidth={0} />
                </span>
              )}
            </button>
          ))}
          {attachments.length > 8 && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="h-14 w-14 flex-shrink-0 rounded-lg border border-slate-200 text-[13px] font-medium text-slate-500"
            >
              +{attachments.length - 8}
            </button>
          )}
        </div>
      )}

      {open && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4"
            onClick={close}
          >
            <div
              className="no-scrollbar max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-xl sm:max-w-md sm:rounded-3xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
                <h2 className="font-semibold text-slate-900">Photos &amp; video</h2>
                <button onClick={close} className="p-1 text-slate-400 hover:text-slate-600" aria-label="Close">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="p-5">
                <SessionAttachments sessionId={sessionId} initialAttachments={attachments} />
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  )
}
