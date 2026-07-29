/**
 * The loader. Merges a canonical plan into PupManager, scoped entirely to one
 * trainer, using a database handle the caller supplies.
 *
 * The handle is the whole point: pass a PrismaClient and it writes for real
 * (apply.ts); pass an interactive-transaction client and the caller can roll the
 * lot back (dry-run.ts). Nothing in here opens a transaction of its own, because
 * Prisma cannot nest one inside an interactive transaction — so the caller owns
 * that decision.
 *
 * MERGE SEMANTICS — carried over verbatim from scripts/prime/import-plan.ts and
 * deliberately unchanged:
 *   · an existing record is NEVER overwritten — blank columns are backfilled
 *   · notes are appended, never replaced, and never duplicated
 *   · dogs are deduped by name within the household
 *   · courses are reused by name rather than duplicated
 *   · re-running creates nothing new
 *
 *   people[]                  → User (CLIENT) + ClientProfile (+ CustomFieldValue)
 *   people[].dogs[]           → Dog (first = ClientProfile.dogId primary, rest additional)
 *   courses[]                 → Package + ClassRun + N weekly TrainingSessions
 *   people[].enrolments       → ClassEnrollment
 *   people[].oneToOneConsults → Package (1:1, isGroup=false) + ClientPackage
 *   subscribers[]             → Subscriber
 *   notes/accessCodes/afRefs/waitlist → ClientProfile.notes (labelled lines)
 */
import type {
  CourseCollision, Db, ImportOptions, ImportResult, ImportStats, PlanCourse, PlanPerson,
} from './types'
import { emptyStats } from './types'
import {
  DEFAULT_DURATION_MINS, LEAD_STATUS, RECONSTRUCTED_SUFFIX, SESSIONS_PER_COURSE,
  SESSIONS_PER_COURSE_DEFAULT, UNNAMED_DOG, WEEKS_BETWEEN,
  buildNotes, composeAddress, consultStart, courseStart, inferCourseYears,
  parseDeceasedAt, parseSubscriberDate, placeholderEmail, runName,
} from './parse'

interface Ctx {
  db: Db
  trainerId: string
  stats: ImportStats
  problems: string[]
  savepoints: boolean
}

/**
 * Run `fn` inside a SAVEPOINT so a failure rolls back only its own work.
 *
 * Needed when the loader runs inside an interactive transaction: in Postgres one
 * failed statement aborts the whole transaction, so without a savepoint a single
 * malformed person would take the entire dry run down and report nothing about
 * the other 684. Outside a transaction there is nothing to protect, so it is
 * skipped.
 */
let savepointSeq = 0
async function guarded<T>(ctx: Ctx, fn: () => Promise<T>): Promise<T> {
  if (!ctx.savepoints) return fn()
  const name = `import_sp_${++savepointSeq}`
  await ctx.db.$executeRawUnsafe(`SAVEPOINT ${name}`)
  try {
    const out = await fn()
    await ctx.db.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`)
    return out
  } catch (err) {
    await ctx.db.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`)
    throw err
  }
}

// ─── Courses → Package + ClassRun + sessions ─────────────────────────────────
async function importCourses(
  ctx: Ctx,
  courses: PlanCourse[],
  extractedPath: string | null | undefined,
  collisions: CourseCollision[],
): Promise<Map<string, string>> {
  const years = inferCourseYears(courses, extractedPath, ctx.problems)
  const runIdByCourse = new Map<string, string>()

  for (const c of courses) {
    const name = runName(c)
    const existing = await ctx.db.classRun.findFirst({
      where: { trainerId: ctx.trainerId, name },
      select: { id: true },
    })
    if (existing) {
      ctx.stats.coursesExisting++
      collisions.push({ courseId: c.id, name, origin: c.origin, existingRunId: existing.id })
      runIdByCourse.set(c.id, existing.id)
      continue
    }

    const { start, durationMins } = courseStart(c, years.get(c.id) ?? new Date().getFullYear())
    const sessionCount = SESSIONS_PER_COURSE[c.level] ?? SESSIONS_PER_COURSE_DEFAULT
    const scheduleNote = [
      [c.day, c.date, c.time].filter(Boolean).join(' '),
      c.location ? `@ ${c.location}` : '',
      c.origin === 'invented'
        ? '· RECONSTRUCTED from contact notes — no spreadsheet row; check the dates and rename.'
        : c.headerRaw ? `· ${c.headerRaw}` : '',
      c.flags?.length ? `· ${c.flags.join(' · ')}` : '',
    ].filter(Boolean).join(' ').trim() || null

    const pkg = await ctx.db.package.create({
      data: {
        trainerId: ctx.trainerId,
        name,
        description: c.origin === 'invented'
          ? 'Reconstructed from contact notes during the data import — no booking-sheet row exists for this class. Rename/merge as needed.'
          : null,
        sessionCount,
        weeksBetween: WEEKS_BETWEEN,
        durationMins,
        sessionType: 'IN_PERSON',
        isGroup: true,
        location: c.location?.trim() || null,
        order: 0,
      },
      select: { id: true },
    })
    const run = await ctx.db.classRun.create({
      data: {
        trainerId: ctx.trainerId,
        packageId: pkg.id,
        name,
        scheduleNote,
        startDate: start,
        location: c.location?.trim() || null,
      },
      select: { id: true },
    })
    const rows = Array.from({ length: sessionCount }, (_, i) => {
      const d = new Date(start)
      d.setDate(d.getDate() + i * WEEKS_BETWEEN * 7)
      return {
        trainerId: ctx.trainerId,
        classRunId: run.id,
        sessionIndex: i + 1,
        title: `${name} — session ${i + 1}/${sessionCount}`,
        scheduledAt: d,
        durationMins,
        bufferMins: 0,
        sessionType: 'IN_PERSON' as const,
        location: c.location?.trim() || null,
      }
    })
    await ctx.db.trainingSession.createMany({ data: rows })
    ctx.stats.packagesCreated++
    ctx.stats.classRunsCreated++
    ctx.stats.sessionsCreated += rows.length
    runIdByCourse.set(c.id, run.id)
  }
  return runIdByCourse
}

