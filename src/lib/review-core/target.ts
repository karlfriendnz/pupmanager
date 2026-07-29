// GENERATED — do not edit here.
//
// Copied from the shared review-core package (target.ts, v0.1.1) by
// scripts/sync-review-core.mjs. fm-events reads the same source, so a fix made
// HERE is a fix that only PupManager gets. Change it in review-core:
//   https://github.com/karlfriendnz/review-core
// then re-run `node scripts/sync-review-core.mjs` and commit the result.

/**
 * What did the reviewer actually CLICK?
 *
 * A review pin stores (x, y). That is enough to draw the pin back in the right
 * place and useless for anything else — "Padding" at (126, 186) tells a reader
 * nothing. This module turns the clicked element into a sentence a human (or an
 * agent) can act on: which field, in which section, rendered by which component.
 *
 * DELIBERATELY DEPENDENCY-FREE — it touches only `document` and the element handed
 * to it. That is what lets it serve a Vue app, a React app and (one day) a browser
 * extension from one copy. Everything app-specific is passed in via
 * `configureReviewTarget`; nothing app-specific is hardcoded here.
 *
 * Every lookup is best-effort. A capture failure must never stop someone leaving
 * a comment.
 */
import { reviewTargetConfig } from './config'
import type { ReviewTarget } from './types'

const MAX_TEXT = 120
const MAX_CLIMB = 8

function clean(s: string | null | undefined): string | null {
  if (!s) return null
  const t = s.replace(/\s+/g, ' ').trim()
  if (!t) return null
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t
}

/** Text of an element EXCLUDING nested interactive children, so a card's heading
 *  doesn't come back with every button label glued onto it. */
function ownText(el: Element): string | null {
  const parts: string[] = []
  el.childNodes.forEach(n => {
    if (n.nodeType === 3 /* TEXT_NODE */) parts.push(n.textContent || '')
    else if (n.nodeType === 1 /* ELEMENT_NODE */) {
      const e = n as Element
      if (!/^(button|input|select|textarea|svg)$/i.test(e.tagName)) parts.push(e.textContent || '')
    }
  })
  return clean(parts.join(' '))
}

/** First match among a list of selectors, relative to `host`, that isn't an
 *  ancestor of `el` (a heading that CONTAINS the element isn't its heading). */
function firstMatch(host: Element, selectors: string[], el: Element): Element | null {
  for (const sel of selectors) {
    let found: Element | null = null
    try { found = host.querySelector(sel) } catch { continue }
    if (found && !found.contains(el)) return found
  }
  return null
}

/**
 * A short CSS path. Not guaranteed unique — it exists to be READ, and to give a
 * rough re-find hint. Ids and the first meaningful class only; utility-CSS soup is
 * filtered out because 'flex items-center gap-2' identifies nothing.
 */
function shortSelector(el: Element): string {
  const { utilityClassPattern } = reviewTargetConfig()
  const seg = (e: Element): string => {
    if (e.id) return `#${e.id}`
    const tag = e.tagName.toLowerCase()
    const klass = Array.from(e.classList).find(c =>
      !utilityClassPattern.test(c) && c.length > 2 && !/^(ng|v)-/.test(c))
    return klass ? `${tag}.${klass}` : tag
  }
  const path: string[] = []
  let cur: Element | null = el
  for (let i = 0; cur && i < 4 && cur !== document.body; i++) {
    path.unshift(seg(cur))
    cur = cur.parentElement
  }
  return path.join(' > ')
}

/**
 * Unambiguous structural path: 'html:0>body:1>div:2>button:3'. Uses ids as
 * shortcuts where present (an id makes everything above it moot).
 */
function domPathOf(el: Element): string {
  const parts: string[] = []
  let cur: Element | null = el
  while (cur && cur !== document.documentElement) {
    if (cur.id) { parts.unshift(`#${cur.id}`); break }
    const parent: Element | null = cur.parentElement
    if (!parent) { parts.unshift(cur.tagName.toLowerCase()); break }
    const idx = Array.prototype.indexOf.call(parent.children, cur)
    parts.unshift(`${cur.tagName.toLowerCase()}:${idx}`)
    cur = parent
  }
  return parts.join('>')
}

/**
 * Walk a `domPath` back to a live element. Returns null the moment a step is
 * missing — a WRONG element would move the pin somewhere misleading, which is
 * worse than falling back to the stored coordinates.
 */
