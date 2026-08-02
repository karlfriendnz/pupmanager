'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  CalendarPlus, GraduationCap, PartyPopper, Ticket, Dog, ShoppingBag, X,
  type LucideIcon,
} from 'lucide-react'

import { SectionLabel } from '@/components/shared/flat-list'
import { ConfirmSheet } from '@/components/shared/confirm-sheet'
import { removeTagFrom } from '@/components/shared/tag-picker'
import { useCurrency } from '@/components/currency-context'
import { formatMoney } from '@/lib/money'

/** Which section a tagged thing belongs in. Mirrors the five offering kinds
 *  the trainer's own lists are split into, plus the shop. */
export type TaggedKind = 'onetoone' | 'class' | 'casual' | 'event' | 'daycare' | 'product'

export interface TaggedItem {
  /** `package:<id>` or `product:<id>` — the two id spaces are only unique
   *  within their own table and this list mixes them. */
  key: string
  /** What the tag-assignment write needs. Exactly one of the two, matching the
   *  CHECK constraint on tag_assignments. */
  target: { packageId: string } | { productId: string }
  kind: TaggedKind
  name: string
  priceCents: number | null
  sub: string | null
  href: string
}

/**
 * The sections, in the order the app itself lists them — Offerings top to
 * bottom, then the shop.
 *
 * Labelled, and deliberately kept as separate headings on ONE screen: you BOOK
 * a class and you BUY a clicker, and a trainer scanning this needs to know
 * which is which without opening anything. What they must not need is two
 * screens to see both, which is the entire point of a tag.
 */
const SECTIONS: { kind: TaggedKind; label: string; icon: LucideIcon }[] = [
  { kind: 'onetoone', label: '1:1 Sessions', icon: CalendarPlus },
  { kind: 'class', label: 'Group Classes', icon: GraduationCap },
  { kind: 'casual', label: 'Casual Classes', icon: Ticket },
  { kind: 'event', label: 'Events', icon: PartyPopper },
  { kind: 'daycare', label: 'Doggy Daycare', icon: Dog },
  // The same words the client's browse screen uses for the same run of rows.
  { kind: 'product', label: 'From the shop', icon: ShoppingBag },
]

export function TagDetail({ tag, items: initial }: { tag: { id: string; name: string }; items: TaggedItem[] }) {
  const currency = useCurrency()
  const [items, setItems] = useState(initial)
  const [confirm, setConfirm] = useState<TaggedItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove(item: TaggedItem) {
    setBusy(true)
    setError(null)
    const before = items
    // Dropped from the list first so the screen answers immediately, and put
    // back if the write is refused — the same optimism the tag list itself uses.
    setItems(prev => prev.filter(i => i.key !== item.key))
    const ok = await removeTagFrom(item.target, tag.id)
    setBusy(false)
    setConfirm(null)
    if (!ok) {
      setItems(before)
      setError(`Could not take “${item.name}” out of this tag.`)
    }
  }

  return (
    // Every tag is the same route with different content, so a review comment
    // pinned here records WHICH tag it was made on rather than piling every tag
    // onto one page key.
    <div className="mx-auto w-full max-w-2xl p-4" data-review-scope={`Tag: ${tag.name}`}>
      {error && (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}

      {items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center">
          <p className="text-sm text-slate-700">Nothing is in “{tag.name}” yet.</p>
          {/* Says where the tag is actually applied, because this screen can't
              do it: a tag goes ON a thing, from that thing's own editor. */}
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-slate-500">
            Open an offering or a product, and tick “{tag.name}” under Tags.
          </p>
          <Link
            href="/offerings"
            className="mt-4 inline-flex h-10 items-center justify-center rounded-xl bg-[var(--pm-brand-600)] px-4 text-sm font-semibold text-white hover:bg-[var(--pm-brand-700)]"
          >
            Go to Offerings
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {SECTIONS.map(section => {
            const rows = items.filter(i => i.kind === section.kind)
            if (rows.length === 0) return null
            const Icon = section.icon
            return (
              <section key={section.kind}>
                <SectionLabel>
                  <span className="inline-flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {section.label}
                  </span>
                </SectionLabel>
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white [&>*+*]:border-t [&>*+*]:border-slate-200">
                  {rows.map(item => (
                    <div key={item.key} className="flex items-center">
                      {/* The remove button is a SIBLING of the link, never
                          inside it — a button nested in an anchor is invalid
                          markup and the tap goes to the navigation. */}
                      <Link href={item.href} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-2 text-left">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-900">{item.name}</span>
                          {item.sub && <span className="mt-0.5 block truncate text-[13px] text-slate-500">{item.sub}</span>}
                        </span>
                        {item.priceCents != null && (
                          <span className="flex-shrink-0 text-sm text-slate-500">{formatMoney(item.priceCents, currency)}</span>
                        )}
                      </Link>
                      <button
                        type="button"
                        onClick={() => setConfirm(item)}
                        aria-label={`Take ${item.name} out of this tag`}
                        className="mr-1.5 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <X className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {confirm && (
        <ConfirmSheet
          title={`Take “${confirm.name}” out of “${tag.name}”?`}
          // Said out loud, exactly as the delete-a-tag sheet does. An X beside
          // a course reads like it deletes the course; it does not.
          body={`It stays exactly as it is and stays on sale — only the tag comes off.`}
          confirmLabel="Take it out"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void remove(confirm)}
        />
      )}
    </div>
  )
}
