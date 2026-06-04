import { prisma } from '@/lib/prisma'

// URL-safe slug from arbitrary text: lowercase, strip accents, collapse
// non-alphanumerics to single hyphens, trim, cap length.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

// Return the trainer's public slug, generating + persisting a unique one from
// the business name on first call (lazy — avoids a bulk backfill). Returns null
// only if the trainer doesn't exist or every candidate somehow collides.
export async function ensureTrainerSlug(trainerId: string): Promise<string | null> {
  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { slug: true, businessName: true },
  })
  if (!trainer) return null
  if (trainer.slug) return trainer.slug

  const base = slugify(trainer.businessName) || 'trainer'
  const candidates = [
    base,
    ...[2, 3, 4, 5].map((n) => `${base}-${n}`),
    `${base}-${trainerId.slice(-6)}`,
  ]

  for (const candidate of candidates) {
    const taken = await prisma.trainerProfile.findUnique({
      where: { slug: candidate },
      select: { id: true },
    })
    if (taken) continue
    try {
      await prisma.trainerProfile.update({ where: { id: trainerId }, data: { slug: candidate } })
      return candidate
    } catch {
      // Unique race with a concurrent request — try the next candidate.
    }
  }
  return null
}

// Build the invite/activation link sent to a client. Prefers the trainer's
// branded /c/<slug> page (which shows the set-password flow when ?token= is
// present); falls back to the generic /invite if no slug.
export function clientInviteUrl(
  baseUrl: string,
  slug: string | null,
  token: string,
  email: string,
): string {
  const base = baseUrl.replace(/\/$/, '')
  const qs = `token=${token}&email=${encodeURIComponent(email)}`
  return slug ? `${base}/c/${slug}?${qs}` : `${base}/invite?${qs}`
}

// Validate a user-edited slug. Returns a normalised slug or an error string.
export function validateSlug(input: string): { ok: true; slug: string } | { ok: false; error: string } {
  const slug = slugify(input)
  if (slug.length < 3) return { ok: false, error: 'Use at least 3 letters or numbers.' }
  return { ok: true, slug }
}
