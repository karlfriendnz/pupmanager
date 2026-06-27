import { prisma } from '@/lib/prisma'
import { slugifyName } from '@/lib/booking-page'

// Helpers for the Lead Magnets add-on.

export const DEFAULT_CONSENT_TEXT = 'I agree to receive emails and accept the privacy policy.'

// A lead-magnet slug unique within the trainer. Appends -2, -3 … on clash.
// `excludeId` lets a rename keep its own slug without colliding with itself.
export async function uniqueLeadMagnetSlug(trainerId: string, desired: string, excludeId?: string): Promise<string> {
  const base = slugifyName(desired) || 'download'
  let slug = base
  for (let n = 2; ; n++) {
    const clash = await prisma.leadMagnet.findFirst({
      where: { trainerId, slug, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    })
    if (!clash) return slug
    slug = `${base}-${n}`
  }
}
