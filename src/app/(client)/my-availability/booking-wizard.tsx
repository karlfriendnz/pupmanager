'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  CalendarPlus, GraduationCap, Clock, Users, Video, MapPin, Check, CheckCircle2,
  Loader2, ChevronLeft, ArrowRight, CalendarDays, Repeat,
} from 'lucide-react'
import { openExternal } from '@/lib/external-link'
import { enumerateStartTimes, type AvailabilityRow, type BlackoutRow, type BusyInterval } from '@/lib/availability'
import { zonedToUtc, todayInTz } from '@/lib/timezone'

export interface WizardPackage {
  id: string
  name: string
  description: string | null
  sessionCount: number
  weeksBetween: number
  durationMins: number
  bufferMins: number
  sessionType: 'IN_PERSON' | 'VIRTUAL'
  priceCents: number | null
  selfBookRequiresApproval: boolean
  allowWaitlist: boolean
}

export interface WizardClass {
  id: string
  name: string
  scheduleNote: string | null
  packageName: string
  nextSessionAt: string | null
  // Upcoming sessions. spacesLeft and dropInPriceCents are per-session (a
  // drop-in class can cap and price each day differently), so the same list
  // doubles as the drop-in picker.
  sessions: {
    id: string
    at: string
    durationMins: number
    title: string
    spacesLeft: number | null
    dropInPriceCents: number | null
    /** This client already holds this session — not on offer again. */
    booked: boolean
  }[]
  seatsLeft: number | null
  fullPriceCents: number | null
  allowDropIn: boolean
  dropInPerSessionCents: number | null
  allowWaitlist: boolean
}

export interface PreviewDay {
  weekday: string
  dayLabel: string
  ranges: string[]
}

interface Availability {
  tz: string
  slots: AvailabilityRow[]
  blackouts: BlackoutRow[]
  busy: BusyInterval[]
}

// How far ahead the picker offers days — matches the server window.
const DAYS_AHEAD = 28
// Granularity of offered start times inside each window.
const STEP_MINS = 30

const CURRENCY_SYMBOLS: Record<string, string> = { nzd: '$', aud: '$', cad: '$', usd: '$', gbp: '£', eur: '€', zar: 'R' }

function price(cents: number | null, currency: string | null): string | null {
  if (cents == null) return null
  const sym = currency ? CURRENCY_SYMBOLS[currency.toLowerCase()] ?? '$' : '$'
  return `${sym}${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
}

function addDayStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Label a trainer-local date deterministically from its own calendar value — NOT
// via toLocaleDateString, which renders in the VIEWER's timezone and shows the
// wrong weekday for a client in a different tz than their trainer.
function dowIdx(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}
function fmtWeekday(dateStr: string): string { return WEEKDAY_SHORT[dowIdx(dateStr)] }
function fmtDayNum(dateStr: string): string { return String(Number(dateStr.split('-')[2])) }
function fmtFullDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number)
  return `${WEEKDAY_SHORT[dowIdx(dateStr)]} ${d} ${MONTH_SHORT[m - 1]}`
}
function fmtMonth(dateStr: string): string { return MONTH_SHORT[Number(dateStr.split('-')[1]) - 1] }

function fmtTimeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, '0')} ${period}`
}

// The UTC instant for a trainer-local date + "HH:MM".
function toUtcIso(dateStr: string, hhmm: string, tz: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [h, min] = hhmm.split(':').map(Number)
  return zonedToUtc(y, m, d, h, min, tz).toISOString()
}

