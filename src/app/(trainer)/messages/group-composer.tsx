'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Check, GraduationCap, Megaphone, Package as PackageIcon,
  Search, Star, Users, UsersRound,
} from 'lucide-react'
import { ModalPortal } from '@/components/shared/modal-portal'
import { FlatBlock, FlatRow, SectionLabel } from '@/components/shared/flat-list'
import { cn } from '@/lib/utils'

// Create a group — a named thread the trainer posts into over time, not a
// one-off send. Full screen, because choosing an audience is more than three
// choices and the mode decision needs room to be explained properly.
//
// The mode step is the consequential one. A trainer who thinks they are
// broadcasting and has actually built a community has exposed their client
// list to itself, so it is a deliberate two-option screen with the
// consequence spelled out — never a toggle tucked beside the name field.

export interface AudienceOption {
  id: string
  name: string
  count: number
}

export interface PickableClient {
  id: string
  displayName: string
  dogName: string | null
}

interface Props {
  classRuns: AudienceOption[]
  packages: AudienceOption[]
  memberships: AudienceOption[]
  clients: PickableClient[]
  activeClientCount: number
  /** Pre-ticked clients, e.g. handed over from the clients-list multi-select. */
  initialClientIds?: string[]
  onClose: () => void
}

type Step = 'audience' | 'people' | 'mode' | 'name'
type Audience =
  | { scope: 'CLASS_RUN' | 'PACKAGE' | 'MEMBERSHIP'; id: string; label: string; count: number }
  | { scope: 'MANUAL'; ids: string[]; label: string; count: number }
  | { scope: 'ALL_CLIENTS'; label: string; count: number }

/** Above this the create button asks for a second tap. Not a restriction — the
 *  one thing between a trainer and an unrecallable message to everyone. */
const CONFIRM_ABOVE = 25

