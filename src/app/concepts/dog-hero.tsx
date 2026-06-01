'use client'

import { useState } from 'react'
import { GalleryHero } from './parts'

interface Dog {
  id: string
  name: string
  breed: string
  photo: string
  momentum: { streakDays: number; trainingDays: number; badges: number }
  gallery: { id: string; src: string; video: boolean }[]
}

// Media-gallery hero with a multi-dog switcher. Tapping a dog avatar re-scopes
// the hero (gallery, name, momentum) to that dog. In the real build this would
// re-scope the whole home; here it drives the hero to demonstrate the pattern.
export function DogHero({ business, dogs }: { business: string; dogs: Dog[] }) {
  const [activeId, setActiveId] = useState(dogs[0].id)
  const dog = dogs.find(d => d.id === activeId) ?? dogs[0]

  return (
    <div className="relative">
      <GalleryHero
        items={dog.gallery}
        heightClass="h-[340px]"
        overlay={
          <>
            <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/55 via-black/15 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
            <div className="absolute bottom-8 left-5 right-5 z-20 text-white" style={{ textShadow: '0 1px 14px rgba(0,0,0,0.55)' }}>
              <p className="text-[11px] uppercase tracking-wider font-semibold text-white/80">{business}</p>
              <h1 className="font-display text-3xl font-extrabold leading-tight">{dog.name}</h1>
              <p className="text-sm text-white/85">{dog.breed}</p>
            </div>
          </>
        }
      />

      {/* Dog switcher — avatars top-left under the status bar */}
      {dogs.length > 1 && (
        <div className="absolute top-11 left-4 z-30 flex items-center gap-2">
          {dogs.map(d => {
            const on = d.id === activeId
            return (
              <button
                key={d.id}
                onClick={() => setActiveId(d.id)}
                className={['flex items-center gap-1.5 rounded-full pr-3 transition-all', on ? 'bg-white/95 backdrop-blur shadow' : 'bg-black/25 backdrop-blur'].join(' ')}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.photo} alt={d.name} className={['h-8 w-8 rounded-full object-cover', on ? 'ring-2 ring-accent' : ''].join(' ')} />
                <span className={['text-xs font-semibold', on ? 'text-slate-800' : 'text-white'].join(' ')}>{d.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
