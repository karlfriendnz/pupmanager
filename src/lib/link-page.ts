// Shared pure helpers for the Instagram "link in bio" add-on. Used by BOTH the
// public page (server) and the in-app editor preview (client) so what a trainer
// previews is exactly what a visitor sees. No server-only imports here.

export interface LinkPageConfig {
  headline: string | null
  bio: string | null
  showBooking: boolean
  showWebsite: boolean
  showContact: boolean
  instagram: string | null
  facebook: string | null
  tiktok: string | null
  links: { label: string; url: string }[]
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
export type LinkButtonIcon = 'calendar' | 'link' | 'globe' | 'mail' | 'phone'

// A single rendered button on the public page.
export interface LinkButton {
  key: string
  label: string
  href: string
  /** Leading icon shown at the left of the button. */
  icon: LinkButtonIcon
  /** External http(s) link → open in a new tab with rel="noopener noreferrer". */
  external: boolean
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

/**
 * Build the ordered list of MAIN buttons the public page renders, from the
 * trainer's branding + their link-page config. Order: Book → custom links →
 * Website → Email → Call. Socials are NOT included here — they render as their
 * own icon row (see buildSocialLinks). A phone is only ever exposed when
 * showPhoneToClients is true.
 */
export function buildLinkButtons(cfg: LinkPageConfig, trainer: LinkPageTrainer): LinkButton[] {
  const out: LinkButton[] = []

  if (cfg.showBooking) {
    out.push({ key: 'book', label: 'Book a session', href: `/c/${trainer.slug}/book`, icon: 'calendar', external: false })
  }

  cfg.links.forEach((l, i) => {
    const label = l.label.trim()
    const href = safeExternalUrl(l.url)
    if (label && href) out.push({ key: `link-${i}`, label, href, icon: 'link', external: true })
  })

  if (cfg.showWebsite) {
    const href = safeExternalUrl(trainer.website)
    if (href) out.push({ key: 'website', label: 'Visit our website', href, icon: 'globe', external: true })
  }

  if (cfg.showContact) {
    const email = (trainer.publicEmail ?? '').trim()
    if (email) out.push({ key: 'email', label: 'Email us', href: `mailto:${email}`, icon: 'mail', external: false })
    const phone = (trainer.phone ?? '').trim()
    if (trainer.showPhoneToClients && phone) {
      out.push({ key: 'call', label: 'Call us', href: `tel:${phone.replace(/\s+/g, '')}`, icon: 'phone', external: false })
    }
  }

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
