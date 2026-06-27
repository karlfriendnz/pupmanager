'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Plus, Package as PackageIcon, Pencil, Trash2, GripVertical } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { ConnectPaymentsModal } from '../settings/connect-payments-prompt'
import { type PackageColor, type PkgRow } from './package-form'
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
  connectName = null,
}: {
  initialPackages: PkgRow[]
  // Set (to the new package's name) when we've just created a priced package
  // and want to pop the connect-Stripe modal over the list.
  connectName?: string | null
}) {
  const router = useRouter()
  const [packages, setPackages] = useState(initialPackages)

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
          <Button size="sm" onClick={() => router.push('/packages/new')}>
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

      </div>

      {connectName && (
        <ConnectPaymentsModal
          title="Package created 🎉"
          description={`“${connectName}” has a price. Connect your Stripe account so clients can pay for it right inside PupManager — secure card payments, paid straight to your bank.`}
          onClose={() => router.replace('/packages')}
        />
      )}
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
