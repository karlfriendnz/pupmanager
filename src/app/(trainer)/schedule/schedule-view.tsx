'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import {
  ChevronLeft, ChevronRight, Plus, Calendar, LayoutGrid, List,
  Clock, Trash2, X, Settings,
} from 'lucide-react'

// ─── Constants ────────────────────────────────────────────────────────────────

const START_HOUR    = 7    // 7am
const END_HOUR      = 21   // 9pm
const PX_PER_HOUR   = 72   // pixels per hour
const SNAP_MINS     = 15   // drag snaps to 15-min intervals
const DRAG_THRESHOLD = 6   // px moved before considered a drag

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const sessionSchema = z.object({
  title: z.string().min(2, 'Title required'),
  scheduledAt: z.string(),
  durationMins: z.number().int().positive(),
  sessionType: z.enum(['IN_PERSON', 'VIRTUAL']),
  location: z.string().optional(),
  virtualLink: z.string().url().optional().or(z.literal('')),
  description: z.string().optional(),
})

const availSchema = z.object({
  title: z.string().optional(),
  type: z.enum(['repeating', 'oneoff']),
  dayOfWeek: z.number().int().min(1).max(7).optional(),
  date: z.string().optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
})

type SessionForm    = z.infer<typeof sessionSchema>
type AvailForm      = z.infer<typeof availSchema>

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface AvailSlot {
  id: string
  title: string | null
  dayOfWeek: number | null   // 1=Mon…7=Sun
  date: string | null        // YYYY-MM-DD for one-off
  startTime: string
  endTime: string
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

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

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-NZ', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function fmtFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-NZ', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

// Convert time offset in grid to HH:MM
function yToTime(y: number): string {
  const totalMins = START_HOUR * 60 + (y / PX_PER_HOUR) * 60
  const snapped   = Math.round(totalMins / SNAP_MINS) * SNAP_MINS
  const clamped   = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60 - 30, snapped))
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// Top offset + height (in px) for a time range
function timeToY(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number)
  return ((h * 60 + m - START_HOUR * 60) / 60) * PX_PER_HOUR
}

function sessionTop(iso: string): number {
  const d = new Date(iso)
  const mins = d.getHours() * 60 + d.getMinutes()
  return Math.max(0, ((mins - START_HOUR * 60) / 60) * PX_PER_HOUR)
}

function sessionHeight(durationMins: number): number {
  return Math.max((durationMins / 60) * PX_PER_HOUR, 24)
}

// ─── Availability strip ───────────────────────────────────────────────────────

function AvailStrip({ slot, dayDate, onDelete }: {
  slot: AvailSlot
  dayDate: Date
  onDelete: (id: string) => void
}) {
  // Check if this slot applies to this day
  const dateStr = toDateStr(dayDate)
  // dayOfWeek in our schema: 1=Mon…7=Sun; JS getDay: 0=Sun,1=Mon…6=Sat
  const jsDay  = dayDate.getDay()
  const slotDay = jsDay === 0 ? 7 : jsDay // convert to 1=Mon…7=Sun
  const applies = slot.dayOfWeek != null
    ? slot.dayOfWeek === slotDay
    : slot.date === dateStr

  if (!applies) return null

  const top    = timeToY(slot.startTime)
  const height = timeToY(slot.endTime) - top

  return (
    <div
      className="absolute left-0 right-0 bg-emerald-100 border-l-2 border-emerald-400 opacity-70 group"
      style={{ top, height: Math.max(height, 8) }}
      title={slot.title ?? `Available ${slot.startTime}–${slot.endTime}`}
    >
      <button
        onClick={() => onDelete(slot.id)}
        className="absolute top-0.5 right-0.5 hidden group-hover:flex h-4 w-4 items-center justify-center rounded bg-white/80 text-emerald-700 hover:bg-red-50 hover:text-red-500"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  )
}

// ─── Session block ────────────────────────────────────────────────────────────

