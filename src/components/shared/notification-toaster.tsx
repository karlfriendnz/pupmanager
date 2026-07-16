'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, X, Dumbbell, MessageSquare, Inbox, CheckCircle2, UserPlus, type LucideIcon } from 'lucide-react'

// Global toast for realtime in-app notifications. Mounted in the trainer shell,
// it listens for the `pm:notification` window event that the notifications SSE
// hook fires on each fresh arrival (see useLiveNotificationCount) and pops a
// card top-right — over the top bar, on any page. Tapping it opens the linked
// page; each auto-dismisses after a few seconds.
interface Toast { id: string; title: string; body: string; link?: string | null; type?: string | null }

// A fitting icon per notification type, falling back to the bell.
const ICONS: Record<string, LucideIcon> = {
  CLIENT_LOGGED_TRAINING: Dumbbell,
  CLIENT_COMPLETED_TASKS: CheckCircle2,
  NEW_MESSAGE: MessageSquare,
  NEW_ENQUIRY: Inbox,
  NEW_CLIENT_INVITE_ACCEPTED: UserPlus,
}
const AUTO_DISMISS_MS = 6000

export function NotificationToaster() {
  const router = useRouter()
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: string) => setToasts(t => t.filter(x => x.id !== id)), [])

  useEffect(() => {
    function onNotif(e: Event) {
      const d = (e as CustomEvent).detail as Toast
      if (!d?.id) return
      // Newest on top; cap the stack so a burst can't fill the screen.
      setToasts(prev => [d, ...prev.filter(x => x.id !== d.id)].slice(0, 4))
      setTimeout(() => dismiss(d.id), AUTO_DISMISS_MS)
    }
    window.addEventListener('pm:notification', onNotif)
    return () => window.removeEventListener('pm:notification', onNotif)
  }, [dismiss])

  if (toasts.length === 0) return null

  return (
    <div
      className="fixed top-3 right-3 z-[100] flex w-[min(360px,calc(100vw-1.5rem))] flex-col gap-2"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      {toasts.map(t => {
        const Icon = (t.type && ICONS[t.type]) || Bell
        return (
          <div
            key={t.id}
            role={t.link ? 'button' : undefined}
            tabIndex={t.link ? 0 : undefined}
            onClick={() => { if (t.link) router.push(t.link); dismiss(t.id) }}
            className={`pm-toast-in flex items-start gap-3 rounded-2xl bg-white p-3.5 shadow-[0_8px_30px_rgba(15,31,36,0.16)] ring-1 ring-black/5 ${t.link ? 'cursor-pointer hover:bg-slate-50' : ''}`}
          >
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{t.title}</p>
              {t.body && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{t.body}</p>}
            </div>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); dismiss(t.id) }}
              aria-label="Dismiss"
              className="flex-shrink-0 text-slate-300 hover:text-slate-500"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )
      })}
      <style>{`
        @keyframes pm-toast-in {
          from { opacity: 0; transform: translateX(12px) scale(0.98); }
          to   { opacity: 1; transform: translateX(0) scale(1); }
        }
        .pm-toast-in { animation: pm-toast-in 180ms cubic-bezier(0.16,1,0.3,1); }
      `}</style>
    </div>
  )
}
