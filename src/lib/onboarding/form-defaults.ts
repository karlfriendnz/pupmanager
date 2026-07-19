// Default forms seeded for each trainer when their TrainerOnboardingProgress
// row is first created. Gives the "Review your forms" wizard step something
// to actually review. Trainer can edit, unpublish, or delete each.

import { randomUUID } from 'crypto'
import type { PrismaClient } from '@/generated/prisma'
import { recommendedFieldKeys } from '@/lib/field-packs'
import { applyFieldPackKeys } from '@/lib/onboarding/apply-field-packs'

export interface DefaultEmbedFormFieldSpec {
  key: 'phone' | 'dogName' | 'dogBreed' | 'dogWeight' | 'dogDob' | 'message'
  required: boolean
}

export const DEFAULT_EMBED_FORM = {
  title: 'Get in touch',
  description: "Tell us about your dog and what you'd like help with — we'll get back to you within 24 hours.",
  fields: [
    { key: 'phone', required: false },
    { key: 'dogName', required: true },
    { key: 'dogBreed', required: false },
    { key: 'message', required: true },
  ] satisfies DefaultEmbedFormFieldSpec[],
  thankYouTitle: 'Thanks!',
  thankYouMessage: "We've got your enquiry and will be in touch soon.",
  // Seeded as draft so the trainer reviews and publishes it themselves.
  isActive: false,
}

interface DefaultSessionQuestion {
  id: string
  type: 'SHORT_TEXT' | 'LONG_TEXT' | 'NUMBER' | 'RATING_1_5'
  label: string
  required: boolean
}

function makeSessionQuestions(): DefaultSessionQuestion[] {
  return [
    { id: randomUUID(), type: 'LONG_TEXT', label: 'What did we work on?', required: true },
    { id: randomUUID(), type: 'RATING_1_5', label: 'How well did the dog respond?', required: false },
    { id: randomUUID(), type: 'LONG_TEXT', label: 'Homework for the week', required: true },
    { id: randomUUID(), type: 'LONG_TEXT', label: 'Notes for next session', required: false },
  ]
}

// Idempotent — only creates each form type when the trainer has none of that
// type yet. Safe to call from initTrainerOnboarding without double-seeding.
export async function seedDefaultFormsFor(prisma: PrismaClient, trainerId: string): Promise<void> {
  const [embedCount, sessionCount, profile] = await Promise.all([
    prisma.embedForm.count({ where: { trainerId } }),
    prisma.sessionForm.count({ where: { trainerId } }),
    prisma.trainerProfile.findUnique({ where: { id: trainerId }, select: { businessRoles: true } }),
  ])

  if (embedCount === 0) {
    await prisma.embedForm.create({
      data: {
        trainerId,
        title: DEFAULT_EMBED_FORM.title,
        description: DEFAULT_EMBED_FORM.description,
        fields: DEFAULT_EMBED_FORM.fields,
        customFieldIds: [],
        thankYouTitle: DEFAULT_EMBED_FORM.thankYouTitle,
        thankYouMessage: DEFAULT_EMBED_FORM.thankYouMessage,
        isActive: DEFAULT_EMBED_FORM.isActive,
      },
    })
  }

  // Persona-recommended starter fields from the field packs (idempotent). With
  // no roles yet this seeds just the universal "essentials"; the persona packs
  // (grooming, training, walking…) get added when they pick their trade — see
  // the /api/trainer/profile PATCH handler.
  await applyFieldPackKeys(prisma, trainerId, recommendedFieldKeys(profile?.businessRoles ?? []))

  if (sessionCount === 0) {
    await prisma.sessionForm.create({
      data: {
        trainerId,
        name: 'Session report',
        description: 'What we covered, how it went, and what to practise this week.',
        introText: "Here's the report from today's session.",
        closingText: 'Reach out anytime if you have questions.',
        // Cast through unknown — Prisma's InputJsonValue type doesn't recognise
        // our typed array shape (no index signature) but the runtime serialises
        // fine.
        questions: makeSessionQuestions() as unknown as object[],
        order: 0,
        // Seeded as draft so the trainer reviews and publishes it themselves.
        isActive: false,
      },
    })
  }
}
