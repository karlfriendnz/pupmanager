'use client'

import { useState } from 'react'

import { ItemActions, ItemEditor, type EditableItem } from './item-editor'
import { ItemHolders, type Holder } from './item-holders'
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

  // The actions belong to the ITEM, not to a tab, so they stay put across both
  // — switching tabs to delete something would be a strange trip.
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
        <ItemEditor item={item} themeHref={themeHref} heading={strip} actions={actions} />
      ) : (
        <ItemHolders
          taskId={item.id}
          description={description}
          holders={holders}
          clients={clients}
          heading={strip}
          actions={actions}
        />
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
