'use client'

import { useState } from 'react'
import { RichTextEditor } from '@/components/shared/rich-text-editor'
import { RichText } from '@/components/shared/rich-text'
import { isRichTextEmpty } from '@/lib/rich-text'
import { ImageUploadButton } from '@/components/image-uploader'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/shared/page-header'
import { Ticket, Plus, Trash2, Pencil, Loader2, Check, X, GraduationCap, Users, ShoppingBag, Image as ImageIcon, ChevronDown, Palette } from 'lucide-react'
import { useCurrency } from '@/components/currency-context'
import { currencySymbol, formatMoney } from '@/lib/money'
import { Switch } from '@/components/ui/switch'

type Kind = 'PACKAGE' | 'CLASS' | 'PRODUCT'
type Cadence = 'ONE_OFF' | 'RECURRING'
type Interval = 'WEEK' | 'FORTNIGHT' | 'MONTH'
interface Offering { id: string; name: string; priceCents?: number; imageUrl?: string | null; description?: string | null }
interface Offerings { packages: Offering[]; classRuns: Offering[]; products: Offering[] }
interface MItem { kind: Kind; packageId: string | null; classRunId: string | null; productId: string | null; quantity: number; regrantOnRenewal: boolean; imageUrl?: string | null; description?: string | null }
interface Card { imageUrl: string | null; bgColor: string | null; headerColor: string | null; textColor: string | null; featuredColor: string | null; buttonText: string | null }
interface Membership extends Card {
  id: string; name: string; description: string | null; priceCents: number
  cadence: Cadence; interval: Interval | null; minTermCount: number; earlyTermFeeCents: number | null
  published: boolean; purchases: number; items: MItem[]
}

interface DraftItem { key: string; kind: Kind; id: string; quantity: number; regrantOnRenewal: boolean; imageUrl: string | null; description: string }
interface Draft extends Card {
  id: string | null; name: string; description: string; price: string; cadence: Cadence
  interval: Interval; minTermCount: string; earlyTermFee: string; published: boolean; items: DraftItem[]
}

// Live preview of the membership as it appears in the client Memberships
// storefront (mirrors ClientMembershipsView's card), fed from the builder draft.
interface PreviewItem { label: string; quantity: number; imageUrl?: string | null; description?: string | null }
function MembershipPreviewCard({ name, description, priceCents, recurring, interval, items, currency, card }: {
  name: string; description: string; priceCents: number; recurring: boolean; interval: Interval; items: PreviewItem[]; currency: string; card: Card
}) {
  const bg = card.bgColor ?? '#ffffff'
  const header = card.headerColor ?? '#0f172a'
  const text = card.textColor ?? '#64748b'
  const featured = card.featuredColor ?? '#7c3aed'
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
              <Ticket className="h-5 w-5 shrink-0" style={{ color: featured }} /> {name.trim() || <span className="opacity-50 font-normal">Membership name</span>}
            </h2>
            <div className="mt-1" style={{ color: text }}><RichText html={description} className="text-sm" /></div>
          </div>
          <span className="text-lg font-bold whitespace-nowrap" style={{ color: featured }}>{formatMoney(priceCents, currency)}{recurring ? ` / ${interval.toLowerCase()}` : ''}</span>
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
        <button type="button" disabled className="mt-4 w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl text-white font-semibold opacity-95 cursor-default" style={{ backgroundColor: featured }}>{card.buttonText?.trim() || 'Get this membership'}</button>
      </div>
    </div>
  )
}

