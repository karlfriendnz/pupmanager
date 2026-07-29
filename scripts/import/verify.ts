/**
 * Check the database against the plan, independently.
 *
 * Deliberately does NOT read the importer's own statistics — a loader that
 * miscounts would report itself as correct. This re-reads the plan, works out
 * how many rows it should have produced, queries the database separately, and
 * explains every gap between the two.
 *
 * Most gaps are expected, and saying so precisely is the job:
 *   · two plan people sharing an email are ONE client
 *   · two dogs with the same name in one household are ONE dog
 *   · a course whose name already existed reuses that class run
 *   · a repeated enrolment / subscriber / consult is not written twice
 *
 * A gap that is NOT one of those is the thing you want to hear about.
 *
 *   ./node_modules/.bin/dotenv -e .env.development.local -o -- \
 *     npx tsx scripts/import/verify.ts \
 *       --env .env.development.local --trainer journey@pupmanager.dev \
 *       --plan /path/to/plan.json
 */
import { scriptPrisma } from '../../src/lib/prisma-script'
import { arg, heading } from './loader/cli'
import { placeholderEmail, runName, consultStart, UNNAMED_DOG } from './loader/parse'
import { loadPlan, planLabel, resolveEmailNamespace, resolvePlanPath } from './loader/plan'
import type { Plan, PlanPerson } from './loader/types'
import { printTarget, resolveTarget, type Target } from './target'

/** The email a person will resolve to — the key the loader dedupes clients on. */
function emailKey(p: PlanPerson, namespace: string): string {
  return p.emailIsPlaceholder || !p.email?.trim()
    ? placeholderEmail(p.id, namespace)
    : p.email.trim().toLowerCase()
}

interface Expected {
  clients: number
  dogs: number
  classRuns: number
  enrolments: number
  clientPackages: number
  subscribers: number
  customFieldValues: number
  /** Raw plan counts, before any collapsing. */
  raw: {
    people: number
    dogs: number
    courses: number
    enrolments: number
    consults: number
    subscribers: number
    customFieldValues: number
  }
}

/**
 * What the plan SHOULD produce, computed from the plan alone by applying the
 * loader's documented dedupe keys.
 */
export function expectedFromPlan(plan: Plan, namespace: string): Expected {
  const clients = new Set<string>()
  const dogs = new Set<string>()
  const enrolments = new Set<string>()
  const consults = new Set<string>()
  const cfv = new Set<string>()
  let rawDogs = 0
  let rawEnrolments = 0
  let rawConsults = 0
  let rawCfv = 0

  for (const p of plan.people) {
    const key = emailKey(p, namespace)
    clients.add(key)

    for (const d of p.dogs ?? []) {
      rawDogs++
      const name = ((d.name ?? '').trim() || UNNAMED_DOG).toLowerCase()
      dogs.add(`${key}::${name}`)
    }
    const dogNames = (p.dogs ?? []).map(d => ((d.name ?? '').trim() || UNNAMED_DOG).toLowerCase())
    const primary = dogNames[0] ?? null

    for (const e of p.enrolments ?? []) {
      rawEnrolments++
      const want = (e.dog ?? '').trim().toLowerCase()
      const dog = (want && dogNames.includes(want) ? want : primary) ?? 'none'
      enrolments.add(`${e.courseId}::${key}::${dog}`)
    }
    for (const c of p.oneToOneConsults ?? []) {
      rawConsults++
      consults.add(`${key}::${c.service.trim().toLowerCase()}::${consultStart(c).toISOString()}`)
    }
    for (const [label, value] of Object.entries(p.customFields ?? {})) {
      if (!String(value ?? '').trim()) continue
      rawCfv++
      cfv.add(`${key}::${label.trim().toLowerCase()}`)
    }
  }

  const runNames = new Set(plan.courses.map(c => runName(c)))
  const subscribers = new Set(
    (plan.subscribers ?? []).map(s => s.email?.trim().toLowerCase()).filter(Boolean) as string[],
  )

  return {
    clients: clients.size,
    dogs: dogs.size,
    classRuns: runNames.size,
    enrolments: enrolments.size,
    clientPackages: consults.size,
    subscribers: subscribers.size,
    customFieldValues: cfv.size,
    raw: {
      people: plan.people.length,
      dogs: rawDogs,
      courses: plan.courses.length,
      enrolments: rawEnrolments,
      consults: rawConsults,
      subscribers: (plan.subscribers ?? []).length,
      customFieldValues: rawCfv,
    },
  }
}

interface Row {
  entity: string
  inPlan: number
  expected: number
  inDb: number
  note: string
}

