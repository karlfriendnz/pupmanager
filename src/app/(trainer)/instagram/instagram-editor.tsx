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
import { GripVertical, Plus, Trash2, Copy, Check, ExternalLink, ImagePlus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { buildLinkButtons, buildSocialLinks, LINK_PAGE_FONTS, linkPageFontStack } from '@/lib/link-page'
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
}

// Stable-ish local id for a freshly-added row (dnd keys need to be stable).
let tempSeq = 0
const nextTempId = () => `new-${tempSeq++}`

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

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [uploadingBg, setUploadingBg] = useState(false)
  const bgInputRef = useRef<HTMLInputElement>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setLinks((prev) => {
      const oldIndex = prev.findIndex((l) => l.id === active.id)
      const newIndex = prev.findIndex((l) => l.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return prev
      return arrayMove(prev, oldIndex, newIndex)
    })
    setSaved(false)
  }

  function updateLink(id: string, patch: Partial<EditLink>) {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
    setSaved(false)
  }
  function addLink() {
    setLinks((prev) => [...prev, { id: nextTempId(), label: '', url: '' }])
    setSaved(false)
  }
  function removeLink(id: string) {
    setLinks((prev) => prev.filter((l) => l.id !== id))
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
          links: links.map((l) => ({ label: l.label, url: l.url })),
        },
        {
          slug: brand.slug,
          website: brand.website,
          publicEmail: brand.publicEmail,
          phone: brand.phone,
          showPhoneToClients: brand.showPhoneToClients,
        },
      ),
    [headline, bio, showBooking, showWebsite, showContact, instagram, facebook, tiktok, links, brand],
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
          // Send only rows that actually have a label + url; keep display order.
          links: links
            .filter((l) => l.label.trim() && l.url.trim())
            .map((l) => ({ label: l.label.trim(), url: l.url.trim() })),
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

        {/* Built-in buttons */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-900">Buttons</h2>
          <p className="mb-3 text-xs text-slate-500">Toggle the built-in buttons on or off.</p>
          <div className="flex flex-col divide-y divide-slate-100">
            <Toggle label="Book a session" hint="Links to your booking page" checked={showBooking} onChange={setShowBooking} accent={brand.accent} />
            <Toggle label="Website" hint={brand.website ? brand.website : 'Add a website in Settings to use this'} checked={showWebsite} onChange={setShowWebsite} accent={brand.accent} disabled={!brand.website} />
            <Toggle label="Contact" hint="Email and, if shared, call buttons" checked={showContact} onChange={setShowContact} accent={brand.accent} />
          </div>
        </section>

        {/* Socials */}
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

        {/* Custom links */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Custom links</h2>
              <p className="text-xs text-slate-500">Drag to reorder.</p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={addLink} disabled={links.length >= 20}>
              <Plus className="h-4 w-4" />
              Add link
            </Button>
          </div>

          {links.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
              No custom links yet.
            </p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={links.map((l) => l.id)} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-2">
                  {links.map((l) => (
                    <SortableLinkRow
                      key={l.id}
                      link={l}
                      showHandle={links.length > 1}
                      onChange={(patch) => updateLink(l.id, patch)}
                      onRemove={() => removeLink(l.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
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

function Toggle({
  label,
  hint,
  checked,
  onChange,
  accent,
  disabled,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
  accent: string
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900">{label}</p>
        {hint && <p className="truncate text-xs text-slate-500">{hint}</p>}
      </div>
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
  )
}

function SortableLinkRow({
  link,
  showHandle,
  onChange,
  onRemove,
}: {
  link: EditLink
  showHandle: boolean
  onChange: (patch: Partial<EditLink>) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: link.id })
  const style = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-2">
      {showHandle && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          className="mt-3 cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
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
      <button
        type="button"
        onClick={onRemove}
        aria-label="Delete link"
        className="mt-2 rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}
