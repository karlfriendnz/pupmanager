import { describe, it, expect } from 'vitest'
import { applyFieldPacksForRoles } from '@/lib/onboarding/apply-field-packs'

// A minimal stub standing in for the bits of PrismaClient the helper touches.
// customField.findMany returns whatever `existing` we seed; createMany/update
// just record their args; $transaction runs the array it's given.
function makePrisma(existingLabels: string[] = [], intakeSectionOrder: unknown[] = []) {
  const created: Array<{ label: string; category: string; appliesTo: string }> = []
  let sectionsWritten: unknown[] = []
  const prisma = {
    customField: {
      findMany: async () => existingLabels.map((label, i) => ({ label, order: i })),
      createMany: (args: { data: typeof created }) => { created.push(...args.data); return args },
    },
    trainerProfile: {
      findUnique: async () => ({ intakeSectionOrder }),
      update: (args: { data: { intakeSectionOrder: unknown[] } }) => { sectionsWritten = args.data.intakeSectionOrder; return args },
    },
    $transaction: async (ops: unknown[]) => ops,
  }
  return { prisma: prisma as never, created, sections: () => sectionsWritten }
}

describe('applyFieldPacksForRoles', () => {
  it('creates the grooming starter fields for a groomer', async () => {
    const { prisma, created, sections } = makePrisma()
    const n = await applyFieldPacksForRoles(prisma, 't1', ['groomer'])
    const labels = created.map(c => c.label)
    expect(labels).toContain('Coat type')
    expect(labels).toContain('Last groomed')
    expect(n).toBe(created.length)
    // the grooming section gets added to the intake order
    expect((sections() as Array<{ name: string }>).some(s => s.name === 'Grooming')).toBe(true)
  })

  it('never duplicates built-in dog fields (Breed / Age)', async () => {
    const { prisma, created } = makePrisma()
    await applyFieldPacksForRoles(prisma, 't1', ['groomer'])
    const labels = created.map(c => c.label.toLowerCase())
    expect(labels).not.toContain('breed')
    expect(labels).not.toContain('age')
  })

  it('skips fields the trainer already has (idempotent)', async () => {
    const { prisma, created } = makePrisma(['Coat type', 'Vet clinic'])
    await applyFieldPacksForRoles(prisma, 't1', ['groomer'])
    expect(created.map(c => c.label)).not.toContain('Coat type')
    expect(created.map(c => c.label)).not.toContain('Vet clinic')
  })

  it('seeds only the universal essentials when no role is known', async () => {
    const { prisma, created } = makePrisma()
    await applyFieldPacksForRoles(prisma, 't1', [])
    const labels = created.map(c => c.label)
    expect(labels).toContain('Vet clinic')
    expect(labels).toContain('Emergency contact')
    // no grooming/training-specific fields
    expect(labels).not.toContain('Coat type')
  })
})