export function GroupComposer({
  classRuns, packages, memberships, clients, activeClientCount, initialClientIds, onClose,
}: Props) {
  const router = useRouter()
  // Handed a selection already? Skip straight past the picker.
  const [step, setStep] = useState<Step>(initialClientIds?.length ? 'mode' : 'audience')
  const [audience, setAudience] = useState<Audience | null>(
    initialClientIds?.length
      ? {
          scope: 'MANUAL',
          ids: initialClientIds,
          label: `${initialClientIds.length} chosen`,
          count: initialClientIds.length,
        }
      : null,
  )
  const [mode, setMode] = useState<'BROADCAST' | 'COMMUNITY' | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set(initialClientIds ?? []))
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [includeWaitlist, setIncludeWaitlist] = useState(false)
  const [important, setImportant] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Never two scrollbars: the page behind must not scroll while this is open.
  // The below-md rule in globals.css can't do this — it keys off VIEWPORT
  // width, so a narrow desktop window would still show a second rail.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const filteredClients = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clients
    return clients.filter(c =>
      c.displayName.toLowerCase().includes(q) || (c.dogName ?? '').toLowerCase().includes(q))
  }, [clients, query])

  function chooseGroup(scope: 'CLASS_RUN' | 'PACKAGE' | 'MEMBERSHIP', o: AudienceOption) {
    setAudience({ scope, id: o.id, label: o.name, count: o.count })
    setName(o.name)
    setStep('mode')
  }

  function chooseEveryone() {
    setAudience({ scope: 'ALL_CLIENTS', label: 'Everyone', count: activeClientCount })
    setName('Everyone')
    setStep('mode')
  }

  function confirmPeople() {
    const ids = [...picked]
    setAudience({ scope: 'MANUAL', ids, label: `${ids.length} chosen`, count: ids.length })
    setStep('mode')
  }

  async function create() {
    if (!audience || !mode || busy) return
    const finalName = name.trim()
    if (!finalName) { setError('Give the group a name.'); return }
    if (audience.count > CONFIRM_ABOVE && !confirming) { setConfirming(true); return }
    setBusy(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        name: finalName,
        mode,
        scope: audience.scope,
        important,
      }
      if (audience.scope === 'MANUAL') payload.clientIds = audience.ids
      if (audience.scope === 'CLASS_RUN') { payload.classRunId = audience.id; payload.includeWaitlist = includeWaitlist }
      if (audience.scope === 'PACKAGE') payload.packageId = audience.id
      if (audience.scope === 'MEMBERSHIP') payload.membershipId = audience.id

      const res = await fetch('/api/message-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not create that group.')
        setBusy(false)
        setConfirming(false)
        return
      }
      onClose()
      router.push(`/messages?group=${data.groupId}`)
      router.refresh()
    } catch {
      setError('Could not create that group.')
      setBusy(false)
      setConfirming(false)
    }
  }

  const title =
    step === 'audience' ? 'Who is in this group?'
    : step === 'people' ? 'Choose people'
    : step === 'mode' ? 'How should it work?'
    : 'Name the group'

  function back() {
    setError(null)
    setConfirming(false)
    if (step === 'name') setStep('mode')
    else if (step === 'mode') setStep(audience?.scope === 'MANUAL' ? 'people' : 'audience')
    else if (step === 'people') setStep('audience')
    else onClose()
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex flex-col bg-white" data-testid="group-composer">
        <div
          className="flex items-center gap-2 border-b border-slate-200 px-2 pr-4"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.625rem)', paddingBottom: '0.625rem' }}
        >
          <button
            type="button"
            onClick={back}
            aria-label={step === 'audience' ? 'Close' : 'Back'}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{title}</h2>
          {step === 'people' && picked.size > 0 && (
            <button
              type="button"
              onClick={confirmPeople}
              className="flex-shrink-0 text-sm font-semibold text-blue-600 hover:text-blue-700"
            >
              Next ({picked.size})
            </button>
          )}
        </div>

        {/* The only scrolling region on screen while this is open. */}
        <div className="no-scrollbar flex-1 overflow-y-auto">
          {step === 'audience' ? (
            <AudienceStep
              classRuns={classRuns}
              packages={packages}
              memberships={memberships}
              clientCount={clients.length}
              activeClientCount={activeClientCount}
              onGroup={chooseGroup}
              onEveryone={chooseEveryone}
              onPeople={() => setStep('people')}
            />
          ) : step === 'people' ? (
            <PeopleStep
              clients={filteredClients}
              total={clients.length}
              picked={picked}
              query={query}
              setQuery={setQuery}
              toggle={id => setPicked(prev => {
                const next = new Set(prev)
                if (next.has(id)) next.delete(id); else next.add(id)
                return next
              })}
              selectAll={() => setPicked(new Set(filteredClients.map(c => c.id)))}
              clearAll={() => setPicked(new Set())}
            />
          ) : step === 'mode' ? (
            <ModeStep mode={mode} setMode={m => { setMode(m); setStep('name') }} count={audience?.count ?? 0} />
          ) : (
            <NameStep
              name={name}
              setName={setName}
              audience={audience}
              mode={mode}
              important={important}
              setImportant={setImportant}
              includeWaitlist={includeWaitlist}
              setIncludeWaitlist={setIncludeWaitlist}
              error={error}
            />
          )}
        </div>

        {step === 'name' && (
          <div
            className="border-t border-slate-200 bg-white px-4 pt-3"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
          >
            <button
              type="button"
              onClick={create}
              disabled={!name.trim() || busy}
              data-testid="group-create"
              className={cn(
                'flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition-colors',
                confirming ? 'bg-rose-600 hover:bg-rose-700' : 'bg-slate-900 hover:bg-slate-800',
                'disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400',
              )}
            >
              {busy ? 'Creating…'
                : confirming ? `Yes — create with ${audience?.count} people`
                : `Create group (${audience?.count ?? 0} ${audience?.count === 1 ? 'person' : 'people'})`}
            </button>
          </div>
        )}
      </div>
    </ModalPortal>
  )
}