export function elementFromDomPath(path: string | null | undefined): Element | null {
  if (!path || typeof document === 'undefined') return null
  try {
    const steps = path.split('>')
    let cur: Element | null = null
    for (const step of steps) {
      if (step.startsWith('#')) {
        cur = document.getElementById(step.slice(1))
        if (!cur) return null
        continue
      }
      const [tag, idxRaw] = step.split(':')
      const idx = Number(idxRaw)
      const children: Element[] = cur
        ? Array.from(cur.children)
        : Array.from(document.documentElement.children)
      const next = Number.isFinite(idx) ? children[idx] : undefined
      if (!next || next.tagName.toLowerCase() !== tag) return null
      cur = next
    }
    return cur
  } catch {
    return null
  }
}

/**
 * Does this element still look like the thing that was pinned?
 *
 * Load-bearing, because comments are keyed by ROUTE PATTERN — a pin left on one
 * record's screen shows on every record's. A different record renders a different
 * DOM, so the stored structural path can land on a real element that is simply the
 * wrong one. Matching the identity we captured catches that; without this the pin
 * would sit confidently on the wrong control.
 */
function looksLikeTarget(el: Element, t: ReviewTarget): boolean {
  if (el.tagName.toLowerCase() !== t.tag) return false
  // LABEL is identity; TEXT is often just the current VALUE. A time field reads
  // "9:00 am" — change it to "10:00 am" and a text comparison decides this is a
  // different element, so the pin abandons the control it was placed on. When we
  // know the field's name, that alone decides.
  if (t.label) return findLabel(el) === t.label
  if (t.text) return clean(el.textContent) === t.text
  // Nothing distinctive at all — the structural path is all there is, and trusting
  // it beats losing the pin.
  return true
}

/**
 * Find the element a stored target points at. Tries the exact structural path
 * (verified — see above), then falls back to matching on the visible identifiers,
 * which survives markup that shifted since the pin was made.
 */
export function resolveTargetElement(t: ReviewTarget | null | undefined): Element | null {
  if (!t || typeof document === 'undefined') return null
  try {
    const exact = elementFromDomPath(t.domPath)
    if (exact && exact.isConnected && looksLikeTarget(exact, t)) return exact

    if (!t.text && !t.label) return null
    const candidates = Array.from(document.querySelectorAll(t.tag))
    // Prefer a candidate that agrees on label AND section — on a screen with
    // repeated rows ("Amount" ×10) the section is what tells them apart.
    const strong = candidates.find(el =>
      (!t.label || findLabel(el) === t.label)
      && (!t.text || clean(el.textContent) === t.text)
      && (!t.section || findSection(el) === t.section))
    if (strong) return strong
    return candidates.find(el => looksLikeTarget(el, t)) ?? null
  } catch {
    return null
  }
}

/** The field name for this element, by decreasing reliability. */
export function findLabel(el: Element): string | null {
  const aria = clean(el.getAttribute('aria-label'))
  if (aria) return aria

  // A BUTTON IS NAMED BY ITS OWN TEXT. Everything below looks for a label pointing
  // AT the element — form-field conventions a button matches none of. Without this
  // a pin on a button came back with no name, and "Settings › button" is
  // unactionable on a screen holding five of them.
  const tag = el.tagName.toLowerCase()
  if (tag === 'button' || tag === 'a' || tag === 'summary' || el.getAttribute('role') === 'button') {
    const own = clean(el.textContent)
    if (own) return own
    // An icon-only button has no text — fall back to what the tooltip says.
    const tip = clean(el.getAttribute('title'))
    if (tip) return tip
  }

  const labelledBy = el.getAttribute('aria-labelledby')
  if (labelledBy) {
    const ref = document.getElementById(labelledBy)
    if (ref) { const t = clean(ref.textContent); if (t) return t }
  }

  if (el.id) {
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(el.id) : el.id
    const forLabel = document.querySelector(`label[for="${escaped}"]`)
    if (forLabel) { const t = clean(forLabel.textContent); if (t) return t }
  }

  const wrapping = el.closest('label')
  if (wrapping) { const t = clean(wrapping.textContent); if (t) return t }

  // Climb, looking for a label that belongs to this row rather than the page.
  const { labelSelectors } = reviewTargetConfig()
  let cur: Element | null = el.parentElement
  for (let i = 0; cur && i < MAX_CLIMB; i++) {
    const found = firstMatch(cur, labelSelectors, el)
    if (found) { const t = clean(found.textContent); if (t) return t }
    cur = cur.parentElement
  }
  return null
}

/**
 * A section NAME is short. Anything longer is not a heading — it's a container
 * whose text got scraped, and the whole page's nav reading as the section is worse
 * than no section at all. (Found on a screen whose layout wraps its nav in a
 * `<header>`: the capture came back with every menu item glued together.)
 */
const MAX_SECTION = 60

