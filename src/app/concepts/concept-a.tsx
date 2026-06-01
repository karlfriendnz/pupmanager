import { MapPin, Clock, ChevronRight, MessageCircle, Calendar, ShoppingBag } from 'lucide-react'
import { MOCK } from './mock'
import { Ring } from './parts'
import { DogHero } from './dog-hero'

// Concept A — Dog-hero + gamified. The dog (and the trainer's media gallery)
// is the star; momentum is celebrated up top. Pure dashboard, no feed.
export function ConceptA({ dogs = MOCK.dogs }: { dogs?: typeof MOCK.dogs } = {}) {
  const m = MOCK
  return (
    <div className="pb-10">
      {/* Media-gallery hero of the dog. Switcher only shows with 2+ dogs. */}
      <DogHero business={m.business} dogs={dogs} />

      {/* Quick actions — pulled up to overlap the hero */}
      <div className="px-4 -mt-7 relative z-20 grid grid-cols-3 gap-3">
        {[
          { label: 'Book', icon: Calendar },
          { label: 'Message', icon: MessageCircle },
          { label: 'Shop', icon: ShoppingBag },
        ].map(a => (
          <button key={a.label} className="rounded-2xl bg-white shadow-[0_4px_16px_rgba(15,31,36,0.10)] py-3.5 flex flex-col items-center gap-1.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent"><a.icon className="h-5 w-5" /></span>
            <span className="text-xs font-semibold text-slate-700">{a.label}</span>
          </button>
        ))}
      </div>

      {/* Up next */}
      <section className="px-4 mt-5">
        <h2 className="font-display text-lg font-bold text-slate-900 mb-2">Up next</h2>
        <div className="rounded-3xl p-5 text-white" style={{ backgroundImage: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
          <p className="text-xs font-medium text-white/75">{m.nextSession.countdown}</p>
          <h3 className="font-display text-xl font-bold mt-0.5">{m.nextSession.title}</h3>
          <div className="mt-3 space-y-1.5 text-sm text-white/90">
            <div className="flex items-center gap-2"><Clock className="h-4 w-4 opacity-80" /> {m.nextSession.when}</div>
            <div className="flex items-center gap-2"><MapPin className="h-4 w-4 opacity-80" /> {m.nextSession.location}</div>
          </div>
          <button className="mt-4 w-full rounded-xl bg-white/15 py-2.5 text-sm font-semibold backdrop-blur">View session details</button>
        </div>
      </section>

      {/* This week — gamified homework */}
      <section className="px-4 mt-6">
        <div className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">This week</h2>
              <p className="text-xs text-accent font-semibold mt-0.5">2 to go for a perfect week! 🎉</p>
            </div>
            <Ring done={m.week.done} total={m.week.total} label="done" />
          </div>
          <div className="mt-4 space-y-2.5">
            {m.homework.map(t => (
              <div key={t.id} className="flex items-center gap-3">
                <span className={['flex h-6 w-6 items-center justify-center rounded-full text-white text-xs', t.done ? 'bg-emerald-500' : 'border-2 border-slate-300'].join(' ')}>{t.done ? '✓' : ''}</span>
                <span className={['text-sm flex-1', t.done ? 'text-slate-400 line-through' : 'text-slate-800 font-medium'].join(' ')}>
                  {t.title}{t.reps ? <span className="text-slate-400 font-normal"> · {t.reps} reps</span> : null}
                </span>
                {t.done && <span className="text-[10px] font-bold text-emerald-600">+50</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Next badge teaser */}
      <section className="px-4 mt-6">
        <div className="rounded-3xl bg-accent-soft p-5 flex items-center gap-4">
          <div className="text-4xl">{m.nextBadge.icon}</div>
          <div className="flex-1">
            <p className="font-display font-bold text-slate-900">Almost there!</p>
            <p className="text-xs text-slate-600">{m.nextBadge.current}/{m.nextBadge.target} toward <b>{m.nextBadge.name}</b></p>
            <div className="mt-2 h-2 rounded-full bg-white/70 overflow-hidden">
              <div className="h-full bg-accent" style={{ width: `${(m.nextBadge.current / m.nextBadge.target) * 100}%` }} />
            </div>
          </div>
        </div>
      </section>

      {/* Trainer note */}
      <section className="px-4 mt-6">
        <div className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-4 flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent font-bold">{m.message.from[0]}</div>
          <div className="flex-1 min-w-0">
            <div className="flex justify-between"><p className="text-sm font-semibold text-slate-900">{m.message.from}</p><span className="text-[11px] text-slate-400">{m.message.when}</span></div>
            <p className="text-sm text-slate-500 mt-0.5">{m.message.preview}</p>
          </div>
          <MessageCircle className="h-4 w-4 text-slate-300" />
        </div>
      </section>

      {/* Recommended */}
      <section className="mt-6">
        <div className="px-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-slate-900">Picked for {m.dog.name}</h2>
          <span className="text-xs font-semibold text-accent flex items-center">Shop <ChevronRight className="h-3 w-3" /></span>
        </div>
        <div className="mt-3 flex gap-3 overflow-x-auto px-4 no-scrollbar">
          {m.recommended.map(p => (
            <div key={p.id} className="w-40 shrink-0 rounded-2xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.photo} alt={p.name} className="h-28 w-full object-cover bg-white" />
              <div className="p-3"><p className="text-sm font-semibold text-slate-900 truncate">{p.name}</p><p className="text-xs text-accent font-bold mt-0.5">{p.price}</p></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
