/**
 * Give homework back the picture its library item had.
 *
 * WHY: /api/library/tasks/[taskId]/assign copied the item's title, description,
 * reps and video onto the TrainingTask — but never its `imageUrl`. So a trainer
 * who attached a photo to a library item handed out homework that had silently
 * lost it, and the client's screen showed no picture. (Reported 2026-07-30.)
 *
 * The code fix means new assignments carry it. This recovers the ones already
 * handed out.
 *
 * Homework is deliberately a SNAPSHOT — editing a library item never rewrites work
 * already given out — so this is careful about which rows it touches:
 *   • only rows with a libraryTaskId (we know where they came from), and
 *   • only rows whose imageUrls is EMPTY (never overwrite a real picture), and
 *   • only where the source item still has an image.
 * A row a trainer has since given its own images keeps them.
 *
 *   DRY RUN:  npx dotenv -e .env.development.local -- npx tsx scripts/backfill-homework-images.ts
 *   APPLY:    npx dotenv -e .env.development.local -- npx tsx scripts/backfill-homework-images.ts --apply
 *   PROD:     npx dotenv -e .env.local -- npx tsx scripts/backfill-homework-images.ts --apply
 */
import { PrismaClient } from '../src/generated/prisma/index.js'
import { PrismaPg } from '@prisma/adapter-pg'

const apply = process.argv.includes('--apply')
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! }),
})

async function main() {
  const rows = await prisma.trainingTask.findMany({
    where: {
      libraryTaskId: { not: null },
      libraryTask: { imageUrl: { not: null } },
    },
    select: {
      id: true,
      title: true,
      imageUrls: true,
      libraryTask: { select: { imageUrl: true } },
    },
  })

  // imageUrls is Json, so "empty" has three shapes in the wild: [], null, and the
  // JSON null. Checking in JS rather than SQL keeps that judgement in one place.
  const empty = rows.filter(r => {
    const v = r.imageUrls
    if (v == null) return true
    return Array.isArray(v) && v.length === 0
  })

  console.log(`${rows.length} homework row(s) came from an item that has an image.`)
  console.log(`${empty.length} of them have no image of their own${apply ? '' : ' (dry run)'}.`)

  for (const r of empty) {
    const url = r.libraryTask!.imageUrl!
    console.log(`  ${apply ? 'filling' : 'would fill'}  ${r.title} — ${url.slice(0, 70)}…`)
    if (apply) {
      await prisma.trainingTask.update({ where: { id: r.id }, data: { imageUrls: [url] } })
    }
  }

  if (!apply && empty.length > 0) console.log('\nRe-run with --apply to write.')
}

main()
  .catch(err => { console.error(err); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
