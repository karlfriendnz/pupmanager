'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { Loader2, Plus, Trash2, Search, Layers, GripVertical, Repeat } from 'lucide-react'
import { VoiceInput } from '@/components/voice-input'
import { ImageUploadButton, ImageGallery } from '@/components/image-uploader'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface LibraryTask {
  id: string
  title: string
  description: string | null
  repetitions: number | null
  videoUrl: string | null
}

interface LibraryTheme {
  id: string
  name: string
  tasks: LibraryTask[]
}

interface LibraryType {
  id: string
  name: string
  themes: LibraryTheme[]
}

interface AttachedTask {
  id: string
  title: string
  description: string | null
  repetitions: number | null
  videoUrl: string | null
  dogId: string | null
  trainerNote: string | null
  imageUrls: string[]
  order: number
}

/**
 * Library-tasks picker for the session page. Lets the trainer browse the
 * library and one-click-add items as TrainingTasks linked to the session +
 * client. Also lists already-attached tasks with a remove action.
 */
export function SessionLibraryTasks({
  sessionId,
  clientId,
  sessionDate,   // YYYY-MM-DD — used as the TrainingTask.date
}: {
  sessionId: string
  clientId: string | null
  sessionDate: string
}) {
  const [library, setLibrary] = useState<LibraryType[] | null>(null)
  const [attached, setAttached] = useState<AttachedTask[] | null>(null)
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showLibrary, setShowLibrary] = useState(false)

  useEffect(() => {
    fetch('/api/library/types')
      .then(r => r.ok ? r.json() : [])
      .then((data: unknown) => setLibrary(Array.isArray(data) ? (data as LibraryType[]) : []))
      .catch(() => setLibrary([]))
    fetch(`/api/schedule/${sessionId}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: unknown) => {
        const raw = (data as { tasks?: unknown[] } | null)?.tasks ?? []
        setAttached(raw.map(coerceAttachedTask))
      })
      .catch(() => setAttached([]))
  }, [sessionId])

  const allLibraryTasks = useMemo(() => {
    if (!library) return [] as (LibraryTask & { typeName: string; themeName: string })[]
    return library.flatMap(type =>
      type.themes.flatMap(theme =>
        theme.tasks.map(t => ({ ...t, typeName: type.name, themeName: theme.name }))
      )
    )
  }, [library])

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('en-NZ')
    if (!q) return allLibraryTasks
    return allLibraryTasks.filter(t =>
      t.title.toLocaleLowerCase('en-NZ').includes(q) ||
      t.themeName.toLocaleLowerCase('en-NZ').includes(q) ||
      t.typeName.toLocaleLowerCase('en-NZ').includes(q)
    )
  }, [allLibraryTasks, search])

  // Hide library tasks already attached so the trainer doesn't accidentally
  // double-add. We compare on title since attached tasks lose the library id
  // (they're snapshots, not references) — best-effort match.
  const attachedTitles = new Set((attached ?? []).map(t => t.title.toLocaleLowerCase('en-NZ')))

  async function handleAdd(t: LibraryTask) {
    if (!clientId) {
      setError('Session has no client yet — cannot attach tasks.')
      return
    }
    setError(null)
    setAdding(t.id)
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        sessionId,
        date: sessionDate,
        title: t.title,
        description: t.description,
        repetitions: t.repetitions,
        videoUrl: t.videoUrl,
      }),
    })
    if (!res.ok) {
      setError('Failed to add task')
      setAdding(null)
      return
    }
    const created = coerceAttachedTask(await res.json())
    setAttached(prev => ([...(prev ?? []), created]))
    setAdding(null)
  }

  async function handleRemove(taskId: string) {
    const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
    if (res.ok) setAttached(prev => (prev ?? []).filter(t => t.id !== taskId))
  }

  function persistOrder(ids: string[]) {
    void fetch('/api/tasks/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, ids }),
    }).then(res => {
      if (!res.ok) {
        fetch(`/api/schedule/${sessionId}`)
          .then(r => r.ok ? r.json() : null)
          .then((data: unknown) => {
            const raw = (data as { tasks?: unknown[] } | null)?.tasks ?? []
            setAttached(raw.map(coerceAttachedTask))
          })
          .catch(() => {})
      }
    })
  }

  // Pointer activation distance prevents tap-to-drag misfires when the user
  // means to interact with the trainer-note textarea or remove icon.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setAttached(prev => {
      if (!prev) return prev
      const oldIndex = prev.findIndex(t => t.id === active.id)
      const newIndex = prev.findIndex(t => t.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return prev
      const next = arrayMove(prev, oldIndex, newIndex)
      persistOrder(next.map(t => t.id))
      return next
    })
  }

  function setTrainerNote(taskId: string, note: string) {
    setAttached(prev => (prev ?? []).map(t => t.id === taskId ? { ...t, trainerNote: note } : t))
  }

  async function persistTrainerNote(taskId: string, note: string) {
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trainerNote: note }),
    })
  }

  function setImages(taskId: string, urls: string[]) {
    setAttached(prev => (prev ?? []).map(t => t.id === taskId ? { ...t, imageUrls: urls } : t))
    void fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrls: urls }),
    })
  }

  function setRepetitions(taskId: string, reps: number | null) {
    setAttached(prev => (prev ?? []).map(t => t.id === taskId ? { ...t, repetitions: reps } : t))
  }

  async function persistRepetitions(taskId: string, reps: number | null) {
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repetitions: reps }),
    })
  }

  if (library === null || attached === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading library…
      </div>
    )
  }

  if (allLibraryTasks.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        No library tasks yet. Add some in <a href="/templates" className="text-blue-600 hover:underline">Library</a>.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Attached list */}
      {attached.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
            Tasks for this session
          </p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={attached.map(t => t.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-2">
                {attached.map(t => (
                  <AttachedTaskRow
                    key={t.id}
                    task={t}
                    sessionId={sessionId}
                    onRemove={() => handleRemove(t.id)}
                    onNoteChange={(note) => setTrainerNote(t.id, note)}
                    onNoteCommit={(note) => persistTrainerNote(t.id, note)}
                    onImagesChange={(urls) => setImages(t.id, urls)}
                    onRepsChange={(reps) => setRepetitions(t.id, reps)}
                    onRepsCommit={(reps) => persistRepetitions(t.id, reps)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* Add affordances — kept on a single row when collapsed; either grows
          to full width when its form/panel opens. */}
      <div className="flex flex-wrap items-start gap-2">
        <CustomTaskForm
          clientId={clientId}
          onCreate={async (data) => {
            if (!clientId) return
            const res = await fetch('/api/tasks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                clientId,
                sessionId,
                date: sessionDate,
                title: data.title,
                description: data.description,
                repetitions: data.repetitions,
              }),
            })
            if (res.ok) {
              const created = coerceAttachedTask(await res.json())
              setAttached(prev => ([...(prev ?? []), created]))
            }
            return res.ok
          }}
        />

        {!showLibrary ? (
          <button
            onClick={() => setShowLibrary(true)}
            disabled={!clientId}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 rounded-lg hover:bg-blue-50 transition-colors"
            title={!clientId ? 'No client linked to this session' : undefined}
          >
            <Layers className="h-4 w-4" /> Add from library
          </button>
        ) : null}
      </div>

      {/* Library picker — collapsed behind a button to keep the page tidy */}
      <div>
        {!showLibrary ? null : (
          <>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                <Layers className="h-3 w-3" /> Add from library
              </p>
              <button
                onClick={() => setShowLibrary(false)}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                Hide
              </button>
            </div>
            {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search library tasks…"
                className="w-full h-9 pl-9 pr-3 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="text-sm text-slate-400 px-3 py-3">
                  {search ? 'No matches.' : 'No library tasks.'}
                </p>
              ) : (
                filtered.map(t => {
                  const already = attachedTitles.has(t.title.toLocaleLowerCase('en-NZ'))
                  return (
                    <div key={t.id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{t.title}</p>
                        <p className="text-[10px] text-slate-400 truncate">
                          {t.typeName} · {t.themeName}
                          {t.repetitions ? ` · ${t.repetitions} reps` : ''}
                        </p>
                      </div>
                      <button
                        onClick={() => handleAdd(t)}
                        disabled={adding === t.id || already || !clientId}
                        className="flex-shrink-0 h-7 w-7 rounded-full bg-blue-500 hover:bg-blue-600 text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        title={already ? 'Already added' : !clientId ? 'No client linked' : 'Add to session'}
                      >
                        {adding === t.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Plus className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Server returns `imageUrls` as a Prisma JsonValue; defend against missing /
// non-array values so the renderer can rely on `string[]`.
function coerceAttachedTask(raw: unknown): AttachedTask {
  const t = (raw ?? {}) as Record<string, unknown>
  return {
    id: String(t.id ?? ''),
    title: String(t.title ?? ''),
    description: (t.description as string | null) ?? null,
    repetitions: (t.repetitions as number | null) ?? null,
    videoUrl: (t.videoUrl as string | null) ?? null,
    dogId: (t.dogId as string | null) ?? null,
    trainerNote: (t.trainerNote as string | null) ?? null,
    imageUrls: Array.isArray(t.imageUrls) ? (t.imageUrls as string[]) : [],
    order: typeof t.order === 'number' ? t.order : 0,
  }
}

function CustomTaskForm({
  clientId,
  onCreate,
}: {
  clientId: string | null
  onCreate: (data: { title: string; description: string | null; repetitions: number | null }) => Promise<boolean | undefined>
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [reps, setReps] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setTitle(''); setDescription(''); setReps('')
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('Title is required'); return }
    setSubmitting(true)
    const ok = await onCreate({
      title: title.trim(),
      description: description.trim() || null,
      repetitions: reps ? Number(reps) : null,
    })
    setSubmitting(false)
    if (ok) {
      reset()
      setOpen(false)
    } else {
      setError('Failed to add task')
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={!clientId}
        className="inline-flex items-center gap-1 self-start text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 rounded-lg hover:bg-blue-50 transition-colors"
        title={!clientId ? 'No client linked to this session' : undefined}
      >
        <Plus className="h-4 w-4" /> Add custom task
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="w-full border border-slate-200 rounded-xl p-3 flex flex-col gap-2 bg-white">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">New custom task</p>
        <button
          type="button"
          onClick={() => { setOpen(false); reset() }}
          className="text-xs text-slate-400 hover:text-slate-600"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <input
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Task title (e.g. Practice loose-leash on driveway)"
        autoFocus
        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="flex gap-2 items-start">
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={2}
          placeholder="Description (optional)"
          className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <VoiceInput
          onAppend={t => {
            const next = description.trimEnd()
            setDescription(next ? `${next} ${t}` : t)
          }}
        />
      </div>
      <div className="flex gap-2 items-center">
        <input
          type="number"
          min={1}
          value={reps}
          onChange={e => setReps(e.target.value)}
          placeholder="Reps"
          className="h-9 w-24 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={submitting || !title.trim()}
          className="h-9 px-3 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Adding…' : 'Add task'}
        </button>
      </div>
    </form>
  )
}

function AttachedTaskRow({
  task,
  sessionId,
  onRemove,
  onNoteChange,
  onNoteCommit,
  onImagesChange,
  onRepsChange,
  onRepsCommit,
}: {
  task: AttachedTask
  sessionId: string
  onRemove: () => void
  onNoteChange: (note: string) => void
  onNoteCommit: (note: string) => void
  onImagesChange: (urls: string[]) => void
  onRepsChange: (reps: number | null) => void
  onRepsCommit: (reps: number | null) => void
}) {
  // Track the last value we persisted so we can avoid spamming PATCH calls
  // when the user blurs without changes (e.g. tab away from the field).
  const lastSavedRef = useRef(task.trainerNote ?? '')

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.92 : 1,
  }

  function commitIfChanged(value: string) {
    if (value !== lastSavedRef.current) {
      lastSavedRef.current = value
      onNoteCommit(value)
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group/task relative bg-white border border-slate-100 rounded-2xl transition-all ${
        isDragging
          ? 'shadow-xl ring-2 ring-blue-200'
          : 'hover:border-slate-200 hover:shadow-sm'
      }`}
    >
      {/* Drag handle — pinned to the left edge, fades in on hover */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="absolute left-1 top-1/2 -translate-y-1/2 p-1.5 text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing touch-none opacity-0 group-hover/task:opacity-100 transition-opacity"
        aria-label="Drag to reorder"
        title="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Remove — pinned top-right, hover-only, never crowds the title row */}
      <button
        onClick={onRemove}
        className="absolute right-2 top-2 p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover/task:opacity-100 focus:opacity-100"
        aria-label="Remove task"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      <div className="px-5 py-4">
        {/* Title + inline rep counter. The reps live RIGHT AFTER the title
            visually, with their own subtle styling — no labelled form field. */}
        <div className="flex items-baseline gap-3 flex-wrap">
          <h3 className="font-semibold text-slate-900 leading-snug">{task.title}</h3>
          <div className="inline-flex items-center gap-1 text-xs text-slate-400 font-medium">
            <Repeat className="h-3 w-3" />
            <input
              type="number"
              min={0}
              value={task.repetitions ?? ''}
              onChange={e => {
                const v = e.target.value
                onRepsChange(v === '' ? null : Math.max(0, Number(v)))
              }}
              onBlur={() => onRepsCommit(task.repetitions ?? null)}
              placeholder="–"
              aria-label="Reps"
              className="w-9 bg-transparent text-center text-slate-700 font-semibold rounded-md hover:bg-slate-100 focus:bg-white focus:ring-2 focus:ring-blue-300 focus:outline-none transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span>reps</span>
          </div>
        </div>

        {task.description && (
          <p className="text-sm text-slate-500 mt-1 leading-snug">{task.description}</p>
        )}

        {/* Composer — always visible. Action chips float in the bottom-right
            corner of the textarea container, like a chat composer. */}
        <div className="relative mt-3 group/composer rounded-2xl bg-slate-50 border border-transparent focus-within:border-blue-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-50 transition-all">
          <textarea
            value={task.trainerNote ?? ''}
            onChange={e => onNoteChange(e.target.value)}
            onBlur={e => commitIfChanged(e.target.value)}
            placeholder="What did you observe? Notes save automatically."
            rows={2}
            className="w-full bg-transparent px-4 pt-3 pb-10 text-sm leading-relaxed focus:outline-none resize-none placeholder:text-slate-400"
          />
          <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1">
            <VoiceInput
              onAppend={t => {
                const next = (task.trainerNote ?? '').trimEnd()
                const merged = next ? `${next} ${t}` : t
                onNoteChange(merged)
                commitIfChanged(merged)
              }}
            />
            <ImageUploadButton
              onUploaded={(added) => onImagesChange([...(task.imageUrls ?? []), ...added])}
              context={{ sessionId, taskId: task.id }}
            />
          </div>
        </div>

        {/* Image thumbnails */}
        <ImageGallery
          urls={task.imageUrls ?? []}
          onChange={onImagesChange}
          className="mt-3"
        />
      </div>
    </div>
  )
}
