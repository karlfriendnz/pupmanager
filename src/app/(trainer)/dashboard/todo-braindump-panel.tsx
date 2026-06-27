'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ListChecks, NotebookPen, Plus, Trash2, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type Member = { id: string; name: string }

type Todo = {
  id: string
  title: string
  done: boolean
  dueDate: string | null
  completedAt: string | null
  createdAt: string
  assignee: { id: string; name: string } | null
}

type TabId = 'todo' | 'braindump'

const TABS: { id: TabId; label: string; icon: typeof ListChecks }[] = [
  { id: 'todo', label: 'To-do', icon: ListChecks },
  { id: 'braindump', label: 'Brain dump', icon: NotebookPen },
]

export function TodoBrainDumpPanel({
  initialTodos,
  initialBrainDump,
  members,
}: {
  initialTodos: Todo[]
  initialBrainDump: string
  // Team members available for assignment. Empty for single-trainer orgs — the
  // panel then hides all assignment UI.
  members: Member[]
}) {
  const [tab, setTab] = useState<TabId>('todo')
  const showAssign = members.length > 1

  return (
    <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
      {/* Tab rail — mirrors the settings-tabs styling (underline on the active
          tab) but laid out horizontally to suit the narrow right rail. */}
      <div className="flex gap-1 px-3 pt-3 border-b border-slate-100">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'relative flex items-center gap-2 px-3 py-2.5 text-sm font-medium rounded-t-lg transition-colors',
                active ? 'text-blue-600' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {t.label}
              {active && <span className="absolute -bottom-px left-3 right-3 h-0.5 bg-blue-600 rounded-full" />}
            </button>
          )
        })}
      </div>

      <div className="p-3">
        {tab === 'todo' ? (
          <TodoTab initialTodos={initialTodos} members={members} showAssign={showAssign} />
        ) : (
          <BrainDumpTab initial={initialBrainDump} />
        )}
      </div>
    </div>
  )
}

// ─── To-do tab ────────────────────────────────────────────────────────────────

