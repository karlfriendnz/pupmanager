'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronRight, Plus, Pencil, Trash2, X, Check,
  BookOpen, Tag, Layers, Send, AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/page-header'

// ─── Types ─────────────────────────────────────────────────────────────────

interface LibraryTask {
  id: string
  title: string
  description: string | null
  repetitions: number | null
  videoUrl: string | null
  themeId: string
}

interface LibraryTheme {
  id: string
  name: string
  typeId: string
  tasks: LibraryTask[]
}

interface LibraryType {
  id: string
  name: string
  themes: LibraryTheme[]
}

interface Client {
  id: string
  name: string
  dogs: { id: string; name: string }[]
}

interface Props {
  initialTypes: LibraryType[]
  clients: Client[]
}

// ─── Inline editable name ────────────────────────────────────────────────────

function InlineName({
  value,
  onSave,
  className = '',
}: {
  value: string
  onSave: (name: string) => Promise<void>
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!draft.trim() || draft.trim() === value) { setEditing(false); return }
    setSaving(true)
    await onSave(draft.trim())
    setSaving(false)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
          className={`border border-blue-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${className}`}
        />
        <button onClick={save} disabled={saving} className="text-green-600 hover:text-green-700 p-1">
          <Check className="h-4 w-4" />
        </button>
        <button onClick={() => setEditing(false)} className="text-slate-400 hover:text-slate-600 p-1">
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => { setDraft(value); setEditing(true) }}
      className={`text-left hover:text-blue-600 group flex items-center gap-1 ${className}`}
    >
      {value}
      <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-40 flex-shrink-0" />
    </button>
  )
}

// ─── Add item inline ─────────────────────────────────────────────────────────

function AddInline({ placeholder, onAdd }: { placeholder: string; onAdd: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!value.trim()) return
    setSaving(true)
    await onAdd(value.trim())
    setValue('')
    setSaving(false)
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-blue-600 py-2 px-1 transition-colors"
      >
        <Plus className="h-4 w-4" />
        Add {placeholder}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 mt-2">
      <input
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setOpen(false) }}
        placeholder={placeholder}
        className="flex-1 h-9 rounded-xl border border-blue-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <button
        onClick={submit}
        disabled={saving || !value.trim()}
        className="h-9 px-3 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        Add
      </button>
      <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

// ─── Delete confirm button ────────────────────────────────────────────────────

function DeleteButton({ onDelete, label }: { onDelete: () => Promise<void>; label: string }) {
  const [confirm, setConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  if (confirm) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-xs text-red-600">Delete {label}?</span>
        <button
          onClick={async () => { setDeleting(true); await onDelete() }}
          disabled={deleting}
          className="text-xs font-medium text-red-600 hover:text-red-700 px-1"
        >
          Yes
        </button>
        <button onClick={() => setConfirm(false)} className="text-xs text-slate-400 hover:text-slate-600 px-1">No</button>
      </div>
    )
  }

  return (
    <button onClick={() => setConfirm(true)} className="text-slate-300 hover:text-red-400 p-1 transition-colors">
      <Trash2 className="h-4 w-4" />
    </button>
  )
}

// ─── Assign task modal ────────────────────────────────────────────────────────

