'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { Accordion, AccordionItem } from '@/components/ui/accordion'
import { ClientLoginLinkCard } from './client-login-link-card'
import { TIMEZONES } from '@/lib/timezones'
import { ImagePlus, Loader2 } from 'lucide-react'

const businessSchema = z.object({
  name: z.string().min(2, 'Your name is required'),
  email: z.string().email('Email is required'),
  businessName: z
    .string()
    .min(2, 'Business name is required')
    .refine(s => s.trim().toLowerCase() !== 'my business', { message: 'Please enter your real business name' }),
  phone: z.string().min(5, 'Phone number is required'),
  timezone: z.string().min(1, 'Timezone is required'),
})

const designSchema = z.object({
  logoUrl: z.string().url().optional().or(z.literal('')),
  dashboardBgUrl: z.string().url().optional().or(z.literal('')),
  // Hex (#rgb / #rrggbb) — empty string clears to default.
  emailAccentColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional().or(z.literal('')),
  appGradientStart: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional().or(z.literal('')),
  appGradientEnd: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional().or(z.literal('')),
})

const DEFAULT_EMAIL_ACCENT = '#7c3aed'
const DEFAULT_GRADIENT_START = '#2a9da9'
const DEFAULT_GRADIENT_END = '#1f818c'

const templateSchema = z.object({
  inviteTemplate: z.string().min(20),
})

type BusinessData = z.infer<typeof businessSchema>
type DesignData = z.infer<typeof designSchema>
type TemplateData = z.infer<typeof templateSchema>

const DEFAULT_TEMPLATE = `Hi {{clientName}},

I'd like to invite you to PupManager to help us track {{dogName}}'s training progress.

Click below to get started!

Your Trainer`

