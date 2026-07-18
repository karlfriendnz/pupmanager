'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BaseLocationSetting } from './base-location-setting'
import { trainerRegionCode } from '@/lib/country'
import { compressImageFile } from '@/lib/compress-image'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { COUNTRIES } from '@/lib/countries'
import { Accordion, AccordionItem } from '@/components/ui/accordion'
import { BrandPreview } from '@/components/brand-preview'
import { DEFAULT_BRAND_COLOR } from '@/lib/brand'
import { TIMEZONES } from '@/lib/timezones'
import { PERSONAS } from '@/lib/onboarding-recommendations'
import { ImagePlus, Loader2 } from 'lucide-react'

const businessSchema = z.object({
  name: z.string().min(2, 'Your name is required'),
  email: z.string().email('Email is required'),
  businessName: z
    .string()
    .min(2, 'Business name is required')
    .refine(s => s.trim().toLowerCase() !== 'my business', { message: 'Please enter your real business name' }),
  phone: z.string().min(5, 'Phone number is required'),
  showPhoneToClients: z.boolean().optional(),
  publicEmail: z.union([z.string().email('Enter a valid email'), z.literal('')]).optional(),
  signupCountry: z.string().optional(),
  timezone: z.string().min(1, 'Timezone is required'),
  landingPage: z.enum(['dashboard', 'schedule']),
})

const designSchema = z.object({
  logoUrl: z.string().url().optional().or(z.literal('')),
  iconUrl: z.string().url().optional().or(z.literal('')),
  // Hex (#rgb / #rrggbb) — empty string clears to default.
  emailAccentColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional().or(z.literal('')),
})

const DEFAULT_EMAIL_ACCENT = DEFAULT_BRAND_COLOR

type BusinessData = z.infer<typeof businessSchema>
type DesignData = z.infer<typeof designSchema>

