'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody } from '@/components/ui/card'
import { Trophy, Pencil, Trash2, X, Plus } from 'lucide-react'

type Color = 'blue' | 'emerald' | 'amber' | 'rose' | 'violet' | 'sky' | 'orange' | 'teal' | 'pink' | 'slate'

const COLORS: { key: Color; bgChip: string; ring: string; text: string }[] = [
  { key: 'blue',    bgChip: 'bg-blue-100 text-blue-600',       ring: 'ring-blue-200',    text: 'text-blue-700' },
  { key: 'emerald', bgChip: 'bg-emerald-100 text-emerald-600', ring: 'ring-emerald-200', text: 'text-emerald-700' },
  { key: 'amber',   bgChip: 'bg-amber-100 text-amber-600',     ring: 'ring-amber-200',   text: 'text-amber-700' },
  { key: 'rose',    bgChip: 'bg-rose-100 text-rose-600',       ring: 'ring-rose-200',    text: 'text-rose-700' },
  { key: 'violet',  bgChip: 'bg-violet-100 text-violet-600',   ring: 'ring-violet-200',  text: 'text-violet-700' },
  { key: 'sky',     bgChip: 'bg-sky-100 text-sky-600',         ring: 'ring-sky-200',     text: 'text-sky-700' },
  { key: 'orange',  bgChip: 'bg-orange-100 text-orange-600',   ring: 'ring-orange-200',  text: 'text-orange-700' },
  { key: 'teal',    bgChip: 'bg-teal-100 text-teal-600',       ring: 'ring-teal-200',    text: 'text-teal-700' },
  { key: 'pink',    bgChip: 'bg-pink-100 text-pink-600',       ring: 'ring-pink-200',    text: 'text-pink-700' },
  { key: 'slate',   bgChip: 'bg-slate-200 text-slate-600',     ring: 'ring-slate-200',   text: 'text-slate-700' },
]

const COLOR_BY_KEY = Object.fromEntries(COLORS.map(c => [c.key, c])) as Record<Color, typeof COLORS[number]>

type TriggerType =
  | 'MANUAL'
  | 'FIRST_SESSION'
  | 'SESSIONS_COMPLETED'
  | 'IN_PERSON_SESSIONS'
  | 'VIRTUAL_SESSIONS'
  | 'CONSECUTIVE_SESSIONS_ATTENDED'
  | 'FIRST_PACKAGE_ASSIGNED'
  | 'PACKAGES_COMPLETED'
  | 'FIRST_HOMEWORK_DONE'
  | 'HOMEWORK_TASKS_DONE'
  | 'HOMEWORK_STREAK_DAYS'
  | 'PERFECT_WEEK'
  | 'CLIENT_ANNIVERSARY_DAYS'
  | 'MESSAGES_SENT'
  | 'PRODUCTS_PURCHASED'
  | 'PROFILE_COMPLETED'

interface TriggerMeta {
  type: TriggerType
  label: string
  group: 'Sessions' | 'Packages' | 'Homework' | 'Other' | 'Manual'
  needsValue: boolean
  valueLabel?: string
  preview: (n: number) => string
}