// ─── People → User + ClientProfile + Dogs ────────────────────────────────────
interface Imported {
  profileId: string
  dogIdByName: Map<string, string>
  primaryDogId: string | null
}

async function importPerson(ctx: Ctx, p: PlanPerson, namespace: string): Promise<Imported> {
  const T = ctx.trainerId
  const name = (p.fullName || [p.firstName, p.lastName].filter(Boolean).join(' ')).trim() || 'New contact'
  const phone = p.phone?.trim() || null
  const address = composeAddress(p)
  const notes = buildNotes(p)
  const status = p.enrolments.length || p.oneToOneConsults.length ? 'ACTIVE' : LEAD_STATUS

  const email = p.emailIsPlaceholder || !p.email?.trim()
    ? placeholderEmail(p.id, namespace)
    : p.email.trim().toLowerCase()
  if (p.emailIsPlaceholder || !p.email?.trim()) ctx.stats.placeholderEmails++

  const user = await ctx.db.user.upsert({
    where: { email },
    update: {},
    create: { email, name, role: 'CLIENT' },
    select: { id: true },
  })

  let profile = await ctx.db.clientProfile.findUnique({
    where: { userId_trainerId: { userId: user.id, trainerId: T } },
    select: { id: true, notes: true, phone: true, addressLine: true, dogId: true },
  })

  if (profile) {
    // Same email seen twice in the plan (or a re-run). Backfill blanks and
    // append notes we don't already carry — never clobber.
    const data: Record<string, unknown> = {}
    if (!profile.phone && phone) data.phone = phone
    if (!profile.addressLine && address) data.addressLine = address
    if (notes) {
      const cur = profile.notes?.trim() ?? ''
      if (!cur) data.notes = notes
      else if (!cur.includes(notes)) data.notes = `${cur}\n${notes}`
    }
    if (Object.keys(data).length) {
      await ctx.db.clientProfile.update({ where: { id: profile.id }, data })
      ctx.stats.clientsMerged++
    } else {
      ctx.stats.clientsExisting++
    }
  } else {
    profile = await ctx.db.clientProfile.create({
      data: { userId: user.id, trainerId: T, status, phone, addressLine: address, notes },
      select: { id: true, notes: true, phone: true, addressLine: true, dogId: true },
    })
    ctx.stats.clientsCreated++
  }

  // ── Dogs (dedup by name within the profile) ──
  const existingDogs = await ctx.db.dog.findMany({
    where: { OR: [{ clientProfileId: profile.id }, { primaryFor: { some: { id: profile.id } } }] },
    select: { id: true, name: true },
  })
  const dogIdByName = new Map(existingDogs.map(d => [d.name.trim().toLowerCase(), d.id]))
  const createdIds: string[] = []

  for (const d of p.dogs ?? []) {
    const rawName = (d.name ?? '').trim()
    const dogName = rawName || UNNAMED_DOG
    if (!rawName) ctx.stats.dogsUnnamed++
    const key = dogName.toLowerCase()
    if (dogIdByName.has(key)) { ctx.stats.dogsExisting++; continue }
    const noteParts = [...(d.notes ?? [])]
    for (const f of d.flags ?? []) noteParts.push(f)
    if (!rawName) noteParts.push('No dog name in any source.')
    // "unknown" is a legitimate value here — the fact of death is kept in the
    // notes rather than dropped or turned into an invented date.
    const deceased = parseDeceasedAt(d.deceasedAt)
    if (deceased.note) noteParts.push(deceased.note)
    const dog = await ctx.db.dog.create({
      data: {
        name: dogName,
        breed: d.breed?.trim() || null,
        notes: noteParts.length ? noteParts.join('\n') : null,
        deceasedAt: deceased.date,
        // Primary dog is wired via ClientProfile.dogId below; the rest own a
        // clientProfileId. Set it for all, then promote the first.
        clientProfileId: profile.id,
      },
      select: { id: true },
    })
    if (deceased.date || deceased.note) ctx.stats.dogsDeceased++
    ctx.stats.dogsCreated++
    dogIdByName.set(key, dog.id)
    createdIds.push(dog.id)
  }

  const current = await ctx.db.clientProfile.findUnique({
    where: { id: profile.id },
    select: { dogId: true },
  })
  let primaryDogId = current?.dogId ?? null
  if (!primaryDogId) {
    const firstName = (p.dogs?.[0]?.name ?? '').trim() || (p.dogs?.length ? UNNAMED_DOG : '')
    primaryDogId =
      (firstName && dogIdByName.get(firstName.toLowerCase())) || createdIds[0] || existingDogs[0]?.id || null
    if (primaryDogId) {
      await ctx.db.clientProfile.update({ where: { id: profile.id }, data: { dogId: primaryDogId } })
      // The primary dog is referenced through ClientProfile.dogId; drop the
      // additional-dog FK so it isn't listed twice.
      await ctx.db.dog.update({ where: { id: primaryDogId }, data: { clientProfileId: null } })
    }
  }

  return { profileId: profile.id, dogIdByName, primaryDogId }
}

