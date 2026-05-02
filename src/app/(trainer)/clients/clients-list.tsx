'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { UserPlus, Search, Dog, Calendar, Columns3, X, Check } from 'lucide-react'
import { getInitials } from '@/lib/utils'

type BuiltinColumnId = 'email' | 'dog' | 'extraDogs' | 'nextSession' | 'compliance' | 'shared'

const BUILTIN_OPTIONS: { id: BuiltinColumnId; label: string }[] = [
  { id: 'email',       label: 'Email' },
  { id: 'dog',         label: 'Primary dog' },
  { id: 'extraDogs',   label: 'Additional dogs' },
  { id: 'nextSession', label: 'Next session' },
  { id: 'compliance',  label: '7-day compliance' },
  { id: 'shared',      label: 'Shared badge' },
]

const BUILTIN_IDS = BUILTIN_OPTIONS.map(o => o.id) as BuiltinColumnId[]

function isBuiltinId(value: string): value is BuiltinColumnId {
  return (BUILTIN_IDS as string[]).includes(value)
}

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
}

export function ClientsList({ clients, tab, columns, customFields, customValues }: Props) {
  const validCustomIds = new Set(customFields.map(f => f.id))
  const initial = columns.filter(c => isBuiltinId(c) || (c.startsWith('custom:') && validCustomIds.has(c.slice(7))))
  const [visible, setVisible] = useState<Set<string>>(new Set(initial))
  const [pickerOpen, setPickerOpen] = useState(false)
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
      {/* Live search + column picker */}
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
        <div className="flex flex-col gap-3">
          {filtered.map(c => (
            <ClientCard
              key={c.id}
              client={c}
              tab={tab}
              visible={visible}
              customFields={customFields}
              customValues={customValues}
            />
          ))}
        </div>
      )}
    </>
  )
}

function ClientCard({ client, tab, visible, customFields, customValues }: {
  client: ClientRow
  tab: Props['tab']
  visible: Set<string>
  customFields: CustomFieldMeta[]
  customValues: Record<string, string>
}) {
  const complianceRate = client.taskCount > 0
    ? Math.round((client.completedCount / client.taskCount) * 100)
    : null
  const nextSession = client.nextSessionAt ? new Date(client.nextSessionAt) : null
  const showCompliance = visible.has('compliance')
  const showNextSession = visible.has('nextSession') && nextSession
  const showDog = visible.has('dog')
  const showExtraDogs = visible.has('extraDogs') && client.extraDogNames.length > 0
  const showEmail = visible.has('email') && client.name && client.email && client.name !== client.email
  const showShared = visible.has('shared') && client.shared

  return (
    <Link href={`/clients/${client.id}`}>
      <Card className={`p-4 hover:border-blue-200 hover:shadow-md transition-all cursor-pointer ${tab === 'inactive' ? 'opacity-70' : ''} ${tab === 'new' ? 'border-amber-200 bg-amber-50/30' : ''}`}>
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-semibold text-sm flex-shrink-0">
            {getInitials(client.name ?? client.email)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-slate-900 truncate">
                {client.name ?? client.email}
              </p>
              {showShared && (
                <span className="flex-shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
                  Shared
                </span>
              )}
            </div>
            {showEmail && (
              <p className="text-xs text-slate-400 truncate">{client.email}</p>
            )}
            {showDog && (
              <p className="text-sm text-slate-500 truncate">
                {client.dogName ? `🐕 ${client.dogName}${client.dogBreed ? ` · ${client.dogBreed}` : ''}` : 'No dog added yet'}
              </p>
            )}
            {showExtraDogs && (
              <p className="text-xs text-slate-500 truncate">
                + {client.extraDogNames.join(', ')}
              </p>
            )}
            {showNextSession && (
              <p className="text-xs text-blue-600 mt-0.5 flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Next: {nextSession!.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })}
                {' · '}
                {nextSession!.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })}
              </p>
            )}
            {customFields
              .filter(f => visible.has(`custom:${f.id}`))
              .map(f => {
                const value = customValues[`${client.id}:${f.id}`]
                if (!value) return null
                return (
                  <p key={f.id} className="text-xs text-slate-500 truncate">
                    <span className="text-slate-400">{f.label}: </span>
                    {value}
                  </p>
                )
              })}
          </div>
          {showCompliance && (
            <div className="text-right flex-shrink-0">
              {complianceRate !== null ? (
                <>
                  <p className={`text-lg font-bold ${complianceRate >= 70 ? 'text-green-600' : complianceRate >= 40 ? 'text-amber-600' : 'text-red-500'}`}>
                    {complianceRate}%
                  </p>
                  <p className="text-xs text-slate-400">7-day compliance</p>
                </>
              ) : (
                <p className="text-xs text-slate-400">No tasks assigned</p>
              )}
            </div>
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
          <Link href="/forms" className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-700">
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