export function TrainerSettingsForm({
  user,
  profile,
  clientLoginSlug,
  appUrl,
}: {
  user: { name: string | null; email: string; timezone: string }
  profile: { businessName: string; phone: string | null; logoUrl: string | null; dashboardBgUrl: string | null; inviteTemplate: string | null; emailAccentColor: string | null; appGradientStart: string | null; appGradientEnd: string | null }
  clientLoginSlug: string | null
  appUrl: string
}) {
  const router = useRouter()
  const [businessMsg, setBusinessMsg] = useState<string | null>(null)
  const [designMsg, setDesignMsg] = useState<string | null>(null)
  const [templateMsg, setTemplateMsg] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const businessForm = useForm<BusinessData>({
    resolver: zodResolver(businessSchema),
    defaultValues: {
      name: user.name ?? '',
      email: user.email,
      businessName: profile.businessName,
      phone: profile.phone ?? '',
      timezone: user.timezone,
    },
  })

  const designForm = useForm<DesignData>({
    resolver: zodResolver(designSchema),
    defaultValues: {
      logoUrl: profile.logoUrl ?? '',
      dashboardBgUrl: profile.dashboardBgUrl ?? '',
      emailAccentColor: profile.emailAccentColor ?? '',
      appGradientStart: profile.appGradientStart ?? '',
      appGradientEnd: profile.appGradientEnd ?? '',
    },
  })

  const logoUrl = designForm.watch('logoUrl')
  const dashboardBgUrl = designForm.watch('dashboardBgUrl')
  const emailAccentColor = designForm.watch('emailAccentColor')
  const appGradientStart = designForm.watch('appGradientStart')
  const appGradientEnd = designForm.watch('appGradientEnd')
  const logoInputRef = useRef<HTMLInputElement>(null)
  const bgInputRef = useRef<HTMLInputElement>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [uploadingBg, setUploadingBg] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  async function uploadBrandingImage(kind: 'logo' | 'background', file: File) {
    setUploadError(null)
    const setUploading = kind === 'logo' ? setUploadingLogo : setUploadingBg
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('kind', kind)
      const res = await fetch('/api/trainer/branding-image', { method: 'POST', body: fd })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setUploadError(body.error ?? 'Upload failed.')
        return
      }
      designForm.setValue(kind === 'logo' ? 'logoUrl' : 'dashboardBgUrl', body.url, { shouldDirty: true })
    } finally {
      setUploading(false)
    }
  }

  const templateForm = useForm<TemplateData>({
    resolver: zodResolver(templateSchema),
    defaultValues: { inviteTemplate: profile.inviteTemplate ?? DEFAULT_TEMPLATE },
  })

  async function saveBusiness(data: BusinessData) {
    setBusinessMsg(null)
    const [r1, r2] = await Promise.all([
      fetch('/api/user', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: data.name, timezone: data.timezone }) }),
      fetch('/api/trainer/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessName: data.businessName, phone: data.phone }) }),
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
        dashboardBgUrl: data.dashboardBgUrl,
        emailAccentColor: data.emailAccentColor,
        appGradientStart: data.appGradientStart,
        appGradientEnd: data.appGradientEnd,
      }),
    })
    setDesignMsg(res.ok ? 'Saved!' : 'Failed to save.')
    router.refresh()
  }

  async function saveTemplate(data: TemplateData) {
    setTemplateMsg(null)
    const res = await fetch('/api/trainer/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteTemplate: data.inviteTemplate }),
    })
    setTemplateMsg(res.ok ? 'Saved!' : 'Failed to save.')
  }

  async function deleteAccount() {
    setDeleting(true)
    await fetch('/api/user/delete', { method: 'DELETE' })
    router.push('/login')
  }

  return (
    <Accordion>
      {/* Business details */}
      <AccordionItem title="Business details" subtitle="Your name, business name and contact info" defaultOpen>
        {businessMsg && <Alert variant={businessMsg === 'Saved!' ? 'success' : 'error'} className="mb-3">{businessMsg}</Alert>}
        <form onSubmit={businessForm.handleSubmit(saveBusiness)} className="flex flex-col gap-4">
          <Input label="Your name *" error={businessForm.formState.errors.name?.message} {...businessForm.register('name')} />
          <Input label="Email address *" type="email" disabled error={businessForm.formState.errors.email?.message} {...businessForm.register('email')} />
          <Input label="Business name *" error={businessForm.formState.errors.businessName?.message} {...businessForm.register('businessName')} />
          <Input label="Phone number *" type="tel" error={businessForm.formState.errors.phone?.message} {...businessForm.register('phone')} />

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Timezone *</label>
            <select className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" {...businessForm.register('timezone')}>
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>

          <Button type="submit" size="sm" className="self-start" loading={businessForm.formState.isSubmitting}>Save business details</Button>
        </form>
      </AccordionItem>

      {/* Design */}
      <AccordionItem title="Design" subtitle="Logo, dashboard background and brand colours">
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
                  <button type="button" onClick={() => designForm.setValue('logoUrl', '', { shouldDirty: true })} className="text-xs text-slate-400 hover:text-red-500 self-start">
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
                  if (f) uploadBrandingImage('logo', f)
                  e.target.value = ''
                }}
              />
            </div>
          </div>

          {/* Dashboard background upload */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-slate-700">Client dashboard background</label>
            <p className="text-xs text-slate-400 -mt-1">Shown as a banner on each client&apos;s home screen. Wide / landscape images work best.</p>
            <div className="flex items-stretch gap-4">
              <div className="h-24 w-40 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                {dashboardBgUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={dashboardBgUrl} alt="Dashboard background" className="h-full w-full object-cover" />
                ) : (
                  <ImagePlus className="h-5 w-5 text-slate-400" />
                )}
              </div>
              <div className="flex flex-col gap-1 justify-center">
                <Button type="button" size="sm" variant="ghost" onClick={() => bgInputRef.current?.click()} disabled={uploadingBg}>
                  {uploadingBg ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Uploading…</> : (dashboardBgUrl ? 'Replace' : 'Upload background')}
                </Button>
                {dashboardBgUrl && (
                  <button type="button" onClick={() => designForm.setValue('dashboardBgUrl', '', { shouldDirty: true })} className="text-xs text-slate-400 hover:text-red-500 self-start">
                    Remove
                  </button>
                )}
              </div>
              <input
                ref={bgInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) uploadBrandingImage('background', f)
                  e.target.value = ''
                }}
              />
            </div>
          </div>

          {/* Email accent / top-border colour. */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-slate-700">Reply email border colour</label>
            <p className="text-xs text-slate-400 -mt-1">The thin accent strip across the top of the email card. Match it to your brand.</p>
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
                aria-label="Email accent colour"
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
          </div>

          {/* Client-app accent gradient (start + end). */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-slate-700">App accent gradient</label>
            <p className="text-xs text-slate-400 -mt-1">The two colours used across your clients’ app — buttons, the “Up next” card, highlights. Start fades into end.</p>
            <div
              className="h-14 w-full rounded-2xl border border-slate-200"
              style={{ backgroundImage: `linear-gradient(135deg, ${appGradientStart || DEFAULT_GRADIENT_START}, ${appGradientEnd || DEFAULT_GRADIENT_END})` }}
            />
            <div className="flex flex-wrap items-center gap-4 mt-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 w-9">Start</span>
                <input
                  type="color"
                  value={appGradientStart || DEFAULT_GRADIENT_START}
                  onChange={e => designForm.setValue('appGradientStart', e.target.value, { shouldDirty: true })}
                  className="h-10 w-14 rounded border border-slate-200 cursor-pointer"
                  aria-label="Gradient start colour"
                />
                <Input type="text" value={appGradientStart ?? ''} onChange={e => designForm.setValue('appGradientStart', e.target.value, { shouldDirty: true })} placeholder={DEFAULT_GRADIENT_START} className="w-28 font-mono text-sm" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 w-9">End</span>
                <input
                  type="color"
                  value={appGradientEnd || DEFAULT_GRADIENT_END}
                  onChange={e => designForm.setValue('appGradientEnd', e.target.value, { shouldDirty: true })}
                  className="h-10 w-14 rounded border border-slate-200 cursor-pointer"
                  aria-label="Gradient end colour"
                />
                <Input type="text" value={appGradientEnd ?? ''} onChange={e => designForm.setValue('appGradientEnd', e.target.value, { shouldDirty: true })} placeholder={DEFAULT_GRADIENT_END} className="w-28 font-mono text-sm" />
              </div>
              {(appGradientStart || appGradientEnd) && (
                <button
                  type="button"
                  onClick={() => { designForm.setValue('appGradientStart', '', { shouldDirty: true }); designForm.setValue('appGradientEnd', '', { shouldDirty: true }) }}
                  className="text-xs text-slate-400 hover:text-red-500"
                >
                  Reset
                </button>
              )}
            </div>
            {designForm.formState.errors.emailAccentColor && (
              <p className="text-xs text-red-500">Use a hex colour like #7c3aed or #fff.</p>
            )}
          </div>

          {uploadError && <Alert variant="error">{uploadError}</Alert>}

          <Button type="submit" size="sm" className="self-start" loading={designForm.formState.isSubmitting}>Save design</Button>
        </form>
      </AccordionItem>

      {/* Website — branded client login link for the trainer's own site */}
      <AccordionItem title="Website" subtitle="A branded sign-in link for your clients">
        <ClientLoginLinkCard slug={clientLoginSlug} baseUrl={appUrl} embedded />
      </AccordionItem>

      {/* Invite email template */}
      <AccordionItem title="Default invite email template" subtitle="The default copy sent when you invite a client">
        <p className="text-xs text-slate-400 mb-4">
          Use <code className="bg-slate-100 px-1 rounded">{'{{clientName}}'}</code> and{' '}
          <code className="bg-slate-100 px-1 rounded">{'{{dogName}}'}</code> as placeholders.
        </p>
        {templateMsg && <Alert variant={templateMsg === 'Saved!' ? 'success' : 'error'} className="mb-3">{templateMsg}</Alert>}
        <form onSubmit={templateForm.handleSubmit(saveTemplate)} className="flex flex-col gap-4">
          <textarea
            rows={8}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
            {...templateForm.register('inviteTemplate')}
          />
          {templateForm.formState.errors.inviteTemplate && (
            <p className="text-xs text-red-500">{templateForm.formState.errors.inviteTemplate.message}</p>
          )}
          <Button type="submit" size="sm" className="self-start" loading={templateForm.formState.isSubmitting}>Save template</Button>
        </form>
      </AccordionItem>

      {/* Account deletion */}
      <AccordionItem title="Danger zone" subtitle="Permanently delete your account" danger>
        <p className="text-sm text-slate-500 mb-4">
          Deleting your account is permanent and will remove all your data including your client roster.
        </p>
        {!deleteConfirm ? (
          <Button variant="danger" size="sm" onClick={() => setDeleteConfirm(true)}>
            Delete my account
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <Alert variant="error">Are you sure? This cannot be undone.</Alert>
            <div className="flex gap-2">
              <Button variant="danger" size="sm" loading={deleting} onClick={deleteAccount}>
                Yes, delete my account
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </AccordionItem>
    </Accordion>
  )
}