function AudienceStep({
  classRuns, packages, memberships, clientCount, activeClientCount, onGroup, onEveryone, onPeople,
}: {
  classRuns: AudienceOption[]
  packages: AudienceOption[]
  memberships: AudienceOption[]
  clientCount: number
  activeClientCount: number
  onGroup: (scope: 'CLASS_RUN' | 'PACKAGE' | 'MEMBERSHIP', o: AudienceOption) => void
  onEveryone: () => void
  onPeople: () => void
}) {
  return (
    <div className="px-4 py-4">
      <SectionLabel>Anyone</SectionLabel>
      <FlatBlock>
        <FlatRow
          icon={UsersRound}
          label="Everyone"
          sub={`All ${activeClientCount} of your active clients`}
          onClick={onEveryone}
        />
        <FlatRow
          icon={Users}
          label="Choose people"
          sub={`Pick from your ${clientCount} ${clientCount === 1 ? 'client' : 'clients'}`}
          onClick={onPeople}
        />
      </FlatBlock>

      {classRuns.length > 0 && (
        <div className="mt-5">
          <SectionLabel>Classes</SectionLabel>
          <FlatBlock>
            {classRuns.map(o => (
              <FlatRow key={o.id} icon={GraduationCap} label={o.name} sub={`${o.count} enrolled`} onClick={() => onGroup('CLASS_RUN', o)} />
            ))}
          </FlatBlock>
        </div>
      )}

      {memberships.length > 0 && (
        <div className="mt-5">
          <SectionLabel>Memberships</SectionLabel>
          <FlatBlock>
            {memberships.map(o => (
              <FlatRow key={o.id} icon={Star} label={o.name} sub={`${o.count} active`} onClick={() => onGroup('MEMBERSHIP', o)} />
            ))}
          </FlatBlock>
        </div>
      )}

      {packages.length > 0 && (
        <div className="mt-5">
          <SectionLabel>Packages</SectionLabel>
          <FlatBlock>
            {packages.map(o => (
              <FlatRow key={o.id} icon={PackageIcon} label={o.name} sub={`${o.count} on this package`} onClick={() => onGroup('PACKAGE', o)} />
            ))}
          </FlatBlock>
        </div>
      )}
    </div>
  )
}

