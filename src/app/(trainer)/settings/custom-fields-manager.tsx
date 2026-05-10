'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, Trash2, Pencil, Check, X, GripVertical } from 'lucide-react'

type FieldType = 'TEXT' | 'NUMBER' | 'DROPDOWN'
type AppliesTo = 'OWNER' | 'DOG'

type CustomField = {
  id: string
  label: string
  type: FieldType
  required: boolean
  options: string[]
  category: string | null
  appliesTo: AppliesTo
  order: number
  // True for the three pinned "system" fields (name/email/phone).
  // System rows can be dragged between sections but not edited or
  // deleted; they back real columns on User/ClientProfile.
  isSystem?: boolean
}

// id prefix for the synthetic system rows in the editor; the suffix
// (`name` | `email` | `phone`) is the key in trainerProfile.intakeSystemFieldSections.
const SYSTEM_FIELD_PREFIX = '__system:'
type SystemFieldKey = 'name' | 'email' | 'phone'
type SystemFieldSections = Partial<Record<SystemFieldKey, string | null>>

const SYSTEM_FIELDS: { key: SystemFieldKey; label: string; type: FieldType }[] = [
  { key: 'name', label: 'Name', type: 'TEXT' },
  { key: 'email', label: 'Email', type: 'TEXT' },
  { key: 'phone', label: 'Phone', type: 'TEXT' },
]

function buildSystemFieldRows(sections: SystemFieldSections): CustomField[] {
  return SYSTEM_FIELDS.map((sf, i) => ({
    id: `${SYSTEM_FIELD_PREFIX}${sf.key}`,
    label: sf.label,
    type: sf.type,
    required: true,
    options: [],
    category: sections[sf.key] ?? null,
    appliesTo: 'OWNER' as AppliesTo,
    // Negative order so system rows naturally sort above any custom
    // fields that share the same section, without competing for the
    // 0..N range used by custom fields.
    order: -1000 + i,
    isSystem: true,
  }))
}

function isSystemFieldId(id: string): boolean {
  return id.startsWith(SYSTEM_FIELD_PREFIX)
}

function systemFieldKeyOf(id: string): SystemFieldKey | null {
  if (!isSystemFieldId(id)) return null
  return id.slice(SYSTEM_FIELD_PREFIX.length) as SystemFieldKey
}

const TYPE_LABELS: Record<FieldType, string> = {
  TEXT: 'Text',
  NUMBER: 'Number',
  DROPDOWN: 'Dropdown',
}

const ORPHAN_BUCKET_ID = '__orphan__'

export interface SectionMeta {
  name: string
  description: string | null
}

interface SectionView {
  id: string             // either the section name or ORPHAN_BUCKET_ID
  name: string           // display name ("Fields without a section" for orphans)
  description: string | null
  fields: CustomField[]
  isOrphan: boolean
}

function buildSections(fields: CustomField[], sectionOrder: SectionMeta[]): SectionView[] {
  // Sort fields within their section by `order` so reorders show up immediately
  // even before the page is refetched.
  const sortByOrder = (a: CustomField, b: CustomField) => a.order - b.order
  const knownNames = new Set(sectionOrder.map(s => s.name))
  const orphans = fields.filter(f => !f.category || !knownNames.has(f.category)).sort(sortByOrder)
  const named: SectionView[] = sectionOrder.map(s => ({
    id: s.name,
    name: s.name,
    description: s.description ?? null,
    fields: fields.filter(f => f.category === s.name).sort(sortByOrder),
    isOrphan: false,
  }))
  if (orphans.length === 0) return named
  return [
    { id: ORPHAN_BUCKET_ID, name: 'Fields without a section', description: null, fields: orphans, isOrphan: true },
    ...named,
  ]
}

