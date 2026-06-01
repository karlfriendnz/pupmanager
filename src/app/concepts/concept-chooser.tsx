import { ChevronRight, Clock } from 'lucide-react'
import { MOCK } from './mock'

// Trainer chooser — only shown when the client has 2+ trainers (~10% of the
// time); otherwise the app goes straight to Home. PupManager-branded shell;
// each trainer is colour-tagged (wayfinding, not white-label).
export function ConceptChooser() {
  const m = MOCK
  return (
    <div className="min-h-full px-5 pt-14 pb-8" style={{ backgroundColor: 'color-mix(in srgb, var(--pm-brand-600) 4%, #f7fafb)' }}>
      <div className="flex items-center justify-center gap-1.5" style={{ color: 'var(--pm-brand-600)' }}>
        <span className="text-xl" aria-hidden>🐾</span>
        <span className="font-display text-xl font-extrabold">PupManager</span>
      </div>

      <div className="mt-8">
        <h1 className="font-display text-3xl font-extrabold text-slate-900 leading-tight">Hi {m.client}</h1>
        <p className="text-slate-500 mt-1">Who are you checking in on today?</p>
      </div>

      <div className="mt-6 space-y-3.5">
        {m.trainers.map(t => (
          <button key={t.id} className="w-full rounded-3xl bg-white shadow-[0_4px_20px_rgba(15,31,36,0.07)] p-4 flex items-center gap-3.5 text-left">
            <div className="h-14 w-14 rounded-2xl flex items-center justify-center text-white font-display font-extrabold text-xl shrink-0" style={{ backgroundColor: t.accent }}>{t.business[0]}</div>
            <div className="flex-1 min-w-0">
              <p className="font-display font-bold text-slate-900 leading-tight truncate">{t.business}</p>
              <p className="text-xs text-slate-500">with {t.person} · {t.dogs.join(', ')}</p>
              <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-slate-500"><Clock className="h-3 w-3" /> Next {t.next} · {t.week} tasks</p>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              {t.unread > 0 && <span className="h-5 min-w-5 px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">{t.unread}</span>}
              <ChevronRight className="h-5 w-5 text-slate-300" />
            </div>
          </button>
        ))}
      </div>

      <p className="text-center text-xs text-slate-400 mt-7">Only shown when you train with more than one trainer.</p>
    </div>
  )
}
