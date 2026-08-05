import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { mergeClientDogs } from '@/lib/dogs'
import { PageHeader } from '@/components/shared/page-header'
import { MyDogsManager, type ClientDog } from './my-dogs-manager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'My dogs' }

export default async function MyDogsPage() {
  const active = await getActiveClient()
  if (!active) redirect('/login')

  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    include: {
      dog: { select: { id: true, name: true, breed: true, photoUrl: true, weight: true, dob: true, deceasedAt: true } },
      dogs: { select: { id: true, name: true, breed: true, photoUrl: true, weight: true, dob: true, deceasedAt: true } },
    },
  })
  if (!profile) redirect('/login')

  // A dog can travel BOTH relations (primary + household list) and is one dog.
  // A newly added dog is written to `dogs` and, when it's the first, also
  // becomes `dogId` — so without this merge it would appear twice the moment it
  // was created. See lib/dogs.ts.
  const dogs: ClientDog[] = mergeClientDogs(profile.dog, profile.dogs).map(d => ({
    id: d.id,
    name: d.name,
    breed: d.breed,
    photoUrl: d.photoUrl,
    weight: d.weight,
    // Dates are serialised here so the client component takes plain props.
    dob: d.dob ? d.dob.toISOString().slice(0, 10) : null,
    deceasedAt: d.deceasedAt ? d.deceasedAt.toISOString() : null,
  }))

  return (
    <>
      <PageHeader title="My dogs" />
      <div className="px-4 pt-5 pb-10 max-w-3xl mx-auto w-full space-y-3">
        <MyDogsManager dogs={dogs} />
      </div>
    </>
  )
}
