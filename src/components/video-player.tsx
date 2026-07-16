'use client'

// Plays a video from a public Vercel Blob URL — the same store the trainer's
// session-notes videos live in. The URL carries Blob's random suffix so it's
// unguessable (no signing layer), and <video> streams it directly with
// range/seek support. Deliberately dumb: it just renders a <video>.
export function VideoPlayer({
  src,
  poster,
  className = '',
}: {
  src: string
  poster?: string | null
  className?: string
}) {
  return (
    <video
      controls
      preload="metadata"
      playsInline
      poster={poster ?? undefined}
      src={src}
      className={`w-full rounded-2xl bg-black ${className}`}
      style={{ aspectRatio: '16 / 9', objectFit: 'contain' }}
    >
      Your browser can’t play this video.
    </video>
  )
}
