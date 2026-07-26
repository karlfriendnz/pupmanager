'use client'

import { useState } from 'react'
import { RichTextEditor } from '@/components/shared/rich-text-editor'
import { RichText } from '@/components/shared/rich-text'
import { isRichTextEmpty } from '@/lib/rich-text'
import { ImageUploadButton } from '@/components/image-uploader'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/shared/page-header'
import { Ticket, Plus, Trash2, Loader2, Check, X, GraduationCap, Users, ShoppingBag, Image as ImageIcon, Palette, GripVertical } from 'lucide-react'
import { closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { DndArea } from '@/components/shared/dnd-area'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ReactNode, HTMLAttributes } from 'react'
import { useCurrency } from '@/components/currency-context'
import { currencySymbol, formatMoney } from '@/lib/money'
import { Switch } from '@/components/ui/switch'
import {
  OfferingCard,
  OfferingEmpty,
  OfferingListBar,
  useOfferingView,
  OfferingItems,
  SortableOfferingList,
  SortableOfferingCard,
  AddOfferingLink,
  type OfferingFact,
} from '@/components/shared/offering-card'
import { useOfferingReorder } from '@/lib/use-offering-reorder'
import { resolveButtonColors, MIN_CONTRAST, type ButtonColors } from '@/lib/membership-card-colors'
import { CommsFlowEditor } from '@/components/trainer/comms-flow-editor'
import { Package as PackageIcon, Bell } from 'lucide-react'

type Kind = 'PACKAGE' | 'CLASS' | 'PRODUCT'
type Cadence = 'ONE_OFF' | 'RECURRING'
type Interval = 'WEEK' | 'FORTNIGHT' | 'MONTH'
interface Offering { id: string; name: string; priceCents?: number; imageUrl?: string | null; description?: string | null }
interface Offerings { packages: Offering[]; classRuns: Offering[]; products: Offering[] }
interface MItem { kind: Kind; packageId: string | null; classRunId: string | null; productId: string | null; quantity: number; regrantOnRenewal: boolean; imageUrl?: string | null; description?: string | null }
interface MPlan { interval: Interval; priceCents: number; minTermCount: number; earlyTermFeeCents: number | null }
interface Card {
  imageUrl: string | null; bgColor: string | null; headerColor: string | null; textColor: string | null; featuredColor: string | null
  buttonBgColor: string | null; buttonTextColor: string | null; buttonText: string | null
}
interface Membership extends Card {
  id: string; name: string; description: string | null; priceCents: number
  cadence: Cadence; interval: Interval | null; minTermCount: number; earlyTermFeeCents: number | null
  published: boolean; purchases: number; items: MItem[]; plans: MPlan[]
  /** Clients who tapped "Request this" and haven't been answered. */
  pendingRequests?: number
}

interface DraftItem { key: string; kind: Kind; id: string; quantity: number; regrantOnRenewal: boolean; imageUrl: string | null; description: string }
interface DraftPlan { key: string; interval: Interval; price: string; minTerm: string; earlyTermFee: string }
interface Draft extends Card {
  id: string | null; name: string; description: string; price: string; cadence: Cadence
  interval: Interval; minTermCount: string; earlyTermFee: string; published: boolean; items: DraftItem[]; plans: DraftPlan[]
}

