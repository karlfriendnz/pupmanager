'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Plus, Check, StickyNote, ListTodo } from 'lucide-react'
import { formatDate } from '@/lib/utils'

type Note = { id: string; body: string; createdAt: string }
type Task = { id: string; title: string; done: boolean; createdAt: string }

// Internal (super-admin) progress diary + to-dos for a trainer business. Only
// visible in the admin panel; the trainer never sees this.
export function AdminTrainerNotes({
  trainerId,
  initialNotes,
  initialTasks,
}: {
  trainerId: string
  initialNotes: Note[]
  initialTasks: Task[]
}) {
  const router = useRouter()
  const [noteBody, setNoteBody] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const openTasks = initialTasks.filter((t) => !t.done)
  const doneTasks = initialTasks.filter((t) => t.done)

  async function addNote() {
    if (!noteBody.trim() || busy) return
    setBusy(true)
    await fetch('/api/admin/trainer-notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trainerId, body: noteBody.trim() }),
    })
    setNoteBody(''); setBusy(false); router.refresh()
  }
  async function deleteNote(id: string) {
    setBusy(true)
    await fetch(`/api/admin/trainer-notes/${id}`, { method: 'DELETE' })
    setBusy(false); router.refresh()
  }
  async function addTask() {
    if (!taskTitle.trim() || busy) return
    setBusy(true)
    await fetch('/api/admin/trainer-tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trainerId, title: taskTitle.trim() }),
    })
    setTaskTitle(''); setBusy(false); router.refresh()
  }
  async function toggleTask(id: string, done: boolean) {
    setBusy(true)
    await fetch(`/api/admin/trainer-tasks/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done }),
    })
    setBusy(false); router.refresh()
  }
  async function deleteTask(id: string) {
    setBusy(true)
    await fetch(`/api/admin/trainer-tasks/${id}`, { method: 'DELETE' })
    setBusy(false); router.refresh()
  }

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-2">
      {/* ── To-dos ─────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-700 bg-slate-800 p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
          <ListTodo className="h-4 w-4" /> To-dos
        </h2>
        <form onSubmit={(e) => { e.preventDefault(); addTask() }} className="mb-4 flex gap-2">
          <input
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Add a to-do…"
            maxLength={500}
            className="h-10 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" disabled={busy || !taskTitle.trim()} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40">
            <Plus className="h-4 w-4" /> Add
          </button>
        </form>

        {openTasks.length === 0 && doneTasks.length === 0 ? (
          <p className="text-sm text-slate-500">No to-dos yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {openTasks.map((t) => (
              <li key={t.id} className="group flex items-center gap-2.5">
                <button onClick={() => toggleTask(t.id, true)} disabled={busy} aria-label="Mark done"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-500 hover:border-blue-400" />
                <span className="min-w-0 flex-1 truncate text-sm text-slate-100">{t.title}</span>
                <button onClick={() => deleteTask(t.id)} disabled={busy} aria-label="Delete to-do"
                  className="shrink-0 p-1 text-slate-500 opacity-0 transition-opacity hover:text-rose-400 group-hover:opacity-100">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
            {doneTasks.map((t) => (
              <li key={t.id} className="group flex items-center gap-2.5">
                <button onClick={() => toggleTask(t.id, false)} disabled={busy} aria-label="Mark not done"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-blue-500 bg-blue-600 text-white">
                  <Check className="h-3 w-3" />
                </button>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-500 line-through">{t.title}</span>
                <button onClick={() => deleteTask(t.id)} disabled={busy} aria-label="Delete to-do"
                  className="shrink-0 p-1 text-slate-500 opacity-0 transition-opacity hover:text-rose-400 group-hover:opacity-100">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Notes diary ────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-700 bg-slate-800 p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
          <StickyNote className="h-4 w-4" /> Notes
        </h2>
        <form onSubmit={(e) => { e.preventDefault(); addNote() }} className="mb-4 flex flex-col gap-2">
          <textarea
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
            placeholder="Record a note about this trainer's progress…"
            rows={3}
            maxLength={5000}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" disabled={busy || !noteBody.trim()} className="self-end rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40">
            Add note
          </button>
        </form>

        {initialNotes.length === 0 ? (
          <p className="text-sm text-slate-500">No notes yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {initialNotes.map((n) => (
              <li key={n.id} className="group rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 whitespace-pre-wrap text-sm text-slate-200">{n.body}</p>
                  <button onClick={() => deleteNote(n.id)} disabled={busy} aria-label="Delete note"
                    className="shrink-0 p-1 text-slate-500 opacity-0 transition-opacity hover:text-rose-400 group-hover:opacity-100">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">{formatDate(n.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
