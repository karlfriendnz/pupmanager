import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { CLIENT_FIELD_KEYS } from '@/lib/client-fields'

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
  // A question whose answer is kept ON THE CLIENT'S RECORD, not just in this
  // form's answers — so it shows on their profile, sorts the clients list, and
  // reaches the reports and importers.
  //
  // `field` lets the BUILDER author that field, which it previously couldn't: a
  // trainer had to go to a separate "Your fields" screen, create it there, come
  // back, and link it. Sent with no customFieldId it creates the field; sent with
  // one it edits that field in place.
  //
  // Only ONE definition survives the save: the server writes `field` to the
  // CustomField and stores the question as a bare link (see persistLinkedFields).
  // Keeping a copy on the question as well is how a label ends up saying two
  // different things depending on which screen you're looking at.
  z.object({
    ...baseQuestion,
    type: z.literal('CUSTOM_FIELD'),
    customFieldId: z.string().min(1).optional(),
    field: z.object({
      label: z.string().trim().min(1).max(120),
      // The QUESTION's answer type, not a second type to choose. CustomField
      // stores only TEXT / NUMBER / DROPDOWN, so this is mapped down on save
      // (see customFieldTypeFor) — asking a trainer to pick a type twice, in two
      // vocabularies, for one question is how the old two-screen split felt.
      answerType: z.enum(['SHORT_TEXT', 'LONG_TEXT', 'NUMBER', 'RATING_1_5', 'DROPDOWN', 'RADIO', 'CHECKBOX']),
      options: z.array(z.string().trim().min(1)).max(50).optional(),
      appliesTo: z.enum(['OWNER', 'DOG']).default('OWNER'),
      category: z.string().trim().max(60).nullable().optional(),
      inQuickAdd: z.boolean().optional(),
    }).optional(),
  }).refine(q => !!q.customFieldId || !!q.field, {
    message: 'A saved-to-record question needs either an existing field or a new one to create',
  }),
  // Asks for one of the built-in client/dog details. The KEY is checked against
  // the known list rather than taken on trust: a form is authored in a browser,
  // and an unknown key would be a question nothing could ever answer.
  z.object({
    ...baseQuestion,
    type: z.literal('CLIENT_FIELD'),
    fieldKey: z.enum(CLIENT_FIELD_KEYS),
  }),
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
  // The continuous run: enquiry → password → intake → their own diary.
  // `continueIntakeFormId` is checked against the trainer's own intake forms
  // before it is written (resolveContinuationIntakeForm) — this only says the
  // shape is a string.
  continueToAccount: z.boolean().optional(),
  continueIntakeFormId: z.string().max(60).nullable().optional(),
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
 * Which of the three stored field types holds this answer.
 *
 * CustomField knows TEXT, NUMBER and DROPDOWN. Anything else maps down: a rating
 * is a number, radio buttons and tick-boxes are a list of choices.
 *
 * Note that this is NOT purely about storage. A saved question is normalised to a
 * bare link, so what the client sees is driven by the STORED type — authoring one
 * as radio buttons would quietly serve a dropdown. The builder therefore offers
 * only the three that survive (SAVED_FIELD_TYPES); this stays permissive so an
 * older or hand-made payload maps down safely rather than being rejected.
 */
export function customFieldTypeFor(answerType: string): 'TEXT' | 'NUMBER' | 'DROPDOWN' {
  switch (answerType) {
    case 'NUMBER':
    case 'RATING_1_5':
      return 'NUMBER'
    case 'DROPDOWN':
    case 'RADIO':
    case 'CHECKBOX':
      return 'DROPDOWN'
    default:
      return 'TEXT'
  }
}

type LinkedField = NonNullable<Extract<z.infer<typeof questionSchema>, { type: 'CUSTOM_FIELD' }>['field']>

