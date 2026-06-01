import { Users, Calendar, Check } from 'lucide-react'
import { MOCK } from './mock'
import { TopBar, CARD } from './parts'

export function ScreenClasses() {
  return (
    <div>
      <TopBar title="Classes" />
      <div className="px-4 space-y-3">
        {MOCK.classes.map(c => (
          <div key={c.id} className={`${CARD} overflow-hidden`}>
            <div className="relative h-32">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.photo} alt="" className="h-full w-full object-cover" />
              {c.enrolled && (
                <span className="absolute top-3 left-3 flex items-center gap-1 rounded-full bg-emerald-500 text-white text-[11px] font-semibold px-2.5 py-1"><Check className="h-3 w-3" /> Enrolled</span>
              )}
            </div>
            <div className="p-4">
              <h3 className="font-display font-bold text-slate-900">{c.name}</h3>
              <div className="mt-1.5 flex items-center gap-3 text-xs text-slate-500">
                <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{c.when}</span>
                <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{c.spots}</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">For {c.dog}</p>
              {!c.enrolled && <button className="mt-3 w-full rounded-xl bg-accent text-white py-2.5 text-sm font-bold">Request a spot</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
