// Audit-only: every help step names its controls in "double quotes". Pull each
// quoted phrase out of all 153 articles and check it actually exists —
// first in the DOM text captured by crawl-routes, then in the app source.
// Anything that matches neither is a candidate for a wrong instruction.
// Run: npx tsx tests/audit/check-control-names.ts
import { HELP_ARTICLES } from '../../src/lib/help/content'
import fs from 'fs'
import path from 'path'

// JSX writes "Finalise &amp; send" and "they&rsquo;re", so the source has to be
// entity-decoded before a phrase from the docs can be found in it. Missing this
// is what made "Base · start & end" look wrong when it is right.
const ENTITIES: [RegExp, string][] = [
  [/&amp;/g, '&'], [/&rsquo;|&#8217;/g, "'"], [/&lsquo;/g, "'"],
  [/&ldquo;|&rdquo;/g, '"'], [/&hellip;/g, '...'], [/&middot;/g, '·'],
  [/&mdash;/g, '—'], [/&ndash;/g, '–'], [/&apos;|&#39;/g, "'"],
  [/&quot;/g, '"'], [/&nbsp;/g, ' '], [/&rarr;/g, '->'],
]

const norm = (s: string) => {
  let out = s
  for (const [re, to] of ENTITIES) out = out.replace(re, to)
  return out.toLowerCase()
    // JSX string joins: {' '} and {"…"} between words.
    .replace(/\{'\s*'\}|\{"\s*"\}/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[…]/g, '...')
    .replace(/[→]/g, '->')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Corpus 1: the DOM text the crawler saw ────────────────────────────────
let domCorpus = ''
const routesPath = 'tests/audit/out/routes.json'
if (fs.existsSync(routesPath)) {
  const routes = JSON.parse(fs.readFileSync(routesPath, 'utf8')) as Record<string, Record<string, unknown>>
  for (const v of Object.values(routes)) {
    for (const key of ['h1', 'headings', 'buttons', 'tabs', 'links', 'labels', 'placeholders', 'sidebar', 'topbar']) {
      const arr = v[key]
      if (Array.isArray(arr)) domCorpus += ' | ' + arr.join(' | ')
    }
    if (typeof v.bodyText === 'string') domCorpus += ' | ' + v.bodyText
    for (const s of (v.selects as { options: string[] }[] | undefined) ?? []) domCorpus += ' | ' + s.options.join(' | ')
  }
}
domCorpus = norm(domCorpus)

// ── Corpus 2: every string literal in the app source ──────────────────────
let srcCorpus = ''
function walk(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.next') walk(p); continue }
    if (!/\.(tsx?|ts)$/.test(e.name)) continue
    if (p.includes('src/lib/help/')) continue // don't let the docs validate themselves
    srcCorpus += ' ' + fs.readFileSync(p, 'utf8')
  }
}
walk('src')
srcCorpus = norm(srcCorpus)

// ── Pull the quoted phrases out of each step ──────────────────────────────
// Ignore placeholder tokens ({name}, {{clientName}}) and pure examples.
const QUOTE_RE = /"([^"]{2,60})"/g
type Miss = { slug: string; title: string; stepIdx: number; phrase: string; step: string }
const misses: Miss[] = []
let checked = 0

for (const a of HELP_ARTICLES) {
  a.steps.forEach((step, i) => {
    for (const m of step.matchAll(QUOTE_RE)) {
      const raw = m[1]
      if (/^\{+/.test(raw)) continue
      const phrase = norm(raw)
      // Strip a trailing ellipsis/arrow the UI may or may not render.
      const variants = new Set([
        phrase,
        phrase.replace(/\s*(\.\.\.|->)\s*$/, '').trim(),
        phrase.replace(/…/g, '').trim(),
      ])
      checked++
      const found = Array.from(variants).some(v => v.length > 1 && (domCorpus.includes(v) || srcCorpus.includes(v)))
      if (!found) misses.push({ slug: a.slug, title: a.title, stepIdx: i + 1, phrase: raw, step })
    }
  })
}

console.log(`quoted phrases checked: ${checked}`)
console.log(`not found anywhere: ${misses.length}\n`)
const bySlug = new Map<string, Miss[]>()
for (const m of misses) { const l = bySlug.get(m.slug) ?? []; l.push(m); bySlug.set(m.slug, l) }
for (const [slug, list] of bySlug) {
  console.log(`── ${slug} — ${list[0].title}`)
  for (const m of list) console.log(`   step ${m.stepIdx}: "${m.phrase}"\n     ↳ ${m.step}`)
}
fs.writeFileSync('tests/audit/out/control-name-misses.json', JSON.stringify(misses, null, 2))
