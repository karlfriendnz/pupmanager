import { User, Mail, Phone, MapPin, ShieldAlert } from 'lucide-react'
import { MOCK } from './mock'
import { TopBar, CARD } from './parts'

export function ScreenDetails() {
  const p = MOCK.profile
  const rows = [
    { icon: User, label: 'Name', value: p.name },
    { icon: Mail, label: 'Email', value: p.email },
    { icon: Phone, label: 'Phone', value: p.phone },
    { icon: MapPin, label: 'Suburb', value: p.suburb },
    { icon: ShieldAlert, label: 'Emergency contact', value: p.emergency },
  ]
  return (
    <div>
      <TopBar title="My details" action={<span className="text-sm font-semibold text-accent">Edit</span>} />
      <div className="px-4">
        <div className="flex flex-col items-center pt-2 pb-5">
          <div className="h-20 w-20 rounded-full bg-accent-soft text-accent flex items-center justify-center font-display text-3xl font-extrabold">{p.name[0]}</div>
          <p className="font-display text-xl font-bold text-slate-900 mt-3">{p.name}</p>
        </div>
        <div className={`${CARD} overflow-hidden`}>
          {rows.map((r, i) => (
            <div key={r.label} className={['flex items-center gap-3 px-4 py-3.5', i > 0 ? 'border-t border-slate-100' : ''].join(' ')}>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent shrink-0"><r.icon className="h-4 w-4" /></span>
              <div className="flex-1 min-w-0"><p className="text-[11px] text-slate-400">{r.label}</p><p className="text-sm font-medium text-slate-800 truncate">{r.value}</p></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
