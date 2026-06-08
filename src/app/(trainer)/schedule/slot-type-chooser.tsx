'use client'

import { X, User, Users, PawPrint, DoorOpen, type LucideIcon } from 'lucide-react'

export type SlotAddType = 'session' | 'class' | 'buddies' | 'dropin'

const OPTIONS: { type: SlotAddType; label: string; hint: string; Icon: LucideIcon }[] = [
  { type: 'session', label: 'Session',       hint: '1:1 from a package',        Icon: User },
  { type: 'class',    label: 'Class',         hint: 'Group class series',        Icon: Users },
  { type: 'buddies',  label: 'Group walk',  hint: 'Several dogs together',  Icon: PawPrint },
  { type: 'dropin',   label: 'Drop-in class', hint: 'One-off single class',      Icon: DoorOpen },
]

// Shown when the trainer clicks an empty calendar slot — pick what to add, then
// the parent opens the matching create flow.
export function SlotTypeChooser({
  date,
  time,
  onSelect,
  onClose,
}: {
  date: string
  time?: string
  onSelect: (type: SlotAddType) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative z-50 bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div>
            <h2 className="font-semibold text-slate-900">Add to schedule</h2>
            {time && <p className="text-xs text-slate-400 mt-0.5">{date} · {time}</p>}
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          {OPTIONS.map(({ type, label, hint, Icon }) => (
            <button
              key={type}
              onClick={() => onSelect(type)}
              className="flex flex-col items-start gap-2 rounded-xl border border-slate-200 p-4 text-left hover:border-blue-400 hover:bg-blue-50 transition-colors"
            >
              <Icon className="h-5 w-5 text-blue-600" />
              <span className="text-sm font-medium text-slate-900">{label}</span>
              <span className="text-[11px] text-slate-500 leading-tight">{hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
