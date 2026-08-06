'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { RichTextEditor } from '@/components/shared/rich-text-editor'
import { AchievementBadge } from '@/components/shared/achievement-badge'
import { SectionLabel } from '@/components/shared/flat-list'
import { isRichTextEmpty, richTextToPlain } from '@/lib/rich-text'
import { compressImageFile } from '@/lib/compress-image'
import { readApiError } from '@/lib/api-error'
import { cn } from '@/lib/utils'
import { Check, ImagePlus, Loader2, Trash2, X } from 'lucide-react'
import { EditScreen } from '@/components/shared/edit-screen'
import { ConfirmSheet } from '@/components/shared/confirm-sheet'
import {
  COLORS, COLOR_BY_KEY, COMMON_ICONS, DEFAULT_COLOR, TRIGGERS, TRIGGER_GROUPS, TRIGGER_META,
  type AchievementRecord, type Color, type TriggerType,
} from './triggers'

export const EMPTY_ACHIEVEMENT: AchievementRecord = {
  id: '',
  name: '',
  description: null,
  icon: '🏆',
  imageUrl: null,
  color: DEFAULT_COLOR,
  published: true,
  triggerType: 'MANUAL',
  triggerValue: null,
}

/**
 * The whole achievement form, as a page — matching the product editor so the
 * two feel like one app. It used to be a modal that scrolled inside a page
 * that also scrolled.
 */
