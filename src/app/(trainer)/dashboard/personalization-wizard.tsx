'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, Upload, ImageIcon, ArrowRight, ArrowLeft, Sparkles, PawPrint, Wand2, ChevronLeft, ChevronRight, FlaskConical, Check, Plus, Receipt, CreditCard, Users, Car, ShoppingBag, Trophy, Calendar, NotebookPen, Smartphone, type LucideIcon } from 'lucide-react'
import { BrandPreview } from '@/components/brand-preview'
import { DEFAULT_BRAND_COLOR } from '@/lib/brand'
import { extractLogoColors, type LogoPalette } from '@/lib/logo-colors'
import { compressImageFile } from '@/lib/compress-image'
import { type CurrencyCode } from '@/lib/pricing'
import { type ResolvedFieldConfig } from '@/lib/client-fields'
import { PERSONAS, WIZ_QUESTIONS, MANAGED_ADDON_IDS, recommendedAddons, coreAddonState, packageOptionsFor, questionApplies, landingViewForRoles, type WizAnswers } from '@/lib/onboarding-recommendations'
import { ClientFieldsStep } from './client-fields-step'

// The paged "Your tools" sub-flow is: role picker → tailored "what do you offer?"
// → one question per screen (only those relevant to the chosen roles). Rendered
// inside wizard step 4; the wizard's Back/Continue page through them. The screen
// list is computed per-render from the selected roles (see `screens` below).

// Maps a question's `icon` key to a lucide component (data stays framework-free).
const QUESTION_ICONS: Record<string, LucideIcon> = {
  receipt: Receipt,
  creditCard: CreditCard,
  users: Users,
  car: Car,
  shoppingBag: ShoppingBag,
  trophy: Trophy,
  calendar: Calendar,
  notebook: NotebookPen,
  smartphone: Smartphone,
}

// Drop in the real welcome video here (an MP4 URL or an embed). Until then the
// step shows a branded "coming soon" placeholder.
const WELCOME_VIDEO_URL: string | null = null

// First-run personalization wizard. Replaces the old welcome modal for fresh
// signups: make it yours (logo + name), pick brand colours (live preview),
// add a welcome note, then look through the real client app with a seeded
// sample client. Saves via the existing branding endpoints.

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export type WizardInitial = {
  businessName: string
  logoUrl: string | null
  emailAccentColor: string | null
  clientWelcomeNote: string | null
  // Public contact details (pre-filled from signup where available).
  website: string | null
  phone: string | null
  publicEmail: string | null
  signupEmail: string
  // Currency to quote add-on prices in, and which add-ons are already on.
  currency: CurrencyCode
  enabledAddonIds: string[]
}

