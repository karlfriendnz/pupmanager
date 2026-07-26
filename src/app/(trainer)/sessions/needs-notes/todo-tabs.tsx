'use client'

import { useState, type ReactNode } from 'react'
import { FileText, ListChecks, NotebookPen } from 'lucide-react'

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
      <div role="tablist" aria-label="To do sections" className="mb-6 flex gap-1 border-b border-slate-200">
        {tabs.map(t => {
          const Icon = ICONS[t.id]
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => select(t.id)}
              className={`relative flex items-center gap-2 whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors sm:px-4 ${
                active ? 'text-accent' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} /> {t.label}
              {t.count != null && t.count > 0 && (
                <span className="text-xs tabular-nums text-slate-400">{t.count}</span>
              )}
              {active && <span className="absolute -bottom-px left-3 right-3 h-0.5 rounded-full bg-accent" />}
            </button>
          )
        })}
      </div>
      {tabs.map(t => (
        <div key={t.id} className={tab === t.id ? '' : 'hidden'}>{t.panel}</div>
      ))}
    </div>
  )
}
