'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

// Private, trainer-facing free-text notes about a client (never shown to the
// client). Saves to ClientProfile.notes via the client PATCH route.
export function ClientNotesTab({
  clientId,
  initialNotes,
  canEdit,
}: {
  clientId: string
  initialNotes: string | null
  canEdit: boolean
}) {
  const [notes, setNotes] = useState(initialNotes ?? '')
  const [savedValue, setSavedValue] = useState(initialNotes ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = notes !== savedValue

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notes.trim() || null }),
      })
      if (!res.ok) {
        setError('Could not save notes. Please try again.')
        return
      }
      setSavedValue(notes)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setError('Could not save notes. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Private notes</h3>
          <p className="text-xs text-slate-400">Only you and your team see these — never the client.</p>
        </div>
        {saved && <span className="shrink-0 text-xs font-medium text-emerald-600">Saved</span>}
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        disabled={!canEdit}
        rows={12}
        placeholder="Behaviour, preferences, health, reminders — anything worth remembering about this client…"
        className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm leading-relaxed text-slate-700 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50"
      />
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      {canEdit && (
        <div className="mt-3">
          <Button type="button" onClick={save} loading={saving} disabled={!dirty} size="sm">
            {dirty ? 'Save notes' : 'Saved'}
          </Button>
        </div>
      )}
    </div>
  )
}
