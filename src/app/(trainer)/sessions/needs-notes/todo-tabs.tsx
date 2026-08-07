'use client'

import { useState, type ReactNode } from 'react'
import { FileText, ListChecks, NotebookPen } from 'lucide-react'
import { PageTabs } from '@/components/shared/page-tabs'
import { cn } from '@/lib/utils'

// The To do screen used to stack three unrelated lists one under another —
// the trainer's own to-dos, the brain-dump scratchpad, and the sessions still
// waiting on a write-up or an invoice — so reaching the sessions meant
// scrolling past everything else. They're three tabs now.
//
// Same rail as Finances (border-b + an underline on the active tab), and the
// panels are all mounted and toggled with `hidden` rather than swapped: the
// brain dump saves on a debounce, and unmounting it mid-keystroke drops the
// last thing typed.

export type TodoTabId = 'notes' | 'todo' | 'braindump'

export interface TodoTabSpec {
  id: TodoTabId
  label: string
  /** Shown beside the label when there's something waiting. */
  count?: number
  panel: ReactNode
}

const ICONS: Record<TodoTabId, typeof FileText> = {
  notes: FileText,
  todo: ListChecks,
  braindump: NotebookPen,
}

export function TodoTabs({ tabs, initial = 'notes' }: { tabs: TodoTabSpec[]; initial?: TodoTabId }) {
  const [tab, setTab] = useState<TodoTabId>(tabs.some(t => t.id === initial) ? initial : tabs[0].id)

  function select(id: TodoTabId) {
    setTab(id)
    // Shareable / refreshable, and "back" from a session detail lands where
    // the trainer left off.
    if (typeof window !== 'undefined') history.replaceState(null, '', `?tab=${id}`)
  }

  return (
    <div>
      {/* Laid out like Messages, which Karl picked: the strip goes hard
          against the control bar rather than floating in the page's padding,
          and stays there while the list scrolls under it.

          The negative margin gives back <main>'s top reserve — min(inset, 1rem)
          it holds for pages with no bar of their own. This page has one, so on
          a notched phone that reserve is a band of white between the header
          and the tabs (and nothing at all in a browser, which is how it hides).
          Same fix as the schedule bar and the messages pane.

          The strip's look lives in PageTabs, shared with Alerts and Messages —
          all three drew their own, and all three differently. */}
      <div className="sticky top-[calc(env(safe-area-inset-top,0px)+3.5rem+1px)] md:top-[var(--app-top-offset,0px)] z-20 -mt-[calc(min(env(safe-area-inset-top,0px),1rem))] md:mt-0 bg-white px-4 md:px-8">
        <PageTabs
          label="To do sections"
          className="mb-0"
          active={tab}
          onSelect={id => select(id as TodoTabId)}
          tabs={tabs.map(t => ({ id: t.id, label: t.label, count: t.count, icon: ICONS[t.id] }))}
        />
      </div>
      {tabs.map(t => (
        <div key={t.id} className={cn('p-4 md:p-8', tab === t.id ? '' : 'hidden')}>{t.panel}</div>
      ))}
    </div>
  )
}
