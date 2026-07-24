// Shared validation for the discount CRUD routes + the editor. The stored shape
// mirrors the evaluator's DiscountRule (see ./evaluate.ts).
import { z } from 'zod'

export const modifierTypeEnum = z.enum(['PERCENT', 'FLAT', 'REPLACE'])
export const applyToEnum = z.enum(['per_item', 'per_person', 'cheapest_item', 'most_expensive_item', 'order_total'])

const conditionSchema = z.object({
  key: z.string().max(60),
  operator: z.string().max(12).optional(),
  value: z.any().optional(),
})

export const discountCreateSchema = z.object({
  // Which offering it attaches to. Null/absent = trainer-wide.
  packageId: z.string().nullable().optional(),
  name: z.string().trim().min(1, 'Name the discount').max(120),
  formText: z.string().trim().max(160).nullable().optional(),
  modifierType: modifierTypeEnum,
  // Cents for FLAT/REPLACE; a percent (0–100) for PERCENT.
  modifierValue: z.number().int().min(0).max(10_000_000),
  applyTo: applyToEnum.default('order_total'),
  conditions: z.array(conditionSchema).max(20).default([]),
  isActive: z.boolean().optional(),
  validFrom: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  maxUses: z.number().int().min(1).max(1_000_000).nullable().optional(),
}).refine(d => d.modifierType !== 'PERCENT' || d.modifierValue <= 100, {
  message: 'A percentage must be 100 or less', path: ['modifierValue'],
})

// PATCH: any subset of the editable fields (the offering it's attached to can't move).
export const discountPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  formText: z.string().trim().max(160).nullable().optional(),
  modifierType: modifierTypeEnum.optional(),
  modifierValue: z.number().int().min(0).max(10_000_000).optional(),
  applyTo: applyToEnum.optional(),
  conditions: z.array(conditionSchema).max(20).optional(),
  isActive: z.boolean().optional(),
  validFrom: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  maxUses: z.number().int().min(1).max(1_000_000).nullable().optional(),
})
