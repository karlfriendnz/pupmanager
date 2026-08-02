'use client'

import type { ClientView } from '@/lib/client-activity'
import { ClientViewTabs } from './client-view-tabs'

import { Fragment, useMemo, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { UserPlus, Search, Dog, Columns3, X, Check, Layers, CheckSquare, Mail, MessageSquare, CheckCircle2 } from 'lucide-react'
import { dateParts, displayEmail, personLabel } from '@/lib/utils'
import { ClientAvatar } from '@/components/shared/client-avatar'
import { BulkEmailModal } from './bulk-email-modal'
import { GroupComposer } from '../messages/group-composer'

type BuiltinColumnId = 'email' | 'dog' | 'breed' | 'extraDogs' | 'nextSession' | 'shared'

const BUILTIN_OPTIONS: { id: BuiltinColumnId; label: string }[] = [
  { id: 'email',       label: 'Email' },
  { id: 'dog',         label: 'Primary dog' },
  { id: 'breed',       label: 'Breed' },
  { id: 'extraDogs',   label: 'Additional dogs' },
  { id: 'nextSession', label: 'Next session' },
  { id: 'shared',      label: 'Shared badge' },
]

const BUILTIN_IDS = BUILTIN_OPTIONS.map(o => o.id) as BuiltinColumnId[]

function isBuiltinId(value: string): value is BuiltinColumnId {
  return (BUILTIN_IDS as string[]).includes(value)
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// A picked client, carried whole rather than as a bare id: the New / Active /
// Inactive tabs are separate server renders, so a client selected on one tab
// isn't in `clients` on the next one, and the email composer still needs their
// name and address. sessionStorage (not localStorage) so it dies with the tab
// rather than greeting the trainer next week with six people still ticked.
export interface EmailTarget {
  id: string
  name: string | null
  email: string | null
  dogName: string | null
}

const SELECTION_KEY = 'pm.clients.selection'

// sessionStorage IS the selection, read through useSyncExternalStore — the same
// shape the offering list uses for its remembered view. Storing it in component
// state instead would mean a setState in an effect on every mount, which is
// both a cascading render and a lint error.
//
// The snapshot is the raw JSON string, deliberately: useSyncExternalStore
// compares snapshots by identity, and a freshly-parsed Map is a new object
// every time, which spins forever.
const selectionListeners = new Set<() => void>()

function subscribeSelection(cb: () => void) {
  selectionListeners.add(cb)
  return () => { selectionListeners.delete(cb) }
}

function selectionSnapshot(): string {
  try { return window.sessionStorage.getItem(SELECTION_KEY) ?? '' } catch { return '' }
}

/** The server has no sessionStorage — it always renders "nothing selected". */
const serverSelectionSnapshot = (): string => ''

export function parseSelection(raw: string): Map<string, EmailTarget> {
  if (!raw) return new Map()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Map()
    return new Map(parsed
      // `email` is string | NULL — a client registered without one is a
      // supported case, and demanding a string here silently dropped them on
      // read-back. The symptom was invisible and awful: ticking a client with
      // no email did nothing at all. The write landed, the re-read discarded
      // it, and the row sprang back unticked with no explanation. Only `id`
      // makes an entry usable; who can be EMAILED is decided at the Email
      // action, not here.
      .filter((v): v is EmailTarget =>
        !!v && typeof v === 'object'
        && typeof (v as EmailTarget).id === 'string')
      .map(v => [v.id, { id: v.id, name: v.name ?? null, email: v.email, dogName: v.dogName ?? null }] as const))
  } catch {
    return new Map()   // corrupt storage is not worth breaking the page over
  }
}

function writeSelection(selected: Map<string, EmailTarget>) {
  try {
    if (selected.size === 0) window.sessionStorage.removeItem(SELECTION_KEY)
    else window.sessionStorage.setItem(SELECTION_KEY, JSON.stringify(Array.from(selected.values())))
  } catch {
    /* private mode / quota — the selection just won't survive the tab switch */
  }
  selectionListeners.forEach(l => l())
}

interface CustomFieldMeta {
  id: string
  label: string
  appliesTo: string  // "OWNER" | "DOG"
}

interface ClientRow {
  id: string
  name: string | null
  email: string | null
  dogName: string | null
  dogBreed: string | null
  dogPhotoUrl: string | null   // primary dog photo, else first additional dog's
  extraDogNames: string[]   // for searching multi-dog households
  nextSessionAt: string | null  // ISO string
  shared: boolean
}

interface Props {
  clients: ClientRow[]
  view: ClientView
  tabs: { id: ClientView; label: string; badge?: number; href: string }[]
  blurb: string
  columns: string[]
  customFields: CustomFieldMeta[]
  customValues: Record<string, string>  // key: `${clientId}:${fieldId}`
  groupBy: string | null
  tz: string  // trainer's configured timezone — all dates render in this
  initialQuery?: string  // seed the live search from a ?q= URL param (top-bar search)
  // Which fields the live search matches against. 'all' = name/email/dog/breed;
  // narrower scopes come from the top-bar search's scope selector.
  searchScope?: 'all' | 'client' | 'breed' | 'dog'
}

export function ClientsList({ clients, view, tabs, blurb, columns, customFields, customValues, groupBy, tz, initialQuery, searchScope = 'all' }: Props) {
  const validCustomIds = new Set(customFields.map(f => f.id))
  const initial = columns.filter(c => isBuiltinId(c) || (c.startsWith('custom:') && validCustomIds.has(c.slice(7))))
  const [visible, setVisible] = useState<Set<string>>(new Set(initial))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [groupMenuOpen, setGroupMenuOpen] = useState(false)
  const [groupKey, setGroupKey] = useState<string>(groupBy ?? '')
  const router = useRouter()
  const [savingCols, setSavingCols] = useState(false)

  function orderedSelection(set: Set<string>): string[] {
    // Built-ins first (in declaration order), then custom fields (in metadata
    // order). Stable order keeps card layout consistent regardless of click
    // sequence.
    const builtins = BUILTIN_IDS.filter(c => set.has(c))
    const customs = customFields.filter(f => set.has(`custom:${f.id}`)).map(f => `custom:${f.id}`)
    return [...builtins, ...customs]
  }

  async function toggleColumn(id: string) {
    setVisible(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      const ordered = orderedSelection(next)
      setSavingCols(true)
      fetch('/api/trainer/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientListColumns: ordered }),
      })
        .then(() => router.refresh())
        .finally(() => setSavingCols(false))
      return next
    })
  }

  function changeGroupBy(value: string) {
    setGroupKey(value)
    setSavingCols(true)
    fetch('/api/trainer/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientListGroupBy: value === '' ? null : value }),
    })
      .then(() => router.refresh())
      .finally(() => setSavingCols(false))
  }

  // Live (uncontrolled-feel) wildcard filter — every keystroke filters in JS,
  // no network round-trip. Splits on whitespace so "fido smith" matches a row
  // where one token is in the dog name and the other in the owner name.
  const [query, setQuery] = useState(initialQuery ?? '')

  const filtered = useMemo(() => {
    const tokens = query.trim().toLocaleLowerCase('en-NZ').split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return clients
    return clients.filter(c => {
      // Scope narrows which fields the query matches against.
      const fields =
        searchScope === 'client' ? [c.name ?? '', c.email]
        : searchScope === 'breed' ? [c.dogBreed ?? '']
        : searchScope === 'dog' ? [c.dogName ?? '', ...c.extraDogNames]
        : [c.name ?? '', c.email, c.dogName ?? '', c.dogBreed ?? '', ...c.extraDogNames]
      const haystack = fields.join(' ').toLocaleLowerCase('en-NZ')
      return tokens.every(t => haystack.includes(t))
    })
  }, [clients, query, searchScope])

  // ── Multi-select + bulk actions ────────────────────────────────────────────
  // The selection KEEPS people who fall out of view. Both the New/Active/
  // Inactive tabs (a server navigation that remounts this component) and the
  // live search hide rows, and silently dropping someone you'd already ticked
  // is the worse surprise — you'd send to five of the six you picked and never
  // know. So the picked rows are stored whole (id + the fields the email
  // composer needs) in sessionStorage, survive the remount, and the action bar
  // always states the total plus how many of them aren't on screen right now.
  const raw = useSyncExternalStore(subscribeSelection, selectionSnapshot, serverSelectionSnapshot)
  const selected = useMemo(() => parseSelection(raw), [raw])
  // Selection mode is ON whenever something is picked, so returning to a
  // non-empty selection (tab switch, back button) shows the checkboxes rather
  // than hiding them while the bar still claims six people are picked.
  const [selectModeOn, setSelectModeOn] = useState(false)
  const selectMode = selectModeOn || selected.size > 0
  const [composeOpen, setComposeOpen] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  const [sentSummary, setSentSummary] = useState<string | null>(null)

  function exitSelectMode() {
    setSelectModeOn(false)
    writeSelection(new Map())     // leaving selection mode clears it, here and in storage
    setComposeOpen(false)
  }

  function toggleSelected(client: ClientRow) {
    const next = new Map(selected)
    if (next.has(client.id)) next.delete(client.id)
    else next.set(client.id, { id: client.id, name: client.name, email: client.email, dogName: client.dogName })
    writeSelection(next)
  }

  // "Select all" operates on what is VISIBLE — the current tab, narrowed by the
  // current search — never on every client in the database. If every visible
  // row is already ticked the same control clears just those rows, leaving any
  // selection made on another tab alone.
  const allFilteredSelected = filtered.length > 0 && filtered.every(c => selected.has(c.id))
  function toggleSelectAll() {
    const next = new Map(selected)
    if (allFilteredSelected) {
      for (const c of filtered) next.delete(c.id)
    } else {
      for (const c of filtered) next.set(c.id, { id: c.id, name: c.name, email: c.email, dogName: c.dogName })
    }
    writeSelection(next)
  }

  const selectedCount = selected.size
  const visibleSelectedCount = filtered.reduce((n, c) => n + (selected.has(c.id) ? 1 : 0), 0)
  const offscreenSelectedCount = selectedCount - visibleSelectedCount
  const selectedTargets = Array.from(selected.values())
  // Everyone picked can be MESSAGED; only those with an address can be emailed.
  // The composer's own contract says its candidates are "already filtered to
  // mailable", so the filtering belongs here rather than inside it.
  const mailableTargets = selectedTargets.filter(t => !!t.email)
  const unmailableCount = selectedTargets.length - mailableTargets.length

  // A message thread is one client — the schema has no group conversation, and
  // faking one would put a reply from one owner in front of five others. So
  // "Message" hands off to the existing thread only when the selection is a
  // single person; with more than one picked it says so instead of pretending.
  const soleSelectedId = selectedCount === 1 ? selectedTargets[0].id : null

  return (
    <>
      {sentSummary && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5 text-green-600" />
          <p className="flex-1">{sentSummary}</p>
          <button onClick={() => setSentSummary(null)} className="text-green-500 hover:text-green-700" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Tabs first — which of the four lists you're on — then search WITHIN it. */}
      <ClientViewTabs tabs={tabs} value={view} className="mb-2" />
      <p className="mb-4 px-1 text-sm text-slate-500">{blurb}</p>

      {/* Live search + group + Select, on every size.
          
          This row used to be desktop-only. The reasoning was that the top bar
          already searches and the icons read as unlabelled clutter on a phone —
          but a trainer scrolling 400 clients on a phone needs to filter them
          where they're standing, not up in the chrome, and Select is how bulk
          email starts. So it stays.
          
          What DOESN'T come with it is the column picker: the phone renders
          cards, not a table, so choosing table columns there controls nothing
          you can see. That one is still md+. */}
      <div className="flex items-center gap-2 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            // Short enough to survive a 390px field beside three icon buttons —
            // the long version cut off mid-word, which reads as broken.
            placeholder="Search name, email or dog"
            className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setGroupMenuOpen(o => !o)}
            disabled={savingCols}
            aria-label="Group clients"
            title={groupKey
              ? (groupKey === 'nextDay'
                  ? 'Grouped by day of next booking'
                  : `Grouped by ${customFields.find(f => `custom:${f.id}` === groupKey)?.label ?? 'custom field'}`)
              : 'Group clients'}
            className="relative h-11 w-11 inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          >
            <Layers className="h-4 w-4" />
            {groupKey && (
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-blue-600" aria-hidden />
            )}
          </button>
          {groupMenuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setGroupMenuOpen(false)} />
              <div className="absolute right-0 mt-2 w-64 max-h-[70vh] overflow-y-auto z-40 bg-white rounded-xl border border-slate-200 shadow-lg p-1.5">
                <div className="flex items-center justify-between px-2 py-1.5">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Group by</p>
                  <button onClick={() => setGroupMenuOpen(false)} className="p-0.5 text-slate-400 hover:text-slate-600">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {[
                  { value: '', label: 'No grouping' },
                  { value: 'nextDay', label: 'Day of next booking' },
                ].map(opt => {
                  const active = groupKey === opt.value
                  return (
                    <button
                      key={opt.value || 'none'}
                      onClick={() => { changeGroupBy(opt.value); setGroupMenuOpen(false) }}
                      disabled={savingCols}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${active ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300'}`}>
                        {active && <Check className="h-3 w-3" />}
                      </span>
                      {opt.label}
                    </button>
                  )
                })}
                {customFields.length > 0 && (
                  <>
                    <p className="px-2 pt-2 pb-1 text-xs font-semibold text-slate-500 uppercase tracking-wide border-t border-slate-100 mt-1">Custom fields</p>
                    {customFields.map(f => {
                      const id = `custom:${f.id}`
                      const active = groupKey === id
                      return (
                        <button
                          key={f.id}
                          onClick={() => { changeGroupBy(id); setGroupMenuOpen(false) }}
                          disabled={savingCols}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${active ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300'}`}>
                            {active && <Check className="h-3 w-3" />}
                          </span>
                          <span className="flex-1 truncate text-left">{f.label}</span>
                          <span className="text-[10px] text-slate-400 uppercase">{f.appliesTo === 'DOG' ? 'Dog' : 'Owner'}</span>
                        </button>
                      )
                    })}
                  </>
                )}
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => selectMode ? exitSelectMode() : setSelectModeOn(true)}
          aria-pressed={selectMode}
          aria-label={selectMode ? 'Done selecting clients' : 'Select clients to email'}
          className={`h-11 px-3 inline-flex items-center gap-1.5 rounded-xl border text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            selectMode
              ? 'border-[var(--pm-brand-500)] bg-[var(--pm-brand-50)] text-[var(--pm-brand-700)]'
              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
          }`}
        >
          <CheckSquare className="h-4 w-4" />
          {/* Labelled at every size. An unlabelled tick box beside an
              unlabelled stack icon is the clutter this row was hidden for. */}
          <span>{selectMode ? 'Done' : 'Select'}</span>
        </button>
        {/* Columns choose what the TABLE shows, and a phone has no table — the
            list drops to one summary line per client once the column it sits
            in is too narrow for columns to line up. */}
        <div className="relative hidden md:block">
          <button
            type="button"
            onClick={() => setPickerOpen(o => !o)}
            className="h-11 px-3 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Choose visible fields"
          >
            <Columns3 className="h-4 w-4" />
            <span className="hidden sm:inline">Columns</span>
          </button>
          {pickerOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setPickerOpen(false)} />
              <div className="absolute right-0 mt-2 w-64 max-h-[70vh] overflow-y-auto z-40 bg-white rounded-xl border border-slate-200 shadow-lg p-1.5">
                <div className="flex items-center justify-between px-2 py-1.5">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Show fields</p>
                  <button onClick={() => setPickerOpen(false)} className="p-0.5 text-slate-400 hover:text-slate-600">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {BUILTIN_OPTIONS.map(opt => {
                  const active = visible.has(opt.id)
                  return (
                    <button
                      key={opt.id}
                      onClick={() => toggleColumn(opt.id)}
                      disabled={savingCols}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <span className={`flex h-4 w-4 items-center justify-center rounded border ${active ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300'}`}>
                        {active && <Check className="h-3 w-3" />}
                      </span>
                      {opt.label}
                    </button>
                  )
                })}
                {customFields.length > 0 && (
                  <>
                    <p className="px-2 pt-2 pb-1 text-xs font-semibold text-slate-500 uppercase tracking-wide border-t border-slate-100 mt-1">Custom fields</p>
                    {customFields.map(f => {
                      const id = `custom:${f.id}`
                      const active = visible.has(id)
                      return (
                        <button
                          key={f.id}
                          onClick={() => toggleColumn(id)}
                          disabled={savingCols}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <span className={`flex h-4 w-4 items-center justify-center rounded border ${active ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300'}`}>
                            {active && <Check className="h-3 w-3" />}
                          </span>
                          <span className="flex-1 truncate text-left">{f.label}</span>
                          <span className="text-[10px] text-slate-400 uppercase">{f.appliesTo === 'DOG' ? 'Dog' : 'Owner'}</span>
                        </button>
                      )
                    })}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* (The phone used to get its own Select here, because the toolbar above
          was md-only. The toolbar shows at every size now, so this was the same
          button twice, one under the other.) */}

      {selectMode && (
        <div className="flex items-center justify-between mb-3 px-1">
          <button
            type="button"
            onClick={toggleSelectAll}
            disabled={filtered.length === 0}
            className="py-1 text-sm font-medium text-[var(--pm-brand-700)] hover:underline disabled:opacity-40 disabled:no-underline"
          >
            {/* Counts what is on screen, so it can never read as "select the
                whole database". */}
            {allFilteredSelected ? 'Clear these' : `Select all (${filtered.length})`}
          </button>
          {/* Phone only — on desktop the toolbar's Select button turns into
              Done, and the same control twice on one screen is the thing the
              house style forbids. */}
          <button
            type="button"
            onClick={exitSelectMode}
            className="py-1 text-sm font-medium text-slate-500 hover:text-slate-700 md:hidden"
          >
            Done
          </button>
        </div>
      )}

      {clients.length === 0 ? (
        <EmptyState view={view} />
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <p className="text-sm">No matches for &ldquo;{query}&rdquo;.</p>
        </div>
      ) : (
        <ClientTable
          clients={filtered}
          view={view}
          visible={visible}
          customFields={customFields}
          customValues={customValues}
          groupBy={groupKey || null}
          tz={tz}
          selectMode={selectMode}
          selected={selected}
          onToggleSelect={toggleSelected}
        />
      )}

      {/* Keeps the last client clear of the pinned bar rather than under it.
          On a phone the shell already reserves the tab bar with
          pb-[calc(5rem+safe-area)], so this only has to cover the bar itself. */}
      {selectMode && selectedCount > 0 && <div className="h-24" aria-hidden />}

      {/* Pinned action bar — appears the moment something is ticked. Full-width
          and flat (hairline top border, white), not a floating dark slab: three
          controls and a two-line count do not fit a 56px pill at 390px.
          Bottom padding clears the mobile tab bar (5rem) AND the iOS home
          indicator; on md+ the tab bar is gone so only the padding remains. */}
      {selectMode && selectedCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-4 pt-3 backdrop-blur pb-[calc(5rem+env(safe-area-inset-bottom,0px)+0.75rem)] md:pb-4">
          <div className="mx-auto flex w-full max-w-4xl xl:max-w-7xl items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900">
                {selectedCount} selected
              </p>
              {offscreenSelectedCount > 0 && (
                <p className="truncate text-xs text-slate-500">
                  {offscreenSelectedCount} not shown here — still included
                </p>
              )}
              {/* Said before they open the composer and wonder where people
                  went. They can still be MESSAGED — only the email needs an
                  address. */}
              {unmailableCount > 0 && (
                <p className="truncate text-xs text-slate-500">
                  {unmailableCount} {unmailableCount === 1 ? 'has' : 'have'} no email address
                </p>
              )}
              {soleSelectedId === null && (
                <p className="truncate text-xs text-slate-500">Starts a group with these {selectedCount}</p>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              // One person is a conversation, so go straight to their thread.
              // Several is a group — hand the selection to the composer rather
              // than making the trainer tick the same people again.
              onClick={() => {
                if (soleSelectedId) router.push(`/messages?client=${soleSelectedId}`)
                else setGroupOpen(true)
              }}
              title={soleSelectedId ? 'Open this client’s message thread' : `Start a group with these ${selectedCount}`}
            >
              <MessageSquare className="h-4 w-4" strokeWidth={1.75} />
              Message
            </Button>
            <Button type="button" size="sm" onClick={() => setComposeOpen(true)}>
              <Mail className="h-4 w-4" strokeWidth={1.75} />
              Email
            </Button>
            <button
              type="button"
              onClick={exitSelectMode}
              aria-label="Clear selection"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      )}

      {composeOpen && (
        <BulkEmailModal
          // From the stored selection, not from `clients` — someone ticked on
          // the Active tab must still be emailable from the Inactive one.
          candidates={mailableTargets}
          onClose={() => setComposeOpen(false)}
          onSent={(summary) => {
            setSentSummary(summary)
            exitSelectMode()
            router.refresh()
          }}
        />
      )}

      {groupOpen && (
        <GroupComposer
          // Hand the ticked people straight through, so the composer opens on
          // the mode question rather than asking them to pick the same clients
          // a second time. Same stored selection the email path uses, so a
          // client ticked on the Active tab still counts from the Inactive one.
          initialClientIds={selectedTargets.map(t => t.id)}
          clients={selectedTargets.map(t => ({
            id: t.id,
            // name-or-email, with a real end to the chain: a client can now
            // genuinely have neither (see lib/no-email), and a group
            // participant rendered as an empty string reads as a broken row.
            displayName: personLabel(t),
            dogName: t.dogName,
          }))}
          activeClientCount={selectedTargets.length}
          // The audience shortcuts belong to the Messages screen; from here the
          // audience is already decided.
          classRuns={[]}
          packages={[]}
          memberships={[]}
          onClose={() => { setGroupOpen(false); exitSelectMode() }}
        />
      )}
    </>
  )
}

// ─── Table-style row layout ──────────────────────────────────────────────────

interface DataColumn {
  key: string
  label: string
  align?: 'left' | 'right'
  /** CSS grid template fragment for this column. */
  width: string
  render: (c: ClientRow) => React.ReactNode
}

/**
 * Every data column is a `minmax`, and every one of them is TIGHT — only the
 * client's own column is a `1fr`.
 *
 * Two reasons, both learned the hard way on this list:
 *
 *  • The name is what a trainer scans down, so it gets the slack. When the data
 *    columns were `1fr` too, an email address and a breed took as much room as
 *    the person's name and the names truncated first.
 *  • The MAX keeps a two-column list from spreading an address across half the
 *    screen. The MIN is deliberately SMALLER than the text it holds, because
 *    the columns are the trainer's choice and there can be seven of them: mins
 *    that added up to more than the table is wide would overflow the box, and
 *    the box's `overflow-hidden` would then clip the last column off the right
 *    edge with nothing on screen to say it was ever there. Truncated is bad;
 *    invisible is worse. Seven of these still fit inside the @2xl the table
 *    needs before it appears at all.
 */
const COL = {
  email:       'minmax(4.5rem, 13rem)',
  dog:         'minmax(3.5rem, 9rem)',
  breed:       'minmax(3.5rem, 9rem)',
  extraDogs:   'minmax(4rem, 11rem)',
  nextSession: 'minmax(4.5rem, 12rem)',
  custom:      'minmax(3.5rem, 10rem)',
} as const

/** The avatar's own column — h-9 on ClientAvatar size="md". */
const AVATAR_COL = '2.25rem'
/** The tick's own column — h-5 w-5 on the checkbox. */
const CHECK_COL = '1.25rem'

function buildDataColumns(
  visible: Set<string>,
  customFields: CustomFieldMeta[],
  customValues: Record<string, string>,
  tz: string,
): DataColumn[] {
  const cols: DataColumn[] = []

  if (visible.has('email')) {
    cols.push({
      key: 'email',
      label: 'Email',
      width: COL.email,
      render: c => {
        const email = displayEmail(c.email)
        return email
          ? <span className="truncate text-slate-500">{email}</span>
          : <span className="truncate text-slate-300 italic">No email</span>
      },
    })
  }
  if (visible.has('dog')) {
    cols.push({
      key: 'dog',
      label: 'Primary dog',
      width: COL.dog,
      render: c => (
        <span className="truncate text-slate-700">
          {c.dogName ? c.dogName : <span className="text-slate-400 italic">No dog</span>}
        </span>
      ),
    })
  }
  if (visible.has('breed')) {
    cols.push({
      key: 'breed',
      label: 'Breed',
      width: COL.breed,
      render: c => c.dogBreed ? <span className="truncate text-slate-600">{c.dogBreed}</span> : <span className="text-slate-300">—</span>,
    })
  }
  if (visible.has('extraDogs')) {
    cols.push({
      key: 'extraDogs',
      label: 'Additional dogs',
      width: COL.extraDogs,
      render: c => c.extraDogNames.length > 0
        ? <span className="truncate text-slate-600">{c.extraDogNames.join(', ')}</span>
        : <span className="text-slate-300">—</span>,
    })
  }
  if (visible.has('nextSession')) {
    cols.push({
      key: 'nextSession',
      label: 'Next session',
      width: COL.nextSession,
      // Plain text, no calendar icon and no blue. The heading above the column
      // already says these are dates, so the icon was the heading drawn a
      // second time in every row — and a column of blue down a white table is
      // decorative colour, which the house style rations to the trainer's own
      // accent. Nothing here is a link, so blue was also a lie about what it
      // would do if you clicked it.
      render: c => {
        const d = c.nextSessionAt ? new Date(c.nextSessionAt) : null
        if (!d) return <span className="text-slate-300">—</span>
        return (
          <span className="truncate text-slate-600">
            {d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', timeZone: tz })}
            {' · '}
            {d.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz })}
          </span>
        )
      },
    })
  }
  for (const f of customFields) {
    if (!visible.has(`custom:${f.id}`)) continue
    cols.push({
      key: `custom:${f.id}`,
      label: f.label,
      width: COL.custom,
      render: c => {
        const v = customValues[`${c.id}:${f.id}`]
        return v ? <span className="truncate text-slate-700">{v}</span> : <span className="text-slate-300">—</span>
      },
    })
  }
  // No "7-day compliance" column. A homework completion rate over a rolling
  // week is a number nobody acted on — it moves for reasons that have nothing
  // to do with the client (a week with no tasks set reads the same as a week
  // they ignored), and a red 30% beside someone's name is a judgement the list
  // has no business making at a glance.

  return cols
}

function groupKeyFor(client: ClientRow, groupBy: string | null, customValues: Record<string, string>, tz: string): { key: string; label: string; sort: number } {
  if (!groupBy) return { key: '', label: '', sort: 0 }
  if (groupBy === 'nextDay') {
    if (!client.nextSessionAt) return { key: 'none', label: 'No upcoming booking', sort: 8 }
    const day = dateParts(client.nextSessionAt, tz).weekday  // 0=Sun..6=Sat, trainer tz
    // Sort Mon..Sun (Mon first); push Sun to the end of the week.
    const weekIdx = day === 0 ? 6 : day - 1
    return { key: `day:${day}`, label: DAY_NAMES[day], sort: weekIdx }
  }
  if (groupBy.startsWith('custom:')) {
    const fid = groupBy.slice('custom:'.length)
    const value = customValues[`${client.id}:${fid}`] ?? ''
    if (!value) return { key: 'none', label: 'Not set', sort: 9999 }
    return { key: `v:${value}`, label: value, sort: 0 }
  }
  return { key: '', label: '', sort: 0 }
}

function ClientTable({ clients, view, visible, customFields, customValues, groupBy, tz, selectMode, selected, onToggleSelect }: {
  clients: ClientRow[]
  view: Props['view']
  visible: Set<string>
  customFields: CustomFieldMeta[]
  customValues: Record<string, string>
  groupBy: string | null
  tz: string
  selectMode: boolean
  selected: Map<string, EmailTarget>
  onToggleSelect: (client: ClientRow) => void
}) {
  const dataColumns = buildDataColumns(visible, customFields, customValues, tz)
  // The tick and the avatar get columns of their OWN rather than riding inside
  // the name cell, so every client's name starts at the same x — which is the
  // whole point of a table. The tick's column only exists in selection mode,
  // and because that mode is the same for every row at once, the names still
  // line up with each other (and with the heading) either way.
  const gridTemplate = [
    selectMode ? CHECK_COL : null,
    AVATAR_COL,
    'minmax(0,1fr)',            // the client — takes whatever the columns leave
    ...dataColumns.map(c => c.width),
  ].filter(Boolean).join(' ')

  const groups = (() => {
    if (!groupBy) return [{ key: '', label: '', sort: 0, rows: clients }]
    const map = new Map<string, { key: string; label: string; sort: number; rows: ClientRow[] }>()
    for (const c of clients) {
      const g = groupKeyFor(c, groupBy, customValues, tz)
      const bucket = map.get(g.key)
      if (bucket) {
        bucket.rows.push(c)
      } else {
        map.set(g.key, { key: g.key, label: g.label, sort: g.sort, rows: [c] })
      }
    }
    return Array.from(map.values()).sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
  })()

  return (
    // A query container, so the switch between the table and the phone's rows
    // is decided by how much room THIS list has rather than by how wide the
    // window is. The list sits in a centred, max-width column with padding
    // either side, so a 1000px window is nowhere near 1000px of table.
    <div className="@container">
      {/* ONE bordered white surface with hairlines through it — the columns
          have to run the whole way down or it doesn't read as a table. The
          rows used to be a stack of individual cards, each with its own border
          and shadow, which is the "floating chips" the house style forbids. */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <ClientTableHead columns={dataColumns} gridTemplate={gridTemplate} selectMode={selectMode} />
        <div className="[&>*+*]:border-t [&>*+*]:border-slate-100">
          {groups.map(group => (
            // A Fragment, not a wrapper div: the hairline rule above targets
            // DIRECT children, so a per-group wrapper would draw one line
            // between groups and none between the rows inside them.
            <Fragment key={group.key || 'all'}>
              {groupBy && (
                // The group name is a band INSIDE the table rather than a
                // caption floating above a separate box per group — one
                // surface, split by its own dividers.
                <div className="flex items-baseline gap-2 bg-slate-50/60 px-4 py-1.5">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{group.label}</h3>
                  <span className="text-[11px] text-slate-400">{group.rows.length}</span>
                </div>
              )}
              {group.rows.map(c => (
                <ClientRowCard
                  key={c.id}
                  client={c}
                  view={view}
                  visible={visible}
                  dataColumns={dataColumns}
                  gridTemplate={gridTemplate}
                  tz={tz}
                  selectMode={selectMode}
                  isSelected={selected.has(c.id)}
                  onToggleSelect={onToggleSelect}
                />
              ))}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * The column names, on the same grid the rows use.
 *
 * Hidden below @2xl for the same reason the rows drop to a summary line there:
 * headings for columns that aren't being rendered are just a stripe of words.
 */
function ClientTableHead({ columns, gridTemplate, selectMode }: {
  columns: DataColumn[]
  gridTemplate: string
  selectMode: boolean
}) {
  const cell = 'text-[11px] font-semibold uppercase tracking-wide text-slate-400'
  return (
    <div
      className="hidden @2xl:grid h-9 items-center gap-x-3 border-b border-slate-200 bg-slate-50/70 px-3"
      style={{ gridTemplateColumns: gridTemplate }}
    >
      {/* Empty cells for the tick and the avatar, so "Client" sits over the
          NAMES rather than over the pictures. */}
      {selectMode && <span aria-hidden />}
      <span aria-hidden />
      <span className={cell}>Client</span>
      {columns.map(c => (
        <span key={c.key} className={`${cell} truncate ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</span>
      ))}
    </div>
  )
}

function ClientRowCard({ client, view, visible, dataColumns, gridTemplate, tz, selectMode, isSelected, onToggleSelect }: {
  client: ClientRow
  tz: string
  view: Props['view']
  visible: Set<string>
  dataColumns: DataColumn[]
  gridTemplate: string
  selectMode: boolean
  isSelected: boolean
  onToggleSelect: (client: ClientRow) => void
}) {
  const showShared = visible.has('shared') && client.shared
  const checkbox = selectMode ? (
    <span
      aria-hidden
      data-testid="client-checkbox"
      data-checked={isSelected ? 'true' : 'false'}
      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border ${
        isSelected ? 'bg-[var(--pm-brand-600)] border-[var(--pm-brand-600)] text-white' : 'border-slate-300 bg-white'
      }`}
    >
      {isSelected && <Check className="h-3.5 w-3.5" />}
    </span>
  ) : null
  // The phone's one-line summary: the dog, and when they're next in. Nothing
  // is printed for a fact the client doesn't have — an empty row is worse than
  // no row.
  const nextSessionLabel = client.nextSessionAt
    ? new Date(client.nextSessionAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', timeZone: tz })
    : null
  const mobileSummary = [
    client.dogName,
    client.extraDogNames.length > 0 ? `+${client.extraDogNames.length}` : null,
    nextSessionLabel && `Next ${nextSessionLabel}`,
  ].filter(Boolean).join(' · ')

  const sharedBadge = showShared ? (
    <span className="flex-shrink-0 rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
      Shared
    </span>
  ) : null

  const inner = (
    <>
      {/* @2xl+: one line of the table, on the same grid as the heading.
          h-14 fixes the row height so the columns are a grid of equal boxes
          rather than a set of rows that each size to their own longest value.

          Nothing in here is a link or a button — the whole row is the link (see
          the wrapper below), so globals.css's 44px minimum touch target lands
          on THAT and never on a single cell. That mattered: a link inside a
          fixed-height row becomes a 44px box beside 20px line boxes, and its
          text then sits about a dozen pixels above everything on its line. If a
          per-cell link is ever added here it has to be `flex items-center` with
          the truncating text in an inner <span>, the way the products table
          does it. */}
      <div
        className="hidden @2xl:grid h-14 items-center gap-x-3 px-3"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {selectMode && checkbox}
        <ClientAvatar size="md" name={client.name ?? client.email} dogPhotoUrl={client.dogPhotoUrl} />
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-slate-900">{client.name ?? client.email}</span>
          {sharedBadge}
        </span>
        {dataColumns.map(c => (
          <span
            key={c.key}
            className={`flex min-w-0 items-center text-sm ${c.align === 'right' ? 'justify-end' : ''}`}
          >
            {c.render(client)}
          </span>
        ))}
      </div>

      {/* Below @2xl: avatar, name, and one summary line — tight, with the two
          lines stacked beside the avatar rather than the summary hanging under
          an indent. The configured columns are a desktop feature; as
          label/value rows they made a 150px card per client (four rows, three
          of them saying "No email" / "—" / "no tasks"). Only facts that exist
          print. A table is NOT forced onto 390px — seven columns in a 358px
          container is columns landing on top of one another. */}
      <div className="@2xl:hidden flex items-center gap-3 px-4 py-2.5">
        {selectMode && checkbox}
        <ClientAvatar size="md" name={client.name ?? client.email} dogPhotoUrl={client.dogPhotoUrl} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold leading-tight text-slate-900">
            {client.name ?? client.email}
            {sharedBadge}
          </p>
          {mobileSummary && (
            <p className="mt-0.5 truncate text-[13px] leading-tight text-slate-500">{mobileSummary}</p>
          )}
        </div>
        {/* No message button here, and nothing else either. The whole row is a
            single link to the client — a name, a dog, and when they're next in.
            One tap, one destination. Anything added back must be a SIBLING of
            the row link, never a child: an anchor (or a router.push span) inside
            an anchor is invalid HTML and swallows the row's own tap. Messaging
            lives on the client's own page, one tap away. */}
      </div>
    </>
  )

  // The row's own state. It tints the row rather than outlining it: a ring or a
  // border on one row of a bordered table draws a box inside a box, and the
  // hairline between rows then has two competing lines to sit between.
  const state = [
    'block w-full transition-colors',
    isSelected ? 'bg-[var(--pm-brand-50)]' : 'hover:bg-slate-50',
    view === 'archived' ? 'opacity-70' : '',
    view === 'never' && !isSelected ? 'bg-amber-50/30' : '',
  ].filter(Boolean).join(' ')

  // In selection mode, tapping the row toggles selection instead of
  // navigating; otherwise it's a normal link to the client profile.
  if (selectMode) {
    return (
      <button
        type="button"
        onClick={() => onToggleSelect(client)}
        aria-pressed={isSelected}
        aria-label={`${isSelected ? 'Deselect' : 'Select'} ${client.name ?? client.email}`}
        data-testid="client-select-row"
        className={`${state} cursor-pointer text-left`}
      >
        {inner}
      </button>
    )
  }

  // The whole row is the target. `block w-full` matters: a bare <a> is inline,
  // so on a phone the tap area hugged the text runs rather than filling the
  // row's height — the padding either side of the name was dead space.
  return (
    <Link href={`/clients/${client.id}`} className={state}>
      {inner}
    </Link>
  )
}

function EmptyState({ view }: { view: Props['view'] }) {
  return (
    <div className="text-center py-16 text-slate-400">
      <Dog className="h-12 w-12 mx-auto mb-3 opacity-30" />
      {view === 'current' ? (
        <>
          <p className="font-medium">Nobody is in class right now</p>
          <p className="text-sm mt-1">
            This fills up on its own once a class with a session still to come has people on it.
          </p>
          <Link href="/clients/invite" className="mt-4 inline-block">
            <Button size="sm"><UserPlus className="h-4 w-4" />Create new client</Button>
          </Link>
        </>
      ) : view === 'past' ? (
        <>
          <p className="font-medium">No past clients yet</p>
          <p className="text-sm mt-1">
            Once a course finishes, everyone on it moves here — your repeat and referral list.
          </p>
        </>
      ) : view === 'never' ? (
        <>
          <p className="font-medium">Everyone on your list has booked something</p>
          <p className="text-sm mt-1">
            People who join but never book — through a form, or added by hand — show up here.
          </p>
        </>
      ) : (
        <>
          <p className="font-medium">Nobody is archived</p>
          <p className="text-sm mt-1">Anyone you hide from your list will be waiting here.</p>
        </>
      )}
    </div>
  )
}
