/**
 * Turn open review comments into a task brief an agent can work from.
 *
 * The problem this solves: a pin stores what the reviewer TYPED, which is
 * shorthand for what they were looking at — "Padding", "remove this". Read back
 * later, out of context, most of them are unactionable. The capture in
 * lib/review-target.ts records what the comment pointed at; this renders the two
 * together so each item reads as an instruction with an address.
 *
 * Output is markdown on purpose: it is the format a human can skim in the repo
 * and an agent can consume without a parser. Ported from fm-events.
 */

/** The shape this needs off a ReviewComment row — a subset, so it stays testable. */
export interface BriefComment {
  id: string
  seq: number | null
  pageKey: string
  body: string
  x: number | null
  y: number | null
  parentId: string | null
  authorName: string | null
  context: Record<string, unknown> | null
  attachments: { path: string; name?: string | null }[] | null
  claudeStatus: string | null
  claudeNote: string | null
  createdAt: Date | string | null
}

/** One line: "Tab: Daycare › Parts of the day › button 'Add a part'". */
function whereLine(ctx: Record<string, unknown> | null): string | null {
  if (!ctx) return null
  // A tab or step is usually NAMED after the section it contains, so scope and
  // section repeat ("Tab: Daycare › Daycare"). Drop the echo.
  const scope = (ctx.scope as string | null) ?? null
  const rawSection = ctx.section as string | null
  const section = rawSection && !(scope || '').includes(rawSection) ? rawSection : null
  const dialog = ctx.dialog as string | null
  const bits = [
    scope,
    dialog && dialog !== 'dialog' ? `dialog "${dialog}"` : null,
    section,
    ctx.label as string | null,
  ].filter(Boolean)
  const text = typeof ctx.text === 'string' && ctx.text.length <= 40 ? ctx.text : null
  bits.push(text ? `${ctx.tag} "${text}"` : String(ctx.tag ?? 'element'))
  return bits.join(' › ')
}

