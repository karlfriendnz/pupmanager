import Link from 'next/link'
import { Download, ExternalLink, FileText } from 'lucide-react'

import { InstructionalVideoView } from '@/components/shared/instructional-video'
import { mediaLabel, type MediaItem } from '@/lib/library-media'

/**
 * Everything the trainer attached to an exercise, shown to a CLIENT, in the
 * trainer's order.
 *
 * The order is the point. It used to be structural — every clip, then every
 * photo, because they lived in different columns — so a trainer who wanted a
 * client to read the handout BEFORE watching the demo had no way to say so.
 * Now the list is the sequence, and this renders it straight through.
 *
 * Handouts appear here for the first time. The assign path copied the picture
 * and the clips but had nowhere to put a PDF, so a trainer who attached one
 * handed out homework that had quietly lost it.
 *
 * Server-safe — no client boundary of its own. InstructionalVideoView brings
 * one where a file is played inline.
 */
export function MediaList({ media, className = '' }: { media: MediaItem[]; className?: string }) {
  if (media.length === 0) return null

  // Named only when there is more than one thing: a single photo under the
  // instructions needs no caption saying it is a photo, but "Step 2 — reward"
  // is the whole point once there are three.
  const named = media.length > 1

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {media.map((row, i) => {
        const label = named ? mediaLabel(media, i) : null
        return (
          <div key={row.url}>
            {label && <p className="mb-1.5 text-sm font-semibold text-slate-700">{label}</p>}
            {/* Nothing says the same thing twice: an unnamed handout falls back
                to its filename for the heading, and the block below would then
                print that filename again directly under it. */}
            <MediaRow row={row} headed={label === (row.fileName ?? row.title)} />
          </div>
        )
      })}
    </div>
  )
}

function MediaRow({ row, headed = false }: { row: MediaItem; headed?: boolean }) {
  if (row.kind === 'video') return <InstructionalVideoView video={row} />

  if (row.kind === 'image') {
    return (
      // Deliberately not next/image: these are Blob URLs of unknown dimensions
      // and the homework page has always shown them this way.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={row.url} alt={row.title ?? ''} className="w-full rounded-2xl object-cover" />
    )
  }

  if (row.kind === 'document') {
    // Two actions, because a handout is a thing you read on the spot AND a
    // thing you keep — a client standing in a park wants the first, a client
    // at a desk printing it wants the second.
    return (
      <div className="rounded-2xl bg-slate-100 p-3.5">
        <a
          href={row.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-700"
        >
          <FileText className="h-4 w-4 flex-shrink-0" strokeWidth={1.75} />
          <span className="truncate underline underline-offset-2">
            {headed ? 'Open the handout' : (row.fileName ?? 'Open the handout')}
          </span>
        </a>
        <a
          href={row.url}
          download={row.fileName ?? undefined}
          className="mt-2 inline-flex items-center gap-1.5 pl-6 text-[13px] text-slate-500 underline underline-offset-2"
        >
          <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
          Download
        </a>
      </div>
    )
  }

  return (
    <Link
      href={row.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200"
    >
      <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
      {row.title?.trim() || 'Open the link'}
    </Link>
  )
}