function SessionBlock({
  session,
  isDragging,
  dragTop,
  onPointerDown,
  onClick,
}: {
  session: Session
  isDragging: boolean
  dragTop: number | null
  onPointerDown: (e: React.PointerEvent) => void
  onClick: () => void
}) {
  const top    = isDragging && dragTop !== null ? dragTop : sessionTop(session.scheduledAt)
  const height = sessionHeight(session.durationMins)
  const client = session.dog?.primaryFor[0]?.user

  return (
    <div
      className={`absolute left-0.5 right-0.5 rounded-lg px-2 overflow-hidden select-none touch-none z-10 transition-shadow ${
        isDragging
          ? 'bg-blue-600 shadow-2xl opacity-90 cursor-grabbing z-20'
          : 'bg-blue-500 hover:bg-blue-600 cursor-grab shadow-sm hover:shadow-md'
      }`}
      style={{ top, height }}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      <p className="text-[10px] font-semibold text-white leading-tight pt-1 truncate">
        {fmtTime(session.scheduledAt)}
      </p>
      {height > 34 && (
        <p className="text-[10px] text-blue-100 leading-tight truncate">{session.title}</p>
      )}
      {height > 50 && client && (
        <p className="text-[10px] text-blue-100 leading-tight truncate opacity-80">
          {session.dog?.name} · {client.name ?? client.email}
        </p>
      )}
    </div>
  )
}

// ─── Week grid ────────────────────────────────────────────────────────────────

