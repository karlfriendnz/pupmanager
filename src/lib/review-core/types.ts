// GENERATED — do not edit here.
//
// Copied from the shared review-core package (types.ts, v0.1.1) by
// scripts/sync-review-core.mjs. fm-events reads the same source, so a fix made
// HERE is a fix that only PupManager gets. Change it in review-core:
//   https://github.com/karlfriendnz/review-core
// then re-run `node scripts/sync-review-core.mjs` and commit the result.

/** What a review pin captured about the element it points at. */
export interface ReviewTarget {
  /** Tag name, lowercased — 'button', 'input', … */
  tag: string
  /** Short, readable CSS-ish path (last 4 levels) for eyeballing + re-finding. */
  selector: string
  /** The element's own visible text, trimmed and capped. */
  text: string | null
  /** The FIELD this element belongs to ("How many dogs fit"). */
  label: string | null
  /** The SECTION/card it sits in ("Parts of the day"). */
  section: string | null
  /** Title of the dialog it is inside, when it is inside one. */
  dialog: string | null
  /**
   * WHICH VIEW of the page this was — "Tab: Offerings", "Step 4 · Who it's for".
   * A wizard is several screens sharing one route, so without this every step's
   * comments pile onto one indistinguishable page.
   */
  scope: string | null
  placeholder: string | null
  /** Nearest owning component. Dev builds only, and only when a resolver is set. */
  component: string | null
  /** Component ancestry, nearest first — the render path to this element. */
  componentChain: string[]
  /** Its source file, when the framework can say. Dev builds only. */
  componentFile: string | null
  /** Full URL at capture time (the page key drops the query + ids). */
  url: string
  /**
   * Structural nth-child path from the document root. This is what lets a pin
   * RE-FIND its element later: unlike `selector` it is unambiguous, and unlike
   * (x, y) it is unaffected by the window resizing, a section collapsing, or
   * content above reflowing.
   */
  domPath: string
  /**
   * Where in the element the click landed, as a 0..1 fraction of its box. The pin
   * is redrawn at rect + (offset × size), so it keeps its spot on the thing it
   * points at as that thing changes size.
   */
  offsetX: number
  offsetY: number
}

/**
 * What the framework can tell us about who rendered an element.
 *
 * Supplied by the host app because this is the ONE part that cannot be
 * framework-agnostic: Vue tags DOM nodes with `__vueParentComponent`, React with
 * `__reactFiber$…`, and neither exists in a production build. Everything else in
 * this package touches only the DOM.
 */
export interface ComponentResolver {
  (el: Element): { name: string | null; file: string | null; chain: string[] }
}

/**
 * The host app's own markup conventions. Every field has a working default — an
 * app that passes nothing still gets useful captures, which is what lets this run
 * on a page (or a site) that knows nothing about it.
 */
export interface ReviewTargetConfig {
  /**
   * Selectors, relative to a climbed ancestor (`:scope > …`), that name the
   * SECTION an element sits in. Ordered: the first match wins.
   */
  sectionSelectors: string[]
  /** Selectors that name the FIELD an element belongs to. */
  labelSelectors: string[]
  /** Selectors for "am I inside a modal". */
  dialogSelectors: string[]
  /** Selectors for the modal's own title, searched inside the dialog host. */
  dialogTitleSelectors: string[]
  /** Selectors for the highlighted item of a tab/step strip — the scope fallback. */
  activeStepSelectors: string[]
  /** Class-name prefixes to ignore when building a readable selector (utility CSS). */
  utilityClassPattern: RegExp
  /** Framework hook for component names. Omitted = no component info. */
  resolveComponents?: ComponentResolver
}

/** One comment, as the brief generator needs it. A subset of whatever the host
 *  app stores, so this stays testable and storage-agnostic. */
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
