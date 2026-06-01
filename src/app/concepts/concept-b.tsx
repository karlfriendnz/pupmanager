import { MapPin, Clock, ChevronRight, Calendar, MessageCircle, ShoppingBag, ArrowRight } from 'lucide-react'
import { MOCK } from './mock'
import { SegBar } from './parts'

// Concept B — Action launchpad (Rio-style). Task-first: quick actions + the
// one "now" card lead. The dog/gallery is a compact anchor, not the hero.
export function ConceptB() {
  const m = MOCK
  const actions = [
    { label: 'Book', icon: Calendar },
    { label: 'Message', icon: MessageCircle },
    { label: 'Shop', icon: ShoppingBag },
  ]
  return (
    <div className="pb-10 pt-12">
      {/* Greeting */}
      <header className="px-5 pt-2">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-accent">{m.business}</p>
        <h1 className="font-display text-3xl font-extrabold text-slate-900 leading-tight">Hi {m.client}</h1>
      </header>

      {/* Quick actions */}
      <div className="px-5 mt-4 grid grid-cols-3 gap-3">
        {actions.map(a => (
          <button key={a.label} className="rounded-2xl bg-white shadow-[0_2px_14px_rgba(15,31,36,0.06)] py-3.5 flex flex-col items-center gap-1.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent"><a.icon className="h-5 w-5" /></span>
            <span className="text-xs font-semibold text-slate-700">{a.label}</span>
          </button>
        ))}
      </div>

      {/* The one "now" card */}
      <section className="px-5 mt-6">
        <h2 className="font-display text-lg font-bold text-slate-900 mb-2">Up next</h2>
        <div className="rounded-3xl p-5 text-white" style={{ backgroundImage: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-white/75">{m.nextSession.countdown}</p>
            <span className="text-[11px] font-semibold bg-white/15 rounded-full px-2.5 py-1">Reschedule</span>
          </div>
          <h3 className="font-display text-xl font-bold mt-1">{m.nextSession.title}</h3>
          <div className="mt-3 flex items-center gap-4 text-sm text-white/90">
            <span className="flex items-center gap-1.5"><Clock className="h-4 w-4 opacity-80" />{m.nextSession.when}</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-sm text-white/90"><MapPin className="h-4 w-4 opacity-80" />{m.nextSession.location}</div>
          <button className="mt-4 w-full rounded-xl bg-white text-[color:var(--accent)] py-2.5 text-sm font-bold flex items-center justify-center gap-1">Get directions <ArrowRight className="h-4 w-4" /></button>
        </div>
      </section>

      {/* This week — compact */}
      <section className="px-5 mt-6">
        <div className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-lg font-bold text-slate-900">This week</h2>
            <div className="flex items-center gap-2"><SegBar done={m.week.done} total={m.week.total} /><span className="text-xs font-semibold text-slate-500">{m.week.done}/{m.week.total}</span></div>
          </div>
          {m.homework.slice(0, 3).map(t => (
            <div key={t.id} className="flex items-center gap-3 py-1.5">
              <span className={['flex h-5 w-5 items-center justify-center rounded-full text-white text-[10px]', t.done ? 'bg-emerald-500' : 'border-2 border-slate-300'].join(' ')}>{t.done ? '✓' : ''}</span>
              <span className={['text-sm flex-1', t.done ? 'text-slate-400 line-through' : 'text-slate-800 font-medium'].join(' ')}>{t.title}</span>
            </div>
          ))}
          <button className="mt-2 text-xs font-semibold text-accent">See all {m.week.total} tasks →</button>
        </div>
      </section>

      {/* Dog momentum strip (compact, with gallery thumb) */}
      <section className="px-5 mt-6">
        <div className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-3 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={m.dog.photo} alt={m.dog.name} className="h-14 w-14 rounded-2xl object-cover" />
          <div className="flex-1 min-w-0">
            <p className="font-display font-bold text-slate-900 leading-tight">{m.dog.name}</p>
            <p className="text-xs text-slate-500">🔥 {m.momentum.streakDays}-day streak · {m.momentum.trainingDays} training days</p>
          </div>
          <ChevronRight className="h-5 w-5 text-slate-300" />
        </div>
      </section>

      {/* Next badge */}
      <section className="px-5 mt-4">
        <div className="rounded-2xl bg-accent-soft p-4 flex items-center gap-3">
          <span className="text-2xl">{m.nextBadge.icon}</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-900">Next badge: {m.nextBadge.name}</p>
            <div className="mt-1.5 h-1.5 rounded-full bg-white/70 overflow-hidden"><div className="h-full bg-accent" style={{ width: `${(m.nextBadge.current / m.nextBadge.target) * 100}%` }} /></div>
          </div>
          <span className="text-xs font-bold text-slate-500">{m.nextBadge.current}/{m.nextBadge.target}</span>
        </div>
      </section>

      {/* Recommended */}
      <section className="mt-6">
        <div className="px-5 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-slate-900">Recommended</h2>
          <span className="text-xs font-semibold text-accent flex items-center">Shop <ChevronRight className="h-3 w-3" /></span>
        </div>
        <div className="mt-3 flex gap-3 overflow-x-auto px-5 no-scrollbar">
          {m.recommended.map(p => (
            <div key={p.id} className="w-36 shrink-0 rounded-2xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.photo} alt={p.name} className="h-24 w-full object-cover bg-white" />
              <div className="p-2.5"><p className="text-xs font-semibold text-slate-900 truncate">{p.name}</p><p className="text-xs text-accent font-bold">{p.price}</p></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
