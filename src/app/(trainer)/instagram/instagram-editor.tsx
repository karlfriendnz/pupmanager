'use client'

import { useMemo, useRef, useState } from 'react'
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
import { GripVertical, Plus, Trash2, Copy, Check, ExternalLink, ImagePlus, Loader2, Palette } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  buildLinkButtons,
  buildSocialLinks,
  normalizeButtonStyle,
  LINK_PAGE_FONTS,
  linkPageFontStack,
  type ButtonStyle,
} from '@/lib/link-page'
import { compressImageFile } from '@/lib/compress-image'
import { LinkPageView } from '../../l/[slug]/link-page-view'

interface Brand {
  businessName: string
  avatarUrl: string | null
  accent: string
  slug: string
  website: string | null
  publicEmail: string | null
  phone: string | null
  showPhoneToClients: boolean
}

interface EditLink {
  id: string
  label: string
  url: string
}

interface Initial {
  headline: string | null
  bio: string | null
  showBooking: boolean
  showWebsite: boolean
  showContact: boolean
  instagram: string | null
  facebook: string | null
  tiktok: string | null
  socialsLabel: string | null
  font: string | null
  backgroundUrl: string | null
  links: EditLink[]
  itemOrder: string[]
  buttonStyles: Record<string, ButtonStyle> | null
}

// Stable-ish local id for a freshly-added row (dnd keys need to be stable).
let tempSeq = 0
const nextTempId = () => `new-${tempSeq++}`

// Build the FULL on-screen order: every item present exactly once, honouring the
// saved order and appending anything missing (new links, first load) in the
// legacy default order (book → customs → website → contact). Stale keys drop.
function resolveItemOrder(order: string[], linkIds: string[]): string[] {
  const all = ['book', ...linkIds.map((id) => `custom:${id}`), 'website', 'contact']
  const allSet = new Set(all)
  const seen = new Set<string>()
  const result: string[] = []
  for (const k of order) {
    if (allSet.has(k) && !seen.has(k)) {
      result.push(k)
      seen.add(k)
    }
  }
  for (const k of all) {
    if (!seen.has(k)) {
      result.push(k)
      seen.add(k)
    }
  }
  return result
}