export function TrainerSettingsForm({
  user,
  profile,
}: {
  user: { name: string | null; email: string; timezone: string; landingPage: string }
  profile: { businessName: string; phone: string | null; showPhoneToClients: boolean; signupCountry: string | null; addressCountry: string | null; publicEmail: string | null; logoUrl: string | null; iconUrl: string | null; emailAccentColor: string | null; baseAddress: string | null; baseLat: number | null; baseLng: number | null; businessRoles: string[] }
}) {
  const router = useRouter()
  const [businessMsg, setBusinessMsg] = useState<string | null>(null)
  const [designMsg, setDesignMsg] = useState<string | null>(null)
  // What the business offers — drives which schedule "add" options appear.
  // Plain state (not RHF) since it's a simple multi-select saved with the form.
  const [bizRoles, setBizRoles] = useState<string[]>(profile.businessRoles ?? [])
  const toggleRole = (id: string) =>
    setBizRoles(prev => (prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]))

  const businessForm = useForm<BusinessData>({
    resolver: zodResolver(businessSchema),
    defaultValues: {
      name: user.name ?? '',
      email: user.email,
      businessName: profile.businessName,
      phone: profile.phone ?? '',
      showPhoneToClients: profile.showPhoneToClients,
      publicEmail: profile.publicEmail ?? '',
      signupCountry: profile.signupCountry ?? '',
      timezone: user.timezone,
      landingPage: user.landingPage === 'schedule' ? 'schedule' : 'dashboard',
    },
  })

  const designForm = useForm<DesignData>({
    resolver: zodResolver(designSchema),
    defaultValues: {
      logoUrl: profile.logoUrl ?? '',
      iconUrl: profile.iconUrl ?? '',
      emailAccentColor: profile.emailAccentColor ?? '',
    },
  })

  const logoUrl = designForm.watch('logoUrl')
  const iconUrl = designForm.watch('iconUrl')
  const emailAccentColor = designForm.watch('emailAccentColor')
  const logoInputRef = useRef<HTMLInputElement>(null)
  const iconInputRef = useRef<HTMLInputElement>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [uploadingIcon, setUploadingIcon] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Upload a branding image AND persist it immediately, so an upload alone
  // "sticks" without the trainer also having to hit Save design.
  async function uploadBranding(
    kind: 'logo' | 'icon',
    field: 'logoUrl' | 'iconUrl',
    file: File,
    setUploading: (b: boolean) => void,
  ) {
    setUploadError(null)
    setDesignMsg(null)
    setUploading(true)
    try {
      const toSend = await compressImageFile(file)
      const fd = new FormData()
      fd.append('file', toSend)
      fd.append('kind', kind)
      const up = await fetch('/api/trainer/branding-image', { method: 'POST', body: fd })
      const body = await up.json().catch(() => ({}))
      if (!up.ok) {
        setUploadError(body.error ?? 'Upload failed.')
        return
      }
      await persistBranding(field, body.url)
    } finally {
      setUploading(false)
    }
  }

  // Persist a single branding field (also used by Remove, which passes '').
  async function persistBranding(field: 'logoUrl' | 'iconUrl', url: string) {
    designForm.setValue(field, url, { shouldDirty: false })
    const res = await fetch('/api/trainer/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: url }),
    })
    if (res.ok) {
      setDesignMsg('Saved!')
      router.refresh()
    } else {
      setUploadError('Uploaded, but saving failed — please try again.')
    }
  }

  async function saveBusiness(data: BusinessData) {
    setBusinessMsg(null)
    const [r1, r2] = await Promise.all([
      fetch('/api/user', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: data.name, timezone: data.timezone, landingPage: data.landingPage }) }),
      fetch('/api/trainer/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessName: data.businessName, phone: data.phone, showPhoneToClients: data.showPhoneToClients ?? false, publicEmail: data.publicEmail ?? '', signupCountry: data.signupCountry ?? '', businessRoles: bizRoles }) }),
    ])
    setBusinessMsg(r1.ok && r2.ok ? 'Saved!' : 'Failed to save.')
    router.refresh()
  }

  async function saveDesign(data: DesignData) {
    setDesignMsg(null)
    const res = await fetch('/api/trainer/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        logoUrl: data.logoUrl,
        iconUrl: data.iconUrl,
        emailAccentColor: data.emailAccentColor,
      }),
    })
    setDesignMsg(res.ok ? 'Saved!' : 'Failed to save.')
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {/* Left column — the business details form */}
      <div className="min-w-0 lg:flex-1">
        <Accordion>
      {/* Business details */}
      <AccordionItem title="Business details" subtitle="Your name, business name and contact info" defaultOpen>
        {businessMsg && <Alert variant={businessMsg === 'Saved!' ? 'success' : 'error'} className="mb-3">{businessMsg}</Alert>}
        <form onSubmit={businessForm.handleSubmit(saveBusiness)} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Your name *" error={businessForm.formState.errors.name?.message} {...businessForm.register('name')} />
          <Input label="Email address *" type="email" disabled error={businessForm.formState.errors.email?.message} {...businessForm.register('email')} />
          <Input label="Business name *" error={businessForm.formState.errors.businessName?.message} {...businessForm.register('businessName')} />
          <Input label="Phone number *" type="tel" error={businessForm.formState.errors.phone?.message} {...businessForm.register('phone')} />

          <label className="flex items-start gap-2 text-sm text-slate-600 sm:col-span-2">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              {...businessForm.register('showPhoneToClients')}
            />
            <span>Show my phone number to clients (on the in-app Help page and &ldquo;Call&rdquo; button). Leave unticked to keep it private.</span>
          </label>

          <div className="sm:col-span-2">
            <Input
              label="Business email"
              type="email"
              hint="Shown to clients as your business contact. Separate from your sign-in email above. Leave blank to skip."
              error={businessForm.formState.errors.publicEmail?.message}
              {...businessForm.register('publicEmail')}
            />
          </div>

          <div className="sm:col-span-2">
            <BaseLocationSetting initialBase={{ address: profile.baseAddress, lat: profile.baseLat, lng: profile.baseLng }} region={trainerRegionCode(profile)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Country</label>
            <select className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" {...businessForm.register('signupCountry')}>
              <option value="">Select your country…</option>
              {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
            <p className="text-xs text-slate-500">Helps us tailor PupManager to your region. Usually set automatically — choose it here if it&apos;s missing.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Timezone *</label>
            <select className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" {...businessForm.register('timezone')}>
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">When you open the app, start on</label>
            <select className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" {...businessForm.register('landingPage')}>
              <option value="dashboard">Dashboard</option>
              <option value="schedule">Schedule</option>
            </select>
            <p className="text-xs text-slate-500">The page you land on each time you open PupManager.</p>
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label className="text-sm font-medium text-slate-700">What your business offers</label>
            <p className="text-xs text-slate-500">Tailors the app to you — e.g. the schedule only offers group walks or classes if you run them.</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {PERSONAS.map(p => {
                const on = bizRoles.includes(p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleRole(p.id)}
                    aria-pressed={on}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${on ? 'border-teal-600 bg-teal-50 text-teal-900' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}
                  >
                    <span aria-hidden>{p.icon}</span>
                    <span>{p.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <Button type="submit" size="sm" className="self-start sm:col-span-2" loading={businessForm.formState.isSubmitting}>Save business details</Button>
        </form>
      </AccordionItem>
        </Accordion>
      </div>

      {/* Right column — branding/design */}
      <div className="min-w-0 lg:flex-1">
        <Accordion>
      {/* Design */}
      <AccordionItem title="Design" subtitle="Logo and brand colour" defaultOpen>
        <div className="flex flex-col gap-6">
        <div className="min-w-0 flex-1">
        {designMsg && <Alert variant={designMsg === 'Saved!' ? 'success' : 'error'} className="mb-3">{designMsg}</Alert>}
        <form onSubmit={designForm.handleSubmit(saveDesign)} className="flex flex-col gap-4">
          {/* Logo upload */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-slate-700">Logo</label>
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="Logo" className="h-full w-full object-cover" />
                ) : (
                  <ImagePlus className="h-5 w-5 text-slate-400" />
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Button type="button" size="sm" variant="ghost" onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo}>
                  {uploadingLogo ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Uploading…</> : (logoUrl ? 'Replace' : 'Upload logo')}
                </Button>
                {logoUrl && (
                  <button type="button" onClick={() => persistBranding('logoUrl', '')} className="text-xs text-slate-400 hover:text-red-500 self-start">
                    Remove
                  </button>
                )}
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) uploadBranding('logo', 'logoUrl', f, setUploadingLogo)
                  e.target.value = ''
                }}
              />
            </div>
          </div>

          {/* Icon upload — a square mark, distinct from the wide logo. */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-slate-700">Icon</label>
            <p className="text-xs text-slate-400 -mt-1">A square mark — used as your app icon and small avatar. Your logo is the full wordmark.</p>
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                {iconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={iconUrl} alt="Icon" className="h-full w-full object-cover" />
                ) : (
                  <ImagePlus className="h-5 w-5 text-slate-400" />
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Button type="button" size="sm" variant="ghost" onClick={() => iconInputRef.current?.click()} disabled={uploadingIcon}>
                  {uploadingIcon ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Uploading…</> : (iconUrl ? 'Replace' : 'Upload icon')}
                </Button>
                {iconUrl && (
                  <button type="button" onClick={() => persistBranding('iconUrl', '')} className="text-xs text-slate-400 hover:text-red-500 self-start">
                    Remove
                  </button>
                )}
              </div>
              <input
                ref={iconInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) uploadBranding('icon', 'iconUrl', f, setUploadingIcon)
                  e.target.value = ''
                }}
              />
            </div>
          </div>

          {/* Brand colour — one solid colour across the client app + emails. */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-slate-700">Brand colour</label>
            <p className="text-xs text-slate-400 -mt-1">One colour for your brand — used across your clients&apos; app and the accent strip on your emails.</p>
            <div className="flex items-center gap-3">
              <div
                className="h-12 w-12 rounded-xl border border-slate-200 flex-shrink-0"
                style={{ background: emailAccentColor || DEFAULT_EMAIL_ACCENT }}
              />
              <input
                type="color"
                value={emailAccentColor || DEFAULT_EMAIL_ACCENT}
                onChange={e => designForm.setValue('emailAccentColor', e.target.value, { shouldDirty: true })}
                className="h-10 w-14 rounded border border-slate-200 cursor-pointer"
                aria-label="Brand colour"
              />
              <Input
                type="text"
                value={emailAccentColor ?? ''}
                onChange={e => designForm.setValue('emailAccentColor', e.target.value, { shouldDirty: true })}
                placeholder={DEFAULT_EMAIL_ACCENT}
                className="w-32 font-mono text-sm"
              />
              {emailAccentColor && (
                <button
                  type="button"
                  onClick={() => designForm.setValue('emailAccentColor', '', { shouldDirty: true })}
                  className="text-xs text-slate-400 hover:text-red-500"
                >
                  Reset
                </button>
              )}
            </div>
            {designForm.formState.errors.emailAccentColor && (
              <p className="text-xs text-red-500">Use a hex colour like #2a9da9 or #fff.</p>
            )}
          </div>

          {uploadError && <Alert variant="error">{uploadError}</Alert>}

          <Button type="submit" size="sm" className="self-start" loading={designForm.formState.isSubmitting}>Save design</Button>
        </form>
        </div>
        <div className="hidden lg:block">
          <div className="w-[228px] mx-auto">
            <BrandPreview
              businessName={businessForm.watch('businessName')}
              logoUrl={logoUrl || ''}
              iconUrl={iconUrl || ''}
              brandColor={emailAccentColor || DEFAULT_BRAND_COLOR}
              note=""
            />
            <p className="mt-3 text-center text-xs text-slate-400">Live preview of your client app</p>
          </div>
        </div>
        </div>
      </AccordionItem>
        </Accordion>
      </div>
    </div>
  )
}
