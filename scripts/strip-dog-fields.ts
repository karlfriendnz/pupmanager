import { PrismaClient } from '@/generated/prisma'

// One-shot cleanup: any saved EmbedForm.fields entries with dog* keys are
// removed so the narrowed Zod enum doesn't reject the form on next save.
async function main() {
  const prisma = new PrismaClient()
  const dogKeys = new Set(['dogName', 'dogBreed', 'dogWeight', 'dogDob'])
  const forms = await prisma.embedForm.findMany({ select: { id: true, fields: true } })
  let touched = 0
  for (const f of forms) {
    if (!Array.isArray(f.fields)) continue
    const arr = f.fields as { key: string; required: boolean }[]
    const filtered = arr.filter(x => !dogKeys.has(x.key))
    if (filtered.length !== arr.length) {
      await prisma.embedForm.update({ where: { id: f.id }, data: { fields: filtered } })
      touched++
    }
  }
  console.log(`Stripped dog* keys from ${touched}/${forms.length} forms.`)
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