export async function verify(
  target: Target,
  planPath: string,
  emailNamespace?: string | null,
): Promise<{ rows: Row[]; ok: boolean }> {
  const plan = loadPlan(planPath)
  const namespace = resolveEmailNamespace(plan, emailNamespace)
  const exp = expectedFromPlan(plan, namespace)
  const prisma = scriptPrisma()
  const T = target.trainerId

  try {
    const [clients, dogs, classRuns, sessions, enrolments, clientPackages, subscribers, cfv, packages] =
      await Promise.all([
        prisma.clientProfile.count({ where: { trainerId: T } }),
        prisma.dog.count({ where: { OR: [{ owner: { trainerId: T } }, { primaryFor: { some: { trainerId: T } } }] } }),
        prisma.classRun.count({ where: { trainerId: T } }),
        prisma.trainingSession.count({ where: { trainerId: T } }),
        prisma.classEnrollment.count({ where: { classRun: { trainerId: T } } }),
        prisma.clientPackage.count({ where: { package: { trainerId: T } } }),
        prisma.subscriber.count({ where: { trainerId: T } }),
        prisma.customFieldValue.count({ where: { client: { trainerId: T } } }),
        prisma.package.count({ where: { trainerId: T } }),
      ])

    const explain = (expected: number, inDb: number, moreMeans: string, fewerMeans: string) => {
      const d = inDb - expected
      if (d === 0) return 'matches'
      return d > 0 ? `+${d} — ${moreMeans}` : `${d} — ${fewerMeans}`
    }

    const rows: Row[] = [
      {
        entity: 'clients',
        inPlan: exp.raw.people,
        expected: exp.clients,
        inDb: clients,
        note: explain(
          exp.clients, clients,
          'this trainer had clients before the import',
          'people the plan could not create — check the dry run problems',
        ),
      },
      {
        entity: 'dogs',
        inPlan: exp.raw.dogs,
        expected: exp.dogs,
        inDb: dogs,
        note: explain(
          exp.dogs, dogs,
          'dogs already on the trainer, or on clients outside this plan',
          'dogs that failed to create',
        ),
      },
      {
        entity: 'class runs',
        inPlan: exp.raw.courses,
        expected: exp.classRuns,
        inDb: classRuns,
        note: explain(
          exp.classRuns, classRuns,
          'classes that existed before the import',
          'courses that reused an existing run under a different name, or failed',
        ),
      },
      {
        entity: 'packages',
        inPlan: exp.raw.courses,
        expected: exp.classRuns,
        inDb: packages,
        note: '1 per class run, plus 1 per distinct 1:1 service',
      },
      {
        entity: 'sessions',
        inPlan: 0,
        expected: 0,
        inDb: sessions,
        note: 'generated from each class run — not carried in the plan',
      },
      {
        entity: 'enrolments',
        inPlan: exp.raw.enrolments,
        expected: exp.enrolments,
        inDb: enrolments,
        note: explain(
          exp.enrolments, enrolments,
          'enrolments that existed before the import',
          'enrolments whose course or client could not be resolved',
        ),
      },
      {
        entity: 'client packages (1:1)',
        inPlan: exp.raw.consults,
        expected: exp.clientPackages,
        inDb: clientPackages,
        note: explain(
          exp.clientPackages, clientPackages,
          'packages assigned before the import',
          'consults whose client could not be resolved',
        ),
      },
      {
        entity: 'subscribers',
        inPlan: exp.raw.subscribers,
        expected: exp.subscribers,
        inDb: subscribers,
        note: explain(
          exp.subscribers, subscribers,
          'subscribers already on the list',
          'subscriber rows with no email',
        ),
      },
      {
        entity: 'custom field values',
        inPlan: exp.raw.customFieldValues,
        expected: exp.customFieldValues,
        inDb: cfv,
        note: explain(
          exp.customFieldValues, cfv,
          'values captured outside this import',
          'labels with no matching custom field on this trainer — those values are dropped',
        ),
      },
    ]

    // Short is the direction that loses data; long is usually pre-existing rows.
    const ok = rows.every(r => r.entity === 'sessions' || r.entity === 'packages' || r.inDb >= r.expected)
    return { rows, ok }
  } finally {
    await prisma.$disconnect()
  }
}

export function printVerify(rows: Row[], ok: boolean, label: string): void {
  heading(`VERIFY — ${label}`)
  const w = {
    entity: Math.max(22, ...rows.map(r => r.entity.length)),
    n: 9,
  }
  console.log(
    `  ${'entity'.padEnd(w.entity)}${'in plan'.padStart(w.n)}${'expected'.padStart(w.n)}${'in db'.padStart(w.n)}   note`,
  )
  console.log(`  ${'─'.repeat(w.entity + w.n * 3 + 3)}`)
  for (const r of rows) {
    console.log(
      `  ${r.entity.padEnd(w.entity)}${String(r.inPlan || '—').padStart(w.n)}` +
      `${String(r.expected || '—').padStart(w.n)}${String(r.inDb).padStart(w.n)}   ${r.note}`,
    )
  }
  console.log('\n  "expected" applies the loader\'s dedupe rules to the plan: one client per email,')
  console.log('  one dog per name per household, one class run per name, no repeated enrolments.')
  console.log(
    ok
      ? '\n  ✓ Nothing is short. Every entity has at least what the plan asked for.\n'
      : '\n  ✋ Something is SHORT of what the plan asked for — see the notes above.\n',
  )
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
async function main() {
  const target = await resolveTarget({ readOnly: true })
  printTarget(target, 'VERIFY TARGET')

  const planArg = arg('plan')
  if (!planArg) {
    console.error('\n✋ --plan <path to plan.json or a client folder> is required.\n')
    process.exit(1)
  }
  const planPath = resolvePlanPath(planArg)
  const plan = loadPlan(planPath)
  const { rows, ok } = await verify(target, planPath, arg('email-namespace') ?? null)
  printVerify(rows, ok, planLabel(planPath, plan))
  if (!ok) process.exit(1)
}

if (process.argv[1] && process.argv[1].endsWith('verify.ts')) {
  main().catch(err => {
    console.error('\n[verify] FAILED:', err)
    process.exit(1)
  })
}
