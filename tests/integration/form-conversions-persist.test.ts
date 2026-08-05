/**
 * Do the two conversions actually produce a form a client can fill in?
 *
 * The unit tests prove the question SHAPES are right and the route tests prove
 * the tenant guards hold, and neither of those would notice if the resulting row
 * rendered as eighteen boxes labelled "Field". That is the failure that matters
 * here: a CUSTOM_FIELD question carries no label of its own, so the whole thing
 * only works if the id it stores resolves back to a real field at render time.
 *
 * So this one talks to a REAL database — the local sandbox, never anything else
 * (it refuses to run otherwise). It makes a throwaway trainer with its own
 * fields and a legacy embed form, runs both conversion routes, then reads the
 * result back through renderUnifiedForm — the exact function the client intake
 * gate and the public enquiry page use — and checks the labels come out.
 *
 *   ./node_modules/.bin/dotenv -e .env.development.local -o -- \
 *     npx vitest run --config vitest.integration.config.ts \
 *     tests/integration/form-conversions-persist.test.ts
 *
 * Excluded from the default `vitest` run (see vitest.integration.config.ts)
 * because it needs a database; it is a pre-deploy check, not a unit test.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// Only auth is faked. Prisma is real, on purpose — a mocked client cannot tell
// you whether a question resolves to a label.
const h = vi.hoisted(() => ({ trainerId: '' }))
vi.mock('@/lib/auth', () => ({
  auth: async () => ({ user: { id: 'test-user', role: 'TRAINER', trainerId: h.trainerId } }),
}))
vi.mock('@/lib/membership', async (orig) => ({
  ...(await orig() as object),
  guardPermission: async () => ({ trainerId: h.trainerId }),
}))

import { prisma } from '@/lib/prisma'
import { renderUnifiedForm } from '@/lib/unified-form-render'
import { POST as fromFields } from '@/app/api/forms/from-fields/route'
import { POST as embedToForm } from '@/app/api/embed-forms/[formId]/to-form/route'

const SUFFIX = 'convtest'
let embedFormId = ''
const createdFormIds: string[] = []

beforeAll(async () => {
  const url = process.env.DATABASE_URL ?? ''
  if (!/localhost|127\.0\.0\.1/.test(url) || !/pupmanager_dev/.test(url)) {
    throw new Error(`Refusing to run: DATABASE_URL is not the local sandbox (${url.replace(/:[^@/]*@/, ':***@')})`)
  }

  // A throwaway trainer of its own, so this never depends on — or disturbs —
  // whatever the sandbox's seeded trainers have in their field libraries.
  const user = await prisma.user.create({
    data: {
      email: `${SUFFIX}-${Date.now()}@pupmanager.dev`,
      name: 'Conversion Test',
      role: 'TRAINER',
      trainerProfile: { create: { businessName: 'Conversion Test Co' } },
    },
    select: { trainerProfile: { select: { id: true } } },
  })
  h.trainerId = user.trainerProfile!.id

  await prisma.customField.createMany({
    data: [
      { trainerId: h.trainerId, label: 'How did you hear about us?', type: 'TEXT', required: true, appliesTo: 'OWNER', order: 0 },
      { trainerId: h.trainerId, label: 'Emergency contact', type: 'TEXT', required: false, appliesTo: 'OWNER', order: 1 },
      { trainerId: h.trainerId, label: 'Is your dog food motivated?', type: 'DROPDOWN', options: ['Yes', 'No'], required: false, appliesTo: 'DOG', order: 2 },
    ],
  })

  const linked = await prisma.customField.findFirst({
    where: { trainerId: h.trainerId, label: 'Emergency contact' },
    select: { id: true },
  })
  const embed = await prisma.embedForm.create({
    data: {
      trainerId: h.trainerId,
      title: 'Get in touch',
      description: 'Tell us about your dog.',
      // A legacy row on purpose: a dog key the public form stopped rendering,
      // and a linked id that no longer exists.
      fields: [
        { key: 'phone', required: true },
        { key: 'message', required: false },
        { key: 'dogName', required: true },
      ],
      customFieldIds: [linked!.id, 'cf_deleted_long_ago'],
      thankYouTitle: 'Thanks!',
      thankYouMessage: 'We will be in touch.',
      buttonColor: '#2563eb',
    },
    select: { id: true },
  })
  embedFormId = embed.id
})

afterAll(async () => {
  if (h.trainerId) {
    // Form first — it has no cascade from trainer that would beat the FK.
    await prisma.form.deleteMany({ where: { trainerId: h.trainerId } }).catch(() => {})
    await prisma.embedForm.deleteMany({ where: { trainerId: h.trainerId } }).catch(() => {})
    await prisma.customField.deleteMany({ where: { trainerId: h.trainerId } }).catch(() => {})
    await prisma.user.deleteMany({ where: { trainerProfile: { id: h.trainerId } } }).catch(() => {})
  }
  await prisma.$disconnect()
})

describe('the field library, turned into an intake form', () => {
  it('creates a form whose questions render with the real field labels', async () => {
    const res = await fromFields()
    expect(res.status).toBe(201)
    const { id } = await res.json()
    createdFormIds.push(id)

    const row = await prisma.form.findUniqueOrThrow({ where: { id } })
    expect(row.usableAsIntake).toBe(true)
    expect(row.isActive).toBe(false)

    // THE ASSERTION THAT MATTERS. A CUSTOM_FIELD question stores only an id, so
    // if the link is wrong the form still saves, still opens, and shows a column
    // of boxes labelled "Field".
    const { runnable, linkedFields } = await renderUnifiedForm(row)
    const labels = runnable.questions.map(q =>
      q.type === 'CUSTOM_FIELD' ? linkedFields[q.customFieldId ?? '']?.label : null,
    )
    expect(labels).toEqual([
      'How did you hear about us?',
      'Emergency contact',
      'Is your dog food motivated?',
    ])

    // The dropdown's choices have to arrive too, or it renders as an empty menu.
    const dropdown = runnable.questions.find(
      q => q.type === 'CUSTOM_FIELD' && linkedFields[q.customFieldId ?? '']?.label?.startsWith('Is your dog'),
    )
    expect(linkedFields[(dropdown as { customFieldId: string }).customFieldId].options).toEqual(['Yes', 'No'])
  })

  it('puts the owner questions on page one and the dog question on page two', async () => {
    const row = await prisma.form.findUniqueOrThrow({ where: { id: createdFormIds[0] } })
    const { runnable } = await renderUnifiedForm(row)

    expect(runnable.steps).toEqual([
      { id: 'owner', title: 'About you' },
      { id: 'dog', title: 'About your dog' },
    ])
    expect(runnable.questions.map(q => q.step)).toEqual(['owner', 'owner', 'dog'])
  })

  it('keeps requiredness as the field had it', async () => {
    const row = await prisma.form.findUniqueOrThrow({ where: { id: createdFormIds[0] } })
    const { runnable } = await renderUnifiedForm(row)
    expect(runnable.questions.map(q => q.required)).toEqual([true, false, false])
  })

  it('leaves every field exactly where it was', async () => {
    // The conversion must be lossless in both directions: the profile, the
    // clients list, reports and exports all read these rows.
    const fields = await prisma.customField.findMany({
      where: { trainerId: h.trainerId },
      orderBy: { order: 'asc' },
      select: { label: true, required: true, appliesTo: true },
    })
    expect(fields).toEqual([
      { label: 'How did you hear about us?', required: true, appliesTo: 'OWNER' },
      { label: 'Emergency contact', required: false, appliesTo: 'OWNER' },
      { label: 'Is your dog food motivated?', required: false, appliesTo: 'DOG' },
    ])
  })
})

describe('a legacy embed form, turned into a website form', () => {
  it('reproduces what the form asks today, and says what it left behind', async () => {
    const res = await embedToForm(
      new Request(`http://localhost/api/embed-forms/${embedFormId}/to-form`, { method: 'POST' }),
      { params: Promise.resolve({ formId: embedFormId }) },
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    createdFormIds.push(body.id)

    // The dog key the public form has filtered out for years — named, so the
    // trainer can add it back deliberately rather than find it missing.
    expect(body.skipped).toEqual(['dogName'])
    // And the linked id whose field is gone.
    expect(body.droppedLinkedFields).toBe(1)

    const row = await prisma.form.findUniqueOrThrow({ where: { id: body.id } })
    expect(row.usableAsEnquiry).toBe(true)
    expect(row.isActive).toBe(false)
    expect(row.slug).toBeTruthy()
    expect(row.thankYouTitle).toBe('Thanks!')
    expect(row.buttonColor).toBe('#2563eb')

    const { runnable, linkedFields } = await renderUnifiedForm(row)
    const shape = runnable.questions.map(q =>
      q.type === 'CUSTOM_FIELD'
        ? `custom:${linkedFields[q.customFieldId ?? '']?.label}`
        : q.type === 'CLIENT_FIELD'
          ? `client:${q.fieldKey}`
          : `${q.type}:${(q as { label: string }).label}`,
    )
    expect(shape).toEqual([
      'client:name',
      'client:email',
      'client:phone',
      'LONG_TEXT:Message',
      'custom:Emergency contact',
    ])
  })

  it('leaves the embed form itself live and unchanged', async () => {
    // It is inside an <iframe> on somebody's website that nothing here can
    // reach. Switching over is the trainer pasting a new URL, not a side effect.
    const embed = await prisma.embedForm.findUniqueOrThrow({ where: { id: embedFormId } })
    expect(embed.isActive).toBe(true)
    expect(embed.title).toBe('Get in touch')
    expect(embed.fields).toHaveLength(3)
  })
})