export function CustomFieldsManager({
  initialFields,
  initialSectionOrder,
  initialSystemFieldSections,
  showSystemFields = false,
}: {
  initialFields: CustomField[]
  initialSectionOrder: SectionMeta[]
  /** Section assignment for the pinned name/email/phone rows. Only
   *  consulted when showSystemFields is true (intake form editor). */
  initialSystemFieldSections?: SystemFieldSections
  /** When true, the editor renders three pinned "system" rows
   *  (Name/Email/Phone) at the top of the orphan / their assigned
   *  sections. Drag-end persists their section to
   *  /api/trainer/profile.intakeSystemFieldSections rather than to
   *  the per-field PATCH used for custom fields. */
  showSystemFields?: boolean
}) {
  const [systemFieldSections, setSystemFieldSections] = useState<SystemFieldSections>(
    initialSystemFieldSections ?? {}
  )
  // Synthetic system rows merged in alongside real custom fields when
  // showSystemFields is on. They take part in the same drag/section
  // placement logic but skip the field-edit PATCH path.
  const systemRows = useMemo(
    () => (showSystemFields ? buildSystemFieldRows(systemFieldSections) : []),
    [showSystemFields, systemFieldSections]
  )
  const [fields, setFields] = useState(initialFields)
  const [sectionOrder, setSectionOrder] = useState(initialSectionOrder)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addingInSection, setAddingInSection] = useState<string | null>(null)
  const [savingFieldId, setSavingFieldId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creatingSection, setCreatingSection] = useState(false)
  const [editingSectionName, setEditingSectionName] = useState<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  // Combine system + custom rows for section placement. Sorting
  // (system first via their negative order) happens inside buildSections.
  const allFields = useMemo(() => [...systemRows, ...fields], [systemRows, fields])
  const sections = useMemo(() => buildSections(allFields, sectionOrder), [allFields, sectionOrder])
  const activeField = activeId ? allFields.find(f => f.id === activeId) ?? null : null
  // Section ids in their current order — used as the SortableContext items
  // for section-level drag, and to detect whether a drag is a section drag
  // (active.id is a section name) vs a field drag (active.id is a field id).
  const sectionIds = useMemo(() => sectionOrder.map(s => s.name), [sectionOrder])
  const activeSection = activeId && sectionIds.includes(activeId)
    ? sectionOrder.find(s => s.name === activeId) ?? null
    : null

  // ─── Section CRUD ────────────────────────────────────────────────────────

  async function persistSectionOrder(next: SectionMeta[]) {
    setSectionOrder(next)
    await fetch('/api/trainer/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intakeSectionOrder: next }),
    })
  }

  async function handleSubmitNewSection(rawName: string, rawDescription: string) {
    const name = rawName.trim()
    if (!name) { setCreatingSection(false); return }
    if (sectionOrder.some(s => s.name === name)) {
      setError(`A section called "${name}" already exists.`)
      return
    }
    setError(null)
    setCreatingSection(false)
    const description = rawDescription.trim() || null
    await persistSectionOrder([...sectionOrder, { name, description }])
  }

  async function handleEditSection(currentName: string, rawName: string, rawDescription: string) {
    const newName = rawName.trim()
    if (!newName) { setEditingSectionName(null); return }
    const renaming = newName !== currentName
    if (renaming && sectionOrder.some(s => s.name === newName)) {
      setError(`A section called "${newName}" already exists.`)
      return
    }
    setError(null)
    const description = rawDescription.trim() || null
    const next = sectionOrder.map(s => s.name === currentName ? { name: newName, description } : s)
    await persistSectionOrder(next)
    setEditingSectionName(null)

    // Cascade rename: update all fields with the old category to the new one.
    if (renaming) {
      const affected = fields.filter(f => f.category === currentName)
      setFields(prev => prev.map(f => f.category === currentName ? { ...f, category: newName } : f))
      await Promise.all(affected.map(f =>
        fetch(`/api/custom-fields/${f.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: newName }),
        })
      ))
      // System fields living in the renamed section need to follow.
      const systemPatch: SystemFieldSections = {}
      for (const [k, v] of Object.entries(systemFieldSections) as [SystemFieldKey, string | null][]) {
        if (v === currentName) systemPatch[k] = newName
      }
      if (Object.keys(systemPatch).length > 0) {
        setSystemFieldSections(prev => ({ ...prev, ...systemPatch }))
        await fetch('/api/trainer/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intakeSystemFieldSections: systemPatch }),
        })
      }
    }
  }

  async function handleDeleteSection(name: string) {
    const customInSection = fields.filter(f => f.category === name).length
    const systemInSection = Object.values(systemFieldSections).filter(v => v === name).length
    const total = customInSection + systemInSection
    if (total > 0) {
      setError(`Move the ${total} field(s) out of "${name}" first, then delete the section.`)
      return
    }
    setError(null)
    await persistSectionOrder(sectionOrder.filter(s => s.name !== name))
  }

  // ─── Field CRUD ──────────────────────────────────────────────────────────

  async function persistFieldUpdate(fieldId: string, patch: Partial<Pick<CustomField, 'category'>> & { order?: number }) {
    const current = fields.find(f => f.id === fieldId)
    if (!current) return
    setSavingFieldId(fieldId)
    try {
      const res = await fetch(`/api/custom-fields/${fieldId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...patch }),
      })
      if (!res.ok) {
        // Roll back optimistic change
        setFields(prev => prev.map(f => f.id === fieldId ? current : f))
      }
    } finally {
      setSavingFieldId(null)
    }
  }

  // ─── Drag and drop ───────────────────────────────────────────────────────

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string)
  }

  // Find which section a field currently lives in, by category. Returns the
  // section id (its name, or ORPHAN_BUCKET_ID for uncategorised) — or null
  // if the id is one of the section drop targets itself.
  function sectionOfField(fieldId: string): string | null {
    const f = allFields.find(x => x.id === fieldId)
    if (!f) return null
    if (!f.category) return ORPHAN_BUCKET_ID
    if (!sectionOrder.some(s => s.name === f.category)) return ORPHAN_BUCKET_ID
    return f.category
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over) return
    const activeIdStr = active.id as string
    const overId = over.id as string

    // ─── Section reorder ──────────────────────────────────────────────
    // Section ids are their names; field ids are cuids, so name-match is
    // a clean discriminator. The orphan bucket can't be reordered (it's
    // auto-positioned at the top whenever there are uncategorised fields).
    if (sectionIds.includes(activeIdStr)) {
      if (!sectionIds.includes(overId)) return
      if (activeIdStr === overId) return
      const oldIndex = sectionOrder.findIndex(s => s.name === activeIdStr)
      const newIndex = sectionOrder.findIndex(s => s.name === overId)
      if (oldIndex === -1 || newIndex === -1) return
      const reordered = arrayMove(sectionOrder, oldIndex, newIndex)
      void persistSectionOrder(reordered)
      return
    }

    const fieldId = activeIdStr
    const field = allFields.find(f => f.id === fieldId)
    if (!field) return

    const fromSection = sectionOfField(fieldId)
    if (!fromSection) return

    // Determine target section: either over.id is a section drop target, OR
    // it's another field — in which case use that field's section.
    const overIsField = allFields.some(f => f.id === overId)
    const toSection = overIsField ? sectionOfField(overId) : overId
    if (!toSection) return

    const newCategory = toSection === ORPHAN_BUCKET_ID ? null : toSection

    // System fields don't have a writable `order` (they always sort
    // first via their negative synthetic order); only their section
    // assignment moves. Custom fields below take the existing path.
    const sysKey = systemFieldKeyOf(fieldId)
    if (sysKey) {
      if (fromSection === toSection) return // no-op reorder among peers
      setSystemFieldSections(prev => ({ ...prev, [sysKey]: newCategory }))
      void fetch('/api/trainer/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intakeSystemFieldSections: { [sysKey]: newCategory } }),
      })
      return
    }

    // Same section reorder: move within the array, recompute orders.
    // System rows participate in section membership but not in this
    // ordering — exclude them so their negative-order values don't
    // get rewritten.
    if (fromSection === toSection) {
      if (!overIsField) return // dropped on container, no reorder target
      const peers = fields.filter(f => sectionOfField(f.id) === fromSection)
      const oldIndex = peers.findIndex(f => f.id === fieldId)
      const newIndex = peers.findIndex(f => f.id === overId)
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return
      const reordered = arrayMove(peers, oldIndex, newIndex)
      const reorderedIds = new Set(reordered.map(f => f.id))
      setFields(prev => {
        const others = prev.filter(f => !reorderedIds.has(f.id))
        return [...others, ...reordered.map((f, i) => ({ ...f, order: i }))]
      })
      // Persist the new order for each field in the section.
      void Promise.all(reordered.map((f, i) =>
        persistFieldUpdate(f.id, { order: i })
      ))
      return
    }

    // Cross-section move: change category, drop at end of target section.
    const peersInTarget = fields.filter(f => sectionOfField(f.id) === toSection)
    const newOrder = peersInTarget.length // append to end
    setFields(prev => prev.map(f => f.id === fieldId ? { ...f, category: newCategory, order: newOrder } : f))
    void persistFieldUpdate(fieldId, { category: newCategory, order: newOrder })
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">Drag fields between sections. Sections show clients one screen at a time.</p>
        <Button size="sm" variant="secondary" onClick={() => setCreatingSection(true)} disabled={creatingSection}>
          <Plus className="h-3.5 w-3.5" />
          Create section
        </Button>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex flex-col gap-3">
          {sections.length === 0 && (
            <Card>
              <CardBody className="py-8 text-center text-slate-400 text-sm">
                No sections yet. Click <strong>Create section</strong> to add one.
              </CardBody>
            </Card>
          )}

          <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
            {sections.map(section => {
              const droppable = (
                <SectionDroppable
                  section={section}
                  isEditingMeta={editingSectionName === section.name}
                  onStartEditMeta={section.isOrphan ? undefined : () => setEditingSectionName(section.name)}
                  onCancelEditMeta={() => setEditingSectionName(null)}
                  onSubmitEditMeta={(name, desc) => handleEditSection(section.name, name, desc)}
                  onDelete={section.isOrphan ? undefined : () => handleDeleteSection(section.name)}
                  onAddField={() => setAddingInSection(section.id)}
                  onEditField={setEditingId}
                  onCancelEdit={() => setEditingId(null)}
                  onFieldSaved={(saved, isNew) => {
                    setFields(prev => isNew ? [...prev, saved] : prev.map(f => f.id === saved.id ? saved : f))
                    setEditingId(null)
                    setAddingInSection(null)
                  }}
                  onFieldDeleted={(id) => setFields(prev => prev.filter(f => f.id !== id))}
                  editingId={editingId}
                  addingHere={addingInSection === section.id}
                  onCancelAdd={() => setAddingInSection(null)}
                  savingFieldId={savingFieldId}
                />
              )
              // Orphan section can't be reordered — it floats to the top.
              if (section.isOrphan) return <div key={section.id}>{droppable}</div>
              return (
                <SortableSection key={section.id} id={section.id}>
                  {(handleProps) => (
                    <SectionDroppable
                      section={section}
                      isEditingMeta={editingSectionName === section.name}
                      onStartEditMeta={() => setEditingSectionName(section.name)}
                      onCancelEditMeta={() => setEditingSectionName(null)}
                      onSubmitEditMeta={(name, desc) => handleEditSection(section.name, name, desc)}
                      onDelete={() => handleDeleteSection(section.name)}
                      onAddField={() => setAddingInSection(section.id)}
                      onEditField={setEditingId}
                      onCancelEdit={() => setEditingId(null)}
                      onFieldSaved={(saved, isNew) => {
                        setFields(prev => isNew ? [...prev, saved] : prev.map(f => f.id === saved.id ? saved : f))
                        setEditingId(null)
                        setAddingInSection(null)
                      }}
                      onFieldDeleted={(id) => setFields(prev => prev.filter(f => f.id !== id))}
                      editingId={editingId}
                      addingHere={addingInSection === section.id}
                      onCancelAdd={() => setAddingInSection(null)}
                      savingFieldId={savingFieldId}
                      dragHandleProps={handleProps}
                    />
                  )}
                </SortableSection>
              )
            })}
          </SortableContext>

          {creatingSection && (
            <SectionMetaForm
              ringClass="ring-2 ring-blue-300 ring-offset-1"
              submitLabel="Add"
              onSubmit={handleSubmitNewSection}
              onCancel={() => { setCreatingSection(false); setError(null) }}
            />
          )}
        </div>

        <DragOverlay>
          {activeField && <FieldDragPreview field={activeField} />}
          {activeSection && <SectionDragPreview section={activeSection} />}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

