import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Repeat } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { TrainingLogPanel, type TrainingLogEntry } from './training-log-panel'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Homework' }

// One homework task, opened from the client home "This week" list. Shows what the
// trainer set — title, description, their instructional video and any photos —
// then hands off to <TrainingLogPanel> where the client logs their practice.
//
// Security: the task is looked up by { id, clientId: <active profile> }, both from
// the session + active-trainer cookie (getActiveClient validates the profile
// against the user's own). A task id that isn't this client's bounces to /home.

// Turn a trainer's YouTube/Vimeo link into an embeddable player URL. Anything we
// don't recognise falls back to a plain "Watch video" link (returns null here).
function toEmbedUrl(raw: string): string | null {
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

export default async function HomeworkDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params

  const active = await getActiveClient()
  if (!active) redirect('/login')

  const task = await prisma.trainingTask.findFirst({
    where: { id: taskId, clientId: active.clientId },
    select: {
      id: true, title: true, description: true, repetitions: true,
      videoUrl: true, trainerNote: true, imageUrls: true,
      completion: { select: { id: true } },
      logs: {
        orderBy: { loggedAt: 'desc' },
        select: { id: true, loggedAt: true, note: true, repsDone: true, rating: true, imageUrls: true, videoUrl: true, trainerComment: true },
      },
    },
  })
  if (!task) redirect('/home')

  const embedUrl = task.videoUrl ? toEmbedUrl(task.videoUrl) : null
  const images = Array.isArray(task.imageUrls) ? (task.imageUrls as string[]) : []
  const logs: TrainingLogEntry[] = task.logs.map(l => ({
    id: l.id,
    loggedAt: l.loggedAt.toISOString(),
    note: l.note,
    repsDone: l.repsDone,
    rating: l.rating,
    imageUrls: Array.isArray(l.imageUrls) ? (l.imageUrls as string[]) : [],
    videoUrl: l.videoUrl,
    trainerComment: l.trainerComment,
  }))

  return (
    <div className="px-4 md:px-8 pt-5 md:pt-8 pb-10 max-w-2xl mx-auto w-full">
      <Link
        href="/home"
        className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 mb-4"
      >
        <ChevronLeft className="h-4 w-4" />
        Home
      </Link>

      {/* What the trainer set */}
      <div className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-5 mb-5">
        <h1 className="font-display text-2xl font-bold text-slate-900">{task.title}</h1>
        {task.repetitions != null && task.repetitions > 0 && (
          <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-accent">
            <Repeat className="h-4 w-4" /> {task.repetitions} reps
          </p>
        )}
        {task.description && (
          <p className="mt-3 text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{task.description}</p>
        )}

        {task.trainerNote && (
          <div className="mt-4 rounded-2xl bg-accent-soft p-3.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-accent/80">From your trainer</p>
            <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{task.trainerNote}</p>
          </div>
        )}

        {/* Trainer's instructional video */}
        {task.videoUrl && (
          <div className="mt-4">
            {embedUrl ? (
              <div className="relative w-full overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: '16 / 9' }}>
                <iframe
                  src={embedUrl}
                  title="Instructional video"
                  className="absolute inset-0 h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <a
                href={task.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200"
              >
                Watch the video
              </a>
            )}
          </div>
        )}

        {/* Trainer-attached photos */}
        {images.length > 0 && (
          <div className="mt-4 grid grid-cols-3 gap-2">
            {images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt="" className="aspect-square w-full rounded-xl object-cover" />
            ))}
          </div>
        )}
      </div>

      {/* Log the training */}
      <TrainingLogPanel taskId={task.id} initialLogs={logs} initiallyDone={!!task.completion} />
    </div>
  )
}
