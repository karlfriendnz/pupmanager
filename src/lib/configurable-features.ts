import { ADDONS, type AddonDef, type AddonId } from './pricing'

/**
 * Which add-ons are FEATURES YOU SWITCH ON, and which are things you BUY.
 *
 * They were one list, and it didn't work: fifteen free features sat among five
 * paid ones on a single Add-ons page, each as a marketing card with a paragraph of
 * copy. Turning on something you already own meant reading sales writing to find
 * it. So the page splits in two — Configure is the switchboard, Add-ons is the
 * shop — and this module is the one place that decides which is which, so the two
 * pages can never disagree or double-list the same thing.
 *
 * The rule: free (price 0, never touches Stripe) → Configure. Costs money →
 * Add-ons. Coming-soon previews stay on Add-ons, because they're advertising.
 */

/** Groups, in the order a trainer meets them: what you sell, then how you get
 *  paid, then what helps you run it, then what you plug it into. */
export const FEATURE_GROUPS = ['offerings', 'money', 'tools', 'integrations'] as const
export type FeatureGroup = (typeof FEATURE_GROUPS)[number]

export const FEATURE_GROUP_LABEL: Record<FeatureGroup, string> = {
  offerings: 'What you offer',
  money: 'Taking money',
  tools: 'Running the business',
  integrations: 'Connected to other apps',
}

export const FEATURE_GROUP_HINT: Record<FeatureGroup, string> = {
  offerings: 'Each one adds its own screen and its own kind of booking.',
  money: 'How clients pay you, and how a sale gets recorded.',
  tools: 'Extras that show up while you work.',
  integrations: 'Things PupManager talks to on your behalf.',
}

/** Which group each switchable feature belongs in. A free add-on missing from
 *  here still appears — under tools — so a new one can never be invisible. */
const GROUP_BY_ID: Partial<Record<AddonId, FeatureGroup>> = {
  onetoone: 'offerings',
  classes: 'offerings',
  dropins: 'offerings',
  events: 'offerings',
  puppyschool: 'offerings',
  memberships: 'offerings',
  payments: 'money',
  notes: 'tools',
  todos: 'tools',
  timesheets: 'tools',
  library: 'tools',
  clientapp: 'tools',
  xero: 'integrations',
  googlecalendar: 'integrations',
  instagram: 'integrations',
}

export interface ConfigurableFeature {
  id: AddonId
  name: string
  description: string
  group: FeatureGroup
  /** On unless explicitly turned off — so an untouched account already has it. */
  defaultOn: boolean
  /** Built but not advertised. Listed only when the trainer already has it on. */
  hidden: boolean
  badge: string | null
}

function toFeature(a: AddonDef): ConfigurableFeature {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    group: GROUP_BY_ID[a.id] ?? 'tools',
    defaultOn: !!a.defaultOn,
    hidden: !!a.hidden,
    badge: a.badge ?? null,
  }
}

/**
 * Free add-ons that are NOT a switch, and must stay off the Configure page.
 *
 * `payments` — its on/off state mirrors whether Stripe Connect charges are enabled,
 * not a TrainerAddon row (see addons-tab). A switch would show the wrong state and
 * flipping it wouldn't connect anything; it has its own Payments tab.
 *
 * `pos` (Instant sale) — comes WITH the shop (see IMPLIED_BY in lib/billing).
 * Selling to a client on the spot is the same job as selling to them online, from
 * the other side of the counter, so it isn't a separate decision to make.
 */
const NOT_A_SWITCH: ReadonlySet<AddonId> = new Set<AddonId>(['payments', 'pos'])

/**
 * Everything the Configure page can switch.
 *
 * `activeIds` is what the trainer currently has on, and it only affects HIDDEN
 * features: one that isn't advertised yet still has to be visible to whoever
 * already turned it on, or they can't turn it back off.
 */
export function configurableFeatures(activeIds: ReadonlySet<string> = new Set()): ConfigurableFeature[] {
  return ADDONS
    .filter(a => a.free && !a.comingSoon)
    .filter(a => !NOT_A_SWITCH.has(a.id))
    .filter(a => !a.hidden || activeIds.has(a.id))
    .map(toFeature)
}

/** The same list, split into its groups, empty groups dropped. */
export function groupedFeatures(
  activeIds: ReadonlySet<string> = new Set(),
): { group: FeatureGroup; features: ConfigurableFeature[] }[] {
  const all = configurableFeatures(activeIds)
  return FEATURE_GROUPS
    .map(group => ({ group, features: all.filter(f => f.group === group) }))
    .filter(g => g.features.length > 0)
}

/** Features that live elsewhere because they aren't a simple switch. */
export function notASwitch(): readonly AddonId[] {
  return [...NOT_A_SWITCH]
}

/** What the Add-ons page sells: the ones that cost money, plus the previews. */
export function purchasableAddons(): AddonDef[] {
  return ADDONS.filter(a => !a.free && !a.hidden)
}

/**
 * Is this feature on right now?
 *
 * `defaultOn` features are on unless a row says otherwise, which is why this can't
 * just be a set lookup — a trainer who has never opened Settings still has the
 * client app and session notes.
 */
export function featureIsOn(
  id: AddonId,
  rows: ReadonlyMap<string, boolean>,
): boolean {
  const explicit = rows.get(id)
  if (explicit !== undefined) return explicit
  return !!ADDONS.find(a => a.id === id)?.defaultOn
}

/**
 * Where to send someone who landed on a screen whose feature is switched off.
 *
 * It matters which tab: since the split, a FREE feature's switch lives on
 * Configure and is not on the Add-ons page at all. Every gated page used to
 * redirect to `?tab=addons`, so turning Casual classes off and clicking it again
 * dropped the trainer on a page where the switch didn't exist — a dead end with no
 * way back to the thing they wanted.
 *
 * Derived from the catalogue rather than listed per page, so a new add-on gets the
 * right destination without anyone remembering to add it.
 */
export function addonSettingsHref(id: string): string {
  const def = ADDONS.find(a => a.id === id)
  // Unknown ids fall to the shop, which is the safer wrong answer: it lists the
  // paid things and links onward to Configure.
  return def?.free ? '/settings?tab=configure' : '/settings?tab=addons'
}
