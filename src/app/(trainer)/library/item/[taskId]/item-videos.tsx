'use client'

import { useState } from 'react'
import { Plus, X } from 'lucide-react'

import { SortableOfferingCard, SortableOfferingList } from '@/components/shared/offering-card'
import { VideoUploadButton } from '@/components/video-upload-button'
import { MAX_VIDEOS, sanitizeVideos, type InstructionalVideo } from '@/lib/instructional-videos'

/**
 * The clips on one library item, in the order a client watches them.
 *
 * An exercise is usually taught as several short steps — "approach", "mark",
 * "reward" — and one twelve-minute take is both worse teaching and a file
 * nobody on mobile data wants to load. So this is a list, it drags into order,
 * and each clip can carry the name of the step it shows.
 *
 * Titles are OPTIONAL and fall back to "Video 1". A trainer adding one clip
 * should not have to name it, and most won't.
 *
 * Order matters here in a way it doesn't elsewhere: it is the sequence the
 * client is taught in, so the drag is the feature, not a convenience.
 */
export function ItemVideos({
  videos,
  onChange,
  uploadUrl,
}: {
  videos: InstructionalVideo[]
  onChange: (next: InstructionalVideo[]) => void
  /** The route that authorises an upload for THIS item. */
  uploadUrl: string
}) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const full = videos.length >= MAX_VIDEOS

  function add(url: string, title?: string) {
    setError(null)
    if (full) { setError(`That's the limit — ${MAX_VIDEOS} clips on one item.`); return }
    // The same rules the server applies, so a link it would reject is refused
    // here with a sentence instead of silently vanishing on save.
    const [clean] = sanitizeVideos([{ url, title }])
    if (!clean) { setError('That needs to be a full http(s) link.'); return }
    if (videos.some(v => v.url === clean.url)) { setError('That clip is already on this item.'); return }
    onChange([...videos, clean])
    setDraft('')
  }

  function setTitle(index: number, title: string) {
    onChange(videos.map((v, i) => (i === index ? { ...v, title } : v)))
  }

  function remove(index: number) {
    setError(null)
    onChange(videos.filter((_, i) => i !== index))
  }

  function reorder(urls: string[]) {
    onChange(urls.map(u => videos.find(v => v.url === u)!).filter(Boolean))
  }

  return (
    <div>
      <p className="text-[13px] font-medium text-slate-700">Videos</p>

      {videos.length > 0 && (
        // Keyed by URL, which is what makes a row identifiable to dnd-kit: an
        // index would renumber on every drag and the wrong clip would move.
        <SortableOfferingList ids={videos.map(v => v.url)} onReorder={reorder}>
          <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white [&>*+*]:border-t [&>*+*]:border-slate-200">
            {videos.map((video, i) => (
              <SortableOfferingCard key={video.url} id={video.url}>
                {handle => (
                  <div className="flex items-center gap-1 px-1.5 py-2">
                    {handle}
                    <div className="min-w-0 flex-1">
                      <input
                        value={video.title ?? ''}
                        onChange={e => setTitle(i, e.target.value)}
                        placeholder={`Video ${i + 1}`}
                        aria-label={`Name for video ${i + 1}`}
                        className="h-8 w-full rounded-lg border border-transparent bg-transparent px-1.5 text-sm text-slate-900 hover:border-slate-200 focus:border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-300"
                      />
                      {/* The link itself, quietly — enough to tell two clips
                          apart when neither has been named. */}
                      <p className="truncate px-1.5 text-[11px] text-slate-400" title={video.url}>{video.url}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      aria-label={`Remove video ${i + 1}`}
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

      {/* Two ways in, both named, because trainers have both: a YouTube link
          they already share, and a clip they filmed with nowhere to host it. */}
      <div className="mt-2 flex items-center gap-2">
        <input
          type="url"
          value={draft}
          onChange={e => { setDraft(e.target.value); setError(null) }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(draft.trim()) } }}
          placeholder="Paste a YouTube link"
          aria-label="Video link"
          disabled={full}
          className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:bg-slate-50"
        />
        <button
          type="button"
          onClick={() => add(draft.trim())}
          disabled={!draft.trim() || full}
          aria-label="Add this video"
          className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" strokeWidth={2.25} />
        </button>
      </div>

      {!full && (
        <VideoUploadButton
          uploadUrl={uploadUrl}
          onUploaded={url => add(url)}
          label="or upload a clip"
          // Long clips are slow to send and slow for a client to load on mobile
          // data — and an exercise is easier to follow as a few short steps
          // anyway, which is what the list above is for.
          hint="Recommended for clips under 5 minutes"
          className="mt-2"
        />
      )}

      {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}
    </div>
  )
}
