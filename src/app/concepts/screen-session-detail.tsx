import { Clock, MapPin, Check, Paperclip, Play, Star } from 'lucide-react'
import { MOCK } from './mock'
import { TopBar, CARD } from './parts'

// The trainer's filled-in session form: skill ratings + info fields.
const RATINGS = [
  { label: 'Recall', value: 4 },
  { label: 'Loose-lead walking', value: 3 },
  { label: 'Focus & engagement', value: 5 },
  { label: 'Confidence', value: 4 },
]
const INFO = [
  { label: 'Energy', value: 'Medium' },
  { label: 'Mood', value: '😄 Happy' },
  { label: 'Treats', value: 'Chicken' },
]

// Static waveform shape for the trainer's voice note on the session.
const WAVE = [7, 13, 20, 11, 17, 24, 15, 9, 22, 13, 18, 8, 19, 12, 16, 10, 20, 12, 15, 9]
function VoicePlayer({ dur }: { dur: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white shrink-0"><Play className="h-5 w-5 ml-0.5" fill="currentColor" /></span>
      <span className="flex items-center gap-[3px] h-7 flex-1">
        {WAVE.map((h, i) => <span key={i} className="w-[3px] rounded-full bg-accent/30" style={{ height: h }} />)}
      </span>
      <span className="text-xs font-medium text-slate-400 shrink-0">{dur}</span>
    </div>
  )
}

export function ScreenSessionDetail() {
  return (
    <div>
      <TopBar title="Session" />
      <div className="px-4 space-y-4">
        {/* Hero */}
        <div className="rounded-3xl p-5 text-white" style={{ backgroundImage: 'linear-gradient(135deg,var(--accent),var(--accent-strong))' }}>
          <p className="text-xs text-white/75">Completed · Tue 6 May · with Sarah</p>
          <h1 className="font-display text-2xl font-extrabold mt-0.5">Sit-stays &amp; place</h1>
          <div className="mt-3 flex items-center gap-4 text-sm text-white/90">
            <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" /> 45 min</span>
            <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" /> Riverside Park</span>
          </div>
        </div>

        {/* Session report — trainer's filled-in form: ratings + info */}
        <div className={`${CARD} p-4`}>
          <p className="font-display font-bold text-slate-900 mb-3">How Poppy did</p>
          <div className="space-y-2.5">
            {RATINGS.map(r => (
              <div key={r.label} className="flex items-center justify-between gap-3">
                <span className="text-sm text-slate-700">{r.label}</span>
                <span className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map(n => <Star key={n} className={['h-4 w-4', n <= r.value ? 'text-accent' : 'text-slate-200'].join(' ')} fill="currentColor" />)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {INFO.map(f => (
              <div key={f.label} className="rounded-xl bg-surface px-2 py-2 text-center">
                <p className="text-[10px] text-slate-400">{f.label}</p>
                <p className="text-sm font-semibold text-slate-800">{f.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Trainer notes + voice note */}
        <div className={`${CARD} p-4`}>
          <p className="font-display font-bold text-slate-900 mb-1">Trainer notes</p>
          <p className="text-sm text-slate-600 leading-relaxed">Poppy’s sit-stay is solid to 30s with mild distractions. Keep “place” durations short this week and reward calm settling. Lovely focus today! 🐾</p>
          <div className="mt-3 pt-3 border-t border-slate-100">
            <p className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold mb-2">Voice note from Sarah</p>
            <VoicePlayer dur="0:24" />
          </div>
        </div>

        {/* Homework from this session */}
        <div className={`${CARD} p-4`}>
          <p className="font-display font-bold text-slate-900 mb-3">Homework from this session</p>
          <div className="space-y-2.5">
            {MOCK.homework.slice(0, 3).map(t => (
              <div key={t.id} className="flex items-center gap-3">
                <span className={['flex h-6 w-6 items-center justify-center rounded-full text-white text-xs', t.done ? 'bg-emerald-500' : 'border-2 border-slate-300'].join(' ')}>{t.done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : ''}</span>
                <span className={['text-sm flex-1', t.done ? 'text-slate-400 line-through' : 'text-slate-800 font-medium'].join(' ')}>{t.title}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recording & files */}
        <div className={`${CARD} p-4`}>
          <p className="font-display font-bold text-slate-900 mb-3">Recording &amp; files</p>
          <div className="space-y-3">
            <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={MOCK.gallery[1].src} alt="" className="h-full w-full object-cover" />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/85 shadow-lg"><Play className="h-5 w-5 ml-0.5 text-slate-900" fill="currentColor" /></span>
              </span>
            </div>
            <div className="flex items-center gap-2.5 rounded-2xl bg-surface px-3 py-3">
              <Paperclip className="h-4 w-4 text-accent shrink-0" />
              <span className="text-sm text-slate-700 font-medium leading-tight">Place-training guide.pdf</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
