import { Clock, ChevronRight } from 'lucide-react'
import { MOCK } from './mock'
import { GalleryHero, Ring } from './parts'

// Concept C — Feed × Dashboard (the hybrid). A compact glanceable dashboard
// sits on top; below it, a living activity feed tells the dog's training story.
export function ConceptC() {
  const m = MOCK
  const groups = [...new Set(m.feed.map(f => f.group))]
  return (
    <div className="pb-10">
      {/* ── DASHBOARD ────────────────────────────────────── */}
      <GalleryHero
        items={m.gallery}
        heightClass="h-56"
        overlay={
          <>
            <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
            <div className="absolute bottom-4 left-5 z-20 text-white">
              <p className="text-[11px] uppercase tracking-wider font-semibold text-white/80">{m.business}</p>
              <h1 className="font-display text-2xl font-extrabold leading-tight">{m.dog.name}’s training</h1>
            </div>
          </>
        }
      />

      {/* Momentum + up-next dashboard card, overlapping the hero */}
      <div className="px-4 -mt-6 relative z-20">
        <div className="rounded-3xl bg-white shadow-[0_6px_24px_rgba(15,31,36,0.10)] p-4">
          <div className="flex items-center gap-3 text-center">
            <div className="flex-1"><p className="font-display text-xl font-bold text-slate-900">🔥 {m.momentum.streakDays}</p><p className="text-[10px] text-slate-400">day streak</p></div>
            <div className="flex-1 border-x border-slate-100"><p className="font-display text-xl font-bold text-slate-900">{m.momentum.trainingDays}</p><p className="text-[10px] text-slate-400">training days</p></div>
            <Ring done={m.week.done} total={m.week.total} size={52} />
          </div>
          <div className="mt-3 rounded-2xl p-3 flex items-center gap-3 text-white" style={{ backgroundImage: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
            <Clock className="h-5 w-5 shrink-0 opacity-90" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-white/75">Up next · {m.nextSession.countdown}</p>
              <p className="font-semibold text-sm truncate">{m.nextSession.title} · {m.nextSession.when}</p>
            </div>
            <ChevronRight className="h-5 w-5 text-white/80" />
          </div>
        </div>
      </div>

      {/* ── FEED ─────────────────────────────────────────── */}
      <div className="px-4 mt-6">
        <h2 className="font-display text-lg font-bold text-slate-900 mb-1">Poppy’s journey</h2>
        {groups.map(group => (
          <div key={group} className="mt-3">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-400 mb-2">{group}</p>
            <div className="space-y-2.5">
              {m.feed.filter(f => f.group === group).map(f => (
                <div
                  key={f.id}
                  className={[
                    'rounded-2xl p-3.5 flex items-start gap-3',
                    f.celebrate
                      ? 'bg-accent-soft ring-1 ring-[color:var(--accent)]/20'
                      : 'bg-white shadow-[0_2px_14px_rgba(15,31,36,0.05)]',
                  ].join(' ')}
                >
                  <span className={['flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg', f.celebrate ? 'bg-white' : 'bg-accent-soft'].join(' ')}>{f.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className={['text-sm leading-snug', f.celebrate ? 'font-display font-bold text-slate-900' : 'font-semibold text-slate-900'].join(' ')}>{f.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{f.sub}</p>
                    {f.kind === 'shop' && (
                      <button className="mt-2 rounded-lg bg-accent text-white text-xs font-semibold px-3 py-1.5">View product</button>
                    )}
                    {f.kind === 'message' && (
                      <button className="mt-2 rounded-lg bg-accent-soft text-accent text-xs font-semibold px-3 py-1.5">Reply</button>
                    )}
                  </div>
                  {f.celebrate && <span className="text-[10px] font-bold text-accent">NEW</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
