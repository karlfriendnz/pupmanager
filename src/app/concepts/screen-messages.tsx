import { Send, Plus } from 'lucide-react'
import { TopBar } from './parts'

// Simple text message feed (client's view) — opens straight into the
// conversation with the trainer. Incoming left (trainer), outgoing right (client).
const MSGS: { from: 'me' | 'them'; text: string }[] = [
  { from: 'them', text: 'Hi Aria! How did Poppy go with the place command this week?' },
  { from: 'me', text: 'Really well! She’s holding it for about 20s now 🙌' },
  { from: 'them', text: 'That’s brilliant 🎉 Let’s push to 30s before Thursday.' },
  { from: 'them', text: 'I’ve added 3 new tasks for the week — all in your homework.' },
  { from: 'me', text: 'Perfect, will do. Thank you!' },
  { from: 'them', text: 'Great job with Poppy this week — her recall is really coming along! 🐾' },
]

export function ScreenMessages() {
  return (
    <div className="flex flex-col min-h-[660px]">
      <TopBar title="Aria" action={<span className="text-xs text-slate-400">Demo Dog Training</span>} />

      <div className="flex-1 px-4 pt-2 pb-4 flex flex-col gap-2.5">
        <p className="text-center text-[11px] text-slate-400 my-1">Monday</p>
        {MSGS.map((m, i) => (
          <div
            key={i}
            className={[
              'max-w-[80%] px-3.5 py-2.5 text-sm leading-snug',
              m.from === 'me'
                ? 'self-end text-white rounded-2xl rounded-br-md bg-accent'
                : 'self-start text-slate-700 bg-white shadow-sm rounded-2xl rounded-bl-md',
            ].join(' ')}
          >
            {m.text}
          </div>
        ))}
      </div>

      {/* Composer */}
      <div className="px-3 py-3 pb-6 flex items-center gap-2">
        <button className="h-10 w-10 rounded-full bg-white shadow-sm flex items-center justify-center text-slate-500 shrink-0"><Plus className="h-5 w-5" /></button>
        <div className="flex-1 rounded-full bg-white shadow-sm px-4 py-2.5 text-sm text-slate-400">Message Aria…</div>
        <button className="h-10 w-10 rounded-full bg-accent text-white flex items-center justify-center shrink-0"><Send className="h-5 w-5" /></button>
      </div>
    </div>
  )
}
