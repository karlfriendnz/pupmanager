'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { ChevronLeft, ChevronRight, Plus, MessageSquare, Video, MapPin, Calendar, LayoutGrid, List } from 'lucide-react'

// ─── Constants ────────────────────────────────────────────────────────────────

const START_HOUR = 7   // 7am
const END_HOUR   = 21  // 9pm
const PX_PER_HOUR = 64 // pixels per hour in the time grid

// ─── Types ────────────────────────────────────────────────────────────────────

const sessionSchema = z.object({
  title: z.string().min(2),
  scheduledAt: z.string(),
  durationMins: z.number().int().positive(),
  sessionType: z.enum(['IN_PERSON', 'VIRTUAL']),
  location: z.string().optional(),
  virtualLink: z.string().url().optional().or(z.literal('')),
  description: z.string().optional(),
})

type SessionFormData = z.infer<typeof sessionSchema>

interface Session {
  id: string
  title: string
  scheduledAt: string
  durationMins: number
  sessionType: string
  location: string | null
  virtualLink: string | null
  description: string | null
  dog: {
    name: string
    primaryFor: { id: string; user: { name: string | null; email: string } }[]
  } | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMondayOf(dateStr: string): Date {
  const d = new Date(dateStr)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function toDateStr(date: Date): string {
  return date.toISOString().split('T')[0]
}

function fmtShortDate(d: Date): string {
  return d.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric' })
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function fmtFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

// ─── Week grid session block ──────────────────────────────────────────────────

function SessionBlock({ session, onClick }: { session: Session; onClick?: () => void }) {
  const start = new Date(session.scheduledAt)
  const startMins = start.getHours() * 60 + start.getMinutes()
  const clampedStart = Math.max(startMins, START_HOUR * 60)
  const clampedEnd   = Math.min(startMins + session.durationMins, END_HOUR * 60)
  const top    = ((clampedStart - START_HOUR * 60) / 60) * PX_PER_HOUR
  const height = Math.max(((clampedEnd - clampedStart) / 60) * PX_PER_HOUR, 22)

  const client = session.dog?.primaryFor[0]?.user
  const label  = session.dog ? `${session.dog.name}${client ? ` · ${client.name ?? client.email}` : ''}` : session.title

  return (
    <div
      role="button"
      onClick={onClick}
      className="absolute left-0.5 right-0.5 rounded-lg bg-blue-500 text-white px-1.5 overflow-hidden cursor-pointer hover:bg-blue-600 transition-colors shadow-sm"
      style={{ top, height }}
      title={`${session.title} — ${fmtTime(session.scheduledAt)}, ${session.durationMins} min`}
    >
      <p className="text-[10px] font-semibold leading-tight truncate pt-0.5">{fmtTime(session.scheduledAt)}</p>
      {height > 30 && <p className="text-[10px] leading-tight truncate opacity-90">{label}</p>}
    </div>
  )
}

// ─── Week view ────────────────────────────────────────────────────────────────

function WeekGrid({
  weekDays,
  sessions,
  today,
  selectedDate,
  onDayClick,
  onSessionClick,
}: {
  weekDays: Date[]
  sessions: Session[]
  today: string
  selectedDate: string
  onDayClick: (dateStr: string) => void
  onSessionClick: (s: Session) => void
}) {
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)
  const totalHeight = hours.length * PX_PER_HOUR

  function sessionsForDay(d: Date) {
    const ds = toDateStr(d)
    return sessions.filter(s => s.scheduledAt.startsWith(ds))
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Day headers */}
      <div className="grid border-b border-slate-100" style={{ gridTemplateColumns: '44px repeat(7, 1fr)' }}>
        <div className="border-r border-slate-100" />
        {weekDays.map((d) => {
          const ds = toDateStr(d)
          const isToday = ds === today
          const isSelected = ds === selectedDate
          return (
            <button
              key={ds}
              onClick={() => onDayClick(ds)}
              className={`py-2.5 text-center text-xs font-medium border-r border-slate-100 last:border-r-0 transition-colors hover:bg-slate-50 ${
                isToday ? 'text-blue-600' : 'text-slate-600'
              }`}
            >
              <span className="block text-[10px] uppercase tracking-wide">{d.toLocaleDateString('en-NZ', { weekday: 'short' })}</span>
              <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full mt-0.5 text-sm font-semibold ${
                isToday ? 'bg-blue-600 text-white' : isSelected ? 'bg-slate-100 text-slate-900' : 'text-slate-800'
              }`}>
                {d.getDate()}
              </span>
            </button>
          )
        })}
      </div>

      {/* Time grid body */}
      <div className="overflow-y-auto max-h-[600px]">
        <div className="relative grid" style={{ gridTemplateColumns: '44px repeat(7, 1fr)', height: totalHeight }}>
          {/* Time labels */}
          <div className="relative border-r border-slate-100">
            {hours.map((h) => (
              <div
                key={h}
                className="absolute right-2 text-[10px] text-slate-400 leading-none"
                style={{ top: (h - START_HOUR) * PX_PER_HOUR - 5 }}
              >
                {h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {weekDays.map((d) => {
            const ds = toDateStr(d)
            const daySessions = sessionsForDay(d)
            const isToday = ds === today
            return (
              <div
                key={ds}
                className={`relative border-r border-slate-100 last:border-r-0 ${isToday ? 'bg-blue-50/30' : ''}`}
              >
                {/* Hour lines */}
                {hours.map((h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-slate-100"
                    style={{ top: (h - START_HOUR) * PX_PER_HOUR }}
                  />
                ))}
                {/* Session blocks */}
                {daySessions.map((s) => (
                  <SessionBlock key={s.id} session={s} onClick={() => onSessionClick(s)} />
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Session detail panel ─────────────────────────────────────────────────────

function SessionDetail({
  session,
  onClose,
  onDelete,
}: {
  session: Session
  onClose: () => void
  onDelete: (id: string) => void
}) {
  const client = session.dog?.primaryFor[0]?.user
  const clientId = session.dog?.primaryFor[0]?.id

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
      <Card className="relative z-50 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <CardBody className="pt-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-xs font-semibold text-blue-600">{fmtTime(session.scheduledAt)} · {session.durationMins} min</p>
              <h3 className="font-semibold text-slate-900 mt-0.5">{session.title}</h3>
              {session.dog && (
                <p className="text-sm text-slate-500">
                  🐕 {session.dog.name}{client ? ` · ${client.name ?? client.email}` : ''}
                </p>
              )}
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">✕</button>
          </div>

          {session.location && (
            <p className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
              <MapPin className="h-3.5 w-3.5" /> {session.location}
            </p>
          )}
          {session.virtualLink && (
            <a href={session.virtualLink} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline mb-1">
              <Video className="h-3.5 w-3.5" /> Join meeting
            </a>
          )}
          {session.description && (
            <p className="text-sm text-slate-600 mt-2">{session.description}</p>
          )}

          <div className="flex gap-2 mt-4 pt-3 border-t border-slate-100">
            {clientId && (
              <Link href={`/clients/${clientId}`}>
                <Button variant="secondary" size="sm">View client</Button>
              </Link>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-red-400 hover:text-red-600"
              onClick={() => { onDelete(session.id); onClose() }}
            >
              Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose} className="ml-auto">Close</Button>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ScheduleView({
  sessions,
  selectedDate,
  today,
  googleCalendarConnected,
}: {
  sessions: Session[]
  selectedDate: string
  today: string
  googleCalendarConnected: boolean
}) {
  const router = useRouter()
  const [view, setView] = useState<'day' | 'week'>('week')
  const [showForm, setShowForm] = useState(false)
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [error, setError] = useState<string | null>(null)

  const weekStart = getMondayOf(selectedDate)
  const weekDays  = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<SessionFormData>({
    resolver: zodResolver(sessionSchema),
    defaultValues: {
      sessionType: 'IN_PERSON',
      durationMins: 60,
      scheduledAt: `${selectedDate}T09:00`,
    },
  })

  function navigate(delta: number) {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + (view === 'week' ? delta * 7 : delta))
    router.push(`/schedule?date=${toDateStr(d)}`)
  }

  function goToDay(dateStr: string) {
    setView('day')
    router.push(`/schedule?date=${dateStr}`)
  }

  async function onAddSession(data: SessionFormData) {
    setError(null)
    const res = await fetch('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) { setError('Failed to create session.'); return }
    reset()
    setShowForm(false)
    router.refresh()
  }

  async function deleteSession(id: string) {
    await fetch(`/api/schedule/${id}`, { method: 'DELETE' })
    router.refresh()
  }

  const daySessions = sessions.filter(s => s.scheduledAt.startsWith(selectedDate))

  // Week label
  const weekLabel = weekStart.getMonth() === addDays(weekStart, 6).getMonth()
    ? weekStart.toLocaleDateString('en-NZ', { month: 'long', year: 'numeric' })
    : `${weekStart.toLocaleDateString('en-NZ', { month: 'short' })} – ${addDays(weekStart, 6).toLocaleDateString('en-NZ', { month: 'short', year: 'numeric' })}`

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-slate-900">Schedule</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {!googleCalendarConnected && (
            <a href="/api/google-calendar/connect">
              <Button variant="secondary" size="sm">
                <Calendar className="h-4 w-4" />
                Connect Google Calendar
              </Button>
            </a>
          )}
          {googleCalendarConnected && (
            <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-3 py-1.5 rounded-full border border-green-100">
              <Calendar className="h-3.5 w-3.5" /> Google Calendar synced
            </span>
          )}

          {/* Day/Week toggle */}
          <div className="flex p-1 bg-slate-100 rounded-xl gap-0.5">
            <button
              onClick={() => setView('day')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                view === 'day' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <List className="h-3.5 w-3.5" /> Day
            </button>
            <button
              onClick={() => setView('week')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                view === 'week' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Week
            </button>
          </div>

          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" /> Add session
          </Button>
        </div>
      </div>

      {/* Navigation bar */}
      <div className="flex items-center justify-between mb-5 bg-white rounded-2xl border border-slate-100 p-3 shadow-sm">
        <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-slate-50 text-slate-500">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="text-center">
          {view === 'week' ? (
            <>
              <p className="font-semibold text-slate-900">{weekLabel}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {weekStart.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })} – {addDays(weekStart, 6).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold text-slate-900">{fmtFullDate(selectedDate)}</p>
              {selectedDate === today && <p className="text-xs text-blue-600 font-medium">Today</p>}
            </>
          )}
        </div>
        <button onClick={() => navigate(1)} className="p-2 rounded-xl hover:bg-slate-50 text-slate-500">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Add session form */}
      {showForm && (
        <Card className="mb-6">
          <CardBody className="pt-5">
            <h2 className="font-semibold text-slate-900 mb-4">New session</h2>
            {error && <Alert variant="error" className="mb-3">{error}</Alert>}
            <form onSubmit={handleSubmit(onAddSession)} className="flex flex-col gap-3">
              <Input label="Session title" placeholder="Buddy — Foundation training" error={errors.title?.message} {...register('title')} />
              <div className="flex gap-3">
                <div className="flex flex-col gap-1.5 flex-[2]">
                  <label className="text-sm font-medium text-slate-700">Date & time</label>
                  <input
                    type="datetime-local"
                    className="h-12 rounded-xl border border-slate-200 bg-white px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    {...register('scheduledAt')}
                  />
                </div>
                <Input label="Duration (mins)" type="number" className="flex-1" {...register('durationMins')} />
              </div>
              <div className="flex gap-2">
                {(['IN_PERSON', 'VIRTUAL'] as const).map((t) => (
                  <label key={t} className="flex-1">
                    <input type="radio" value={t} className="sr-only peer" {...register('sessionType')} />
                    <div className="text-center py-2 rounded-xl border border-slate-200 text-sm cursor-pointer peer-checked:border-blue-500 peer-checked:bg-blue-50 peer-checked:text-blue-700 transition-colors">
                      {t === 'IN_PERSON' ? '📍 In person' : '💻 Virtual'}
                    </div>
                  </label>
                ))}
              </div>
              <Input label="Location / address" placeholder="123 Main St" {...register('location')} />
              <Input label="Virtual meeting link" type="url" placeholder="https://meet.google.com/..." {...register('virtualLink')} />
              <div className="flex gap-2 pt-1">
                <Button type="submit" loading={isSubmitting}>Save session</Button>
                <Button type="button" variant="ghost" onClick={() => { setShowForm(false); reset() }}>Cancel</Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {/* ── Week view ── */}
      {view === 'week' && (
        <>
          <WeekGrid
            weekDays={weekDays}
            sessions={sessions}
            today={today}
            selectedDate={selectedDate}
            onDayClick={goToDay}
            onSessionClick={setActiveSession}
          />
          {sessions.length === 0 && (
            <p className="text-center text-slate-400 text-sm mt-6">No sessions this week</p>
          )}
        </>
      )}

      {/* ── Day view ── */}
      {view === 'day' && (
        daySessions.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <Calendar className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No sessions scheduled for this day</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {daySessions.map((s) => {
              const client = s.dog?.primaryFor[0]?.user
              const clientId = s.dog?.primaryFor[0]?.id
              return (
                <Card key={s.id}>
                  <CardBody className="pt-4 pb-4">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <p className="text-xs font-semibold text-blue-600">
                          {fmtTime(s.scheduledAt)} · {s.durationMins} min
                        </p>
                        <p className="font-semibold text-slate-900 mt-0.5">{s.title}</p>
                        {s.dog && (
                          <p className="text-sm text-slate-500">
                            🐕 {s.dog.name}{client ? ` · ${client.name ?? client.email}` : ''}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        {client && (
                          <Link href={`/messages`} title="Message client">
                            <button className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-blue-600 transition-colors">
                              <MessageSquare className="h-4 w-4" />
                            </button>
                          </Link>
                        )}
                        {s.virtualLink && (
                          <a href={s.virtualLink} target="_blank" rel="noopener noreferrer" title="Join session">
                            <button className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-green-600 transition-colors">
                              <Video className="h-4 w-4" />
                            </button>
                          </a>
                        )}
                      </div>
                    </div>
                    {s.location && (
                      <p className="flex items-center gap-1.5 text-xs text-slate-500">
                        <MapPin className="h-3.5 w-3.5" /> {s.location}
                      </p>
                    )}
                    {s.description && (
                      <p className="text-sm text-slate-600 mt-2">{s.description}</p>
                    )}
                    <div className="flex gap-2 mt-3">
                      {clientId && (
                        <Link href={`/clients/${clientId}`}>
                          <Button variant="secondary" size="sm">View client</Button>
                        </Link>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-400 hover:text-red-600"
                        onClick={() => deleteSession(s.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              )
            })}
          </div>
        )
      )}

      {/* Session detail modal (week view tap) */}
      {activeSession && (
        <SessionDetail
          session={activeSession}
          onClose={() => setActiveSession(null)}
          onDelete={deleteSession}
        />
      )}
    </div>
  )
}