// Live preview of the membership as it appears in the client Memberships
// storefront (mirrors ClientMembershipsView's card), fed from the builder draft.
const INTERVAL_LABEL: Record<Interval, string> = { WEEK: 'week', FORTNIGHT: 'fortnight', MONTH: 'month' }
interface PreviewPlan { interval: Interval; priceCents: number }
interface PreviewItem { label: string; quantity: number; imageUrl?: string | null; description?: string | null }
function MembershipPreviewCard({ name, description, priceCents, recurring, interval, items, plans, currency, card }: {
  name: string; description: string; priceCents: number; recurring: boolean; interval: Interval; items: PreviewItem[]; plans: PreviewPlan[]; currency: string; card: Card
}) {
  const bg = card.bgColor ?? '#ffffff'
  const header = card.headerColor ?? '#0f172a'
  const text = card.textColor ?? '#64748b'
  const featured = card.featuredColor ?? '#7c3aed'
  const btn = resolveButtonColors(card.buttonBgColor, card.buttonTextColor, card.featuredColor)
  return (
    <div className="rounded-2xl border border-slate-200 shadow-sm overflow-hidden" style={{ backgroundColor: bg }}>
      {card.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.imageUrl} alt="" className="w-full h-32 object-cover" />
      )}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold text-lg flex items-center gap-2" style={{ color: header }}>
              <Ticket className="h-5 w-5 shrink-0" style={{ color: featured }} /> {name.trim() || <span className="opacity-50 font-normal">Package name</span>}
            </h2>
            <div className="mt-1" style={{ color: text }}><RichText html={description} className="text-sm" /></div>
          </div>
          {plans.length === 0 && <span className="text-lg font-bold whitespace-nowrap" style={{ color: featured }}>{formatMoney(priceCents, currency)}{recurring ? ` / ${interval.toLowerCase()}` : ''}</span>}
        </div>
        {items.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2.5">
            {items.map((it, i) => (
              <li key={i} className="flex items-start gap-2.5">
                {it.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover border border-black/10 shrink-0" />
                ) : (
                  <Check className="h-4 w-4 shrink-0 mt-0.5" style={{ color: featured }} />
                )}
                <div className="min-w-0">
                  <p className="text-sm" style={{ color: header }}>{it.quantity > 1 ? `${it.quantity}× ` : ''}{it.label}</p>
                  {it.description && <div style={{ color: text }}><RichText html={it.description} className="text-xs" /></div>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {plans.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            {plans.map((pl, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm" style={{ borderColor: featured }}>
                <span style={{ color: header }}>Every {INTERVAL_LABEL[pl.interval]}</span>
                <span className="font-semibold" style={{ color: featured }}>{formatMoney(pl.priceCents, currency)}</span>
              </div>
            ))}
          </div>
        )}
        <button type="button" disabled className="mt-4 w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl font-semibold opacity-95 cursor-default" style={{ backgroundColor: btn.background, color: btn.color }}>{card.buttonText?.trim() || 'Get this package'}</button>
      </div>
    </div>
  )
}

// Storefront card colours the trainer can set (with a sensible default swatch
// shown when unset). featuredColor tints the price +, unless overridden below,
// the buy button.
type ColorKey = 'bgColor' | 'headerColor' | 'textColor' | 'featuredColor' | 'buttonBgColor' | 'buttonTextColor'
const CARD_COLORS: { key: ColorKey; label: string; fallback: string }[] = [
  { key: 'bgColor', label: 'Background', fallback: '#ffffff' },
  { key: 'headerColor', label: 'Header', fallback: '#0f172a' },
  { key: 'textColor', label: 'Text', fallback: '#475569' },
  { key: 'featuredColor', label: 'Featured', fallback: '#7c3aed' },
]

// One-tap coordinated colour schemes (set all four at once). Trainers can still
// fine-tune individual colours after picking one.
const CARD_SCHEMES: { name: string; bgColor: string; headerColor: string; textColor: string; featuredColor: string }[] = [
  { name: 'Teal', bgColor: '#f0fdfa', headerColor: '#0f766e', textColor: '#334155', featuredColor: '#0d9488' },
  { name: 'Violet', bgColor: '#faf5ff', headerColor: '#6b21a8', textColor: '#475569', featuredColor: '#7c3aed' },
  { name: 'Slate', bgColor: '#f8fafc', headerColor: '#0f172a', textColor: '#475569', featuredColor: '#334155' },
  { name: 'Amber', bgColor: '#fffbeb', headerColor: '#92400e', textColor: '#57534e', featuredColor: '#d97706' },
  { name: 'Rose', bgColor: '#fff1f2', headerColor: '#9f1239', textColor: '#4c4c4c', featuredColor: '#e11d48' },
  { name: 'Dark', bgColor: '#0f172a', headerColor: '#ffffff', textColor: '#cbd5e1', featuredColor: '#38bdf8' },
]

// The buy button's own colours, kept apart from the card's four because they're
// the pair a trainer can most easily make unreadable — the swatches sit next to
// a live contrast read-out. Null on either = follow the Featured colour / an
// auto-picked legible label.
const BUTTON_COLORS: { key: 'buttonBgColor' | 'buttonTextColor'; label: string }[] = [
  { key: 'buttonBgColor', label: 'Button background' },
  { key: 'buttonTextColor', label: 'Button text' },
]

// Sortable wrapper for a What's-included row. Renders its children with the
// drag-handle props to spread onto a grip button, so the row JSX stays inline.
function SortableItemShell({ id, children }: { id: string; children: (handle: HTMLAttributes<HTMLElement>) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: React.CSSProperties = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    position: 'relative',
    zIndex: isDragging ? 10 : undefined,
  }
  return <div ref={setNodeRef} style={style}>{children({ ...attributes, ...listeners })}</div>
}

// The builder used to be one 8,000px column on a phone: the name and price, the
// storefront card's image and six colour pickers, every included item with its
// own rich-text editor and image, and the reminder flow — all stacked. Four
// tabs, so a trainer meets one job at a time. Same underline rail as Finances
// and the To-do screen. Panels stay MOUNTED and hide, because remounting a
// Tiptap editor mid-edit loses what's in it.
type BuilderTab = 'details' | 'included' | 'appearance' | 'messages'
const BUILDER_TABS: { id: BuilderTab; label: string; Icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }[] = [
  { id: 'details', label: 'Details', Icon: Ticket },
  { id: 'included', label: 'Included', Icon: PackageIcon },
  { id: 'appearance', label: 'Appearance', Icon: Palette },
  { id: 'messages', label: 'Messages', Icon: Bell },
]

let seq = 0
const KINDS: { k: Kind; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { k: 'PACKAGE', label: '1:1 consult', Icon: GraduationCap },
  { k: 'CLASS', label: 'Class place', Icon: Users },
  { k: 'PRODUCT', label: 'Product', Icon: ShoppingBag },
]

export function MembershipsView({ memberships, offerings, currency: initialCurrency }: { memberships: Membership[]; offerings: Offerings; currency: string }) {
  const [view, setView] = useOfferingView('memberships')

  const router = useRouter()
  const currency = useCurrency() ?? initialCurrency
  const sym = currencySymbol(currency)

  // The list owns its own order: dragging a card writes it back, and that same
  // order is what clients see in Offerings.
  const { rows: list, setRows: setList, reorder, error: reorderError } = useOfferingReorder(memberships, 'membership')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<BuilderTab>('details')

  function offeringsFor(k: Kind): Offering[] {
    return k === 'PACKAGE' ? offerings.packages : k === 'CLASS' ? offerings.classRuns : offerings.products
  }
  // The offering an item points at — the source of its default image/blurb.
  const offeringOf = (it: DraftItem): Offering | undefined => offeringsFor(it.kind).find(o => o.id === it.id)
  function offeringName(it: MItem): string {
    const id = it.packageId ?? it.classRunId ?? it.productId
    return offeringsFor(it.kind).find(o => o.id === id)?.name ?? '(removed)'
  }

  function startNew() {
    setError(null)
    setTab('details')
    setDraft({ id: null, name: '', description: '', price: '', cadence: 'ONE_OFF', interval: 'MONTH', minTermCount: '0', earlyTermFee: '', published: false, items: [], plans: [], imageUrl: null, bgColor: null, headerColor: null, textColor: null, featuredColor: null, buttonBgColor: null, buttonTextColor: null, buttonText: null })
  }
  function startEdit(m: Membership) {
    setError(null)
    setTab('details')
    setDraft({
      id: m.id, name: m.name, description: m.description ?? '', price: (m.priceCents / 100).toString(),
      cadence: m.cadence, interval: m.interval ?? 'MONTH', minTermCount: String(m.minTermCount), earlyTermFee: m.earlyTermFeeCents != null ? (m.earlyTermFeeCents / 100).toString() : '',
      published: m.published,
      imageUrl: m.imageUrl, bgColor: m.bgColor, headerColor: m.headerColor, textColor: m.textColor, featuredColor: m.featuredColor,
      buttonBgColor: m.buttonBgColor, buttonTextColor: m.buttonTextColor, buttonText: m.buttonText,
      items: m.items.map(i => ({ key: `k${seq++}`, kind: i.kind, id: i.packageId ?? i.classRunId ?? i.productId ?? '', quantity: i.quantity, regrantOnRenewal: i.regrantOnRenewal, imageUrl: i.imageUrl ?? null, description: i.description ?? '' })),
      plans: m.plans.map(p => ({ key: `p${seq++}`, interval: p.interval, price: (p.priceCents / 100).toString(), minTerm: String(p.minTermCount), earlyTermFee: p.earlyTermFeeCents != null ? (p.earlyTermFeeCents / 100).toString() : '' })),
    })
  }

  const patch = (p: Partial<Draft>) => setDraft(d => (d ? { ...d, ...p } : d))
  const addItem = () => patch({ items: [...draft!.items, { key: `k${seq++}`, kind: 'PACKAGE', id: '', quantity: 1, regrantOnRenewal: false, imageUrl: null, description: '' }] })
  const patchItem = (key: string, p: Partial<DraftItem>) => patch({ items: draft!.items.map(it => (it.key === key ? { ...it, ...p } : it)) })
  const removeItem = (key: string) => patch({ items: draft!.items.filter(it => it.key !== key) })
  // Recurring billing options (per week/fortnight/month), each own price/term/fee.
  const addPlan = () => patch({ plans: [...draft!.plans, { key: `p${seq++}`, interval: 'MONTH', price: '', minTerm: '0', earlyTermFee: '' }] })
  const patchPlan = (key: string, p: Partial<DraftPlan>) => patch({ plans: draft!.plans.map(pl => (pl.key === key ? { ...pl, ...p } : pl)) })
  const removePlan = (key: string) => patch({ plans: draft!.plans.filter(pl => pl.key !== key) })
  // Drag-to-reorder the included items; their saved order is the array order.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  function reorderItems(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id || !draft) return
    const from = draft.items.findIndex(it => it.key === active.id)
    const to = draft.items.findIndex(it => it.key === over.id)
    if (from < 0 || to < 0) return
    patch({ items: arrayMove(draft.items, from, to) })
  }

  // "Normally" = sum of the included offerings' own prices (classes have no
  // standalone price here, so they don't add to it).
  const partsTotal = draft ? draft.items.reduce((s, it) => {
    const price = offeringsFor(it.kind).find(o => o.id === it.id)?.priceCents ?? 0
    return s + price * it.quantity
  }, 0) : 0
  const priceCents = draft ? Math.round((Number(draft.price) || 0) * 100) : 0
  const saving = partsTotal - priceCents
  // What the buy button will actually be painted with, contrast guard applied —
  // drives the swatch fallbacks, the readability note and the live preview.
  const buttonPreview = resolveButtonColors(draft?.buttonBgColor, draft?.buttonTextColor, draft?.featuredColor)

  async function save() {
    if (!draft) return
    if (!draft.name.trim()) return setError('Give the package a name.')
    const items = draft.items.filter(it => it.id).map(it => ({
      kind: it.kind,
      packageId: it.kind === 'PACKAGE' ? it.id : undefined,
      classRunId: it.kind === 'CLASS' ? it.id : undefined,
      productId: it.kind === 'PRODUCT' ? it.id : undefined,
      quantity: it.quantity,
      regrantOnRenewal: it.regrantOnRenewal,
      imageUrl: it.imageUrl || null,
      description: it.description.trim() || null,
    }))
    const body = {
      name: draft.name.trim(), description: draft.description.trim() || null, priceCents,
      cadence: draft.cadence,
      interval: draft.cadence === 'RECURRING' ? draft.interval : null,
      minTermCount: draft.cadence === 'RECURRING' ? Number(draft.minTermCount) || 0 : 0,
      earlyTermFeeCents: draft.cadence === 'RECURRING' && draft.earlyTermFee.trim() ? Math.round(Number(draft.earlyTermFee) * 100) : null,
      published: draft.published, items,
      plans: draft.cadence === 'RECURRING'
        ? draft.plans.filter(p => p.price.trim()).map(p => ({ interval: p.interval, priceCents: Math.round(Number(p.price) * 100), minTermCount: Number(p.minTerm) || 0, earlyTermFeeCents: p.earlyTermFee.trim() ? Math.round(Number(p.earlyTermFee) * 100) : null }))
        : [],
      imageUrl: draft.imageUrl, bgColor: draft.bgColor, headerColor: draft.headerColor, textColor: draft.textColor, featuredColor: draft.featuredColor,
      buttonBgColor: draft.buttonBgColor, buttonTextColor: draft.buttonTextColor,
      buttonText: draft.buttonText?.trim() || null,
    }
    setBusy(true); setError(null)
    try {
      const res = await fetch(draft.id ? `/api/trainer/memberships/${draft.id}` : '/api/trainer/memberships', {
        method: draft.id ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok) { setError('Could not save — check the fields and try again.'); return }
      setDraft(null); router.refresh()
    } catch { setError('Something went wrong.') } finally { setBusy(false) }
  }

  // Deleting lives INSIDE the package now — the list card is for opening it, not
  // for a row of little icons. It confirms, then drops the trainer back on the
  // list with the card gone.
  async function remove(id: string) {
    if (!confirm('Delete this package? Anyone who already bought it keeps what it gave them.')) return
    setBusy(true)
    const res = await fetch(`/api/trainer/memberships/${id}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) { setError('Could not delete this package — try again.'); return }
    setList(prev => prev.filter(m => m.id !== id))
    setDraft(null)
  }

  return (
    <>
      {/* No action in the control bar — the dashed "New membership" that closes
          the list (and the empty state's button) are the way in, same as every
          other offering page. */}
      {/* Editing a membership is a detail screen: back replaces the menu and
          returns to the list, same as every other detail page. */}
      <PageHeader
        title={draft ? (draft.id ? draft.name.trim() || 'Edit package' : 'New package') : 'Packages'}
        back={draft ? { onClick: () => setDraft(null), label: 'Back to packages' } : undefined}
      />
      <div className="w-full p-4 md:p-8">
        {error && <div className="mb-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">{error}</div>}

        {draft ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7">
            {/* One job at a time. The rail scrolls rather than wraps at 390px,
                and the icons drop out before the labels do — a label you can
                read beats an icon you can't name. */}
            <div role="tablist" aria-label="Package sections" className="mb-4 flex gap-1 border-b border-slate-200 overflow-x-auto no-scrollbar">
              {BUILDER_TABS.map(t => {
                const active = tab === t.id
                const count = t.id === 'included' ? draft.items.length : null
                return (
                  <button key={t.id} type="button" role="tab" aria-selected={active} onClick={() => setTab(t.id)}
                    className={`relative flex items-center gap-2 whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors sm:px-4 ${active ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
                    <t.Icon className="hidden h-4 w-4 sm:block" strokeWidth={1.75} /> {t.label}
                    {count != null && count > 0 && <span className="text-xs tabular-nums text-slate-400">{count}</span>}
                    {active && <span className="absolute -bottom-px left-3 right-3 h-0.5 rounded-full bg-slate-900" />}
                  </button>
                )
              })}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white">
            <div className={tab === 'details' ? 'p-5 flex flex-col gap-3' : 'hidden'}>
              <input value={draft.name} onChange={e => patch({ name: e.target.value })} placeholder="Package name (e.g. Puppy Starter)" className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm" />
              <RichTextEditor value={draft.description} onChange={html => patch({ description: isRichTextEmpty(html) ? '' : html })} key={draft.id ?? 'new'} minHeight={100} theme="light" />
              <div className="flex items-center gap-2">
                {draft.cadence === 'ONE_OFF' && (
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{sym}</span>
                    <input value={draft.price} onChange={e => patch({ price: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" placeholder="Price" className="h-10 w-32 rounded-lg border border-slate-200 pl-6 pr-2 text-sm" />
                  </div>
                )}
                <div className="inline-flex rounded-lg bg-slate-100 border border-slate-200 p-0.5">
                  {(['ONE_OFF', 'RECURRING'] as Cadence[]).map(c => (
                    <button key={c} onClick={() => patch({ cadence: c })} className={`px-3 h-9 text-sm font-medium rounded-md ${draft.cadence === c ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{c === 'ONE_OFF' ? 'One-off' : 'Recurring'}</button>
                  ))}
                </div>
              </div>
              {draft.cadence === 'RECURRING' && (
                <div className="rounded-lg bg-violet-50/60 border border-violet-100 p-3 flex flex-col gap-2.5">
                  <p className="text-xs text-violet-700">Add one or more billing options — the client picks which one they want. Configurable now; purchasable once automatic billing ships.</p>
                  {draft.plans.map(pl => (
                    <div key={pl.key} className="flex flex-wrap items-center gap-2 text-sm rounded-lg bg-white border border-violet-100 p-2">
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">{sym}</span>
                        <input value={pl.price} onChange={e => patchPlan(pl.key, { price: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" placeholder="Price" className="h-9 w-24 rounded-lg border border-slate-200 pl-5 pr-2 text-sm" />
                      </div>
                      <span className="text-slate-500">per</span>
                      <select value={pl.interval} onChange={e => patchPlan(pl.key, { interval: e.target.value as Interval })} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm">
                        <option value="WEEK">week</option><option value="FORTNIGHT">fortnight</option><option value="MONTH">month</option>
                      </select>
                      <span className="text-slate-500">· min</span>
                      <input value={pl.minTerm} onChange={e => patchPlan(pl.key, { minTerm: e.target.value.replace(/[^0-9]/g, '') })} inputMode="numeric" title="minimum term in cycles (0 = cancel any time)" className="h-9 w-12 rounded-lg border border-slate-200 px-2 text-sm" />
                      <span className="text-slate-500">cycles · fee</span>
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">{sym}</span>
                        <input value={pl.earlyTermFee} onChange={e => patchPlan(pl.key, { earlyTermFee: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" placeholder="0" title="early-termination fee" className="h-9 w-20 rounded-lg border border-slate-200 pl-5 pr-2 text-sm" />
                      </div>
                      <button onClick={() => removePlan(pl.key)} title="Remove option" className="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))}
                  <button onClick={addPlan} className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-dashed border-violet-300 text-violet-700 hover:bg-violet-50 self-start"><Plus className="h-4 w-4" /> Add pricing option</button>
                </div>
              )}
            </div>

            {/* Card appearance — its own tab, and everything in it is present:
                it's how the card the client actually meets gets built, so it
                isn't something to go looking for behind a chevron. */}
            <div className={tab === 'appearance' ? 'p-5' : 'hidden'}>
              <p className="flex items-center gap-2 text-sm font-medium text-slate-700"><Palette className="h-4 w-4 text-slate-400" strokeWidth={1.75} /> Card appearance</p>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1.5">Image</p>
                  <div className="flex items-center gap-3">
                    <div className="h-14 w-20 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden shrink-0 grid place-items-center text-slate-300">
                      {draft.imageUrl
                        ? // eslint-disable-next-line @next/next/no-img-element
                          <img src={draft.imageUrl} alt="" className="h-full w-full object-cover" />
                        : <ImageIcon className="h-5 w-5" strokeWidth={1.75} />}
                    </div>
                    <div className="flex flex-col items-start gap-1">
                      <ImageUploadButton onUploaded={urls => urls[0] && patch({ imageUrl: urls[0] })} />
                      {draft.imageUrl && <button type="button" onClick={() => patch({ imageUrl: null })} className="text-xs text-slate-500 hover:text-rose-600">Remove</button>}
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1.5">Button text</p>
                  <input value={draft.buttonText ?? ''} onChange={e => patch({ buttonText: e.target.value })} placeholder="Get this package" maxLength={40} className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm" />
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs font-medium text-slate-500 mb-1.5">Colour scheme</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {CARD_SCHEMES.map(s => (
                      <button key={s.name} type="button" title={s.name}
                        // Picking a scheme clears any hand-set button colours so
                        // the button follows the scheme rather than stranding an
                        // old accent on it.
                        onClick={() => patch({ bgColor: s.bgColor, headerColor: s.headerColor, textColor: s.textColor, featuredColor: s.featuredColor, buttonBgColor: null, buttonTextColor: null })}
                        className="h-7 w-7 rounded-full border border-slate-200 grid place-items-center hover:scale-110 transition-transform"
                        style={{ backgroundColor: s.bgColor }}>
                        <span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: s.featuredColor }} />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs font-medium text-slate-500 mb-1.5">Fine-tune colours</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {CARD_COLORS.map(({ key, label, fallback }) => (
                      <ColorSwatch key={key} label={label} value={draft[key]} fallback={fallback}
                        onChange={v => patch({ [key]: v } as Partial<Draft>)} />
                    ))}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs font-medium text-slate-500 mb-1.5">Button colours</p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    {BUTTON_COLORS.map(({ key, label }) => (
                      <ColorSwatch key={key} label={label} value={draft[key]}
                        fallback={key === 'buttonBgColor' ? buttonPreview.background : buttonPreview.color}
                        onChange={v => patch({ [key]: v } as Partial<Draft>)} />
                    ))}
                  </div>
                  <ButtonContrastNote colors={buttonPreview} chosenText={draft.buttonTextColor} />
                </div>
              </div>
            </div>

            {/* Included items */}
            <div className={tab === 'included' ? 'p-5' : 'hidden'}>
              <div className="text-sm font-medium text-slate-700 mb-2">What&#39;s included</div>
              <div className="flex flex-col gap-2">
                <DndArea sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorderItems}>
                <SortableContext items={draft.items.map(it => it.key)} strategy={verticalListSortingStrategy}>
                {draft.items.map(it => {
                  const off = offeringOf(it)
                  const resolvedImg = it.imageUrl ?? off?.imageUrl ?? null
                  return (
                    <SortableItemShell key={it.key} id={it.key}>
                    {(handle) => (
                    <div className="rounded-xl border border-slate-200 bg-white">
                      {/* One tidy control line. The offering picker takes the
                          whole width on a phone (order-last) and slots back
                          inline once there's room — quantity stays sized to the
                          1–2 digits it holds. */}
                      <div className="flex flex-wrap items-center gap-2 p-2.5">
                        <button type="button" {...handle} title="Drag to reorder" className="shrink-0 cursor-grab touch-none px-0.5 text-slate-300 hover:text-slate-500"><GripVertical className="h-4 w-4" strokeWidth={1.75} /></button>
                        <select aria-label="Item type" value={it.kind} onChange={e => patchItem(it.key, { kind: e.target.value as Kind, id: '', imageUrl: null, description: '' })} className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-sm sm:flex-none sm:w-[8.5rem]">
                          {KINDS.map(k => <option key={k.k} value={k.k}>{k.label}</option>)}
                        </select>
                        <select aria-label="Included offering" value={it.id} onChange={e => patchItem(it.key, { id: e.target.value })} className="h-9 min-w-0 basis-full order-last rounded-lg border border-slate-200 bg-white px-2 text-sm sm:order-none sm:basis-0 sm:flex-1">
                          <option value="">Choose…</option>
                          {offeringsFor(it.kind).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                        <span className="shrink-0 text-slate-400 text-sm">×</span>
                        <input aria-label="Quantity" value={it.quantity} onChange={e => patchItem(it.key, { quantity: Math.max(1, Number(e.target.value.replace(/[^0-9]/g, '')) || 1) })} inputMode="numeric" maxLength={2} className="h-9 w-11 shrink-0 rounded-lg border border-slate-200 px-1 text-center text-sm" />
                        <button onClick={() => removeItem(it.key)} title="Remove" className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" strokeWidth={1.75} /></button>
                      </div>
                      {/* This item's description + image, in the open. They fall
                          back to the offering's own, so there's nothing to
                          "switch on" — only something to override. */}
                      {it.id && (
                        <div className="border-t border-slate-100 p-3 flex flex-col gap-4 bg-slate-50/60">
                          <div>
                            <p className="text-xs font-medium text-slate-600 mb-1">Custom description {it.description.trim() ? '' : off?.description ? '— leave empty to use the offering’s own' : ''}</p>
                            <RichTextEditor value={it.description} onChange={html => patchItem(it.key, { description: isRichTextEmpty(html) ? '' : html })} key={it.key} minHeight={90} theme="light" />
                            {!it.description.trim() && off?.description && (
                              <div className="mt-1.5">
                                <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-0.5">Pulls in the offering’s description</p>
                                <RichText html={off.description} className="text-xs text-slate-500" />
                              </div>
                            )}
                          </div>
                          <div>
                            <p className="text-xs font-medium text-slate-600 mb-1.5">Image</p>
                            <div className="flex items-start gap-3">
                              <div className="h-16 w-16 rounded-lg border border-slate-200 bg-white overflow-hidden shrink-0 grid place-items-center text-slate-300">
                                {resolvedImg
                                  ? // eslint-disable-next-line @next/next/no-img-element
                                    <img src={resolvedImg} alt="" className="h-full w-full object-cover" />
                                  : <ImageIcon className="h-5 w-5" />}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs text-slate-500 mb-1.5">
                                  {it.imageUrl ? 'Custom image' : off?.imageUrl ? 'Using the offering’s image' : 'This offering has no image — add one'}
                                </p>
                                <div className="flex flex-wrap items-center gap-2">
                                  <ImageUploadButton onUploaded={urls => urls[0] && patchItem(it.key, { imageUrl: urls[0] })} />
                                  {it.imageUrl && <button type="button" onClick={() => patchItem(it.key, { imageUrl: null })} className="text-xs text-slate-500 hover:text-rose-600">Use offering’s image</button>}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    )}
                    </SortableItemShell>
                  )
                })}
                </SortableContext>
                </DndArea>
              </div>
              <button onClick={addItem} className="mt-2 inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-dashed border-slate-300 text-slate-600 hover:bg-slate-50"><Plus className="h-4 w-4" /> Add item</button>
              {saving > 0 && priceCents > 0 && (
                <p className="mt-3 text-sm text-emerald-700">Buyers save {formatMoney(saving, currency)} vs buying the parts separately.</p>
              )}
            </div>

            {/* Reminders & messages — timed automatically off each client's
                purchase (a membership has no timetable to hang them on). Only
                once the membership exists: the steps attach to its id. */}
            <div className={tab === 'messages' ? 'p-5' : 'hidden'}>
              <p className="flex items-center gap-2 text-sm font-medium text-slate-700"><Bell className="h-4 w-4 text-slate-400" strokeWidth={1.75} /> Reminders &amp; messages</p>
              {draft.id ? (
                <div className="mt-4">
                  <CommsFlowEditor membershipId={draft.id} offeringName={draft.name} />
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500">Save the package first, then you can add a welcome message and reminders for the people who buy it.</p>
              )}
            </div>

            {/* Publish, delete and save belong to the whole package, so they sit
                below every tab rather than inside one of them. */}
            <div className="border-t border-slate-100 p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <Switch checked={draft.published} onChange={() => patch({ published: !draft.published })} onColor="bg-violet-600" aria-label="Published" />
                Published (buyable on your booking page)
              </div>
              <div className="flex items-center gap-2">
                {draft.id && (
                  <button onClick={() => remove(draft.id!)} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-3 text-sm rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 mr-auto"><Trash2 className="h-4 w-4" strokeWidth={1.75} /> Delete</button>
                )}
                <button onClick={() => setDraft(null)} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-3 text-sm rounded-lg text-slate-600 hover:bg-slate-100"><X className="h-4 w-4" /> Cancel</button>
                <button onClick={save} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save</button>
              </div>
            </div>
            </div>
          </div>
          {/* Live preview — exactly how the card looks in the client
              Memberships storefront, updating as you build. */}
          <div className="lg:col-span-5 lg:sticky lg:top-6">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Preview — how clients see it</p>
            <MembershipPreviewCard
              name={draft.name}
              description={draft.description}
              priceCents={priceCents}
              recurring={draft.cadence === 'RECURRING'}
              interval={draft.interval}
              plans={draft.cadence === 'RECURRING' ? draft.plans.filter(p => p.price.trim()).map(p => ({ interval: p.interval, priceCents: Math.round(Number(p.price) * 100) })) : []}
              items={draft.items.filter(it => it.id).map(it => {
                const off = offeringOf(it)
                return { label: off?.name ?? '…', quantity: it.quantity, imageUrl: it.imageUrl ?? off?.imageUrl ?? null, description: it.description.trim() || off?.description || null }
              })}
              currency={currency}
              card={draft}
            />
          </div>
          </div>
        ) : list.length === 0 ? (
          <OfferingEmpty
            icon={<Ticket className="h-6 w-6" />}
            title="No packages yet"
            body="Bundle your 1:1 consults, classes and products into a package clients buy in one go."
            action={{ onClick: startNew, label: 'New package' }}
          />
        ) : (
          <>
            {reorderError && (
              <p className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">{reorderError}</p>
            )}
            <OfferingListBar view={view} onView={setView} />
            <SortableOfferingList ids={list.map(m => m.id)} onReorder={reorder}>
              <OfferingItems view={view}>
                {list.map(m => (
                  <SortableOfferingCard key={m.id} id={m.id}>
                    {handle => (
                      <OfferingCard
                        onOpen={() => startEdit(m)}
                        title={m.name}
                        description={m.description}
                        imageUrl={m.imageUrl}
                        tile={{ icon: <Ticket className="h-5 w-5" />, className: 'bg-violet-50 text-violet-600' }}
                        dimmed={!m.published}
                        dragHandle={handle}
                        badges={[
                          {
                            label: `${formatMoney(m.priceCents, currency)}${m.cadence === 'RECURRING' ? ` / ${m.interval?.toLowerCase()}` : ''}`,
                            tone: 'accent',
                          },
                          ...(m.published ? [] : [{ label: 'Draft', tone: 'muted' as const }]),
                          ...(m.purchases > 0 ? [{ label: `${m.purchases} sold`, tone: 'good' as const }] : []),
                          // Someone asked for this and is still waiting. It
                          // reads as "warn" because it's work owed, not a win —
                          // answering happens on the dashboard.
                          ...((m.pendingRequests ?? 0) > 0
                            ? [{ label: `${m.pendingRequests} waiting`, tone: 'warn' as const }]
                            : []),
                        ]}
                        facts={membershipFacts(m, offeringName)}
                        // No eye/pencil/bin. Tapping the row IS opening it, and
                        // everything those three did lives inside: publish is
                        // the switch above Save, delete is the button beside it.
                        // The Draft badge still says which is which from here.
                      />
                    )}
                  </SortableOfferingCard>
                ))}
              </OfferingItems>
            </SortableOfferingList>
            <AddOfferingLink onClick={startNew} label="New package" />
          </>
        )}
      </div>
    </>
  )
}

// One colour control: a swatch that opens the native picker, the label, and a
// reset back to the derived default.
function ColorSwatch({ label, value, fallback, onChange }: {
  label: string; value: string | null; fallback: string; onChange: (v: string | null) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="relative block h-8 w-8 rounded-lg border border-slate-200 overflow-hidden cursor-pointer" style={{ backgroundColor: value ?? fallback }}>
        <span className="sr-only">{label}</span>
        <input type="color" aria-label={label} value={value ?? fallback} onChange={e => onChange(e.target.value)} className="absolute -inset-1 opacity-0 cursor-pointer" />
      </label>
      <div className="flex flex-col leading-tight">
        <span className="text-xs text-slate-600">{label}</span>
        {value
          ? <button type="button" onClick={() => onChange(null)} className="text-[11px] text-slate-400 hover:text-rose-600 text-left">reset</button>
          : <span className="text-[11px] text-slate-400">default</span>}
      </div>
    </div>
  )
}

// Tells the trainer, in words, what their button pair does — and says so plainly
// when we had to darken/lighten their label to keep it readable. No tinted
// chips: a swatch of the real thing plus one line of slate text.
function ButtonContrastNote({ colors, chosenText }: { colors: ButtonColors; chosenText: string | null }) {
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="inline-flex h-8 items-center rounded-lg px-3 text-xs font-semibold" style={{ backgroundColor: colors.background, color: colors.color }}>Button preview</span>
      <p className="text-[11px] text-slate-500">
        {colors.adjusted && chosenText
          ? `Contrast ${colors.ratio.toFixed(1)}:1 — your text colour was too close to the background, so it’s been deepened to stay readable.`
          : `Contrast ${colors.ratio.toFixed(1)}:1 — clears the ${MIN_CONTRAST}:1 readability standard.`}
      </p>
    </div>
  )
}

// What's in the bundle, on the card — the reason a trainer can tell two
// memberships apart at a glance.
function membershipFacts(
  m: { items: MItem[]; plans: MPlan[]; cadence: Cadence },
  nameOf: (it: MItem) => string,
): OfferingFact[] {
  const facts: OfferingFact[] = []
  const items = m.items.map(it => `${it.quantity > 1 ? `${it.quantity}× ` : ''}${nameOf(it)}`)
  facts.push({
    icon: <PackageIcon className="h-3.5 w-3.5" />,
    label: items.length > 0 ? items.join(' · ') : 'No items yet',
    tone: items.length > 0 ? 'default' : 'warn',
  })
  if (m.cadence === 'RECURRING' && m.plans.length > 0) {
    facts.push({
      icon: <Ticket className="h-3.5 w-3.5" />,
      label: `${m.plans.length} pricing option${m.plans.length === 1 ? '' : 's'}`,
    })
  }
  return facts
}
