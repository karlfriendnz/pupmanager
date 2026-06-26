'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Plus, Package as PackageIcon, Pencil, Trash2, X, GripVertical } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { PackageForm, type PackageColor, type PkgRow, type SessionFormOption } from './package-form'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

export type { SessionFormOption } from './package-form'

function formatPrice(cents: number | null): string | null {
  if (cents === null || cents === undefined) return null
  // Locale-friendly: "$120" or "$120.50"
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' }).format(cents / 100)
}

// Static class map — Tailwind purges dynamic class names so each package
// colour needs its own listed pair here.
const PACKAGE_ICON_CLASSES: Record<PackageColor, string> = {
  blue:    'bg-blue-50 text-blue-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber:   'bg-amber-50 text-amber-600',
  rose:    'bg-rose-50 text-rose-600',
  purple:  'bg-purple-50 text-purple-600',
  orange:  'bg-orange-50 text-orange-600',
  teal:    'bg-teal-50 text-teal-600',
  indigo:  'bg-indigo-50 text-indigo-600',
  pink:    'bg-pink-50 text-pink-600',
  cyan:    'bg-cyan-50 text-cyan-600',
}
function packageIconClasses(color: PackageColor | null): string {
  return color ? PACKAGE_ICON_CLASSES[color] : 'bg-blue-50 text-blue-600'
}

export function PackagesView({
  initialPackages,
  sessionForms,
}: {
  initialPackages: PkgRow[]
  sessionForms: SessionFormOption[]
}) {
  const router = useRouter()
  const [packages, setPackages] = useState(initialPackages)
  const [showCreate, setShowCreate] = useState(false)

  function upsert(p: PkgRow, isNew: boolean) {
    setPackages(prev => isNew ? [p, ...prev] : prev.map(x => x.id === p.id ? p : x))
    // Refresh server state so the trainer layout (FAB / onboarding state)
    // sees the new package count and advances the wizard.
    router.refresh()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this package? Existing client assignments stay (but their sessions remain on the schedule).')) return
    const res = await fetch(`/api/packages/${id}`, { method: 'DELETE' })
    if (res.ok) setPackages(prev => prev.filter(p => p.id !== id))
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setPackages(prev => {
      const oldIndex = prev.findIndex(p => p.id === active.id)
      const newIndex = prev.findIndex(p => p.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return prev
      const next = arrayMove(prev, oldIndex, newIndex)
      void fetch('/api/packages/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: next.map(p => p.id) }),
      }).then(res => {
        if (!res.ok) window.location.reload()
      })
      return next
    })
  }

  return (
    <>
      <PageHeader
        title="Packages"
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New package</span>
          </Button>
        }
      />
      <div className="p-4 md:p-8 w-full max-w-3xl md:max-w-5xl xl:max-w-7xl mx-auto">
      <p className="text-sm text-slate-500 mb-4">
        Bundles of sessions you can assign to clients in one go.
      </p>

      {packages.length === 0 ? (
        <Card>
          <CardBody className="py-12 text-center text-slate-400">
            <PackageIcon className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No packages yet. Create your first one to get started.</p>
          </CardBody>
        </Card>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={packages.map(p => p.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2">
              {packages.map(p => (
                <SortablePackageRow
                  key={p.id}
                  pkg={p}
                  showHandle={packages.length > 1}
                  onEdit={() => router.push(`/packages/${p.id}/edit`)}
                  onDelete={() => handleDelete(p.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Sortable row defined inline — closes over edit/delete handlers via props. */}

      {showCreate && (
        <CreatePackageModal
          sessionForms={sessionForms}
          onClose={() => setShowCreate(false)}
          onSaved={(p, isNew) => { upsert(p, isNew); setShowCreate(false) }}
        />
      )}
      </div>
    </>
  )
}

// Sortable package row — wraps the existing card layout with a drag handle
// and useSortable. Drag handle only appears when there's more than one
// package (nothing to reorder when there's one).
function SortablePackageRow({
  pkg: p,
  showHandle,
  onEdit,
  onDelete,
}: {
  pkg: PkgRow
  showHandle: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.id })
  const style = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <Card className="hover:border-blue-100 transition-colors">
        <CardBody className="px-4 py-3">
          <div className="flex items-center gap-3">
            {showHandle && (
              <button
                type="button"
                {...attributes}
                {...listeners}
                className="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing"
                aria-label="Drag to reorder"
              >
                <GripVertical className="h-4 w-4" />
              </button>
            )}

            <Link
              href={`/packages/${p.id}`}
              className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer"
            >
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl flex-shrink-0 ${packageIconClasses(p.color)}`}>
              <PackageIcon className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <p className="font-semibold text-slate-900">{p.name}</p>
                {p.priceCents !== null && (
                  <span className="text-sm font-medium text-slate-700">
                    {p.specialPriceCents !== null ? (
                      <>
                        <span className="text-emerald-600">{formatPrice(p.specialPriceCents)}</span>
                        <span className="text-slate-400 line-through ml-1.5 text-xs">{formatPrice(p.priceCents)}</span>
                      </>
                    ) : (
                      formatPrice(p.priceCents)
                    )}
                  </span>
                )}
              </div>
              {p.description && <p className="text-sm text-slate-500 mt-0.5">{p.description}</p>}
              <div className="flex items-center gap-3 text-xs text-slate-400 mt-1.5 flex-wrap">
                <span>{p.sessionCount === 0 ? 'Ongoing' : `${p.sessionCount} sessions`}</span>
                <span>·</span>
                <span>{p.weeksBetween === 0 ? 'No spacing' : `every ${p.weeksBetween} week${p.weeksBetween > 1 ? 's' : ''}`}</span>
                <span>·</span>
                <span>{p.durationMins} min</span>
                <span>·</span>
                <span>{p.sessionType === 'VIRTUAL' ? 'Virtual' : 'In person'}</span>
                {p.assignments > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-blue-600">{p.assignments} assigned</span>
                  </>
                )}
              </div>
            </div>
            </Link>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={onEdit}
                className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                aria-label="Edit"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={onDelete}
                className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                aria-label="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

// Create-only modal. Editing an existing package happens on its own page
// (/packages/[packageId]/edit); this modal keeps the lightweight "new
// package" flow inline. Both share the underlying <PackageForm/>.
function CreatePackageModal({
  sessionForms,
  onClose,
  onSaved,
}: {
  sessionForms: SessionFormOption[]
  onClose: () => void
  onSaved: (p: PkgRow, isNew: boolean) => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative z-50 bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">New package</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">
          <PackageForm
            existing={null}
            sessionForms={sessionForms}
            onCancel={onClose}
            onSaved={onSaved}
          />
        </div>
      </div>
    </div>
  )
}
