import { redirect } from 'next/navigation'
import { Dog as DogIcon } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { PageHeader } from '@/components/shared/page-header'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'My dogs' }

export default async function MyDogsPage() {
  const active = await getActiveClient()
  if (!active) redirect('/login')

  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    include: {
      dog: { select: { id: true, name: true, breed: true, photoUrl: true, weight: true, dob: true } },
      dogs: { select: { id: true, name: true, breed: true, photoUrl: true, weight: true, dob: true } },
    },
  })
  if (!profile) redirect('/login')

  const dogs = [...(profile.dog ? [profile.dog] : []), ...profile.dogs]
  const ageYears = (dob: Date | null) => dob ? Math.max(0, Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000))) : null

  return (
    <>
      <PageHeader title="My dogs" />
      <div className="px-4 pt-5 pb-10 max-w-3xl mx-auto w-full space-y-3">
        {dogs.length === 0 && (
          <div className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-8 text-center">
            <div className="mx-auto h-12 w-12 rounded-2xl bg-accent-soft flex items-center justify-center"><DogIcon className="h-6 w-6 text-accent" /></div>
            <p className="mt-3 text-sm font-semibold text-slate-700">No dogs added yet</p>
            <p className="mt-1 text-xs text-slate-400">Your trainer will add your dog after onboarding.</p>
          </div>
        )}
        {dogs.map(d => {
          const age = ageYears(d.dob)
          return (
            <div key={d.id} className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] overflow-hidden flex">
              {d.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={d.photoUrl} alt={d.name} className="h-28 w-28 object-cover shrink-0" />
              ) : (
                <div className="h-28 w-28 bg-accent-soft flex items-center justify-center shrink-0"><DogIcon className="h-8 w-8 text-accent" /></div>
              )}
              <div className="p-4 flex-1 min-w-0">
                <p className="font-display text-lg font-bold text-slate-900 leading-tight">{d.name}</p>
                {d.breed && <p className="text-xs text-slate-500">{d.breed}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {age != null && <span className="rounded-full bg-accent-soft text-accent text-[11px] font-semibold px-2 py-0.5">{age} yr{age === 1 ? '' : 's'}</span>}
                  {d.weight != null && <span className="rounded-full bg-accent-soft text-accent text-[11px] font-semibold px-2 py-0.5">{d.weight} kg</span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
