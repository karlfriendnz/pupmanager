// Shared validation + item-reconcile for the membership CRUD routes.
import { z } from 'zod'
import type { Prisma } from '@/generated/prisma'

const hexColor = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Use a hex colour like #14b8a6').nullable().optional()

const itemSchema = z.object({
  kind: z.enum(['PACKAGE', 'CLASS', 'PRODUCT']),
  packageId: z.string().nullable().optional(),
  classRunId: z.string().nullable().optional(),
  productId: z.string().nullable().optional(),
  quantity: z.number().int().min(1).max(50).default(1),
  regrantOnRenewal: z.boolean().optional(),
  // Optional presentation overrides — null/absent = use the offering's own.
  imageUrl: z.string().url().nullable().optional(),
  description: z.string().max(50000).nullable().optional(),
}).refine(
  i => (i.kind === 'PACKAGE' && !!i.packageId) || (i.kind === 'CLASS' && !!i.classRunId) || (i.kind === 'PRODUCT' && !!i.productId),
  { message: 'Each item needs a matching offering' },
)

export const membershipCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name the membership').max(120),
  description: z.string().max(50000).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  // Storefront card styling — hex colours (#fff or #ffffff). Null clears.
  bgColor: hexColor,
  headerColor: hexColor,
  textColor: hexColor,
  featuredColor: hexColor,
  buttonText: z.string().trim().max(40).nullable().optional(),
  priceCents: z.number().int().min(0).max(10_000_000),
  cadence: z.enum(['ONE_OFF', 'RECURRING']).default('ONE_OFF'),
  interval: z.enum(['WEEK', 'FORTNIGHT', 'MONTH']).nullable().optional(),
  minTermCount: z.number().int().min(0).max(120).optional(),
  earlyTermFeeCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  published: z.boolean().optional(),
  // RECURRING billing options — the client picks one. Empty for ONE_OFF.
  plans: z.array(z.object({
    interval: z.enum(['WEEK', 'FORTNIGHT', 'MONTH']),
    priceCents: z.number().int().min(0).max(10_000_000),
    minTermCount: z.number().int().min(0).max(120).optional(),
    earlyTermFeeCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  })).max(6).optional(),
  items: z.array(itemSchema).max(30).default([]),
})

export const membershipPatchSchema = membershipCreateSchema.partial()

export type MembershipItemInput = z.infer<typeof itemSchema>

/**
 * Verify every item points at an offering THIS trainer owns. Returns true when
 * all referenced packages / class runs / products belong to the trainer.
 */
export async function itemsOwnedByTrainer(
  tx: Prisma.TransactionClient,
  trainerId: string,
  items: MembershipItemInput[],
): Promise<boolean> {
  const packageIds = [...new Set(items.filter(i => i.kind === 'PACKAGE').map(i => i.packageId!))]
  const classRunIds = [...new Set(items.filter(i => i.kind === 'CLASS').map(i => i.classRunId!))]
  const productIds = [...new Set(items.filter(i => i.kind === 'PRODUCT').map(i => i.productId!))]

  const [pkgs, runs, prods] = await Promise.all([
    packageIds.length ? tx.package.count({ where: { id: { in: packageIds }, trainerId } }) : 0,
    classRunIds.length ? tx.classRun.count({ where: { id: { in: classRunIds }, trainerId } }) : 0,
    productIds.length ? tx.product.count({ where: { id: { in: productIds }, trainerId } }) : 0,
  ])
  return pkgs === packageIds.length && runs === classRunIds.length && prods === productIds.length
}

/** Map validated recurring billing options to createMany rows. */
export function planRows(membershipId: string, plans: NonNullable<z.infer<typeof membershipCreateSchema>['plans']>) {
  return plans.map((p, idx) => ({
    membershipId,
    interval: p.interval,
    priceCents: p.priceCents,
    minTermCount: p.minTermCount ?? 0,
    earlyTermFeeCents: p.earlyTermFeeCents ?? null,
    order: idx,
  }))
}

/** Map validated item inputs to createMany rows for a membership. */
export function itemRows(membershipId: string, items: MembershipItemInput[]) {
  return items.map((i, idx) => ({
    membershipId,
    kind: i.kind,
    packageId: i.kind === 'PACKAGE' ? i.packageId! : null,
    classRunId: i.kind === 'CLASS' ? i.classRunId! : null,
    productId: i.kind === 'PRODUCT' ? i.productId! : null,
    quantity: i.quantity,
    regrantOnRenewal: i.regrantOnRenewal ?? false,
    imageUrl: i.imageUrl ?? null,
    description: i.description ?? null,
    order: idx,
  }))
}