function AssignModal({
  task,
  clients,
  onClose,
  onDone,
}: {
  task: LibraryTask
  clients: Client[]
  onClose: () => void
  onDone: () => void
}) {
  const [clientId, setClientId] = useState('')
  const [dogId, setDogId] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const selectedClient = clients.find(c => c.id === clientId)

  async function submit() {
    if (!clientId || !date) { setError('Please select a client and date.'); return }
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/library/tasks/${task.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, date, dogId: dogId || null }),
    })
    if (!res.ok) {
      const body = await res.json()
      setError(body.error ?? 'Failed to assign task.')
      setSaving(false)
      return
    }
    setSuccess(true)
    setTimeout(() => { onDone(); onClose() }, 1200)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Assign task</h2>
            <p className="text-sm text-slate-500 mt-0.5 truncate max-w-xs">{task.title}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {success ? (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">
            <Check className="h-4 w-4 flex-shrink-0" />
            Task assigned to client's diary!
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">Client</label>
              <select
                value={clientId}
                onChange={e => { setClientId(e.target.value); setDogId('') }}
                className="h-12 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a client…</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {selectedClient && selectedClient.dogs.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-700">Dog (optional)</label>
                <select
                  value={dogId}
                  onChange={e => setDogId(e.target.value)}
                  className="h-12 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">No specific dog</option>
                  {selectedClient.dogs.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="h-12 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {task.repetitions && (
              <p className="text-xs text-slate-400 bg-slate-50 rounded-xl px-3 py-2">
                {task.repetitions} repetitions · {task.description ?? 'No description'}
              </p>
            )}

            <Button onClick={submit} loading={saving} className="w-full">
              <Send className="h-4 w-4" />
              Assign to diary
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Task form (add/edit) ─────────────────────────────────────────────────────

function TaskForm({
  themeId,
  initial,
  onSave,
  onCancel,
}: {
  themeId: string
  initial?: LibraryTask
  onSave: (task: Omit<LibraryTask, 'id' | 'themeId'>) => Promise<void>
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [repetitions, setRepetitions] = useState(initial?.repetitions?.toString() ?? '')
  const [videoUrl, setVideoUrl] = useState(initial?.videoUrl ?? '')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!title.trim()) return
    setSaving(true)
    await onSave({
      title: title.trim(),
      description: description.trim() || null,
      repetitions: repetitions ? parseInt(repetitions) : null,
      videoUrl: videoUrl.trim() || null,
    })
    setSaving(false)
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex flex-col gap-3">
      <input
        autoFocus
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => e.key === 'Escape' && onCancel()}
        placeholder="Task title"
        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Description (optional)"
        rows={2}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
      />
      <div className="flex gap-2">
        <input
          type="number"
          value={repetitions}
          onChange={e => setRepetitions(e.target.value)}
          placeholder="Reps"
          min={1}
          className="h-9 w-24 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          type="url"
          value={videoUrl}
          onChange={e => setVideoUrl(e.target.value)}
          placeholder="Video URL (optional)"
          className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={saving || !title.trim()}
          className="h-8 px-4 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Add task'}
        </button>
        <button onClick={onCancel} className="h-8 px-3 rounded-lg text-sm text-slate-500 hover:text-slate-700">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Main browser component ───────────────────────────────────────────────────

export function LibraryBrowser({ initialTypes, clients }: Props) {
  const router = useRouter()
  const [types, setTypes] = useState<LibraryType[]>(initialTypes)
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null)
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [addingTask, setAddingTask] = useState(false)
  const [assigningTask, setAssigningTask] = useState<LibraryTask | null>(null)

  const selectedType = types.find(t => t.id === selectedTypeId) ?? null
  const selectedTheme = selectedType?.themes.find(th => th.id === selectedThemeId) ?? null

  // ── Mutations ──────────────────────────────────────────────────────────────

  async function addType(name: string) {
    const res = await fetch('/api/library/types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) return
    const newType: LibraryType = { ...(await res.json()), themes: [] }
    setTypes(prev => [...prev, newType])
  }

  async function renameType(typeId: string, name: string) {
    const res = await fetch(`/api/library/types/${typeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) return
    setTypes(prev => prev.map(t => t.id === typeId ? { ...t, name } : t))
  }

  async function deleteType(typeId: string) {
    const res = await fetch(`/api/library/types/${typeId}`, { method: 'DELETE' })
    if (!res.ok) return
    setTypes(prev => prev.filter(t => t.id !== typeId))
    if (selectedTypeId === typeId) { setSelectedTypeId(null); setSelectedThemeId(null) }
  }

  async function addTheme(typeId: string, name: string) {
    const res = await fetch('/api/library/themes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, typeId }),
    })
    if (!res.ok) return
    const newTheme: LibraryTheme = { ...(await res.json()), tasks: [] }
    setTypes(prev => prev.map(t => t.id === typeId ? { ...t, themes: [...t.themes, newTheme] } : t))
  }

  async function renameTheme(themeId: string, name: string) {
    const res = await fetch(`/api/library/themes/${themeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) return
    setTypes(prev => prev.map(t => ({
      ...t,
      themes: t.themes.map(th => th.id === themeId ? { ...th, name } : th),
    })))
  }

  async function deleteTheme(themeId: string, typeId: string) {
    const res = await fetch(`/api/library/themes/${themeId}`, { method: 'DELETE' })
    if (!res.ok) return
    setTypes(prev => prev.map(t => t.id === typeId ? { ...t, themes: t.themes.filter(th => th.id !== themeId) } : t))
    if (selectedThemeId === themeId) setSelectedThemeId(null)
  }

  async function addTask(themeId: string, data: Omit<LibraryTask, 'id' | 'themeId'>) {
    const res = await fetch('/api/library/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeId, ...data }),
    })
    if (!res.ok) return
    const newTask: LibraryTask = await res.json()
    setTypes(prev => prev.map(t => ({
      ...t,
      themes: t.themes.map(th => th.id === themeId ? { ...th, tasks: [...th.tasks, newTask] } : th),
    })))
    setAddingTask(false)
  }

  async function updateTask(taskId: string, themeId: string, data: Omit<LibraryTask, 'id' | 'themeId'>) {
    const res = await fetch(`/api/library/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) return
    const updated: LibraryTask = await res.json()
    setTypes(prev => prev.map(t => ({
      ...t,
      themes: t.themes.map(th => th.id === themeId ? {
        ...th,
        tasks: th.tasks.map(tk => tk.id === taskId ? updated : tk),
      } : th),
    })))
    setEditingTaskId(null)
  }

  async function deleteTask(taskId: string, themeId: string) {
    const res = await fetch(`/api/library/tasks/${taskId}`, { method: 'DELETE' })
    if (!res.ok) return
    setTypes(prev => prev.map(t => ({
      ...t,
      themes: t.themes.map(th => th.id === themeId ? {
        ...th,
        tasks: th.tasks.filter(tk => tk.id !== taskId),
      } : th),
    })))
  }

  // ── Level 0: Types grid ────────────────────────────────────────────────────

  function TypesView() {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Library</h1>
            <p className="text-sm text-slate-500 mt-0.5">Your training task library, organised by type and theme</p>
          </div>
        </div>

        {types.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Your library is empty</p>
            <p className="text-sm mt-1">Start by adding a training type like "Obedience" or "Agility"</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {types.map(type => (
              <div
                key={type.id}
                className="group bg-white rounded-2xl border border-slate-200 p-5 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer"
                onClick={() => { setSelectedTypeId(type.id); setSelectedThemeId(null) }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="h-10 w-10 rounded-xl bg-blue-100 flex items-center justify-center">
                    <Layers className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                    <DeleteButton onDelete={() => deleteType(type.id)} label={type.name} />
                  </div>
                </div>
                <div onClick={e => e.stopPropagation()}>
                  <InlineName
                    value={type.name}
                    onSave={name => renameType(type.id, name)}
                    className="font-semibold text-slate-900 text-base"
                  />
                </div>
                <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                  <span>{type.themes.length} theme{type.themes.length !== 1 ? 's' : ''}</span>
                  <span>·</span>
                  <span>{type.themes.reduce((n, th) => n + th.tasks.length, 0)} tasks</span>
                </div>
                <div className="flex items-center gap-1 mt-3 text-xs text-blue-600 font-medium">
                  <span>Browse</span>
                  <ChevronRight className="h-3 w-3" />
                </div>
              </div>
            ))}
          </div>
        )}

        <AddInline placeholder="type (e.g. Obedience)" onAdd={addType} />
      </div>
    )
  }

  // ── Level 1: Themes list ───────────────────────────────────────────────────

  function ThemesView() {
    if (!selectedType) return null
    return (
      <div>
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-sm text-slate-500 mb-6">
          <button onClick={() => { setSelectedTypeId(null); setSelectedThemeId(null) }} className="hover:text-blue-600 font-medium">
            Library
          </button>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="text-slate-900 font-semibold">{selectedType.name}</span>
        </div>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{selectedType.name}</h1>
            <p className="text-sm text-slate-500 mt-0.5">{selectedType.themes.length} theme{selectedType.themes.length !== 1 ? 's' : ''}</p>
          </div>
        </div>

        {selectedType.themes.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <Tag className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No themes yet</p>
            <p className="text-sm mt-1">Add themes like "Basic Commands" or "Leash Manners"</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 mb-4">
            {selectedType.themes.map(theme => (
              <div
                key={theme.id}
                className="group flex items-center gap-4 bg-white rounded-2xl border border-slate-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer"
                onClick={() => setSelectedThemeId(theme.id)}
              >
                <div className="h-9 w-9 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
                  <Tag className="h-4 w-4 text-violet-600" />
                </div>
                <div className="flex-1 min-w-0" onClick={e => e.stopPropagation()}>
                  <InlineName
                    value={theme.name}
                    onSave={name => renameTheme(theme.id, name)}
                    className="font-semibold text-slate-900"
                  />
                  <p className="text-xs text-slate-400 mt-0.5">{theme.tasks.length} task{theme.tasks.length !== 1 ? 's' : ''}</p>
                </div>
                <div className="flex items-center gap-1">
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                    <DeleteButton onDelete={() => deleteTheme(theme.id, theme.typeId)} label={theme.name} />
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300" />
                </div>
              </div>
            ))}
          </div>
        )}

        <AddInline placeholder="theme (e.g. Basic Commands)" onAdd={name => addTheme(selectedType.id, name)} />
      </div>
    )
  }

  // ── Level 2: Tasks list ────────────────────────────────────────────────────

  function TasksView() {
    if (!selectedType || !selectedTheme) return null

    return (
      <div>
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-sm text-slate-500 mb-6 flex-wrap">
          <button onClick={() => { setSelectedTypeId(null); setSelectedThemeId(null) }} className="hover:text-blue-600 font-medium">
            Library
          </button>
          <ChevronRight className="h-3.5 w-3.5" />
          <button onClick={() => setSelectedThemeId(null)} className="hover:text-blue-600 font-medium">
            {selectedType.name}
          </button>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="text-slate-900 font-semibold">{selectedTheme.name}</span>
        </div>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{selectedTheme.name}</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {selectedType.name} · {selectedTheme.tasks.length} task{selectedTheme.tasks.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {selectedTheme.tasks.length === 0 && !addingTask ? (
          <div className="text-center py-12 text-slate-400 mb-4">
            <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No tasks yet</p>
            <p className="text-sm mt-1">Add training tasks to this theme</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 mb-4">
            {selectedTheme.tasks.map(task => (
              <div key={task.id}>
                {editingTaskId === task.id ? (
                  <TaskForm
                    themeId={selectedTheme.id}
                    initial={task}
                    onSave={data => updateTask(task.id, selectedTheme.id, data)}
                    onCancel={() => setEditingTaskId(null)}
                  />
                ) : (
                  <div className="group bg-white rounded-2xl border border-slate-200 p-4 hover:border-slate-300 transition-all">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-900 text-sm">{task.title}</p>
                        {task.description && (
                          <p className="text-sm text-slate-500 mt-0.5 line-clamp-2">{task.description}</p>
                        )}
                        {task.repetitions && (
                          <p className="text-xs text-slate-400 mt-1">{task.repetitions} reps</p>
                        )}
                        {task.videoUrl && (
                          <a
                            href={task.videoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-500 hover:text-blue-700 mt-1 inline-block"
                            onClick={e => e.stopPropagation()}
                          >
                            View video →
                          </a>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => setAssigningTask(task)}
                          className="flex items-center gap-1.5 h-8 px-3 rounded-xl bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors"
                        >
                          <Send className="h-3 w-3" />
                          Assign
                        </button>
                        <button
                          onClick={() => { setEditingTaskId(task.id); setAddingTask(false) }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-blue-500 p-1"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                          <DeleteButton onDelete={() => deleteTask(task.id, selectedTheme.id)} label={task.title} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {addingTask ? (
          <TaskForm
            themeId={selectedTheme.id}
            onSave={data => addTask(selectedTheme.id, data)}
            onCancel={() => setAddingTask(false)}
          />
        ) : (
          <button
            onClick={() => { setAddingTask(true); setEditingTaskId(null) }}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-blue-600 py-2 px-1 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add task
          </button>
        )}
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <PageHeader title="Library" />
      <div className="p-4 md:p-8 w-full max-w-4xl xl:max-w-7xl mx-auto">

      {!selectedTypeId && <TypesView />}
      {selectedTypeId && !selectedThemeId && <ThemesView />}
      {selectedTypeId && selectedThemeId && <TasksView />}

      {assigningTask && (
        <AssignModal
          task={assigningTask}
          clients={clients}
          onClose={() => setAssigningTask(null)}
          onDone={() => {}}
        />
      )}
      </div>
    </>
  )
}
