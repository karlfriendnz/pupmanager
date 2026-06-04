'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, Upload, ImageIcon, ArrowRight, ArrowLeft, Sparkles, PawPrint, Wand2, ChevronLeft, ChevronRight, FlaskConical } from 'lucide-react'
import { BrandPreview } from '@/components/brand-preview'
import { extractLogoColors, type LogoPalette } from '@/lib/logo-colors'

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

// Index 0 ('Welcome') is the unnumbered intro; the numbered count starts at
// index 1, so "Make it yours" shows as Step 1 of 5.
const STEPS = ['Welcome', 'Make it yours', 'Your colours', 'Say hello', 'Take a look', 'Sample data'] as const

// Ready-to-go welcome notes (shown on the client's home screen). The wizard
// pre-fills the first so trainers tweak rather than face a blank box; "Try
// another" cycles them. Kept business-name-agnostic (the app header already
// shows the business) and broken into short paragraphs — the client home
// renders them with whitespace-pre-line, so they stay easy to read.
const STARTER_LABELS = ['Warm', 'Simple', 'Reassuring'] as const
const STARTER_NOTES = [
  `Hi, and welcome.

We're really glad you and your dog are here. Everything for your training now lives in one place: your sessions, what to work on at home, and how things are going.

Have a look around, and message us whenever something comes up.`,
  `Welcome,

This is where you'll find your sessions, the homework to practise between them, and your dog's progress over time.

Take a minute to get your bearings. If you're ever unsure about anything, just send us a message.`,
  `Thanks for joining us.

Your schedule, training notes and progress all live here, plus a direct line to us whenever you need it.

No question is too small. We'll work through it together.`,
]

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

  // If we're returning from the client-app preview (opened from the last step),
  // resume there instead of restarting at step 1.
  useEffect(() => {
    try {
      if (sessionStorage.getItem('pm_wizard_resume_last') === '1') {
        sessionStorage.removeItem('pm_wizard_resume_last')
        setStep(STEPS.length - 1)
      }
    } catch { /* sessionStorage unavailable — ignore */ }
  }, [])
  const [businessName, setBusinessName] = useState(initial.businessName === 'My Business' ? '' : initial.businessName)
  const [website, setWebsite] = useState(initial.website ?? '')
  const [phone, setPhone] = useState(initial.phone ?? '')
  const [email, setEmail] = useState(initial.publicEmail ?? initial.signupEmail ?? '')
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl ?? '')
  const [accent, setAccent] = useState(initial.emailAccentColor || DEFAULT_ACCENT)
  const [gradStart, setGradStart] = useState(initial.appGradientStart || DEFAULT_GRADIENT_START)
  const [gradEnd, setGradEnd] = useState(initial.appGradientEnd || DEFAULT_GRADIENT_END)
  // Pre-fill a starter note for fresh trainers; keep an existing one untouched.
  const [note, setNote] = useState(initial.clientWelcomeNote?.trim() ? initial.clientWelcomeNote : STARTER_NOTES[0])
  const [starterIdx, setStarterIdx] = useState(0)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  // Grow the welcome-note textarea to fit its content — on typing, on the
  // pre-filled starter, and when "Try another" swaps the text. Keyed on `step`
  // too so it sizes correctly once step 3 actually mounts the textarea.
  useEffect(() => {
    const el = noteRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [note, step])

  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [seedError, setSeedError] = useState<string | null>(null)
  // Palette pulled from the uploaded logo — lets step 3 offer "Match my logo".
  const [logoPalette, setLogoPalette] = useState<LogoPalette | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Apply a logo-derived palette to the brand colours (used on upload and from
  // the "Match my logo" button on the colours step).
  function applyPalette(p: LogoPalette) {
    setGradStart(p.start)
    setGradEnd(p.end)
    setAccent(p.accent)
  }

  // Step through the ready-made welcome notes; the chosen one drops into the
  // editable box to tweak. Purely local — no network call.
  function pickStarter(dir: number) {
    const i = (starterIdx + dir + STARTER_NOTES.length) % STARTER_NOTES.length
    setStarterIdx(i)
    setNote(STARTER_NOTES[i])
  }

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
      // Pull the brand colours straight from the logo and pre-fill step 3.
      // Extracted from the local file (same-origin) so the canvas isn't tainted.
      const palette = await extractLogoColors(file).catch(() => null)
      if (palette) {
        setLogoPalette(palette)
        applyPalette(palette)
      }
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

  // Load sample data into the trainer's own account, then finish the wizard so
  // they land on a populated dashboard (with the "remove sample data" banner).
  async function loadSampleData() {
    setSeeding(true)
    setSeedError(null)
    try {
      const res = await fetch('/api/trainer/sample-data/seed', { method: 'POST' })
      if (res.ok) { await onComplete(); return }
      const body = await res.json().catch(() => ({}))
      setSeedError(typeof body.error === 'string' ? body.error : 'Could not load sample data. Please try again.')
    } catch {
      setSeedError('Could not load sample data. Please try again.')
    } finally {
      setSeeding(false)
    }
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
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70 mb-2">{step === 0 ? STEPS[0] : `Step ${step} of ${STEPS.length - 1} · ${STEPS[step]}`}</p>
            <div className="flex gap-1.5">
              {STEPS.slice(1).map((_, i) => (
                <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${i + 1 <= step ? 'bg-white' : 'bg-white/25'}`} />
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
              {STEPS.slice(1).map((_, i) => <div key={i} className={`h-1.5 flex-1 rounded-full ${i + 1 <= step ? 'bg-white' : 'bg-white/25'}`} />)}
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

                <MobilePreview show={showPhone} businessName={businessName} logoUrl={logoUrl} gradStart={gradStart} gradEnd={gradEnd} note={note} />
              </div>
            )}

            {step === 2 && (
              <div key="s2">
                <StepHead title="Your colours" sub="Pick the gradient your clients see on buttons and highlights — the preview updates live." />
                {logoPalette && (
                  <div className="mt-4 flex items-center gap-2 rounded-xl bg-teal-50 border border-teal-100 px-3 py-2.5">
                    <span className="flex items-center gap-1">
                      {[logoPalette.start, logoPalette.end, logoPalette.accent].map((c, i) => (
                        <span key={i} className="h-4 w-4 rounded-full ring-1 ring-black/10" style={{ backgroundColor: c }} />
                      ))}
                    </span>
                    <p className="text-xs text-slate-600 flex-1">Pulled from your logo.</p>
                    <button type="button" onClick={() => applyPalette(logoPalette)} className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 px-3 h-8 text-xs font-semibold text-white transition-colors">
                      <Wand2 className="h-3.5 w-3.5" /> Match my logo
                    </button>
                  </div>
                )}
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
                <StepHead title="Say hello" sub="A short, warm welcome shown on your clients’ home screen. We’ve written one to start from — tweak it to sound like you." />
                <div className="flex items-center justify-between mt-6 mb-2">
                  <label className="block text-sm font-medium text-slate-700">Welcome note</label>
                  <div className="flex items-center gap-1.5">
                    <div className="flex items-center rounded-lg border border-slate-200 bg-white">
                      <button type="button" onClick={() => pickStarter(-1)} aria-label="Previous starter" className="h-8 w-8 grid place-items-center text-slate-500 hover:text-teal-600 hover:bg-teal-50 rounded-l-lg transition-colors">
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <span className="px-1 w-[5.5rem] text-center text-xs font-medium text-slate-600 select-none">{STARTER_LABELS[starterIdx]}</span>
                      <button type="button" onClick={() => pickStarter(1)} aria-label="Next starter" className="h-8 w-8 grid place-items-center text-slate-500 hover:text-teal-600 hover:bg-teal-50 rounded-r-lg transition-colors">
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
                <textarea ref={noteRef} value={note} onChange={e => setNote(e.target.value.slice(0, 500))} rows={4} placeholder="Welcome! So glad to have you and your pup with us. Tap around — your sessions, homework and progress all live here. — the team" className="w-full min-h-[7rem] resize-none overflow-hidden rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-[15px] leading-relaxed focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/70 focus:border-transparent transition" />
                <p className="text-xs text-slate-400 mt-1.5">{note.length}/500 · edit it freely — this is just a starting point.</p>
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
                <Link href="/preview-as" onClick={() => { try { sessionStorage.setItem('pm_wizard_resume_last', '1') } catch { /* ignore */ } }} className="mt-6 inline-flex items-center gap-2 rounded-2xl px-6 h-12 text-sm font-semibold text-white shadow-lg hover:-translate-y-px transition-transform" style={{ backgroundImage: brandGradient }}>
                  See the client app <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            )}

            {step === 5 && (
              <div className="max-w-md mx-auto py-2" key="s5">
                <div className="text-center">
                  <div className="mx-auto h-16 w-16 rounded-2xl flex items-center justify-center shadow-lg" style={{ backgroundImage: brandGradient }}>
                    <FlaskConical className="h-8 w-8 text-white" />
                  </div>
                  <h2 className="font-display text-2xl font-bold text-slate-900 mt-5 tracking-tight">How do you want to start?</h2>
                  <p className="text-[15px] text-slate-500 mt-2.5 leading-relaxed">Explore with sample data first, or jump straight into setting up your real business.</p>
                </div>

                <div className="mt-6 flex flex-col gap-3 text-left">
                  {/* Explore with sample data → seed + finish */}
                  <button
                    type="button"
                    onClick={loadSampleData}
                    disabled={seeding || busy}
                    className="group flex items-start gap-3 rounded-2xl border-2 border-slate-200 hover:border-teal-400 hover:bg-teal-50/50 p-4 text-left transition-colors disabled:opacity-60"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ backgroundImage: brandGradient }}>
                      {seeding ? <Loader2 className="h-5 w-5 animate-spin" /> : <FlaskConical className="h-5 w-5" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-800">{seeding ? 'Loading sample data…' : 'Explore with sample data'}</span>
                      <span className="block text-[13px] text-slate-500 mt-0.5 leading-relaxed">Fill your account with sample clients, sessions and progress to play with. Wipe it in one click when you&apos;re ready — anything you add yourself stays.</span>
                    </span>
                  </button>

                  {/* Start fresh → finish with a clean slate */}
                  <button
                    type="button"
                    onClick={finish}
                    disabled={busy || seeding}
                    className="group flex items-start gap-3 rounded-2xl border-2 border-slate-200 hover:border-slate-300 hover:bg-slate-50 p-4 text-left transition-colors disabled:opacity-60"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                      <Sparkles className="h-5 w-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-800">Start fresh</span>
                      <span className="block text-[13px] text-slate-500 mt-0.5 leading-relaxed">Go straight to your empty dashboard and set up your real clients and packages.</span>
                    </span>
                  </button>
                </div>

                {seedError && <p className="text-xs text-red-500 mt-3 text-center">{seedError}</p>}
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
              // Last step ("Sample data") provides its own two choices — no
              // separate footer action needed.
              <span />
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

