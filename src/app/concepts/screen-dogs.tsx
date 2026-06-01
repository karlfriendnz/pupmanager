import { Plus, ChevronRight } from 'lucide-react'
import { MOCK } from './mock'
import { TopBar, CARD } from './parts'

export function ScreenDogs() {
  return (
    <div>
      <TopBar title="My dogs" action={<button className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white shrink-0"><Plus className="h-5 w-5" /></button>} />
      <div className="px-4 space-y-3">
        {MOCK.dogs.map(d => (
          <div key={d.id} className={`${CARD} overflow-hidden`}>
            <div className="flex">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={d.gallery[0].src} alt={d.name} className="h-28 w-28 object-cover shrink-0" />
              <div className="p-4 flex-1 min-w-0">
                <p className="font-display text-lg font-bold text-slate-900">{d.name}</p>
                <p className="text-xs text-slate-500">{d.breed}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-accent-soft text-accent text-[11px] font-semibold px-2 py-0.5">🔥 {d.momentum.streakDays}d</span>
                  <span className="rounded-full bg-accent-soft text-accent text-[11px] font-semibold px-2 py-0.5">🏅 {d.momentum.badges}</span>
                </div>
              </div>
              <div className="flex items-center pr-3"><ChevronRight className="h-5 w-5 text-slate-300" /></div>
            </div>
          </div>
        ))}
        <p className="text-center text-xs text-slate-400 pt-1">Each dog has its own gallery, sessions &amp; progress.</p>
      </div>
    </div>
  )
}
