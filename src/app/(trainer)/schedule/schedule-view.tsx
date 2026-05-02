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
import Link from 'next/link'
import {
  ChevronLeft, ChevronRight, Plus, Calendar, LayoutGrid, List,
  Clock, Trash2, X, Settings, MapPin, Video, ExternalLink, Loader2, Play, Pencil,
} from 'lucide-react'
import {
  AssignPackageFromScheduleButton,
  AssignPackageFromScheduleModal,
} from './assign-package-from-schedule'
import { ScheduleSettings } from './schedule-settings'
import { SessionFormReport } from '@/components/session-form-report'

// ─── Constants ────────────────────────────────────────────────────────────────

// Default visible hour range — overridden per-trainer by props on ScheduleView,
// flowed down through WeekGrid. Keep these as defaults so the helper functions
// below can stay pure and reusable from other call sites.
const DEFAULT_START_HOUR = 7    // 7am
const DEFAULT_END_HOUR   = 21   // 9pm
const PX_PER_HOUR   = 72   // pixels per hour
const SNAP_MINS     = 15   // drag snaps to 15-min intervals
const DRAG_THRESHOLD = 6   // px moved before considered a drag

// Hide the Session Report and Tasks sections in the schedule popup for now —
// flip to true to bring them back. Both still render on the full session page.
const SHOW_REPORT_AND_TASKS = false

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const availSchema = z.object({
  title: z.string().optional(),
  type: z.enum(['repeating', 'oneoff']),
  dayOfWeek: z.number().int().min(1).max(7).optional(),
  date: z.string().optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
})

type AvailForm      = z.infer<typeof availSchema>

// ─── Types ────────────────────────────────────────────────────────────────────

type SessionStatus = 'UPCOMING' | 'COMPLETED' | 'COMMENTED' | 'INVOICED'

interface Buddy {
  id: string
  clientId: string
  dogId: string | null
  client: { id: string; user: { name: string | null; email: string } }
  dog: { id: string; name: string } | null
}

type PackageColor = 'blue' | 'emerald' | 'amber' | 'rose' | 'purple' | 'orange' | 'teal' | 'indigo' | 'pink' | 'cyan'

interface Session {
  id: string
  title: string
  scheduledAt: string
  durationMins: number
  sessionType: string
  status: SessionStatus
  location: string | null
  virtualLink: string | null
  description: string | null
  clientId: string | null
  dogId: string | null
  clientPackageId: string | null
  packageColor: PackageColor | null
  client: { id: string; user: { name: string | null; email: string } } | null
  dog: {
    name: string
    primaryFor: { id: string; user: { name: string | null; email: string } }[]
  } | null
  buddies: Buddy[]
}

// Static class map for package-coloured blocks (Tailwind purges dynamic
// class names so each option needs its own pair listed here).
const PACKAGE_COLOR_CLASSES: Record<PackageColor, { bg: string; hover: string; fadedBg: string }> = {
  blue:    { bg: 'bg-blue-500',    hover: 'hover:bg-blue-600',    fadedBg: 'bg-blue-300' },
  emerald: { bg: 'bg-emerald-500', hover: 'hover:bg-emerald-600', fadedBg: 'bg-emerald-300' },
  amber:   { bg: 'bg-amber-500',   hover: 'hover:bg-amber-600',   fadedBg: 'bg-amber-300' },
  rose:    { bg: 'bg-rose-500',    hover: 'hover:bg-rose-600',    fadedBg: 'bg-rose-300' },
  purple:  { bg: 'bg-purple-500',  hover: 'hover:bg-purple-600',  fadedBg: 'bg-purple-300' },
  orange:  { bg: 'bg-orange-500',  hover: 'hover:bg-orange-600',  fadedBg: 'bg-orange-300' },
  teal:    { bg: 'bg-teal-500',    hover: 'hover:bg-teal-600',    fadedBg: 'bg-teal-300' },
  indigo:  { bg: 'bg-indigo-500',  hover: 'hover:bg-indigo-600',  fadedBg: 'bg-indigo-300' },
  pink:    { bg: 'bg-pink-500',    hover: 'hover:bg-pink-600',    fadedBg: 'bg-pink-300' },
  cyan:    { bg: 'bg-cyan-500',    hover: 'hover:bg-cyan-600',    fadedBg: 'bg-cyan-300' },
}

interface ClientOption {
  id: string
  name: string
  dogs: { id: string; name: string }[]
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

// Parse YYYY-MM-DD as LOCAL noon to avoid timezone-shift bugs
function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0)
}

