import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardPermission } from '@/lib/membership'
import { MAX_TAGS_PER_ITEM, TagScopeError, ownsTagTarget, setTagsFor, tagIdsFor, type TagTarget } from '@/lib/tags'

/**
 * Which tags one offering or product carries.
 *
 * Its OWN endpoint rather than a `tagIds` field on the package and product save
 * routes, for two reasons. The write is identical for both kinds — the same
 * ownership checks, the same set semantics — so one handler means the tenant
 * rule cannot be right in one route and missing in the other, which is exactly
 * how these things rot. And the offering save route is a 200-line payload that
 * rebuilds class runs and sessions; a trainer ticking a tag should not go
 * anywhere near it.
 */
export const runtime = 'nodejs'

const bodySchema = z
  .object({
    packageId: z.string().min(1).optional(),
    productId: z.string().min(1).optional(),
    tagIds: z.array(z.string().min(1)).max(MAX_TAGS_PER_ITEM),
  })
  // Exactly one target, mirroring the CHECK constraint on the table. Both or
  // neither is a bug in the caller, not something to guess at.
  .refine(b => !!b.packageId !== !!b.productId, { message: 'Name one of packageId / productId' })

/** A package is an offering, a product is shop stock — so each is gated on the
 *  permission that governs its own catalogue, not on one blanket key. */
async function guardFor(target: TagTarget) {
  return guardPermission('packageId' in target ? 'packages.manage' : 'products.manage')
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const packageId = url.searchParams.get('packageId')
  const productId = url.searchParams.get('productId')
  if (!packageId === !productId) {
    return NextResponse.json({ error: 'Name one of packageId / productId' }, { status: 400 })
  }
  const target: TagTarget = packageId ? { packageId } : { productId: productId! }

  const guard = await guardFor(target)
  if (guard instanceof NextResponse) return guard

  // Read is scoped the same way the write is: another trainer's id 404s rather
  // than listing the tags on their offering.
  if (!(await ownsTagTarget(guard.companyId, target))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ tagIds: await tagIdsFor(target) })
}

export async function PUT(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Pick a thing to tag' }, { status: 400 })
  }
  const { packageId, productId, tagIds } = parsed.data
  const target: TagTarget = packageId ? { packageId } : { productId: productId! }

  const guard = await guardFor(target)
  if (guard instanceof NextResponse) return guard

  try {
    return NextResponse.json({ tagIds: await setTagsFor(guard.companyId, target, tagIds) })
  } catch (err) {
    if (err instanceof TagScopeError) {
      // "Not found" is what another business's id gets — never a 403 naming a
      // row they aren't allowed to know exists.
      const status = err.message === 'Not found' ? 404 : 400
      return NextResponse.json({ error: err.message }, { status })
    }
    throw err
  }
}
