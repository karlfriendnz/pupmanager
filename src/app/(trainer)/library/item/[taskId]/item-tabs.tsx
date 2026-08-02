'use client'

import { useState } from 'react'
import { Send } from 'lucide-react'

import { ModalPortal } from '@/components/shared/modal-portal'

import { ItemActions, ItemEditor, type EditableItem } from './item-editor'
import { AssignDialog, ItemHolders, type Holder } from './item-holders'
import type { Client } from './item-holders'

/**
 * The item screen, as two tabs: what it IS, and who has it.
 *
 * They were stacked — the editor, then the holders list underneath — which put
 * "who has this" below the instructions, the videos, the picture and the
 * handout. Nobody scrolled that far to find it, and the two are different
 * questions: one is authoring, the other is a register.
 *
 * The Library rail is deliberately NOT here. Every other Library screen carries
 * it because you are browsing; this one is the thing you opened, and it wants
 * the full width for a rich-text editor and three columns of media.
 *
 * `data-review-scope` so a review pin records which tab it was made on
 * (AGENTS.md) — without it both tabs pile onto one indistinguishable page key.
 */

type Tab = 'item' | 'holders'

export function ItemTabs({
  item,
  themeHref,
  description,
  holders,
  clients,
}: {
  item: EditableItem
  themeHref: string
  description: string | null
  holders: Holder[]
  clients: Client[]
}) {
  const [tab, setTab] = useState<Tab>('item')
  const [assigning, setAssigning] = useState(false)

  // The actions belong to the ITEM, not to a tab, so they stay put across both
  // — switching tabs to delete something would be a strange trip.
  //
  // Handing it out is the one thing a trainer comes to this screen to DO, so it
  // is a labelled button rather than a row buried under the register of who
  // already has it. It lives here, beside ⋯, which is why the dialog is owned
  // at this level rather than inside the holders panel.
  // "Assign", not "Give this to a client" — a button label is a verb, and the
  // long sentence pushed Save off the edge of a phone.
  const leading = (
    <button
      type="button"
      onClick={() => setAssigning(true)}
      className="inline-flex h-9 flex-shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      <Send className="h-4 w-4 text-slate-500" strokeWidth={1.75} />
      Assign
    </button>
  )
  const actions = <ItemActions item={item} themeHref={themeHref} />

  const strip = (
    <div className="flex gap-5">
      <TabButton id="item" active={tab} onClick={setTab}>Item</TabButton>
      <TabButton id="holders" active={tab} onClick={setTab} count={holders.length}>
        Who has this
      </TabButton>
    </div>
  )

  return (
    <div data-review-scope={`Tab: ${tab === 'item' ? 'Item' : 'Who has this'}`}>
      {tab === 'item' ? (
        <ItemEditor item={item} themeHref={themeHref} heading={strip} leading={leading} actions={actions} />
      ) : (
        <ItemHolders holders={holders} heading={strip} leading={leading} actions={actions} />
      )}

      {assigning && (
        <ModalPortal>
          <AssignDialog
            taskId={item.id}
            description={description}
            clients={clients}
            onClose={() => setAssigning(false)}
          />
        </ModalPortal>
      )}
    </div>
  )
}

/**
 * Flat underline, not a pill track — the house style has no chip controls, and
 * this is the same treatment the offering lists use.
 */
function TabButton({
  id, active, onClick, count, children,
}: {
  id: Tab
  active: Tab
  onClick: (id: Tab) => void
  count?: number
  children: React.ReactNode
}) {
  const on = active === id
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      aria-pressed={on}
      className={`-mb-px shrink-0 border-b-2 py-2 text-sm font-medium transition-colors ${
        on ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
      {count != null && (
        <span className="ml-1.5 text-[11px] font-normal tabular-nums text-slate-400">{count}</span>
      )}
    </button>
  )
}
