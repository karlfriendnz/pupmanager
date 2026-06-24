'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Phone, Lightbulb, X, ArrowRight, ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { FormModal } from '../help/help-center'

// Where the "Book a call" off-ramp points. Empty hides that button.
const DEMO_CALL_URL = 'https://pupmanager.com/demo'

// Account cancellation. Lives under the Billing tab (OWNER-only). Clicking opens
// a branded modal that first tries to SAVE the trainer with help off-ramps (a
// call with Brooke, a feature request), then — if they still want out —
// collects feedback and soft-deletes via /api/user/delete (deactivate now,
// recoverable 30 days, founders emailed the reason).
export function DeleteAccountSection() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [featureOpen, setFeatureOpen] = useState(false)
  const [step, setStep] = useState<'offer' | 'confirm'>('offer')
  const [deleting, setDeleting] = useState(false)
  const [password, setPassword] = useState('')
  const [reason, setReason] = useState('')
  const [okToCall, setOkToCall] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Esc to close + scroll lock while the modal is open.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function openModal() {
    setStep('offer')
    setError(null)
    setPassword('')
    setReason('')
    setOkToCall(true)
    setOpen(true)
  }

  function close() {
    if (deleting) return
    setOpen(false)
  }

  async function deleteAccount() {
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch('/api/user/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        // Password re-auth for credential accounts; the confirm word covers
        // OAuth-only accounts that have no password to check.
        body: JSON.stringify({ password, confirm: 'DELETE', reason, okToCall }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        setError(typeof b.error === 'string' ? b.error : 'Could not delete your account.')
        setDeleting(false)
        return
      }
      router.push('/login')
    } catch {
      setError('Could not delete your account.')
      setDeleting(false)
    }
  }

  const header = step === 'offer'
    ? { title: 'We’d hate to see you go \u{1F49B}', blurb: 'You’re one of the trainers we built this for.' }
    : { title: 'Sorry to see you go', blurb: 'Mind telling us why? It genuinely helps us.' }

  return (
    <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-slate-800">Cancel your account</h3>
      <p className="text-sm text-slate-500 mt-1 mb-4">
        We&apos;d hate to see you go, but you can cancel anytime. Your account is
        kept for 30 days in case you change your mind.
      </p>
      <Button variant="danger" size="sm" onClick={openModal}>
        Cancel my account
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          onMouseDown={e => { if (e.target === e.currentTarget) close() }}
        >
          <div className="relative w-full max-w-lg max-h-[92vh] flex flex-col bg-white rounded-3xl shadow-[0_20px_60px_-12px_rgba(0,0,0,0.45)] overflow-hidden">
            {/* Branded gradient header — matches the /help modals + pricing page. */}
            <div
              className="px-6 py-5 text-white shrink-0"
              style={{ backgroundImage: 'linear-gradient(135deg, var(--pm-brand-500), var(--pm-brand-700))' }}
            >
              <button
                type="button"
                aria-label="Close"
                onClick={close}
                className="absolute top-3.5 right-3.5 grid place-items-center h-8 w-8 rounded-full bg-white/15 text-white hover:bg-white/25 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
              <h2 className="text-lg font-bold pr-8">{header.title}</h2>
              <p className="text-sm text-white/85 mt-0.5">{header.blurb}</p>
            </div>

            <div className="p-6 overflow-y-auto flex flex-col gap-5">
              {step === 'offer' ? (
                <>
                  <div className="flex items-start gap-4">
                    <div className="text-sm text-slate-600 leading-relaxed flex flex-col gap-2.5 min-w-0 flex-1">
                      <p>
                        Thank you — truly — for giving PupManager a go. It honestly means the world that you
                        trusted us with your business, even for a little while.
                      </p>
                      <p>If something hasn&apos;t quite worked for you, we&apos;d genuinely love to know what it was.</p>
                    </div>
                    <Image
                      src="/founders-v2.png"
                      alt="Brooke and Karl, the PupManager founders, with their dog"
                      width={392}
                      height={366}
                      className="h-[160px] w-[160px] rounded-full object-cover object-center shrink-0 shadow-sm"
                    />
                  </div>

                  <div className="flex flex-col gap-2.5">
                    {DEMO_CALL_URL && (
                      <SaveOption
                        as="external"
                        href={DEMO_CALL_URL}
                        icon={<Phone className="h-5 w-5" />}
                        title="Book a call with Brooke"
                        subtitle="We get it — a new platform can be tricky. She'll personally walk you through it."
                      />
                    )}
                    <SaveOption
                      as="button"
                      onClick={() => { setOpen(false); setFeatureOpen(true) }}
                      icon={<Lightbulb className="h-5 w-5" />}
                      title="Request a feature"
                      subtitle="Tell us what's missing — we build from trainer feedback."
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => setStep('confirm')}
                    className="text-sm font-medium text-slate-400 hover:text-slate-600 self-center transition-colors"
                  >
                    No thanks, I still want to cancel
                  </button>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-slate-700">What made you decide to cancel?</label>
                    <textarea
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      rows={4}
                      maxLength={2000}
                      placeholder="Even one line helps us more than you'd think 🙏"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500,#2a9da9)]"
                    />
                  </div>

                  <label className="flex items-start gap-2.5 rounded-2xl border border-[var(--pm-brand-200,#bfe3e2)] bg-[var(--pm-brand-50,#eafaf9)] p-3.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={okToCall}
                      onChange={e => setOkToCall(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[var(--pm-brand-600)] focus:ring-[var(--pm-brand-500,#2a9da9)]"
                    />
                    <span className="text-sm text-slate-700">
                      Is it OK if Brooke gives you a quick call? She&apos;d love to hear your feedback
                      personally — no sales pitch, just a friendly chat.
                    </span>
                  </label>

                  <Alert variant="error">Confirming will deactivate your account immediately, and it&apos;s permanently deleted after 30 days. Enter your password to confirm.</Alert>
                  <Input
                    type="password"
                    label="Your password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                  />
                  {error && <Alert variant="error">{error}</Alert>}

                  <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-between sm:items-center">
                    <Button variant="ghost" size="sm" onClick={() => setStep('offer')}>Back</Button>
                    <Button variant="danger" size="sm" loading={deleting} onClick={deleteAccount}>
                      Send feedback &amp; cancel
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reuses the exact "Request a feature" modal from /help. */}
      {featureOpen && <FormModal type="feature" onClose={() => setFeatureOpen(false)} />}
    </div>
  )
}

// One tappable off-ramp card in the save step — styled to match the /help
// action cards (brand icon chip + trailing arrow). Internal links use next/link;
// external (the booking URL) opens in a new tab with an out-arrow.
type SaveOptionProps = {
  icon: React.ReactNode
  title: string
  subtitle: string
} & (
  | { as: 'link' | 'external'; href: string; onClick?: never }
  | { as: 'button'; onClick: () => void; href?: never }
)

function SaveOption({ icon, title, subtitle, ...rest }: SaveOptionProps) {
  const cls = 'group flex items-center gap-3.5 rounded-2xl border border-slate-200 bg-white p-4 text-left w-full transition-all hover:border-[var(--pm-brand-500,#2a9da9)] hover:shadow-sm'
  const inner = (
    <>
      <span
        className="grid place-items-center h-11 w-11 rounded-xl text-white shrink-0"
        style={{ backgroundColor: 'var(--pm-brand-600)' }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-sm font-semibold text-slate-900">
          {title}
          {rest.as === 'external' && <ArrowUpRight className="h-3.5 w-3.5 text-slate-400" />}
        </span>
        <span className="block text-xs text-slate-500 mt-0.5">{subtitle}</span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 self-center text-slate-300 transition-all group-hover:text-[var(--pm-brand-600)] group-hover:translate-x-0.5" />
    </>
  )
  if (rest.as === 'button') return <button type="button" onClick={rest.onClick} className={cls}>{inner}</button>
  if (rest.as === 'external') return <a href={rest.href} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a>
  return <Link href={rest.href} className={cls}>{inner}</Link>
}