/**
 * Write the fields the builder authored, and hand back the questions as bare
 * links.
 *
 * This is what lets the builder be the ONE place a field is made. A question with
 * `field` and no id creates the field; with both, it edits that field in place.
 * Either way the question is stored as `{ type, id, customFieldId, … }` only — the
 * CustomField is the single definition of what the field is called and how it
 * behaves, so the two can't drift into disagreeing.
 *
 * Ownership is re-checked per id rather than trusted, since an id arrives from the
 * browser: editing another trainer's field would rename it under them.
 */
export async function persistLinkedFields(
  questions: z.infer<typeof questionSchema>[],
  trainerId: string,
): Promise<{ ok: true; questions: z.infer<typeof questionSchema>[] } | { ok: false; missing: string[] }> {
  const linked = questions.filter(q => q.type === 'CUSTOM_FIELD')
  if (linked.length === 0) return { ok: true, questions }

  const withId = linked.filter(q => !!q.customFieldId).map(q => q.customFieldId!)
  const owned = new Set(
    (await prisma.customField.findMany({
      where: { trainerId, id: { in: withId } },
      select: { id: true },
    })).map(f => f.id),
  )
  const missing = withId.filter(id => !owned.has(id))
  if (missing.length) return { ok: false, missing }

  // Order matters to the trainer, and the field list is shown ordered elsewhere
  // (the clients-list filters, the profile), so a field's order follows its
  // position in the form that created it.
  const out: z.infer<typeof questionSchema>[] = []
  for (const [index, q] of questions.entries()) {
    if (q.type !== 'CUSTOM_FIELD' || !q.field) { out.push(q); continue }
    const f: LinkedField = q.field
    const data = {
      label: f.label,
      type: customFieldTypeFor(f.answerType),
      options: f.options && f.options.length > 0 ? f.options : undefined,
      appliesTo: f.appliesTo,
      category: f.category ?? null,
      required: q.required,
      ...(f.inQuickAdd !== undefined && { inQuickAdd: f.inQuickAdd }),
      order: index,
    }
    const saved = q.customFieldId
      ? await prisma.customField.update({ where: { id: q.customFieldId }, data })
      : await prisma.customField.create({ data: { ...data, trainerId } })
    out.push({ id: q.id, type: 'CUSTOM_FIELD', customFieldId: saved.id, required: q.required, ...(q.isPrivate !== undefined && { isPrivate: q.isPrivate }), ...(q.showIf && { showIf: q.showIf }), ...(q.step && { step: q.step }) })
  }
  return { ok: true, questions: out }
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

/**
 * Resolve the intake form a continuous run hands over to, from the id the
 * browser sent.
 *
 * The tenant check is the point. `continueIntakeFormId` arrives from a form
 * editor in a browser, and a form id belonging to another business would render
 * that business's questions — and their custom fields — to a stranger who
 * enquired here. So the id is looked up as "one of THIS trainer's intake forms"
 * or it becomes null; there is no third answer.
 *
 * Returns `undefined` when the caller sent nothing (a PATCH that changed
 * something else entirely), so the column is left alone.
 */
export async function resolveContinuationIntakeForm(
  raw: string | null | undefined,
  trainerId: string,
  /** The form being saved — it cannot hand over to itself. */
  selfId?: string,
): Promise<string | null | undefined> {
  if (raw === undefined) return undefined
  const id = raw?.trim()
  if (!id) return null
  // Handing over to itself would put a person who just answered these questions
  // straight back into them. Not an error worth failing a save over — the
  // handover simply doesn't happen.
  if (selfId && id === selfId) return null
  const form = await prisma.form.findFirst({
    where: { id, trainerId, usableAsIntake: true },
    select: { id: true },
  })
  return form?.id ?? null
}

// ─── Turning the two OLD models into real forms ──────────────────────────────
//
// A trainer's questions used to live in three places. `CustomField` rows were
// both the columns on a client's record AND — via the fallback intake gate — the
// questions a new client answered. `EmbedForm` was a separate lead-capture form
// with its own fixed field toggles. `Form` came last and does the asking
// properly: pages, conditional questions, a preview, an invite email.
//
// Karl, 2026-08-06, on the field library sitting in the forms list: "that should
// be an intake form", and on the embed editor: "this design is very very
// different to the other one … all forms should be the same right?"
//
// Both of these build a Form out of what already exists WITHOUT touching the
// thing they were built from. Kept here, pure, because the interesting parts —
// which page a question lands on, what happens to a key with no modern
// equivalent — are exactly the parts worth testing without a database.

export interface FieldForConversion {
  id: string
  required: boolean
  appliesTo: string | null
}

/**
 * The field library, as an intake form.
 *
 * Each question is a bare `customFieldId` link, which is the whole point: the
 * answers keep landing on exactly the same field they always did, so nothing
 * already collected moves and nobody is asked twice. Deleting the form later
 * leaves every field untouched.
 *
 * The old gate asked about the owner first and the dog second, so that reading
 * order becomes two real pages — unless one of them would be empty, because a
 * page a client taps Next through for no reason is worse than no page at all.
 */
export function buildIntakeFormFromFields(fields: FieldForConversion[]): {
  questions: z.infer<typeof questionSchema>[]
  steps: { id: string; title: string }[]
} {
  const ownerFields = fields.filter(f => f.appliesTo !== 'DOG')
  const dogFields = fields.filter(f => f.appliesTo === 'DOG')
  const steps = [
    ...(ownerFields.length ? [{ id: 'owner', title: 'About you' }] : []),
    ...(dogFields.length ? [{ id: 'dog', title: 'About your dog' }] : []),
  ]
  // One page is not a wizard — store no steps so it renders as a plain form.
  const useSteps = steps.length > 1

  const questions = [...ownerFields, ...dogFields].map(f => ({
    id: `q_${f.id}`,
    type: 'CUSTOM_FIELD' as const,
    customFieldId: f.id,
    required: f.required,
    ...(useSteps && { step: f.appliesTo === 'DOG' ? 'dog' : 'owner' }),
  }))

  return { questions, steps: useSteps ? steps : [] }
}

/**
 * An embed form's field toggles, as unified questions.
 *
 * The rule is REPRODUCE WHAT IT ASKS TODAY, not what its row says. Two places
 * where those differ:
 *
 *   - Name and email are not in `fields` at all. The public embed form renders
 *     them unconditionally and requires both (an enquiry with no way to reply is
 *     not an enquiry), so they are added here as required questions.
 *   - Old rows can still carry dogName / dogBreed / dogWeight / dogDob. The
 *     public form has filtered those out since they stopped being standard
 *     fields, so converting them in would ADD questions nobody is being asked —
 *     a silent change of behaviour dressed up as a migration. They come back as
 *     `skipped` instead, for the caller to say out loud.
 *
 * `message` has no client column to write to — it is the enquiry's own text —
 * so it becomes a plain long-text question rather than a CLIENT_FIELD.
 */
export function buildEnquiryFormFromEmbed(
  embedFields: { key: string; required: boolean }[],
  linkedFieldIds: string[],
  fieldRequired: Record<string, boolean> = {},
): { questions: z.infer<typeof questionSchema>[]; skipped: string[] } {
  const questions: z.infer<typeof questionSchema>[] = [
    { id: 'q_name', type: 'CLIENT_FIELD', fieldKey: 'name', required: true },
    { id: 'q_email', type: 'CLIENT_FIELD', fieldKey: 'email', required: true },
  ]
  const skipped: string[] = []

  for (const f of embedFields) {
    if (f.key === 'name' || f.key === 'email') continue // already added, always required
    if (f.key === 'message') {
      questions.push({
        id: 'q_message',
        type: 'LONG_TEXT',
        label: 'Message',
        required: f.required,
      })
      continue
    }
    if (f.key === 'phone') {
      questions.push({ id: 'q_phone', type: 'CLIENT_FIELD', fieldKey: 'phone', required: f.required })
      continue
    }
    // Anything else is a key the live form no longer renders.
    skipped.push(f.key)
  }

  for (const id of linkedFieldIds) {
    questions.push({
      id: `q_${id}`,
      type: 'CUSTOM_FIELD',
      customFieldId: id,
      required: fieldRequired[id] ?? false,
    })
  }

  return { questions, skipped }
}