export function InstagramEditor({
  publicUrl,
  brand,
  initial,
}: {
  publicUrl: string | null
  brand: Brand
  initial: Initial
}) {
  const [headline, setHeadline] = useState(initial.headline ?? '')
  const [bio, setBio] = useState(initial.bio ?? '')
  const [showBooking, setShowBooking] = useState(initial.showBooking)
  const [showWebsite, setShowWebsite] = useState(initial.showWebsite)
  const [showContact, setShowContact] = useState(initial.showContact)
  const [instagram, setInstagram] = useState(initial.instagram ?? '')
  const [facebook, setFacebook] = useState(initial.facebook ?? '')
  const [tiktok, setTiktok] = useState(initial.tiktok ?? '')
  const [socialsLabel, setSocialsLabel] = useState(initial.socialsLabel ?? '')
  const [font, setFont] = useState(initial.font ?? 'default')
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(initial.backgroundUrl)
  const [links, setLinks] = useState<EditLink[]>(initial.links)
  // Global item order (keys: 'book' | 'website' | 'contact' | 'custom:<id>').
  const [order, setOrder] = useState<string[]>(initial.itemOrder ?? [])
  // Per-button style overrides, keyed by the same button keys as `order`.
  // Normalised on load so only clean values survive.
  const [styles, setStyles] = useState<Record<string, ButtonStyle>>(() => {
    const src = initial.buttonStyles ?? {}
    const out: Record<string, ButtonStyle> = {}
    for (const [k, v] of Object.entries(src)) {
      const clean = normalizeButtonStyle(v)
      if (clean) out[k] = clean
    }
    return out
  })

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [uploadingBg, setUploadingBg] = useState(false)
  const [uploadingStyleKey, setUploadingStyleKey] = useState<string | null>(null)
  const bgInputRef = useRef<HTMLInputElement>(null)

  // Merge a patch into one button's style; sub-fields set to undefined/'' clear,
  // and an entry that ends up empty is dropped so the button cleanly inherits.
  function updateStyle(key: string, patch: Partial<ButtonStyle>) {
    setStyles((prev) => {
      const next: ButtonStyle = { ...(prev[key] ?? {}) }
      for (const [field, value] of Object.entries(patch) as [keyof ButtonStyle, string | undefined][]) {
        if (value === undefined || value === '') delete next[field]
        else next[field] = value
      }
      const out = { ...prev }
      if (Object.keys(next).length === 0) delete out[key]
      else out[key] = next
      return out
    })
    setSaved(false)
  }

  async function uploadButtonImage(key: string, file: File) {
    setError(null)
    setUploadingStyleKey(key)
    try {
      const toSend = await compressImageFile(file)
      const fd = new FormData()
      fd.append('file', toSend)
      fd.append('kind', 'button')
      const res = await fetch('/api/trainer/branding-image', { method: 'POST', body: fd })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof body.error === 'string' ? body.error : 'Upload failed')
        return
      }
      updateStyle(key, { imageUrl: body.url })
    } catch {
      setError('Upload failed. Please try again.')
    } finally {
      setUploadingStyleKey(null)
    }
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  // The full ordered list of items shown in (and dragged within) the single stack.
  const resolvedOrder = useMemo(() => resolveItemOrder(order, links.map((l) => l.id)), [order, links])

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const items = resolvedOrder
    const oldIndex = items.indexOf(String(active.id))
    const newIndex = items.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    // Materialise the moved order (all items now explicit) so it round-trips.
    setOrder(arrayMove(items, oldIndex, newIndex))
    setSaved(false)
  }

  function updateLink(id: string, patch: Partial<EditLink>) {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
    setSaved(false)
  }
  function addLink() {
    const id = nextTempId()
    setLinks((prev) => [...prev, { id, label: '', url: '' }])
    setOrder((prev) => [...resolveItemOrder(prev, links.map((l) => l.id)), `custom:${id}`])
    setSaved(false)
  }
  function removeLink(id: string) {
    setLinks((prev) => prev.filter((l) => l.id !== id))
    setOrder((prev) => prev.filter((k) => k !== `custom:${id}`))
    setStyles((prev) => {
      if (!(`custom:${id}` in prev)) return prev
      const out = { ...prev }
      delete out[`custom:${id}`]
      return out
    })
    setSaved(false)
  }

  async function uploadBackground(file: File) {
    setError(null)
    setUploadingBg(true)
    try {
      const toSend = await compressImageFile(file)
      const fd = new FormData()
      fd.append('file', toSend)
      fd.append('kind', 'background')
      const res = await fetch('/api/trainer/branding-image', { method: 'POST', body: fd })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof body.error === 'string' ? body.error : 'Upload failed')
        return
      }
      setBackgroundUrl(body.url)
      setSaved(false)
    } catch {
      setError('Upload failed. Please try again.')
    } finally {
      setUploadingBg(false)
    }
  }

  // Preview buttons — computed exactly like the public page so preview == reality.
  const previewButtons = useMemo(
    () =>
      buildLinkButtons(
        {
          headline: headline || null,
          bio: bio || null,
          showBooking,
          showWebsite,
          showContact,
          instagram: instagram || null,
          facebook: facebook || null,
          tiktok: tiktok || null,
          links: links.map((l) => ({ id: l.id, label: l.label, url: l.url })),
          itemOrder: order,
          buttonStyles: styles,
        },
        {
          slug: brand.slug,
          website: brand.website,
          publicEmail: brand.publicEmail,
          phone: brand.phone,
          showPhoneToClients: brand.showPhoneToClients,
        },
      ),
    [headline, bio, showBooking, showWebsite, showContact, instagram, facebook, tiktok, links, order, styles, brand],
  )

  // Preview socials — the icon row, computed like the public page.
  const previewSocials = useMemo(
    () => buildSocialLinks({ instagram: instagram || null, facebook: facebook || null, tiktok: tiktok || null }),
    [instagram, facebook, tiktok],
  )

  async function save() {
    setSaving(true)
    setError(null)
    try {
      // Persist links in the GLOBAL on-screen order (not the raw `links` array),
      // keeping only complete rows. itemOrder's custom keys are then in the same
      // order as the links payload, so the server can map placeholder ids → real
      // ids by position and the arrangement round-trips exactly.
      const resolved = resolveItemOrder(order, links.map((l) => l.id))
      const linkById = new Map(links.map((l) => [l.id, l]))
      const savedLinks = resolved
        .filter((k) => k.startsWith('custom:'))
        .map((k) => linkById.get(k.slice('custom:'.length)))
        .filter((l): l is EditLink => !!l && l.label.trim() !== '' && l.url.trim() !== '')
      const savedIds = new Set(savedLinks.map((l) => l.id))
      const itemOrder = resolved.filter(
        (k) => !k.startsWith('custom:') || savedIds.has(k.slice('custom:'.length)),
      )
      // Send styles only for surviving buttons (built-ins + saved customs). The
      // custom keys still carry the CURRENT link ids, in the same order as the
      // links payload, so the server reconciles them to the new ids on save.
      const buttonStyles: Record<string, ButtonStyle> = {}
      for (const [k, v] of Object.entries(styles)) {
        if (!k.startsWith('custom:') || savedIds.has(k.slice('custom:'.length))) buttonStyles[k] = v
      }

      const res = await fetch('/api/trainer/link-page', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headline: headline.trim() || null,
          bio: bio.trim() || null,
          showBooking,
          showWebsite,
          showContact,
          instagram: instagram.trim() || null,
          facebook: facebook.trim() || null,
          tiktok: tiktok.trim() || null,
          socialsLabel: socialsLabel.trim() || null,
          font,
          backgroundUrl: backgroundUrl || null,
          links: savedLinks.map((l) => ({ label: l.label.trim(), url: l.url.trim() })),
          itemOrder,
          buttonStyles,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(typeof body.error === 'string' ? body.error : 'Could not save. Please try again.')
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setError('Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function copyUrl() {
    if (!publicUrl) return
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked — user can still select the text */
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[1fr_360px]">
      {/* ── Editor column ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-6">
        {/* Public URL */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Your public link</h2>
          <p className="mt-0.5 text-xs text-slate-500">Pop this in your Instagram bio.</p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 truncate rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
              {publicUrl ?? 'Set a business name to generate your link'}
            </code>
            <Button type="button" variant="secondary" size="sm" onClick={copyUrl} disabled={!publicUrl}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            {publicUrl && (
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <ExternalLink className="h-4 w-4" />
                Open
              </a>
            )}
          </div>
        </section>

        {/* Header text */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Header</h2>
          <div className="flex flex-col gap-4">
            <Input
              label="Headline"
              value={headline}
              maxLength={80}
              placeholder="Positive, force-free dog training"
              onChange={(e) => {
                setHeadline(e.target.value)
                setSaved(false)
              }}
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="bio" className="text-sm font-medium text-slate-700">Bio</label>
              <textarea
                id="bio"
                value={bio}
                maxLength={300}
                rows={3}
                placeholder="A friendly line about what you do."
                onChange={(e) => {
                  setBio(e.target.value)
                  setSaved(false)
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </section>

        {/* Appearance — background + font */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Appearance</h2>

          {/* Background image */}
          <div className="flex items-center gap-3">
            <div
              className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 bg-cover bg-center"
              style={backgroundUrl ? { backgroundImage: `url(${backgroundUrl})` } : undefined}
            >
              {!backgroundUrl && (
                <div className="flex h-full w-full items-center justify-center">
                  <ImagePlus className="h-5 w-5 text-slate-400" />
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-slate-900">Background image</p>
              <div className="flex items-center gap-3">
                <Button type="button" variant="ghost" size="sm" onClick={() => bgInputRef.current?.click()} disabled={uploadingBg}>
                  {uploadingBg ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Uploading…</> : backgroundUrl ? 'Replace' : 'Upload'}
                </Button>
                {backgroundUrl && (
                  <button
                    type="button"
                    onClick={() => { setBackgroundUrl(null); setSaved(false) }}
                    className="text-xs text-slate-400 hover:text-rose-600"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
            <input
              ref={bgInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) uploadBackground(f)
                e.target.value = ''
              }}
            />
          </div>

          {/* Font picker */}
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium text-slate-900">Font</p>
            <div className="flex flex-wrap gap-2">
              {LINK_PAGE_FONTS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => { setFont(f.id); setSaved(false) }}
                  style={{ fontFamily: linkPageFontStack(f.id) }}
                  className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                    font === f.id
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Buttons & links — one reorderable stack (built-ins + custom links) */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Buttons &amp; links</h2>
              <p className="text-xs text-slate-500">Drag to reorder. Toggle the built-in buttons on or off.</p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={addLink} disabled={links.length >= 20}>
              <Plus className="h-4 w-4" />
              Add link
            </Button>
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={resolvedOrder} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-2">
                {resolvedOrder.map((key) => {
                  const styleProps = {
                    accent: brand.accent,
                    buttonStyle: styles[key],
                    styleUploading: uploadingStyleKey === key,
                    onStyleChange: (patch: Partial<ButtonStyle>) => updateStyle(key, patch),
                    onStyleUpload: (file: File) => uploadButtonImage(key, file),
                  }
                  if (key === 'book') {
                    return (
                      <SortableBuiltinRow
                        key="book"
                        sortableId="book"
                        label="Book a session"
                        hint="Links to your booking page"
                        checked={showBooking}
                        onChange={(v) => { setShowBooking(v); setSaved(false) }}
                        {...styleProps}
                      />
                    )
                  }
                  if (key === 'website') {
                    return (
                      <SortableBuiltinRow
                        key="website"
                        sortableId="website"
                        label="Website"
                        hint={brand.website ? brand.website : 'Add a website in Settings to use this'}
                        checked={showWebsite}
                        onChange={(v) => { setShowWebsite(v); setSaved(false) }}
                        disabled={!brand.website}
                        {...styleProps}
                      />
                    )
                  }
                  if (key === 'contact') {
                    return (
                      <SortableBuiltinRow
                        key="contact"
                        sortableId="contact"
                        label="Contact"
                        hint="Email and, if shared, call buttons"
                        checked={showContact}
                        onChange={(v) => { setShowContact(v); setSaved(false) }}
                        {...styleProps}
                      />
                    )
                  }
                  const id = key.slice('custom:'.length)
                  const link = links.find((l) => l.id === id)
                  if (!link) return null
                  return (
                    <SortableLinkRow
                      key={key}
                      sortableId={key}
                      link={link}
                      onChange={(patch) => updateLink(link.id, patch)}
                      onRemove={() => removeLink(link.id)}
                      {...styleProps}
                    />
                  )
                })}
              </div>
            </SortableContext>
          </DndContext>
        </section>

        {/* Socials — kept at the bottom of the form */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Social links</h2>
          <p className="mb-3 text-xs text-slate-500">Handle or full URL — we&rsquo;ll link it up.</p>
          <div className="flex flex-col gap-4">
            <Input label="Instagram" value={instagram} placeholder="@yourhandle" onChange={(e) => { setInstagram(e.target.value); setSaved(false) }} />
            <Input label="Facebook" value={facebook} placeholder="yourpage" onChange={(e) => { setFacebook(e.target.value); setSaved(false) }} />
            <Input label="TikTok" value={tiktok} placeholder="@yourhandle" onChange={(e) => { setTiktok(e.target.value); setSaved(false) }} />
            <Input
              label="Section heading"
              value={socialsLabel}
              maxLength={40}
              placeholder="Connect with us"
              onChange={(e) => { setSocialsLabel(e.target.value); setSaved(false) }}
            />
          </div>
        </section>

        <div className="flex items-center gap-3">
          <Button type="button" onClick={save} loading={saving}>Save</Button>
          {saved && <span className="text-sm font-medium text-emerald-600">Saved</span>}
          {error && <span className="text-sm text-rose-600">{error}</span>}
        </div>
      </div>

      {/* ── Live preview ──────────────────────────────────────────────── */}
      <div className="lg:sticky lg:top-6 lg:self-start">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Preview</p>
        <div className="overflow-hidden rounded-[2rem] border-4 border-slate-900 bg-slate-50 shadow-lg">
          <LinkPageView
            businessName={brand.businessName || 'Your business'}
            avatarUrl={brand.avatarUrl}
            headline={headline || null}
            bio={bio || null}
            buttons={previewButtons}
            socials={previewSocials}
            socialsLabel={socialsLabel || null}
            backgroundUrl={backgroundUrl}
            font={font}
            accent={brand.accent}
            interactive={false}
          />
        </div>
      </div>
    </div>
  )
}

// Props shared by every sortable row for the per-button style panel.
interface StyleRowProps {
  accent: string
  buttonStyle?: ButtonStyle
  styleUploading: boolean
  onStyleChange: (patch: Partial<ButtonStyle>) => void
  onStyleUpload: (file: File) => void
}

// A small paintbrush toggle that opens/closes a row's style panel. Shows a filled
// state when the button already carries any override.
function CustomiseToggle({ open, active, onClick }: { open: boolean; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Customise this button"
      aria-expanded={open}
      style={{ minHeight: 0 }}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors ${
        open || active
          ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
      }`}
    >
      <Palette className="h-4 w-4" />
    </button>
  )
}

// A built-in button row (Book / Website / Contact) inside the sortable stack:
// drag handle + label/hint + a Customise toggle + the canonical on/off switch.
function SortableBuiltinRow({
  sortableId,
  label,
  hint,
  checked,
  onChange,
  accent,
  disabled,
  buttonStyle,
  styleUploading,
  onStyleChange,
  onStyleUpload,
}: {
  sortableId: string
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
} & StyleRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sortableId })
  const [open, setOpen] = useState(false)
  const style = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  const hasStyle = !!buttonStyle && Object.keys(buttonStyle).length > 0

  return (
    <div ref={setNodeRef} style={style} className="rounded-xl border border-slate-200 bg-white p-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          className="cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1 py-1">
          <p className="text-sm font-medium text-slate-900">{label}</p>
          {hint && <p className="truncate text-xs text-slate-500">{hint}</p>}
        </div>
        <CustomiseToggle open={open} active={hasStyle} onClick={() => setOpen((o) => !o)} />
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          disabled={disabled}
          onClick={() => onChange(!checked)}
          // minHeight inline: the app's global `button { min-height:44px }` is
          // unlayered, so it beats Tailwind's layered min-h-* by cascade layer.
          style={{ minHeight: 0, ...(checked && !disabled ? { background: accent } : {}) }}
          className={`flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors disabled:opacity-40 ${checked && !disabled ? 'justify-end' : 'justify-start bg-slate-300'}`}
        >
          <span className="block h-5 w-5 rounded-full bg-white shadow" />
        </button>
      </div>
      {open && (
        <ButtonStylePanel
          buttonStyle={buttonStyle}
          accent={accent}
          uploading={styleUploading}
          onChange={onStyleChange}
          onUpload={onStyleUpload}
        />
      )}
    </div>
  )
}

function SortableLinkRow({
  sortableId,
  link,
  onChange,
  onRemove,
  accent,
  buttonStyle,
  styleUploading,
  onStyleChange,
  onStyleUpload,
}: {
  sortableId: string
  link: EditLink
  onChange: (patch: Partial<EditLink>) => void
  onRemove: () => void
} & StyleRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sortableId })
  const [open, setOpen] = useState(false)
  const style = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  const hasStyle = !!buttonStyle && Object.keys(buttonStyle).length > 0

  return (
    <div ref={setNodeRef} style={style} className="rounded-xl border border-slate-200 bg-white p-2">
      <div className="flex items-start gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          className="mt-3 cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="flex flex-1 flex-col gap-2">
          <Input
            value={link.label}
            maxLength={60}
            placeholder="Button label (e.g. Free puppy guide)"
            onChange={(e) => onChange({ label: e.target.value })}
          />
          <Input
            value={link.url}
            maxLength={500}
            placeholder="https://…"
            inputMode="url"
            onChange={(e) => onChange({ url: e.target.value })}
          />
        </div>
        <div className="mt-1 flex flex-col items-center gap-1">
          <CustomiseToggle open={open} active={hasStyle} onClick={() => setOpen((o) => !o)} />
          <button
            type="button"
            onClick={onRemove}
            aria-label="Delete link"
            style={{ minHeight: 0 }}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      {open && (
        <ButtonStylePanel
          buttonStyle={buttonStyle}
          accent={accent}
          uploading={styleUploading}
          onChange={onStyleChange}
          onUpload={onStyleUpload}
        />
      )}
    </div>
  )
}

// The inline style editor shown when a row's Customise toggle is open: image
// upload + preview + remove, background/text colour pickers (each clearable to
// the page default), and a font picker (clearable to "inherit page font").
function ButtonStylePanel({
  buttonStyle,
  accent,
  uploading,
  onChange,
  onUpload,
}: {
  buttonStyle?: ButtonStyle
  accent: string
  uploading: boolean
  onChange: (patch: Partial<ButtonStyle>) => void
  onUpload: (file: File) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const s = buttonStyle ?? {}

  return (
    <div className="mt-2 flex flex-col gap-3 rounded-lg border border-slate-100 bg-slate-50/70 p-3">
      {/* Image + colours on one row */}
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <div className="flex items-center gap-2">
          <div
            className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white bg-cover bg-center"
            style={s.imageUrl ? { backgroundImage: `url(${s.imageUrl})` } : undefined}
          >
            {!s.imageUrl && (
              <div className="flex h-full w-full items-center justify-center">
                <ImagePlus className="h-4 w-4 text-slate-400" />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? (
                <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Uploading…</>
              ) : s.imageUrl ? 'Replace image' : 'Add image'}
            </Button>
            {s.imageUrl && (
              <button
                type="button"
                onClick={() => onChange({ imageUrl: undefined })}
                className="text-xs text-slate-400 hover:text-rose-600"
              >
                Remove
              </button>
            )}
          </div>
        </div>
        <ColorField label="Background" value={s.bgColor} fallback={accent} onChange={(v) => onChange({ bgColor: v })} />
        <ColorField label="Text" value={s.textColor} fallback="#ffffff" onChange={(v) => onChange({ textColor: v })} />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onUpload(f)
            e.target.value = ''
          }}
        />
      </div>

    </div>
  )
}

// A colour swatch input that clears back to the page default. `type=color` can't
// display "unset", so when nothing is set we show the page fallback in the swatch
// (a neutral if the fallback is a CSS var) and label the state "Default".
function ColorField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string
  value?: string
  fallback: string
  onChange: (v: string | undefined) => void
}) {
  const swatch = value ?? (/^#[0-9a-fA-F]{3,6}$/.test(fallback) ? fallback : '#3b82f6')
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-slate-700">{label}</p>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={swatch}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} colour`}
          style={{ minHeight: 0 }}
          className="h-8 w-10 cursor-pointer rounded border border-slate-200 bg-white p-0.5"
        />
        {value ? (
          <button type="button" onClick={() => onChange(undefined)} className="text-xs text-slate-400 hover:text-slate-700">
            Default
          </button>
        ) : (
          <span className="text-xs text-slate-400">Default</span>
        )}
      </div>
    </div>
  )
}
