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

export interface LinkPageTrainer {
  slug: string
  website: string | null
  publicEmail: string | null
  phone: string | null
  showPhoneToClients: boolean
}

// A single rendered button on the public page.
export interface LinkButton {
  key: string
  label: string
  href: string
  /** External http(s) link → open in a new tab with rel="noopener noreferrer". */
  external: boolean
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
 * Build the ordered list of buttons the public page renders, from the trainer's
 * branding + their link-page config. Order: Book → custom links → Website →
 * Instagram/Facebook/TikTok → Email → Call. A phone is only ever exposed when
 * showPhoneToClients is true.
 */
export function buildLinkButtons(cfg: LinkPageConfig, trainer: LinkPageTrainer): LinkButton[] {
  const out: LinkButton[] = []

  if (cfg.showBooking) {
    out.push({ key: 'book', label: 'Book a session', href: `/c/${trainer.slug}/book`, external: false })
  }

  cfg.links.forEach((l, i) => {
    const label = l.label.trim()
    const href = safeExternalUrl(l.url)
    if (label && href) out.push({ key: `link-${i}`, label, href, external: true })
  })

  if (cfg.showWebsite) {
    const href = safeExternalUrl(trainer.website)
    if (href) out.push({ key: 'website', label: 'Visit our website', href, external: true })
  }

  const ig = socialUrl('instagram', cfg.instagram)
  if (ig) out.push({ key: 'instagram', label: 'Instagram', href: ig, external: true })
  const fb = socialUrl('facebook', cfg.facebook)
  if (fb) out.push({ key: 'facebook', label: 'Facebook', href: fb, external: true })
  const tt = socialUrl('tiktok', cfg.tiktok)
  if (tt) out.push({ key: 'tiktok', label: 'TikTok', href: tt, external: true })

  if (cfg.showContact) {
    const email = (trainer.publicEmail ?? '').trim()
    if (email) out.push({ key: 'email', label: 'Email us', href: `mailto:${email}`, external: false })
    const phone = (trainer.phone ?? '').trim()
    if (trainer.showPhoneToClients && phone) {
      out.push({ key: 'call', label: 'Call us', href: `tel:${phone.replace(/\s+/g, '')}`, external: false })
    }
  }

  return out
}
