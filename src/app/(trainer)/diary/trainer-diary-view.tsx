'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody } from '@/components/ui/card'
import {
  Plus, Trash2, CheckCircle, Circle, X, BookOpen, Pencil,
  ChevronRight, Layers, Tag, Check, Loader2, Save,
} from 'lucide-react'
import { formatDate } from '@/lib/utils'

// ─── Types ─────────────────────────────────────────────────────────────────

const taskSchema = z.object({
  title: z.string().min(2, 'Task name is required'),
  description: z.string().optional(),
  repetitions: z.number().int().positive().optional().or(z.literal('')),
  videoUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
})
type TaskFormData = z.infer<typeof taskSchema>

interface Dog { id: string; name: string }
interface Client {
  id: string
  user: { name: string | null; email: string }
  dog: Dog | null
  dogs: Dog[]
}
interface Task {
  id: string
  title: string
  description: string | null
  repetitions: number | null
  videoUrl: string | null
  dogId: string | null
  completion: { note: string | null; videoUrl: string | null } | null
}

interface LibraryTask {
  id: string
  title: string
  description: string | null
  repetitions: number | null
  videoUrl: string | null
  themeId: string
}
interface LibraryTheme { id: string; name: string; typeId: string; tasks: LibraryTask[] }
interface LibraryType { id: string; name: string; themes: LibraryTheme[] }

// ─── Add Task Panel ──────────────────────────────────────────────────────────

