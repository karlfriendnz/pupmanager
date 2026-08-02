import { VideoPlayer } from '@/components/video-player'
import { videoLabel, type InstructionalVideo } from '@/lib/instructional-videos'

// How a trainer's instructional clip is shown to a client.
//
// Lifted out of the homework page when an exercise became a LIST of clips: the
// three-way choice below is the same for every one of them, and a second copy
// of it is a second place for a YouTube link to stop embedding.
//
// Server-safe — no client boundary of its own. VideoPlayer brings one where the
// file is played inline.

/**
 * Turn a YouTube/Vimeo link into an embeddable player URL. Anything we don't
 * recognise returns null and falls back to a plain "Watch the video" link.
 */
export function toEmbedUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') return `https://www.youtube.com/embed/${u.pathname.slice(1)}`
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const v = u.searchParams.get('v')
      if (v) return `https://www.youtube.com/embed/${v}`
      if (u.pathname.startsWith('/embed/')) return raw
    }
    if (host === 'vimeo.com') {
      const id = u.pathname.split('/').filter(Boolean)[0]
      if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`
    }
    return null
  } catch {
    return null
  }
}

/**
 * A file WE host (or any direct video file) plays inline; a YouTube/Vimeo link
 * needs their iframe. Decided on the URL rather than on how it was created, so
 * a trainer who pasted a link straight to an .mp4 gets a player too.
 */
export function isDirectVideo(url: string): boolean {
  return /\.(mp4|webm|mov|m4v|ogg)(\?|$)/i.test(url)
    || /\.public\.blob\.vercel-storage\.com\//i.test(url)
}

export function InstructionalVideoView({ video }: { video: InstructionalVideo }) {
  const embed = toEmbedUrl(video.url)

  if (isDirectVideo(video.url)) {
    // A clip the trainer uploaded has no embed URL, so it used to fall through
    // to a bare link that navigated away from the exercise. Play it in place.
    return <VideoPlayer src={video.url} />
  }
  if (embed) {
    return (
      <div className="relative w-full overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: '16 / 9' }}>
        <iframe
          src={embed}
          title={video.title || 'Instructional video'}
          className="absolute inset-0 h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    )
  }
  return (
    <a
      href={video.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200"
    >
      Watch the video
    </a>
  )
}

/**
 * Every clip on one exercise, in the order the trainer put them in.
 *
 * Each is titled only when there is more than one — a single clip sitting under
 * the instructions needs no label saying it is a video, but "Step 2 — reward"
 * is the whole point once there are three.
 */
export function InstructionalVideoList({ videos }: { videos: InstructionalVideo[] }) {
  if (videos.length === 0) return null
  return (
    <div className="mt-4 flex flex-col gap-4">
      {videos.map((video, i) => (
        <div key={video.url}>
          {videos.length > 1 && (
            <p className="mb-1.5 text-sm font-semibold text-slate-700">{videoLabel(video, i)}</p>
          )}
          <InstructionalVideoView video={video} />
        </div>
      ))}
    </div>
  )
}
