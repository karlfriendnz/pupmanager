import {
  Home, Calendar, GraduationCap, MessageSquare, ShoppingBag, Trophy, Dog, User, LogOut,
  MessageCircle, Clock, MapPin, Check, ChevronRight,
} from 'lucide-react'
import { MOCK } from './mock'
import { GalleryHero, CARD } from './parts'

const NAV = [
  { label: 'Home', icon: Home, active: true },
  { label: 'Sessions', icon: Calendar },
  { label: 'Classes', icon: GraduationCap },
  { label: 'Messages', icon: MessageSquare, badge: 1 },
  { label: 'Shop', icon: ShoppingBag },
  { label: 'Achievements', icon: Trophy },
  { label: 'My dogs', icon: Dog },
  { label: 'My details', icon: User },
]

// Desktop / web layout of the client home — sidebar nav (instead of bottom
// tabs) + a two-column content area. Same visual language as the phone app.
export function DesktopHome() {
  const m = MOCK
  const dog = m.dogs[0]
  return (
    <div className="flex h-full bg-surface">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 bg-white border-r border-slate-100 flex flex-col py-5">
        <div className="px-5 flex items-center gap-2 mb-6" style={{ color: 'var(--pm-brand-600)' }}>
          <span className="text-xl" aria-hidden>🐾</span>
          <span className="font-display text-xl font-extrabold">PupManager</span>
        </div>
        <nav className="px-3 space-y-1 flex-1">
          {NAV.map(n => (
            <a key={n.label} className={['flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold cursor-pointer', n.active ? 'bg-accent-soft text-accent' : 'text-slate-600 hover:bg-slate-50'].join(' ')}>
              <n.icon className="h-5 w-5" />{n.label}
              {n.badge ? <span className="ml-auto h-5 min-w-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">{n.badge}</span> : null}
            </a>
          ))}
        </nav>
        <div className="px-3 pt-3 mt-3 border-t border-slate-100">
          <a className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-50 cursor-pointer"><LogOut className="h-5 w-5" />Sign out</a>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-7">
          {/* Header */}
          <div className="flex items-end justify-between mb-5">
            <div>
              <p className="text-[11px] uppercase tracking-wider font-semibold text-accent">{m.business}</p>
              <h1 className="font-display text-3xl font-extrabold text-slate-900">Hi {m.client}</h1>
            </div>
            <div className="flex gap-2.5">
              {[{ l: 'Book', i: Calendar }, { l: 'Message', i: MessageCircle }, { l: 'Shop', i: ShoppingBag }].map(a => (
                <button key={a.l} className="flex items-center gap-2 rounded-xl bg-white shadow-sm px-4 py-2.5 text-sm font-semibold text-slate-700"><a.i className="h-4 w-4 text-accent" />{a.l}</button>
              ))}
            </div>
          </div>

          {/* Hero banner */}
          <div className="rounded-3xl overflow-hidden">
            <GalleryHero
              items={[{ id: 'web-hero', src: 'https://loremflickr.com/1200/700/golden,retriever?lock=3', video: false }]}
              heightClass="h-72"
              imgClass="object-cover object-right-top"
              overlay={
                <>
                  <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                  <div className="absolute bottom-5 left-6 text-white" style={{ textShadow: '0 1px 14px rgba(0,0,0,0.5)' }}>
                    <h2 className="font-display text-3xl font-extrabold leading-tight">{dog.name}</h2>
                    <p className="text-white/85">{dog.breed}</p>
                  </div>
                </>
              }
            />
          </div>

          {/* Two-column content */}
          <div className="grid grid-cols-3 gap-6 mt-6">
            <div className="col-span-2 space-y-6">
              {/* Up next */}
              <section>
                <h3 className="font-display text-lg font-bold text-slate-900 mb-2">Up next</h3>
                <div className="rounded-3xl p-5 text-white flex items-center justify-between" style={{ backgroundImage: 'linear-gradient(135deg,var(--accent),var(--accent-strong))' }}>
                  <div>
                    <p className="text-xs text-white/75">{m.nextSession.countdown}</p>
                    <h4 className="font-display text-xl font-bold mt-0.5">{m.nextSession.title}</h4>
                    <div className="mt-2 flex items-center gap-4 text-sm text-white/90">
                      <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" />{m.nextSession.when}</span>
                      <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" />{m.nextSession.location}</span>
                    </div>
                  </div>
                  <button className="rounded-xl bg-white/15 px-4 py-2.5 text-sm font-semibold">Details</button>
                </div>
              </section>

              {/* This week */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-display text-lg font-bold text-slate-900">This week</h3>
                  <span className="text-xs font-semibold text-accent">2 to go for a perfect week! 🎉</span>
                </div>
                <div className={`${CARD} p-5`}>
                  <div className="space-y-3">
                    {m.homework.map(t => (
                      <div key={t.id} className="flex items-center gap-3">
                        <span className={['flex h-6 w-6 items-center justify-center rounded-full text-white text-xs', t.done ? 'bg-emerald-500' : 'border-2 border-slate-300'].join(' ')}>{t.done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : ''}</span>
                        <span className={['text-sm flex-1', t.done ? 'text-slate-400 line-through' : 'text-slate-800 font-medium'].join(' ')}>{t.title}{t.reps ? <span className="text-slate-400 font-normal"> · {t.reps} reps</span> : null}</span>
                        {t.done && <span className="text-[10px] font-bold text-emerald-600">+50</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>

            {/* Right rail */}
            <div className="space-y-6">
              <section>
                <h3 className="font-display text-lg font-bold text-slate-900 mb-2">Achievements</h3>
                <div className="rounded-3xl bg-accent-soft p-4 flex items-center gap-3">
                  <span className="text-3xl">{m.nextBadge.icon}</span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-900">Almost there!</p>
                    <p className="text-xs text-slate-600">{m.nextBadge.current}/{m.nextBadge.target} · {m.nextBadge.name}</p>
                    <div className="mt-2 h-2 rounded-full bg-white/70 overflow-hidden"><div className="h-full bg-accent" style={{ width: `${(m.nextBadge.current / m.nextBadge.target) * 100}%` }} /></div>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 mt-3">
                  {m.trophies.slice(0, 4).map(b => (
                    <div key={b.name} className={`${CARD} aspect-square flex items-center justify-center text-2xl`}>{b.icon}</div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="font-display text-lg font-bold text-slate-900 mb-2">Picked for {dog.name}</h3>
                <div className="space-y-3">
                  {m.recommended.map(p => (
                    <div key={p.id} className={`${CARD} p-2.5 flex items-center gap-3`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.photo} alt={p.name} className="h-12 w-12 rounded-xl object-cover bg-white shrink-0" />
                      <div className="flex-1 min-w-0"><p className="text-sm font-semibold text-slate-900 truncate">{p.name}</p><p className="text-xs text-accent font-bold">{p.price}</p></div>
                      <ChevronRight className="h-4 w-4 text-slate-300" />
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
