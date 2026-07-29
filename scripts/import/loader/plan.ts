/**
 * Finding and reading a plan, and counting what it claims to contain.
 *
 * The counts here are the plan's own view of itself. verify.ts compares them
 * against what the database actually holds, which is only meaningful because
 * the two are computed independently.
 */
import { existsSync, readFileSync } from 'fs'
import { basename, dirname, join } from 'path'
import type { Plan } from './types'

/** Filenames a client folder may use for its plan, in order of preference. */
const PLAN_NAMES = ['plan.json', 'import_plan.json']
/** Filenames the optional extract may use (used only to date spreadsheet courses). */
const EXTRACT_NAMES = ['extracted.json', 'prime_extracted.json']

export function loadPlan(path: string): Plan {
  if (!existsSync(path)) throw new Error(`Plan not found: ${path}`)
  const plan = JSON.parse(readFileSync(path, 'utf-8')) as Plan
  for (const key of ['people', 'courses', 'subscribers'] as const) {
    if (!Array.isArray(plan[key])) throw new Error(`Plan is missing the "${key}" array: ${path}`)
  }
  return plan
}

/** A plan path from a client folder (or the folder itself if it names a .json). */
export function resolvePlanPath(clientFolderOrFile: string): string {
  if (clientFolderOrFile.endsWith('.json')) return clientFolderOrFile
  for (const name of PLAN_NAMES) {
    const p = join(clientFolderOrFile, name)
    if (existsSync(p)) return p
  }
  throw new Error(
    `No plan in ${clientFolderOrFile} — expected one of ${PLAN_NAMES.join(' / ')}.`,
  )
}

/** The extract file sitting beside a plan, if there is one. Optional by design. */
export function resolveExtractPath(planPath: string, explicit?: string | null): string | null {
  if (explicit) return existsSync(explicit) ? explicit : null
  const dir = dirname(planPath)
  for (const name of EXTRACT_NAMES) {
    const p = join(dir, name)
    if (existsSync(p)) return p
  }
  return null
}

export interface PlanTotals {
  people: number
  peopleWithEmail: number
  peoplePlaceholderEmail: number
  dogs: number
  dogsDeceased: number
  courses: number
  coursesSpreadsheet: number
  coursesReconstructed: number
  enrolments: number
  oneToOneConsults: number
  distinctConsultServices: number
  subscribers: number
  customFieldValues: number
  distinctCustomFieldLabels: string[]
}

export function planTotals(plan: Plan): PlanTotals {
  let dogs = 0
  let dogsDeceased = 0
  let enrolments = 0
  let consults = 0
  let customFieldValues = 0
  let peopleWithEmail = 0
  let placeholder = 0
  const services = new Set<string>()
  const labels = new Set<string>()

  for (const p of plan.people) {
    dogs += p.dogs?.length ?? 0
    dogsDeceased += (p.dogs ?? []).filter(d => !!(d.deceasedAt ?? '').trim()).length
    enrolments += p.enrolments?.length ?? 0
    consults += p.oneToOneConsults?.length ?? 0
    for (const c of p.oneToOneConsults ?? []) services.add(c.service.trim().toLowerCase())
    if (p.emailIsPlaceholder || !p.email?.trim()) placeholder++
    else peopleWithEmail++
    for (const [label, value] of Object.entries(p.customFields ?? {})) {
      labels.add(label)
      if (String(value ?? '').trim()) customFieldValues++
    }
  }

  return {
    people: plan.people.length,
    peopleWithEmail,
    peoplePlaceholderEmail: placeholder,
    dogs,
    dogsDeceased,
    courses: plan.courses.length,
    coursesSpreadsheet: plan.courses.filter(c => c.origin === 'spreadsheet').length,
    coursesReconstructed: plan.courses.filter(c => c.origin === 'invented').length,
    enrolments,
    oneToOneConsults: consults,
    distinctConsultServices: services.size,
    subscribers: plan.subscribers.length,
    customFieldValues,
    distinctCustomFieldLabels: [...labels].sort(),
  }
}

/**
 * The salt used to mint placeholder emails for people with no address anywhere.
 *
 * This is load-bearing and permanent. The placeholder is a hash of
 * `<namespace>:<person id>`, so it is what lets a re-run recognise the same
 * email-less person instead of creating a second copy — and changing it after an
 * import means every one of those people is imported again as a duplicate.
 *
 * Pin it per client, in the plan (`meta.emailNamespace`) or with
 * --email-namespace, and then leave it alone. The one-off Journey/Prime import
 * used `prime`, so re-running that plan through this toolkit must pass it.
 */
export function resolveEmailNamespace(plan: Plan, explicit?: string | null): string {
  const meta = plan.meta as Record<string, unknown> | undefined
  return String(explicit || meta?.emailNamespace || meta?.client || meta?.slug || 'import')
}

export function planLabel(planPath: string, plan: Plan): string {
  const meta = plan.meta as Record<string, unknown> | undefined
  const name = meta?.client ?? meta?.slug ?? basename(dirname(planPath))
  return String(name)
}