function ago(at: Date | string | null, now: number): string {
  if (!at) return ''
  const ms = now - new Date(at).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export interface BriefOptions {
  /** Only this page key; omitted = every page. */
  pageKey?: string | null
  /** ISO timestamp for the header — passed in so the output is testable. */
  now?: string
  /**
   * Origin the brief was served from (e.g. http://localhost:7777), stamped into
   * the hand-back instructions. An agent reading this file has no way to know
   * which port the dev server took; the server generating the brief is the one
   * thing that knows its own address, so it says.
   */
  baseUrl?: string | null
}

export function buildBriefMarkdown(comments: BriefComment[], opts: BriefOptions = {}): {
  markdown: string
  taskCount: number
  pageCount: number
} {
  const nowIso = opts.now ?? new Date().toISOString()
  const nowMs = new Date(nowIso).getTime()

  // Replies hang off their parent rather than becoming tasks of their own — a
  // reply is usually the clarification that makes the parent actionable.
  const repliesByParent = new Map<string, BriefComment[]>()
  const roots: BriefComment[] = []
  for (const c of comments) {
    if (c.parentId) {
      const list = repliesByParent.get(c.parentId) ?? []
      list.push(c)
      repliesByParent.set(c.parentId, list)
    } else {
      roots.push(c)
    }
  }

  const byPage = new Map<string, BriefComment[]>()
  for (const c of roots) {
    const list = byPage.get(c.pageKey) ?? []
    list.push(c)
    byPage.set(c.pageKey, list)
  }
  // Page-level comments (no pin) first within a page — they are usually the
  // "about this whole screen" notes and set up everything under them.
  for (const list of byPage.values()) {
    list.sort((a, b) => {
      const ap = a.x == null ? 0 : 1
      const bp = b.x == null ? 0 : 1
      if (ap !== bp) return ap - bp
      return String(a.createdAt).localeCompare(String(b.createdAt))
    })
  }

  const base = opts.baseUrl || 'http://localhost:7777'

  const L: string[] = []
  L.push(`# Review tasks — ${roots.length} open across ${byPage.size} page${byPage.size === 1 ? '' : 's'}`)
  L.push('')
  L.push(`Generated ${nowIso} from the in-app review widget.`)
  L.push('')
  L.push(`The app is running at **${base}** — that's where the PATCHes below go.`)
  L.push("Don't assume a port: this line is written by the server that served the brief.")
  L.push('')
  L.push('**How to work this list** — triage first, then one at a time.')
  L.push('')
  L.push('**Step 1 — triage before writing any code.** Read every item and tell Karl,')
  L.push('in one short list, which you understand and which you do not. He would much')
  L.push('rather answer three questions up front than review three wrong changes. Do')
  L.push('not start until he has replied.')
  L.push('')
  L.push('**Step 2 — then work them ONE AT A TIME**, in the order Karl agrees. After')
  L.push('each item, mark it and move to the next. Do NOT batch a dozen changes and')
  L.push('report at the end: the whole point of marking each one is that Karl checks')
  L.push('it while you build the next.')
  L.push('')
  L.push('Marking an item done — note this does NOT resolve it. A robot chip appears')
  L.push('against the comment in the panel and Karl signs it off himself:')
  L.push('')
  L.push('```')
  L.push(`curl -X PATCH ${base}/api/review/comments/<id> \\`)
  L.push(`  -H 'content-type: application/json' \\`)
  L.push(`  -d '{"claudeStatus":"done","claudeNote":"what changed, one line"}'`)
  L.push('```')
  L.push('')
  L.push('Anything you cannot place or understand — ASK, do not guess. A change to the')
  L.push('wrong element is worse than an unactioned note, and this puts the question on')
  L.push('the comment itself where Karl will see it:')
  L.push('')
  L.push('```')
  L.push(`curl -X PATCH ${base}/api/review/comments/<id> \\`)
  L.push(`  -H 'content-type: application/json' \\`)
  L.push(`  -d '{"claudeStatus":"needs_info","claudeNote":"the question, one line"}'`)
  L.push('```')
  L.push('')

  for (const [pageKey, list] of byPage) {
    L.push('---')
    L.push('')
    L.push(`## \`${pageKey}\` — ${list.length} open`)
    L.push('')
    list.forEach((c, i) => {
      const ctx = c.context
      const num = c.seq != null ? `#${c.seq}` : `${i + 1}`
      L.push(`### ${i + 1}. ${num} — ${c.body.replace(/\s+/g, ' ').trim()}`)
      L.push('')
      L.push(`- **id**: \`${c.id}\``)
      const where = whereLine(ctx)
      if (where) L.push(`- **where**: ${where}`)
      if (Array.isArray(ctx?.componentChain) && (ctx.componentChain as string[]).length > 0) {
        L.push(`- **components**: ${(ctx.componentChain as string[]).join(' › ')}`)
      }
      if (ctx?.selector) L.push(`- **selector**: \`${ctx.selector}\``)
      if (ctx?.placeholder) L.push(`- **placeholder**: "${ctx.placeholder}"`)
      if (ctx?.url) L.push(`- **seen at**: ${ctx.url}`)
      if (!ctx) {
        L.push(c.x == null
          ? '- **where**: page-level note (not pinned to an element)'
          : `- **where**: ⚠️ pinned at (${c.x}, ${c.y}) with no element captured — the target has to be confirmed before acting`)
      }
      // Attachments are cited as REPO-RELATIVE PATHS, not URLs: the uploader
      // writes into public/review-uploads, so this is a file the agent can open
      // with its own Read tool rather than a link it can only look at.
      if (c.attachments?.length) {
        const files = c.attachments.map(a => (a.name ? `\`${a.path}\` (${a.name})` : `\`${a.path}\``))
        L.push(`- **images** (READ these — they carry the detail): ${files.join(', ')}`)
      }
      if (c.claudeStatus === 'done') {
        L.push(`- **already actioned**: ${c.claudeNote || 'done'} — awaiting sign-off, skip unless reopening`)
      }
      if (c.claudeStatus === 'needs_info') {
        L.push(`- **you asked**: ${c.claudeNote || 'a question is outstanding'} — check for a reply below before redoing the work`)
      }
      const by = [c.authorName, ago(c.createdAt, nowMs)].filter(Boolean).join(' · ')
      if (by) L.push(`- **by**: ${by}`)
      for (const r of repliesByParent.get(c.id) ?? []) {
        L.push(`- **reply** (${r.authorName || '?'}): ${r.body.replace(/\s+/g, ' ').trim()}`)
      }
      L.push('')
    })
  }

  return { markdown: L.join('\n'), taskCount: roots.length, pageCount: byPage.size }
}

/**
 * THE GATE, applied server-side rather than trusting the client's selection: a
 * comment nobody has approved is a suggestion, and a suggestion must never reach
 * an agent as work. Replies ride along on an approved parent — the clarification
 * that makes an item actionable must not be dropped from the brief.
 */
export function selectForBrief(
  open: BriefComment[],
  opts: { ids?: string[] | null; pageKey?: string | null; ready: (c: BriefComment) => boolean },
): BriefComment[] {
  const readyIds = new Set(open.filter(c => !c.parentId && opts.ready(c)).map(c => c.id))
  const all = open.filter(c => (!c.parentId && readyIds.has(c.id)) || (c.parentId && readyIds.has(c.parentId)))
  if (opts.ids?.length) {
    const picked = new Set(opts.ids)
    return all.filter(c => picked.has(c.id) || (c.parentId && picked.has(c.parentId)))
  }
  if (opts.pageKey) {
    return all.filter(c => c.pageKey === opts.pageKey
      || (c.parentId && all.some(p => p.id === c.parentId && p.pageKey === opts.pageKey)))
  }
  return all
}
