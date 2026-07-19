import type { PrismaClient } from '@/generated/prisma'
import { resolveFieldKeys, recommendedFieldKeys } from '@/lib/field-packs'

// Labels already covered by built-in dog/owner fields — never seed a custom
// field that duplicates one (that caused "Breed"/"Dog's breed" double inputs).
const BUILT_IN_LABELS = new Set(
  ['breed', 'age', 'date of birth', "dog's breed", "dog's age", 'name', 'email', 'phone'].map(s => s.toLowerCase()),
)

// Create starter CustomFields from field-pack selections (`packId:fieldKey`
// strings) and add each pack's section to the intake form order. Idempotent:
// dedups against existing field labels AND the built-in fields, so it's safe to
// call whenever roles become known (onboarding finish, sample-data preview, a
// role change in Settings). Returns how many fields were created.
export async function applyFieldPackKeys(
  prisma: PrismaClient,
  trainerId: string,
  keys: string[],
): Promise<number> {
  const picked = resolveFieldKeys(keys)
  if (picked.length === 0) return 0

  const [existing, profile] = await Promise.all([
    prisma.customField.findMany({ where: { trainerId }, select: { label: true, order: true } }),
    prisma.trainerProfile.findUnique({ where: { id: trainerId }, select: { intakeSectionOrder: true } }),
  ])

  const taken = new Set(existing.map(f => f.label.trim().toLowerCase()))
  const fresh = picked.filter(
    ({ field }) =>
      !taken.has(field.label.trim().toLowerCase()) && !BUILT_IN_LABELS.has(field.label.trim().toLowerCase()),
  )
  if (fresh.length === 0) return 0

  let order = existing.reduce((max, f) => Math.max(max, f.order), -1) + 1

  const rawOrder = Array.isArray(profile?.intakeSectionOrder) ? profile.intakeSectionOrder : []
  const sections = rawOrder.map(entry =>
    typeof entry === 'string'
      ? { name: entry, description: null as string | null }
      : { name: (entry as { name: string }).name, description: (entry as { description?: string | null }).description ?? null },
  )
  const haveSection = new Set(sections.map(s => s.name))
  for (const { pack } of fresh) {
    if (!haveSection.has(pack.section)) {
      haveSection.add(pack.section)
      sections.push({ name: pack.section, description: null })
    }
  }

  await prisma.$transaction([
    prisma.customField.createMany({
      data: fresh.map(({ pack, field }) => ({
        trainerId,
        label: field.label,
        type: field.type,
        required: false,
        inQuickAdd: false,
        options: field.type === 'DROPDOWN' && field.options?.length ? field.options : undefined,
        order: order++,
        category: pack.section,
        appliesTo: field.appliesTo,
      })),
    }),
    prisma.trainerProfile.update({
      where: { id: trainerId },
      data: { intakeSectionOrder: sections },
    }),
  ])

  return fresh.length
}

// Convenience: apply the persona-recommended packs for a set of roles. With no
// roles this is just the universal "essentials" pack.
export function applyFieldPacksForRoles(prisma: PrismaClient, trainerId: string, roles: string[]): Promise<number> {
  return applyFieldPackKeys(prisma, trainerId, recommendedFieldKeys(roles))
}
