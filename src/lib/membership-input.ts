// Shared validation + item-reconcile for the membership CRUD routes.
import { z } from 'zod'
import type { Prisma } from '@/generated/prisma'
import { isValidIntervalCount, maxIntervalCount, type PlanInterval } from './billing-interval'

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
  name: z.string().trim().min(1, 'Name the package').max(120),
  description: z.string().max(50000).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  // Storefront card styling — hex colours (#fff or #ffffff). Null clears.
  bgColor: hexColor,
  headerColor: hexColor,
  textColor: hexColor,
  featuredColor: hexColor,
  // Buy-button colours. Stored as given; the 4.5:1 contrast guard in
  // lib/membership-card-colors.ts derives what actually gets painted.
  buttonBgColor: hexColor,
  buttonTextColor: hexColor,
  buttonText: z.string().trim().max(40).nullable().optional(),
  priceCents: z.number().int().min(0).max(10_000_000),
  cadence: z.enum(['ONE_OFF', 'RECURRING']).default('ONE_OFF'),
  interval: z.enum(['WEEK', 'FORTNIGHT', 'MONTH']).nullable().optional(),
  minTermCount: z.number().int().min(0).max(120).optional(),
  earlyTermFeeCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  published: z.boolean().optional(),
  // WHO the package is for. Separate from `published`, which is about whether
  // it is finished. A locked package is still published — showing someone the
  // rung above them is the point.
  eligibility: z.enum(['PUBLIC', 'ACHIEVEMENT', 'INVITE_ONLY']).optional(),
  showWhenLocked: z.boolean().optional(),
  // Achievement ids a client must ALREADY hold, all of them. Sending an empty
  // array clears the gate; omitting the key leaves it untouched.
  prerequisiteAchievementIds: z.array(z.string()).max(20).optional(),
  // RECURRING billing options — the client picks one. Empty for ONE_OFF.
  //
  // `intervalCount` is how many of the unit make one cycle: WEEK × 6 is "every
  // 6 weeks". Optional and defaulted to 1, so an older client (or the mobile
  // shell running yesterday's bundle) that sends no count still describes
  // exactly the plan it always did.
  //
  // FORTNIGHT is still ACCEPTED here even though the editor no longer offers
  // it. Refusing a value we ourselves wrote into live rows would mean a trainer
  // could not save a membership that already has a fortnightly plan on it.
  plans: z.array(z.object({
    interval: z.enum(['WEEK', 'FORTNIGHT', 'MONTH']),
    intervalCount: z.number().int().optional(),
    priceCents: z.number().int().min(0).max(10_000_000),
    minTermCount: z.number().int().min(0).max(120).optional(),
    earlyTermFeeCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  }).superRefine((p, ctx) => {
    // SERVER-SIDE bounds. A `min`/`max` on the number input is a hint; this is
    // the rule. 0 and negatives are nonsense, and anything over a year is
    // rejected by Stripe when the Price is minted — so accepting it here would
    // only move the failure to the moment a client tries to buy.
    if (p.intervalCount === undefined) return
    if (!isValidIntervalCount(p.interval as PlanInterval, p.intervalCount)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['intervalCount'],
        message: `Bill every 1 to ${maxIntervalCount(p.interval as PlanInterval)} ${p.interval === 'MONTH' ? 'months' : p.interval === 'FORTNIGHT' ? 'fortnights' : 'weeks'}`,
      })
    }
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
    // Absent = 1, which is the cycle every plan written before this column
    // existed has always billed on.
    intervalCount: p.intervalCount ?? 1,
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
