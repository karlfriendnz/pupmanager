import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

// Karl hit a React hydration error on the offering lists, and two sweeps found
// dnd-kit rendering `aria-describedby="DndDescribedBy-N"` with a DIFFERENT N on
// the server than on the client.
//
// The cause is a module-scoped counter in @dnd-kit/utilities' `useUniqueId`.
// The Node server loads that module once for the life of the process, so the
// counter climbs with every DndContext it has ever rendered — across every
// request — and never resets; the browser's copy starts again at 0 on each
// document load. Server ships `DndDescribedBy-137`, hydration renders
// `DndDescribedBy-0`, React reports the mismatch, and on a long-running server
// the number reaches the hundreds. It reproduces on the SECOND load of any
// offering list; the first, on a freshly-booted server, happens to agree.
//
// `useUniqueId(prefix, value)` returns `value` untouched when one is given, and
// DndContext passes its `id` prop straight in — so an explicit, hydration-stable
// id (React's own `useId`) removes the counter from the picture entirely. That
// lives in ONE place, `components/shared/dnd-area.tsx`, and this test is what
// stops the next drag-and-drop feature reaching for `<DndContext>` directly and
// putting the warning back.

const ROOT = path.resolve(__dirname, '../../src')
const OWNER = path.join(ROOT, 'components/shared/dnd-area.tsx')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

describe('dnd-kit ids cannot break hydration', () => {
  const files = walk(ROOT)

  it('nothing renders <DndContext> except the shared wrapper', () => {
    const offenders = files
      .filter(f => f !== OWNER)
      .filter(f => /<DndContext[\s>]/.test(readFileSync(f, 'utf8')))
      .map(f => path.relative(ROOT, f))
    expect(offenders).toEqual([])
  })

  it('nothing imports DndContext except the shared wrapper', () => {
    const offenders = files
      .filter(f => f !== OWNER)
      .filter(f => {
        const src = readFileSync(f, 'utf8')
        const imp = src.match(/import\s*\{([\s\S]*?)\}\s*from\s*'@dnd-kit\/core'/)
        return !!imp && imp[1].split(',').some(s => s.trim() === 'DndContext')
      })
      .map(f => path.relative(ROOT, f))
    expect(offenders).toEqual([])
  })

  it('the wrapper always hands dnd-kit an id, so the counter is never reached', () => {
    const src = readFileSync(OWNER, 'utf8')
    expect(src).toMatch(/useId\(\)/)
    // A caller's own id still wins; otherwise the generated one is used.
    expect(src).toMatch(/id=\{id \?\? generatedId\}/)
  })

  it('the surfaces that reported the fault all go through the wrapper', () => {
    // The offering lists (packages / classes / drop-ins / events / memberships all
    // share OfferingCard) and the form question list. Settings → Fields & forms was
    // the third; its field editor is gone, because a field is now created on the
    // form that asks it.
    for (const rel of ['components/shared/offering-card.tsx', 'app/(trainer)/forms/_question-list.tsx']) {
      const src = readFileSync(path.join(ROOT, rel), 'utf8')
      expect(src, rel).toMatch(/<DndArea[\s>]/)
    }
  })
})
