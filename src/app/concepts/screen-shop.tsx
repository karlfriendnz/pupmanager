import { Download, ChevronRight } from 'lucide-react'
import { MOCK } from './mock'
import { TopBar, SectionTitle, CARD } from './parts'

const LIBRARY = [
  { id: 'l1', name: 'Loose-leash mini-guide', desc: 'PDF · 4 exercises' },
  { id: 'l2', name: 'Crate-training playbook', desc: '14-day plan' },
  { id: 'l3', name: 'Recall recording', desc: '2-min clip' },
]

export function ScreenShop() {
  return (
    <div>
      <TopBar title="Shop" />
      <div className="px-4 space-y-6">
        <section>
          <SectionTitle>Recommended for Poppy</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            {MOCK.recommended.map(p => (
              <div key={p.id} className={`${CARD} overflow-hidden`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.photo} alt={p.name} className="h-28 w-full object-cover bg-white" />
                <div className="p-3"><p className="text-sm font-semibold text-slate-900 truncate">{p.name}</p><p className="text-xs text-accent font-bold mt-0.5">{p.price}</p></div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle>Your library</SectionTitle>
          <div className={`${CARD} overflow-hidden`}>
            {LIBRARY.map((it, i) => (
              <div key={it.id} className={['flex items-center gap-3 px-4 py-3.5', i > 0 ? 'border-t border-slate-100' : ''].join(' ')}>
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent shrink-0"><Download className="h-4 w-4" /></span>
                <div className="flex-1 min-w-0"><p className="text-sm font-semibold text-slate-900 truncate">{it.name}</p><p className="text-xs text-slate-400 truncate">{it.desc}</p></div>
                <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