// ─── Inline section meta form (create + edit) ────────────────────────────────

function SectionMetaForm({
  initialName = '',
  initialDescription = '',
  submitLabel,
  ringClass,
  onSubmit,
  onCancel,
}: {
  initialName?: string
  initialDescription?: string
  submitLabel: string
  ringClass?: string
  onSubmit: (name: string, description: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  function handleEnter(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(name, description) }
    if (e.key === 'Escape') { e.preventDefault(); onCancel() }
  }

  return (
    <Card className={ringClass}>
      <CardBody className="py-3 flex flex-col gap-2">
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={handleEnter}
          placeholder="Section name (e.g. About you)"
          className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          onKeyDown={handleEnter}
          placeholder="Description (optional) — shown to clients above this section"
          rows={2}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
          <Button size="sm" onClick={() => onSubmit(name, description)}>
            <Check className="h-3.5 w-3.5" />
            {submitLabel}
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

// ─── Section (sortable wrapper) ─────────────────────────────────────────────

// Provides the section-level useSortable hook. The section card itself owns
// its layout and renders the activator (drag handle) inside its header — we
// pass the handle props down via render-prop so the handle stays visually
// part of the header without duplicating the section's whole markup here.
type SectionHandleProps = {
  attributes: ReturnType<typeof useSortable>['attributes']
  listeners: ReturnType<typeof useSortable>['listeners']
}

function SortableSection({
  id,
  children,
}: {
  id: string
  children: (handleProps: SectionHandleProps) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  return (
    <div ref={setNodeRef} style={style}>
      {children({ attributes, listeners })}
    </div>
  )
}

// ─── Section (drop target) ──────────────────────────────────────────────────

function SectionDroppable({
  section,
  isEditingMeta,
  onStartEditMeta,
  onCancelEditMeta,
  onSubmitEditMeta,
  onDelete,
  onAddField,
  onEditField,
  onCancelEdit,
  onFieldSaved,
  onFieldDeleted,
  editingId,
  addingHere,
  onCancelAdd,
  savingFieldId,
  dragHandleProps,
}: {
  section: SectionView
  isEditingMeta?: boolean
  onStartEditMeta?: () => void
  onCancelEditMeta?: () => void
  onSubmitEditMeta?: (name: string, description: string) => void
  onDelete?: () => void
  onAddField: () => void
  onEditField: (id: string) => void
  onCancelEdit: () => void
  onFieldSaved: (saved: CustomField, isNew: boolean) => void
  onFieldDeleted: (id: string) => void
  editingId: string | null
  addingHere: boolean
  onCancelAdd: () => void
  savingFieldId: string | null
  /** When provided, renders a grip handle in the section header that
   *  activates section-level drag. Orphan sections receive no handle. */
  dragHandleProps?: SectionHandleProps
}) {
  const { setNodeRef, isOver } = useDroppable({ id: section.id })

  // While editing meta, show the form in place of the header.
  if (isEditingMeta && onSubmitEditMeta && onCancelEditMeta) {
    return (
      <SectionMetaForm
        initialName={section.name}
        initialDescription={section.description ?? ''}
        submitLabel="Save"
        ringClass="ring-2 ring-blue-300 ring-offset-1"
        onSubmit={onSubmitEditMeta}
        onCancel={onCancelEditMeta}
      />
    )
  }

  return (
    <Card className={isOver ? 'ring-2 ring-blue-400 ring-offset-1' : ''}>
      <CardBody className="py-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          {dragHandleProps && (
            <button
              type="button"
              {...dragHandleProps.attributes}
              {...dragHandleProps.listeners}
              className="mt-0.5 -ml-1 p-1 rounded text-slate-300 hover:text-slate-600 cursor-grab active:cursor-grabbing"
              aria-label="Drag section"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h3 className={`text-sm font-semibold ${section.isOrphan ? 'text-amber-700' : 'text-slate-900'}`}>
              {section.name}
              <span className="ml-2 text-xs font-normal text-slate-400">
                {section.fields.length} {section.fields.length === 1 ? 'field' : 'fields'}
              </span>
            </h3>
            {section.description && (
              <p className="text-xs text-slate-500 mt-0.5 leading-snug">{section.description}</p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!section.isOrphan && (
              <Button size="sm" variant="ghost" onClick={onAddField}>
                <Plus className="h-3.5 w-3.5" />
                Add field
              </Button>
            )}
            {onStartEditMeta && (
              <button
                type="button"
                onClick={onStartEditMeta}
                className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                title="Edit section"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                title="Delete section"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div ref={setNodeRef} className="flex flex-col gap-2 min-h-[44px]">
          {section.fields.length === 0 && !addingHere && (
            <p className="text-xs text-slate-400 italic px-2 py-3">
              Drop fields here, or click <strong>Add field</strong>.
            </p>
          )}
          <SortableContext items={section.fields.map(f => f.id)} strategy={verticalListSortingStrategy}>
            {section.fields.map(field => {
              // System rows can't enter the FieldEditor — they're
              // pinned to fixed labels/types/required-state. Render
              // them via SortableFieldRow regardless of editingId.
              if (!field.isSystem && editingId === field.id) {
                return (
                  <FieldEditor
                    key={field.id}
                    initial={field}
                    presetCategory={section.isOrphan ? null : section.name}
                    onCancel={onCancelEdit}
                    onSaved={(saved) => onFieldSaved(saved, false)}
                    onDeleted={() => onFieldDeleted(field.id)}
                  />
                )
              }
              return (
                <SortableFieldRow
                  key={field.id}
                  field={field}
                  onEdit={() => onEditField(field.id)}
                  isSaving={savingFieldId === field.id}
                />
              )
            })}
          </SortableContext>
          {addingHere && (
            <FieldEditor
              presetCategory={section.isOrphan ? null : section.name}
              onCancel={onCancelAdd}
              onSaved={(saved) => onFieldSaved(saved, true)}
            />
          )}
        </div>
      </CardBody>
    </Card>
  )
}

// ─── Field row (draggable) ───────────────────────────────────────────────────

function SortableFieldRow({
  field,
  onEdit,
  isSaving,
}: {
  field: CustomField
  onEdit: () => void
  isSaving: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id })
  const style = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        field.isSystem
          ? 'flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:border-slate-300 transition-colors'
          : 'flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:border-slate-300 transition-colors'
      }
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing"
        aria-label="Drag field"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-900 truncate">
          {field.label}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </p>
        <p className="text-xs text-slate-400">
          {field.isSystem
            ? 'System field · always required'
            : `${TYPE_LABELS[field.type]} · ${field.appliesTo === 'DOG' ? 'Per dog' : 'Per owner'}`}
          {isSaving && <span className="ml-2 text-blue-500">Saving…</span>}
        </p>
      </div>
      {!field.isSystem && (
        <button
          type="button"
          onClick={onEdit}
          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
          aria-label="Edit field"
        >
          <Pencil className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

function FieldDragPreview({ field }: { field: CustomField }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-300 bg-white shadow-lg">
      <GripVertical className="h-4 w-4 text-slate-400" />
      <p className="text-sm font-medium text-slate-900">{field.label}</p>
    </div>
  )
}

function SectionDragPreview({ section }: { section: SectionMeta }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-blue-300 bg-white shadow-xl">
      <GripVertical className="h-4 w-4 text-slate-400" />
      <p className="text-sm font-semibold text-slate-900">{section.name}</p>
    </div>
  )
}

// ─── Field editor (create + edit) ────────────────────────────────────────────

function FieldEditor({
  initial,
  presetCategory,
  onCancel,
  onSaved,
  onDeleted,
}: {
  initial?: CustomField
  presetCategory: string | null
  onCancel: () => void
  onSaved: (saved: CustomField) => void
  onDeleted?: () => void
}) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [type, setType] = useState<FieldType>(initial?.type ?? 'TEXT')
  const [required, setRequired] = useState(initial?.required ?? false)
  const [appliesTo, setAppliesTo] = useState<AppliesTo>(initial?.appliesTo ?? 'OWNER')
  const [options, setOptions] = useState<string[]>(initial?.options ?? [])
  const [optionInput, setOptionInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addOption() {
    const v = optionInput.trim()
    if (!v) return
    if (options.includes(v)) return
    setOptions(prev => [...prev, v])
    setOptionInput('')
  }

  function removeOption(opt: string) {
    setOptions(prev => prev.filter(o => o !== opt))
  }

  async function save() {
    if (!label.trim()) { setError('Label is required'); return }
    if (type === 'DROPDOWN' && options.length === 0) { setError('Add at least one dropdown option'); return }

    setSaving(true)
    setError(null)
    const payload = {
      label: label.trim(),
      type,
      required,
      options: type === 'DROPDOWN' ? options : [],
      category: presetCategory,
      appliesTo,
    }
    const url = initial ? `/api/custom-fields/${initial.id}` : '/api/custom-fields'
    const method = initial ? 'PATCH' : 'POST'
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) {
      setError('Failed to save')
      setSaving(false)
      return
    }
    const saved = await res.json()
    onSaved({
      id: saved.id,
      label: saved.label,
      type: saved.type as FieldType,
      required: saved.required,
      options: Array.isArray(saved.options) ? saved.options as string[] : [],
      category: saved.category ?? null,
      appliesTo: (saved.appliesTo ?? 'OWNER') as AppliesTo,
      order: typeof saved.order === 'number' ? saved.order : 0,
    })
  }

  async function handleDelete() {
    if (!initial) return
    setDeleting(true)
    const res = await fetch(`/api/custom-fields/${initial.id}`, { method: 'DELETE' })
    if (!res.ok) { setDeleting(false); setError('Failed to delete'); return }
    onDeleted?.()
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-3 flex flex-col gap-3">
      <Input
        label="Label"
        placeholder="e.g. Dog's breed"
        value={label}
        onChange={e => setLabel(e.target.value)}
      />
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">Type</label>
          <select
            value={type}
            onChange={e => setType(e.target.value as FieldType)}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="TEXT">Text</option>
            <option value="NUMBER">Number</option>
            <option value="DROPDOWN">Dropdown</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">Applies to</label>
          <select
            value={appliesTo}
            onChange={e => setAppliesTo(e.target.value as AppliesTo)}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="OWNER">Owner</option>
            <option value="DOG">Each dog</option>
          </select>
        </div>
      </div>

      {type === 'DROPDOWN' && (
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-slate-700">Options</label>
          <div className="flex gap-2">
            <Input
              placeholder="Add option"
              value={optionInput}
              onChange={e => setOptionInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOption() } }}
            />
            <Button size="sm" type="button" variant="secondary" onClick={addOption}>Add</Button>
          </div>
          {options.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {options.map(opt => (
                <span key={opt} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white border border-slate-200 text-xs">
                  {opt}
                  <button type="button" onClick={() => removeOption(opt)} className="text-slate-400 hover:text-red-500">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={required}
          onChange={e => setRequired(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-blue-600"
        />
        Required field
      </label>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex items-center gap-2">
        {initial && (
          confirmDelete ? (
            <div className="flex items-center gap-1 mr-auto">
              <button type="button" onClick={() => setConfirmDelete(false)} className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button type="button" onClick={handleDelete} disabled={deleting} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5" />
                {deleting ? 'Deleting…' : 'Confirm'}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="mr-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50">
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          )
        )}
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" loading={saving} onClick={save}>
          <Check className="h-3.5 w-3.5" />
          {initial ? 'Save' : 'Add field'}
        </Button>
      </div>
    </div>
  )
}
