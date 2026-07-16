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
import {
  GripVertical,
  Plus,
  Trash2,
  Copy,
  Check,
  ExternalLink,
  ImagePlus,
  Loader2,
  Palette,
  Pencil,
  X,
  Calendar,
  Gift,
  MessageSquare,
  LogIn,
  Globe,
  Mail,
  Phone,
  Link2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  buildLinkButtons,
  buildSocialLinks,
  LINK_PAGE_FONTS,
  linkPageFontStack,
  safeExternalUrl,
  type ButtonStyle,
  type LinkButtonType,
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

// The lists the "Add link" modal offers as targets.
interface Pickers {
  bookingPages: { slug: string; name: string }[]
  leadMagnets: { slug: string; title: string }[]
  embedForms: { id: string; title: string }[]
}

// One editable smart-link row. `url` is only meaningful for CUSTOM; `targetId`
// carries the booking-page slug / lead-magnet slug / embed-form id; the style
// fields are the per-button overrides.
interface EditButton {
  id: string
  type: LinkButtonType
  label: string
  url: string
  targetId: string | null
  imageUrl?: string
  bgColor?: string
  textColor?: string
}

interface Initial {
  headline: string | null
  bio: string | null
  instagram: string | null
  facebook: string | null
  tiktok: string | null
  socialsLabel: string | null
  font: string | null
  backgroundUrl: string | null
  buttons: {
    id: string
    type: LinkButtonType
    label: string
    url: string | null
    targetId: string | null
    imageUrl: string | null
    bgColor: string | null
    textColor: string | null
  }[]
}

// Stable-ish local id for a freshly-added row (dnd keys need to be stable).
let tempSeq = 0
const nextTempId = () => `new-${tempSeq++}`

// ── Per-type metadata: chip icon, display name, and default label ────────────
const TYPE_META: Record<LinkButtonType, { name: string; Icon: typeof Calendar; defaultLabel: string }> = {
  BOOKING: { name: 'Booking page', Icon: Calendar, defaultLabel: 'Book a session' },
  LEADMAGNET: { name: 'Lead magnet', Icon: Gift, defaultLabel: 'Free download' },
  FORM: { name: 'Get-in-touch form', Icon: MessageSquare, defaultLabel: 'Get in touch' },
  SIGNIN: { name: 'Client sign-in', Icon: LogIn, defaultLabel: 'Client login' },
  WEBSITE: { name: 'Website', Icon: Globe, defaultLabel: 'Visit our website' },
  EMAIL: { name: 'Email', Icon: Mail, defaultLabel: 'Email us' },
  CALL: { name: 'Call', Icon: Phone, defaultLabel: 'Call us' },
  CUSTOM: { name: 'Custom link', Icon: Link2, defaultLabel: '' },
}

// The order types are offered in the picker.
const TYPE_ORDER: LinkButtonType[] = ['BOOKING', 'LEADMAGNET', 'FORM', 'SIGNIN', 'WEBSITE', 'EMAIL', 'CALL', 'CUSTOM']

// Convert a stored ButtonStyle-ish set of row fields into a ButtonStyle object.
function rowStyle(b: EditButton): ButtonStyle | undefined {
  const out: ButtonStyle = {}
  if (b.imageUrl) out.imageUrl = b.imageUrl
  if (b.bgColor) out.bgColor = b.bgColor
  if (b.textColor) out.textColor = b.textColor
  return Object.keys(out).length > 0 ? out : undefined
}

export function InstagramEditor({
  publicUrl,
  brand,
  pickers,
  initial,
}: {
  publicUrl: string | null
  brand: Brand
  pickers: Pickers
  initial: Initial
}) {
  const [headline, setHeadline] = useState(initial.headline ?? '')
  const [bio, setBio] = useState(initial.bio ?? '')
  const [instagram, setInstagram] = useState(initial.instagram ?? '')
  const [facebook, setFacebook] = useState(initial.facebook ?? '')
  const [tiktok, setTiktok] = useState(initial.tiktok ?? '')
  const [socialsLabel, setSocialsLabel] = useState(initial.socialsLabel ?? '')
  const [font, setFont] = useState(initial.font ?? 'default')
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(initial.backgroundUrl)
  const [buttons, setButtons] = useState<EditButton[]>(() =>
    initial.buttons.map((b) => ({
      id: b.id,
      type: b.type,
      label: b.label,
      url: b.url ?? '',
      targetId: b.targetId,
      imageUrl: b.imageUrl ?? undefined,
      bgColor: b.bgColor ?? undefined,
      textColor: b.textColor ?? undefined,
    })),
  )

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [uploadingBg, setUploadingBg] = useState(false)
  const [uploadingStyleId, setUploadingStyleId] = useState<string | null>(null)
  const bgInputRef = useRef<HTMLInputElement>(null)

  // Modal state: which row is being added/edited.
  const [modalOpen, setModalOpen] = useState(false)

  function markDirty() {
    setSaved(false)
  }

  // Which types can be added right now (missing profile fields / no lead magnets
  // are offered but disabled, with a hint).
  function typeDisabledReason(type: LinkButtonType): string | null {
    switch (type) {
      case 'WEBSITE':
        return brand.website ? null : 'Add a website in Settings first'
      case 'EMAIL':
        return brand.publicEmail ? null : 'Add a public email in Settings first'
      case 'CALL':
        return brand.showPhoneToClients && brand.phone ? null : 'Share your phone with clients in Settings first'
      case 'LEADMAGNET':
        return pickers.leadMagnets.length > 0 ? null : 'Create a lead magnet first'
      case 'FORM':
        return pickers.embedForms.length > 0 ? null : 'Create a get-in-touch form first'
      default:
        return null
    }
  }

  // Update one row by id.
  function updateButton(id: string, patch: Partial<EditButton>) {
    setButtons((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)))
    markDirty()
  }
  function removeButton(id: string) {
    setButtons((prev) => prev.filter((b) => b.id !== id))
    markDirty()
  }

  // Merge a style patch into a row; empty values clear the field.
  function updateStyle(id: string, patch: Partial<ButtonStyle>) {
    setButtons((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b
        const next = { ...b }
        for (const [field, value] of Object.entries(patch) as [keyof ButtonStyle, string | undefined][]) {
          if (value === undefined || value === '') next[field] = undefined
          else next[field] = value
        }
        return next
      }),
    )
    markDirty()
  }

  async function uploadButtonImage(id: string, file: File) {
    setError(null)
    setUploadingStyleId(id)
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
      updateStyle(id, { imageUrl: body.url })
    } catch {
      setError('Upload failed. Please try again.')
    } finally {
      setUploadingStyleId(null)
    }
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setButtons((prev) => {
      const oldIndex = prev.findIndex((b) => b.id === active.id)
      const newIndex = prev.findIndex((b) => b.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return prev
      return arrayMove(prev, oldIndex, newIndex)
    })
    markDirty()
  }

  // ── Modal: add a new row, or edit an existing one ──────────────────────────
  const [draft, setDraft] = useState<EditButton | null>(null)
  const [modalStep, setModalStep] = useState<'type' | 'props'>('type')

  function openAdd() {
    setDraft(null)
    setModalStep('type')
    setModalOpen(true)
  }
  function openEdit(b: EditButton) {
    setDraft({ ...b })
    setModalStep('props')
    setModalOpen(true)
  }
  function closeModal() {
    setModalOpen(false)
    setDraft(null)
  }

  // Build a fresh draft for a chosen type, with sensible defaults.
  function chooseType(type: LinkButtonType) {
    const meta = TYPE_META[type]
    let targetId: string | null = null
    let label = meta.defaultLabel
    if (type === 'LEADMAGNET' && pickers.leadMagnets[0]) {
      targetId = pickers.leadMagnets[0].slug
      label = pickers.leadMagnets[0].title
    } else if (type === 'FORM' && pickers.embedForms[0]) {
      targetId = pickers.embedForms[0].id
    }
    setDraft({ id: nextTempId(), type, label, url: '', targetId })
    setModalStep('props')
  }

  function confirmModal() {
    if (!draft) return
    const label = draft.label.trim()
    if (!label) return
    if (draft.type === 'CUSTOM' && safeExternalUrl(draft.url) === null) return
    setButtons((prev) => {
      const exists = prev.some((b) => b.id === draft.id)
      const row: EditButton = { ...draft, label }
      return exists ? prev.map((b) => (b.id === draft.id ? row : b)) : [...prev, row]
    })
    markDirty()
    closeModal()
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
      markDirty()
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
          instagram: instagram || null,
          facebook: facebook || null,
          tiktok: tiktok || null,
          links: buttons.map((b) => ({
            id: b.id,
            type: b.type,
            label: b.label,
            url: b.url,
            targetId: b.targetId,
            imageUrl: b.imageUrl,
            bgColor: b.bgColor,
            textColor: b.textColor,
          })),
        },
        {
          slug: brand.slug,
          website: brand.website,
          publicEmail: brand.publicEmail,
          phone: brand.phone,
          showPhoneToClients: brand.showPhoneToClients,
        },
      ),
    [headline, bio, instagram, facebook, tiktok, buttons, brand],
  )

  const previewSocials = useMemo(
    () => buildSocialLinks({ instagram: instagram || null, facebook: facebook || null, tiktok: tiktok || null }),
    [instagram, facebook, tiktok],
  )

  async function save() {
    setSaving(true)
    setError(null)
    try {
      // Keep only complete rows: a label, and (for CUSTOM) a valid url.
      const payloadButtons = buttons
        .filter((b) => b.label.trim() !== '' && (b.type !== 'CUSTOM' || safeExternalUrl(b.url) !== null))
        .map((b) => ({
          type: b.type,
          label: b.label.trim(),
          url: b.type === 'CUSTOM' ? b.url.trim() : undefined,
          targetId: b.targetId ?? undefined,
          imageUrl: b.imageUrl || undefined,
          bgColor: b.bgColor || undefined,
          textColor: b.textColor || undefined,
        }))

      const res = await fetch('/api/trainer/link-page', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headline: headline.trim() || null,
          bio: bio.trim() || null,
          instagram: instagram.trim() || null,
          facebook: facebook.trim() || null,
          tiktok: tiktok.trim() || null,
          socialsLabel: socialsLabel.trim() || null,
          font,
          backgroundUrl: backgroundUrl || null,
          buttons: payloadButtons,
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
                markDirty()
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
                  markDirty()
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
                    onClick={() => { setBackgroundUrl(null); markDirty() }}
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
                  onClick={() => { setFont(f.id); markDirty() }}
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

        {/* Buttons & links — one reorderable stack of smart links */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Buttons &amp; links</h2>
              <p className="text-xs text-slate-500">Drag to reorder. Tap a row to edit, or the paintbrush to style it.</p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={openAdd} disabled={buttons.length >= 30}>
              <Plus className="h-4 w-4" />
              Add link
            </Button>
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={buttons.map((b) => b.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-2">
                {buttons.map((b) => (
                  <SortableButtonRow
                    key={b.id}
                    button={b}
                    subtitle={rowSubtitle(b, brand, pickers)}
                    accent={brand.accent}
                    styleUploading={uploadingStyleId === b.id}
                    onEdit={() => openEdit(b)}
                    onRemove={() => removeButton(b.id)}
                    onStyleChange={(patch) => updateStyle(b.id, patch)}
                    onStyleUpload={(file) => uploadButtonImage(b.id, file)}
                  />
                ))}
                {buttons.length === 0 && (
                  <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
                    No buttons yet — add your first link.
                  </p>
                )}
              </div>
            </SortableContext>
          </DndContext>
        </section>

        {/* Socials — kept at the bottom of the form */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Social links</h2>
          <p className="mb-3 text-xs text-slate-500">Handle or full URL — we&rsquo;ll link it up.</p>
          <div className="flex flex-col gap-4">
            <Input
              label="Section heading"
              value={socialsLabel}
              maxLength={40}
              placeholder="Connect with us"
              onChange={(e) => { setSocialsLabel(e.target.value); markDirty() }}
            />
            <Input label="Instagram" value={instagram} placeholder="@yourhandle" onChange={(e) => { setInstagram(e.target.value); markDirty() }} />
            <Input label="Facebook" value={facebook} placeholder="yourpage" onChange={(e) => { setFacebook(e.target.value); markDirty() }} />
            <Input label="TikTok" value={tiktok} placeholder="@yourhandle" onChange={(e) => { setTiktok(e.target.value); markDirty() }} />
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

      {/* ── Add / edit modal ──────────────────────────────────────────── */}
      {modalOpen && (
        <AddLinkModal
          brand={brand}
          pickers={pickers}
          step={modalStep}
          draft={draft}
          typeDisabledReason={typeDisabledReason}
          onChooseType={chooseType}
          onBack={() => setModalStep('type')}
          onDraftChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
          onConfirm={confirmModal}
          onClose={closeModal}
        />
      )}
    </div>
  )
}

// A one-line subtitle for a row: its type name + resolved target where useful.
function rowSubtitle(b: EditButton, brand: Brand, pickers: Pickers): string {
  const name = TYPE_META[b.type].name
  switch (b.type) {
    case 'BOOKING': {
      const page = b.targetId ? pickers.bookingPages.find((p) => p.slug === b.targetId) : null
      return page ? `${name} · ${page.name}` : `${name} · booking home`
    }
    case 'LEADMAGNET': {
      const m = pickers.leadMagnets.find((x) => x.slug === b.targetId)
      return m ? `${name} · ${m.title}` : name
    }
    case 'FORM': {
      const f = pickers.embedForms.find((x) => x.id === b.targetId)
      return f ? `${name} · ${f.title}` : name
    }
    case 'CUSTOM':
      return b.url || name
    case 'WEBSITE':
      return brand.website || name
    case 'EMAIL':
      return brand.publicEmail || name
    default:
      return name
  }
}

// ── A single sortable row: drag handle + type chip/label + customise + edit + delete ──
function SortableButtonRow({
  button,
  subtitle,
  accent,
  styleUploading,
  onEdit,
  onRemove,
  onStyleChange,
  onStyleUpload,
}: {
  button: EditButton
  subtitle: string
  accent: string
  styleUploading: boolean
  onEdit: () => void
  onRemove: () => void
  onStyleChange: (patch: Partial<ButtonStyle>) => void
  onStyleUpload: (file: File) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: button.id })
  const [open, setOpen] = useState(false)
  const style = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  const bStyle = rowStyle(button)
  const hasStyle = !!bStyle
  const Icon = TYPE_META[button.type].Icon

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
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 py-1">
          <p className="truncate text-sm font-medium text-slate-900">{button.label || 'Untitled'}</p>
          <p className="truncate text-xs text-slate-500">{subtitle}</p>
        </div>
        <CustomiseToggle open={open} active={hasStyle} onClick={() => setOpen((o) => !o)} />
        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit link"
          style={{ minHeight: 0 }}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
        >
          <Pencil className="h-4 w-4" />
        </button>
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
      {open && (
        <ButtonStylePanel
          buttonStyle={bStyle}
          accent={accent}
          uploading={styleUploading}
          onChange={onStyleChange}
          onUpload={onStyleUpload}
        />
      )}
    </div>
  )
}

// A small paintbrush toggle that opens/closes a row's style panel.
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

// ── The "Add link" modal: pick a type (step 1), then set its properties (step 2). ──
function AddLinkModal({
  brand,
  pickers,
  step,
  draft,
  typeDisabledReason,
  onChooseType,
  onBack,
  onDraftChange,
  onConfirm,
  onClose,
}: {
  brand: Brand
  pickers: Pickers
  step: 'type' | 'props'
  draft: EditButton | null
  typeDisabledReason: (t: LinkButtonType) => string | null
  onChooseType: (t: LinkButtonType) => void
  onBack: () => void
  onDraftChange: (patch: Partial<EditButton>) => void
  onConfirm: () => void
  onClose: () => void
}) {
  const isEditing = step === 'props' && draft !== null
  const confirmDisabled =
    !draft ||
    draft.label.trim() === '' ||
    (draft.type === 'CUSTOM' && safeExternalUrl(draft.url) === null) ||
    (draft.type === 'LEADMAGNET' && !draft.targetId) ||
    (draft.type === 'FORM' && !draft.targetId)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">
            {step === 'type' ? 'Add a link' : `${TYPE_META[draft!.type].name}`}
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ minHeight: 0 }} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === 'type' ? (
          <div className="grid grid-cols-2 gap-2">
            {TYPE_ORDER.map((type) => {
              const meta = TYPE_META[type]
              const disabled = typeDisabledReason(type) !== null
              const reason = typeDisabledReason(type)
              const Icon = meta.Icon
              return (
                <button
                  key={type}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChooseType(type)}
                  style={{ minHeight: 0 }}
                  className={`flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-colors ${
                    disabled
                      ? 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-sm font-medium">{meta.name}</span>
                  {disabled && reason && <span className="text-[11px] leading-tight text-slate-400">{reason}</span>}
                </button>
              )
            })}
          </div>
        ) : (
          draft && (
            <div className="flex flex-col gap-4">
              {/* Type-specific target selectors */}
              {draft.type === 'BOOKING' && (
                <SelectField
                  label="Booking page"
                  value={draft.targetId ?? ''}
                  onChange={(v) => onDraftChange({ targetId: v === '' ? null : v })}
                  options={[
                    { value: '', label: 'All bookings (booking home)' },
                    ...pickers.bookingPages.map((p) => ({ value: p.slug, label: p.name })),
                  ]}
                />
              )}
              {draft.type === 'LEADMAGNET' && (
                <SelectField
                  label="Lead magnet"
                  value={draft.targetId ?? ''}
                  onChange={(v) => onDraftChange({ targetId: v === '' ? null : v })}
                  options={pickers.leadMagnets.map((m) => ({ value: m.slug, label: m.title }))}
                />
              )}
              {draft.type === 'FORM' && (
                <SelectField
                  label="Form"
                  value={draft.targetId ?? ''}
                  onChange={(v) => onDraftChange({ targetId: v === '' ? null : v })}
                  options={pickers.embedForms.map((f) => ({ value: f.id, label: f.title }))}
                />
              )}

              <Input
                label="Button label"
                value={draft.label}
                maxLength={60}
                placeholder="Button label"
                onChange={(e) => onDraftChange({ label: e.target.value })}
              />

              {draft.type === 'CUSTOM' && (
                <Input
                  label="URL"
                  value={draft.url}
                  maxLength={500}
                  placeholder="https://…"
                  inputMode="url"
                  onChange={(e) => onDraftChange({ url: e.target.value })}
                />
              )}

              {draft.type === 'WEBSITE' && (
                <p className="text-xs text-slate-500">Links to your website: {brand.website}</p>
              )}
              {draft.type === 'EMAIL' && (
                <p className="text-xs text-slate-500">Opens an email to {brand.publicEmail}</p>
              )}
              {draft.type === 'CALL' && (
                <p className="text-xs text-slate-500">Calls {brand.phone}</p>
              )}
              {draft.type === 'SIGNIN' && (
                <p className="text-xs text-slate-500">Sends clients to your branded login page.</p>
              )}

              <div className="mt-1 flex items-center justify-between">
                {!isEditing ? (
                  <button type="button" onClick={onBack} className="text-sm font-medium text-slate-500 hover:text-slate-900">
                    ← Change type
                  </button>
                ) : (
                  <span />
                )}
                <Button type="button" onClick={onConfirm} disabled={confirmDisabled}>
                  {isEditing ? 'Save' : 'Add'}
                </Button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  )
}

// A simple labelled native select.
function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {options.length === 0 && <option value="">None available</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

// The inline style editor shown when a row's Customise toggle is open: image
// upload + preview + remove, and background/text colour pickers (each clearable
// to the page default).
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

// A colour swatch input that clears back to the page default.
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
