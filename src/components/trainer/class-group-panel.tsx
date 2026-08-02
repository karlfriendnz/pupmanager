'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Megaphone, UsersRound } from 'lucide-react'
import { FlatBlock, FlatRow, SectionLabel } from '@/components/shared/flat-list'
import { FullScreenSheet } from '@/components/shared/full-screen-sheet'
import { cn } from '@/lib/utils'

// "Create a group for this class", on the class's own Reminders & messages
// tab. Lists any groups already attached to the run so a trainer doesn't make
// a second one by accident, then offers the mode choice.
//
// The mode step is deliberately the same two-option, consequence-first screen
// the Messages composer uses: picking COMMUNITY shows this class's owners to
// each other, and that is not something a trainer can take back.

interface ExistingGroup {
  id: string
  name: string
  mode: 'BROADCAST' | 'COMMUNITY'
  memberCount: number
}

export function ClassGroupPanel({ runId, runName }: { runId: string; runName: string }) {
  const router = useRouter()
  const [groups, setGroups] = useState<ExistingGroup[]>([])
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/message-groups?classRunId=${runId}`)
    if (res.ok) setGroups((await res.json()).groups ?? [])
  }, [runId])

  useEffect(() => { void load() }, [load])

  return (
    <div className="mb-6">
      <SectionLabel>Group chat</SectionLabel>
      <FlatBlock>
        {groups.map(g => (
          <FlatRow
            key={g.id}
            icon={g.mode === 'BROADCAST' ? Megaphone : UsersRound}
            label={g.name}
            sub={`${g.mode === 'BROADCAST' ? 'Broadcast' : 'Community'} · ${g.memberCount} ${g.memberCount === 1 ? 'person' : 'people'}`}
            href={`/messages?group=${g.id}`}
          />
        ))}
        <FlatRow
          icon={UsersRound}
          label={groups.length ? 'Create another group' : 'Create a group for this class'}
          sub="Everyone on the class, in one thread"
          onClick={() => setCreating(true)}
        />
      </FlatBlock>

      {creating && (
        <CreateSheet
          runId={runId}
          runName={runName}
          onClose={() => setCreating(false)}
          onCreated={(groupId) => { void load(); router.push(`/messages?group=${groupId}`) }}
        />
      )}
    </div>
  )
}

function CreateSheet({
  runId, runName, onClose, onCreated,
}: {
  runId: string
  runName: string
  onClose: () => void
  onCreated: (groupId: string) => void
}) {
  const [name, setName] = useState(runName)
  const [mode, setMode] = useState<'BROADCAST' | 'COMMUNITY'>('BROADCAST')
  const [includeWaitlist, setIncludeWaitlist] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Never two scrollbars — the page behind must not scroll while this is open.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  async function create() {
    if (busy || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/message-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          mode,
          scope: 'CLASS_RUN',
          classRunId: runId,
          includeWaitlist,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not create that group.')
        setBusy(false)
        return
      }
      onCreated(data.groupId)
    } catch {
      setError('Could not create that group.')
      setBusy(false)
    }
  }

  return (
    // The whole screen on a phone, a centred panel on a desktop — the shared
    // shell, so this reads like every other picker in the app.
    <FullScreenSheet
      title="New group"
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={create}
          disabled={busy || !name.trim()}
          data-testid="class-group-create"
          className="h-12 w-full rounded-xl bg-slate-900 text-sm font-semibold text-white hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400"
        >
          {busy ? 'Creating…' : 'Create group'}
        </button>
      }
    >
        <div data-testid="class-group-sheet">
          <input
            value={name}
            onChange={e => setName(e.target.value.slice(0, 80))}
            aria-label="Group name"
            data-testid="class-group-name"
            className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
          />

          <div className="mt-5 space-y-3">
            <ModeCard
              selected={mode === 'BROADCAST'}
              onClick={() => setMode('BROADCAST')}
              testid="class-mode-broadcast"
              icon={Megaphone}
              title="Broadcast"
              lines={[
                'You post to everyone at once.',
                'Replies come back to you privately.',
                'Nobody sees anyone else in the group.',
              ]}
            />
            <ModeCard
              selected={mode === 'COMMUNITY'}
              onClick={() => setMode('COMMUNITY')}
              testid="class-mode-community"
              icon={UsersRound}
              title="Community"
              lines={[
                'Everyone sees everyone’s messages.',
                'Members see each other’s first names.',
                'Each person is asked to join before they can see it.',
              ]}
            />
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={includeWaitlist}
            onClick={() => setIncludeWaitlist(v => !v)}
            className="mt-5 flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-left active:bg-slate-50"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-slate-900">Include the waitlist</span>
              <span className="mt-0.5 block text-[13px] text-slate-500">People waiting for a place get the group too</span>
            </span>
            <span className={cn(
              'h-5 w-5 flex-shrink-0 rounded-md border',
              includeWaitlist ? 'border-slate-900 bg-slate-900' : 'border-slate-300',
            )} />
          </button>

          {error && <p className="mt-3 text-sm text-rose-600" role="alert">{error}</p>}
        </div>
    </FullScreenSheet>
  )
}

function ModeCard({
  selected, onClick, icon: Icon, title, lines, testid,
}: {
  selected: boolean
  onClick: () => void
  icon: typeof Megaphone
  title: string
  lines: string[]
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
        {lines.map(l => <li key={l} className="text-[13px] leading-relaxed text-slate-600">{l}</li>)}
      </ul>
    </button>
  )
}