function AddTaskPanel({
  clientId,
  date,
  clientDogs,
  onClose,
  onAdded,
}: {
  clientId: string
  date: string
  clientDogs: Dog[]
  onClose: () => void
  onAdded: () => void
}) {
  const [tab, setTab] = useState<'library' | 'custom'>('library')
  const [library, setLibrary] = useState<LibraryType[] | null>(null)
  const [libLoading, setLibLoading] = useState(false)
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null)
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [dogId, setDogId] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  // Custom form
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<TaskFormData>({ resolver: zodResolver(taskSchema) })
  const [customDogId, setCustomDogId] = useState('')

  // Load library when panel opens / tab switches to library
  useEffect(() => {
    if (tab !== 'library' || library !== null) return
    setLibLoading(true)
    fetch('/api/library/types')
      .then(r => r.json())
      .then(data => { setLibrary(data); setLibLoading(false) })
      .catch(() => setLibLoading(false))
  }, [tab, library])

  const selectedType = library?.find(t => t.id === selectedTypeId) ?? null
  const selectedTheme = selectedType?.themes.find(th => th.id === selectedThemeId) ?? null

  function toggleTask(task: LibraryTask) {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(task.id)) next.delete(task.id)
      else next.add(task.id)
      return next
    })
  }

  function allTasksInTheme() {
    if (!selectedTheme) return []
    return selectedTheme.tasks
  }

  function checkedTasksData(): LibraryTask[] {
    if (!library) return []
    const result: LibraryTask[] = []
    for (const type of library) {
      for (const theme of type.themes) {
        for (const task of theme.tasks) {
          if (checked.has(task.id)) result.push(task)
        }
      }
    }
    return result
  }

  async function addLibraryTasks() {
    const tasks = checkedTasksData()
    if (!tasks.length) return
    setAdding(true)
    setAddError(null)
    try {
      await Promise.all(tasks.map(task =>
        fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId,
            date,
            title: task.title,
            description: task.description ?? null,
            repetitions: task.repetitions ?? null,
            videoUrl: task.videoUrl ?? null,
            dogId: dogId || null,
          }),
        })
      ))
      onAdded()
      onClose()
    } catch {
      setAddError('Failed to add tasks. Please try again.')
      setAdding(false)
    }
  }

  async function onAddCustom(data: TaskFormData) {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        date,
        title: data.title,
        description: data.description || null,
        repetitions: data.repetitions || null,
        videoUrl: data.videoUrl || null,
        dogId: customDogId || null,
      }),
    })
    if (!res.ok) return
    reset()
    setCustomDogId('')
    onAdded()
    onClose()
  }

  // ── Library browser ───────────────────────────────────────────────────────

  function LibraryBrowser() {
    if (libLoading) {
      return (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
        </div>
      )
    }

    if (!library) return null

    if (library.length === 0) {
      return (
        <div className="text-center py-12 text-slate-400">
          <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Library is empty</p>
          <p className="text-sm mt-1">Add tasks in the Library section first</p>
        </div>
      )
    }

    // Breadcrumb
    const crumbs: { label: string; onClick: () => void }[] = [
      { label: 'Library', onClick: () => { setSelectedTypeId(null); setSelectedThemeId(null) } },
    ]
    if (selectedType) {
      crumbs.push({ label: selectedType.name, onClick: () => setSelectedThemeId(null) })
    }
    if (selectedTheme) {
      crumbs.push({ label: selectedTheme.name, onClick: () => {} })
    }

    return (
      <div className="flex flex-col gap-3">
        {/* Breadcrumb */}
        {crumbs.length > 1 && (
          <div className="flex items-center gap-1 text-sm flex-wrap">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-slate-300" />}
                <button
                  onClick={c.onClick}
                  className={`${i === crumbs.length - 1 ? 'text-slate-900 font-semibold pointer-events-none' : 'text-blue-600 hover:text-blue-700 font-medium'}`}
                >
                  {c.label}
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Types */}
        {!selectedTypeId && (
          <div className="flex flex-col gap-2">
            {library.map(type => (
              <button
                key={type.id}
                onClick={() => setSelectedTypeId(type.id)}
                className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-all text-left"
              >
                <div className="h-8 w-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <Layers className="h-4 w-4 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900 text-sm">{type.name}</p>
                  <p className="text-xs text-slate-400">
                    {type.themes.length} theme{type.themes.length !== 1 ? 's' : ''} ·{' '}
                    {type.themes.reduce((n, th) => n + th.tasks.length, 0)} tasks
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}

        {/* Themes */}
        {selectedTypeId && !selectedThemeId && selectedType && (
          <div className="flex flex-col gap-2">
            {selectedType.themes.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">No themes in this type yet</p>
            ) : selectedType.themes.map(theme => (
              <button
                key={theme.id}
                onClick={() => setSelectedThemeId(theme.id)}
                className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-violet-300 hover:bg-violet-50/50 transition-all text-left"
              >
                <div className="h-8 w-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                  <Tag className="h-4 w-4 text-violet-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900 text-sm">{theme.name}</p>
                  <p className="text-xs text-slate-400">{theme.tasks.length} task{theme.tasks.length !== 1 ? 's' : ''}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}

        {/* Tasks — with checkboxes */}
        {selectedThemeId && selectedTheme && (
          <div className="flex flex-col gap-2">
            {selectedTheme.tasks.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">No tasks in this theme yet</p>
            ) : (
              <>
                {/* Select all */}
                <button
                  onClick={() => {
                    const allIds = selectedTheme.tasks.map(t => t.id)
                    const allChecked = allIds.every(id => checked.has(id))
                    if (allChecked) {
                      setChecked(prev => { const n = new Set(prev); allIds.forEach(id => n.delete(id)); return n })
                    } else {
                      setChecked(prev => { const n = new Set(prev); allIds.forEach(id => n.add(id)); return n })
                    }
                  }}
                  className="flex items-center gap-2 text-xs text-blue-600 hover:text-blue-700 font-medium self-start"
                >
                  {selectedTheme.tasks.every(t => checked.has(t.id)) ? 'Deselect all' : 'Select all'}
                </button>

                {selectedTheme.tasks.map(task => {
                  const isChecked = checked.has(task.id)
                  return (
                    <button
                      key={task.id}
                      onClick={() => toggleTask(task)}
                      className={`flex items-start gap-3 p-3 rounded-xl border transition-all text-left ${
                        isChecked
                          ? 'border-blue-300 bg-blue-50'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className={`flex-shrink-0 h-5 w-5 rounded border-2 mt-0.5 flex items-center justify-center transition-colors ${
                        isChecked ? 'border-blue-500 bg-blue-500' : 'border-slate-300'
                      }`}>
                        {isChecked && <Check className="h-3 w-3 text-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 text-sm">{task.title}</p>
                        {task.repetitions && <p className="text-xs text-slate-400 mt-0.5">{task.repetitions} reps</p>}
                        {task.description && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{task.description}</p>}
                      </div>
                    </button>
                  )
                })}
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40">
      <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Add tasks</h2>
            <p className="text-xs text-slate-500 mt-0.5">{formatDate(date)}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100 flex-shrink-0">
          <button
            onClick={() => setTab('library')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === 'library'
                ? 'text-blue-600 border-b-2 border-blue-600 -mb-px'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            From Library
          </button>
          <button
            onClick={() => setTab('custom')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === 'custom'
                ? 'text-blue-600 border-b-2 border-blue-600 -mb-px'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Custom task
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
          {tab === 'library' ? (
            <LibraryBrowser />
          ) : (
            <form id="custom-task-form" onSubmit={handleSubmit(onAddCustom)} className="flex flex-col gap-4">
              <Input
                label="Task name"
                placeholder="Sit/Stay practice"
                error={errors.title?.message}
                {...register('title')}
              />

              {clientDogs.length > 1 && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-slate-700">Dog (optional)</label>
                  <select
                    value={customDogId}
                    onChange={e => setCustomDogId(e.target.value)}
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">All dogs</option>
                    {clientDogs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-700">Description (optional)</label>
                <textarea
                  rows={3}
                  placeholder="Ask your dog to sit, then hold for 5 seconds before rewarding..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  {...register('description')}
                />
              </div>

              <div className="flex gap-3">
                <Input
                  label="Repetitions"
                  type="number"
                  placeholder="10"
                  error={errors.repetitions?.message}
                  className="flex-1"
                  {...register('repetitions')}
                />
                <Input
                  label="Video URL"
                  type="url"
                  placeholder="https://..."
                  error={errors.videoUrl?.message}
                  className="flex-[3]"
                  {...register('videoUrl')}
                />
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100 flex-shrink-0">
          {tab === 'library' ? (
            <div className="flex items-center gap-3">
              {/* Dog picker for library tasks */}
              {clientDogs.length > 1 && (
                <select
                  value={dogId}
                  onChange={e => setDogId(e.target.value)}
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1"
                >
                  <option value="">All dogs</option>
                  {clientDogs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              )}
              <Button
                onClick={addLibraryTasks}
                loading={adding}
                disabled={checked.size === 0}
                className="flex-1"
              >
                <Plus className="h-4 w-4" />
                Add {checked.size > 0 ? `${checked.size} task${checked.size !== 1 ? 's' : ''}` : 'tasks'}
              </Button>
            </div>
          ) : (
            <Button
              type="submit"
              form="custom-task-form"
              loading={isSubmitting}
              className="w-full"
            >
              Add task
            </Button>
          )}
          {addError && <p className="text-xs text-red-500 mt-2">{addError}</p>}
        </div>
      </div>
    </div>
  )
}

// ─── Inline task editor ───────────────────────────────────────────────────────

function TaskEditor({
  task,
  clientDogs,
  onSave,
  onCancel,
}: {
  task: Task
  clientDogs: Dog[]
  onSave: (data: Partial<Task>) => Promise<void>
  onCancel: () => void
}) {
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description ?? '')
  const [repetitions, setRepetitions] = useState(task.repetitions?.toString() ?? '')
  const [videoUrl, setVideoUrl] = useState(task.videoUrl ?? '')
  const [dogId, setDogId] = useState(task.dogId ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!title.trim()) return
    setSaving(true)
    await onSave({
      title: title.trim(),
      description: description.trim() || null,
      repetitions: repetitions ? parseInt(repetitions) : null,
      videoUrl: videoUrl.trim() || null,
      dogId: dogId || null,
    })
    setSaving(false)
  }

  return (
    <div className="flex flex-col gap-2 p-3 bg-blue-50 rounded-xl border border-blue-200">
      <input
        autoFocus
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {clientDogs.length > 1 && (
        <select
          value={dogId}
          onChange={e => setDogId(e.target.value)}
          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All dogs</option>
          {clientDogs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      )}
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        rows={2}
        placeholder="Description (optional)"
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
          onClick={save}
          disabled={saving || !title.trim()}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} className="h-8 px-3 rounded-lg text-xs text-slate-500 hover:text-slate-700">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Main view ───────────────────────────────────────────────────────────────

export function TrainerDiaryView({
  clients,
  selectedClientId,
  selectedDate,
  tasks,
}: {
  clients: Client[]
  selectedClientId: string | null
  selectedDate: string
  tasks: Task[]
}) {
  const router = useRouter()
  const [showPanel, setShowPanel] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)

  const selectedClient = clients.find(c => c.id === selectedClientId) ?? null
  const clientDogs: Dog[] = selectedClient
    ? [...(selectedClient.dog ? [selectedClient.dog] : []), ...selectedClient.dogs]
    : []

  function navigate(clientId: string | null, date: string) {
    const params = new URLSearchParams()
    if (clientId) params.set('clientId', clientId)
    params.set('date', date)
    router.push(`/diary?${params}`)
  }

  function getDogName(dogId: string | null) {
    if (!dogId) return null
    return clientDogs.find(d => d.id === dogId)?.name ?? null
  }

  async function deleteTask(taskId: string) {
    await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
    router.refresh()
  }

  async function saveTask(taskId: string, data: Partial<Task>) {
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    setEditingTaskId(null)
    router.refresh()
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Training Diary</h1>

      <div className="flex flex-wrap gap-3 mb-6">
        <select
          value={selectedClientId ?? ''}
          onChange={e => navigate(e.target.value || null, selectedDate)}
          className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select client</option>
          {clients.map(c => (
            <option key={c.id} value={c.id}>
              {c.user.name ?? c.user.email}{c.dog ? ` · ${c.dog.name}` : ''}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={selectedDate}
          onChange={e => navigate(selectedClientId, e.target.value)}
          className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {selectedClientId && (
          <Button size="sm" onClick={() => setShowPanel(true)} className="ml-auto">
            <Plus className="h-4 w-4" /> Add tasks
          </Button>
        )}
      </div>

      {!selectedClientId ? (
        <div className="text-center py-12 text-slate-400">
          <p>Select a client to view or assign tasks</p>
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <p>No tasks for {formatDate(selectedDate)}</p>
          <p className="text-sm mt-1">
            <button onClick={() => setShowPanel(true)} className="text-blue-600 hover:text-blue-700 font-medium">
              Add tasks
            </button>
            {' '}from your library or create a custom one
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {tasks.map(task => (
            <Card key={task.id} className={task.completion ? 'border-green-100 bg-green-50/30' : ''}>
              <CardBody className="pt-4 pb-4">
                {editingTaskId === task.id ? (
                  <TaskEditor
                    task={task}
                    clientDogs={clientDogs}
                    onSave={data => saveTask(task.id, data)}
                    onCancel={() => setEditingTaskId(null)}
                  />
                ) : (
                  <div className="flex items-start gap-3 group">
                    {task.completion ? (
                      <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                    ) : (
                      <Circle className="h-5 w-5 text-slate-300 mt-0.5 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-slate-900">{task.title}</p>
                        {task.dogId && getDogName(task.dogId) && (
                          <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">
                            {getDogName(task.dogId)}
                          </span>
                        )}
                      </div>
                      {task.repetitions && <p className="text-xs text-slate-500">{task.repetitions} reps</p>}
                      {task.description && <p className="text-sm text-slate-600 mt-1">{task.description}</p>}
                      {task.videoUrl && (
                        <a href={task.videoUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline mt-1 block">
                          📹 Instructional video
                        </a>
                      )}
                      {task.completion && (
                        <div className="mt-2 pl-3 border-l-2 border-green-200">
                          {task.completion.note && <p className="text-sm text-slate-600 italic">&ldquo;{task.completion.note}&rdquo;</p>}
                          {task.completion.videoUrl && (
                            <a href={task.completion.videoUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                              📹 Client video
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                    {!task.completion && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => { setEditingTaskId(task.id); setShowPanel(false) }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-blue-500 p-1"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => deleteTask(task.id)} className="text-slate-300 hover:text-red-400 transition-colors p-1">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {showPanel && selectedClientId && (
        <AddTaskPanel
          clientId={selectedClientId}
          date={selectedDate}
          clientDogs={clientDogs}
          onClose={() => setShowPanel(false)}
          onAdded={() => router.refresh()}
        />
      )}
    </div>
  )
}
