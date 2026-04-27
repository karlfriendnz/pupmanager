'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { UserPlus, Search, Dog, Calendar } from 'lucide-react'
import { getInitials } from '@/lib/utils'

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
}

export function ClientsList({ clients, tab }: Props) {
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
      {/* Live search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={`Search ${tab} clients by name, email or dog`}
          className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
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
            <ClientCard key={c.id} client={c} tab={tab} />
          ))}
        </div>
      )}
    </>
  )
}

function ClientCard({ client, tab }: { client: ClientRow; tab: Props['tab'] }) {
  const complianceRate = client.taskCount > 0
    ? Math.round((client.completedCount / client.taskCount) * 100)
    : null
  const nextSession = client.nextSessionAt ? new Date(client.nextSessionAt) : null

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
              {client.shared && (
                <span className="flex-shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
                  Shared
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 truncate">
              {client.dogName ? `🐕 ${client.dogName}${client.dogBreed ? ` · ${client.dogBreed}` : ''}` : 'No dog added yet'}
            </p>
            {nextSession && (
              <p className="text-xs text-blue-600 mt-0.5 flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Next: {nextSession.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })}
                {' · '}
                {nextSession.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })}
              </p>
            )}
          </div>
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