// Storefront card colours the trainer can set (with a sensible default swatch
// shown when unset). featuredColor tints the price + the buy button.
const CARD_COLORS: { key: 'bgColor' | 'headerColor' | 'textColor' | 'featuredColor'; label: string; fallback: string }[] = [
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

let seq = 0
const KINDS: { k: Kind; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { k: 'PACKAGE', label: '1:1 package', Icon: GraduationCap },
  { k: 'CLASS', label: 'Class place', Icon: Users },
  { k: 'PRODUCT', label: 'Product', Icon: ShoppingBag },
]

export function MembershipsView({ memberships, offerings, currency: initialCurrency }: { memberships: Membership[]; offerings: Offerings; currency: string }) {
  const router = useRouter()
  const currency = useCurrency() ?? initialCurrency
  const sym = currencySymbol(currency)

  const [list, setList] = useState(memberships)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Which included item's image/blurb panel is expanded (by key).
  const [openItem, setOpenItem] = useState<string | null>(null)
  // Card-appearance controls are collapsed behind a button by default.
  const [showCardStyle, setShowCardStyle] = useState(false)

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
    setDraft({ id: null, name: '', description: '', price: '', cadence: 'ONE_OFF', interval: 'MONTH', minTermCount: '0', earlyTermFee: '', published: false, items: [], imageUrl: null, bgColor: null, headerColor: null, textColor: null, featuredColor: null, buttonText: null })
  }
  function startEdit(m: Membership) {
    setError(null)
    setDraft({
      id: m.id, name: m.name, description: m.description ?? '', price: (m.priceCents / 100).toString(),
      cadence: m.cadence, interval: m.interval ?? 'MONTH', minTermCount: String(m.minTermCount), earlyTermFee: m.earlyTermFeeCents != null ? (m.earlyTermFeeCents / 100).toString() : '',
      published: m.published,
      imageUrl: m.imageUrl, bgColor: m.bgColor, headerColor: m.headerColor, textColor: m.textColor, featuredColor: m.featuredColor, buttonText: m.buttonText,
      items: m.items.map(i => ({ key: `k${seq++}`, kind: i.kind, id: i.packageId ?? i.classRunId ?? i.productId ?? '', quantity: i.quantity, regrantOnRenewal: i.regrantOnRenewal, imageUrl: i.imageUrl ?? null, description: i.description ?? '' })),
    })
  }

  const patch = (p: Partial<Draft>) => setDraft(d => (d ? { ...d, ...p } : d))
  const addItem = () => patch({ items: [...draft!.items, { key: `k${seq++}`, kind: 'PACKAGE', id: '', quantity: 1, regrantOnRenewal: false, imageUrl: null, description: '' }] })
  const patchItem = (key: string, p: Partial<DraftItem>) => patch({ items: draft!.items.map(it => (it.key === key ? { ...it, ...p } : it)) })
  const removeItem = (key: string) => patch({ items: draft!.items.filter(it => it.key !== key) })

  // "Normally" = sum of the included offerings' own prices (classes have no
  // standalone price here, so they don't add to it).
  const partsTotal = draft ? draft.items.reduce((s, it) => {
    const price = offeringsFor(it.kind).find(o => o.id === it.id)?.priceCents ?? 0
    return s + price * it.quantity
  }, 0) : 0
  const priceCents = draft ? Math.round((Number(draft.price) || 0) * 100) : 0
  const saving = partsTotal - priceCents

  async function save() {
    if (!draft) return
    if (!draft.name.trim()) return setError('Give the membership a name.')
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
      imageUrl: draft.imageUrl, bgColor: draft.bgColor, headerColor: draft.headerColor, textColor: draft.textColor, featuredColor: draft.featuredColor,
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

  async function remove(id: string) {
    setBusy(true)
    const res = await fetch(`/api/trainer/memberships/${id}`, { method: 'DELETE' })
    setBusy(false)
    if (res.ok) setList(prev => prev.filter(m => m.id !== id))
  }
  async function togglePublished(m: Membership) {
    setList(prev => prev.map(x => (x.id === m.id ? { ...x, published: !x.published } : x)))
    await fetch(`/api/trainer/memberships/${m.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ published: !m.published }) })
  }

  return (
    <>
      <PageHeader
        title="Memberships"
        actions={!draft ? (
          <button onClick={startNew} className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700"><Plus className="h-4 w-4" /> <span className="hidden sm:inline">New membership</span></button>
        ) : undefined}
      />
      <div className={`p-4 md:p-8 w-full ${draft ? '' : 'max-w-3xl'}`}>
        {error && <div className="mb-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">{error}</div>}

        {draft ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
            <div className="p-5 flex flex-col gap-3">
              <input value={draft.name} onChange={e => patch({ name: e.target.value })} placeholder="Membership name (e.g. Puppy Starter)" className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm" />
              <RichTextEditor value={draft.description} onChange={html => patch({ description: isRichTextEmpty(html) ? '' : html })} key={draft.id ?? 'new'} minHeight={100} theme="light" />
              <div className="flex items-center gap-2">
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{sym}</span>
                  <input value={draft.price} onChange={e => patch({ price: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" placeholder="Price" className="h-10 w-32 rounded-lg border border-slate-200 pl-6 pr-2 text-sm" />
                </div>
                <div className="inline-flex rounded-lg bg-slate-100 border border-slate-200 p-0.5">
                  {(['ONE_OFF', 'RECURRING'] as Cadence[]).map(c => (
                    <button key={c} onClick={() => patch({ cadence: c })} className={`px-3 h-9 text-sm font-medium rounded-md ${draft.cadence === c ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{c === 'ONE_OFF' ? 'One-off' : 'Recurring'}</button>
                  ))}
                </div>
              </div>
              {draft.cadence === 'RECURRING' && (
                <div className="rounded-lg bg-violet-50/60 border border-violet-100 p-3 flex flex-col gap-2">
                  <p className="text-xs text-violet-700">Recurring memberships can be configured now but aren&#39;t purchasable until automatic billing ships.</p>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-slate-500">Every</span>
                    <select value={draft.interval} onChange={e => patch({ interval: e.target.value as Interval })} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm">
                      <option value="WEEK">week</option><option value="FORTNIGHT">fortnight</option><option value="MONTH">month</option>
                    </select>
                    <span className="text-slate-500">· min term</span>
                    <input value={draft.minTermCount} onChange={e => patch({ minTermCount: e.target.value.replace(/[^0-9]/g, '') })} inputMode="numeric" className="h-9 w-14 rounded-lg border border-slate-200 px-2 text-sm" title="cycles (0 = none)" />
                    <span className="text-slate-500">cycles · early-term fee</span>
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">{sym}</span>
                      <input value={draft.earlyTermFee} onChange={e => patch({ earlyTermFee: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" placeholder="0" className="h-9 w-20 rounded-lg border border-slate-200 pl-5 pr-2 text-sm" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Card appearance — collapsed behind a toggle to keep the form tidy. */}
            <div className="p-5">
              <button type="button" onClick={() => setShowCardStyle(v => !v)} className="flex w-full items-center justify-between text-sm font-medium text-slate-700">
                <span className="flex items-center gap-2"><Palette className="h-4 w-4 text-slate-400" /> Card appearance</span>
                <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${showCardStyle ? 'rotate-180' : ''}`} />
              </button>
              {showCardStyle && (
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                  <div>
                    <p className="text-xs font-medium text-slate-500 mb-1.5">Image</p>
                    <div className="flex items-center gap-3">
                      <div className="h-14 w-20 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden shrink-0 grid place-items-center text-slate-300">
                        {draft.imageUrl
                          ? // eslint-disable-next-line @next/next/no-img-element
                            <img src={draft.imageUrl} alt="" className="h-full w-full object-cover" />
                          : <ImageIcon className="h-5 w-5" />}
                      </div>
                      <div className="flex flex-col items-start gap-1">
                        <ImageUploadButton onUploaded={urls => urls[0] && patch({ imageUrl: urls[0] })} />
                        {draft.imageUrl && <button type="button" onClick={() => patch({ imageUrl: null })} className="text-xs text-slate-500 hover:text-rose-600">Remove</button>}
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500 mb-1.5">Button text</p>
                    <input value={draft.buttonText ?? ''} onChange={e => patch({ buttonText: e.target.value })} placeholder="Get this membership" maxLength={40} className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm" />
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-xs font-medium text-slate-500 mb-1.5">Colour scheme</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {CARD_SCHEMES.map(s => (
                        <button key={s.name} type="button" title={s.name}
                          onClick={() => patch({ bgColor: s.bgColor, headerColor: s.headerColor, textColor: s.textColor, featuredColor: s.featuredColor })}
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
                        <div key={key} className="flex items-center gap-2">
                          <label className="relative block h-8 w-8 rounded-lg border border-slate-200 overflow-hidden cursor-pointer" style={{ backgroundColor: draft[key] ?? fallback }}>
                            <input type="color" value={draft[key] ?? fallback} onChange={e => patch({ [key]: e.target.value } as Partial<Draft>)} className="absolute -inset-1 opacity-0 cursor-pointer" />
                          </label>
                          <div className="flex flex-col leading-tight">
                            <span className="text-xs text-slate-600">{label}</span>
                            {draft[key]
                              ? <button type="button" onClick={() => patch({ [key]: null } as Partial<Draft>)} className="text-[11px] text-slate-400 hover:text-rose-600 text-left">reset</button>
                              : <span className="text-[11px] text-slate-400">default</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Included items */}
            <div className="p-5">
              <div className="text-sm font-medium text-slate-700 mb-2">What&#39;s included</div>
              <div className="flex flex-col gap-2">
                {draft.items.map(it => {
                  const off = offeringOf(it)
                  const resolvedImg = it.imageUrl ?? off?.imageUrl ?? null
                  const open = openItem === it.key
                  const customised = !!it.imageUrl || !!it.description.trim()
                  return (
                    <div key={it.key} className="rounded-xl border border-slate-200">
                      <div className="flex flex-wrap items-center gap-2 p-2.5">
                        <select value={it.kind} onChange={e => patchItem(it.key, { kind: e.target.value as Kind, id: '', imageUrl: null, description: '' })} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm">
                          {KINDS.map(k => <option key={k.k} value={k.k}>{k.label}</option>)}
                        </select>
                        <select value={it.id} onChange={e => patchItem(it.key, { id: e.target.value })} className="h-9 flex-1 min-w-[10rem] rounded-lg border border-slate-200 bg-white px-2 text-sm">
                          <option value="">Choose…</option>
                          {offeringsFor(it.kind).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                        <span className="text-slate-400 text-sm">×</span>
                        <input value={it.quantity} onChange={e => patchItem(it.key, { quantity: Math.max(1, Number(e.target.value.replace(/[^0-9]/g, '')) || 1) })} inputMode="numeric" className="h-9 w-14 rounded-lg border border-slate-200 px-2 text-sm" />
                        {/* Optional image + custom description for this item
                            (pulls the offering's own by default). */}
                        <button type="button" onClick={() => setOpenItem(open ? null : it.key)} disabled={!it.id}
                          className={`inline-flex items-center gap-1 h-9 px-2.5 rounded-lg text-xs font-medium disabled:opacity-40 ${open || customised ? 'bg-teal-50 text-teal-700' : 'text-slate-500 hover:bg-slate-100'}`}>
                          <ImageIcon className="h-3.5 w-3.5" />
                          {customised ? 'Edit description & image' : 'Add description & image'}
                          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                        </button>
                        <button onClick={() => removeItem(it.key)} title="Remove" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>
                      </div>
                      {open && it.id && (
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
                  )
                })}
              </div>
              <button onClick={addItem} className="mt-2 inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-dashed border-slate-300 text-slate-600 hover:bg-slate-50"><Plus className="h-4 w-4" /> Add item</button>
              {saving > 0 && priceCents > 0 && (
                <p className="mt-3 text-sm text-emerald-700">Buyers save {formatMoney(saving, currency)} vs buying the parts separately.</p>
              )}
            </div>

            <div className="p-5 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <Switch checked={draft.published} onChange={() => patch({ published: !draft.published })} onColor="bg-violet-600" aria-label="Published" />
                Published (buyable on your booking page)
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setDraft(null)} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-3 text-sm rounded-lg text-slate-600 hover:bg-slate-100"><X className="h-4 w-4" /> Cancel</button>
                <button onClick={save} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save</button>
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
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <div className="mx-auto w-11 h-11 rounded-full bg-violet-50 flex items-center justify-center mb-3"><Ticket className="h-5 w-5 text-violet-600" /></div>
            <p className="text-sm text-slate-600 mb-4">Bundle your packages, classes and products into a membership clients buy in one go.</p>
            <button onClick={startNew} className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700"><Plus className="h-4 w-4" /> New membership</button>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map(m => (
              <li key={m.id} className={`rounded-xl border border-slate-200 bg-white p-4 flex items-start gap-3 ${m.published ? '' : 'opacity-70'}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold text-slate-900">{m.name}</span>
                    <span className="text-violet-700 font-medium text-sm">{formatMoney(m.priceCents, currency)}{m.cadence === 'RECURRING' ? ` / ${m.interval?.toLowerCase()}` : ''}</span>
                    {!m.published && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">Draft</span>}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{m.items.map(offeringName).join(' · ') || 'No items yet'}{m.purchases > 0 ? ` · ${m.purchases} sold` : ''}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Switch checked={m.published} onChange={() => togglePublished(m)} disabled={busy} onColor="bg-violet-600" aria-label={m.published ? 'Unpublish' : 'Publish'} />
                  <button onClick={() => startEdit(m)} title="Edit" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => remove(m.id)} disabled={busy} title="Delete" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
