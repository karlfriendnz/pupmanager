'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Package as PackageIcon, Pencil, Trash2, GripVertical, Copy,
  Repeat, Clock, Video, MapPin, Users,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { ConnectPaymentsModal } from '../settings/connect-payments-prompt'
import { type PackageColor, type PkgRow } from './package-form'
import { formatMoney } from '@/lib/money'
import {
  OfferingCard, OfferingEmpty, AddOfferingLink, OfferingPage,
  type OfferingFact, type OfferingBadge,
} from '@/components/shared/offering-card'
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
  currency = 'NZD',
}: {
  initialPackages: PkgRow[]
  // Set (to the new package's name) when we've just created a priced package
  // and want to pop the connect-Stripe modal over the list.
  connectName?: string | null
  currency?: string
}) {
  const router = useRouter()
  const [packages, setPackages] = useState(initialPackages)

  async function handleDelete(id: string) {
    if (!confirm('Delete this package? Existing client assignments stay (but their sessions remain on the schedule).')) return
    const res = await fetch(`/api/packages/${id}`, { method: 'DELETE' })
    if (res.ok) setPackages(prev => prev.filter(p => p.id !== id))
  }

  // Duplicate → straight into the copy's edit form. Copying is almost always
  // "make one like that but different", so dropping them where they can change
  // it beats landing back on the list to hunt for the new row.
  const [duplicating, setDuplicating] = useState<string | null>(null)
  async function handleDuplicate(id: string) {
    if (duplicating) return
    setDuplicating(id)
    try {
      const res = await fetch(`/api/packages/${id}/clone`, { method: 'POST' })
      if (!res.ok) { alert('Could not duplicate that package.'); return }
      const created = await res.json() as { id: string }
      router.push(`/packages/${created.id}/edit`)
    } finally {
      setDuplicating(null)
    }
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
        title="1:1 Packages"
        subtitle="Bundles of sessions you assign to a client in one go — set the count, spacing and price once."
      />
      <OfferingPage>
        {packages.length === 0 ? (
          <OfferingEmpty
            icon={<PackageIcon className="h-6 w-6" />}
            title="No packages yet"
            body="A package is a bundle of 1:1 sessions you assign to a client in one go — set the count, spacing and price once, then reuse it."
            action={{ href: '/offerings/new', label: 'New package' }}
          />
        ) : (
          <>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={packages.map(p => p.id)} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-2.5">
                  {packages.map(p => (
                    <SortablePackageRow
                      key={p.id}
                      pkg={p}
                      currency={currency}
                      showHandle={packages.length > 1}
                      onEdit={() => router.push(`/packages/${p.id}/edit`)}
                      onDuplicate={() => handleDuplicate(p.id)}
                      onDelete={() => handleDelete(p.id)}
                      duplicating={duplicating === p.id}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            <AddOfferingLink href="/offerings/new" label="New package" />
          </>
        )}
      </OfferingPage>

      {connectName && (
        <ConnectPaymentsModal onClose={() => router.replace('/packages')} currency={currency} />
      )}
    </>
  )
}

// Drag handle only appears when there's more than one package (nothing to
// reorder when there's one).
function SortablePackageRow({
  pkg: p,
  currency,
  showHandle,
  onEdit,
  onDuplicate,
  onDelete,
  duplicating,
}: {
  pkg: PkgRow
  currency: string
  showHandle: boolean
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  duplicating: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.id })
  const style = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const badges: OfferingBadge[] = []
  if (p.specialPriceCents != null && p.priceCents != null) {
    badges.push({ label: formatMoney(p.specialPriceCents, currency), tone: 'good' })
    badges.push({ label: formatMoney(p.priceCents, currency), tone: 'muted', strike: true })
  } else if (p.priceCents != null) {
    badges.push({ label: formatMoney(p.priceCents, currency), tone: 'accent' })
  }

  return (
    <div ref={setNodeRef} style={style}>
      <OfferingCard
        href={`/packages/${p.id}`}
        title={p.name}
        description={p.description}
        imageUrl={p.imageUrl}
        tile={{ icon: <PackageIcon className="h-5 w-5" />, className: packageIconClasses(p.color) }}
        badges={badges}
        facts={packageFacts(p)}
        dragHandle={showHandle ? (
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
            className="mt-2 cursor-grab touch-none text-slate-300 hover:text-slate-500 active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        ) : undefined}
        actions={[
          { icon: <Pencil className="h-4 w-4" />, label: 'Edit', onClick: onEdit },
          { icon: <Copy className="h-4 w-4" />, label: 'Duplicate', onClick: onDuplicate, disabled: duplicating },
          { icon: <Trash2 className="h-4 w-4" />, label: 'Delete', onClick: onDelete, tone: 'danger' },
        ]}
      />
    </div>
  )
}

function packageFacts(p: PkgRow): OfferingFact[] {
  const facts: OfferingFact[] = [
    {
      icon: <Repeat className="h-3.5 w-3.5" />,
      label: p.sessionCount === 0
        ? 'Ongoing'
        : `${p.sessionCount} session${p.sessionCount === 1 ? '' : 's'}${p.weeksBetween > 0 ? `, every ${p.weeksBetween} week${p.weeksBetween > 1 ? 's' : ''}` : ''}`,
    },
    { icon: <Clock className="h-3.5 w-3.5" />, label: `${p.durationMins} min` },
    p.sessionType === 'VIRTUAL'
      ? { icon: <Video className="h-3.5 w-3.5" />, label: 'Virtual' }
      : { icon: <MapPin className="h-3.5 w-3.5" />, label: 'In person' },
  ]
  if (p.assignments > 0) {
    facts.push({
      icon: <Users className="h-3.5 w-3.5" />,
      label: `${p.assignments} assigned`,
      tone: 'good',
    })
  }
  return facts
}
