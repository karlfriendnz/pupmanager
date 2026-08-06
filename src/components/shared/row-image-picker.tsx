'use client'

import { X } from 'lucide-react'
import { ImageUploadButton } from '@/components/image-uploader'

/**
 * The picture on one settings ROW: a thumbnail when there is one, the upload
 * button when there isn't, and a way back to neither.
 *
 * NOT A NEW UPLOADER. It wraps `ImageUploadButton`, which is the one path every
 * image in this app takes: compressImageFile() first (a serverless request body
 * caps at ~4.5 MB and a 12 MP phone photo is over it — this has bitten
 * production), then POST to /api/upload/image, which authorises the trainer and
 * writes to Vercel Blob. All this adds is the 40px square and the clear.
 *
 * `value === null` means no picture, which everywhere this is used means "borrow
 * one" rather than "show nothing" — the caller decides that, not this control.
 */
export function RowImagePicker({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: string | null
  onChange: (url: string | null) => void
  /** What the picture is OF, for the screen-reader labels on both buttons. */
  label: string
  disabled?: boolean
}) {
  if (value) {
    return (
      <span className="relative inline-block shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={value} alt="" className="h-10 w-10 rounded-lg border border-slate-200 object-cover" />
        {!disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={`Remove the picture for ${label}`}
            title="Remove picture"
            // pm-corner-badge opts out of the global 44px minimum touch target,
            // which otherwise wins over h-5/w-5 and turns this into a disc
            // covering the picture. The class carries its own invisible 44px
            // hit area, so the thumb is no worse off.
            className="pm-corner-badge absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm active:text-rose-600"
          >
            <X className="h-3 w-3" strokeWidth={1.75} />
          </button>
        )}
      </span>
    )
  }
  if (disabled) return null
  return (
    <span className="shrink-0" aria-label={`Add a picture for ${label}`}>
      <ImageUploadButton onUploaded={urls => { if (urls[0]) onChange(urls[0]) }} />
    </span>
  )
}
