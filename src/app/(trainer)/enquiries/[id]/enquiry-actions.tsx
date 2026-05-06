'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CheckCircle2, XCircle, Mail } from 'lucide-react'

type Props = {
  enquiryId: string
  status: 'NEW' | 'ACCEPTED' | 'DECLINED' | 'ARCHIVED'
  clientProfileId: string | null
  defaultSubject: string
  defaultGreeting: string
}

export function EnquiryActions({ enquiryId, status, clientProfileId, defaultSubject, defaultGreeting }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<null | 'accept' | 'decline' | 'reply'>(null)
  const [error, setError] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  const [subject, setSubject] = useState(defaultSubject)
  const [body, setBody] = useState(`${defaultGreeting}\n\n`)
  // Accept modal — opt-in to the magic-link email so the trainer can decide
  // whether to onboard them silently or invite them to the diary right away.
  const [showAcceptModal, setShowAcceptModal] = useState(false)
  const [sendMagicLink, setSendMagicLink] = useState(false)

  if (status === 'ACCEPTED') {
    return (
      <Card className="p-5 bg-emerald-50/50 border-emerald-100">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 flex-shrink-0">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <p className="font-semibold text-emerald-900 text-sm">Accepted</p>
            <p className="text-xs text-emerald-800/80 mt-0.5">This enquiry was turned into a client.</p>
          </div>
          {clientProfileId && (
            <Link href={`/clients/${clientProfileId}`} className="text-sm font-semibold text-emerald-700 hover:underline">
              View client →
            </Link>
          )}
        </div>
      </Card>
    )
  }

  if (status === 'DECLINED' || status === 'ARCHIVED') {
    return (
      <Card className="p-5">
        <p className="text-sm text-slate-500">This enquiry is {status.toLowerCase()}.</p>
      </Card>
    )
  }

  async function decline() {
    if (!confirm('Decline this enquiry? They won\'t be notified — this just removes it from your new-enquiries list.')) return
    setBusy('decline')
    setError(null)
    try {
      const res = await fetch(`/api/enquiries/${enquiryId}/decline`, { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? 'Failed to decline')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to decline')
    } finally {
      setBusy(null)
    }
  }

  async function confirmAccept() {
    setBusy('accept')
    setError(null)
    try {
      const res = await fetch(`/api/enquiries/${enquiryId}/accept`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sendMagicLink }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? 'Failed to accept')
      setShowAcceptModal(false)
      if (data?.clientProfileId) {
        router.push(`/clients/${data.clientProfileId}`)
      } else {
        router.refresh()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to accept')
    } finally {
      setBusy(null)
    }
  }

  async function sendReply() {
    if (!subject.trim() || !body.trim()) {
      setError('Subject and message are required.')
      return
    }
    setBusy('reply')
    setError(null)
    try {
      const res = await fetch(`/api/enquiries/${enquiryId}/reply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject, body }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? 'Failed to send')
      setComposing(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <Card className="p-3 bg-rose-50 border-rose-100">
          <p className="text-sm text-rose-700">{error}</p>
        </Card>
      )}

      {!composing && (
        <Card className="p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Decide</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Button
              type="button"
              onClick={() => { setError(null); setShowAcceptModal(true) }}
              disabled={busy != null}
              className="bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800"
            >
              <CheckCircle2 className="h-4 w-4" />
              Accept
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setComposing(true)}
              disabled={busy != null}
            >
              <Mail className="h-4 w-4" />
              Reply
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={decline}
              disabled={busy != null}
              loading={busy === 'decline'}
              className="text-rose-600 hover:bg-rose-50"
            >
              {busy !== 'decline' && <XCircle className="h-4 w-4" />}
              Decline
            </Button>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            Replies come from your business name with your email as Reply-To, so any response from them lands in your inbox.
          </p>
        </Card>
      )}
      {/* duplicate-render guard — modal lives outside the !composing branch
          so it doesn't unmount when the trainer opens the reply composer. */}
      {showAcceptModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40"
          onClick={() => busy === null && setShowAcceptModal(false)}
        >
          <div
            className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="text-base font-semibold text-slate-900">Accept this enquiry?</h2>
              <p className="text-sm text-slate-500 mt-1">
                Creates a client account so you can book sessions, log notes, and track progress.
              </p>
            </div>
            <div className="px-5 py-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendMagicLink}
                  onChange={e => setSendMagicLink(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span className="text-sm">
                  <span className="font-medium text-slate-900">Email them a magic link to access their training diary now</span>
                  <span className="block text-xs text-slate-500 mt-0.5">
                    Leave unchecked to onboard them quietly — you can send the invite later from their client page.
                  </span>
                </span>
              </label>
            </div>
            {error && (
              <div className="px-5 pb-2">
                <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-md px-3 py-2">{error}</p>
              </div>
            )}
            <div className="px-5 py-4 border-t border-slate-100 flex gap-2 justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowAcceptModal(false)}
                disabled={busy != null}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={confirmAccept}
                disabled={busy != null}
                loading={busy === 'accept'}
                className="bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800"
              >
                {busy !== 'accept' && <CheckCircle2 className="h-4 w-4" />}
                Accept
              </Button>
            </div>
          </div>
        </div>
      )}
      {composing && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-900">Reply by email</h2>
            <button
              type="button"
              onClick={() => { setComposing(false); setError(null) }}
              className="text-xs text-slate-500 hover:text-slate-700"
              disabled={busy != null}
            >
              Cancel
            </button>
          </div>
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Subject</label>
              <Input value={subject} onChange={e => setSubject(e.target.value)} disabled={busy != null} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Message</label>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={10}
                disabled={busy != null}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
              />
            </div>
            <Button
              type="button"
              onClick={sendReply}
              disabled={busy != null}
              loading={busy === 'reply'}
              className="bg-violet-600 hover:bg-violet-700 active:bg-violet-800 self-start"
            >
              {busy !== 'reply' && <Mail className="h-4 w-4" />}
              Send
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
