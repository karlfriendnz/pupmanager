// Shared pure helpers for the Instagram "link in bio" add-on. Used by BOTH the
// public page (server) and the in-app editor preview (client) so what a trainer
// previews is exactly what a visitor sees. No server-only imports here.

/**
 * The kind of a smart-link row. Each type resolves its href differently at
 * render time (see resolveButtonHref):
 *  - CUSTOM      → a raw http(s) url the trainer typed
 *  - BOOKING     → /c/<slug>/book  (+ /<targetId> for a specific booking page)
 *  - LEADMAGNET  → /c/<slug>/free/<targetId>
 *  - FORM        → /form/<targetId>  (embed form id)
 *  - SIGNIN      → /c/<slug>  (branded client login)
 *  - WEBSITE     → the trainer's website
 *  - EMAIL       → mailto:<publicEmail>
 *  - CALL        → tel:<phone>  (only when showPhoneToClients)
 */
export type LinkButtonType =
  | 'CUSTOM'
  | 'BOOKING'
  | 'LEADMAGNET'
  | 'FORM'
  | 'SIGNIN'
  | 'WEBSITE'
  | 'EMAIL'
  | 'CALL'

export const LINK_BUTTON_TYPES: readonly LinkButtonType[] = [
  'CUSTOM',
  'BOOKING',
  'LEADMAGNET',
  'FORM',
  'SIGNIN',
  'WEBSITE',
  'EMAIL',
  'CALL',
] as const

export function isLinkButtonType(value: unknown): value is LinkButtonType {
  return typeof value === 'string' && (LINK_BUTTON_TYPES as readonly string[]).includes(value)
}

/**
 * One ordered smart-link row (mirrors a LinkPageButton). `url` is only used by
 * CUSTOM; `targetId` carries the type-specific reference (booking-page slug,
 * lead-magnet slug, or embed-form id); imageUrl/bgColor/textColor are the
 * per-button style. `id` is optional (used only as a stable render key).
 */
export interface LinkButtonRow {
  id?: string
  type: LinkButtonType
  label: string
  url?: string | null
  targetId?: string | null
  imageUrl?: string | null
  bgColor?: string | null
  textColor?: string | null
}

export interface LinkPageConfig {
  headline: string | null
  bio: string | null
  instagram: string | null
  facebook: string | null
  tiktok: string | null
  /** The ordered smart-link rows. Order IS the array order (row index). */
  links: LinkButtonRow[]
}

/** A per-button style override. Every field is optional; absent ⇒ inherit page. */
export interface ButtonStyle {
  imageUrl?: string
  bgColor?: string
  textColor?: string
}

// ── Font choice ──────────────────────────────────────────────────────────────
// A small curated set of font stacks the trainer can pick for their page. `id`
// is what's stored (null = default); `stack` is dropped straight into
// `fontFamily`. The app already loads Geist (--font-sans) and Baloo 2
// (--font-baloo) globally, so the CSS vars resolve on every route incl. /l.
export interface LinkPageFont {
  id: string
  label: string
  stack: string
}