// Format Date as YYYY-MM-DD using LOCAL date components
function toDateStr(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getMondayOf(dateStr: string): Date {
  const d = parseLocalDate(dateStr)
  const day = d.getDay() // 0=Sun
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-NZ', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

// `<input type="date">` and `<input type="time">` need YYYY-MM-DD and HH:MM
// in the user's local timezone, not UTC.
function localDateStr(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function localTimeStr(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtFullDate(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString('en-NZ', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

// Convert time offset in grid to HH:MM
function yToTime(y: number, startHour = DEFAULT_START_HOUR, endHour = DEFAULT_END_HOUR): string {
  const totalMins = startHour * 60 + (y / PX_PER_HOUR) * 60
  const snapped   = Math.round(totalMins / SNAP_MINS) * SNAP_MINS
  const clamped   = Math.max(startHour * 60, Math.min(endHour * 60 - 30, snapped))
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// Top offset + height (in px) for a time range
function timeToY(timeStr: string, startHour = DEFAULT_START_HOUR): number {
  const [h, m] = timeStr.split(':').map(Number)
  return ((h * 60 + m - startHour * 60) / 60) * PX_PER_HOUR
}

function sessionTop(iso: string, startHour = DEFAULT_START_HOUR): number {
  const d = new Date(iso)
  const mins = d.getHours() * 60 + d.getMinutes()
  return Math.max(0, ((mins - startHour * 60) / 60) * PX_PER_HOUR)
}

function sessionHeight(durationMins: number): number {
  return Math.max((durationMins / 60) * PX_PER_HOUR, 24)
}

// ─── Availability strip ───────────────────────────────────────────────────────

function AvailStrip({ slot, dayDate, onDelete, startHour }: {
  slot: AvailSlot
  dayDate: Date
  onDelete: (id: string) => void
  startHour: number
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

  const top    = timeToY(slot.startTime, startHour)
  const height = timeToY(slot.endTime, startHour) - top

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

// ─── Extra-fields ─────────────────────────────────────────────────────────────

// Built-in field IDs the trainer can pin to a schedule block. Mirrors the
// /clients column selector for client-level fields, plus session-only fields
// (location/description/sessionType/duration/title). Custom fields use the
// "custom:<cuid>" form, same as the clients picker.
type SessionFieldId = 'location' | 'description' | 'sessionType' | 'duration' | 'title'
type ClientFieldId  = 'email' | 'extraDogs' | 'compliance'

interface ClientExtra {
  email: string
  extraDogNames: string[]
  taskCount: number
  completedCount: number
  customValues: Record<string, string>
}

interface CustomFieldMeta {
  id: string
  label: string
  appliesTo: string
}

function resolveClientId(session: Session): string | null {
  return session.clientId ?? session.dog?.primaryFor[0]?.id ?? null
}

function extraFieldValue(
  field: string,
  session: Session,
  clientExtras: Record<string, ClientExtra>,
  customFields: CustomFieldMeta[],
): string | null {
  // Session-level fields
  switch (field) {
    case 'location':    return session.location?.trim() || null
    case 'description': return session.description?.trim() || null
    case 'sessionType': return session.sessionType === 'VIRTUAL' ? '💻 Virtual' : '📍 In person'
    case 'duration':    return `${session.durationMins}m`
    case 'title':       return session.title?.trim() || null
  }
  // Client-level fields — resolve via the session's client.
  const cid = resolveClientId(session)
  const extra = cid ? clientExtras[cid] : undefined
  switch (field) {
    case 'email':     return extra?.email ?? null
    case 'extraDogs': return extra && extra.extraDogNames.length > 0 ? `+ ${extra.extraDogNames.join(', ')}` : null
    case 'compliance': {
      if (!extra || extra.taskCount === 0) return null
      const rate = Math.round((extra.completedCount / extra.taskCount) * 100)
      return `${rate}% · 7d`
    }
  }
  if (field.startsWith('custom:')) {
    const fieldId = field.slice('custom:'.length)
    const meta = customFields.find(f => f.id === fieldId)
    const value = extra?.customValues[fieldId]
    if (!value) return null
    return meta ? `${meta.label}: ${value}` : value
  }
  return null
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_META: Record<SessionStatus, { label: string; bg: string; hover: string; fadedBg: string; dot: string }> = {
  UPCOMING:  { label: 'Upcoming',  bg: 'bg-blue-500',   hover: 'hover:bg-blue-600',   fadedBg: 'bg-blue-300',   dot: 'bg-white/60' },
  COMPLETED: { label: 'Completed', bg: 'bg-green-500',  hover: 'hover:bg-green-600',  fadedBg: 'bg-green-300',  dot: 'bg-white/60' },
  COMMENTED: { label: 'Commented', bg: 'bg-amber-500',  hover: 'hover:bg-amber-600',  fadedBg: 'bg-amber-300',  dot: 'bg-white/60' },
  INVOICED:  { label: 'Invoiced',  bg: 'bg-purple-500', hover: 'hover:bg-purple-600', fadedBg: 'bg-purple-300', dot: 'bg-white/60' },
}

// ─── Session block ────────────────────────────────────────────────────────────

function SessionBlock({
  session,
  isDragging,
  dragTop,
  faded,
  onPointerDown,
  onClick,
  startHour,
  extraFields,
  clientExtras,
  customFields,
}: {
  session: Session
  isDragging: boolean
  dragTop: number | null
  faded?: boolean
  onPointerDown: (e: React.PointerEvent) => void
  onClick: () => void
  startHour: number
  extraFields: string[]
  clientExtras: Record<string, ClientExtra>
  customFields: CustomFieldMeta[]
}) {
  const top    = isDragging && dragTop !== null ? dragTop : sessionTop(session.scheduledAt, startHour)
  const height = sessionHeight(session.durationMins)
  // Prefer direct client link, fall back to client via dog's primaryFor
  const clientUser = session.client?.user ?? session.dog?.primaryFor[0]?.user
  const clientName = clientUser ? (clientUser.name ?? clientUser.email) : null
  const meta = STATUS_META[session.status] ?? STATUS_META.UPCOMING
  const isBuddyWalk = session.buddies.length > 0
  // Tooltip lists every dog attending so the trainer can hover the block to
  // see all participants without opening the modal.
  const allDogNames = [
    ...(session.dog?.name ? [session.dog.name] : []),
    ...session.buddies.filter(b => b.dog).map(b => b.dog!.name),
  ]
  const tooltip = isBuddyWalk
    ? `Buddy walk · ${session.title}${allDogNames.length ? ` · 🐕 ${allDogNames.join(', ')}` : ''}`
    : allDogNames.length > 1
    ? `${session.title} · 🐕 ${allDogNames.join(', ')}`
    : undefined

  // Package-coloured blocks override the status colour so trainers can spot
  // a package's sessions at a glance. Buddy walks still take orange precedence.
  const pkg = session.packageColor ? PACKAGE_COLOR_CLASSES[session.packageColor] : null
  const blockBg      = pkg?.bg ?? meta.bg
  const blockHover   = pkg?.hover ?? meta.hover
  const blockFadedBg = pkg?.fadedBg ?? meta.fadedBg

  // Buddy walks get an orange background instead of the status colour, so
  // they're visually distinct from regular 1:1 sessions at a glance.
  const buddyBg      = 'bg-orange-500'
  const buddyHover   = 'hover:bg-orange-600'
  const buddyFaded   = 'bg-orange-300'

  return (
    <div
      className={`absolute left-0.5 right-0.5 rounded-lg px-2 overflow-hidden select-none touch-none z-10 transition-shadow ${
        isDragging
          ? `${isBuddyWalk ? buddyBg : blockBg} shadow-2xl opacity-90 cursor-grabbing z-20`
          : faded
          ? `${isBuddyWalk ? buddyFaded : blockFadedBg} opacity-40 cursor-grabbing z-10`
          : isBuddyWalk
          ? `${buddyBg} ${buddyHover} cursor-grab shadow-sm hover:shadow-md`
          : `${blockBg} ${blockHover} cursor-grab shadow-sm hover:shadow-md`
      }`}
      style={{ top, height }}
      title={tooltip}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      <div className="flex items-center gap-1 pt-1">
        <p className="text-[10px] font-semibold text-white leading-tight truncate flex-1">
          {fmtTime(session.scheduledAt)}
        </p>
        {isBuddyWalk && (
          <span
            className="text-[9px] font-bold text-white bg-white/25 rounded px-1 leading-tight flex-shrink-0"
            title={`Buddy walk · ${allDogNames.length} dog${allDogNames.length === 1 ? '' : 's'}`}
          >
            🐕 {allDogNames.length}
          </span>
        )}
        <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${meta.dot}`} title={meta.label} />
      </div>
      {/* Build the list of secondary lines and render in priority order.
          Trainer-chosen extras outrank the client-name fallback, so a tight
          block prefers the user's explicit field over the redundant line. */}
      {(() => {
        const lines: { key: string; text: string; tone: 'strong' | 'soft' }[] = []
        // Primary: dog name (or buddy walk dogs / fallback to client).
        const primary = isBuddyWalk
          ? (allDogNames.length > 0 ? `🐕 ${allDogNames.join(', ')}` : 'Buddy walk')
          : session.dog?.name ? `🐕 ${session.dog.name}` : (clientName ?? session.title)
        if (primary) lines.push({ key: 'primary', text: primary, tone: 'strong' })
        // Trainer-chosen extras.
        for (const field of extraFields) {
          const value = extraFieldValue(field, session, clientExtras, customFields)
          if (value) lines.push({ key: `extra:${field}`, text: value, tone: 'soft' })
        }
        // Secondary client name (only for non-buddy sessions, lowest priority).
        if (!isBuddyWalk && (clientName || (session.dog?.name && clientName !== session.title))) {
          const text = session.dog?.name && clientName ? clientName : session.title
          if (text) lines.push({ key: 'client', text, tone: 'soft' })
        }
        // ~12px per line + 16px first-row offset (time + pt-1). Render only
        // those that fit so blocks never overflow.
        return lines.map((line, idx) => {
          const minHeight = 16 + (idx + 1) * 12
          if (height <= minHeight) return null
          return (
            <p
              key={line.key}
              className={`text-[10px] leading-tight truncate ${line.tone === 'strong' ? 'text-white/90' : 'text-white/70'}`}
            >
              {line.text}
            </p>
          )
        })
      })()}
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
  startHour,
  endHour,
  extraFields,
  clientExtras,
  customFields,
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
  startHour: number
  endHour: number
  extraFields: string[]
  clientExtras: Record<string, ClientExtra>
  customFields: CustomFieldMeta[]
}) {
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)
  const gridRef = useRef<HTMLDivElement>(null)

  // ── Drag state ──────────────────────────────────────────────────────────────
  const [dragging, setDragging] = useState<{
    session: Session
    originalDayIndex: number  // which column the session lives in
    dayIndex: number          // current target column (may change as pointer moves)
    offsetY: number           // pointer Y within the block when drag started
    currentTop: number
    moved: boolean
  } | null>(null)

  const handlePointerDown = useCallback((e: React.PointerEvent, session: Session, dayIndex: number) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    const blockEl = e.currentTarget as HTMLElement
    // Capture so touch pointermove/up keep firing on the block (and bubble to the grid)
    // even when the finger drifts outside it. Hit-testing for the target column uses
    // clientX/clientY, so capture does NOT prevent cross-column drags.
    try { blockEl.setPointerCapture(e.pointerId) } catch {}
    const rect = blockEl.getBoundingClientRect()
    setDragging({
      session,
      originalDayIndex: dayIndex,
      dayIndex,
      offsetY: e.clientY - rect.top,
      currentTop: sessionTop(session.scheduledAt, startHour),
      moved: false,
    })
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !gridRef.current) return
    e.preventDefault()

    // Detect which column the pointer is currently over by checking X
    const cols = Array.from(gridRef.current.querySelectorAll('[data-day-col]')) as HTMLElement[]
    let targetColIndex = dragging.dayIndex
    for (let i = 0; i < cols.length; i++) {
      const r = cols[i].getBoundingClientRect()
      if (e.clientX >= r.left && e.clientX <= r.right) {
        targetColIndex = i
        break
      }
    }

    const col = cols[targetColIndex] as HTMLElement | undefined
    if (!col) return
    const colRect = col.getBoundingClientRect()
    const rawY    = e.clientY - colRect.top - dragging.offsetY
    const snapped = Math.round(rawY / (PX_PER_HOUR / (60 / SNAP_MINS))) * (PX_PER_HOUR / (60 / SNAP_MINS))
    const clamped = Math.max(0, Math.min(snapped, (endHour - startHour - dragging.session.durationMins / 60) * PX_PER_HOUR))

    setDragging(prev => prev ? { ...prev, dayIndex: targetColIndex, currentTop: clamped, moved: true } : null)
  }, [dragging])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging) return
    if (dragging.moved) {
      // Build new ISO string from target column + snapped top
      const day = weekDays[dragging.dayIndex]
      const timeStr = yToTime(dragging.currentTop, startHour, endHour)
      const [h, m]  = timeStr.split(':').map(Number)
      const newDate  = new Date(day)
      newDate.setHours(h, m, 0, 0)
      onSessionDrop(dragging.session.id, newDate.toISOString())
    } else {
      onSessionClick(dragging.session)
    }
    setDragging(null)
  }, [dragging, weekDays, onSessionClick, onSessionDrop])

  // Cancel drag if pointer released outside the grid, or if iOS cancels the gesture
  // (e.g. multi-touch zoom, scroll arbitration) — without pointercancel cleanup the
  // dragging state would stick on iPad.
  useEffect(() => {
    if (!dragging) return
    function onGlobalEnd() { setDragging(null) }
    document.addEventListener('pointerup', onGlobalEnd)
    document.addEventListener('pointercancel', onGlobalEnd)
    return () => {
      document.removeEventListener('pointerup', onGlobalEnd)
      document.removeEventListener('pointercancel', onGlobalEnd)
    }
  }, [dragging])

  function handleColumnClick(e: React.MouseEvent, dayDate: Date, dayIndex: number) {
    // Ignore if clicking on a session block
    if ((e.target as HTMLElement).closest('[data-session]')) return
    if (!gridRef.current) return
    const cols = gridRef.current.querySelectorAll('[data-day-col]')
    const col  = cols[dayIndex] as HTMLElement | undefined
    if (!col) return
    const rect = col.getBoundingClientRect()
    const y    = e.clientY - rect.top
    const time = yToTime(y, startHour, endHour)
    onSlotClick(toDateStr(dayDate), time)
  }

  const totalHeight = (endHour - startHour) * PX_PER_HOUR

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Day headers */}
      <div className="grid border-b border-slate-100" style={{ gridTemplateColumns: `48px repeat(${weekDays.length}, 1fr)` }}>
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
          style={{ gridTemplateColumns: `48px repeat(${weekDays.length}, 1fr)`, height: totalHeight }}
          onPointerMove={dragging ? handlePointerMove : undefined}
          onPointerUp={dragging ? handlePointerUp : undefined}
        >
          {/* Time labels */}
          <div className="relative border-r border-slate-100 pointer-events-none">
            {hours.map((h) => (
              <div
                key={h}
                className="absolute right-2 text-[10px] text-slate-400 leading-none"
                style={{ top: (h - startHour) * PX_PER_HOUR - 6 }}
              >
                {h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {weekDays.map((d, dayIndex) => {
            const ds         = toDateStr(d)
            const isToday    = ds === today
            const daySessions = sessions.filter(s => toDateStr(new Date(s.scheduledAt)) === ds)

            return (
              <div
                key={ds}
                data-day-col={dayIndex}
                className={`relative border-r border-slate-100 last:border-r-0 cursor-crosshair ${isToday ? 'bg-blue-50/20' : ''}`}
                onClick={(e) => handleColumnClick(e, d, dayIndex)}
              >
                {/* Hour lines */}
                {hours.map((h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-slate-100 pointer-events-none"
                    style={{ top: (h - startHour) * PX_PER_HOUR }}
                  />
                ))}
                {/* Half-hour lines */}
                {hours.map((h) => (
                  <div
                    key={`${h}half`}
                    className="absolute left-0 right-0 border-t border-slate-50 pointer-events-none"
                    style={{ top: (h - startHour) * PX_PER_HOUR + PX_PER_HOUR / 2 }}
                  />
                ))}

                {/* Availability strips */}
                {availSlots.map((slot) => (
                  <AvailStrip key={slot.id} slot={slot} dayDate={d} onDelete={onDeleteAvail} startHour={startHour} />
                ))}

                {/* Sessions that belong to this day */}
                {daySessions.map((s) => {
                  const isBeingDragged = dragging?.session.id === s.id
                  // Target column is this column (same-day drag or cross-day target)
                  const targetHere = dragging?.dayIndex === dayIndex
                  return (
                    <div key={s.id} data-session>
                      <SessionBlock
                        session={s}
                        isDragging={isBeingDragged && targetHere}
                        dragTop={isBeingDragged && targetHere ? dragging!.currentTop : null}
                        faded={isBeingDragged && !targetHere}
                        onPointerDown={(e) => handlePointerDown(e, s, dayIndex)}
                        onClick={() => { /* handled in pointerUp */ }}
                        startHour={startHour}
                        extraFields={extraFields}
                        clientExtras={clientExtras}
                        customFields={customFields}
                      />
                    </div>
                  )
                })}

                {/* Ghost in target column when session dragged in from a different day */}
                {dragging && dragging.dayIndex === dayIndex && dragging.originalDayIndex !== dayIndex && (
                  <div data-session>
                    <SessionBlock
                      session={dragging.session}
                      isDragging
                      dragTop={dragging.currentTop}
                      onPointerDown={() => {}}
                      onClick={() => {}}
                      startHour={startHour}
                      extraFields={extraFields}
                      clientExtras={clientExtras}
                      customFields={customFields}
                    />
                  </div>
                )}
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
        <p className="text-xs mt-1">Click a time slot in week view, or use the &ldquo;Assign package&rdquo; button</p>
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
                  {(client || s.clientId) && (
                    <p className="text-sm text-slate-500 mt-0.5">
                      {s.dog ? `🐕 ${s.dog.name} · ` : ''}{client?.name ?? client?.email ?? ''}
                    </p>
                  )}
                  {s.location && (
                    <p className="text-xs text-slate-400 mt-1">{s.location}</p>
                  )}
                </div>
                <Link
                  href={`/sessions/${s.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors flex-shrink-0"
                >
                  <Play className="h-3 w-3" />
                  Start session
                </Link>
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
  onUpdate,
  onDelete,
  onClose,
}: {
  slots: AvailSlot[]
  onAdd: (slot: AvailSlot) => void
  onUpdate: (slot: AvailSlot) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const defaultValues: AvailForm = { type: 'repeating', startTime: '09:00', endTime: '17:00' }
  const { register, handleSubmit, watch, reset, formState: { errors, isSubmitting } } = useForm<AvailForm>({
    resolver: zodResolver(availSchema),
    defaultValues,
  })
  const type = watch('type')

  function startEdit(slot: AvailSlot) {
    setEditingId(slot.id)
    setError(null)
    reset({
      title: slot.title ?? '',
      type: slot.dayOfWeek != null ? 'repeating' : 'oneoff',
      dayOfWeek: slot.dayOfWeek ?? undefined,
      date: slot.date ?? undefined,
      startTime: slot.startTime,
      endTime: slot.endTime,
    })
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  function cancelEdit() {
    setEditingId(null)
    setError(null)
    reset(defaultValues)
  }

  async function onSubmit(data: AvailForm) {
    setError(null)
    const payload = {
      title: data.title || null,
      dayOfWeek: data.type === 'repeating' ? data.dayOfWeek : null,
      date: data.type === 'oneoff' ? data.date : null,
      startTime: data.startTime,
      endTime: data.endTime,
    }

    if (editingId) {
      const res = await fetch(`/api/availability/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { setError('Failed to save.'); return }
      const slot = await res.json()
      onUpdate({
        ...slot,
        date: slot.date ? new Date(slot.date).toISOString().split('T')[0] : null,
      })
      cancelEdit()
    } else {
      const res = await fetch('/api/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { setError('Failed to save.'); return }
      const slot = await res.json()
      onAdd({
        ...slot,
        date: slot.date ? new Date(slot.date).toISOString().split('T')[0] : null,
      })
      reset(defaultValues)
    }
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
                {slots.map(s => {
                  const isEditing = editingId === s.id
                  return (
                    <div
                      key={s.id}
                      className={`flex items-center justify-between p-3 rounded-xl border transition-colors ${
                        isEditing
                          ? 'bg-blue-50 border-blue-200 ring-2 ring-blue-200'
                          : 'bg-emerald-50 border-emerald-100'
                      }`}
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-800">
                          {s.dayOfWeek != null ? DOW_LABELS[s.dayOfWeek] : s.date} · {s.startTime}–{s.endTime}
                        </p>
                        {s.title && <p className="text-xs text-slate-500">{s.title}</p>}
                        <p className={`text-xs ${isEditing ? 'text-blue-600' : 'text-emerald-600'}`}>
                          {isEditing ? 'Editing…' : (s.dayOfWeek != null ? 'Repeating' : 'One-off')}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => isEditing ? cancelEdit() : startEdit(s)}
                          className={`p-1.5 rounded-lg transition-colors ${
                            isEditing
                              ? 'text-blue-600 bg-blue-100 hover:bg-blue-200'
                              : 'text-slate-400 hover:text-blue-500 hover:bg-blue-50'
                          }`}
                          title={isEditing ? 'Cancel edit' : 'Edit slot'}
                        >
                          {isEditing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                        </button>
                        <button
                          onClick={() => {
                            if (editingId === s.id) cancelEdit()
                            onDelete(s.id)
                          }}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete slot"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Add / Edit slot form */}
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
            {editingId ? 'Edit slot' : 'Add slot'}
          </p>
          {error && <Alert variant="error" className="mb-3">{error}</Alert>}
          <form ref={formRef} onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
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

            <div className="flex gap-2">
              {editingId && (
                <Button type="button" variant="secondary" onClick={cancelEdit} className="flex-1">
                  Cancel
                </Button>
              )}
              <Button type="submit" loading={isSubmitting} className="flex-1">
                {editingId ? 'Save changes' : 'Add slot'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ─── Session detail modal ─────────────────────────────────────────────────────

const STATUS_OPTIONS_MODAL = [
  { value: 'UPCOMING',  label: 'Upcoming',  colour: 'bg-blue-100 text-blue-700 border-blue-200' },
  { value: 'COMPLETED', label: 'Completed', colour: 'bg-green-100 text-green-700 border-green-200' },
  { value: 'COMMENTED', label: 'Commented', colour: 'bg-amber-100 text-amber-700 border-amber-200' },
  { value: 'INVOICED',  label: 'Invoiced',  colour: 'bg-purple-100 text-purple-700 border-purple-200' },
] as const

interface SessionTask {
  id: string
  title: string
  description: string | null
  repetitions: number | null
  videoUrl: string | null
  dogId: string | null
}

interface LibraryTask {
  id: string
  title: string
  description: string | null
  repetitions: number | null
  videoUrl: string | null
}

interface LibraryTheme {
  id: string
  name: string
  tasks: LibraryTask[]
}

interface LibraryType {
  id: string
  name: string
  themes: LibraryTheme[]
}

function DeleteSessionMenu({ deleting, canDeleteFollowing, onConfirm }: {
  deleting: boolean
  canDeleteFollowing: boolean
  onConfirm: (scope: 'this' | 'following') => void
}) {
  const [open, setOpen] = useState(false)
  if (!canDeleteFollowing) {
    return (
      <button
        disabled={deleting}
        onClick={() => onConfirm('this')}
        className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg text-red-600 hover:text-red-700 hover:bg-red-50 disabled:opacity-50 transition-colors"
      >
        <Trash2 className="h-4 w-4" /> {deleting ? 'Deleting…' : 'Delete session'}
      </button>
    )
  }
  return (
    <div className="relative">
      <button
        disabled={deleting}
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg text-red-600 hover:text-red-700 hover:bg-red-50 disabled:opacity-50 transition-colors"
      >
        <Trash2 className="h-4 w-4" /> {deleting ? 'Deleting…' : 'Delete'}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 bottom-full mb-1 w-56 z-40 bg-white rounded-xl border border-slate-200 shadow-lg p-1.5">
            <button
              onClick={() => { setOpen(false); onConfirm('this') }}
              className="w-full text-left px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50"
            >
              Delete this session
            </button>
            <button
              onClick={() => { setOpen(false); onConfirm('following') }}
              className="w-full text-left px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50"
            >
              Delete this + following
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function SessionModal({
  session: initialSession,
  clients,
  onClose,
  onStatusChange,
  onSessionsUpdate,
  onDelete,
}: {
  session: Session
  clients: ClientOption[]
  onClose: () => void
  onStatusChange: (id: string, status: SessionStatus) => void
  onSessionsUpdate: (id: string, updates: Partial<Session>) => void
  onDelete: (id: string, scope?: 'this' | 'following') => Promise<void> | void
}) {
  const router = useRouter()
  const [session, setSession] = useState(initialSession)
  const [tasks, setTasks] = useState<SessionTask[]>([])
  const [savingStatus, setSavingStatus] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [addingTask, setAddingTask] = useState<string | null>(null) // taskId or 'custom' being added
  const [taskError, setTaskError] = useState<string | null>(null)

  // Add panel visibility + mode
  const [showAddPanel, setShowAddPanel] = useState(false)
  const [addMode, setAddMode] = useState<'library' | 'custom'>('library')
  const [library, setLibrary] = useState<LibraryType[]>([])
  const [libraryLoaded, setLibraryLoaded] = useState(false)
  const [librarySearch, setLibrarySearch] = useState('')

  // Custom task form fields
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDesc, setNewTaskDesc] = useState('')
  const [newTaskReps, setNewTaskReps] = useState('')
  const [selectedDogId, setSelectedDogId] = useState<string | null>(null)

  // Buddy session UI state
  const [showBuddyPicker, setShowBuddyPicker] = useState(false)
  const [buddyClientId, setBuddyClientId] = useState<string>('')
  const [buddyDogId, setBuddyDogId] = useState<string | null>(null)
  const [savingBuddy, setSavingBuddy] = useState(false)
  const [buddyError, setBuddyError] = useState<string | null>(null)

  const d = new Date(session.scheduledAt)
  const clientUser = session.client?.user ?? session.dog?.primaryFor[0]?.user
  const clientName = clientUser ? (clientUser.name ?? clientUser.email) : null
  const clientId   = session.clientId ?? session.dog?.primaryFor[0]?.id
  const dateStr    = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  // Dogs for this client (for task assignment)
  const clientDogs = clients.find(c => c.id === clientId)?.dogs ?? []

  useEffect(() => {
    fetch(`/api/schedule/${session.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.tasks) setTasks(data.tasks) })
      .catch(() => {})
  }, [session.id])

  useEffect(() => {
    if (showAddPanel && !libraryLoaded) {
      fetch('/api/library/types')
        .then(r => r.ok ? r.json() : [])
        .then(data => { setLibrary(data) })
        .catch(() => {})
        .finally(() => setLibraryLoaded(true))
    }
  }, [showAddPanel, libraryLoaded])

  // Date/time/duration are staged in the modal so the trainer can choose
  // whether to apply changes only to this session or to this session plus
  // every later one in the same package. Other fields (status, dog, buddies)
  // remain auto-saved since they're meaningful per-session.
  const [draftDate, setDraftDate] = useState(localDateStr(initialSession.scheduledAt))
  const [draftTime, setDraftTime] = useState(localTimeStr(initialSession.scheduledAt))
  const [draftDuration, setDraftDuration] = useState(initialSession.durationMins)
  const [savingDraft, setSavingDraft] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)

  // If the parent swaps the session out (e.g. opening a different one),
  // re-seed the draft from the new source.
  useEffect(() => {
    setDraftDate(localDateStr(initialSession.scheduledAt))
    setDraftTime(localTimeStr(initialSession.scheduledAt))
    setDraftDuration(initialSession.durationMins)
    setDraftError(null)
  }, [initialSession.id, initialSession.scheduledAt, initialSession.durationMins])

  function buildDraftIso(): string | null {
    const [yyyy, mm, dd] = draftDate.split('-').map(Number)
    const [hh, mi] = draftTime.split(':').map(Number)
    if (!yyyy || !mm || !dd || isNaN(hh) || isNaN(mi)) return null
    const next = new Date(session.scheduledAt)
    next.setFullYear(yyyy, mm - 1, dd)
    next.setHours(hh, mi, 0, 0)
    return next.toISOString()
  }

  const draftIso = buildDraftIso()
  const dirty =
    (draftIso !== null && draftIso !== new Date(session.scheduledAt).toISOString()) ||
    draftDuration !== session.durationMins

  async function saveDraft(scope: 'this' | 'following') {
    setDraftError(null)
    if (!Number.isFinite(draftDuration) || draftDuration <= 0) {
      setDraftError('Duration must be positive')
      return
    }
    const iso = buildDraftIso()
    if (!iso) {
      setDraftError('Invalid date or time')
      return
    }
    setSavingDraft(true)
    const updates = { scheduledAt: iso, durationMins: draftDuration }
    const url = `/api/schedule/${session.id}${scope === 'following' ? '?scope=following' : ''}`
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    setSavingDraft(false)
    if (!res.ok) {
      setDraftError('Failed to save')
      return
    }
    setSession(prev => ({ ...prev, ...updates }))
    onSessionsUpdate(session.id, updates)
    if (scope === 'following') {
      // Following sessions changed too; reload page data so the calendar
      // reflects all the shifted blocks at once.
      router.refresh()
    }
  }

  async function handleStatusChange(status: SessionStatus) {
    setSavingStatus(true)
    setSession(prev => ({ ...prev, status }))
    onStatusChange(session.id, status)
    try {
      await fetch(`/api/schedule/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
    } finally {
      setSavingStatus(false)
    }
  }

  // Clients eligible to add as a buddy: every trainer client. We allow the
  // primary attendee's household too — the dog list filters out the primary
  // dog, so only their *other* dogs (additional dogs) are pickable.
  const buddyClientOptions = clients
  // Dogs available to attach as a buddy. Exclude this session's primary dog
  // (when the buddy client matches the primary client) and any dog already
  // added as a buddy under the same client.
  const alreadyBuddyDogIds = new Set(
    session.buddies
      .filter(b => b.clientId === buddyClientId && b.dogId)
      .map(b => b.dogId as string),
  )
  const buddyClientDogs = (clients.find(c => c.id === buddyClientId)?.dogs ?? [])
    .filter(d => !(buddyClientId === clientId && d.id === session.dogId))
    .filter(d => !alreadyBuddyDogIds.has(d.id))

  async function handleAddBuddy() {
    if (!buddyClientId) return
    setBuddyError(null)
    setSavingBuddy(true)
    try {
      const res = await fetch(`/api/schedule/${session.id}/buddies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: buddyClientId, dogId: buddyDogId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setBuddyError(body?.error?.toString() ?? 'Failed to add buddy')
        return
      }
      const buddy: Buddy = await res.json()
      const nextBuddies = [...session.buddies, buddy]
      setSession(prev => ({ ...prev, buddies: nextBuddies }))
      onSessionsUpdate(session.id, { buddies: nextBuddies })
      setShowBuddyPicker(false)
      setBuddyClientId('')
      setBuddyDogId(null)
    } finally {
      setSavingBuddy(false)
    }
  }

  async function handleRemoveBuddy(buddyId: string) {
    const nextBuddies = session.buddies.filter(b => b.id !== buddyId)
    setSession(prev => ({ ...prev, buddies: nextBuddies }))
    onSessionsUpdate(session.id, { buddies: nextBuddies })
    const res = await fetch(`/api/schedule/${session.id}/buddies/${buddyId}`, { method: 'DELETE' })
    if (!res.ok) {
      // Roll back on failure
      setSession(prev => ({ ...prev, buddies: session.buddies }))
      onSessionsUpdate(session.id, { buddies: session.buddies })
    }
  }

  async function handleDogChange(nextDogId: string | null) {
    const dog = nextDogId ? clientDogs.find(d => d.id === nextDogId) : null
    // Optimistically update local + parent state so the calendar block reflects
    // the change immediately without a refetch.
    const nextDog = dog ? { name: dog.name, primaryFor: session.dog?.primaryFor ?? [] } : null
    setSession(prev => ({ ...prev, dogId: nextDogId, dog: nextDog }))
    onSessionsUpdate(session.id, { dogId: nextDogId, dog: nextDog })
    const res = await fetch(`/api/schedule/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dogId: nextDogId }),
    })
    if (!res.ok) {
      // Roll back on failure
      setSession(prev => ({ ...prev, dogId: session.dogId, dog: session.dog }))
      onSessionsUpdate(session.id, { dogId: session.dogId, dog: session.dog })
    }
  }

  // Roll call of every dog attending this session — primary plus buddies.
  // Shown as a compact pill row near the top of the modal so trainers can
  // see all dogs at a glance when a session has 4+ attendees.
  const allDogsAttending: { name: string; isPrimary: boolean }[] = [
    ...(session.dog?.name ? [{ name: session.dog.name, isPrimary: true }] : []),
    ...session.buddies.filter(b => b.dog).map(b => ({ name: b.dog!.name, isPrimary: false })),
  ]
  // A "buddy walk" is any session with at least one buddy. The popup uses a
  // distinctive amber treatment + unified Attendees list when this is true.
  const isBuddyWalk = session.buddies.length > 0
  // Unified attendee list (primary + buddies) for the buddy-walk view.
  const attendees = [
    ...(clientId ? [{
      key: `primary:${clientId}`,
      isPrimary: true,
      buddyId: null as string | null,
      clientId,
      clientName: clientName ?? '—',
      dogName: session.dog?.name ?? null,
    }] : []),
    ...session.buddies.map(b => ({
      key: `buddy:${b.id}`,
      isPrimary: false,
      buddyId: b.id,
      clientId: b.clientId,
      clientName: b.client.user.name ?? b.client.user.email,
      dogName: b.dog?.name ?? null,
    })),
  ]

  async function saveTask(key: string, data: { title: string; description?: string | null; repetitions?: number | null; videoUrl?: string | null }) {
    if (!clientId) return
    setTaskError(null)
    setAddingTask(key)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          sessionId: session.id,
          date: dateStr,
          title: data.title,
          description: data.description ?? null,
          repetitions: data.repetitions ?? null,
          videoUrl: data.videoUrl ?? null,
          dogId: selectedDogId ?? null,
        }),
      })
      if (!res.ok) { setTaskError('Failed to add task'); return }
      const task = await res.json()
      setTasks(prev => [...prev, task])
    } catch {
      setTaskError('Failed to add task')
    } finally {
      setAddingTask(null)
    }
  }

  async function handleAddCustomTask(e: React.FormEvent) {
    e.preventDefault()
    if (!newTaskTitle.trim()) return
    await saveTask('custom', {
      title: newTaskTitle.trim(),
      description: newTaskDesc.trim() || null,
      repetitions: newTaskReps ? parseInt(newTaskReps, 10) : null,
    })
    setNewTaskTitle('')
    setNewTaskDesc('')
    setNewTaskReps('')
  }

  async function handleAddLibraryTask(lt: LibraryTask) {
    await saveTask(lt.id, {
      title: lt.title,
      description: lt.description,
      repetitions: lt.repetitions,
      videoUrl: lt.videoUrl,
    })
  }

  async function handleDeleteTask(taskId: string) {
    await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
    setTasks(prev => prev.filter(t => t.id !== taskId))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div
        className="relative z-50 bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header — amber treatment for buddy walks (any session with ≥1
            buddy) so they're visually distinct from regular 1:1 sessions. */}
        <div className={`px-6 py-5 flex-shrink-0 border-b ${
          isBuddyWalk
            ? 'bg-amber-50 border-amber-200'
            : session.sessionType === 'VIRTUAL'
            ? 'bg-purple-50 border-purple-100'
            : 'bg-blue-50 border-blue-100'
        }`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-semibold uppercase tracking-wide ${
                  session.sessionType === 'VIRTUAL' ? 'text-purple-500' : 'text-blue-500'
                }`}>
                  {session.sessionType === 'VIRTUAL' ? '💻 Virtual' : '📍 In person'}
                </span>
                {isBuddyWalk && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-200/70 px-2 py-0.5 rounded-full">
                    🐕 Buddy walk · {allDogsAttending.length} dog{allDogsAttending.length === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              <h2 className="text-lg font-bold text-slate-900 mt-0.5 truncate">{session.title}</h2>
              {!isBuddyWalk && clientName && <p className="text-sm text-slate-500 mt-0.5">{clientName}</p>}
              {!isBuddyWalk && allDogsAttending.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {allDogsAttending.map((d, i) => (
                    <span
                      key={`${d.name}-${i}`}
                      className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-white text-slate-700 border border-slate-200"
                    >
                      🐕 {d.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 flex-shrink-0 mt-0.5">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">

          {/* Status */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Status</p>
            <div className="flex gap-2 flex-wrap">
              {STATUS_OPTIONS_MODAL.map(opt => (
                <button
                  key={opt.value}
                  disabled={savingStatus}
                  onClick={() => handleStatusChange(opt.value as SessionStatus)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-all disabled:opacity-50 ${
                    session.status === opt.value
                      ? `${opt.colour} ring-2 ring-offset-1 ring-current`
                      : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Dog — only when client has at least one dog. Click a chip to attach
              that dog (or "No dog" to clear). Hidden in buddy-walk mode in
              favour of the unified Attendees list below. */}
          {!isBuddyWalk && clientId && clientDogs.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Dog</p>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => handleDogChange(null)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                    session.dogId == null
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  No dog
                </button>
                {clientDogs.map(dog => (
                  <button
                    key={dog.id}
                    onClick={() => handleDogChange(dog.id)}
                    className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                      session.dogId === dog.id
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                    }`}
                  >
                    🐕 {dog.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Attendees — buddy-walk mode shows every client/dog attending in
              one unified list (primary + buddies as equal-looking rows; the
              primary just can't be removed). Reframes the mental model from
              "owner + extras" to "group session". */}
          {isBuddyWalk && clientId && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  Attendees <span className="ml-1.5 text-slate-300">({attendees.length})</span>
                </p>
                {!showBuddyPicker && (
                  <button
                    onClick={() => { setShowBuddyPicker(true); setBuddyError(null) }}
                    className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
                  >
                    <Plus className="h-3 w-3" /> Add attendee
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-1 mb-2 rounded-lg bg-amber-50/60 border border-amber-100 divide-y divide-amber-100">
                {attendees.map(a => (
                  <div key={a.key} className="flex items-center gap-2 px-3 py-2">
                    <span className="text-base flex-shrink-0">🐕</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-900 truncate">
                        {a.dogName ? <span className="font-medium">{a.dogName}</span> : <span className="text-slate-400 italic font-normal">No dog</span>}
                      </p>
                      <p className="text-xs text-slate-500 truncate">{a.clientName}</p>
                    </div>
                    {a.buddyId && (
                      <button
                        onClick={() => handleRemoveBuddy(a.buddyId!)}
                        className="p-1 text-slate-300 hover:text-red-500 transition-colors flex-shrink-0"
                        title="Remove from session"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Buddies — entry point for regular (non-buddy-walk) sessions.
              Once a buddy is added the session becomes a buddy walk and the
              Attendees view above takes over. */}
          {!isBuddyWalk && clientId && !showBuddyPicker && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Buddies</p>
                <button
                  onClick={() => { setShowBuddyPicker(true); setBuddyError(null) }}
                  className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                >
                  <Plus className="h-3 w-3" /> Add buddy
                </button>
              </div>
              <p className="text-xs text-slate-400">No buddies. Add another client + dog to turn this into a buddy walk.</p>
            </div>
          )}

          {/* Shared add-buddy / add-attendee picker — works for both modes. */}
          {clientId && showBuddyPicker && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
                {isBuddyWalk ? 'Add attendee' : 'Add buddy'}
              </p>
              <div className="border border-slate-200 rounded-xl p-3 flex flex-col gap-2.5">
                {buddyError && <p className="text-xs text-red-500">{buddyError}</p>}
                <div>
                  <label className="text-[11px] font-medium text-slate-500 block mb-1">Client</label>
                  <select
                    value={buddyClientId}
                    onChange={e => { setBuddyClientId(e.target.value); setBuddyDogId(null) }}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select client…</option>
                    {buddyClientOptions.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                {buddyClientId && buddyClientDogs.length > 0 && (
                  <div>
                    <label className="text-[11px] font-medium text-slate-500 block mb-1">Dog (optional)</label>
                    <div className="flex gap-1.5 flex-wrap">
                      <button
                        onClick={() => setBuddyDogId(null)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                          buddyDogId === null
                            ? 'bg-slate-800 text-white border-slate-800'
                            : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                        }`}
                      >
                        No dog
                      </button>
                      {buddyClientDogs.map(dog => (
                        <button
                          key={dog.id}
                          onClick={() => setBuddyDogId(dog.id)}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                            buddyDogId === dog.id
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                          }`}
                        >
                          🐕 {dog.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    onClick={handleAddBuddy}
                    loading={savingBuddy}
                    disabled={!buddyClientId}
                  >
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setShowBuddyPicker(false); setBuddyClientId(''); setBuddyDogId(null); setBuddyError(null) }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* When — staged edits, saved with the buttons below. */}
          <div className="flex flex-col gap-2.5 text-sm">
            <div className="flex items-center gap-3">
              <Calendar className="h-4 w-4 text-slate-400 flex-shrink-0" />
              <input
                type="date"
                value={draftDate}
                onChange={e => setDraftDate(e.target.value)}
                className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Clock className="h-4 w-4 text-slate-400 flex-shrink-0" />
              <input
                type="time"
                value={draftTime}
                onChange={e => setDraftTime(e.target.value)}
                className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-slate-400">·</span>
              <input
                type="number"
                min={5}
                step={5}
                value={draftDuration}
                onChange={e => setDraftDuration(parseInt(e.target.value, 10) || 0)}
                className="h-8 w-16 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-slate-500 text-xs">min</span>
            </div>
            {dirty && (
              <div className="flex flex-col gap-1.5 mt-1">
                {draftError && <p className="text-xs text-red-600">{draftError}</p>}
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" disabled={savingDraft} onClick={() => saveDraft('this')}>
                    {savingDraft ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Save this session
                  </Button>
                  {session.clientPackageId && (
                    <Button size="sm" variant="secondary" disabled={savingDraft} onClick={() => saveDraft('following')}>
                      Save this + following
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={savingDraft} onClick={() => {
                    setDraftDate(localDateStr(session.scheduledAt))
                    setDraftTime(localTimeStr(session.scheduledAt))
                    setDraftDuration(session.durationMins)
                    setDraftError(null)
                  }}>
                    Reset
                  </Button>
                </div>
              </div>
            )}
            {session.location && (
              <div className="flex items-center gap-3">
                <MapPin className="h-4 w-4 text-slate-400 flex-shrink-0" />
                <span className="text-slate-700">{session.location}</span>
              </div>
            )}
            {session.virtualLink && (
              <div className="flex items-center gap-3">
                <Video className="h-4 w-4 text-slate-400 flex-shrink-0" />
                <a href={session.virtualLink} target="_blank" rel="noopener noreferrer"
                  className="text-blue-600 hover:underline truncate">
                  {session.virtualLink}
                </a>
              </div>
            )}
          </div>

          {/* Notes */}
          {session.description && (
            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Notes</p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{session.description}</p>
            </div>
          )}

          {/* Session report and Tasks are hidden in the schedule popup for
              now — gated behind SHOW_REPORT_AND_TASKS so the wiring stays
              intact. Both are still available on the full session page. */}
          {SHOW_REPORT_AND_TASKS && (
            <div className="border-t border-slate-100 pt-4">
              <SessionFormReport sessionId={session.id} />
            </div>
          )}
          {SHOW_REPORT_AND_TASKS && (
          /* Tasks */
          <div className="border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Tasks for this session</p>
              {clientId && (
                <button
                  onClick={() => setShowAddPanel(v => !v)}
                  className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${
                    showAddPanel ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <Plus className="h-3 w-3" /> Add task
                </button>
              )}
            </div>

            {/* Existing tasks */}
            {tasks.length === 0 && !showAddPanel ? (
              <p className="text-sm text-slate-400">No tasks yet. Click &ldquo;Add task&rdquo; to get started.</p>
            ) : (
              <div className="flex flex-col gap-2 mb-3">
                {tasks.map(t => {
                  const dogName = t.dogId ? clientDogs.find(d => d.id === t.dogId)?.name : null
                  return (
                    <div key={t.id} className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900">{t.title}</p>
                        {t.description && <p className="text-xs text-slate-500 mt-0.5">{t.description}</p>}
                        <div className="flex items-center gap-2 mt-0.5">
                          {t.repetitions && <p className="text-xs text-slate-400">{t.repetitions} reps</p>}
                          {dogName && <p className="text-xs text-blue-500">🐕 {dogName}</p>}
                        </div>
                      </div>
                      <button onClick={() => handleDeleteTask(t.id)}
                        className="p-1 text-slate-300 hover:text-red-500 transition-colors flex-shrink-0">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Add panel */}
            {showAddPanel && clientId && (() => {
              // Flatten library for search
              const allLibraryTasks = library.flatMap(type =>
                type.themes.flatMap(theme =>
                  theme.tasks.map(lt => ({ ...lt, typeName: type.name, themeName: theme.name }))
                )
              )
              const query = librarySearch.trim().toLowerCase()
              const filteredTasks = query
                ? allLibraryTasks.filter(lt =>
                    lt.title.toLowerCase().includes(query) ||
                    lt.themeName.toLowerCase().includes(query) ||
                    lt.typeName.toLowerCase().includes(query)
                  )
                : allLibraryTasks

              return (
                <div className="border border-slate-200 rounded-2xl overflow-hidden">
                  {/* Dog picker — only when client has multiple dogs */}
                  {clientDogs.length > 1 && (
                    <div className="px-3 pt-3 pb-2 border-b border-slate-100">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Assign to dog</p>
                      <div className="flex gap-1.5 flex-wrap">
                        <button
                          onClick={() => setSelectedDogId(null)}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                            selectedDogId === null
                              ? 'bg-slate-800 text-white border-slate-800'
                              : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                          }`}
                        >
                          Any dog
                        </button>
                        {clientDogs.map(dog => (
                          <button
                            key={dog.id}
                            onClick={() => setSelectedDogId(dog.id)}
                            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                              selectedDogId === dog.id
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                            }`}
                          >
                            🐕 {dog.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Mode toggle */}
                  <div className="flex p-1 bg-slate-50 border-b border-slate-200 gap-0.5">
                    <button
                      onClick={() => setAddMode('library')}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${addMode === 'library' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      From library
                    </button>
                    <button
                      onClick={() => setAddMode('custom')}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${addMode === 'custom' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      Custom task
                    </button>
                  </div>

                  {taskError && <p className="text-xs text-red-500 px-3 pt-2">{taskError}</p>}

                  {/* Library */}
                  {addMode === 'library' && (
                    <div>
                      {/* Search */}
                      <div className="px-3 pt-3 pb-2">
                        <input
                          type="text"
                          placeholder="Search tasks…"
                          value={librarySearch}
                          onChange={e => setLibrarySearch(e.target.value)}
                          autoFocus
                          className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      {/* Results */}
                      <div className="max-h-56 overflow-y-auto divide-y divide-slate-50">
                        {!libraryLoaded ? (
                          <div className="flex items-center gap-2 text-sm text-slate-400 px-3 py-3">
                            <Loader2 className="h-4 w-4 animate-spin" /> Loading library…
                          </div>
                        ) : filteredTasks.length === 0 ? (
                          <p className="text-sm text-slate-400 px-3 py-3">
                            {query ? 'No matching tasks.' : 'No library items yet.'}
                          </p>
                        ) : (
                          filteredTasks.map(lt => (
                            <div key={lt.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-slate-800 truncate">{lt.title}</p>
                                <p className="text-[10px] text-slate-400 truncate">{lt.typeName} · {lt.themeName}{lt.repetitions ? ` · ${lt.repetitions} reps` : ''}</p>
                              </div>
                              <button
                                onClick={() => handleAddLibraryTask(lt)}
                                disabled={addingTask === lt.id}
                                className="flex-shrink-0 h-7 w-7 rounded-full bg-blue-500 hover:bg-blue-600 text-white flex items-center justify-center disabled:opacity-50 transition-colors"
                              >
                                {addingTask === lt.id
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : <Plus className="h-3.5 w-3.5" />}
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {/* Custom task form */}
                  {addMode === 'custom' && (
                    <form onSubmit={handleAddCustomTask} className="flex flex-col gap-2.5 p-3">
                      <input
                        type="text"
                        placeholder="Task title…"
                        value={newTaskTitle}
                        onChange={e => setNewTaskTitle(e.target.value)}
                        autoFocus
                        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <input
                        type="text"
                        placeholder="Description (optional)"
                        value={newTaskDesc}
                        onChange={e => setNewTaskDesc(e.target.value)}
                        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <div className="flex gap-2">
                        <input
                          type="number"
                          placeholder="Reps (optional)"
                          value={newTaskReps}
                          onChange={e => setNewTaskReps(e.target.value)}
                          className="h-10 w-28 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <Button type="submit" size="sm" loading={addingTask === 'custom'} disabled={!newTaskTitle.trim()} className="flex-1">
                          <Plus className="h-3.5 w-3.5" /> Add
                        </Button>
                      </div>
                    </form>
                  )}
                </div>
              )
            })()}
          </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50">
          {clientId ? (
            <button
              onClick={() => router.push(`/clients/${clientId}`)}
              className="flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              <ExternalLink className="h-4 w-4" /> View client profile
            </button>
          ) : <span />}
          <DeleteSessionMenu
            deleting={deleting}
            canDeleteFollowing={!!session.clientPackageId}
            onConfirm={async (scope) => {
              const message = scope === 'following'
                ? 'Delete this session and every later one in the same package? This cannot be undone.'
                : 'Delete this session? This cannot be undone.'
              if (!confirm(message)) return
              setDeleting(true)
              try {
                await onDelete(session.id, scope)
                onClose()
              } finally {
                setDeleting(false)
              }
            }}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface PkgOption {
  id: string
  name: string
  description: string | null
  sessionCount: number
  weeksBetween: number
  durationMins: number
  sessionType: 'IN_PERSON' | 'VIRTUAL'
}

export function ScheduleView({
  sessions: initialSessions,
  availabilitySlots: initialAvailSlots,
  clients,
  packages,
  selectedDate,
  today,
  googleCalendarConnected,
  scheduleStartHour,
  scheduleEndHour,
  scheduleDays,
  scheduleExtraFields,
  customFields,
  clientExtras,
}: {
  sessions: Session[]
  availabilitySlots: AvailSlot[]
  clients: ClientOption[]
  packages: PkgOption[]
  selectedDate: string
  today: string
  googleCalendarConnected: boolean
  scheduleStartHour: number
  scheduleEndHour: number
  scheduleDays: number[]   // 1=Mon..7=Sun
  scheduleExtraFields: string[]
  customFields: CustomFieldMeta[]
  clientExtras: Record<string, ClientExtra>
}) {
  // Validate the persisted selection: drop entries that aren't a known
  // session field, a known client field, or a custom-field ID we still know
  // about. Keeps stale selections from breaking the renderer.
  const validCustomIds = new Set(customFields.map(f => f.id))
  const extraFields = scheduleExtraFields.filter(f =>
    f === 'location' || f === 'description' || f === 'sessionType' || f === 'duration' || f === 'title' ||
    f === 'email' || f === 'extraDogs' || f === 'compliance' ||
    (f.startsWith('custom:') && validCustomIds.has(f.slice('custom:'.length))),
  )
  const router = useRouter()

  // Default: week on desktop, day on mobile
  const [view, setView] = useState<'day' | 'week'>('week')
  useEffect(() => {
    if (window.innerWidth < 768) setView('day')
  }, [])

  const [sessions, setSessions]         = useState(initialSessions)
  const [availSlots, setAvailSlots]     = useState(initialAvailSlots)
  const [showAvail, setShowAvail]       = useState(false)
  // For the package-assign modal: { date: YYYY-MM-DD, time?: HH:mm }. When
  // opened from a calendar slot, time is the exact slot time so session 1 is
  // pinned to it. When opened from the header button, time is undefined and
  // session 1 uses availability search like the others.
  const [assignAt, setAssignAt]         = useState<{ date: string; time?: string } | null>(null)
  const [activeSession, setActiveSession] = useState<Session | null>(null)

  // Keep sessions in sync with server data on refresh
  useEffect(() => { setSessions(initialSessions) }, [initialSessions])
  useEffect(() => { setAvailSlots(initialAvailSlots) }, [initialAvailSlots])

  // Auto-mark sessions as COMPLETED once their scheduled time has passed
  useEffect(() => {
    const now = new Date()
    setSessions(prev => prev.map(s => {
      if (s.status === 'UPCOMING' && new Date(s.scheduledAt) < now) {
        // Fire-and-forget PATCH — non-critical
        fetch(`/api/schedule/${s.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'COMPLETED' }),
        })
        return { ...s, status: 'COMPLETED' as SessionStatus }
      }
      return s
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessions])

  const weekStart = getMondayOf(selectedDate)
  // Filter visible weekdays per trainer preference. JS getDay: 0=Sun..6=Sat;
  // schema convention: 1=Mon..7=Sun. Convert and intersect.
  const visibleDaySet = new Set(scheduleDays)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    .filter(d => {
      const js = d.getDay()
      const iso = js === 0 ? 7 : js
      return visibleDaySet.has(iso)
    })

  const weekLabel = (() => {
    const end = addDays(weekStart, 6)
    return weekStart.getMonth() === end.getMonth()
      ? weekStart.toLocaleDateString('en-NZ', { month: 'long', year: 'numeric' })
      : `${weekStart.toLocaleDateString('en-NZ', { month: 'short' })} – ${end.toLocaleDateString('en-NZ', { month: 'short', year: 'numeric' })}`
  })()

  function navigate(delta: number) {
    if (view === 'week') {
      // Always anchor to Monday so week boundaries are clean
      const monday = getMondayOf(selectedDate)
      const newDate = addDays(monday, delta * 7)
      router.push(`/schedule?date=${toDateStr(newDate)}`)
    } else {
      const d = parseLocalDate(selectedDate)
      d.setDate(d.getDate() + delta)
      router.push(`/schedule?date=${toDateStr(d)}`)
    }
  }

  function openAssignModal(dateStr: string, time?: string) {
    setAssignAt({ date: dateStr, time })
  }

  async function handleDeleteSession(id: string, scope: 'this' | 'following' = 'this') {
    const url = `/api/schedule/${id}${scope === 'following' ? '?scope=following' : ''}`
    const res = await fetch(url, { method: 'DELETE' })
    if (scope === 'following' && res.ok) {
      // Server returns the full list of deleted ids so we can prune locally.
      const body = await res.json().catch(() => ({}))
      const deletedIds: string[] = Array.isArray(body?.deletedIds) ? body.deletedIds : [id]
      setSessions(prev => prev.filter(s => !deletedIds.includes(s.id)))
    } else {
      setSessions(prev => prev.filter(s => s.id !== id))
    }
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
    setActiveSession(s)
  }

  function handleSessionStatusChange(id: string, status: SessionStatus) {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, status } : s))
    setActiveSession(prev => prev?.id === id ? { ...prev, status } : prev)
  }

  async function handleAddAvail(slot: AvailSlot) {
    setAvailSlots(prev => [...prev, slot])
  }

  async function handleUpdateAvail(slot: AvailSlot) {
    setAvailSlots(prev => prev.map(s => s.id === slot.id ? slot : s))
  }

  async function handleDeleteAvail(id: string) {
    await fetch(`/api/availability/${id}`, { method: 'DELETE' })
    setAvailSlots(prev => prev.filter(s => s.id !== id))
  }

  const daySessions = sessions.filter(s => toDateStr(new Date(s.scheduledAt)) === selectedDate)

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

          <ScheduleSettings
            startHour={scheduleStartHour}
            endHour={scheduleEndHour}
            days={scheduleDays}
            extraFields={extraFields}
            customFields={customFields}
          />

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

          <AssignPackageFromScheduleButton
            clients={clients.map(c => ({ id: c.id, name: c.name, dogs: c.dogs }))}
            packages={packages}
            availability={availSlots}
          />
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
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Click empty slot to assign a package</span>
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
            onSlotClick={openAssignModal}
            onSessionClick={handleSessionClick}
            onSessionDrop={handleSessionDrop}
            onDeleteAvail={handleDeleteAvail}
            startHour={scheduleStartHour}
            endHour={scheduleEndHour}
            extraFields={extraFields}
            clientExtras={clientExtras}
            customFields={customFields}
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
      {assignAt && (
        <AssignPackageFromScheduleModal
          clients={clients.map(c => ({ id: c.id, name: c.name, dogs: c.dogs }))}
          packages={packages}
          availability={availSlots}
          defaultStartDate={assignAt.date}
          defaultStartTime={assignAt.time}
          onClose={() => setAssignAt(null)}
        />
      )}

      {showAvail && (
        <AvailabilityManager
          slots={availSlots}
          onAdd={handleAddAvail}
          onUpdate={handleUpdateAvail}
          onDelete={handleDeleteAvail}
          onClose={() => setShowAvail(false)}
        />
      )}

      {activeSession && (
        <SessionModal
          session={activeSession}
          clients={clients}
          onClose={() => setActiveSession(null)}
          onStatusChange={handleSessionStatusChange}
          onSessionsUpdate={(id, updates) =>
            setSessions(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
          }
          onDelete={handleDeleteSession}
        />
      )}
    </div>
  )
}
