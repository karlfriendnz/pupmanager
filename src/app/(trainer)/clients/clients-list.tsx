'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { UserPlus, Search, Dog, Calendar, Columns3, X, Check, Layers } from 'lucide-react'
import { getInitials, dateParts } from '@/lib/utils'

type BuiltinColumnId = 'email' | 'dog' | 'breed' | 'extraDogs' | 'nextSession' | 'compliance' | 'shared'

const BUILTIN_OPTIONS: { id: BuiltinColumnId; label: string }[] = [
  { id: 'email',       label: 'Email' },
  { id: 'dog',         label: 'Primary dog' },
  { id: 'breed',       label: 'Breed' },
  { id: 'extraDogs',   label: 'Additional dogs' },
  { id: 'nextSession', label: 'Next session' },
  { id: 'compliance',  label: '7-day compliance' },
  { id: 'shared',      label: 'Shared badge' },
]

const BUILTIN_IDS = BUILTIN_OPTIONS.map(o => o.id) as BuiltinColumnId[]

function isBuiltinId(value: string): value is BuiltinColumnId {
  return (BUILTIN_IDS as string[]).includes(value)
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface CustomFieldMeta {
  id: string
  label: string
  appliesTo: string  // "OWNER" | "DOG"
}

interface ClientRow {
  id: string
  name: string | null
  email: string
  dogName: string | null
  dogBreed: string | null
  extraDogNames: string[]   // for searching multi-dog households
  taskCount: number
  completedCount: number
  nextSessionAt: string | null  // ISO string
  shared: boolean
}

interface Props {
  clients: ClientRow[]
  tab: 'new' | 'active' | 'inactive'
  columns: string[]
  customFields: CustomFieldMeta[]
  customValues: Record<string, string>  // key: `${clientId}:${fieldId}`
  groupBy: string | null
  tz: string  // trainer's configured timezone — all dates render in this
}

export function ClientsList({ clients, tab, columns, customFields, customValues, groupBy, tz }: Props) {
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
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const tokens = query.trim().toLocaleLowerCase('en-NZ').split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return clients
    return clients.filter(c => {
      const haystack = [
        c.name ?? '',
        c.email,
        c.dogName ?? '',
        c.dogBreed ?? '',
        ...c.extraDogNames,
      ].join(' ').toLocaleLowerCase('en-NZ')
      return tokens.every(t => haystack.includes(t))
    })
  }, [clients, query])

  return (
    <>
      {/* Live search + group + column picker */}
      <div className="flex items-center gap-2 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`Search ${tab} clients by name, email or dog`}
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
        <div className="relative">
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

      {clients.length === 0 ? (
        <EmptyState tab={tab} />
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <p className="text-sm">No matches for &ldquo;{query}&rdquo;.</p>
        </div>
      ) : (
        <ClientTable
          clients={filtered}
          tab={tab}
          visible={visible}
          customFields={customFields}
          customValues={customValues}
          groupBy={groupKey || null}
          tz={tz}
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
      width: 'minmax(140px, 1.4fr)',
      render: c => <span className="truncate text-slate-500">{c.email}</span>,
    })
  }
  if (visible.has('dog')) {
    cols.push({
      key: 'dog',
      label: 'Primary dog',
      width: 'minmax(100px, 1fr)',
      render: c => (
        <span className="truncate text-slate-700">
          {c.dogName ? <>🐕 {c.dogName}</> : <span className="text-slate-400 italic">No dog</span>}
        </span>
      ),
    })
  }
  if (visible.has('breed')) {
    cols.push({
      key: 'breed',
      label: 'Breed',
      width: 'minmax(100px, 1fr)',
      render: c => c.dogBreed ? <span className="truncate text-slate-600">{c.dogBreed}</span> : <span className="text-slate-300">—</span>,
    })
  }
  if (visible.has('extraDogs')) {
    cols.push({
      key: 'extraDogs',
      label: 'Additional dogs',
      width: 'minmax(120px, 1fr)',
      render: c => c.extraDogNames.length > 0
        ? <span className="truncate text-slate-600">{c.extraDogNames.join(', ')}</span>
        : <span className="text-slate-300">—</span>,
    })
  }
  if (visible.has('nextSession')) {
    cols.push({
      key: 'nextSession',
      label: 'Next session',
      width: 'minmax(140px, 1fr)',
      render: c => {
        const d = c.nextSessionAt ? new Date(c.nextSessionAt) : null
        if (!d) return <span className="text-slate-300">—</span>
        return (
          <span className="inline-flex items-center gap-1 text-blue-600 truncate">
            <Calendar className="h-3 w-3 flex-shrink-0" />
            {d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', timeZone: tz })}
            <span className="text-slate-400">·</span>
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
      width: 'minmax(120px, 1fr)',
      render: c => {
        const v = customValues[`${c.id}:${f.id}`]
        return v ? <span className="truncate text-slate-700">{v}</span> : <span className="text-slate-300">—</span>
      },
    })
  }
  if (visible.has('compliance')) {
    cols.push({
      key: 'compliance',
      label: '7-day',
      align: 'right',
      width: 'minmax(72px, auto)',
      render: c => {
        if (c.taskCount === 0) return <span className="text-xs text-slate-300">no tasks</span>
        const rate = Math.round((c.completedCount / c.taskCount) * 100)
        const color = rate >= 70 ? 'text-green-600' : rate >= 40 ? 'text-amber-600' : 'text-red-500'
        return <span className={`font-semibold tabular-nums ${color}`}>{rate}%</span>
      },
    })
  }

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

function ClientTable({ clients, tab, visible, customFields, customValues, groupBy, tz }: {
  clients: ClientRow[]
  tab: Props['tab']
  visible: Set<string>
  customFields: CustomFieldMeta[]
  customValues: Record<string, string>
  groupBy: string | null
  tz: string
}) {
  const dataColumns = buildDataColumns(visible, customFields, customValues, tz)
  // Identity column (avatar+name) is always present and gets generous space.
  const gridTemplate = `minmax(220px, 1.6fr) ${dataColumns.map(c => c.width).join(' ')}`.trim()

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
    <>
      {/* Header row — only on md+ where columns actually align. */}
      {dataColumns.length > 0 && (
        <div
          className="hidden md:grid items-center gap-4 px-4 mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <span>Client</span>
          {dataColumns.map(c => (
            <span key={c.key} className={`truncate ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</span>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {groups.map(group => (
          <div key={group.key || 'all'} className="flex flex-col gap-2">
            {groupBy && (
              <div className="flex items-baseline gap-2 mt-2 first:mt-0">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group.label}</h3>
                <span className="text-[11px] text-slate-400">{group.rows.length}</span>
              </div>
            )}
            {group.rows.map(c => (
              <ClientRowCard
                key={c.id}
                client={c}
                tab={tab}
                visible={visible}
                dataColumns={dataColumns}
                gridTemplate={gridTemplate}
              />
            ))}
          </div>
        ))}
      </div>
    </>
  )
}

function ClientRowCard({ client, tab, visible, dataColumns, gridTemplate }: {
  client: ClientRow
  tab: Props['tab']
  visible: Set<string>
  dataColumns: DataColumn[]
  gridTemplate: string
}) {
  const showShared = visible.has('shared') && client.shared
  const identity = (
    <div className="flex items-center gap-3 min-w-0">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-semibold text-xs flex-shrink-0">
        {getInitials(client.name ?? client.email)}
      </div>
      <div className="min-w-0 flex items-center gap-1.5">
        <p className="font-semibold text-slate-900 truncate text-sm">
          {client.name ?? client.email}
        </p>
        {showShared && (
          <span className="flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
            Shared
          </span>
        )}
      </div>
    </div>
  )

  return (
    <Link href={`/clients/${client.id}`}>
      <Card className={`px-4 py-3 hover:border-blue-200 hover:shadow-md transition-all cursor-pointer ${tab === 'inactive' ? 'opacity-70' : ''} ${tab === 'new' ? 'border-amber-200 bg-amber-50/30' : ''}`}>
        {/* md+: single-row grid that lines up with the header. */}
        <div
          className="hidden md:grid items-center gap-4"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          {identity}
          {dataColumns.map(c => (
            <div
              key={c.key}
              className={`min-w-0 text-sm flex items-center ${c.align === 'right' ? 'justify-end' : ''}`}
            >
              {c.render(client)}
            </div>
          ))}
        </div>

        {/* <md: stacked label/value rows under the identity row. */}
        <div className="md:hidden">
          {identity}
          {dataColumns.length > 0 && (
            <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
              {dataColumns.map(c => (
                <div key={c.key} className="contents">
                  <dt className="text-slate-400 uppercase tracking-wide text-[10px] self-center">{c.label}</dt>
                  <dd className="text-slate-700 min-w-0 truncate flex items-center">{c.render(client)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </Card>
    </Link>
  )
}

function EmptyState({ tab }: { tab: Props['tab'] }) {
  return (
    <div className="text-center py-16 text-slate-400">
      <Dog className="h-12 w-12 mx-auto mb-3 opacity-30" />
      {tab === 'new' ? (
        <>
          <p className="font-medium">No new registrations</p>
          <p className="text-sm mt-1">Clients who register via your embed forms will appear here</p>
          <Link href="/settings?tab=forms" className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-700">
            Manage embed forms →
          </Link>
        </>
      ) : tab === 'active' ? (
        <>
          <p className="font-medium">No active clients</p>
          <p className="text-sm mt-1">Invite your first client to get started</p>
          <Link href="/clients/invite" className="mt-4 inline-block">
            <Button size="sm"><UserPlus className="h-4 w-4" />Invite client</Button>
          </Link>
        </>
      ) : (
        <>
          <p className="font-medium">No inactive clients</p>
          <p className="text-sm mt-1">Clients you mark as inactive will appear here</p>
        </>
      )}
    </div>
  )
}