function PeopleStep({
  clients, total, picked, query, setQuery, toggle, selectAll, clearAll,
}: {
  clients: PickableClient[]
  total: number
  picked: Set<string>
  query: string
  setQuery: (v: string) => void
  toggle: (id: string) => void
  selectAll: () => void
  clearAll: () => void
}) {
  const allShown = picked.size === clients.length && clients.length > 0
  return (
    <div className="px-4 py-4">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" strokeWidth={1.75} />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search clients"
          aria-label="Search clients"
          className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
        />
      </div>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-slate-500">{picked.size} of {total} selected</span>
        <button
          type="button"
          onClick={allShown ? clearAll : selectAll}
          className="font-medium text-blue-600 hover:text-blue-700"
        >
          {allShown ? 'Clear' : `Select all (${clients.length})`}
        </button>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {clients.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">No clients match that.</p>
        ) : clients.map((c, i) => {
          const on = picked.has(c.id)
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              aria-pressed={on}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50',
                i > 0 && 'border-t border-slate-100',
              )}
            >
              <span className={cn(
                'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border',
                on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300',
              )}>
                {on && <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-900">
                {c.displayName}{c.dogName ? ` · ${c.dogName}` : ''}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// The decision that actually matters. Two full options with their consequence
// written out, because getting this wrong is a privacy incident, not a
// preference — and a trainer cannot un-see their client list to each other.
function ModeStep({
  mode, setMode, count,
}: {
  mode: 'BROADCAST' | 'COMMUNITY' | null
  setMode: (m: 'BROADCAST' | 'COMMUNITY') => void
  count: number
}) {
  return (
    <div className="px-4 py-4">
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        {count} {count === 1 ? 'person' : 'people'} will be in this group. This
        choice decides whether they can see each other, and it is the one thing
        you cannot undo later.
      </p>
      <div className="space-y-3">
        <ModeCard
          selected={mode === 'BROADCAST'}
          onClick={() => setMode('BROADCAST')}
          icon={Megaphone}
          title="Broadcast"
          testid="mode-broadcast"
          lines={[
            'You post to everyone at once.',
            'Replies come back to you privately.',
            'Nobody sees anyone else in the group.',
          ]}
          footnote="Best for notices — a cancelled class, a change of venue."
        />
        <ModeCard
          selected={mode === 'COMMUNITY'}
          onClick={() => setMode('COMMUNITY')}
          icon={UsersRound}
          title="Community"
          testid="mode-community"
          lines={[
            'Everyone sees everyone’s messages.',
            'Members see each other’s first names.',
            'Each person is asked to join before they can see it.',
          ]}
          footnote="Best for a class that wants to talk to each other. Because it shows your clients to one another, everyone has to opt in — anyone who ignores the invitation stays out."
        />
      </div>
    </div>
  )
}

function ModeCard({
  selected, onClick, icon: Icon, title, lines, footnote, testid,
}: {
  selected: boolean
  onClick: () => void
  icon: typeof Megaphone
  title: string
  lines: string[]
  footnote: string
  testid: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      aria-pressed={selected}
      className={cn(
        'w-full rounded-xl border bg-white px-4 py-4 text-left transition-colors',
        selected ? 'border-slate-900' : 'border-slate-200 hover:bg-slate-50',
      )}
    >
      <span className="flex items-center gap-2">
        <Icon className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
        <span className="text-sm font-semibold text-slate-900">{title}</span>
      </span>
      <ul className="mt-2 space-y-1">
        {lines.map(l => (
          <li key={l} className="text-[13px] leading-relaxed text-slate-600">{l}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">{footnote}</p>
    </button>
  )
}

function NameStep({
  name, setName, audience, mode, important, setImportant, includeWaitlist, setIncludeWaitlist, error,
}: {
  name: string
  setName: (v: string) => void
  audience: Audience | null
  mode: 'BROADCAST' | 'COMMUNITY' | null
  important: boolean
  setImportant: (v: boolean) => void
  includeWaitlist: boolean
  setIncludeWaitlist: (v: boolean) => void
  error: string | null
}) {
  return (
    <div className="px-4 py-4">
      <input
        value={name}
        onChange={e => setName(e.target.value.slice(0, 80))}
        autoFocus
        placeholder="Spring Puppy Class"
        aria-label="Group name"
        data-testid="group-name"
        className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
      />
      <p className="mt-2 text-xs text-slate-500">
        {mode === 'BROADCAST'
          ? 'Broadcast — replies come back to you privately.'
          : 'Community — everyone sees everyone. Each person is asked to join first.'}
        {' '}{audience?.count} {audience?.count === 1 ? 'person' : 'people'}.
      </p>

      <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white [&>*+*]:border-t [&>*+*]:border-slate-200">
        {audience?.scope === 'CLASS_RUN' && (
          <SettingRow
            label="Include the waitlist"
            sub="People waiting for a place get the group too"
            on={includeWaitlist}
            onChange={setIncludeWaitlist}
          />
        )}
        <SettingRow
          label="Important"
          sub="Reaches people who have muted their notifications"
          on={important}
          onChange={setImportant}
        />
      </div>

      {error && <p className="mt-3 text-sm text-rose-600" role="alert">{error}</p>}
    </div>
  )
}

function SettingRow({
  label, sub, on, onChange,
}: {
  label: string
  sub: string
  on: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        <span className="mt-0.5 block text-[13px] text-slate-500">{sub}</span>
      </span>
      <span className={cn(
        'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border',
        on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300',
      )}>
        {on && <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
      </span>
    </button>
  )
}