const TRIGGERS: TriggerMeta[] = [
  { type: 'MANUAL', label: 'Manual — trainer awards', group: 'Manual', needsValue: false, preview: () => 'Awarded by hand from the client profile' },
  { type: 'FIRST_SESSION', label: 'First session attended', group: 'Sessions', needsValue: false, preview: () => 'Awarded after the first completed session' },
  { type: 'SESSIONS_COMPLETED', label: 'Total sessions completed', group: 'Sessions', needsValue: true, valueLabel: 'Sessions', preview: n => `Awarded after ${n} completed session${n === 1 ? '' : 's'}` },
  { type: 'IN_PERSON_SESSIONS', label: 'In-person sessions completed', group: 'Sessions', needsValue: true, valueLabel: 'Sessions', preview: n => `Awarded after ${n} in-person session${n === 1 ? '' : 's'}` },
  { type: 'VIRTUAL_SESSIONS', label: 'Virtual sessions completed', group: 'Sessions', needsValue: true, valueLabel: 'Sessions', preview: n => `Awarded after ${n} virtual session${n === 1 ? '' : 's'}` },
  { type: 'CONSECUTIVE_SESSIONS_ATTENDED', label: 'Consecutive sessions attended', group: 'Sessions', needsValue: true, valueLabel: 'In a row', preview: n => `Awarded for ${n} sessions attended in a row` },
  { type: 'FIRST_PACKAGE_ASSIGNED', label: 'First package signed up', group: 'Packages', needsValue: false, preview: () => 'Awarded when the first package is assigned' },
  { type: 'PACKAGES_COMPLETED', label: 'Packages completed', group: 'Packages', needsValue: true, valueLabel: 'Packages', preview: n => `Awarded after ${n} completed package${n === 1 ? '' : 's'}` },
  { type: 'FIRST_HOMEWORK_DONE', label: 'First homework done', group: 'Homework', needsValue: false, preview: () => 'Awarded the first time a homework task is completed' },
  { type: 'HOMEWORK_TASKS_DONE', label: 'Homework tasks done', group: 'Homework', needsValue: true, valueLabel: 'Tasks', preview: n => `Awarded after ${n} completed task${n === 1 ? '' : 's'}` },
  { type: 'HOMEWORK_STREAK_DAYS', label: 'Homework streak (days)', group: 'Homework', needsValue: true, valueLabel: 'Days in a row', preview: n => `Awarded for ${n} day${n === 1 ? '' : 's'} of perfect homework in a row` },
  { type: 'PERFECT_WEEK', label: 'Perfect weeks', group: 'Homework', needsValue: true, valueLabel: 'Weeks', preview: n => `Awarded after ${n} week${n === 1 ? '' : 's'} where every task was completed` },
  { type: 'CLIENT_ANNIVERSARY_DAYS', label: 'Client anniversary', group: 'Other', needsValue: true, valueLabel: 'Days as a client', preview: n => `Awarded after ${n} day${n === 1 ? '' : 's'} on the books` },
  { type: 'MESSAGES_SENT', label: 'Messages sent', group: 'Other', needsValue: true, valueLabel: 'Messages', preview: n => `Awarded after the client sends ${n} message${n === 1 ? '' : 's'}` },
  { type: 'PRODUCTS_PURCHASED', label: 'Products purchased', group: 'Other', needsValue: true, valueLabel: 'Products', preview: n => `Awarded after ${n} product purchase${n === 1 ? '' : 's'}` },
  { type: 'PROFILE_COMPLETED', label: 'Profile fully completed', group: 'Other', needsValue: false, preview: () => 'Awarded once every required custom field has a value' },
]

const TRIGGER_META = Object.fromEntries(TRIGGERS.map(t => [t.type, t])) as Record<TriggerType, TriggerMeta>

interface Achievement {
  id: string
  name: string
  description: string | null
  icon: string | null
  color: string | null
  published: boolean
  triggerType: TriggerType
  triggerValue: number | null
}

const COMMON_ICONS = ['🏆', '⭐', '🥇', '🎖️', '🐾', '🦴', '💯', '🚀', '🔥', '🎯', '🌟', '👑']
const DEFAULT_COLOR: Color = 'amber'

