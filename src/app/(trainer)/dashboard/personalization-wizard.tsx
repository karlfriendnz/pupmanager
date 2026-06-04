'use client'

import { useRef, useState } from 'react'
import { Loader2, Upload, ImageIcon, ArrowRight, ArrowLeft, Check, Sparkles, PawPrint } from 'lucide-react'
import { BrandPreview } from '@/components/brand-preview'

// Drop in the real welcome video here (an MP4 URL or an embed). Until then the
// step shows a branded "coming soon" placeholder.
const WELCOME_VIDEO_URL: string | null = null

// First-run personalization wizard. Replaces the old welcome modal for fresh
// signups: make it yours (logo + name), pick brand colours (live preview),
// add a welcome note, then look through the real client app with a seeded
// sample client. Saves via the existing branding endpoints.

const DEFAULT_GRADIENT_START = '#2a9da9'
const DEFAULT_GRADIENT_END = '#1f818c'
const DEFAULT_ACCENT = '#7c3aed'
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export type WizardInitial = {
  businessName: string
  logoUrl: string | null
  emailAccentColor: string | null
  appGradientStart: string | null
  appGradientEnd: string | null
  clientWelcomeNote: string | null
  // Public contact details (pre-filled from signup where available).
  website: string | null
  phone: string | null
  publicEmail: string | null
  signupEmail: string
}

const STEPS = ['Welcome', 'Make it yours', 'Your colours', 'Say hello', 'Take a look'] as const

