import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'
import type { PermissionMap } from '@/lib/permissions'
import type { CompanyRole } from '@/generated/prisma'
import { sanitizeNavLabels, sanitizeNavImages } from '@/lib/nav-labels'
import { NavLabelsPanel } from './nav-labels-panel'

/**
 * Settings → What you call things. Their words for their own menu.
 *
 * Its own page rather than a block at the bottom of Configure (Karl, 2026-07-30):
 * Configure answers "what do I have switched on", this answers "what is it
 * called". Two different questions, and the second was invisible under the first.
 *
 * Sanitized on read as well as on write, so a rename of something since locked or
 * removed quietly reverts to our default instead of showing a box that does
 * nothing.
 */
export async function NamingTab({
  companyId,
  role,
  permissions,
}: {
  companyId: string
  role: CompanyRole
  permissions: PermissionMap
}) {
  const profile = await prisma.trainerProfile.findUnique({
    where: { id: companyId },
    select: { navLabels: true, navImages: true },
  })

  return (
    <NavLabelsPanel
      initial={sanitizeNavLabels(profile?.navLabels)}
      // The picture goes on the same row as the word, because for a trainer
      // "what do I call Group Classes, and what does it look like" is one job.
      // Sanitized on read for the same reason the labels are: a picture stored
      // against a key we have since stopped showing quietly disappears rather
      // than rendering somewhere nobody meant.
      initialImages={sanitizeNavImages(profile?.navImages)}
      // Costs nothing, so the gate is "can this person change settings".
      canEdit={can('settings.edit', role, permissions)}
    />
  )
}