// The wizard already knows the trainer's zone (props.tz) — use it. Without it
// this formatted in the SERVER's zone during SSR and the VIEWER's after
// hydration, so a class starting 6pm showed as 6am on the booking summary.
function fmtNextSession(iso: string | null, timeZone: string): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleString('en-NZ', { timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

type Selection =
  | { kind: 'session'; pkg: WizardPackage }
  | { kind: 'class'; cls: WizardClass }

type DoneMode = 'booked' | 'requested' | 'enrolled' | 'waitlisted'

export function BookingWizard(props: {
  businessName: string
  initials: string
  tz: string
  availability: Availability
  packages: WizardPackage[]
  classes: WizardClass[]
  dogs: { id: string; name: string }[]
  defaultDogId: string | null
  acceptPayments: boolean
  currency: string | null
  previewDays: PreviewDay[]
}) {
  const { businessName, initials, tz, availability, packages, classes, dogs, defaultDogId, acceptPayments, currency, previewDays } = props

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [selection, setSelection] = useState<Selection | null>(null)

  // Session (package) picker state.
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')

  // Class options state.
  const [dogId, setDogId] = useState<string | null>(defaultDogId)
  const [classType, setClassType] = useState<'FULL' | 'DROP_IN'>('FULL')
  // Which sessions a drop-in is for. Several at once: someone coming to three
  // Saturdays shouldn't pay for them one checkout at a time.
  const [dropInSessionIds, setDropInSessionIds] = useState<string[]>([])
  const toggleSession = (id: string) =>
    setDropInSessionIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<DoneMode | null>(null)

  const pkg = selection?.kind === 'session' ? selection.pkg : null
  const cls = selection?.kind === 'class' ? selection.cls : null

  // Bookable start times on a given day — always dropping any that have already
  // been and gone. The past-filter belongs HERE, not just on the chosen day:
  // otherwise today keeps being offered after its last slot has passed, the day
  // auto-selects, no time can, and the wizard dead-ends on "Pick a time" with
  // nothing to pick. (Only reproducible late in the trainer's day.)
  const startTimesFor = useCallback((dateStr: string) => {
    if (!pkg) return []
    const now = Date.now()
    return enumerateStartTimes(availability.slots, dateStr, pkg.durationMins, availability.blackouts, STEP_MINS, availability.busy, pkg.bufferMins)
      .filter(t => new Date(toUtcIso(dateStr, t, tz)).getTime() > now)
  }, [pkg, availability, tz])

  // Days in the window that can still hold this package's first session.
  const availableDates = useMemo(() => {
    if (!pkg) return []
    const today = todayInTz(tz)
    const out: string[] = []
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const dateStr = addDayStr(today, i)
      if (startTimesFor(dateStr).length > 0) out.push(dateStr)
    }
    return out
  }, [pkg, tz, startTimesFor])

  // Valid start times for the chosen day.
  const timeOptions = useMemo(() => (date ? startTimesFor(date) : []), [date, startTimesFor])

  // Keep the selected day valid as the package changes.
  useEffect(() => {
    if (!pkg) return
    if (availableDates.length === 0) { setDate(''); return }
    if (!availableDates.includes(date)) setDate(availableDates[0])
  }, [pkg, availableDates, date])

  // Keep the selected time valid as the day changes.
  useEffect(() => {
    if (timeOptions.length === 0) { setTime(''); return }
    if (!timeOptions.includes(time)) setTime(timeOptions[0])
  }, [timeOptions, time])

  const nothingToBook = packages.length === 0 && classes.length === 0

  function chooseSession(p: WizardPackage) {
    setSelection({ kind: 'session', pkg: p })
    setError(null)
    setStep(2)
  }
  function chooseClass(c: WizardClass) {
    setSelection({ kind: 'class', cls: c })
    // A drop-in class is SOLD per session, so that's the state it opens in —
    // the picker is the page. "All of them" is Select all, not a separate
    // full-course mode the client has to find first.
    setClassType(c.allowDropIn && c.dropInPerSessionCents != null ? 'DROP_IN' : 'FULL')
    setDropInSessionIds([])
    setDogId(defaultDogId)
    setError(null)
    setStep(2)
  }
  function back() {
    setError(null)
    if (step === 3) setStep(2)
    else if (step === 2) { setStep(1); setSelection(null) }
  }

  async function joinWaitlist() {
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/my/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: pkg?.id ?? null }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        setError(typeof b.error === 'string' ? b.error : 'Could not join the waitlist.')
        return
      }
      setDone('waitlisted')
    } finally {
      setSaving(false)
    }
  }

  async function confirm() {
    setError(null)
    setSaving(true)
    try {
      if (selection?.kind === 'session') {
        if (!date || !time) { setError('Pick an available time.'); return }
        const res = await fetch('/api/my/self-book', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packageId: selection.pkg.id, startDate: toUtcIso(date, time, tz) }),
        })
        const b = await res.json().catch(() => ({}))
        if (!res.ok) { setError(typeof b.error === 'string' ? b.error : 'Could not book.'); return }
        if (b.mode === 'payment' && b.url) { openExternal(b.url); return } // keep spinner while we leave for Stripe
        setDone(b.mode === 'booked' ? 'booked' : 'requested')
      } else if (selection?.kind === 'class') {
        if (classType === 'DROP_IN' && dropInSessionIds.length === 0) { setError('Pick which sessions to drop into.'); return }
        const res = await fetch(`/api/my/classes/${selection.cls.id}/enroll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: classType, dogId, sessionIds: classType === 'DROP_IN' ? dropInSessionIds : undefined }),
        })
        const b = await res.json().catch(() => ({}))
        if (!res.ok) { setError(typeof b.error === 'string' ? b.error : 'Could not join.'); return }
        if (b.mode === 'payment' && b.url) { openExternal(b.url); return }
        setDone(b.mode === 'waitlisted' ? 'waitlisted' : 'enrolled')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // ---------- success ----------
  if (done) {
    const copy: Record<DoneMode, { title: string; sub: string }> = {
      booked: { title: "You're booked in! 🎉", sub: `Your sessions with ${businessName} are on the calendar — see them in your Sessions tab.` },
      requested: { title: 'Request sent', sub: `${businessName} will confirm the time and you'll get a notification.` },
      enrolled: { title: "You're enrolled! 🎉", sub: `See ${cls?.name ?? 'the class'} in your Sessions tab.` },
      waitlisted: { title: "You're on the waitlist", sub: `${businessName} will be in touch the moment a spot opens up.` },
    }
    return (
      <Shell step={null}>
        <div className="flex flex-col items-center text-center py-10">
          <div className="h-16 w-16 rounded-full bg-accent-soft flex items-center justify-center">
            <CheckCircle2 className="h-8 w-8 text-accent" />
          </div>
          <h2 className="mt-5 text-lg font-bold text-slate-900">{copy[done].title}</h2>
          <p className="mt-1.5 text-sm text-slate-500 max-w-xs leading-relaxed">{copy[done].sub}</p>
          <button
            onClick={() => { setDone(null); setSelection(null); setStep(1) }}
            className="mt-7 w-full max-w-xs rounded-2xl bg-slate-900 text-white text-sm font-semibold py-3.5 hover:bg-slate-800 transition-colors"
          >
            Done
          </button>
        </div>
      </Shell>
    )
  }

  return (
    <Shell step={nothingToBook ? null : step} onBack={step > 1 ? back : undefined}>
      {/* ---------- STEP 1 · choose ---------- */}
      {step === 1 && (
        nothingToBook ? (
          <EmptyState businessName={businessName} previewDays={previewDays} onWaitlist={joinWaitlist} saving={saving} error={error} />
        ) : (
          <div className="flex flex-col gap-6">
            <StepIntro title="What would you like to book?" sub={`Pick a session or class with ${businessName}.`} />

            {packages.length > 0 && (
              <section>
                <SectionLabel icon={<CalendarPlus className="h-3.5 w-3.5" />} text="1-on-1 sessions" />
                <div className="flex flex-col gap-2.5">
                  {packages.map(p => (
                    <button key={p.id} onClick={() => chooseSession(p)} className="group text-left rounded-2xl bg-white border border-slate-100 shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-4 hover:border-accent/40 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[15px] font-semibold text-slate-900">{p.name}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500">
                            <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{p.durationMins} min</span>
                            <span className="inline-flex items-center gap-1">
                              {p.sessionType === 'VIRTUAL' ? <Video className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
                              {p.sessionType === 'VIRTUAL' ? 'Virtual' : 'In person'}
                            </span>
                            {p.sessionCount > 1 && <span className="inline-flex items-center gap-1"><Repeat className="h-3 w-3" />{p.sessionCount} sessions</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {price(p.priceCents, currency) && <span className="text-sm font-semibold text-slate-900">{price(p.priceCents, currency)}</span>}
                          <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-accent transition-colors" />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {classes.length > 0 && (
              <section>
                <SectionLabel icon={<GraduationCap className="h-3.5 w-3.5" />} text="Group classes" />
                <div className="flex flex-col gap-2.5">
                  {classes.map(c => {
                    const isFull = c.seatsLeft === 0
                    return (
                      <button key={c.id} onClick={() => chooseClass(c)} className="group text-left rounded-2xl bg-white border border-slate-100 shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-4 hover:border-accent/40 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[15px] font-semibold text-slate-900">{c.name}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{c.packageName}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500">
                              {c.scheduleNote && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" />{c.scheduleNote}</span>}
                              {c.seatsLeft != null && (
                                <span className={`inline-flex items-center gap-1 ${isFull ? 'text-amber-600' : ''}`}><Users className="h-3 w-3" />{isFull ? 'Full' : `${c.seatsLeft} left`}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {price(c.fullPriceCents, currency) && <span className="text-sm font-semibold text-slate-900">{price(c.fullPriceCents, currency)}</span>}
                            <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-accent transition-colors" />
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </section>
            )}
          </div>
        )
      )}

      {/* ---------- STEP 2 · configure ---------- */}
      {step === 2 && pkg && (
        <SessionTimeStep
          pkg={pkg}
          availableDates={availableDates}
          timeOptions={timeOptions}
          date={date}
          time={time}
          onDate={setDate}
          onTime={setTime}
          onContinue={() => { setError(null); setStep(3) }}
          onWaitlist={joinWaitlist}
          saving={saving}
        />
      )}

      {step === 2 && cls && (
        <ClassOptionsStep
          tz={props.tz}
          cls={cls}
          currency={currency}
          acceptPayments={acceptPayments}
          dogs={dogs}
          dogId={dogId}
          onDog={setDogId}
          classType={classType}
          dropInSessionIds={dropInSessionIds}
          onSessionToggle={toggleSession}
          onSessionsSet={setDropInSessionIds}
          onContinue={() => { setError(null); setStep(3) }}
        />
      )}

      {/* ---------- STEP 3 · confirm ---------- */}
      {step === 3 && selection && (
        <ConfirmStep
          tz={props.tz}
          selection={selection}
          date={date}
          time={time}
          currency={currency}
          acceptPayments={acceptPayments}
          classType={classType}
          dropInSessionIds={dropInSessionIds}
          dogName={dogs.find(d => d.id === dogId)?.name ?? null}
          saving={saving}
          error={error}
          onConfirm={confirm}
        />
      )}
    </Shell>
  )
}

/* ============================ layout shell ============================ */

// No business name or logo here — the app shell around this page already
// carries both, and repeating them pushed the actual booking below the fold.
// Only the back arrow survives, and only when there's somewhere to go back to.
function Shell({ step, onBack, children }: {
  step: 1 | 2 | 3 | null
  onBack?: () => void
  children: React.ReactNode
}) {
  const labels = ['Choose', 'Details', 'Confirm']
  return (
    <div className="px-4 pt-5 pb-10 max-w-xl mx-auto w-full">
      {onBack && (
        <button onClick={onBack} aria-label="Back" className="-ml-1.5 mb-1 flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100">
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}

      {step !== null && (
        <div className="flex items-center gap-2" aria-hidden="true">
          {labels.map((label, i) => {
            const n = (i + 1) as 1 | 2 | 3
            const active = n === step
            const doneStep = n < step
            return (
              <div key={label} className="flex items-center gap-2 flex-1">
                <div className={`flex items-center gap-1.5 ${active || doneStep ? 'text-accent' : 'text-slate-300'}`}>
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${active ? 'bg-accent text-accent-fg' : doneStep ? 'bg-accent-soft text-accent' : 'bg-slate-100 text-slate-400'}`}>
                    {doneStep ? <Check className="h-3 w-3" /> : n}
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-wide hidden sm:inline">{label}</span>
                </div>
                {i < labels.length - 1 && <div className={`h-px flex-1 ${doneStep ? 'bg-accent/40' : 'bg-slate-100'}`} />}
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-6">{children}</div>
    </div>
  )
}

function StepIntro({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h1 className="text-xl font-bold text-slate-900 tracking-tight">{title}</h1>
      <p className="text-sm text-slate-500 mt-1">{sub}</p>
    </div>
  )
}

function SectionLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-2.5 text-accent">
      {icon}
      <h2 className="text-xs font-bold uppercase tracking-wide">{text}</h2>
    </div>
  )
}

/* ============================ step 2 · session time ============================ */

function SessionTimeStep({ pkg, availableDates, timeOptions, date, time, onDate, onTime, onContinue, onWaitlist, saving }: {
  pkg: WizardPackage
  availableDates: string[]
  timeOptions: string[]
  date: string
  time: string
  onDate: (d: string) => void
  onTime: (t: string) => void
  onContinue: () => void
  onWaitlist: () => void
  saving: boolean
}) {
  const noDays = availableDates.length === 0
  return (
    <div className="flex flex-col gap-5">
      <StepIntro title="Pick a time" sub={`${pkg.name} · ${pkg.durationMins} min${pkg.sessionCount > 1 ? ` · ${pkg.sessionCount} sessions, every ${pkg.weeksBetween} week${pkg.weeksBetween === 1 ? '' : 's'}` : ''}`} />

      {noDays ? (
        <div className="rounded-2xl bg-slate-50 border border-slate-100 p-5 text-center">
          <p className="text-sm text-slate-600">No open times in the next four weeks.</p>
          {/* Only offer the waitlist if the trainer keeps one for this package —
              otherwise it's a promise of a call-back nobody agreed to make. */}
          {pkg.allowWaitlist && (
            <button onClick={onWaitlist} disabled={saving} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 text-sm font-medium px-4 py-2 hover:bg-white disabled:opacity-50">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}Join the waitlist instead
            </button>
          )}
        </div>
      ) : (
        <>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Choose a day</p>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {availableDates.map(d => {
                const on = d === date
                return (
                  <button key={d} onClick={() => onDate(d)} className={`flex-none w-[54px] rounded-2xl py-2.5 text-center border transition-colors ${on ? 'bg-accent border-accent text-accent-fg' : 'bg-white border-slate-200 text-slate-900 hover:border-accent/40'}`}>
                    <span className={`block text-[10px] font-bold uppercase ${on ? 'text-accent-fg/80' : 'text-slate-400'}`}>{fmtWeekday(d)}</span>
                    <span className="block text-lg font-bold leading-tight">{fmtDayNum(d)}</span>
                    <span className={`block text-[9px] font-semibold uppercase ${on ? 'text-accent-fg/70' : 'text-slate-300'}`}>{fmtMonth(d)}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">{date ? `${fmtFullDate(date)} · ${timeOptions.length} open` : 'Start time'}</p>
            {timeOptions.length === 0 ? (
              <p className="text-sm text-slate-500 rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3">No times left this day — try another.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {timeOptions.map(t => {
                  const on = t === time
                  return (
                    <button key={t} onClick={() => onTime(t)} className={`rounded-xl py-2.5 text-sm font-semibold tabular-nums border transition-colors ${on ? 'bg-accent border-accent text-accent-fg' : 'border-accent/30 text-accent hover:bg-accent-soft'}`}>
                      {fmtTimeLabel(t)}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      {!noDays && (
        <StickyCta disabled={!time} onClick={onContinue}>
          {time ? `Continue · ${fmtTimeLabel(time)}` : 'Pick a time'}
        </StickyCta>
      )}
    </div>
  )
}

/* ============================ step 2 · class options ============================ */

function ClassOptionsStep({ cls, tz, currency, acceptPayments, dogs, dogId, onDog, classType, dropInSessionIds, onSessionToggle, onSessionsSet, onContinue }: {
  tz: string
  cls: WizardClass
  currency: string | null
  acceptPayments: boolean
  dogs: { id: string; name: string }[]
  dogId: string | null
  onDog: (id: string) => void
  classType: 'FULL' | 'DROP_IN'
  dropInSessionIds: string[]
  onSessionToggle: (id: string) => void
  /** Replace the whole selection — Select all / Clear all. */
  onSessionsSet: (ids: string[]) => void
  onContinue: () => void
}) {
  const isFull = cls.seatsLeft === 0
  const paidButNoPayments = !!cls.fullPriceCents && !acceptPayments
  const drop = price(cls.dropInPerSessionCents, currency)
  const dropping = classType === 'DROP_IN'
  // Drop-ins pick sessions; the whole class being "full" for the term doesn't
  // block a single session that still has room.
  const needsSession = dropping && dropInSessionIds.length === 0
  // What's actually on offer: not already theirs, and not full.
  const bookable = cls.sessions.filter(s => !s.booked && s.spacesLeft !== 0)
  const allPicked = bookable.length > 0 && dropInSessionIds.length === bookable.length

  return (
    <div className="flex flex-col gap-5">
      <StepIntro title={cls.name} sub={cls.packageName} />

      {/* Only when there's something to put in it. A class with no schedule
          note and no capacity has neither row, and the card was rendering as
          an empty white box above the schedule. */}
      {(cls.scheduleNote || (!dropping && cls.seatsLeft != null)) && (
        <div className="rounded-2xl bg-white border border-slate-100 shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-4 flex flex-col gap-2.5 text-sm">
          {cls.scheduleNote && <Row icon={<CalendarDays className="h-4 w-4" />} text={cls.scheduleNote} />}
          {!dropping && cls.seatsLeft != null && <Row icon={<Users className="h-4 w-4" />} text={isFull ? (cls.allowWaitlist ? 'Full — join the waitlist' : 'Full') : `${cls.seatsLeft} spot${cls.seatsLeft === 1 ? '' : 's'} left`} />}
        </div>
      )}

      {/* The one place a class's sessions are listed. Read-only for a full
          course; the SAME list becomes the picker when dropping in — one
          component, so the client never learns two different layouts. */}
      {cls.sessions.length > 0 && (
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
              {dropping ? 'Pick the sessions you want' : 'Session schedule'} <span className="text-slate-300">· {cls.sessions.length}</span>
            </p>
            {/* Taking the whole course IS ticking every session — one control
                rather than a separate full-course mode to find first. Only
                what's actually bookable: sessions they hold or that are full
                aren't on offer. */}
            {dropping && bookable.length > 0 && (
              <button
                type="button"
                onClick={() => onSessionsSet(allPicked ? [] : bookable.map(s => s.id))}
                className="shrink-0 text-xs font-semibold text-accent hover:underline"
              >
                {allPicked ? 'Clear all' : `Select all ${bookable.length}`}
              </button>
            )}
          </div>
          <div className="rounded-2xl bg-white border border-slate-100 shadow-[0_2px_16px_rgba(15,31,36,0.05)] overflow-hidden">
            {cls.sessions.map((s, i) => {
              const sessionFull = s.spacesLeft === 0
              const selected = dropping && dropInSessionIds.includes(s.id)
              // Theirs already — never selectable, and it says so rather than
              // looking like an option that silently fails.
              const mine = dropping && s.booked
              const rowInner = (
                <>
                  {/* The number badge becomes a tick once picked — several can
                      be on at once, so each row has to say whether it's in. */}
                  <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold shrink-0 tabular-nums ${
                    selected ? 'bg-accent text-accent-fg' : mine ? 'bg-emerald-100 text-emerald-700' : 'bg-accent-soft text-accent'
                  }`}>
                    {selected || mine ? <Check className="h-4 w-4" /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">{fmtNextSession(s.at, tz)}</p>
                    {s.title && <p className="text-xs text-slate-400 truncate">{s.title}</p>}
                  </div>
                  {dropping
                    ? mine
                      ? <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">You&apos;re booked</span>
                      : (
                        // Price first (it's what they're deciding on), spaces under it.
                        <span className="shrink-0 text-right">
                          {price(s.dropInPriceCents, currency) && (
                            <span className="block text-sm font-semibold text-slate-800">{price(s.dropInPriceCents, currency)}</span>
                          )}
                          <span className={`block text-xs ${sessionFull ? 'text-rose-500' : 'text-emerald-600'}`}>
                            {s.spacesLeft == null ? `${s.durationMins} min` : sessionFull ? 'Full' : `${s.spacesLeft} left`}
                          </span>
                        </span>
                      )
                    : <span className="text-xs text-slate-400 shrink-0">{s.durationMins} min</span>}
                </>
              )
              return dropping ? (
                <button
                  key={s.id}
                  type="button"
                  disabled={sessionFull || mine}
                  onClick={() => onSessionToggle(s.id)}
                  // A session they hold isn't "unavailable" — it's theirs, so it
                  // reads normally rather than greyed out like a full one.
                  className={`w-full flex items-center gap-3 px-4 py-2.5 border-t border-slate-100 first:border-t-0 text-left transition-colors ${
                    selected ? 'bg-accent-soft' : mine ? 'bg-emerald-50/40 cursor-default' : 'hover:bg-slate-50'
                  } ${mine ? '' : 'disabled:opacity-40 disabled:cursor-not-allowed'}`}
                >
                  {rowInner}
                </button>
              ) : (
                <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 border-t border-slate-100 first:border-t-0">
                  {rowInner}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {dogs.length > 1 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Which dog?</p>
          <div className="flex flex-wrap gap-2">
            {dogs.map(d => (
              <button key={d.id} onClick={() => onDog(d.id)} className={`rounded-xl px-4 py-2 text-sm font-semibold border transition-colors ${d.id === dogId ? 'bg-accent border-accent text-accent-fg' : 'bg-white border-slate-200 text-slate-700 hover:border-accent/40'}`}>
                {d.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {paidButNoPayments ? (
        <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm text-slate-500">
          This class needs payment your trainer hasn&apos;t switched on yet — ask them to enrol you.
        </div>
      ) : dropping ? (
        <StickyCta disabled={needsSession} onClick={onContinue}>
          {needsSession
            ? 'Pick your sessions above'
            : `Continue · ${dropInSessionIds.length} session${dropInSessionIds.length === 1 ? '' : 's'}`}
        </StickyCta>
      ) : (
        <StickyCta disabled={isFull && !cls.allowWaitlist} onClick={onContinue}>
          {isFull ? (cls.allowWaitlist ? 'Continue to waitlist' : 'Class is full') : 'Continue'}
        </StickyCta>
      )}
    </div>
  )
}

function Row({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2.5 text-slate-600">
      <span className="text-accent">{icon}</span>
      <span>{text}</span>
    </div>
  )
}

/* ============================ step 3 · confirm ============================ */

function ConfirmStep({ selection, tz, date, time, currency, acceptPayments, classType, dropInSessionIds, dogName, saving, error, onConfirm }: {
  tz: string
  selection: Selection
  date: string
  time: string
  currency: string | null
  acceptPayments: boolean
  classType: 'FULL' | 'DROP_IN'
  dropInSessionIds: string[]
  dogName: string | null
  saving: boolean
  error: string | null
  onConfirm: () => void
}) {
  const isSession = selection.kind === 'session'
  const pkg = selection.kind === 'session' ? selection.pkg : null
  const cls = selection.kind === 'class' ? selection.cls : null
  const dropInSessions = cls && classType === 'DROP_IN' ? cls.sessions.filter(s => dropInSessionIds.includes(s.id)) : []

  // A drop-in can't be "full" — it only exists once a session has room.
  const isFull = classType === 'FULL' && cls?.seatsLeft === 0
  // Each session is charged at its own rate, which can differ session to
  // session, so several sessions is the SUM — not one price shown for what's
  // actually three bookings. Falls back to the class's headline rate.
  const priceCents = isSession
    ? pkg!.priceCents
    : classType === 'DROP_IN'
      ? dropInSessions.reduce<number | null>(
          (sum, s) => {
            const p = s.dropInPriceCents ?? cls!.dropInPerSessionCents
            return p == null ? sum : (sum ?? 0) + p
          },
          null,
        )
      : cls!.fullPriceCents
  const needsApproval = isSession && pkg!.selfBookRequiresApproval
  const priceLabel = price(priceCents, currency)

  // Whether confirming will pop the card box (Stripe Checkout). Only when it's an
  // instant (auto-approve) priced booking AND the trainer takes cards. Otherwise
  // it books now and the trainer invoices later — no payment box.
  const willCharge = !!priceCents && acceptPayments && !needsApproval && !isFull

  let ctaText: string
  if (isSession) ctaText = needsApproval ? 'Request booking' : willCharge ? `Pay ${priceLabel} & book` : 'Confirm booking'
  else if (isFull) ctaText = 'Join waitlist'
  else ctaText = willCharge ? `Pay ${priceLabel} & join` : 'Confirm & join'

  return (
    <div className="flex flex-col gap-5">
      <StepIntro title="Confirm your booking" sub="One last look before it's locked in." />

      <div className="rounded-2xl bg-white border border-slate-100 shadow-[0_2px_16px_rgba(15,31,36,0.05)] overflow-hidden">
        <div className="px-4 py-3.5 border-b border-slate-100">
          <p className="text-[15px] font-bold text-slate-900">{isSession ? pkg!.name : cls!.name}</p>
          <p className="text-xs text-slate-500 mt-0.5">{isSession ? (pkg!.sessionType === 'VIRTUAL' ? 'Virtual session' : 'In-person session') : cls!.packageName}</p>
        </div>
        <dl className="divide-y divide-slate-100">
          {isSession ? (
            <>
              <SummaryRow label="When" value={`${fmtFullDate(date)} · ${fmtTimeLabel(time)}`} />
              <SummaryRow label="Length" value={`${pkg!.durationMins} min`} />
              {pkg!.sessionCount > 1 && <SummaryRow label="Sessions" value={`${pkg!.sessionCount}, every ${pkg!.weeksBetween} week${pkg!.weeksBetween === 1 ? '' : 's'}`} />}
            </>
          ) : (
            <>
              {cls!.scheduleNote && <SummaryRow label="Schedule" value={cls!.scheduleNote} />}
              <SummaryRow
                label="Type"
                value={classType === 'DROP_IN'
                  ? `Drop-in · ${dropInSessions.length} session${dropInSessions.length === 1 ? '' : 's'}`
                  : 'Full course'}
              />
              {/* Every session they're paying for, listed — the total below
                  covers all of them, so it has to be clear what's in it. */}
              {classType === 'DROP_IN'
                ? dropInSessions.map((s, i) => (
                    <SummaryRow
                      key={s.id}
                      label={i === 0 ? (dropInSessions.length === 1 ? 'Session' : 'Sessions') : ''}
                      value={fmtNextSession(s.at, tz) ?? ''}
                    />
                  ))
                : fmtNextSession(cls!.nextSessionAt, tz) && <SummaryRow label="Starts" value={fmtNextSession(cls!.nextSessionAt, tz)!} />}
            </>
          )}
          {dogName && <SummaryRow label="Dog" value={dogName} />}
          <SummaryRow label="Price" value={priceLabel ?? 'Free'} strong />
        </dl>
      </div>

      {needsApproval && (
        <p className="text-xs text-slate-500 flex items-start gap-2 rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-3">
          <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-slate-400" />
          This trainer approves bookings first — you won&apos;t be charged until they confirm the time.
        </p>
      )}

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <StickyCta disabled={saving} onClick={onConfirm} loading={saving}>{ctaText}</StickyCta>
    </div>
  )
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <dt className="text-xs font-medium text-slate-400 uppercase tracking-wide">{label}</dt>
      <dd className={`text-sm text-right ${strong ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}`}>{value}</dd>
    </div>
  )
}

/* ============================ empty state ============================ */

function EmptyState({ businessName, previewDays, onWaitlist, saving, error }: {
  businessName: string
  previewDays: PreviewDay[]
  onWaitlist: () => void
  saving: boolean
  error: string | null
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl bg-white border border-slate-100 shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-6 text-center">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-accent-soft flex items-center justify-center">
          <CalendarPlus className="h-6 w-6 text-accent" />
        </div>
        <p className="mt-3 text-sm font-semibold text-slate-700">Nothing to self-book right now</p>
        <p className="mt-1 text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
          {businessName} hasn&apos;t opened any sessions or classes for self-booking yet. Join the waitlist and they&apos;ll reach out.
        </p>
        <button onClick={onWaitlist} disabled={saving} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-accent text-accent-fg text-sm font-semibold px-5 py-2.5 disabled:opacity-50">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}Join the waitlist
        </button>
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      </div>

      {previewDays.length > 0 && (
        <section>
          <SectionLabel icon={<Clock className="h-3.5 w-3.5" />} text="Their open times" />
          <div className="flex flex-col gap-2">
            {previewDays.map((d, i) => (
              <div key={i} className="flex items-start gap-3 rounded-xl bg-white border border-slate-100 px-4 py-3">
                <div className="w-16 shrink-0">
                  <p className="text-sm font-semibold text-slate-900">{d.weekday}</p>
                  <p className="text-xs text-slate-400">{d.dayLabel}</p>
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {d.ranges.map((r, j) => (
                    <li key={j} className="inline-flex items-center gap-1 rounded-lg bg-accent-soft text-accent px-2.5 py-1 text-xs font-medium tabular-nums">
                      <Clock className="h-3 w-3" />{r}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

/* ============================ primary CTA ============================ */

// Full-width, in-flow action button. Sits at the end of each step's content so
// it stays aligned to the wizard's content column and never slides under the
// desktop sidebar or over the mobile bottom-tab bar.
function StickyCta({ children, disabled, loading, onClick }: { children: React.ReactNode; disabled?: boolean; loading?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="mt-1 w-full rounded-2xl bg-accent text-accent-fg text-[15px] font-semibold py-3.5 shadow-[0_6px_20px_rgba(15,31,36,0.14)] disabled:opacity-40 inline-flex items-center justify-center gap-2 transition-opacity"
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}
