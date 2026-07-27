import { z } from 'zod'
import { prisma } from '@/lib/prisma'

// Shared validation + helpers for the unified Form API (intake + enquiry).
// The question shape mirrors @/lib/session-form-builder's Question union — this
// is the trust boundary, so it's re-stated as a zod schema rather than cast.

const showIf = z.object({ questionId: z.string().min(1), equals: z.string() }).optional()

const baseQuestion = {
  id: z.string().min(1),
  required: z.boolean().default(false),
  isPrivate: z.boolean().optional(),
  showIf,
  step: z.string().optional(),
}

const choiceOptions = z.array(z.string().trim().min(1)).min(1).max(50)

export const questionSchema = z.discriminatedUnion('type', [
  z.object({ ...baseQuestion, type: z.literal('SHORT_TEXT'), label: z.string().min(1) }),
  z.object({ ...baseQuestion, type: z.literal('LONG_TEXT'), label: z.string().min(1) }),
  z.object({ ...baseQuestion, type: z.literal('NUMBER'), label: z.string().min(1) }),
  z.object({ ...baseQuestion, type: z.literal('RATING_1_5'), label: z.string().min(1) }),
  z.object({ ...baseQuestion, type: z.literal('DROPDOWN'), label: z.string().min(1), options: choiceOptions }),
  z.object({ ...baseQuestion, type: z.literal('RADIO'), label: z.string().min(1), options: choiceOptions }),
  z.object({ ...baseQuestion, type: z.literal('CHECKBOX'), label: z.string().min(1), options: choiceOptions }),
  z.object({ ...baseQuestion, type: z.literal('CUSTOM_FIELD'), customFieldId: z.string().min(1) }),
])

export const formSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(8000).nullable().optional(),
  usableAsIntake: z.boolean().default(false),
  usableAsEnquiry: z.boolean().default(false),
  slug: z.string().max(80).optional().nullable(),
  questions: z.array(questionSchema).min(1).max(60),
  steps: z.array(z.object({ id: z.string().min(1), title: z.string().max(80) })).max(20).optional(),
  thankYouTitle: z.string().max(200).nullable().optional(),
  thankYouMessage: z.string().max(2000).nullable().optional(),
  showBorder: z.boolean().optional(),
  buttonColor: z.string().max(20).nullable().optional(),
  inviteSubject: z.string().max(200).nullable().optional(),
  inviteBody: z.string().max(8000).nullable().optional(),
  inviteShowDiaryButton: z.boolean().optional(),
  inviteButtonLabel: z.string().max(60).nullable().optional(),
  isActive: z.boolean().optional(),
})

// Editing a form — everything optional so a PATCH can send just what changed
// (the publish toggle sends `{ isActive }` on its own).
//
// `.partial()` alone is NOT enough: `usableAsIntake` / `usableAsEnquiry` carry
// `.default(false)`, and zod applies a default even when the key is absent from
// a partial. A `{ isActive: false }` publish toggle would therefore parse as
// "…and it is no longer an intake form, nor an enquiry form", turning both off
// and nulling the public slug — silently unpublishing every live form URL. So
// the two flags are re-declared here as plain optional booleans with no default.
export const formPatchSchema = formSchema.partial().extend({
  usableAsIntake: z.boolean().optional(),
  usableAsEnquiry: z.boolean().optional(),
})

/**
 * Every CUSTOM_FIELD question must reference a CustomField this trainer owns,
 * so nobody can attach another trainer's fields to their form and read the
 * answers back out.
 */
export async function ensureLinkedFieldsOwned(
  questions: z.infer<typeof questionSchema>[],
  trainerId: string,
): Promise<{ ok: true } | { ok: false; missing: string[] }> {
  const linkedIds = questions
    .filter(q => q.type === 'CUSTOM_FIELD')
    .map(q => (q as { customFieldId: string }).customFieldId)
  if (linkedIds.length === 0) return { ok: true }
  const owned = await prisma.customField.findMany({
    where: { trainerId, id: { in: linkedIds } },
    select: { id: true },
  })
  const ownedSet = new Set(owned.map(f => f.id))
  const missing = linkedIds.filter(id => !ownedSet.has(id))
  return missing.length ? { ok: false, missing } : { ok: true }
}

export function slugify(s: string): string {
  return (
    s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'form'
  )
}

/**
 * A slug unique among this trainer's forms (suffix -2, -3, … on clash).
 * `excludeId` is ignored in the clash check so a form keeps its slug on edit.
 */
export async function uniqueFormSlug(trainerId: string, base: string, excludeId?: string): Promise<string> {
  const root = slugify(base)
  const taken = new Set(
    (await prisma.form.findMany({
      where: { trainerId, slug: { not: null }, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { slug: true },
    }))
      .map(f => f.slug)
      .filter((s): s is string => !!s),
  )
  if (!taken.has(root)) return root
  for (let i = 2; i < 500; i++) {
    const candidate = `${root}-${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `${root}-${Date.now()}`
}
