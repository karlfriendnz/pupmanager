'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Search, Send, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { FlatBlock, FlatRow, SectionLabel } from '@/components/shared/flat-list'
import { RichText } from '@/components/shared/rich-text'
import { isRichTextEmpty } from '@/lib/rich-text'
import { ErrorNote } from '../../library-forms'

export interface Holder {
  clientId: string
  name: string
  dogName: string | null
  latestDate: string
  count: number
  doneCount: number
  /** false = matched by title only (assigned before the provenance link). */
  linked: boolean
}

export interface Client {
  id: string
  name: string
  dogs: { id: string; name: string }[]
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Task 6 — the people who currently have this library item.
 *
 * "Has" means: a homework row (TrainingTask) on one of this trainer's clients
 * that came from this item. The page resolves that through the new
 * TrainingTask.libraryTaskId provenance column, falling back to an exact title
 * match for rows assigned before that column existed.
 */
export function ItemHolders({
  holders,
  heading,
  leading,
  actions,
}: {
  holders: Holder[]
  /** The tab strip, in place of a plain "Who has this" label. */
  heading?: React.ReactNode
  /** The screen's primary action, e.g. Assign. */
  leading?: React.ReactNode
  /** Duplicate / Delete — the same control the Item tab shows. */
  actions?: React.ReactNode
}) {
  return (
    <section className={heading ? '' : 'mt-8'}>
      {/* As a tab this row is the tab strip; on its own it stays a label. */}
      {heading ? (
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-200">
          {heading}
          <span className="flex items-center gap-1.5 pb-1.5">{leading}{actions}</span>
        </div>
      ) : (
        <SectionLabel>Who has this</SectionLabel>
      )}
      {holders.length === 0 ? (
        <FlatBlock>
          <div className="px-4 py-8 text-center">
            <Users className="mx-auto h-8 w-8 text-slate-300" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-medium text-slate-900">Nobody has this yet</p>
            <p className="mt-1 text-[13px] text-slate-500">
              Give it to a client and it lands in their homework diary.
            </p>
          </div>
        </FlatBlock>
      ) : (
        <FlatBlock>
          {holders.map(h => (
            <FlatRow
              key={h.clientId}
              label={h.dogName ? `${h.name} · ${h.dogName}` : h.name}
              sub={[
                `Last given ${shortDate(h.latestDate)}`,
                h.count > 1 ? `${h.count} times` : null,
                h.doneCount > 0 ? `${h.doneCount} done` : null,
              ].filter(Boolean).join(' · ')}
              href={`/clients/${h.clientId}`}
            />
          ))}
        </FlatBlock>
      )}

    </section>
  )
}

export function AssignDialog({
  taskId,
  description,
  clients,
  onClose,
}: {
  taskId: string
  description: string | null
  clients: Client[]
  onClose: () => void
}) {
  const router = useRouter()
  const [clientId, setClientId] = useState('')
  const [search, setSearch] = useState('')
  const [dogId, setDogId] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const selected = clients.find(c => c.id === clientId)

  // Matches the owner OR any of their dogs — a trainer often knows the dog's name
  // and not the owner's. The chosen client always stays visible, so typing on
  // after choosing can't make the selection vanish.
  const q = search.trim().toLowerCase()
  const visibleClients = q
    ? clients.filter(c =>
        c.id === clientId
        || c.name.toLowerCase().includes(q)
        || c.dogs.some(d => d.name.toLowerCase().includes(q)))
    : clients

  async function submit() {
    if (!clientId || !date) { setError('Pick a client and a date.'); return }
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/library/tasks/${taskId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, date, dogId: dogId || null }),
    })
    if (!res.ok) {
      setSaving(false)
      setError('Could not give this out. Try again.')
      return
    }
    setDone(true)
    router.refresh()
    setTimeout(onClose, 900)
  }

  // Modal handles Esc, click-out and the body-scroll lock; ModalPortal puts it
  // on <body> so the blurred top bar can't become its containing block.
  return (
    <Modal onClose={onClose} title="Give this to a client">
      {done ? (
        <p className="flex items-center gap-2 text-sm text-slate-700">
          <Check className="h-4 w-4 text-slate-700" strokeWidth={1.75} />
          Added to their homework.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {/* The same picker as enrolling into a class (components/trainer/run-roster
              → EnrolModal). A native <select> can't show a dog beside the owner or
              a tick on the chosen row, and at a few hundred clients it's
              unscannable — which is the same reason the class flow stopped using
              one. Names arrive alphabetically from the page query. */}
          <div>
            <label htmlFor="assign-client-search" className="block text-[13px] font-medium text-slate-700">Client</label>
            <div className="relative mt-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" strokeWidth={1.75} />
              <input
                id="assign-client-search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search clients or dogs…"
                autoFocus
                className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>
            {visibleClients.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">No client matches “{search}”.</p>
            ) : (
              <div className="no-scrollbar mt-2 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                {visibleClients.map(c => {
                  const on = c.id === clientId
                  const dogs = c.dogs.map(d => d.name).join(', ')
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setClientId(c.id); setDogId('') }}
                      className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left ${on ? 'bg-slate-50' : 'hover:bg-slate-50'}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-800">{c.name}</span>
                        {dogs && <span className="block truncate text-[11px] text-slate-400">{dogs}</span>}
                      </span>
                      {on && <Check className="h-4 w-4 shrink-0 text-slate-700" strokeWidth={1.75} />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {selected && selected.dogs.length > 0 && (
            <div>
              <label htmlFor="assign-dog" className="block text-[13px] font-medium text-slate-700">Dog</label>
              <select
                id="assign-dog"
                value={dogId}
                onChange={e => setDogId(e.target.value)}
                className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
              >
                <option value="">No particular dog</option>
                {selected.dogs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="assign-date" className="block text-[13px] font-medium text-slate-700">Date</label>
            <input
              id="assign-date"
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>

          {/* Exactly what lands in their diary. Rendered through <RichText/>,
              which sanitizes — never dangerouslySetInnerHTML a description. */}
          {!isRichTextEmpty(description) && (
            <div>
              <p className="text-[13px] font-medium text-slate-700">What they&rsquo;ll get</p>
              <div className="mt-2 rounded-xl border border-slate-200 px-3 py-3">
                <RichText html={description} />
              </div>
            </div>
          )}

          {error && <ErrorNote>{error}</ErrorNote>}

          <Button onClick={submit} loading={saving} className="w-full">
            <Send className="h-4 w-4" strokeWidth={1.75} />
            Add to their homework
          </Button>
        </div>
      )}
    </Modal>
  )
}
