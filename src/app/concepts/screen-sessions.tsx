import { MapPin, ChevronRight, FileText } from 'lucide-react'
import { MOCK } from './mock'
import { TopBar, SectionTitle, CARD } from './parts'

export function ScreenSessions() {
  const s = MOCK.sessions
  return (
    <div>
      <TopBar title="Sessions" />
      <div className="px-4 space-y-6">
        <section>
          <SectionTitle>Upcoming</SectionTitle>
          <div className="space-y-3">
            {s.upcoming.map((x, i) => (
              <div
                key={x.id}
                className={i === 0 ? 'rounded-3xl p-4 text-white' : `${CARD} p-4`}
                style={i === 0 ? { backgroundImage: 'linear-gradient(135deg,var(--accent),var(--accent-strong))' } : undefined}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className={['text-xs font-medium', i === 0 ? 'text-white/75' : 'text-accent'].join(' ')}>{x.when}</p>
                    <h3 className={['font-display font-bold text-lg mt-0.5', i === 0 ? 'text-white' : 'text-slate-900'].join(' ')}>{x.title}</h3>
                  </div>
                  {i === 0 && <span className="text-[10px] font-semibold bg-white/15 rounded-full px-2 py-1">Next</span>}
                </div>
                <div className={['mt-2 flex items-center gap-2 text-sm', i === 0 ? 'text-white/90' : 'text-slate-500'].join(' ')}>
                  <MapPin className="h-4 w-4 opacity-80" /> {x.location} · {x.dog}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle>Past</SectionTitle>
          <div className={`${CARD} overflow-hidden`}>
            {s.past.map((x, i) => (
              <div key={x.id} className={['flex items-center gap-3 px-4 py-3.5', i > 0 ? 'border-t border-slate-100' : ''].join(' ')}>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent shrink-0"><FileText className="h-4 w-4" /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{x.title}</p>
                  <p className="text-xs text-slate-400">{x.when} · {x.dog}</p>
                </div>
                <span className="text-[11px] font-semibold text-accent shrink-0">Notes</span>
                <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
