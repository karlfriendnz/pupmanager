'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { TIMEZONES } from '@/lib/timezones'
import { ImagePlus, Loader2 } from 'lucide-react'

const profileSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  businessName: z.string().min(2),
  phone: z.string().optional(),
  logoUrl: z.string().url().optional().or(z.literal('')),
  dashboardBgUrl: z.string().url().optional().or(z.literal('')),
})

const notifSchema = z.object({
  notifyEmail: z.boolean(),
  notifyPush: z.boolean(),
  timezone: z.string(),
})

const templateSchema = z.object({
  inviteTemplate: z.string().min(20),
})

type ProfileData = z.infer<typeof profileSchema>
type NotifData = z.infer<typeof notifSchema>
type TemplateData = z.infer<typeof templateSchema>

const DEFAULT_TEMPLATE = `Hi {{clientName}},

I'd like to invite you to PupManager to help us track {{dogName}}'s training progress.

Click below to get started!

Your Trainer`

export function TrainerSettingsForm({
  user,
  profile,
}: {
  user: { name: string | null; email: string; timezone: string; notifyEmail: boolean; notifyPush: boolean }
  profile: { businessName: string; phone: string | null; logoUrl: string | null; dashboardBgUrl: string | null; inviteTemplate: string | null }
}) {
  const router = useRouter()
  const [profileMsg, setProfileMsg] = useState<string | null>(null)
  const [notifMsg, setNotifMsg] = useState<string | null>(null)
  const [templateMsg, setTemplateMsg] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const profileForm = useForm<ProfileData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: user.name ?? '',
      email: user.email,
      businessName: profile.businessName,
      phone: profile.phone ?? '',
      logoUrl: profile.logoUrl ?? '',
      dashboardBgUrl: profile.dashboardBgUrl ?? '',
    },
  })

  const logoUrl = profileForm.watch('logoUrl')
  const dashboardBgUrl = profileForm.watch('dashboardBgUrl')
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
      profileForm.setValue(kind === 'logo' ? 'logoUrl' : 'dashboardBgUrl', body.url, { shouldDirty: true })
    } finally {
      setUploading(false)
    }
  }

  const notifForm = useForm<NotifData>({
    resolver: zodResolver(notifSchema),
    defaultValues: {
      notifyEmail: user.notifyEmail,
      notifyPush: user.notifyPush,
      timezone: user.timezone,
    },
  })

  const templateForm = useForm<TemplateData>({
    resolver: zodResolver(templateSchema),
    defaultValues: { inviteTemplate: profile.inviteTemplate ?? DEFAULT_TEMPLATE },
  })

  async function saveProfile(data: ProfileData) {
    setProfileMsg(null)
    const [r1, r2] = await Promise.all([
      fetch('/api/user', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: data.name }) }),
      fetch('/api/trainer/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessName: data.businessName, phone: data.phone, logoUrl: data.logoUrl, dashboardBgUrl: data.dashboardBgUrl }) }),
    ])
    setProfileMsg(r1.ok && r2.ok ? 'Saved!' : 'Failed to save.')
    router.refresh()
  }

  async function saveNotifs(data: NotifData) {
    setNotifMsg(null)
    const res = await fetch('/api/user', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    setNotifMsg(res.ok ? 'Saved!' : 'Failed to save.')
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
    <div className="flex flex-col gap-8">
      {/* Profile */}
      <Card>
        <CardBody className="pt-5">
          <h2 className="font-semibold text-slate-900 mb-4">Profile</h2>
          {profileMsg && <Alert variant={profileMsg === 'Saved!' ? 'success' : 'error'} className="mb-3">{profileMsg}</Alert>}
          <form onSubmit={profileForm.handleSubmit(saveProfile)} className="flex flex-col gap-4">
            <Input label="Your name" error={profileForm.formState.errors.name?.message} {...profileForm.register('name')} />
            <Input label="Email address" type="email" disabled error={profileForm.formState.errors.email?.message} {...profileForm.register('email')} />
            <Input label="Business name" error={profileForm.formState.errors.businessName?.message} {...profileForm.register('businessName')} />
            <Input label="Phone number" type="tel" error={profileForm.formState.errors.phone?.message} {...profileForm.register('phone')} />

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
                    <button type="button" onClick={() => profileForm.setValue('logoUrl', '', { shouldDirty: true })} className="text-xs text-slate-400 hover:text-red-500 self-start">
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
                    <button type="button" onClick={() => profileForm.setValue('dashboardBgUrl', '', { shouldDirty: true })} className="text-xs text-slate-400 hover:text-red-500 self-start">
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

            {uploadError && <Alert variant="error">{uploadError}</Alert>}

            <Button type="submit" size="sm" className="self-start" loading={profileForm.formState.isSubmitting}>Save profile</Button>
          </form>
        </CardBody>
      </Card>

      {/* Notifications & Timezone */}
      <Card>
        <CardBody className="pt-5">
          <h2 className="font-semibold text-slate-900 mb-4">Notifications & Timezone</h2>
          {notifMsg && <Alert variant={notifMsg === 'Saved!' ? 'success' : 'error'} className="mb-3">{notifMsg}</Alert>}
          <form onSubmit={notifForm.handleSubmit(saveNotifs)} className="flex flex-col gap-4">
            <label className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Email notifications</span>
              <input type="checkbox" className="h-5 w-5" {...notifForm.register('notifyEmail')} />
            </label>
            <label className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Push notifications</span>
              <input type="checkbox" className="h-5 w-5" {...notifForm.register('notifyPush')} />
            </label>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">Timezone</label>
              <select className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" {...notifForm.register('timezone')}>
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
            <Button type="submit" size="sm" className="self-start" loading={notifForm.formState.isSubmitting}>Save preferences</Button>
          </form>
        </CardBody>
      </Card>

      {/* Invite email template */}
      <Card>
        <CardBody className="pt-5">
          <h2 className="font-semibold text-slate-900 mb-1">Default invite email template</h2>
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
        </CardBody>
      </Card>

      {/* Account deletion */}
      <Card className="border-red-100">
        <CardBody className="pt-5">
          <h2 className="font-semibold text-red-700 mb-2">Danger zone</h2>
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
        </CardBody>
      </Card>
    </div>
  )
}