function TodoTab({
  initialTodos,
  members,
  showAssign,
}: {
  initialTodos: Todo[]
  members: Member[]
  showAssign: boolean
}) {
  const [todos, setTodos] = useState<Todo[]>(initialTodos)
  const [title, setTitle] = useState('')
  const [assigneeId, setAssigneeId] = useState<string>('')
  const [adding, setAdding] = useState(false)

  async function addTodo(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed || adding) return
    setAdding(true)
    try {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed, assignedToId: assigneeId || null }),
      })
      if (res.ok) {
        const { todo } = await res.json()
        setTodos((prev) => [todo, ...prev])
        setTitle('')
        setAssigneeId('')
      }
    } finally {
      setAdding(false)
    }
  }

  async function toggle(todo: Todo) {
    const done = !todo.done
    setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, done } : t)))
    const res = await fetch(`/api/todos/${todo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done }),
    })
    if (res.ok) {
      const { todo: updated } = await res.json()
      setTodos((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    } else {
      // Revert on failure.
      setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, done: todo.done } : t)))
    }
  }

  async function remove(id: string) {
    const prev = todos
    setTodos((p) => p.filter((t) => t.id !== id))
    const res = await fetch(`/api/todos/${id}`, { method: 'DELETE' })
    if (!res.ok) setTodos(prev)
  }

  async function reassign(todo: Todo, assignedToId: string) {
    const res = await fetch(`/api/todos/${todo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignedToId: assignedToId || null }),
    })
    if (res.ok) {
      const { todo: updated } = await res.json()
      setTodos((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    }
  }

  const open = todos.filter((t) => !t.done)
  const done = todos.filter((t) => t.done)

  return (
    <div>
      <form onSubmit={addTodo} className="space-y-2">
        <div className="flex items-center gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add a to-do…"
            className="flex-1 min-w-0 h-10 px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
          />
          <button
            type="submit"
            disabled={!title.trim() || adding}
            aria-label="Add to-do"
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--pm-brand-600)] text-white hover:bg-[var(--pm-brand-700)] transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </button>
        </div>
        {showAssign && (
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="w-full h-9 px-2.5 rounded-xl border border-slate-200 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </form>

      <div className="mt-3 space-y-1.5">
        {open.length === 0 && done.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-400">Nothing on the list yet.</p>
        )}
        {open.map((t) => (
          <TodoRow
            key={t.id}
            todo={t}
            members={members}
            showAssign={showAssign}
            onToggle={() => toggle(t)}
            onRemove={() => remove(t.id)}
            onReassign={(id) => reassign(t, id)}
          />
        ))}

        {done.length > 0 && (
          <>
            <p className="pt-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">
              Done ({done.length})
            </p>
            {done.map((t) => (
              <TodoRow
                key={t.id}
                todo={t}
                members={members}
                showAssign={showAssign}
                onToggle={() => toggle(t)}
                onRemove={() => remove(t.id)}
                onReassign={(id) => reassign(t, id)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function TodoRow({
  todo,
  members,
  showAssign,
  onToggle,
  onRemove,
  onReassign,
}: {
  todo: Todo
  members: Member[]
  showAssign: boolean
  onToggle: () => void
  onRemove: () => void
  onReassign: (assignedToId: string) => void
}) {
  return (
    <div className="group flex items-start gap-2.5 rounded-xl px-2 py-2 hover:bg-slate-50 transition-colors">
      <button
        type="button"
        onClick={onToggle}
        aria-label={todo.done ? 'Mark as not done' : 'Mark as done'}
        className={cn(
          'mt-0.5 grid h-4 w-4 flex-shrink-0 place-items-center rounded-[5px] border transition-all duration-150 active:scale-90',
          todo.done
            ? 'border-transparent bg-gradient-to-br from-[var(--pm-brand-500)] to-[var(--pm-brand-700)] text-white shadow-sm shadow-[var(--pm-brand-600)]/30'
            : 'border-slate-300 bg-white text-[var(--pm-brand-600)] hover:border-[var(--pm-brand-500)] hover:bg-[var(--pm-brand-50)]',
        )}
      >
        {/* Ghost check fades in on row hover; solid white once done. */}
        <Check
          className={cn(
            'h-3 w-3 transition-all duration-150',
            todo.done ? 'scale-100 opacity-100' : 'scale-75 opacity-0 group-hover:opacity-40',
          )}
          strokeWidth={3.5}
        />
      </button>

      <div className="min-w-0 flex-1">
        <p className={cn('text-sm leading-snug break-words', todo.done ? 'text-slate-400 line-through' : 'text-slate-800')}>
          {todo.title}
        </p>
        {showAssign && (
          <select
            value={todo.assignee?.id ?? ''}
            onChange={(e) => onReassign(e.target.value)}
            className="mt-1 -ml-1 max-w-full rounded-md bg-transparent px-1 py-0.5 text-xs text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        {!showAssign && todo.assignee && (
          <p className="mt-0.5 text-xs text-slate-400">{todo.assignee.name}</p>
        )}
      </div>

      <button
        type="button"
        onClick={onRemove}
        aria-label="Delete to-do"
        className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-slate-300 opacity-0 group-hover:opacity-100 hover:text-rose-600 hover:bg-rose-50 transition-all"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// ─── Brain dump tab ───────────────────────────────────────────────────────────

function BrainDumpTab({ initial }: { initial: string }) {
  const [body, setBody] = useState(initial)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSaved = useRef(initial)

  const save = useCallback(async (value: string) => {
    if (value === lastSaved.current) return
    setStatus('saving')
    const res = await fetch('/api/brain-dump', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: value }),
    })
    if (res.ok) {
      lastSaved.current = value
      setStatus('saved')
    } else {
      setStatus('idle')
    }
  }, [])

  function onChange(value: string) {
    setBody(value)
    setStatus('idle')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => save(value), 800)
  }

  // Flush a pending save on unmount so a quick tab switch / navigation doesn't
  // drop the last keystrokes.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  return (
    <div>
      <textarea
        value={body}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => save(body)}
        placeholder="Brain dump — jot anything down. Saves automatically."
        rows={14}
        className="w-full resize-y rounded-xl border border-slate-200 p-3 text-sm leading-relaxed text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
      />
      <p className="mt-1.5 h-4 text-right text-[11px] text-slate-400">
        {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}
      </p>
    </div>
  )
}