export const LINK_PAGE_FONTS: readonly LinkPageFont[] = [
  { id: 'default', label: 'Default', stack: 'var(--font-sans)' },
  { id: 'rounded', label: 'Rounded', stack: 'var(--font-baloo)' },
  { id: 'serif', label: 'Serif', stack: "Georgia, 'Times New Roman', serif" },
  { id: 'mono', label: 'Mono', stack: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
] as const

export type LinkPageFontId = (typeof LINK_PAGE_FONTS)[number]['id']

/** True for a known font id ('default' | 'rounded' | 'serif' | 'mono'). */
export function isLinkPageFontId(value: unknown): value is LinkPageFontId {
  return typeof value === 'string' && LINK_PAGE_FONTS.some((f) => f.id === value)
}

/** Resolve a stored font id (or null) to a CSS fontFamily stack. */
export function linkPageFontStack(id: string | null | undefined): string {
  const found = id ? LINK_PAGE_FONTS.find((f) => f.id === id) : null
  return (found ?? LINK_PAGE_FONTS[0]).stack
}

export interface LinkPageTrainer {
  slug: string
  website: string | null
  publicEmail: string | null
  phone: string | null
  showPhoneToClients: boolean
}

/** Leading-icon id for a main button; mapped to a lucide icon in the view. */
export type LinkButtonIcon =
  | 'calendar'
  | 'link'
  | 'globe'
  | 'mail'
  | 'phone'
  | 'login'
  | 'gift'
  | 'message'

// A single rendered button on the public page.
export interface LinkButton {
  key: string
  label: string
  href: string
  /** Leading icon shown at the left of the button. */
  icon: LinkButtonIcon
  /** External http(s) link → open in a new tab with rel="noopener noreferrer". */
  external: boolean
  /**
   * Resolved per-button style overrides (undefined when this button has none).
   * Only clean values survive: bgColor/textColor are hex, font is a valid
   * LINK_PAGE_FONTS id, imageUrl is a safe http(s) URL.
   */
  style?: ButtonStyle
}

/** A #rgb / #rrggbb hex colour. */
export const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/**
 * Defensively normalise a raw per-button style entry to a clean ButtonStyle, or
 * undefined when nothing valid remains. Only passes through hex-looking colours
 * and a safe http(s) imageUrl — anything else drops.
 */
export function normalizeButtonStyle(raw: unknown): ButtonStyle | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const out: ButtonStyle = {}
  if (typeof r.bgColor === 'string' && HEX_COLOR.test(r.bgColor.trim())) out.bgColor = r.bgColor.trim()
  if (typeof r.textColor === 'string' && HEX_COLOR.test(r.textColor.trim())) out.textColor = r.textColor.trim()
  if (typeof r.imageUrl === 'string') {
    const safe = safeExternalUrl(r.imageUrl)
    if (safe) out.imageUrl = safe
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** A social profile shown in the icon row (separate from the main buttons). */
export interface SocialLink {
  platform: 'instagram' | 'facebook' | 'tiktok'
  href: string
}

/** True only for a well-formed absolute http/https URL. */
export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Normalise an outbound link to a safe http(s) href, or null if it can't be.
 * A bare domain ("example.com") is assumed https. Anything that isn't http(s)
 * after that (mailto:, javascript:, data:, …) is rejected — the public page
 * only ever renders http(s) for custom/website/social links.
 */
export function safeExternalUrl(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return null
  // A bare domain ("example.com") gets https; anything that already carries a
  // scheme (http:, mailto:, javascript:, …) is left as-is and validated below,
  // so non-http(s) schemes are rejected rather than smuggled through.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  const withProto = hasScheme ? trimmed : `https://${trimmed}`
  try {
    const u = new URL(withProto)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.href
  } catch {
    return null
  }
}

const SOCIAL_BASE: Record<'instagram' | 'facebook' | 'tiktok', string> = {
  instagram: 'https://instagram.com/',
  facebook: 'https://facebook.com/',
  tiktok: 'https://tiktok.com/@',
}

/**
 * Turn a social handle OR a full URL into the right profile URL. A leading "@"
 * is stripped; an already-absolute http(s) URL is used as-is (validated).
 * Returns null for empty/unusable input.
 */
export function socialUrl(kind: 'instagram' | 'facebook' | 'tiktok', value: string | null | undefined): string | null {
  const v = (value ?? '').trim()
  if (!v) return null
  if (/^https?:\/\//i.test(v)) return safeExternalUrl(v)
  const handle = v.replace(/^@+/, '').replace(/^\/+|\/+$/g, '')
  if (!handle) return null
  return SOCIAL_BASE[kind] + handle
}

/** The resolved href + presentation for a smart-link row, or null if unusable. */
interface ResolvedButton {
  href: string
  icon: LinkButtonIcon
  external: boolean
}

/**
 * Resolve one smart-link row to its href + icon + external flag, honouring every
 * gate (a valid target/profile field must exist). Returns null when the row
 * can't resolve to a usable link so the caller can skip it.
 */
function resolveButton(row: LinkButtonRow, trainer: LinkPageTrainer): ResolvedButton | null {
  const slug = (trainer.slug ?? '').trim()
  const targetId = (row.targetId ?? '').trim()
  switch (row.type) {
    case 'CUSTOM': {
      const href = safeExternalUrl(row.url)
      return href ? { href, icon: 'link', external: true } : null
    }
    case 'BOOKING': {
      if (!slug) return null
      const href = targetId ? `/c/${slug}/book/${targetId}` : `/c/${slug}/book`
      return { href, icon: 'calendar', external: false }
    }
    case 'LEADMAGNET': {
      if (!slug || !targetId) return null
      return { href: `/c/${slug}/free/${targetId}`, icon: 'gift', external: false }
    }
    case 'FORM': {
      if (!targetId) return null
      return { href: `/form/${targetId}`, icon: 'message', external: false }
    }
    case 'SIGNIN': {
      if (!slug) return null
      return { href: `/c/${slug}`, icon: 'login', external: false }
    }
    case 'WEBSITE': {
      const href = safeExternalUrl(trainer.website)
      return href ? { href, icon: 'globe', external: true } : null
    }
    case 'EMAIL': {
      const email = (trainer.publicEmail ?? '').trim()
      return email ? { href: `mailto:${email}`, icon: 'mail', external: false } : null
    }
    case 'CALL': {
      const phone = (trainer.phone ?? '').trim()
      if (!trainer.showPhoneToClients || !phone) return null
      return { href: `tel:${phone.replace(/\s+/g, '')}`, icon: 'phone', external: false }
    }
    default:
      return null
  }
}

/**
 * Build the ordered list of MAIN buttons the public page renders from the
 * trainer's ORDERED smart-link rows. Each row resolves its own href by `type`
 * (see resolveButton); a row that can't resolve (missing target/profile field,
 * blank label, or an unsafe custom url) is skipped. The row's own imageUrl /
 * bgColor / textColor become the per-button style. Socials are NOT included here
 * — they render as their own icon row (see buildSocialLinks). A phone is only
 * ever exposed when showPhoneToClients is true.
 */
export function buildLinkButtons(cfg: LinkPageConfig, trainer: LinkPageTrainer): LinkButton[] {
  const out: LinkButton[] = []
  cfg.links.forEach((row, i) => {
    const label = (row.label ?? '').trim()
    if (!label) return
    const resolved = resolveButton(row, trainer)
    if (!resolved) return
    const style = normalizeButtonStyle({
      imageUrl: row.imageUrl ?? undefined,
      bgColor: row.bgColor ?? undefined,
      textColor: row.textColor ?? undefined,
    })
    out.push({
      key: row.id ?? `row-${i}`,
      label,
      href: resolved.href,
      icon: resolved.icon,
      external: resolved.external,
      ...(style ? { style } : {}),
    })
  })
  return out
}

/**
 * Build the social icon row (Instagram → Facebook → TikTok), separate from the
 * main vertical button stack. Only entries with a usable handle/URL appear.
 */
export function buildSocialLinks(cfg: Pick<LinkPageConfig, 'instagram' | 'facebook' | 'tiktok'>): SocialLink[] {
  const out: SocialLink[] = []
  const ig = socialUrl('instagram', cfg.instagram)
  if (ig) out.push({ platform: 'instagram', href: ig })
  const fb = socialUrl('facebook', cfg.facebook)
  if (fb) out.push({ platform: 'facebook', href: fb })
  const tt = socialUrl('tiktok', cfg.tiktok)
  if (tt) out.push({ platform: 'tiktok', href: tt })
  return out
}
