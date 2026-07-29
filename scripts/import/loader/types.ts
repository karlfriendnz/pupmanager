/**
 * The canonical import plan shape, and the result shape every run reports.
 *
 * The plan is produced by the extract half of this toolkit (scripts/import/
 * build_plan.py). This file is the contract between the two halves: if the
 * Python side adds a field, add it here rather than reaching into `any`.
 */
import type { PrismaClient, Prisma } from '@/generated/prisma'

/** Either a real client or an interactive-transaction client — the loader works on both. */
export type Db = PrismaClient | Prisma.TransactionClient

export interface PlanDog {
  name: string
  breed: string | null
  /** ISO date, the literal "unknown", or null — see parseDeceasedAt(). */
  deceasedAt: string | null
  notes: string[]
  flags: string[]
}

export interface PlanEnrolment {
  courseId: string
  courseName: string
  courseOrigin: string
  level: string
  dog: string
  didNotAttend: boolean
  priorProvider: boolean
}

export interface PlanConsult {
  code: string
  service: string
  month: string | null
  year: string | null
  raw: string
  source: string
}

export interface PlanWaitlist {
  category: string
  breedAge: string | null
  dogRaw: string | null
  notes: string | null
}

export interface PlanAfRef {
  number: string | null
  raw: string
  bare: boolean
}

export interface PlanPerson {
  id: string
  firstName: string
  lastName: string
  fullName: string
  email: string | null
  emailIsPlaceholder: boolean
  phone: string | null
  address: string | null
  city: string | null
  postcode: string | null
  company: string | null
  dogs: PlanDog[]
  enrolments: PlanEnrolment[]
  oneToOneConsults: PlanConsult[]
  customFields: Record<string, string>
  notes: string | null
  accessCodes: string[]
  afRefs: PlanAfRef[]
  waitlist: PlanWaitlist[]
  isSubscriber: boolean
  flags: string[]
}

export interface PlanCourse {
  id: string
  origin: 'spreadsheet' | 'invented'
  /** The plan's name for the source row id. `spreadsheetCourseId` was the first build's. */
  externalId?: number | string | null
  spreadsheetCourseId?: number | null
  level: string
  code: string
  name: string
  nickname: string | null
  day: string | null
  date: string | null
  month: string | null
  year: string | null
  time: string | null
  location: string | null
  headerRaw: string | null
  flags: string[]
  probableSpreadsheetMatch?: string
}

export interface PlanSubscriber {
  email: string
  name: string | null
  personId: string | null
  linkedBy: string
  acceptsMarketing: string
  createdOn: string | null
}

export interface Plan {
  meta?: Record<string, unknown>
  people: PlanPerson[]
  courses: PlanCourse[]
  subscribers: PlanSubscriber[]
}

/** Everything the loader counts. Created vs merged vs already-there is the point. */
export interface ImportStats {
  clientsCreated: number
  clientsMerged: number
  clientsExisting: number
  dogsCreated: number
  dogsExisting: number
  dogsDeceased: number
  dogsUnnamed: number
  customFieldValues: number
  customFieldValuesUpdated: number
  packagesCreated: number
  classRunsCreated: number
  sessionsCreated: number
  coursesExisting: number
  enrolmentsCreated: number
  enrolmentsExisting: number
  enrolmentsUnmatched: number
  subscribersCreated: number
  subscribersExisting: number
  consultPackagesCreated: number
  clientPackagesCreated: number
  clientPackagesExisting: number
  placeholderEmails: number
  peopleFailed: number
}

export function emptyStats(): ImportStats {
  return {
    clientsCreated: 0, clientsMerged: 0, clientsExisting: 0,
    dogsCreated: 0, dogsExisting: 0, dogsDeceased: 0, dogsUnnamed: 0,
    customFieldValues: 0, customFieldValuesUpdated: 0,
    packagesCreated: 0, classRunsCreated: 0, sessionsCreated: 0, coursesExisting: 0,
    enrolmentsCreated: 0, enrolmentsExisting: 0, enrolmentsUnmatched: 0,
    subscribersCreated: 0, subscribersExisting: 0,
    consultPackagesCreated: 0, clientPackagesCreated: 0, clientPackagesExisting: 0,
    placeholderEmails: 0, peopleFailed: 0,
  }
}

/** A course whose name already exists as a ClassRun on this trainer — it is reused, not duplicated. */
export interface CourseCollision {
  courseId: string
  name: string
  origin: string
  existingRunId: string
}

export interface ImportResult {
  stats: ImportStats
  problems: string[]
  collisions: CourseCollision[]
  /** Missing CustomField labels → how many values were dropped for each. */
  missingCustomFields: Record<string, number>
}

export interface ImportOptions {
  trainerId: string
  plan: Plan
  /** Optional extract file used only to recover the YEAR of each spreadsheet course. */
  extractedPath?: string | null
  /**
   * Salt for the placeholder emails minted for people with no address anywhere.
   * It keeps two clients' person ids from colliding — and because the address is
   * derived from it, CHANGING IT ON A RE-RUN CREATES DUPLICATES. Pin it per
   * client and never edit it afterwards. See resolveEmailNamespace().
   */
  emailNamespace?: string
  /**
   * Wrap each person in a SAVEPOINT so one bad row can be rolled back without
   * poisoning the surrounding transaction. Required when running inside an
   * interactive transaction (dry run); pointless outside one.
   */
  savepoints?: boolean
  /** Called with a 0..1 fraction so long passes can report progress. */
  onProgress?: (label: string, done: number, total: number) => void
}
