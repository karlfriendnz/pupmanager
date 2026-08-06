import { prisma } from '@/lib/prisma'
import { can, type PermissionMap } from '@/lib/permissions'
import type { CompanyRole } from '@/generated/prisma'
import { TagsPanel } from './tags-panel'

/**
 * Settings → Tags. The words a trainer groups their own catalogue by.
 *
 * Karl, 2026-08-06: "please move tags to settings area". A tag is configuration
 * — it isn't a sixth thing to sell, it's how a trainer decides their offerings
 * and their shop hang together — so it belongs beside the rest of the
 * configuration rather than at the foot of a list of products.
 *
 * WHERE — directly after "What you call things". Both tabs are the trainer's
 * own vocabulary for their own catalogue: one renames our words, the other adds
 * theirs. Configure ("what have I switched on") and Add-ons ("what costs extra")
 * answer different questions and would have separated the two halves of the same
 * idea.
 *
 * NO second tags UI. The panel is the component that stood at /offerings/tags,
 * writing to the same four `/api/tags` routes. /offerings/tags now redirects
 * here, and the per-tag screen (/offerings/tags/[tagId]) stays exactly where it
 * was — it is a detail screen about one tag's contents, not a settings surface.
 */

/**
 * May this person see the tab at all? The four `/api/tags` routes all guard on
 * `guardAnyPermission('packages.manage', 'products.manage')`, so this asks the
 * same question — a tab listing labels the viewer would 403 on the moment they
 * renamed one is worse than not showing it (the lesson from Automations).
 */
export function canSeeTags(role: CompanyRole, permissions: PermissionMap): boolean {
  return can('packages.manage', role, permissions) || can('products.manage', role, permissions)
}

export async function TagsTab({ companyId }: { companyId: string }) {
  const tags = await prisma.tag.findMany({
    where: { trainerId: companyId },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    // The count is offerings AND products together, because that mixture is the
    // whole point of a tag.
    select: { id: true, name: true, imageUrl: true, _count: { select: { items: true } } },
  })

  return (
    <TagsPanel
      tags={tags.map(t => ({ id: t.id, name: t.name, imageUrl: t.imageUrl, items: t._count.items }))}
    />
  )
}