// ─── Custom field values ─────────────────────────────────────────────────────
async function importCustomFields(
  ctx: Ctx,
  p: PlanPerson,
  profileId: string,
  fieldIdByLabel: Map<string, string>,
  missing: Record<string, number>,
) {
  for (const [label, value] of Object.entries(p.customFields ?? {})) {
    const fieldId = fieldIdByLabel.get(label.trim().toLowerCase())
    if (!fieldId) {
      missing[label] = (missing[label] ?? 0) + 1
      continue
    }
    const val = String(value ?? '').trim()
    if (!val) continue
    const existing = await ctx.db.customFieldValue.findFirst({
      where: { fieldId, clientId: profileId, dogId: null },
      select: { id: true, value: true },
    })
    if (existing) {
      if (existing.value !== val) {
        await ctx.db.customFieldValue.update({ where: { id: existing.id }, data: { value: val } })
        ctx.stats.customFieldValuesUpdated++
      }
      continue
    }
    await ctx.db.customFieldValue.create({ data: { fieldId, clientId: profileId, dogId: null, value: val } })
    ctx.stats.customFieldValues++
  }
}

// ─── 1:1 consults → Package (isGroup=false) + ClientPackage ──────────────────
async function consultPackageId(ctx: Ctx, service: string, cache: Map<string, string>): Promise<string> {
  const key = service.trim().toLowerCase()
  const hit = cache.get(key)
  if (hit) return hit
  const existing = await ctx.db.package.findFirst({
    where: { trainerId: ctx.trainerId, name: service, isGroup: false },
    select: { id: true },
  })
  if (existing) {
    cache.set(key, existing.id)
    return existing.id
  }
  const pkg = await ctx.db.package.create({
    data: {
      trainerId: ctx.trainerId,
      name: service,
      description: 'Imported 1:1 history — the dates come from the contact notes, sessions were not reconstructed.',
      sessionCount: 1,
      weeksBetween: 1,
      durationMins: DEFAULT_DURATION_MINS,
      sessionType: 'IN_PERSON',
      isGroup: false,
      order: 0,
    },
    select: { id: true },
  })
  ctx.stats.consultPackagesCreated++
  cache.set(key, pkg.id)
  return pkg.id
}

