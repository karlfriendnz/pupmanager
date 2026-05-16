import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Marketing site — status board' }
export const dynamic = 'force-dynamic'

// Kanban view of the marketing-site working checklist (.claude/PLAN.md).
// Columns are derived from the plan's sections so there's a single source
// of truth: ## Done -> Done, ## Next -> Doing, ## Backlog -> To Do.
// Local dev tool; gated to ADMIN by the (admin) layout.
const CANDIDATES = [
  path.join(process.cwd(), 'marketing-site', '.claude', 'PLAN.md'),
  '/Users/karl/pupmanager-marketing/.claude/PLAN.md',
]

async function loadPlan(): Promise<string | null> {
  for (const p of CANDIDATES) {
    try {
      return await readFile(p, 'utf8')
    } catch {
      /* try next */
    }
  }
  return null
}

type Card = { text: string; group?: string }

function parse(md: string) {
  const todo: Card[] = []
  const doing: Card[] = []
  const done: Card[] = []
  let section = ''
  let group: string | undefined

  const clean = (s: string) =>
    s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1').trim()

  for (const raw of md.split('\n')) {
    const line = raw.trimEnd()
    if (line.startsWith('## ')) {
      section = line.slice(3).toLowerCase()
      group = undefined
      continue
    }
    if (line.startsWith('### ')) {
      group = clean(line.slice(4))
      continue
    }
    let m: RegExpMatchArray | null
    let text = ''
    if ((m = line.match(/^- \[[ xX]\] (.+)/))) text = m[1]
    else if ((m = line.match(/^- (.+)/))) text = m[1]
    else if ((m = line.match(/^\d+\.\s+(.+)/))) text = m[1]
    else continue
    text = clean(text)
    if (!text || text.startsWith('_')) continue

    if (section.startsWith('done')) done.push({ text })
    else if (section.startsWith('next')) doing.push({ text })
    else if (section.startsWith('backlog')) todo.push({ text, group })
  }
  return { todo, doing, done }
}

const COLUMNS = [
  { key: 'todo' as const, label: 'To Do', dot: 'bg-slate-400', ring: 'ring-slate-700' },
  { key: 'doing' as const, label: 'Doing', dot: 'bg-amber-400', ring: 'ring-amber-500/40' },
  { key: 'done' as const, label: 'Done', dot: 'bg-emerald-400', ring: 'ring-emerald-500/30' },
]

export default async function MarketingStatusBoard() {
  const md = await loadPlan()
  const board = md ? parse(md) : { todo: [], doing: [], done: [] }

  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-amber-400">
        Marketing site · board
      </p>
      <h1 className="mb-1 text-2xl font-bold text-white">Where we&rsquo;re at</h1>
      <p className="mb-6 text-sm text-slate-400">
        Live from the marketing-site plan. Refresh any time.
      </p>

      {!md ? (
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-6 text-slate-300">
          Checklist file not found. This view only works on a local dev machine
          with the marketing-site repo present.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {COLUMNS.map(col => {
            const cards = board[col.key]
            return (
              <div key={col.key} className="rounded-xl bg-slate-800/60 p-3">
                <div className="mb-3 flex items-center gap-2 px-1">
                  <span className={`h-2.5 w-2.5 rounded-full ${col.dot}`} />
                  <h2 className="text-sm font-semibold text-white">{col.label}</h2>
                  <span className="ml-auto rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
                    {cards.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {cards.length === 0 && (
                    <p className="px-1 py-4 text-center text-xs text-slate-500">
                      Nothing here
                    </p>
                  )}
                  {cards.map((c, i) => (
                    <div
                      key={i}
                      className={`rounded-lg bg-slate-900 p-3 text-sm text-slate-200 shadow ring-1 ${col.ring}`}
                    >
                      {c.group && (
                        <span className="mb-1.5 inline-block rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-300">
                          {c.group}
                        </span>
                      )}
                      <p>{c.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
