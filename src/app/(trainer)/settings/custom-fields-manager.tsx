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
import { fieldUsage, type FieldUsage } from '@/lib/field-usage'
import { CLIENT_FIELDS, type ClientFieldKey, type ResolvedFieldConfig } from '@/lib/client-fields'

type FieldType = 'TEXT' | 'NUMBER' | 'DROPDOWN'
type AppliesTo = 'OWNER' | 'DOG'

type CustomField = {
  id: string
  label: string
  type: FieldType
  required: boolean
  /** Also collected on the quick-add contact form. */
  inQuickAdd?: boolean
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

export function buildSections(
  fields: CustomField[],
  sectionOrder: SectionMeta[],
  // Keep the orphan bucket on screen even when it's empty — used while the
  // trainer is adding a field that doesn't belong to any section yet.
  forceOrphan = false
): SectionView[] {
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
  if (orphans.length === 0 && !forceOrphan) return named
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
  // The built-in client/dog details (address, dog name, breed, …). They back
  // real columns, so they're configured, not created — but they're the same
  // kind of thing to a trainer, so they live in the same list.
  const [builtInConfig, setBuiltInConfig] = useState<ResolvedFieldConfig | null>(null)
  const [savingBuiltinKey, setSavingBuiltinKey] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch('/api/clients/field-config')
      .then(r => r.json())
      .then(d => { if (live) setBuiltInConfig(d.config ?? null) })
      .catch(() => {})
    return () => { live = false }
  }, [])

  // Name/email/phone already appear as the pinned system rows on the intake
  // form, so they'd be duplicated here.
  const CORE_KEYS: ClientFieldKey[] = ['name', 'email', 'phone']
  const builtIns = builtInConfig
    ? CLIENT_FIELDS.filter(f => !CORE_KEYS.includes(f.key)).map(f => ({
        key: f.key,
        label: f.label,
        scope: f.scope,
        alwaysRequired: !!f.alwaysRequired,
        required: builtInConfig[f.key].required,
        quickAdd: builtInConfig[f.key].quickAdd,
      }))
    : []

  async function toggleBuiltin(key: ClientFieldKey, flag: 'required' | 'quickAdd', value: boolean) {
    if (!builtInConfig) return
    const previous = builtInConfig
    const next = { ...builtInConfig, [key]: { ...builtInConfig[key], [flag]: value } }
    setBuiltInConfig(next)
    setSavingBuiltinKey(key)
    try {
      const res = await fetch('/api/trainer/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientFieldConfig: next }),
      })
      if (!res.ok) {
        setBuiltInConfig(previous)
        setError('Could not save that change. Please try again.')
      }
    } catch {
      setBuiltInConfig(previous)
      setError('Could not save that change. Please try again.')
    } finally {
      setSavingBuiltinKey(null)
    }
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  // Combine system + custom rows for section placement. Sorting
  // (system first via their negative order) happens inside buildSections.
  const allFields = useMemo(() => [...systemRows, ...fields], [systemRows, fields])
  const sections = useMemo(
    () => buildSections(allFields, sectionOrder, addingInSection === ORPHAN_BUCKET_ID),
    [allFields, sectionOrder, addingInSection]
  )
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

  // Required / Quick-add flip straight from the row — that's the answer to
  // "how do I get this field onto that form", right where the field is defined.
  async function toggleFieldFlag(field: CustomField, flag: 'required' | 'inQuickAdd', value: boolean) {
    setFields(prev => prev.map(f => f.id === field.id ? { ...f, [flag]: value } : f))
    setSavingFieldId(field.id)
    try {
      const res = await fetch(`/api/custom-fields/${field.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [flag]: value }),
      })
      if (!res.ok) {
        setFields(prev => prev.map(f => f.id === field.id ? field : f)) // revert
        setError('Could not save that change. Please try again.')
      }
    } catch {
      setFields(prev => prev.map(f => f.id === field.id ? field : f))
      setError('Could not save that change. Please try again.')
    } finally {
      setSavingFieldId(null)
    }
  }

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

  // One list, not three. Sections group the rows; the columns on the right say
  // where each field is asked, so the answer is read off a header once instead
  // of being restated on all 11 rows.
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-slate-500">
          Drag to reorder or move between sections. Clients see one section per screen.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setAddingInSection(ORPHAN_BUCKET_ID)}
            disabled={addingInSection === ORPHAN_BUCKET_ID}
          >
            <Plus className="h-3.5 w-3.5" />
            Add field
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setCreatingSection(true)} disabled={creatingSection}>
            <Plus className="h-3.5 w-3.5" />
            Create section
          </Button>
        </div>
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
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          {/* Column headers — the "where is this asked" legend, stated once. */}
          <div className="hidden sm:grid grid-cols-[1fr_5rem_5.5rem_5.5rem_2rem] gap-2 items-center px-4 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <span>Field</span>
            <span className="text-center">Intake</span>
            <span className="text-center">Quick add</span>
            <span className="text-center">Required</span>
            <span />
          </div>

          {sections.length === 0 && builtIns.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate-400">
              Nothing here yet — <strong>Suggest fields</strong> is the quickest start.
            </p>
          )}

          <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
            {sections.map(section => {
              const common = {
                section,
                isEditingMeta: editingSectionName === section.name,
                onCancelEditMeta: () => setEditingSectionName(null),
                onSubmitEditMeta: (name: string, desc: string) => handleEditSection(section.name, name, desc),
                onAddField: () => setAddingInSection(section.id),
                onEditField: setEditingId,
                onToggleFlag: toggleFieldFlag,
                onCancelEdit: () => setEditingId(null),
                onFieldSaved: (saved: CustomField, isNew: boolean) => {
                  setFields(prev => isNew ? [...prev, saved] : prev.map(f => f.id === saved.id ? saved : f))
                  setEditingId(null)
                  setAddingInSection(null)
                },
                onFieldDeleted: (id: string) => setFields(prev => prev.filter(f => f.id !== id)),
                editingId,
                addingHere: addingInSection === section.id,
                onCancelAdd: () => setAddingInSection(null),
                savingFieldId,
              }
              // The ungrouped bucket floats at the top and can't be reordered.
              if (section.isOrphan) {
                return <SectionGroup key={section.id} {...common} />
              }
              return (
                <SortableSection key={section.id} id={section.id}>
                  {(handleProps) => (
                    <SectionGroup
                      {...common}
                      onStartEditMeta={() => setEditingSectionName(section.name)}
                      onDelete={() => handleDeleteSection(section.name)}
                      dragHandleProps={handleProps}
                    />
                  )}
                </SortableSection>
              )
            })}
          </SortableContext>

          {/* Built-in client/dog details — same rows, same columns, so there's
              one way to read a field. They back real columns, so they can't be
              renamed, deleted or dragged onto the intake form. */}
          {builtIns.length > 0 && (
            <div>
              <GroupHeader
                title="Client & dog details"
                count={builtIns.length}
                hint="Built-in — asked when you create a client"
              />
              {builtIns.map(b => (
                <FieldRow
                  key={b.key}
                  label={b.label}
                  meta={b.scope === 'DOG' ? 'Built-in · Per dog' : 'Built-in · Per owner'}
                  usage={fieldUsage({ kind: 'DETAIL', required: b.required, quickAdd: b.quickAdd })}
                  required={b.required}
                  quickAdd={b.quickAdd}
                  requiredLocked={b.alwaysRequired}
                  saving={savingBuiltinKey === b.key}
                  onToggle={(flag, value) => toggleBuiltin(b.key, flag, value)}
                />
              ))}
            </div>
          )}

          {creatingSection && (
            <div className="border-t border-slate-100 p-3">
              <SectionMetaForm
                submitLabel="Add section"
                onSubmit={handleSubmitNewSection}
                onCancel={() => { setCreatingSection(false); setError(null) }}
              />
            </div>
          )}
        </div>

        <DragOverlay>
          {activeField && <FieldDragPreview field={activeField} />}
          {activeSection && <SectionDragPreview section={activeSection} />}
        </DragOverlay>
      </DndContext>

      <p className="text-xs text-slate-400">
        Every field is asked on the <strong>New client</strong>{' '}form. The columns choose whether
        it&apos;s also on your <strong>intake form</strong> and on <strong>quick add</strong>, and
        whether it has to be filled in.
      </p>
    </div>
  )
}

// ─── Inline section meta form (create + edit) ────────────────────────────────

function SectionMetaForm({
  initialName = '',
  initialDescription = '',
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initialName?: string
  initialDescription?: string
  submitLabel: string
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
    <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-3 flex flex-col gap-2">
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
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={() => onSubmit(name, description)}>
          <Check className="h-3.5 w-3.5" />
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}

// ─── Section (sortable wrapper) ─────────────────────────────────────────────

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

// ─── Group header (shared by sections + the built-in group) ─────────────────

function GroupHeader({
  title,
  count,
  hint,
  description,
  dragHandleProps,
  onAddField,
  onStartEditMeta,
  onDelete,
}: {
  title: string
  count: number
  hint?: string
  description?: string | null
  dragHandleProps?: SectionHandleProps
  onAddField?: () => void
  onStartEditMeta?: () => void
  onDelete?: () => void
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50/60 border-t border-slate-200">
      {dragHandleProps ? (
        <button
          type="button"
          {...dragHandleProps.attributes}
          {...dragHandleProps.listeners}
          className="-ml-1.5 p-1 rounded text-slate-300 hover:text-slate-600 cursor-grab active:cursor-grabbing"
          aria-label="Drag section"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      ) : (
        <span className="-ml-1.5 w-6" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800 truncate">
          {title}
          <span className="ml-2 text-xs font-normal text-slate-400">{count}</span>
          {hint && <span className="ml-2 text-xs font-normal text-slate-400">· {hint}</span>}
        </p>
        {description && <p className="text-xs text-slate-400 leading-snug">{description}</p>}
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {onAddField && (
          <button
            type="button"
            onClick={onAddField}
            className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50"
            title="Add a field to this section"
            aria-label={`Add field to ${title}`}
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
        {onStartEditMeta && (
          <button
            type="button"
            onClick={onStartEditMeta}
            className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50"
            title="Edit section"
            aria-label={`Edit ${title}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50"
            title="Delete section"
            aria-label={`Delete ${title}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Section (drop target) ──────────────────────────────────────────────────

function SectionGroup({
  section,
  isEditingMeta,
  onStartEditMeta,
  onCancelEditMeta,
  onSubmitEditMeta,
  onDelete,
  onAddField,
  onEditField,
  onToggleFlag,
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
  onToggleFlag: (field: CustomField, flag: 'required' | 'inQuickAdd', value: boolean) => void
  onCancelEdit: () => void
  onFieldSaved: (saved: CustomField, isNew: boolean) => void
  onFieldDeleted: (id: string) => void
  editingId: string | null
  addingHere: boolean
  onCancelAdd: () => void
  savingFieldId: string | null
  dragHandleProps?: SectionHandleProps
}) {
  const { setNodeRef, isOver } = useDroppable({ id: section.id })

  if (isEditingMeta && onSubmitEditMeta && onCancelEditMeta) {
    return (
      <div className="border-t border-slate-200 p-3">
        <SectionMetaForm
          initialName={section.name}
          initialDescription={section.description ?? ''}
          submitLabel="Save"
          onSubmit={onSubmitEditMeta}
          onCancel={onCancelEditMeta}
        />
      </div>
    )
  }

  return (
    <div className={isOver ? 'bg-blue-50/40' : ''}>
      <GroupHeader
        title={section.isOrphan ? 'Ungrouped' : section.name}
        count={section.fields.length}
        hint={section.isOrphan ? 'not on a section screen yet' : undefined}
        description={section.description}
        dragHandleProps={dragHandleProps}
        onAddField={onAddField}
        onStartEditMeta={onStartEditMeta}
        onDelete={onDelete}
      />

      <div ref={setNodeRef} className="min-h-[8px]">
        {section.fields.length === 0 && !addingHere && (
          <p className="px-4 py-3 text-xs text-slate-400 italic">Drop fields here, or use +.</p>
        )}
        <SortableContext items={section.fields.map(f => f.id)} strategy={verticalListSortingStrategy}>
          {section.fields.map(field => {
            if (!field.isSystem && editingId === field.id) {
              return (
                <div key={field.id} className="border-t border-slate-100 p-3">
                  <FieldEditor
                    initial={field}
                    presetCategory={section.isOrphan ? null : section.name}
                    onCancel={onCancelEdit}
                    onSaved={(saved) => onFieldSaved(saved, false)}
                    onDeleted={() => onFieldDeleted(field.id)}
                  />
                </div>
              )
            }
            return (
              <SortableFieldRow
                key={field.id}
                field={field}
                onEdit={() => onEditField(field.id)}
                onToggleFlag={(flag, value) => onToggleFlag(field, flag, value)}
                isSaving={savingFieldId === field.id}
              />
            )
          })}
        </SortableContext>
        {addingHere && (
          <div className="border-t border-slate-100 p-3">
            <FieldEditor
              presetCategory={section.isOrphan ? null : section.name}
              onCancel={onCancelAdd}
              onSaved={(saved) => onFieldSaved(saved, true)}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Field row ───────────────────────────────────────────────────────────────

// The one row used by every field — custom, system and built-in — so a trainer
// only has to learn to read a field once.
function FieldRow({
  label,
  meta,
  usage,
  required,
  quickAdd,
  requiredLocked,
  quickAddLocked,
  saving,
  onToggle,
  onEdit,
  dragHandle,
  style,
  innerRef,
}: {
  label: string
  meta: string
  usage: FieldUsage
  required: boolean
  quickAdd: boolean
  requiredLocked?: boolean
  quickAddLocked?: boolean
  saving?: boolean
  onToggle?: (flag: 'required' | 'quickAdd', value: boolean) => void
  onEdit?: () => void
  dragHandle?: React.ReactNode
  style?: React.CSSProperties
  innerRef?: (node: HTMLElement | null) => void
}) {
  return (
    <div
      ref={innerRef}
      style={style}
      className="flex sm:grid sm:grid-cols-[1fr_5rem_5.5rem_5.5rem_2rem] gap-2 items-center px-4 py-2.5 border-t border-slate-100 hover:bg-slate-50/60"
    >
      <div className="flex items-start sm:items-center gap-2 min-w-0 flex-1">
        {dragHandle ?? <span className="w-4 shrink-0" />}
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900 truncate">
            {label}
            {required && <span className="text-red-500 ml-1">*</span>}
          </p>
          <p className="text-xs text-slate-400 truncate">
            {meta}
            {saving && <span className="ml-2 text-blue-500">Saving…</span>}
          </p>
          {/* No column headers to read on a phone, so the row carries its own
              labels rather than a pair of naked checkboxes. */}
          <div className="sm:hidden mt-1.5 flex items-center gap-3 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1 text-slate-400">
              {usage.intake
                ? <><Check className="h-3.5 w-3.5 text-teal-600" /> Intake</>
                : <>— Not on intake</>}
            </span>
            <MobileToggle
              label={`Quick add — ${label}`}
              text="Quick add"
              on={quickAdd}
              disabled={quickAddLocked || !onToggle}
              onChange={v => onToggle?.('quickAdd', v)}
            />
            <MobileToggle
              label={`Required — ${label}`}
              text="Required"
              on={required}
              disabled={requiredLocked || !onToggle}
              onChange={v => onToggle?.('required', v)}
            />
          </div>
        </div>
      </div>

      {/* Intake is decided by what kind of field it is, so it reads, not clicks. */}
      <span className="hidden sm:flex justify-center">
        {usage.intake
          ? <Check className="h-4 w-4 text-teal-600" aria-label="On the intake form" />
          : <span className="text-slate-300" aria-label="Not on the intake form">—</span>}
      </span>

      <span className="hidden sm:flex justify-center">
        <ToggleCell
          label={`Quick add — ${label}`}
          on={quickAdd}
          disabled={quickAddLocked || !onToggle}
          onChange={v => onToggle?.('quickAdd', v)}
        />
      </span>
      <span className="hidden sm:flex justify-center">
        <ToggleCell
          label={`Required — ${label}`}
          on={required}
          disabled={requiredLocked || !onToggle}
          onChange={v => onToggle?.('required', v)}
        />
      </span>

      <span className="flex justify-end shrink-0">
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
            aria-label={`Edit field ${label}`}
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
      </span>
    </div>
  )
}

function ToggleCell({
  label,
  on,
  disabled,
  onChange,
}: {
  label: string
  on: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <input
      type="checkbox"
      checked={on}
      disabled={disabled}
      aria-label={label}
      onChange={e => onChange(e.target.checked)}
      className="h-4 w-4 rounded border-slate-300 accent-[var(--accent)] disabled:opacity-40"
    />
  )
}

// Phone-sized rows carry their own labels — same control, stated in words.
function MobileToggle({
  label,
  text,
  on,
  disabled,
  onChange,
}: {
  label: string
  text: string
  on: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className={`inline-flex items-center gap-1 ${disabled ? 'opacity-40' : ''}`}>
      <input
        type="checkbox"
        checked={on}
        disabled={disabled}
        aria-label={label}
        onChange={e => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-slate-300 accent-[var(--accent)]"
      />
      {text}
    </label>
  )
}

function SortableFieldRow({
  field,
  onEdit,
  onToggleFlag,
  isSaving,
}: {
  field: CustomField
  onEdit: () => void
  onToggleFlag: (flag: 'required' | 'inQuickAdd', value: boolean) => void
  isSaving: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id })
  const style = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <FieldRow
      innerRef={setNodeRef}
      style={style}
      label={field.label}
      meta={field.isSystem
        ? 'System · always asked'
        : `${TYPE_LABELS[field.type]} · ${field.appliesTo === 'DOG' ? 'Per dog' : 'Per owner'}`}
      usage={fieldUsage({
        kind: field.isSystem ? 'CORE' : 'CUSTOM',
        required: field.required,
        quickAdd: !!field.inQuickAdd,
      })}
      required={field.required}
      quickAdd={!!field.inQuickAdd}
      // System fields back real columns — they're always asked and always required.
      requiredLocked={field.isSystem}
      quickAddLocked={field.isSystem}
      saving={isSaving}
      onToggle={field.isSystem
        ? undefined
        : (flag, value) => onToggleFlag(flag === 'quickAdd' ? 'inQuickAdd' : 'required', value)}
      onEdit={field.isSystem ? undefined : onEdit}
      dragHandle={
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing"
          aria-label="Drag field"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      }
    />
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
  const [inQuickAdd, setInQuickAdd] = useState(initial?.inQuickAdd ?? false)
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
      inQuickAdd,
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
      inQuickAdd: !!saved.inQuickAdd,
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

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={required}
            onChange={e => setRequired(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-blue-600"
          />
          Required field
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={inQuickAdd}
            onChange={e => setInQuickAdd(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-blue-600"
          />
          Also ask on the quick-add contact form
        </label>
        <p className="text-xs text-slate-500">
          Asked on your intake form and the new-client form
          {inQuickAdd ? ', and on quick add' : ''}.
        </p>
      </div>

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
          {initial ? 'Save' : 'Create field'}
        </Button>
      </div>
    </div>
  )
}
