import { MOCK } from './mock'
import { TopBar } from './parts'

export function ScreenAchievements() {
  const m = MOCK
  return (
    <div>
      <TopBar title="Achievements" />
      <div className="px-4 space-y-5">
        {/* Streak banner */}
        <div className="rounded-3xl p-5 text-white" style={{ backgroundImage: 'linear-gradient(135deg,var(--accent),var(--accent-strong))' }}>
          <div className="flex items-center gap-4">
            <span className="text-4xl">🔥</span>
            <div>
              <p className="font-display text-2xl font-extrabold">{m.momentum.streakDays}-day streak</p>
              <p className="text-sm text-white/85">{m.momentum.badges} badges earned · keep it going!</p>
            </div>
          </div>
        </div>

        {/* Next badge */}
        <div className="rounded-3xl bg-accent-soft p-4 flex items-center gap-3">
          <span className="text-3xl">{m.nextBadge.icon}</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-900">Almost there: {m.nextBadge.name}</p>
            <div className="mt-1.5 h-2 rounded-full bg-white/70 overflow-hidden"><div className="h-full bg-accent" style={{ width: `${(m.nextBadge.current / m.nextBadge.target) * 100}%` }} /></div>
          </div>
          <span className="text-xs font-bold text-slate-500">{m.nextBadge.current}/{m.nextBadge.target}</span>
        </div>

        {/* Trophy grid */}
        <div className="grid grid-cols-3 gap-3">
          {m.trophies.map(b => (
            <div key={b.name} className={['aspect-square rounded-2xl flex flex-col items-center justify-center p-2 text-center', b.earned ? 'bg-white shadow-[0_2px_14px_rgba(15,31,36,0.06)]' : 'bg-slate-100'].join(' ')}>
              <span className={['text-3xl', !b.earned ? 'opacity-30 grayscale' : ''].join(' ')}>{b.icon}</span>
              <span className={['text-[10px] font-medium mt-1 leading-tight', b.earned ? 'text-slate-700' : 'text-slate-400'].join(' ')}>{b.name}</span>
              {!b.earned && 'progress' in b && b.progress && <span className="text-[9px] text-accent font-bold mt-0.5">{b.progress}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
