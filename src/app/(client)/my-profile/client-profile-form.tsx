'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { TIMEZONES } from '@/lib/timezones'

/**
 * My Profile — the PERSON, and only the person.
 *
 * Dogs used to live here behind a tab; they now live on /my-dogs, which is the
 * one place a dog owner manages them (add, edit, photo, remove). Notification
 * choices used to be a third tab; they're on /my-notifications. With one
 * section left there is no tab strip — chrome has to earn its space.
 */
export function ClientProfileForm({
  user,
}: {
  user: { name: string | null; email: string | null; timezone: string; notifyEmail: boolean; notifyPush: boolean }
}) {
  const router = useRouter()
  const [msg, setMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [name, setName] = useState(user.name ?? '')
  const [timezone, setTimezone] = useState(user.timezone)
  // Saved unchanged — client notification email is controlled per-category on
  // /my-notifications, so there's no master checkbox here.
  const notifyEmail = user.notifyEmail

  async function onSubmit() {
    setSaving(true)
    setMsg(null)
    const res = await fetch('/api/user', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, timezone, notifyEmail, notifyPush: user.notifyPush }),
    }).catch(() => null)
    setMsg(res?.ok ? 'Saved!' : 'Could not save your details.')
    setSaving(false)
    router.refresh()
  }

  async function deleteAccount() {
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch('/api/user/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: deletePassword, confirm: 'DELETE' }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        setDeleteError(typeof b.error === 'string' ? b.error : 'Could not delete your account.')
        setDeleting(false)
        return
      }
      router.push('/login')
    } catch {
      setDeleteError('Could not delete your account.')
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {msg && <Alert variant={msg === 'Saved!' ? 'success' : 'error'}>{msg}</Alert>}

      <Card>
        <CardBody className="pt-5 flex flex-col gap-4">
          <h2 className="font-semibold text-slate-900">My details</h2>
          <Input label="Your name" value={name} onChange={e => setName(e.target.value)} />
          <Input label="Email" type="email" disabled defaultValue={user.email ?? ''} placeholder="No email address" />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="timezone" className="text-sm font-medium text-slate-700">Timezone</label>
            <select
              id="timezone"
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
        </CardBody>
      </Card>

      <Button size="lg" className="w-full" loading={saving} onClick={onSubmit}>Save changes</Button>

      <Card className="border-red-100">
        <CardBody className="pt-5">
          <h2 className="font-semibold text-red-700 mb-2">Delete account</h2>
          <p className="text-sm text-slate-500 mb-4">This will permanently remove your account and all training history.</p>
          {!deleteConfirm ? (
            <Button variant="danger" size="sm" onClick={() => setDeleteConfirm(true)}>Delete my account</Button>
          ) : (
            <div className="flex flex-col gap-3">
              <Alert variant="error">Your account will be deactivated now and permanently deleted after 30 days. Enter your password to confirm.</Alert>
              <Input type="password" label="Your password" placeholder="Enter your password" value={deletePassword} onChange={e => setDeletePassword(e.target.value)} />
              {deleteError && <Alert variant="error">{deleteError}</Alert>}
              <div className="flex gap-2">
                <Button variant="danger" size="sm" loading={deleting} onClick={deleteAccount}>Yes, delete</Button>
                <Button variant="ghost" size="sm" onClick={() => { setDeleteConfirm(false); setDeleteError(null); setDeletePassword('') }}>Cancel</Button>
              </div>
              <a href="/api/account/export" className="text-xs font-medium text-blue-600 hover:underline">Download a copy of your data first</a>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
