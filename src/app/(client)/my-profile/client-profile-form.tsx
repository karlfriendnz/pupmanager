'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BreedSelect } from '@/components/shared/breed-select'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { Plus, Trash2 } from 'lucide-react'
import { TIMEZONES } from '@/lib/timezones'
import { DogPhotoUpload } from '@/components/shared/dog-photo-upload'

interface Dog {
  id: string
  name: string
  breed: string | null
  weight: number | null
  photoUrl: string | null
  isPrimary: boolean
}

interface DogForm {
  id: string | null
  name: string
  breed: string
  weight: string
  photoUrl: string | null
  isPrimary: boolean
  isNew?: boolean
}

export function ClientProfileForm({
  clientId,
  user,
  dogs: initialDogs,
  view = 'profile',
}: {
  clientId: string
  user: { name: string | null; email: string; timezone: string; notifyEmail: boolean; notifyPush: boolean }
  dogs: Dog[]
  // Which section to show — the page tabs this between 'profile' and 'dogs'
  // (same form instance + one save).
  view?: 'profile' | 'dogs'
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
  // Saved unchanged — client notification email is now controlled per-category
  // on the Notifications tab, so there's no master checkbox here.
  const notifyEmail = user.notifyEmail

  const [dogs, setDogs] = useState<DogForm[]>(
    initialDogs.map(d => ({
      id: d.id,
      name: d.name,
      breed: d.breed ?? '',
      weight: d.weight?.toString() ?? '',
      photoUrl: d.photoUrl,
      isPrimary: d.isPrimary,
    }))
  )

  function updateDog(index: number, field: keyof DogForm, value: string) {
    setDogs(prev => prev.map((d, i) => i === index ? { ...d, [field]: value } : d))
  }

  function addDog() {
    setDogs(prev => [...prev, { id: null, name: '', breed: '', weight: '', photoUrl: null, isPrimary: false, isNew: true }])
  }

  async function removeDog(index: number) {
    const dog = dogs[index]
    if (dog.id && !dog.isNew) {
      if (!confirm(`Remove ${dog.name}?`)) return
      await fetch(`/api/dogs/${dog.id}`, { method: 'DELETE' })
    }
    setDogs(prev => prev.filter((_, i) => i !== index))
  }

  async function onSubmit() {
    setSaving(true)
    setMsg(null)

    // Save user profile
    await fetch('/api/user', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, timezone, notifyEmail, notifyPush: user.notifyPush }),
    })

    // Save each dog
    for (const dog of dogs) {
      if (!dog.name.trim()) continue
      const data = { name: dog.name, breed: dog.breed || null, weight: dog.weight ? parseFloat(dog.weight) : null }

      if (dog.isNew || !dog.id) {
        await fetch('/api/my/dogs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
      } else {
        await fetch(`/api/dogs/${dog.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
      }
    }

    setMsg('Saved!')
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

      {view === 'profile' && (
      <Card>
        <CardBody className="pt-5 flex flex-col gap-4">
          <h2 className="font-semibold text-slate-900">My details</h2>
          <Input label="Your name" value={name} onChange={e => setName(e.target.value)} />
          <Input label="Email" type="email" disabled defaultValue={user.email} />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Timezone</label>
            <select
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
        </CardBody>
      </Card>
      )}

      {view === 'dogs' && (
      <Card>
        <CardBody className="pt-5 flex flex-col gap-4">
          <h2 className="font-semibold text-slate-900">My dogs</h2>
          {dogs.map((dog, i) => (
            <div key={i} className="border border-slate-100 rounded-xl p-4 flex flex-col gap-3 bg-slate-50">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700">{dog.name || 'New dog'}</p>
                <button type="button" onClick={() => removeDog(i)} className="text-slate-400 hover:text-red-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <Input
                label="Name"
                value={dog.name}
                onChange={e => updateDog(i, 'name', e.target.value)}
              />
              <div className="grid grid-cols-2 gap-3">
                <BreedSelect label="Breed" value={dog.breed} onChange={v => updateDog(i, 'breed', v)} />
                <Input label="Weight (kg)" type="number" value={dog.weight} onChange={e => updateDog(i, 'weight', e.target.value)} />
              </div>
              <DogPhotoUpload
                dogId={dog.id}
                dogName={dog.name}
                initialPhotoUrl={dog.photoUrl}
                onChange={(url) => setDogs(prev => prev.map((d, idx) => idx === i ? { ...d, photoUrl: url } : d))}
              />
            </div>
          ))}
          <button type="button" onClick={addDog} className="flex items-center gap-1.5 text-sm text-accent hover:opacity-80">
            <Plus className="h-4 w-4" /> Add another dog
          </button>
        </CardBody>
      </Card>
      )}

      <Button size="lg" className="w-full" loading={saving} onClick={onSubmit}>Save changes</Button>

      {view === 'profile' && (
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
      )}
    </div>
  )
}