// The wizard is a core setup everyone does, plus a client-app section that only
// appears when the trainer wants their clients to have an app. The ordered list
// of step keys is computed per render (STEP_KEYS, inside the component) so those
// extra steps slot in and out cleanly. 'welcome' is the unnumbered intro. The
// step progress indicator is intentionally hidden, so no label map is needed.

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
}: {
  initial: WizardInitial
  onComplete: () => Promise<void> | void
}) {
  const [step, setStep] = useState(0)

  // Lock the page behind the modal while it's open — otherwise the dashboard
  // keeps its own scrollbar and you get two side by side (the modal's inner
  // scroll + the background page's).
  useEffect(() => {
    const prevBody = document.body.style.overflow
    const prevHtml = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevBody
      document.documentElement.style.overflow = prevHtml
    }
  }, [])

  // If we're returning from the client-app preview (opened from the last step),
  // resume there instead of restarting at step 1.
  useEffect(() => {
    try {
      if (sessionStorage.getItem('pm_wizard_resume_last') === '1') {
        sessionStorage.removeItem('pm_wizard_resume_last')
        setStep(STEP_KEYS.length - 1)
      }
    } catch { /* sessionStorage unavailable — ignore */ }
  }, [])
  const [businessName, setBusinessName] = useState(initial.businessName === 'My Business' ? '' : initial.businessName)
  const [website, setWebsite] = useState(initial.website ?? '')
  const [phone, setPhone] = useState(initial.phone ?? '')
  const [email, setEmail] = useState(initial.publicEmail ?? initial.signupEmail ?? '')
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl ?? '')
  const [accent, setAccent] = useState(initial.emailAccentColor || DEFAULT_BRAND_COLOR)
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

  // "Your tools" step — a paged sub-flow. Roles + how-they-work answers drive a
  // recommended add-on set. addonOn is the local source of truth for what's on;
  // we only persist to /api/addons when they leave the step (via Continue), so
  // paid add-ons are confirmed, not charged mid-flow. Only "managed" add-ons
  // (those a question decides on) are ever touched — the always-on free to-do
  // scratchpad is left alone.
  const [extra, setExtra] = useState(0) // index into the computed `screens`
  const [roles, setRoles] = useState<string[]>([])
  // Team emails captured on the team screen — held (not sent) until the owner
  // sends them from the dashboard once set up.
  const [teamEmails, setTeamEmails] = useState<string[]>([''])
  // Nothing is pre-selected — every question starts blank and the trainer picks.
  const [answers, setAnswers] = useState<WizAnswers>({})
  const [addonOn, setAddonOn] = useState<Record<string, boolean>>(() => addonMapFrom({}))

  // "Client form" step — the live built-in field config the step hands up, held
  // here so Continue can persist it through the shared field config. null until
  // the step has loaded (so we never PATCH an empty/half-loaded config).
  const [fieldConfig, setFieldConfig] = useState<ResolvedFieldConfig | null>(null)

  // Build the managed on/off map from a set of answers.
  function addonMapFrom(a: WizAnswers): Record<string, boolean> {
    const rec = recommendedAddons(a)
    const map: Record<string, boolean> = {}
    for (const id of MANAGED_ADDON_IDS) map[id] = rec.has(id)
    return map
  }

  function toggleRole(id: string) {
    setRoles(prev => (prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]))
  }

  // Record an answer for a question (or a follow-up), then recompute add-ons.
  function setAnswer(id: string, optId: string, multi = false) {
    setAnswers(prev => {
      let next: WizAnswers
      if (multi) {
        const cur = Array.isArray(prev[id]) ? (prev[id] as string[]) : []
        next = { ...prev, [id]: cur.includes(optId) ? cur.filter(x => x !== optId) : [...cur, optId] }
      } else {
        next = { ...prev, [id]: optId }
      }
      setAddonOn(addonMapFrom(next))
      return next
    })
  }

  // Sync the chosen add-on set to the server — only managed add-ons that changed
  // from what was already enabled. Called when leaving the step.
  async function persistAddons() {
    const initiallyOn = new Set(initial.enabledAddonIds)
    // Recommended (off-by-default) add-ons + the default-on core add-ons
    // (Client app / Notes / Classes), derived from the answers.
    const desired: Record<string, boolean> = {}
    for (const id of MANAGED_ADDON_IDS) desired[id] = !!addonOn[id]
    Object.assign(desired, coreAddonState(answers))
    const jobs: Promise<unknown>[] = []
    for (const [id, want] of Object.entries(desired)) {
      if (want === initiallyOn.has(id)) continue
      jobs.push(
        fetch('/api/addons', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId: id, active: want }),
        }).catch(() => {}),
      )
    }
    await Promise.all(jobs)
  }

  // Persist the "Client form" choices through the SAME config the quick-add
  // form, create-client form and Settings → Forms all read (mirrors
  // client-fields-config.tsx). No-op until the step has loaded its config.
  async function persistFieldConfig() {
    if (!fieldConfig) return
    await fetch('/api/trainer/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientFieldConfig: fieldConfig }),
    }).catch(() => {})
  }

  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [seedError, setSeedError] = useState<string | null>(null)
  // Palette pulled from the uploaded logo — lets step 3 offer "Match my logo".
  const [logoPalette, setLogoPalette] = useState<LogoPalette | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Apply a logo-derived palette to the brand colour (used on upload and from
  // the "Match my logo" button on the colours step).
  function applyPalette(p: LogoPalette) {
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
        clientWelcomeNote: note.trim(),
        // Persist the chosen personas so the rest of the app can tailor itself
        // (e.g. the schedule "add" options). Only write once picked so an early
        // save on the branding steps never clobbers a prior value with [].
        ...(roles.length ? { businessRoles: roles } : {}),
        // Team emails to invite later — only when they said they have a team.
        pendingTeamInvites: answers.team === 'team'
          ? teamEmails.map(e => e.trim()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
          : [],
      }),
    }).catch(() => {})
  }

  async function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)
    setUploading(true)
    try {
      const toSend = await compressImageFile(file)
      const fd = new FormData()
      fd.append('file', toSend)
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

  // The tools sub-flow's screens, tailored to the chosen roles: role picker →
  // (a "what do you offer?" screen once ≥1 role is picked) → only the questions
  // relevant to those roles.
  const packageOptions = packageOptionsFor(roles)
  const screens: string[] = [
    'roles',
    // Straight after "line of work": offer a look at the platform seeded for
    // their trade, or carry on setting up. Only once they've picked a role, so
    // the sample data can be tailored.
    ...(roles.length ? ['takealook'] : []),
    ...(packageOptions.length ? ['packages'] : []),
    ...WIZ_QUESTIONS.filter(q => questionApplies(q, roles)).map(q => q.id),
  ]

  // Does the trainer want their clients to have an app? Decided by the client-app
  // question in the tools step; until then it defaults to yes. Drives whether the
  // client-app steps (say hello / client form / preview) appear at all.
  const wantsClientApp = answers.clientapp !== 'email' && answers.clientapp !== 'none'

  // The ordered step keys for this run. Core setup for everyone, then the
  // client-app section right after it only if they want an app.
  const STEP_KEYS: string[] = [
    'welcome',
    'business',
    'contact',
    'colour',
    'tools',
    ...(wantsClientApp ? ['sayhello', 'clientform', 'preview'] : []),
    'sample',
  ]
  const stepKey = STEP_KEYS[step] ?? 'sample'

  // Forward nav. Steps 1–3 save the profile then advance. Step 4 pages through
  // the tools sub-flow and only commits the add-ons + advances at the end.
  async function handleNext() {
    if (stepKey === 'tools') {
      if (extra < screens.length - 1) { setExtra(e => e + 1); return }
      setBusy(true)
      try { await persistAddons(); await saveProfile(); setStep(step + 1) } finally { setBusy(false) }
      return
    }
    setBusy(true)
    try {
      await saveProfile()
      // Leaving the "Client form" step commits the field config choices.
      if (stepKey === 'clientform') await persistFieldConfig()
      const target = step + 1
      if (STEP_KEYS[target] === 'tools') setExtra(0) // entering the sub-flow at the role picker
      setStep(target)
    } finally {
      setBusy(false)
    }
  }

  // Back nav. Inside step 4, step back through the sub-flow first; when leaving
  // step 5 backwards, land on the sub-flow's recap rather than its first screen.
  function handleBack() {
    if (stepKey === 'tools' && extra > 0) { setExtra(e => e - 1); return }
    const target = Math.max(0, step - 1)
    if (STEP_KEYS[target] === 'tools') setExtra(screens.length - 1)
    setStep(target)
  }

  // Seed the trainer's home view from their trade (groomers/walkers/sitters open
  // on the Schedule; trainers/behaviourists on the Dashboard). Only when they
  // picked a role; they can still change it in Settings. Fire-and-forget.
  async function persistLandingView() {
    if (!roles.length) return
    await fetch('/api/user', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ landingPage: landingViewForRoles(roles) }),
    }).catch(() => {})
  }

  async function finish() {
    setBusy(true)
    try {
      await saveProfile()
      await persistLandingView()
      await onComplete()
    } finally {
      setBusy(false)
    }
  }

  // Load sample data into the trainer's own account, then finish the wizard so
  // they land on a populated dashboard (with the "remove sample data" banner).
  async function loadSampleData() {
    setSeeding(true)
    setSeedError(null)
    try {
      const res = await fetch('/api/trainer/sample-data/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setSeedError(typeof body.error === 'string' ? body.error : 'Could not load sample data. Please try again.')
        setSeeding(false)
        return
      }
      // Mark the welcome done + tour started (same as finishing) and seed their
      // home view, then do one full navigation so the populated app loads in a
      // single clean pass. A soft router.refresh() here flashes the empty view
      // before the data swaps in; a hard load avoids that. Land them on their
      // persona's home (a groomer opens on the Schedule, not the Dashboard).
      await Promise.all([
        fetch('/api/onboarding/tour/start', { method: 'POST' }),
        fetch('/api/onboarding/welcome/dismiss', { method: 'POST' }),
        persistLandingView(),
      ]).catch(() => {})
      window.location.href = landingViewForRoles(roles) === 'schedule' ? '/schedule' : '/dashboard'
    } catch {
      setSeedError('Could not load sample data. Please try again.')
      setSeeding(false)
    }
  }

  const brandColor = HEX.test(accent) ? accent : DEFAULT_BRAND_COLOR
  // Steps whose content the branded phone preview reflects.
  const showPhone = stepKey === 'business' || stepKey === 'contact' || stepKey === 'colour' || stepKey === 'sayhello'

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-950/70 backdrop-blur-md p-0 md:items-center md:p-4 animate-pm-fade">
      {/* Full-screen on the app (phones); a centred card on desktop. */}
      <div className="w-full h-full max-w-none rounded-none bg-white shadow-none ring-0 overflow-hidden flex flex-col md:h-auto md:max-w-4xl md:rounded-[2rem] md:shadow-[0_30px_80px_-20px_rgba(2,18,28,0.55)] md:ring-1 md:ring-black/5 md:flex-row md:max-h-[94vh] animate-pm-pop">

        {/* ─── Branded stage (desktop) — fixed teal so it never shifts with the trainer's chosen colour ─── */}
        <aside className="hidden md:flex md:w-[42%] relative flex-col justify-between p-8 text-white overflow-hidden" style={{ background: DEFAULT_BRAND_COLOR }}>
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
              <BrandPreview businessName={businessName} logoUrl={logoUrl} brandColor={accent} note={note} />
            ) : (
              <div className="text-center px-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo-wordmark.png" alt="PupManager" className="mx-auto w-full max-w-[240px] object-contain" />
                <p className="mt-6 text-xl font-display font-bold leading-snug">You handle the pups,<br/>we’ll handle the admin.</p>
              </div>
            )}
          </div>

          {/* Step progress intentionally hidden — the flow is short and we don't
              want to signal "lots of steps left". */}
        </aside>

        {/* ─── Content column ─── */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col max-h-none md:max-h-[94vh]">
          {/* mobile brand bar (step progress intentionally hidden) */}
          <div className="md:hidden px-5 pt-5 pb-4 text-white" style={{ background: brandColor }}>
            <div className="flex items-center">
              <span className="text-sm font-semibold truncate">{businessName.trim() || 'PupManager'}</span>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-6 md:px-8 py-6 md:py-7">
            {stepKey === 'welcome' && (
              <div className="max-w-lg mx-auto" key="s-welcome">
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
                <p className="text-[15px] text-slate-500 mt-10 leading-relaxed">
                  So glad you’re here. We built PupManager to give you back the evenings you’ve been losing to admin. Let’s make the app yours, then take a look at exactly what your clients will see — two minutes, tops.
                </p>
              </div>
            )}

            {stepKey === 'business' && (
              <div key="s-business">
                <StepHead title="Make it yours" sub="Your name and logo appear across your clients’ app and emails. We’ve pre-filled what we can — tweak anything." />
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

                <MobilePreview show={showPhone} businessName={businessName} logoUrl={logoUrl} brandColor={accent} note={note} />
              </div>
            )}

            {stepKey === 'contact' && (
              <div key="s-contact">
                <StepHead title="Contact details" sub="How your clients reach you — shown on your booking page, client app and emails. Add what you’re happy to share." />
                <div className="mt-6 grid sm:grid-cols-2 gap-3">
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

                <MobilePreview show={showPhone} businessName={businessName} logoUrl={logoUrl} brandColor={accent} note={note} />
              </div>
            )}

            {stepKey === 'colour' && (
              <div key="s-colour">
                <StepHead title="Your colour" sub="Pick the brand colour your clients see on buttons and highlights — the preview updates live." />
                {logoPalette && (
                  <div className="mt-4 flex items-center gap-2 rounded-xl bg-teal-50 border border-teal-100 px-3 py-2.5">
                    <span className="h-4 w-4 rounded-full ring-1 ring-black/10" style={{ backgroundColor: logoPalette.accent }} />
                    <p className="text-xs text-slate-600 flex-1">Pulled from your logo.</p>
                    <button type="button" onClick={() => applyPalette(logoPalette)} className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 px-3 h-8 text-xs font-semibold text-white transition-colors">
                      <Wand2 className="h-3.5 w-3.5" /> Match my logo
                    </button>
                  </div>
                )}
                <label className="block text-sm font-medium text-slate-700 mt-6 mb-2">Brand colour</label>
                <p className="text-xs text-slate-400 mb-2">One colour for your brand — used across your clients&apos; app and the accent strip on your emails.</p>
                <div className="h-14 w-full rounded-2xl border border-slate-200 mb-3 shadow-inner" style={{ background: brandColor }} />
                <ColorField label="" value={accent} onChange={setAccent} fallback={DEFAULT_BRAND_COLOR} />
                <MobilePreview show={showPhone} businessName={businessName} logoUrl={logoUrl} brandColor={accent} note={note} />
              </div>
            )}

            {stepKey === 'sayhello' && (
              <div key="s-sayhello">
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
                <MobilePreview show={showPhone} businessName={businessName} logoUrl={logoUrl} brandColor={accent} note={note} />
              </div>
            )}

            {stepKey === 'tools' && (() => {
              // Clamp in case the role selection shrank the screen list.
              const screen = screens[Math.min(extra, screens.length - 1)]

              // ── Role picker ──────────────────────────────────────────────
              if (screen === 'roles') {
                return (
                  <div key="s4-roles" className="max-w-md mx-auto py-2">
                    <h2 className="font-display text-2xl font-bold text-slate-900 tracking-tight">What’s your line of work?</h2>
                    <p className="text-sm text-slate-500 mt-1.5">Pick any that apply — we’ll tailor the setup to you.</p>
                    <div className="mt-6 flex flex-col gap-3">
                      {PERSONAS.map(p => {
                        const on = roles.includes(p.id)
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => toggleRole(p.id)}
                            aria-pressed={on}
                            className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-3.5 text-left transition-colors ${on ? 'border-teal-600 bg-teal-50' : 'border-slate-200 hover:border-slate-300'}`}
                          >
                            <span className="text-xl" aria-hidden>{p.icon}</span>
                            <span className={`flex-1 text-[15px] font-medium ${on ? 'text-teal-900' : 'text-slate-700'}`}>{p.label}</span>
                            <span className={`h-5 w-5 rounded-md border-2 flex items-center justify-center ${on ? 'border-teal-600 bg-teal-600' : 'border-slate-300'}`}>
                              {on && <Check className="h-3 w-3 text-white" />}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              }

              // ── "Take a look" — preview the platform seeded for their trade,
              //    or keep setting up. Sits straight after the line-of-work pick.
              if (screen === 'takealook') {
                return (
                  <div key="s4-takealook" className="max-w-md mx-auto py-2">
                    <div className="mx-auto h-16 w-16 rounded-2xl flex items-center justify-center shadow-lg" style={{ background: brandColor }}>
                      <FlaskConical className="h-8 w-8 text-white" />
                    </div>
                    <h2 className="font-display text-2xl font-bold text-slate-900 mt-5 tracking-tight text-center">Want a look first?</h2>
                    <p className="text-[15px] text-slate-500 mt-2.5 leading-relaxed text-center">
                      We can fill your account with sample clients, sessions and progress — tailored to the work you do — so you can explore before you build. Or carry on setting up your real business.
                    </p>

                    <div className="mt-6 flex flex-col gap-3 text-left">
                      {/* Preview → seed sample data tailored to their roles, then explore */}
                      <button
                        type="button"
                        onClick={loadSampleData}
                        disabled={seeding || busy}
                        className="group flex items-start gap-3 rounded-2xl border-2 border-slate-200 hover:border-teal-400 hover:bg-teal-50/50 p-4 text-left transition-colors disabled:opacity-60"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: brandColor }}>
                          {seeding ? <Loader2 className="h-5 w-5 animate-spin" /> : <FlaskConical className="h-5 w-5" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-slate-800">{seeding ? 'Loading your preview…' : `Preview ${businessName.trim() || 'my business'}`}</span>
                          <span className="block text-[13px] text-slate-500 mt-0.5 leading-relaxed">See it in action with sample data in your colours. Wipe it in one click when you&apos;re ready — anything you add yourself stays.</span>
                        </span>
                      </button>

                      {/* Keep setting up → advance through the rest of the tools flow */}
                      <button
                        type="button"
                        onClick={() => setExtra(e => e + 1)}
                        disabled={seeding || busy}
                        className="group flex items-start gap-3 rounded-2xl border-2 border-slate-200 hover:border-slate-300 hover:bg-slate-50 p-4 text-left transition-colors disabled:opacity-60"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                          <ArrowRight className="h-5 w-5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-slate-800">Keep setting up</span>
                          <span className="block text-[13px] text-slate-500 mt-0.5 leading-relaxed">Answer a few quick questions so we can tailor PupManager to how you work.</span>
                        </span>
                      </button>
                    </div>

                    {seedError && <p className="text-xs text-red-500 mt-3 text-center">{seedError}</p>}
                  </div>
                )
              }

              // ── "What do you offer?" — tailored to the chosen roles ───────
              if (screen === 'packages') {
                const selected = Array.isArray(answers.packages) ? (answers.packages as string[]) : []
                return (
                  <div key="s4-packages" className="max-w-md mx-auto py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-600 mb-2">Your packages</p>
                    <h2 className="font-display text-2xl font-bold text-slate-900 tracking-tight">What do you offer?</h2>
                    <p className="text-sm text-slate-500 mt-1.5">Pick any that apply — we’ll set your app up around them.</p>
                    <div className="mt-6 flex flex-col gap-3">
                      {packageOptions.map(opt => {
                        const on = selected.includes(opt.id)
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setAnswer('packages', opt.id, true)}
                            aria-pressed={on}
                            className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-4 text-left transition-colors ${on ? 'border-teal-600 bg-teal-50' : 'border-slate-200 hover:border-slate-300'}`}
                          >
                            <span className={`flex-1 text-[15px] font-medium ${on ? 'text-teal-900' : 'text-slate-700'}`}>{opt.label}</span>
                            <span className={`h-5 w-5 rounded-md border-2 flex items-center justify-center ${on ? 'border-teal-600 bg-teal-600' : 'border-slate-300'}`}>
                              {on && <Check className="h-3 w-3 text-white" />}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              }

              // ── One question per screen ──────────────────────────────────
              const q = WIZ_QUESTIONS.find(x => x.id === screen)!
              const selectedOpt = q.multi ? null : q.options.find(o => o.id === answers[q.id])
              const followUp = selectedOpt?.followUp
              return (
                <div key={`s4-${q.id}`} className="max-w-md mx-auto py-2">
                  {(() => {
                    const Icon = QUESTION_ICONS[q.icon]
                    return Icon ? (
                      <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-50 text-teal-600">
                        <Icon className="h-5 w-5" />
                      </div>
                    ) : null
                  })()}
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-600 mb-2">{q.category}</p>
                  <h2 className="font-display text-2xl font-bold text-slate-900 tracking-tight">{q.q}</h2>
                  {q.multi && <p className="text-sm text-slate-500 mt-1.5">Pick any that apply.</p>}
                  <div className="mt-6 flex flex-col gap-3">
                    {q.options.map(opt => {
                      const selected = q.multi
                        ? Array.isArray(answers[q.id]) && (answers[q.id] as string[]).includes(opt.id)
                        : answers[q.id] === opt.id
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setAnswer(q.id, opt.id, q.multi)}
                          aria-pressed={selected}
                          className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-4 text-left transition-colors ${selected ? 'border-teal-600 bg-teal-50' : 'border-slate-200 hover:border-slate-300'}`}
                        >
                          <span className={`flex-1 text-[15px] font-medium ${selected ? 'text-teal-900' : 'text-slate-700'}`}>{opt.label}</span>
                          <span className={`h-5 w-5 flex items-center justify-center border-2 ${q.multi ? 'rounded-md' : 'rounded-full'} ${selected ? 'border-teal-600 bg-teal-600' : 'border-slate-300'}`}>
                            {selected && <Check className="h-3 w-3 text-white" />}
                          </span>
                        </button>
                      )
                    })}
                  </div>

                  {/* Follow-up revealed by the selected option (e.g. which software) */}
                  {followUp && (
                    <div className="mt-6 border-t border-slate-100 pt-5">
                      <p className="text-[14px] font-semibold text-slate-800 mb-3">{followUp.q}</p>
                      <div className="flex flex-wrap gap-2">
                        {followUp.options.map(fopt => {
                          const fsel = answers[followUp.id] === fopt.id
                          return (
                            <button
                              key={fopt.id}
                              type="button"
                              onClick={() => setAnswer(followUp.id, fopt.id)}
                              aria-pressed={fsel}
                              className={`rounded-xl border px-4 h-11 text-[14px] font-medium transition-colors ${fsel ? 'border-teal-600 bg-teal-50 text-teal-900' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
                            >
                              {fopt.label}
                            </button>
                          )
                        })}
                      </div>
                      {(() => {
                        const chosen = followUp.options.find(o => o.id === answers[followUp.id])
                        if (!chosen || chosen.addons.length > 0) return null
                        return (
                          <p className="mt-3 text-[12px] text-slate-500">
                            We sync directly with Xero today — we’ve noted you use {chosen.label}, and we’ll add more integrations over time.
                          </p>
                        )
                      })()}
                    </div>
                  )}

                  {/* Team emails — captured here, held until they send them from
                      the dashboard once set up (so staff don't open a blank app). */}
                  {q.id === 'team' && answers.team === 'team' && (
                    <div className="mt-6 border-t border-slate-100 pt-5">
                      <p className="text-[14px] font-semibold text-slate-800">Add your team’s emails</p>
                      <p className="mt-0.5 text-[12px] text-slate-500">We’ll hold these — you send the invites from your dashboard once you’re set up, so no one opens a blank system.</p>
                      <div className="mt-3 flex flex-col gap-2">
                        {teamEmails.map((val, i) => (
                          <input
                            key={i}
                            type="email"
                            value={val}
                            onChange={e => setTeamEmails(list => list.map((v, idx) => (idx === i ? e.target.value : v)))}
                            placeholder="name@example.com"
                            className="rounded-xl border border-slate-200 px-3.5 h-11 text-[14px] focus:outline-none focus:ring-2 focus:ring-teal-500"
                          />
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setTeamEmails(list => [...list, ''])}
                        className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-teal-700 hover:underline"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add another
                      </button>
                    </div>
                  )}
                </div>
              )
            })()}

            {stepKey === 'clientform' && (
              <ClientFieldsStep onConfigChange={setFieldConfig} />
            )}

            {stepKey === 'preview' && (() => {
              // No client app? Don't push the client-app preview — show a plain
              // "you're set" for their admin workspace instead.
              const wantsClientApp = answers.clientapp !== 'email' && answers.clientapp !== 'none'
              return (
                <div className="text-center max-w-md mx-auto py-4" key="s5">
                  <div className="mx-auto h-16 w-16 rounded-2xl flex items-center justify-center shadow-lg" style={{ background: brandColor }}>
                    <Sparkles className="h-8 w-8 text-white" />
                  </div>
                  {wantsClientApp ? (
                    <>
                      <h2 className="font-display text-2xl font-bold text-slate-900 mt-5 tracking-tight">You’re set — take a look</h2>
                      <p className="text-[15px] text-slate-500 mt-2.5 leading-relaxed">Here’s a live preview of what your clients see — branded in your colours, with a sample pup. It’s just a demo; nothing’s added to your account.</p>
                      <Link href="/preview-as" onClick={() => { try { sessionStorage.setItem('pm_wizard_resume_last', '1') } catch { /* ignore */ } }} className="mt-6 inline-flex items-center gap-2 rounded-2xl px-6 h-12 text-sm font-semibold text-white shadow-lg hover:-translate-y-px transition-transform" style={{ background: brandColor }}>
                        See the client app <ArrowRight className="h-4 w-4" />
                      </Link>
                    </>
                  ) : (
                    <>
                      <h2 className="font-display text-2xl font-bold text-slate-900 mt-5 tracking-tight">You’re all set</h2>
                      <p className="text-[15px] text-slate-500 mt-2.5 leading-relaxed">Your workspace is ready — scheduling, invoicing and your day-to-day admin in one place. Hit continue to add some sample data to explore, or dive straight in.</p>
                    </>
                  )}
                </div>
              )
            })()}

            {stepKey === 'sample' && (
              <div className="max-w-md mx-auto py-2" key="s-sample">
                <div className="text-center">
                  <div className="mx-auto h-16 w-16 rounded-2xl flex items-center justify-center shadow-lg" style={{ background: brandColor }}>
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
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: brandColor }}>
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
                      <span className="block text-sm font-semibold text-slate-800">Set up my real business</span>
                      <span className="block text-[13px] text-slate-500 mt-0.5 leading-relaxed">Start by choosing what you want to capture about your clients and their dogs — we&apos;ll suggest the usual ones for the work you do.</span>
                    </span>
                  </button>
                </div>

                {seedError && <p className="text-xs text-red-500 mt-3 text-center">{seedError}</p>}
              </div>
            )}
          </div>

          {/* Footer nav — pinned to the bottom; only the middle scrolls. On phones
              it carries the safe-area inset so it clears the home indicator. */}
          <div className="shrink-0 flex items-center justify-between gap-3 px-6 md:px-8 py-4 border-t border-slate-100 bg-white pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button onClick={handleBack} disabled={busy || step === 0} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-slate-700 transition-colors disabled:opacity-0">
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            {stepKey !== 'sample' ? (
              <button onClick={handleNext} disabled={busy} className="inline-flex items-center gap-2 rounded-2xl px-6 h-12 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 shadow-md hover:-translate-y-px transition-all disabled:opacity-60 disabled:hover:translate-y-0">
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
function MobilePreview(props: { show: boolean; businessName: string; logoUrl: string; brandColor: string; note: string }) {
  if (!props.show) return null
  return (
    <div className="md:hidden mt-7 flex justify-center">
      <BrandPreview businessName={props.businessName} logoUrl={props.logoUrl} brandColor={props.brandColor} note={props.note} />
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

