'use client'

import { useEffect, useState } from 'react'
import { Loader2, Check, RotateCcw, Mail, Clock, Hand, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * The emails the platform sends on the trainer's behalf, listed so they can be
 * read and reworded in one place.
 *
 * Before this they existed only inside the functions that sent them: a trainer
 * could not see what went out in their name, let alone change it. The one
 * exception was the client invite, which had its own editor and its own
 * storage — kept, and surfaced here, rather than given a second home.
 *
 * Subject and body only. The shell around them carries the trainer's logo and
 * colour and is not editable, or the white-labelling would last exactly until
 * someone pasted something odd into it.
 */

type SystemEmail = {
  key: string
  label: string
  description: string
  audience: 'client' | 'trainer' | 'staff'
  trigger: 'manual' | 'action' | 'scheduled'
  placeholders: { token: string; label: string }[]
  subjectEditable: boolean
  subject: string
  body: string
  defaultSubject: string
  defaultBody: string
  customised: boolean
}

const TRIGGER: Record<SystemEmail['trigger'], { label: string; hint: string; Icon: typeof Clock }> = {
  manual:    { label: 'You send it',   hint: 'Only goes out when you press a button.',        Icon: Hand },
  action:    { label: 'Sends itself',  hint: 'Goes out on its own when something happens.',   Icon: Zap },
  scheduled: { label: 'Scheduled',     hint: 'Goes out on a timer.',                          Icon: Clock },
}

export function SystemEmailsSection() {
  const [emails, setEmails] = useState<SystemEmail[] | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/system-emails')
      .then(r => r.json())
      .then(d => setEmails(d.emails ?? []))
      .catch(() => setError('Could not load your emails.'))
  }, [])

  const open = emails?.find(e => e.key === openKey) ?? null

  function edit(e: SystemEmail) {
    setOpenKey(e.key)
    setSubject(e.subject)
    setBody(e.body)
    setSaved(false)
    setError(null)
  }

  async function save() {
    if (!open) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/system-emails', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: open.key, subject, body }),
      })
      if (!res.ok) throw new Error('save failed')
      setEmails(list => (list ?? []).map(e => e.key === open.key ? { ...e, subject, body, customised: true } : e))
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setError('Could not save that. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    if (!open) return
    setBusy(true)
    try {
      await fetch(`/api/system-emails?key=${encodeURIComponent(open.key)}`, { method: 'DELETE' })
      setEmails(list => (list ?? []).map(e =>
        e.key === open.key ? { ...e, subject: e.defaultSubject, body: e.defaultBody, customised: false } : e))
      setSubject(open.defaultSubject)
      setBody(open.defaultBody)
    } finally {
      setBusy(false)
    }
  }

  function insert(token: string) {
    setBody(b => (b ? `${b} ${token}` : token))
  }

  if (emails === null) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your emails…
      </div>
    )
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
          <Mail className="h-4 w-4 text-slate-400" /> Emails we send for you
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          These go to your clients in your name, with your logo and colours. Change the wording to sound like you —
          anything you don&rsquo;t touch uses ours.
        </p>
      </div>

      <ul className="divide-y divide-slate-100">
        {emails.map(e => {
          const t = TRIGGER[e.trigger]
          const isOpen = openKey === e.key
          return (
            <li key={e.key}>
              <button
                type="button"
                onClick={() => (isOpen ? setOpenKey(null) : edit(e))}
                className="w-full text-left px-5 py-3.5 hover:bg-slate-50 flex items-start gap-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">{e.label}</span>
                    {e.customised && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                        Your wording
                      </span>
                    )}
                    <span
                      title={t.hint}
                      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500"
                    >
                      <t.Icon className="h-3 w-3" /> {t.label}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">{e.description}</span>
                </span>
                <span className="shrink-0 text-xs font-semibold text-slate-400 pt-0.5">
                  {isOpen ? 'Close' : 'Edit'}
                </span>
              </button>

              {isOpen && open && (
                <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4 space-y-3">
                  {open.subjectEditable && (
                    <label className="block">
                      <span className="text-xs font-semibold text-slate-500">Subject</span>
                      <input
                        value={subject}
                        onChange={ev => setSubject(ev.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 h-10 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                    </label>
                  )}

                  <label className="block">
                    <span className="text-xs font-semibold text-slate-500">Message</span>
                    <textarea
                      value={body}
                      onChange={ev => setBody(ev.target.value)}
                      rows={7}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </label>

                  {open.placeholders.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-slate-500">Insert:</span>
                      {open.placeholders.map(p => (
                        <button
                          key={p.token}
                          type="button"
                          title={p.label}
                          onClick={() => insert(p.token)}
                          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-teal-500 hover:text-teal-700"
                        >
                          {p.token}
                        </button>
                      ))}
                    </div>
                  )}

                  {error && <p className="text-sm text-red-600">{error}</p>}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button onClick={save} disabled={busy}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      {busy ? 'Saving…' : 'Save'}
                    </Button>
                    {open.customised && (
                      <button
                        type="button"
                        onClick={reset}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Back to the default
                      </button>
                    )}
                    {saved && <span className="text-sm text-emerald-600">Saved ✓</span>}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