// ─── Entry point ─────────────────────────────────────────────────────────────
export async function runImport(db: Db, opts: ImportOptions): Promise<ImportResult> {
  const ctx: Ctx = {
    db,
    trainerId: opts.trainerId,
    stats: emptyStats(),
    problems: [],
    savepoints: opts.savepoints ?? false,
  }
  const collisions: CourseCollision[] = []
  const missingCustomFields: Record<string, number> = {}
  const { plan } = opts
  const namespace = opts.emailNamespace ?? 'import'
  const report = opts.onProgress ?? (() => {})

  const fields = await db.customField.findMany({
    where: { trainerId: ctx.trainerId },
    select: { id: true, label: true },
  })
  const fieldIdByLabel = new Map(fields.map(f => [f.label.trim().toLowerCase(), f.id]))

  // ── 1: courses ──
  report('courses', 0, plan.courses.length)
  const runIdByCourse = await importCourses(ctx, plan.courses, opts.extractedPath, collisions)
  report('courses', plan.courses.length, plan.courses.length)

  // ── 2: people, dogs, custom fields ──
  const importedByPerson = new Map<string, Imported>()
  let done = 0
  for (const p of plan.people) {
    try {
      const imported = await guarded(ctx, async () => {
        const res = await importPerson(ctx, p, namespace)
        await importCustomFields(ctx, p, res.profileId, fieldIdByLabel, missingCustomFields)
        return res
      })
      importedByPerson.set(p.id, imported)
    } catch (err) {
      ctx.stats.peopleFailed++
      ctx.problems.push(`Person ${p.id} (${p.fullName}) FAILED: ${(err as Error).message}`)
    }
    if (++done % 50 === 0 || done === plan.people.length) report('people', done, plan.people.length)
  }

  // ── 3: enrolments ──
  for (const p of plan.people) {
    const imported = importedByPerson.get(p.id)
    if (!imported) continue
    for (const e of p.enrolments ?? []) {
      const runId = runIdByCourse.get(e.courseId)
      if (!runId) {
        ctx.stats.enrolmentsUnmatched++
        ctx.problems.push(`Enrolment for ${p.id} references unknown course ${e.courseId}.`)
        continue
      }
      const want = (e.dog ?? '').trim().toLowerCase()
      const dogId = (want && imported.dogIdByName.get(want)) || imported.primaryDogId || null
      const existing = await db.classEnrollment.findFirst({
        where: { classRunId: runId, clientId: imported.profileId, dogId: dogId ?? null },
        select: { id: true },
      })
      if (existing) { ctx.stats.enrolmentsExisting++; continue }
      try {
        await guarded(ctx, () =>
          db.classEnrollment.create({
            data: {
              classRunId: runId,
              clientId: imported.profileId,
              dogId: dogId ?? null,
              type: 'FULL',
              status: e.didNotAttend ? 'WITHDRAWN' : 'ENROLLED',
              source: 'TRAINER',
            },
          }),
        )
        ctx.stats.enrolmentsCreated++
      } catch (err) {
        ctx.stats.enrolmentsUnmatched++
        ctx.problems.push(`Enrolment ${p.id} → ${e.courseId} FAILED: ${(err as Error).message}`)
      }
    }
  }
  report('enrolments', plan.people.length, plan.people.length)

  // ── 4: 1:1 consults ──
  const consultCache = new Map<string, string>()
  for (const p of plan.people) {
    const imported = importedByPerson.get(p.id)
    if (!imported) continue
    for (const c of p.oneToOneConsults ?? []) {
      const pkgId = await consultPackageId(ctx, c.service, consultCache)
      const startDate = consultStart(c)
      const existing = await db.clientPackage.findFirst({
        where: { packageId: pkgId, clientId: imported.profileId, startDate },
        select: { id: true },
      })
      if (existing) { ctx.stats.clientPackagesExisting++; continue }
      await db.clientPackage.create({ data: { packageId: pkgId, clientId: imported.profileId, startDate } })
      ctx.stats.clientPackagesCreated++
    }
  }

  // ── 5: subscribers ──
  for (const s of plan.subscribers ?? []) {
    const email = s.email?.trim().toLowerCase()
    if (!email) { ctx.problems.push('Subscriber row with no email skipped.'); continue }
    const existing = await db.subscriber.findUnique({
      where: { trainerId_email: { trainerId: ctx.trainerId, email } },
      select: { id: true },
    })
    if (existing) { ctx.stats.subscribersExisting++; continue }
    await db.subscriber.create({
      data: {
        trainerId: ctx.trainerId,
        email,
        name: s.name?.trim() || null,
        status: 'SUBSCRIBED',
        createdAt: parseSubscriberDate(s.createdOn) ?? undefined,
      },
    })
    ctx.stats.subscribersCreated++
  }
  report('subscribers', plan.subscribers.length, plan.subscribers.length)

  for (const [label, count] of Object.entries(missingCustomFields)) {
    ctx.problems.push(`No custom field "${label}" on this trainer — ${count} value(s) skipped.`)
  }

  return { stats: ctx.stats, problems: ctx.problems, collisions, missingCustomFields }
}

export { RECONSTRUCTED_SUFFIX }