function WeekGrid({
  weekDays,
  sessions,
  availSlots,
  today,
  selectedDate,
  onSlotClick,
  onSessionClick,
  onSessionDrop,
  onDeleteAvail,
}: {
  weekDays: Date[]
  sessions: Session[]
  availSlots: AvailSlot[]
  today: string
  selectedDate: string
  onSlotClick: (dateStr: string, time: string) => void
  onSessionClick: (s: Session) => void
  onSessionDrop: (sessionId: string, newIso: string) => void
  onDeleteAvail: (id: string) => void
}) {
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)
  const gridRef = useRef<HTMLDivElement>(null)

  // ── Drag state ──────────────────────────────────────────────────────────────
  const [dragging, setDragging] = useState<{
    session: Session
    dayIndex: number
    offsetY: number    // pointer Y within the block when drag started
    currentTop: number
    moved: boolean
  } | null>(null)

  const handlePointerDown = useCallback((e: React.PointerEvent, session: Session, dayIndex: number) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setDragging({
      session,
      dayIndex,
      offsetY: e.clientY - rect.top,
      currentTop: sessionTop(session.scheduledAt),
      moved: false,
    })
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !gridRef.current) return
    e.preventDefault()

    // Find the day column el for this day index
    const cols = gridRef.current.querySelectorAll('[data-day-col]')
    const col  = cols[dragging.dayIndex] as HTMLElement | undefined
    if (!col) return

    const colRect = col.getBoundingClientRect()
    const rawY    = e.clientY - colRect.top - dragging.offsetY
    const snapped = Math.round(rawY / (PX_PER_HOUR / (60 / SNAP_MINS))) * (PX_PER_HOUR / (60 / SNAP_MINS))
    const clamped = Math.max(0, Math.min(snapped, (END_HOUR - START_HOUR - dragging.session.durationMins / 60) * PX_PER_HOUR))

    setDragging(prev => prev ? { ...prev, currentTop: clamped, moved: true } : null)
  }, [dragging])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging) return
    if (dragging.moved) {
      // Build new ISO string
      const day = weekDays[dragging.dayIndex]
      const timeStr = yToTime(dragging.currentTop)
      const [h, m]  = timeStr.split(':').map(Number)
      const newDate  = new Date(day)
      newDate.setHours(h, m, 0, 0)
      onSessionDrop(dragging.session.id, newDate.toISOString())
    } else {
      onSessionClick(dragging.session)
    }
    setDragging(null)
  }, [dragging, weekDays, onSessionClick, onSessionDrop])

  function handleColumnClick(e: React.MouseEvent, dayDate: Date, dayIndex: number) {
    // Ignore if clicking on a session block
    if ((e.target as HTMLElement).closest('[data-session]')) return
    if (!gridRef.current) return
    const cols = gridRef.current.querySelectorAll('[data-day-col]')
    const col  = cols[dayIndex] as HTMLElement | undefined
    if (!col) return
    const rect = col.getBoundingClientRect()
    const y    = e.clientY - rect.top
    const time = yToTime(y)
    onSlotClick(toDateStr(dayDate), time)
  }

  const totalHeight = (END_HOUR - START_HOUR) * PX_PER_HOUR

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Day headers */}
      <div className="grid border-b border-slate-100" style={{ gridTemplateColumns: '48px repeat(7, 1fr)' }}>
        <div className="border-r border-slate-100" />
        {weekDays.map((d) => {
          const ds = toDateStr(d)
          const isToday = ds === today
          const isSelected = ds === selectedDate
          return (
            <div key={ds} className={`py-2.5 text-center border-r border-slate-100 last:border-r-0 ${isToday ? 'bg-blue-50/50' : ''}`}>
              <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-medium">
                {d.toLocaleDateString('en-NZ', { weekday: 'short' })}
              </span>
              <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full mt-0.5 text-sm font-bold ${
                isToday ? 'bg-blue-600 text-white' : isSelected ? 'bg-slate-100 text-slate-900' : 'text-slate-800'
              }`}>
                {d.getDate()}
              </span>
            </div>
          )
        })}
      </div>

      {/* Grid body */}
      <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
        <div
          ref={gridRef}
          className="relative grid"
          style={{ gridTemplateColumns: '48px repeat(7, 1fr)', height: totalHeight }}
        >
          {/* Time labels */}
          <div className="relative border-r border-slate-100 pointer-events-none">
            {hours.map((h) => (
              <div
                key={h}
                className="absolute right-2 text-[10px] text-slate-400 leading-none"
                style={{ top: (h - START_HOUR) * PX_PER_HOUR - 6 }}
              >
                {h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {weekDays.map((d, dayIndex) => {
            const ds         = toDateStr(d)
            const isToday    = ds === today
            const daySessions = sessions.filter(s => s.scheduledAt.startsWith(ds))

            return (
              <div
                key={ds}
                data-day-col={dayIndex}
                className={`relative border-r border-slate-100 last:border-r-0 cursor-crosshair ${isToday ? 'bg-blue-50/20' : ''}`}
                onClick={(e) => handleColumnClick(e, d, dayIndex)}
                onPointerMove={dragging?.dayIndex === dayIndex ? handlePointerMove : undefined}
                onPointerUp={dragging ? handlePointerUp : undefined}
              >
                {/* Hour lines */}
                {hours.map((h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-slate-100 pointer-events-none"
                    style={{ top: (h - START_HOUR) * PX_PER_HOUR }}
                  />
                ))}
                {/* Half-hour lines */}
                {hours.map((h) => (
                  <div
                    key={`${h}half`}
                    className="absolute left-0 right-0 border-t border-slate-50 pointer-events-none"
                    style={{ top: (h - START_HOUR) * PX_PER_HOUR + PX_PER_HOUR / 2 }}
                  />
                ))}

                {/* Availability strips */}
                {availSlots.map((slot) => (
                  <AvailStrip key={slot.id} slot={slot} dayDate={d} onDelete={onDeleteAvail} />
                ))}

                {/* Sessions */}
                {daySessions.map((s) => {
                  const isDragging = dragging?.session.id === s.id
                  return (
                    <div key={s.id} data-session>
                      <SessionBlock
                        session={s}
                        isDragging={isDragging}
                        dragTop={isDragging ? dragging!.currentTop : null}
                        onPointerDown={(e) => handlePointerDown(e, s, dayIndex)}
                        onClick={() => { /* handled in pointerUp */ }}
                      />
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Day list view ────────────────────────────────────────────────────────────

function DayList({
  sessions,
  onDelete,
  onNavigateClient,
}: {
  sessions: Session[]
  onDelete: (id: string) => void
  onNavigateClient: (clientId: string) => void
}) {
  if (sessions.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <Calendar className="h-12 w-12 mx-auto mb-3 opacity-30" />
        <p>No sessions scheduled for this day</p>
        <p className="text-xs mt-1">Click a time slot in week view, or use "Add session"</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {sessions.map((s) => {
        const client   = s.dog?.primaryFor[0]?.user
        const clientId = s.dog?.primaryFor[0]?.id
        return (
          <Card key={s.id} className="cursor-pointer hover:border-blue-200 transition-all" onClick={() => clientId && onNavigateClient(clientId)}>
            <CardBody className="pt-4 pb-4">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 text-center min-w-[48px]">
                  <p className="text-xs font-bold text-blue-600">{fmtTime(s.scheduledAt)}</p>
                  <p className="text-xs text-slate-400">{s.durationMins}m</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900">{s.title}</p>
                  {s.dog && (
                    <p className="text-sm text-slate-500 mt-0.5">
                      🐕 {s.dog.name}{client ? ` · ${client.name ?? client.email}` : ''}
                    </p>
                  )}
                  {s.location && (
                    <p className="text-xs text-slate-400 mt-1">{s.location}</p>
                  )}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(s.id) }}
                  className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </CardBody>
          </Card>
        )
      })}
    </div>
  )
}

// ─── Availability manager ─────────────────────────────────────────────────────

const DOW_LABELS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function AvailabilityManager({
  slots,
  onAdd,
  onDelete,
  onClose,
}: {
  slots: AvailSlot[]
  onAdd: (slot: AvailSlot) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, watch, reset, formState: { errors, isSubmitting } } = useForm<AvailForm>({
    resolver: zodResolver(availSchema),
    defaultValues: { type: 'repeating', startTime: '09:00', endTime: '17:00' },
  })
  const type = watch('type')

  async function onSubmit(data: AvailForm) {
    setError(null)
    const res = await fetch('/api/availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: data.title || undefined,
        dayOfWeek: data.type === 'repeating' ? data.dayOfWeek : undefined,
        date: data.type === 'oneoff' ? data.date : undefined,
        startTime: data.startTime,
        endTime: data.endTime,
      }),
    })
    if (!res.ok) { setError('Failed to save.'); return }
    const slot = await res.json()
    onAdd(slot)
    reset({ type: 'repeating', startTime: '09:00', endTime: '17:00' })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative z-50 bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Availability slots</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-5">
          {/* Existing slots */}
          {slots.length > 0 && (
            <div className="mb-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Your slots</p>
              <div className="flex flex-col gap-2">
                {slots.map(s => (
                  <div key={s.id} className="flex items-center justify-between p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        {s.dayOfWeek != null ? DOW_LABELS[s.dayOfWeek] : s.date} · {s.startTime}–{s.endTime}
                      </p>
                      {s.title && <p className="text-xs text-slate-500">{s.title}</p>}
                      <p className="text-xs text-emerald-600">{s.dayOfWeek != null ? 'Repeating' : 'One-off'}</p>
                    </div>
                    <button onClick={() => onDelete(s.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add slot form */}
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Add slot</p>
          {error && <Alert variant="error" className="mb-3">{error}</Alert>}
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
            <Input label="Label (optional)" placeholder="e.g. Morning availability" {...register('title')} />

            <div className="flex gap-2">
              {(['repeating', 'oneoff'] as const).map(t => (
                <label key={t} className="flex-1">
                  <input type="radio" value={t} className="sr-only peer" {...register('type')} />
                  <div className="text-center py-2 rounded-xl border border-slate-200 text-sm cursor-pointer peer-checked:border-blue-500 peer-checked:bg-blue-50 peer-checked:text-blue-700 transition-colors">
                    {t === 'repeating' ? '🔁 Repeating' : '📅 One-off'}
                  </div>
                </label>
              ))}
            </div>

            {type === 'repeating' ? (
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1.5">Day of week</label>
                <select {...register('dayOfWeek', { valueAsNumber: true })} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {DOW_LABELS.slice(1).map((label, i) => (
                    <option key={i + 1} value={i + 1} >{label}</option>
                  ))}
                </select>
                {errors.dayOfWeek && <p className="text-xs text-red-500 mt-1">{errors.dayOfWeek.message}</p>}
              </div>
            ) : (
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1.5">Date</label>
                <input type="date" {...register('date')} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            )}

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-sm font-medium text-slate-700 block mb-1.5">Start time</label>
                <input type="time" {...register('startTime')} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex-1">
                <label className="text-sm font-medium text-slate-700 block mb-1.5">End time</label>
                <input type="time" {...register('endTime')} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            <Button type="submit" loading={isSubmitting}>Add slot</Button>
          </form>
        </div>
      </div>
    </div>
  )
}

// ─── Add session modal ────────────────────────────────────────────────────────

function AddSessionModal({
  defaultDateTime,
  onSave,
  onClose,
}: {
  defaultDateTime: string
  onSave: (data: SessionForm) => Promise<void>
  onClose: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<SessionForm>({
    resolver: zodResolver(sessionSchema),
    defaultValues: { sessionType: 'IN_PERSON', durationMins: 60, scheduledAt: defaultDateTime },
  })

  async function onSubmit(data: SessionForm) {
    setError(null)
    try { await onSave(data) } catch { setError('Failed to save.') }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
      <div className="relative z-50 bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">New session</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5">
          {error && <Alert variant="error" className="mb-3">{error}</Alert>}
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
            <Input label="Session title" placeholder="Buddy — Foundation training" error={errors.title?.message} {...register('title')} />
            <div className="flex gap-3">
              <div className="flex flex-col gap-1.5 flex-[2]">
                <label className="text-sm font-medium text-slate-700">Date & time</label>
                <input type="datetime-local" className="h-12 rounded-xl border border-slate-200 bg-white px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" {...register('scheduledAt')} />
              </div>
              <Input label="Duration (mins)" type="number" className="flex-1" {...register('durationMins', { valueAsNumber: true })} />
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
            <div className="flex gap-2 pt-1">
              <Button type="submit" loading={isSubmitting}>Save session</Button>
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ScheduleView({
  sessions: initialSessions,
  availabilitySlots: initialAvailSlots,
  selectedDate,
  today,
  googleCalendarConnected,
}: {
  sessions: Session[]
  availabilitySlots: AvailSlot[]
  selectedDate: string
  today: string
  googleCalendarConnected: boolean
}) {
  const router = useRouter()

  // Default: week on desktop, day on mobile
  const [view, setView] = useState<'day' | 'week'>('week')
  useEffect(() => {
    if (window.innerWidth < 768) setView('day')
  }, [])

  const [sessions, setSessions]         = useState(initialSessions)
  const [availSlots, setAvailSlots]     = useState(initialAvailSlots)
  const [showAvail, setShowAvail]       = useState(false)
  const [addModal, setAddModal]         = useState<string | null>(null) // datetime-local string

  // Keep sessions in sync with server data on refresh
  useEffect(() => { setSessions(initialSessions) }, [initialSessions])
  useEffect(() => { setAvailSlots(initialAvailSlots) }, [initialAvailSlots])

  const weekStart = getMondayOf(selectedDate)
  const weekDays  = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const weekLabel = (() => {
    const end = addDays(weekStart, 6)
    return weekStart.getMonth() === end.getMonth()
      ? weekStart.toLocaleDateString('en-NZ', { month: 'long', year: 'numeric' })
      : `${weekStart.toLocaleDateString('en-NZ', { month: 'short' })} – ${end.toLocaleDateString('en-NZ', { month: 'short', year: 'numeric' })}`
  })()

  function navigate(delta: number) {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + (view === 'week' ? delta * 7 : delta))
    router.push(`/schedule?date=${toDateStr(d)}`)
  }

  function openAddModal(dateStr: string, time: string) {
    setAddModal(`${dateStr}T${time}`)
  }

  async function handleAddSession(data: SessionForm) {
    const res = await fetch('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error('Failed')
    const newSession = await res.json()
    setSessions(prev => [...prev, { ...newSession, scheduledAt: new Date(newSession.scheduledAt).toISOString() }])
    setAddModal(null)
  }

  async function handleDeleteSession(id: string) {
    await fetch(`/api/schedule/${id}`, { method: 'DELETE' })
    setSessions(prev => prev.filter(s => s.id !== id))
  }

  async function handleSessionDrop(sessionId: string, newIso: string) {
    // Optimistic update
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, scheduledAt: newIso } : s))
    const res = await fetch(`/api/schedule/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduledAt: newIso }),
    })
    if (!res.ok) {
      // Roll back on failure
      router.refresh()
    }
  }

  function handleSessionClick(s: Session) {
    const clientId = s.dog?.primaryFor[0]?.id
    if (clientId) router.push(`/clients/${clientId}`)
  }

  async function handleAddAvail(slot: AvailSlot) {
    setAvailSlots(prev => [...prev, slot])
  }

  async function handleDeleteAvail(id: string) {
    await fetch(`/api/availability/${id}`, { method: 'DELETE' })
    setAvailSlots(prev => prev.filter(s => s.id !== id))
  }

  const daySessions = sessions.filter(s => s.scheduledAt.startsWith(selectedDate))

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 md:px-6 py-4 gap-3 flex-wrap border-b border-slate-100 bg-white">
        <h1 className="text-xl font-bold text-slate-900">Schedule</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {!googleCalendarConnected ? (
            <a href="/api/google-calendar/connect">
              <Button variant="secondary" size="sm">
                <Calendar className="h-4 w-4" /> Connect Google Calendar
              </Button>
            </a>
          ) : (
            <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2.5 py-1.5 rounded-full border border-green-100">
              <Calendar className="h-3.5 w-3.5" /> Google Calendar synced
            </span>
          )}

          {/* Availability button */}
          <Button variant="secondary" size="sm" onClick={() => setShowAvail(true)}>
            <Settings className="h-4 w-4" /> Availability
          </Button>

          {/* Day/Week toggle */}
          <div className="flex p-0.5 bg-slate-100 rounded-xl gap-0.5">
            <button
              onClick={() => setView('day')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${view === 'day' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              <List className="h-3.5 w-3.5" /> Day
            </button>
            <button
              onClick={() => setView('week')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${view === 'week' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Week
            </button>
          </div>

          <Button size="sm" onClick={() => openAddModal(selectedDate, '09:00')}>
            <Plus className="h-4 w-4" /> Add session
          </Button>
        </div>
      </div>

      {/* ── Navigation bar ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 md:px-6 py-3 bg-white border-b border-slate-100">
        <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="text-center">
          {view === 'week' ? (
            <>
              <p className="font-semibold text-slate-900 text-sm">{weekLabel}</p>
              <p className="text-xs text-slate-400">
                {weekStart.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })} – {addDays(weekStart, 6).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold text-slate-900 text-sm">{fmtFullDate(selectedDate)}</p>
              {selectedDate === today && <p className="text-xs text-blue-600 font-medium">Today</p>}
            </>
          )}
        </div>
        <button onClick={() => navigate(1)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* ── Hint bar (week view only) ────────────────────────────────────────── */}
      {view === 'week' && (
        <div className="flex items-center gap-4 px-4 md:px-6 py-1.5 text-[10px] text-slate-400 bg-slate-50 border-b border-slate-100">
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Click empty slot to add</span>
          <span>· Drag sessions to reschedule</span>
          <span>· Click session to open client</span>
          <span className="flex items-center gap-1 ml-auto"><span className="w-3 h-3 rounded-sm bg-emerald-200 inline-block" /> Availability</span>
        </div>
      )}

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden px-4 md:px-6 py-4">
        {view === 'week' ? (
          <WeekGrid
            weekDays={weekDays}
            sessions={sessions}
            availSlots={availSlots}
            today={today}
            selectedDate={selectedDate}
            onSlotClick={openAddModal}
            onSessionClick={handleSessionClick}
            onSessionDrop={handleSessionDrop}
            onDeleteAvail={handleDeleteAvail}
          />
        ) : (
          <DayList
            sessions={daySessions}
            onDelete={handleDeleteSession}
            onNavigateClient={(clientId) => router.push(`/clients/${clientId}`)}
          />
        )}
      </div>

      {/* ── Modals ───────────────────────────────────────────────────────────── */}
      {addModal && (
        <AddSessionModal
          defaultDateTime={addModal}
          onSave={handleAddSession}
          onClose={() => setAddModal(null)}
        />
      )}

      {showAvail && (
        <AvailabilityManager
          slots={availSlots}
          onAdd={handleAddAvail}
          onDelete={handleDeleteAvail}
          onClose={() => setShowAvail(false)}
        />
      )}
    </div>
  )
}