/** The section/card heading this element sits under. */
export function findSection(el: Element): string | null {
  const { sectionSelectors } = reviewTargetConfig()
  let cur: Element | null = el.parentElement
  for (let i = 0; cur && i < MAX_CLIMB + 4; i++) {
    const head = firstMatch(cur, sectionSelectors, el)
    if (head) {
      const t = ownText(head)
      // Keep climbing rather than returning junk: a nearer container that scraped
      // badly shouldn't stop us finding the real heading further up.
      if (t && t.length <= MAX_SECTION) return t
    }
    cur = cur.parentElement
  }
  return null
}

/**
 * Which VIEW of the page we are looking at — the open tab, the wizard step.
 *
 * Two sources, in order of trust:
 *  1. `data-review-scope` declared by the page. One attribute on a wizard shell
 *     covers every screen built on it; nothing else has to know.
 *  2. A generic sniff for the active item of a tab/step strip. Weaker, but it
 *     needs no cooperation — which is what makes this work on a foreign site.
 */
export function findScope(el: Element): string | null {
  const declared: string[] = []
  let cur: Element | null = el
  for (let i = 0; cur && i < 20; i++) {
    const v = cur.getAttribute?.('data-review-scope')
    if (v) declared.unshift(v)
    cur = cur.parentElement
  }
  if (declared.length) return clean(declared.join(' › '))

  // Nothing declared on this branch — a single scope holder elsewhere in the
  // document still tells us which view we are on.
  const holders = Array.from(document.querySelectorAll('[data-review-scope]'))
  if (holders.length === 1) {
    const t = clean(holders[0]!.getAttribute('data-review-scope'))
    if (t) return t
  }

  const active = document.querySelector(reviewTargetConfig().activeStepSelectors.join(', '))
  const t = clean(active?.textContent)
  return t && t.length <= 60 ? t : null
}

/** Title of the enclosing modal, when there is one. */
export function findDialog(el: Element): string | null {
  const { dialogSelectors, dialogTitleSelectors } = reviewTargetConfig()
  const host = el.closest(dialogSelectors.join(', '))
  if (!host) return null
  for (const sel of dialogTitleSelectors) {
    const title = host.querySelector(sel)
    const t = clean(title?.textContent)
    if (t) return t
  }
  return 'dialog'
}

/**
 * Describe one element. Never throws — a partial capture beats a lost comment.
 * `point` is the click position in VIEWPORT coords; without it the pin is treated
 * as pointing at the element's centre.
 */
export function describeElement(
  el: Element | null,
  point?: { clientX: number; clientY: number } | null,
): ReviewTarget | null {
  if (!el || typeof Element === 'undefined' || !(el instanceof Element)) return null
  try {
    const resolver = reviewTargetConfig().resolveComponents
    let comp = { name: null as string | null, file: null as string | null, chain: [] as string[] }
    if (resolver) {
      try { comp = resolver(el) } catch { /* a framework probe must never cost a comment */ }
    }
    let offsetX = 0.5
    let offsetY = 0.5
    if (point) {
      const r = el.getBoundingClientRect()
      if (r.width > 0) offsetX = Math.min(1, Math.max(0, (point.clientX - r.left) / r.width))
      if (r.height > 0) offsetY = Math.min(1, Math.max(0, (point.clientY - r.top) / r.height))
    }
    return {
      domPath: domPathOf(el),
      offsetX: Number(offsetX.toFixed(4)),
      offsetY: Number(offsetY.toFixed(4)),
      tag: el.tagName.toLowerCase(),
      selector: shortSelector(el),
      text: clean(el.textContent),
      label: findLabel(el),
      section: findSection(el),
      dialog: findDialog(el),
      scope: findScope(el),
      placeholder: clean(el.getAttribute('placeholder')),
      component: comp.name,
      componentFile: comp.file,
      componentChain: comp.chain,
      url: typeof location !== 'undefined' ? location.href : '',
    }
  } catch {
    return null
  }
}

/** Describe whatever sits at a viewport point (for a pin dropped by coordinate). */
export function describePoint(clientX: number, clientY: number): ReviewTarget | null {
  try {
    return describeElement(document.elementFromPoint(clientX, clientY), { clientX, clientY })
  } catch {
    return null
  }
}

/**
 * One human-readable line: "Event info › Who can see it › button 'Public'".
 * Used in the panel and in the exported brief.
 */
export function describeTargetLine(t: ReviewTarget | null | undefined): string {
  if (!t) return ''
  // A wizard step is usually named after the section it holds, so scope and
  // section repeat ("Step 1 · Event info › Event info"). Drop the echo.
  const section = t.section && !(t.scope || '').includes(t.section) ? t.section : null
  const parts = [t.scope, t.dialog && `dialog "${t.dialog}"`, section, t.label].filter(Boolean)
  const what = t.text && t.text.length <= 40 ? `${t.tag} "${t.text}"` : t.tag
  parts.push(what)
  return parts.join(' › ')
}