export function PersonalizationWizard({
  initial,
  onComplete,
  onSkip,
}: {
  initial: WizardInitial
  onComplete: () => Promise<void> | void
  onSkip: () => Promise<void> | void
}) {
  const [step, setStep] = useState(0)
  const [businessName, setBusinessName] = useState(initial.businessName === 'My Business' ? '' : initial.businessName)
  const [website, setWebsite] = useState(initial.website ?? '')
  const [phone, setPhone] = useState(initial.phone ?? '')
  const [email, setEmail] = useState(initial.publicEmail ?? initial.signupEmail ?? '')
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl ?? '')
  const [accent, setAccent] = useState(initial.emailAccentColor || DEFAULT_ACCENT)
  const [gradStart, setGradStart] = useState(initial.appGradientStart || DEFAULT_GRADIENT_START)
  const [gradEnd, setGradEnd] = useState(initial.appGradientEnd || DEFAULT_GRADIENT_END)
  const [note, setNote] = useState(initial.clientWelcomeNote ?? '')

  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function saveProfile() {
    await fetch('/api/trainer/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(businessName.trim() ? { businessName: businessName.trim() } : {}),
        website: website.trim(),
        phone: phone.trim(),
        publicEmail: email.trim(),
        logoUrl: logoUrl || '',
        emailAccentColor: HEX.test(accent) ? accent : '',
        appGradientStart: HEX.test(gradStart) ? gradStart : '',
        appGradientEnd: HEX.test(gradEnd) ? gradEnd : '',
        clientWelcomeNote: note.trim(),
      }),
    }).catch(() => {})
  }

  async function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('kind', 'logo')
      const res = await fetch('/api/trainer/branding-image', { method: 'POST', body: fd })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setUploadError(body.error ?? 'Upload failed.'); return }
      setLogoUrl(body.url)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function next() {
    setBusy(true)
    try {
      await saveProfile()
      setStep(s => Math.min(s + 1, STEPS.length - 1))
    } finally {
      setBusy(false)
    }
  }

  async function finish() {
    setBusy(true)
    try {
      await saveProfile()
      await onComplete()
    } finally {
      setBusy(false)
    }
  }

  async function skip() {
    setBusy(true)
    try { await onSkip() } finally { setBusy(false) }
  }

  const gs = HEX.test(gradStart) ? gradStart : DEFAULT_GRADIENT_START
  const ge = HEX.test(gradEnd) ? gradEnd : DEFAULT_GRADIENT_END
  const brandGradient = `linear-gradient(150deg, ${gs} 0%, ${ge} 100%)`
  const showPhone = step >= 1 && step <= 3

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-md p-4 animate-pm-fade">
      <div className="w-full max-w-4xl rounded-[2rem] bg-white shadow-[0_30px_80px_-20px_rgba(2,18,28,0.55)] ring-1 ring-black/5 overflow-hidden flex flex-col md:flex-row max-h-[94vh] animate-pm-pop">

        {/* ─── Branded stage (desktop) — fixed teal so it never shifts with the trainer's chosen colours ─── */}
        <aside className="hidden md:flex md:w-[42%] relative flex-col justify-between p-8 text-white overflow-hidden" style={{ backgroundImage: `linear-gradient(150deg, ${DEFAULT_GRADIENT_START} 0%, ${DEFAULT_GRADIENT_END} 100%)` }}>
          <div aria-hidden className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
          <div aria-hidden className="absolute -left-12 bottom-10 h-40 w-40 rounded-full bg-black/10 blur-2xl" />
          <div aria-hidden className="absolute inset-0 opacity-[0.07] select-none">
            <PawPrint className="absolute left-6 top-24 h-16 w-16 rotate-[-18deg]" />
            <PawPrint className="absolute right-8 top-44 h-12 w-12 rotate-[12deg]" />
            <PawPrint className="absolute left-12 bottom-28 h-20 w-20 rotate-[8deg]" />
          </div>

          {/* center art */}
          <div className="relative flex-1 grid place-items-center py-6">
            {showPhone ? (
              <BrandPreview businessName={businessName} logoUrl={logoUrl} gradStart={gradStart} gradEnd={gradEnd} note={note} />
            ) : step === 4 ? (
              <div className="text-center">
                <div className="mx-auto h-20 w-20 rounded-3xl bg-white/15 ring-1 ring-white/30 backdrop-blur-sm grid place-items-center animate-pm-pop"><Sparkles className="h-9 w-9" /></div>
                <p className="mt-4 text-lg font-display font-bold">All set!</p>
              </div>
            ) : (
              <div className="text-center px-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo-wordmark.png" alt="PupManager" className="mx-auto w-full max-w-[240px] object-contain" />
                <p className="mt-6 text-xl font-display font-bold leading-snug">You handle the pups,<br/>we’ll handle the admin.</p>
              </div>
            )}
          </div>

          {/* progress */}
          <div className="relative">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70 mb-2">Step {step + 1} of {STEPS.length} · {STEPS[step]}</p>
            <div className="flex gap-1.5">
              {STEPS.map((_, i) => (
                <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${i <= step ? 'bg-white' : 'bg-white/25'}`} />
              ))}
            </div>
          </div>
        </aside>

        {/* ─── Content column ─── */}
        <div className="flex-1 min-w-0 flex flex-col max-h-[94vh]">
          {/* mobile brand/progress bar */}
          <div className="md:hidden px-5 pt-5 pb-4 text-white" style={{ backgroundImage: brandGradient }}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold truncate">{businessName.trim() || 'PupManager'}</span>
              <button onClick={skip} disabled={busy} className="text-xs text-white/80 hover:text-white">Skip</button>
            </div>
            <div className="mt-3 flex gap-1.5">
              {STEPS.map((_, i) => <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-white' : 'bg-white/25'}`} />)}
            </div>
          </div>
          {/* desktop skip */}
          <div className="hidden md:flex justify-end px-8 pt-6">
            <button onClick={skip} disabled={busy} className="text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors">Skip for now</button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 md:px-8 py-6 md:py-7">
            {step === 0 && (
              <div className="max-w-lg mx-auto" key="s0">
                <h2 className="font-display text-3xl font-bold text-slate-900 tracking-tight">Welcome to PupManager</h2>
                <div className="relative aspect-video mt-5">
                  {WELCOME_VIDEO_URL ? (
                    <video src={WELCOME_VIDEO_URL} controls className="absolute inset-0 h-full w-full object-cover rounded-2xl bg-black" />
                  ) : (
                    // Video hidden for now — show the website hero image instead.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src="/hero-illustration.png" alt="PupManager" className="absolute inset-0 h-full w-full object-contain scale-110" />
                  )}
                </div>
                <p className="text-[15px] text-slate-500 mt-5 leading-relaxed">
                  So glad you’re here. We built PupManager to give you back the evenings you’ve been losing to admin. Let’s make the app yours, then take a look at exactly what your clients will see — two minutes, tops.
                </p>
              </div>
            )}

            {step === 1 && (
              <div key="s1">
                <StepHead title="Make it yours" sub="Your name, contact details and logo appear across your clients’ app and emails. We’ve pre-filled what we can — tweak anything." />
                <label className="block text-sm font-medium text-slate-700 mt-6 mb-2">Business name</label>
                <input value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Pawsome Dog Training" className="w-full h-12 rounded-xl border border-slate-200 bg-slate-50/50 px-4 text-[15px] focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/70 focus:border-transparent transition" />

                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mt-6 mb-2">Public contact details</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">Email</label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="hello@pawsome.co.nz" className="w-full h-11 rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/70 focus:border-transparent transition" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">Phone</label>
                    <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+64 21 123 4567" className="w-full h-11 rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/70 focus:border-transparent transition" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">Website</label>
                    <input type="url" value={website} onChange={e => setWebsite(e.target.value)} placeholder="pawsome.co.nz" className="w-full h-11 rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/70 focus:border-transparent transition" />
                  </div>
                </div>

                <label className="block text-sm font-medium text-slate-700 mt-6 mb-2">Logo</label>
                <div className="flex items-center gap-4">
                  <div className="h-20 w-20 rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center flex-shrink-0 shadow-sm">
                    {logoUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={logoUrl} alt="Logo" className="h-full w-full object-contain p-1.5" />
                      : <ImageIcon className="h-7 w-7 text-slate-300" />}
                  </div>
                  <div className="flex flex-col gap-2">
                    <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 px-4 h-10 text-sm font-semibold text-white disabled:opacity-50 transition-colors">
                      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{logoUrl ? 'Replace logo' : 'Upload logo'}
                    </button>
                    {logoUrl && <button type="button" onClick={() => setLogoUrl('')} className="text-xs text-slate-400 hover:text-red-500 self-start">Remove</button>}
                    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={onPickLogo} />
                  </div>
                </div>
                {uploadError && <p className="text-xs text-red-500 mt-2">{uploadError}</p>}
                <MobilePreview show={showPhone} businessName={businessName} logoUrl={logoUrl} gradStart={gradStart} gradEnd={gradEnd} note={note} />
              </div>
            )}

            {step === 2 && (
              <div key="s2">
                <StepHead title="Your colours" sub="Pick the gradient your clients see on buttons and highlights — the preview updates live." />
                <label className="block text-sm font-medium text-slate-700 mt-6 mb-2">App gradient</label>
                <div className="h-14 w-full rounded-2xl border border-slate-200 mb-3 shadow-inner" style={{ backgroundImage: `linear-gradient(135deg, ${gs}, ${ge})` }} />
                <div className="flex flex-wrap gap-4">
                  <ColorField label="Start" value={gradStart} onChange={setGradStart} fallback={DEFAULT_GRADIENT_START} />
                  <ColorField label="End" value={gradEnd} onChange={setGradEnd} fallback={DEFAULT_GRADIENT_END} />
                </div>
                <label className="block text-sm font-medium text-slate-700 mt-6 mb-1">Email accent</label>
                <p className="text-xs text-slate-400 mb-2">The strip across the top of emails to your clients.</p>
                <ColorField label="" value={accent} onChange={setAccent} fallback={DEFAULT_ACCENT} />
                <MobilePreview show={showPhone} businessName={businessName} logoUrl={logoUrl} gradStart={gradStart} gradEnd={gradEnd} note={note} />
              </div>
            )}

            {step === 3 && (
              <div key="s3">
                <StepHead title="Say hello" sub="A short, warm welcome shown on your clients’ home screen. Optional — but a lovely first impression." />
                <label className="block text-sm font-medium text-slate-700 mt-6 mb-2">Welcome note</label>
                <textarea value={note} onChange={e => setNote(e.target.value.slice(0, 500))} rows={5} placeholder="Welcome! So glad to have you and your pup with us. Tap around — your sessions, homework and progress all live here. — the team" className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-[15px] leading-relaxed focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/70 focus:border-transparent transition" />
                <p className="text-xs text-slate-400 mt-1.5">{note.length}/500</p>
                <MobilePreview show={showPhone} businessName={businessName} logoUrl={logoUrl} gradStart={gradStart} gradEnd={gradEnd} note={note} />
              </div>
            )}

            {step === 4 && (
              <div className="text-center max-w-md mx-auto py-4" key="s4">
                <div className="mx-auto h-16 w-16 rounded-2xl flex items-center justify-center shadow-lg" style={{ backgroundImage: brandGradient }}>
                  <Sparkles className="h-8 w-8 text-white" />
                </div>
                <h2 className="font-display text-2xl font-bold text-slate-900 mt-5 tracking-tight">You’re set — take a look</h2>
                <p className="text-[15px] text-slate-500 mt-2.5 leading-relaxed">Here’s a live preview of what your clients see — branded in your colours, with a sample pup. It’s just a demo; nothing’s added to your account.</p>
                <a href="/preview-as" className="mt-6 inline-flex items-center gap-2 rounded-2xl px-6 h-12 text-sm font-semibold text-white shadow-lg hover:-translate-y-px transition-transform" style={{ backgroundImage: brandGradient }}>
                  See the client app <ArrowRight className="h-4 w-4" />
                </a>
              </div>
            )}
          </div>

          {/* Footer nav */}
          <div className="flex items-center justify-between gap-3 px-6 md:px-8 py-4 border-t border-slate-100">
            <button onClick={() => setStep(s => Math.max(0, s - 1))} disabled={busy || step === 0} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-slate-700 transition-colors disabled:opacity-0">
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            {step < STEPS.length - 1 ? (
              <button onClick={next} disabled={busy} className="inline-flex items-center gap-2 rounded-2xl px-6 h-12 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 shadow-md hover:-translate-y-px transition-all disabled:opacity-60 disabled:hover:translate-y-0">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Continue <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button onClick={finish} disabled={busy} className="inline-flex items-center gap-2 rounded-2xl px-6 h-12 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 shadow-md hover:-translate-y-px transition-all disabled:opacity-60 disabled:hover:translate-y-0">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Finish setup
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StepHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h2 className="font-display text-2xl font-bold text-slate-900 tracking-tight">{title}</h2>
      <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">{sub}</p>
    </div>
  )
}

// Phone preview shown inline on mobile (the desktop stage carries it otherwise).
function MobilePreview(props: { show: boolean; businessName: string; logoUrl: string; gradStart: string; gradEnd: string; note: string }) {
  if (!props.show) return null
  return (
    <div className="md:hidden mt-7 flex justify-center">
      <BrandPreview businessName={props.businessName} logoUrl={props.logoUrl} gradStart={props.gradStart} gradEnd={props.gradEnd} note={props.note} />
    </div>
  )
}

function ColorField({ label, value, onChange, fallback }: { label: string; value: string; onChange: (v: string) => void; fallback: string }) {
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-xs text-slate-500 w-9">{label}</span>}
      <input type="color" value={HEX.test(value) ? value : fallback} onChange={e => onChange(e.target.value)} className="h-10 w-12 rounded border border-slate-200 cursor-pointer" aria-label={`${label} colour`} />
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={fallback} className="w-28 h-10 rounded-lg border border-slate-200 px-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
    </div>
  )
}