export function AchievementForm({ initial, isNew }: { initial: AchievementRecord; isNew: boolean }) {
  const router = useRouter()

  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description ?? '')
  const [icon, setIcon] = useState(initial.icon ?? '🏆')
  const [imageUrl, setImageUrl] = useState<string | null>(initial.imageUrl)
  const [color, setColor] = useState<Color>(
    initial.color && (initial.color as Color) in COLOR_BY_KEY ? (initial.color as Color) : DEFAULT_COLOR
  )
  const [published, setPublished] = useState(initial.published)
  const [mode, setMode] = useState<'manual' | 'auto'>(initial.triggerType === 'MANUAL' ? 'manual' : 'auto')
  const [trigger, setTrigger] = useState<TriggerType>(
    initial.triggerType === 'MANUAL' ? 'SESSIONS_COMPLETED' : initial.triggerType
  )
  const [value, setValue] = useState(initial.triggerValue != null ? String(initial.triggerValue) : '5')

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function uploadImage(file: File) {
    setError(null)
    setUploading(true)
    try {
      // Compressed BEFORE it leaves the browser — the upload route runs in a
      // serverless function whose request body caps at ~4.5MB, and a phone
      // photo sails past that. This is the cause of past "upload broken"
      // reports, so it is not optional.
      const toSend = await compressImageFile(file)
      const fd = new FormData()
      fd.append('file', toSend)
      fd.append('sessionId', 'achievements')
      const res = await fetch('/api/upload/image', { method: 'POST', body: fd })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(readApiError(body, 'Upload failed')); return }
      setImageUrl(body.url ?? null)
    } catch {
      setError('Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function save() {
    if (!name.trim()) { setError('Name is required'); return }

    const triggerType: TriggerType = mode === 'manual' ? 'MANUAL' : trigger
    const meta = TRIGGER_META[triggerType]
    let triggerValue: number | null = null
    if (meta.needsValue) {
      const n = Number(value)
      if (!Number.isInteger(n) || n < 1) {
        setError(`${meta.valueLabel ?? 'Threshold'} must be a positive whole number`)
        return
      }
      triggerValue = n
    }

    setSaving(true)
    setError(null)
    const payload = {
      name: name.trim(),
      description: isRichTextEmpty(description) ? null : description,
      icon: icon || null,
      imageUrl,
      color,
      published,
      triggerType,
      triggerValue,
    }
    try {
      const res = await fetch(isNew ? '/api/achievements' : `/api/achievements/${initial.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(readApiError(body)); return }
      router.push('/achievements')
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/achievements/${initial.id}`, { method: 'DELETE' })
      if (!res.ok) { setError('Delete failed'); return }
      router.push('/achievements')
      router.refresh()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <EditScreen
      // Delete is occasional and unrecoverable, so it goes in the ⋯ with a real
      // confirmation sheet. It used to be a grey line of text at the foot of
      // the form that turned into two buttons in place — quiet enough to miss
      // and, once found, one tap from gone.
      menu={isNew ? undefined : [{
        key: 'delete',
        label: 'Delete this achievement',
        hint: 'Asks first — this can’t be undone',
        icon: <Trash2 className="h-5 w-5" strokeWidth={1.75} />,
        onSelect: () => setConfirmDelete(true),
        danger: true,
      }]}
      menuTitle={name.trim() || 'This achievement'}
      secondary={{ label: 'Cancel', icon: <X className="h-4 w-4" strokeWidth={1.75} />, onClick: () => router.push('/achievements') }}
      primary={{
        label: isNew ? 'Create achievement' : 'Save changes',
        icon: <Check className="h-4 w-4" strokeWidth={2} />,
        onClick: save,
        loading: saving,
        disabled: !name.trim(),
      }}
    >
      {/* Live preview — what a client will actually see. */}
      <section>
        <SectionLabel>Preview</SectionLabel>
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5">
          <AchievementBadge imageUrl={imageUrl} icon={icon} name={name} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">{name.trim() || 'Untitled achievement'}</p>
            <p className="truncate text-[13px] text-slate-500">
              {isRichTextEmpty(description) ? 'Description shows up here' : richTextToPlain(description)}
            </p>
          </div>
        </div>
      </section>

      {/* ── Badge ──────────────────────────────────────────────────────── */}
      <section>
        <SectionLabel>Badge</SectionLabel>
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center gap-4 p-4">
            <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <ImagePlus className="h-5 w-5 text-slate-400" strokeWidth={1.75} />
                </div>
              )}
            </div>
            <div className="flex min-w-0 flex-col items-start gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading
                  ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Uploading…</>
                  : imageUrl ? 'Replace image' : 'Upload image'}
              </Button>
              {imageUrl ? (
                <button type="button" onClick={() => setImageUrl(null)} className="px-3 text-xs text-slate-400 hover:text-red-500">
                  Remove — go back to the emoji
                </button>
              ) : (
                <p className="px-3 text-xs text-slate-500">Optional. Without one, the emoji below is used.</p>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = '' }}
            />
          </div>

          <div className="flex flex-col gap-2 border-t border-slate-200 p-4">
            <label className="text-sm font-medium text-slate-700">Emoji</label>
            <div className="flex flex-wrap items-center gap-2">
              {COMMON_ICONS.map(emoji => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setIcon(emoji)}
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-lg border text-lg transition-colors',
                    icon === emoji ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
                  )}
                >
                  {emoji}
                </button>
              ))}
              {/* Only holds an emoji that ISN'T one of the tiles — otherwise it
                  renders the same glyph again and reads as a 13th choice. */}
              <input
                type="text"
                value={COMMON_ICONS.includes(icon) ? '' : icon}
                onChange={e => setIcon(e.target.value.slice(0, 4))}
                placeholder="Custom"
                aria-label="Custom emoji"
                className="h-10 w-20 rounded-lg border border-slate-200 bg-white px-2 text-center text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-slate-200 p-4">
            <label className="text-sm font-medium text-slate-700">Colour</label>
            <div className="flex flex-wrap items-center gap-1.5">
              {COLORS.map(c => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setColor(c.key)}
                  title={c.key}
                  aria-label={c.key}
                  aria-pressed={color === c.key}
                  className={cn(
                    'h-8 w-8 rounded-full border-2 transition-colors',
                    c.bgChip,
                    color === c.key ? 'border-slate-900' : 'border-transparent hover:border-slate-300'
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Wording ────────────────────────────────────────────────────── */}
      <section>
        <SectionLabel>Wording</SectionLabel>
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="p-4">
            <Input
              label="Name"
              placeholder="e.g. First session complete"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={80}
            />
          </div>
          <div className="flex flex-col gap-1.5 border-t border-slate-200 p-4">
            <label className="text-sm font-medium text-slate-700">Description</label>
            <RichTextEditor
              key={initial.id || 'new'}
              value={description}
              onChange={html => setDescription(isRichTextEmpty(html) ? '' : html)}
              minHeight={120}
              theme="light"
            />
          </div>
        </div>
      </section>

      {/* ── How it's earned ────────────────────────────────────────────── */}
      <section>
        <SectionLabel>How it&apos;s earned</SectionLabel>
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2">
            {(['manual', 'auto'] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-left transition-colors',
                  mode === m ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
                )}
              >
                <p className="text-sm font-semibold text-slate-900">{m === 'manual' ? 'Manual' : 'Automatic'}</p>
                <p className="mt-0.5 text-[13px] text-slate-500">
                  {m === 'manual' ? 'You award it from the client profile' : 'Awarded when a milestone is hit'}
                </p>
              </button>
            ))}
          </div>

          {mode === 'auto' && (
            <div className="flex flex-col gap-3 border-t border-slate-200 p-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="achievement-trigger" className="text-sm font-medium text-slate-700">Trigger</label>
                <select
                  id="achievement-trigger"
                  value={trigger}
                  onChange={e => setTrigger(e.target.value as TriggerType)}
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {TRIGGER_GROUPS.map(group => (
                    <optgroup key={group} label={group}>
                      {TRIGGERS.filter(t => t.group === group).map(t => (
                        <option key={t.type} value={t.type}>{t.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {TRIGGER_META[trigger].needsValue && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="achievement-value" className="text-sm font-medium text-slate-700">
                    {TRIGGER_META[trigger].valueLabel ?? 'Threshold'}
                  </label>
                  <input
                    id="achievement-value"
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={value}
                    onChange={e => setValue(e.target.value)}
                    className="h-11 w-32 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              <p className="text-[13px] text-slate-600">
                {TRIGGER_META[trigger].preview(Number(value) || 1)}
              </p>
            </div>
          )}

          <label className="flex cursor-pointer items-center justify-between gap-3 border-t border-slate-200 p-4">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-900">Published</span>
              <span className="mt-0.5 block text-[13px] text-slate-500">
                Visible to clients and eligible for auto-award. Turn off to draft.
              </span>
            </span>
            <input
              type="checkbox"
              checked={published}
              onChange={e => setPublished(e.target.checked)}
              className="h-5 w-5 flex-shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
          </label>
        </div>
      </section>

      {error && <Alert variant="error">{error}</Alert>}

      {confirmDelete && (
        <ConfirmSheet
          title={`Delete “${name.trim() || 'this achievement'}”?`}
          body="It comes off your list for good. Anything a client has already earned keeps its record."
          confirmLabel="Delete"
          danger
          busy={deleting}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={remove}
        />
      )}
    </EditScreen>
  )
}