export function AchievementsManager({ initial }: { initial: Achievement[] }) {
  const router = useRouter()
  const [items, setItems] = useState<Achievement[]>(initial)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Draft form state shared between add + edit modes.
  const [draftName, setDraftName] = useState('')
  const [draftDesc, setDraftDesc] = useState('')
  const [draftIcon, setDraftIcon] = useState<string>('🏆')
  const [draftColor, setDraftColor] = useState<Color>(DEFAULT_COLOR)
  const [draftPublished, setDraftPublished] = useState(true)
  const [draftMode, setDraftMode] = useState<'manual' | 'auto'>('manual')
  const [draftTrigger, setDraftTrigger] = useState<TriggerType>('SESSIONS_COMPLETED')
  const [draftValue, setDraftValue] = useState<string>('5')

  function resetDraft() {
    setDraftName('')
    setDraftDesc('')
    setDraftIcon('🏆')
    setDraftColor(DEFAULT_COLOR)
    setDraftPublished(true)
    setDraftMode('manual')
    setDraftTrigger('SESSIONS_COMPLETED')
    setDraftValue('5')
    setError(null)
  }

  function startAdd() {
    resetDraft()
    setEditingId(null)
    setShowAdd(true)
  }

  function startEdit(a: Achievement) {
    setEditingId(a.id)
    setShowAdd(false)
    setDraftName(a.name)
    setDraftDesc(a.description ?? '')
    setDraftIcon(a.icon ?? '🏆')
    // Guard against nullish a.color — the previous expression checked the
    // fallback against COLOR_BY_KEY but then assigned the raw (null) value.
    setDraftColor(a.color && (a.color as Color) in COLOR_BY_KEY ? (a.color as Color) : DEFAULT_COLOR)
    setDraftPublished(a.published)
    setDraftMode(a.triggerType === 'MANUAL' ? 'manual' : 'auto')
    setDraftTrigger(a.triggerType === 'MANUAL' ? 'SESSIONS_COMPLETED' : a.triggerType)
    setDraftValue(a.triggerValue != null ? String(a.triggerValue) : '5')
    setError(null)
  }

  function cancel() {
    setEditingId(null)
    setShowAdd(false)
    resetDraft()
  }

  async function save() {
    if (!draftName.trim()) {
      setError('Name is required')
      return
    }
    const triggerType: TriggerType = draftMode === 'manual' ? 'MANUAL' : draftTrigger
    const meta = TRIGGER_META[triggerType]
    let triggerValue: number | null = null
    if (meta.needsValue) {
      const n = Number(draftValue)
      if (!Number.isInteger(n) || n < 1) {
        setError(`${meta.valueLabel ?? 'Threshold'} must be a positive whole number`)
        return
      }
      triggerValue = n
    }
    setSaving(true)
    setError(null)
    const body = {
      name: draftName.trim(),
      description: draftDesc.trim() || null,
      icon: draftIcon || null,
      color: draftColor,
      published: draftPublished,
      triggerType,
      triggerValue,
    }
    const res = editingId
      ? await fetch(`/api/achievements/${editingId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      : await fetch('/api/achievements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setSaving(false)
    if (!res.ok) { setError('Failed to save'); return }
    const saved: Achievement = await res.json()
    setItems(prev => editingId
      ? prev.map(a => a.id === editingId ? saved : a)
      : [...prev, saved],
    )
    cancel()
    // Refresh server state so the trainer layout (FAB / onboarding state)
    // sees the new published-achievement count and advances the wizard.
    router.refresh()
  }

  async function remove(id: string) {
    if (!confirm('Delete this achievement?')) return
    const prev = items
    setItems(p => p.filter(a => a.id !== id))
    const res = await fetch(`/api/achievements/${id}`, { method: 'DELETE' })
    if (!res.ok) setItems(prev)
    else router.refresh()
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Existing list */}
      {items.length === 0 ? (
        <Card>
          <CardBody className="text-center py-10">
            <div className="h-14 w-14 rounded-3xl bg-amber-50 flex items-center justify-center mx-auto">
              <Trophy className="h-6 w-6 text-amber-500" />
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-700">No achievements yet</p>
            <p className="mt-1 text-xs text-slate-500 max-w-xs mx-auto">
              Create badges your clients can earn — first session, 30-day streak, off-leash recall, whatever fits your programme.
            </p>
          </CardBody>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {items.map(a => {
            const tone = COLOR_BY_KEY[(a.color as Color) ?? DEFAULT_COLOR] ?? COLOR_BY_KEY[DEFAULT_COLOR]
            const isEditing = editingId === a.id
            return (
              <li key={a.id} className={`relative rounded-2xl bg-white border border-slate-100 shadow-sm p-4 ring-1 ${tone.ring} ${isEditing ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="flex items-start gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-xl ${tone.bgChip} shrink-0`}>
                    {a.icon || '🏆'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-slate-900 truncate">{a.name}</p>
                      <span className={`flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                        a.published ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {a.published ? 'Published' : 'Draft'}
                      </span>
                    </div>
                    {a.description && (
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{a.description}</p>
                    )}
                    <p className="text-[10px] text-slate-400 mt-1.5 uppercase tracking-wide font-medium">
                      {a.triggerType === 'MANUAL'
                        ? 'Manual'
                        : TRIGGER_META[a.triggerType]?.preview(a.triggerValue ?? 1) ?? 'Auto'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => startEdit(a)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => remove(a.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* Add button — always visible. Modal pops over when adding/editing. */}
      <button
        onClick={startAdd}
        className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-400 transition-colors"
      >
        <Plus className="h-4 w-4" />
        Add achievement
      </button>

      {/* Add/Edit modal */}
      {(showAdd || editingId) && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-md animate-pm-fade">
          <div className="relative w-full max-w-lg max-h-[92vh] overflow-y-auto bg-white rounded-3xl shadow-2xl animate-pm-pop p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900">
              {editingId ? 'Edit achievement' : 'New achievement'}
            </p>
            <button onClick={cancel} className="p-1 text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Live preview */}
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
            <div className={`flex h-12 w-12 items-center justify-center rounded-2xl text-2xl ${COLOR_BY_KEY[draftColor].bgChip}`}>
              {draftIcon || '🏆'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{draftName.trim() || 'Untitled achievement'}</p>
              <p className="text-xs text-slate-500 truncate">{draftDesc.trim() || 'Description shows up here'}</p>
            </div>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <Input
            label="Name"
            placeholder="e.g. First session complete"
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            maxLength={80}
          />
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Description</label>
            <textarea
              value={draftDesc}
              onChange={e => setDraftDesc(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="What earns this badge?"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Icon</label>
            <div className="flex items-center gap-2 flex-wrap">
              {COMMON_ICONS.map(emoji => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setDraftIcon(emoji)}
                  className={`h-9 w-9 rounded-lg text-lg flex items-center justify-center border transition-colors ${
                    draftIcon === emoji ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {emoji}
                </button>
              ))}
              <input
                type="text"
                value={draftIcon}
                onChange={e => setDraftIcon(e.target.value.slice(0, 4))}
                placeholder="Custom"
                className="h-9 w-20 rounded-lg border border-slate-200 bg-white px-2 text-center text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Colour</label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {COLORS.map(c => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setDraftColor(c.key)}
                  title={c.key}
                  className={`h-8 w-8 rounded-full ${c.bgChip} border-2 transition-colors ${
                    draftColor === c.key ? 'border-slate-900' : 'border-transparent hover:border-slate-300'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* How is this earned? */}
          <div className="rounded-xl border border-slate-200 p-3 flex flex-col gap-3">
            <p className="text-sm font-medium text-slate-700">How is this earned?</p>
            <div className="grid grid-cols-2 gap-2">
              {(['manual', 'auto'] as const).map(mode => {
                const active = draftMode === mode
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setDraftMode(mode)}
                    className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                      active ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <p className="text-xs font-semibold text-slate-900">{mode === 'manual' ? 'Manual' : 'Automatic'}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {mode === 'manual' ? 'You award from the client profile' : 'System awards when a milestone is hit'}
                    </p>
                  </button>
                )
              })}
            </div>

            {draftMode === 'auto' && (
              <>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Trigger</label>
                  <select
                    value={draftTrigger}
                    onChange={e => setDraftTrigger(e.target.value as TriggerType)}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {(['Sessions', 'Packages', 'Homework', 'Other'] as const).map(group => (
                      <optgroup key={group} label={group}>
                        {TRIGGERS.filter(t => t.group === group).map(t => (
                          <option key={t.type} value={t.type}>{t.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                {TRIGGER_META[draftTrigger].needsValue && (
                  <div>
                    <label className="text-xs font-medium text-slate-600 block mb-1">
                      {TRIGGER_META[draftTrigger].valueLabel ?? 'Threshold'}
                    </label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={draftValue}
                      onChange={e => setDraftValue(e.target.value)}
                      className="h-10 w-32 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}
                <p className="text-xs text-blue-700 bg-blue-50 rounded-lg px-3 py-2 border border-blue-100">
                  {TRIGGER_META[draftTrigger].preview(Number(draftValue) || 1)}
                </p>
              </>
            )}
          </div>

          {/* Published toggle */}
          <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5 cursor-pointer">
            <div>
              <p className="text-sm font-medium text-slate-700">Published</p>
              <p className="text-xs text-slate-500">Visible to clients and eligible for auto-award. Turn off to draft.</p>
            </div>
            <input
              type="checkbox"
              checked={draftPublished}
              onChange={e => setDraftPublished(e.target.checked)}
              className="h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
          </label>

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={cancel} className="flex-1">Cancel</Button>
            <Button type="button" onClick={save} loading={saving} className="flex-1">
              {editingId ? 'Save changes' : 'Add achievement'}
            </Button>
          </div>
          </div>
        </div>
      )}
    </div>
  )
}
