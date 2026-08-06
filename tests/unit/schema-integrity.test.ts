import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The rules `prisma/schema.prisma` has to keep obeying as it grows.
 *
 * Written out of the database audit of 2026-08-04 (`docs/audit-database.md`).
 * The findings in that report are the kind that rot back in silently: an index
 * gets dropped in a later migration, a new model ships without `trainerId`, an
 * `onDelete` flips and orphans appear months later. A report can't stop any of
 * that; a rule can.
 *
 * It reads the SCHEMA TEXT rather than the generated client or a live database,
 * deliberately, for three reasons:
 *
 *   • the rules are about DECLARATIONS (`onDelete`, `@@index`, `@db.Date`), and
 *     several of them are invisible once Prisma has turned the schema into SQL;
 *   • unit tests here never touch a real DB (AGENTS.md), and the dev DB is a
 *     near-empty `db push` of the same file anyway, so it would prove nothing;
 *   • the schema file is what a person edits, so a failure points at the line
 *     they just wrote.
 *
 * Same shape as tests/unit/listing-page-pattern.test.ts: one house rule per
 * describe, and every exclusion named with the reason it is excluded — because
 * "why is this one allowed?" is the question the next reader will have, and an
 * allow-list without answers is a rubber stamp.
 */

// ─── Schema parsing ──────────────────────────────────────────────────────────

interface Relation {
  fields: string[]
  references: string[]
  onDelete: string | null
}
interface Field {
  name: string
  type: string
  optional: boolean
  list: boolean
  isId: boolean
  unique: boolean
  dbType: string | null
  relation: Relation | null
  line: number
}
interface Model {
  name: string
  map: string | null
  fields: Field[]
  indexes: string[][]
  uniques: string[][]
  compoundId: string[] | null
}

const SCHEMA_PATH = join(process.cwd(), 'prisma', 'schema.prisma')
const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations')

/** `@@index([a, b])` / `@@unique([a, b], map: "…")` → ['a', 'b'] */
function attrFieldList(line: string): string[] {
  const body = line.slice(line.indexOf('(') + 1, line.lastIndexOf(')'))
  const arr = body.match(/\[([^\]]*)\]/)?.[1] ?? body.split(',')[0]
  return arr
    .split(',')
    .map((s) => s.trim().replace(/\(.*\)/, ''))
    .filter((s) => s.length > 0 && !s.includes(':'))
}

/** The `@relation(…)` body, found by balancing brackets (it contains its own). */
function parseRelation(attrs: string): Relation | null {
  const start = attrs.indexOf('@relation(')
  if (start === -1) return null
  let depth = 0
  let end = -1
  for (let i = start + '@relation'.length; i < attrs.length; i++) {
    if (attrs[i] === '(') depth++
    else if (attrs[i] === ')') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const body = attrs.slice(start + '@relation('.length, end)
  return {
    fields: body.match(/fields:\s*\[([^\]]*)\]/)?.[1].split(',').map((s) => s.trim()).filter(Boolean) ?? [],
    references: body.match(/references:\s*\[([^\]]*)\]/)?.[1].split(',').map((s) => s.trim()).filter(Boolean) ?? [],
    onDelete: body.match(/onDelete:\s*(\w+)/)?.[1] ?? null,
  }
}

function parseSchema(src: string): Model[] {
  const models: Model[] = []
  let cur: Model | null = null
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\/\/.*$/, '').trim()
    if (!line) continue
    const open = line.match(/^model\s+(\w+)\s*\{/)
    if (open) {
      cur = { name: open[1], map: null, fields: [], indexes: [], uniques: [], compoundId: null }
      models.push(cur)
      continue
    }
    if (!cur) continue
    if (line === '}') {
      cur = null
      continue
    }
    if (line.startsWith('@@map(')) {
      cur.map = line.match(/@@map\("([^"]+)"\)/)?.[1] ?? null
      continue
    }
    if (line.startsWith('@@index(')) {
      cur.indexes.push(attrFieldList(line))
      continue
    }
    if (line.startsWith('@@unique(')) {
      cur.uniques.push(attrFieldList(line))
      continue
    }
    if (line.startsWith('@@id(')) {
      cur.compoundId = attrFieldList(line)
      continue
    }
    if (line.startsWith('@@')) continue
    const f = line.match(/^(\w+)\s+([\w[\]?]+)\s*(.*)$/)
    if (!f) continue
    const [, name, typeRaw, attrs] = f
    cur.fields.push({
      name,
      type: typeRaw.replace(/[?[\]]/g, ''),
      optional: typeRaw.endsWith('?'),
      list: typeRaw.endsWith('[]'),
      isId: /@id\b/.test(attrs),
      unique: /@unique\b/.test(attrs),
      dbType: attrs.match(/@db\.(\w+)/)?.[1] ?? null,
      relation: parseRelation(attrs),
      line: i + 1,
    })
  }
  return models
}

const SCHEMA_SRC = readFileSync(SCHEMA_PATH, 'utf8')
const MODELS = parseSchema(SCHEMA_SRC)
const BY_NAME = new Map(MODELS.map((m) => [m.name, m]))

/** Every `@relation(fields: […])` in the schema — i.e. every real foreign key. */
interface Fk {
  model: string
  field: string
  column: string
  optional: boolean
  target: string
  onDelete: string | null
  /** `Model.relationField` — how the schema names the relation. */
  key: string
  /** `Model.fkColumn` — how an index or a SQL error names it. */
  columnKey: string
}
const FKS: Fk[] = MODELS.flatMap((m) =>
  m.fields
    .filter((f) => f.relation && f.relation.fields.length > 0)
    .map((f) => {
      const column = f.relation!.fields[0]
      return {
        model: m.name,
        field: f.name,
        column,
        optional: m.fields.find((x) => x.name === column)?.optional ?? false,
        target: f.type,
        onDelete: f.relation!.onDelete,
        key: `${m.name}.${f.name}`,
        columnKey: `${m.name}.${column}`,
      }
    }),
)

/** Columns usable as the LEADING column of some index — the only ones a
 *  foreign-key lookup or a cascading delete can actually use. */
function leadingIndexedColumns(m: Model): Set<string> {
  const s = new Set<string>()
  for (const idx of m.indexes) if (idx[0]) s.add(idx[0])
  for (const u of m.uniques) if (u[0]) s.add(u[0])
  if (m.compoundId?.[0]) s.add(m.compoundId[0])
  for (const f of m.fields) if (f.isId || f.unique) s.add(f.name)
  return s
}

// ─── 1. Every model maps to a snake_case table ───────────────────────────────

describe('every model maps to a snake_case table name', () => {
  it('has an @@map', () => {
    const missing = MODELS.filter((m) => !m.map).map((m) => m.name)
    expect(missing, `models without @@map: ${missing.join(', ')}`).toEqual([])
  })

  it('maps to snake_case, not the model name', () => {
    const wrong = MODELS.filter((m) => m.map && !/^[a-z][a-z0-9_]*$/.test(m.map)).map(
      (m) => `${m.name} → ${m.map}`,
    )
    expect(wrong, `not snake_case: ${wrong.join(', ')}`).toEqual([])
  })
})

// ─── 2. Multi-tenancy: everything is reachable from a tenant ─────────────────

/**
 * A model is tenant-scoped if it carries `trainerId`/`companyId`, or hangs off
 * something that does by a REQUIRED relation (an optional link is not scoping —
 * null it and the row belongs to nobody).
 *
 * Anything else is a route to a cross-tenant bug, so each one is listed here
 * with why it genuinely doesn't need a tenant. New arrivals must be argued for,
 * not added.
 */
const TENANT_EXEMPT: Record<string, string> = {
  // ── Platform-global: one row set shared by every business ──
  SubscriptionPlan: 'the plan catalogue PupManager sells — global by definition',
  BillingItem: 'the add-on catalogue (mirrors src/lib/pricing.ts) — global',
  PromoCode: 'platform-issued signup codes — global',
  OnboardingStep: 'the onboarding catalogue, read at runtime — global (see memory: prod-global)',
  OnboardingEmail: 'the onboarding drip catalogue — global',
  Announcement: 'Super Admin broadcast to every trainer/client — global on purpose',
  StripeWebhookEvent: 'platform-level Stripe idempotency ledger — no tenant exists at receipt time',
  DemoLead:
    'a trade-show visitor who scanned the QR — PupManager\'s own marketing record, not any trainer\'s data. ' +
    'It deliberately OUTLIVES the sandbox tenant it spun up (which is purged within hours), so a required ' +
    'relation to a tenant would be a relation to a row we intend to delete. DemoSession hangs off this one.',

  // ── Auth / identity: scoped to a USER, who may belong to several tenants ──
  User: 'the identity itself — one user can be a trainer here and a client there',
  Account: 'NextAuth OAuth account, keyed to User',
  Session: 'NextAuth session, keyed to User',
  VerificationToken: 'NextAuth email token, keyed to an email address',
  DeviceToken: 'push token, keyed to User (a phone, not a business)',
  NudgeDismissal: 'per-user UI dismissal, keyed to User',

  // ── Infrastructure, not business data ──
  RateLimit: 'IP/route counters — deliberately keyed to the caller, not a tenant',
  ReviewComment: 'the in-app review widget (review-core); dev tooling, not trainer data',

  // ── Known gaps: real business data with no enforced tenant. ──
  // These are FINDINGS, not exemptions-on-merit — see docs/audit-database.md.
  // They are listed so the rule can be switched on for everything else; each
  // one should eventually be fixed rather than kept.
  Dog: 'AUDIT GAP: only linked to a client by an OPTIONAL relation, so deleting a client leaves an ownerless, tenant-less dog',
  Notification: 'AUDIT GAP: userId is a plain column with no FK and no tenant',
  ClientReminderSent: 'AUDIT GAP: sessionId/userId are plain columns with no FK',
  CommsFlowStep: 'AUDIT GAP: all three parents (classRun/package/membership) are optional, so a step can belong to nothing',
  CommsFlowSend: 'AUDIT GAP: inherits CommsFlowStep — the send ledger has no tenant column',
  FlowStepCompletion:
    'AUDIT GAP: the mirror of CommsFlowSend ("they did it" vs "we sent it") and inherits the same gap — its only required relation is to CommsFlowStep, which is itself tenant-less. Fix both together or neither.',
  TrainerProfile: 'IS the tenant — its own id is the trainerId everything else carries',

  // ── Reachable from a tenant, just not in a way this static check can see ──
  MessageAttachment:
    'a photo in a chat. Its parent is an EXCLUSIVE ARC — exactly one of messageId / groupMessageId ' +
    'is set — so neither relation can be marked required and this walk finds no path. The guarantee ' +
    'is enforced in the database instead, by the CHECK constraint ' +
    '"message_attachments_one_parent" (migration 20260806260000_message_attachments): every row has ' +
    'a parent, and both parents cascade to a tenant (Message → ClientProfile → trainerId, ' +
    'GroupMessage → MessageGroup → trainerId). Serving is authorised by walking that parent — see ' +
    'src/app/api/message-images/[attachmentId], which never trusts an id on its own.',
}

describe('every model is reachable from a tenant', () => {
  it('has trainerId/companyId, or a required relation to something that does', () => {
    const scoped = new Set(
      MODELS.filter((m) => m.fields.some((f) => f.name === 'trainerId' || f.name === 'companyId')).map(
        (m) => m.name,
      ),
    )
    // Propagate through required (non-optional, non-list) relations to a fixpoint.
    for (let changed = true; changed; ) {
      changed = false
      for (const m of MODELS) {
        if (scoped.has(m.name)) continue
        const anchored = m.fields.some(
          (f) => f.relation && f.relation.fields.length > 0 && !f.optional && !f.list && scoped.has(f.type),
        )
        if (anchored) {
          scoped.add(m.name)
          changed = true
        }
      }
    }
    const unscoped = MODELS.filter((m) => !scoped.has(m.name) && !(m.name in TENANT_EXEMPT)).map((m) => m.name)
    expect(
      unscoped,
      `no tenant path: ${unscoped.join(', ')} — add trainerId, or a REQUIRED relation to something that has one. ` +
        'Only add to TENANT_EXEMPT with a reason.',
    ).toEqual([])
  })

  it('does not keep exemptions for models that have since been scoped', () => {
    const stale = Object.keys(TENANT_EXEMPT).filter((n) => !BY_NAME.has(n))
    expect(stale, `TENANT_EXEMPT names models that no longer exist: ${stale.join(', ')}`).toEqual([])
  })
})

// ─── 3. Every foreign key is indexed ────────────────────────────────────────

/**
 * Postgres does NOT index a foreign key for you. Without one, every delete of
 * the parent scans the whole child table, and every "…where parentId = x" read
 * does too.
 *
 * The list below is what the 2026-08-04 audit found already unindexed. It is a
 * snapshot to stop the count GROWING — each entry is a real (small) cost today
 * and the report says which are worth fixing. Nothing new may join it.
 */
const UNINDEXED_FK_DEBT: Record<string, string> = {
  // Tenant-scoping columns — the ones actually worth fixing (see the report).
  'ProductVariant.trainerId': 'AUDIT: tenant column, unindexed — table scan per trainer',
  'TrainingTemplate.trainerId': 'AUDIT: tenant column, unindexed — table scan per trainer',
  'ClientNotification.trainerId': 'AUDIT: tenant column, unindexed — table scan per trainer',
  // Parent → children reads that will grow with usage.
  'TemplateTask.templateId': 'AUDIT: every template read scans template_tasks',
  'ClientAchievement.achievementId': 'AUDIT: "who has this award" scans the table',
  'BookingRequest.packageId': 'AUDIT: booking requests per offering',
  'ClassEnrollment.dogId': 'AUDIT: enrolments by dog',
  'TrainingSession.dogId': 'AUDIT: sessions by dog',
  'TrainingTask.dogId': 'AUDIT: homework by dog',
  'SessionBuddy.dogId': 'AUDIT: buddies by dog',
  'ClientProfile.dogId': 'AUDIT: the primary-dog back-link',
  'ClientShare.sharedById': 'AUDIT: shares issued by a trainer',
  'MessageGroup.classRunId': 'AUDIT: the class chat lookup',
  'Product.categoryId': 'AUDIT: products in a category (shelf browse)',
  'PaymentItem.productId': 'AUDIT: payment lines by product',
  'PaymentItem.variantId': 'AUDIT: payment lines by variant',
  'ProductRequest.variantId': 'AUDIT: requests by variant',
  'ProductRequest.fulfilledSessionId': 'AUDIT: requests fulfilled at a session',
  'StockMovement.variantId': 'AUDIT: stock ledger by variant — the hottest of these',
  'StockMovement.clientId': 'AUDIT: stock ledger by client',
  'StockMovement.userId': 'AUDIT: stock ledger by staff member',
  'TrainerTodo.createdById': 'AUDIT: todos raised by a member',
  'TrainerTodo.assignedToId': 'AUDIT: todos assigned to a member',
  'TrainerBrainDump.userId': 'AUDIT: brain dumps by user',
  'TimeEntry.rateId': 'AUDIT: entries on a rate (only read when archiving a rate)',
  'TrainerAddon.itemId': 'AUDIT: covered second-column by (trainerId,itemId); leading lookup is rare',
  'Enquiry.formId': 'AUDIT: enquiries per embed form',
  'Enquiry.unifiedFormId': 'AUDIT: enquiries per unified form',
  'Form.continueIntakeFormId': 'AUDIT: self-reference, tiny table',
  'EmbedForm.autoReplyTemplateId': 'AUDIT: tiny table',
  'Subscriber.sourceLeadMagnetId': 'AUDIT: subscribers per lead magnet',
  'ClientProfile.intakeFormId': 'AUDIT: clients on an intake form',
  'TrainerProfile.subscriptionPlanId': 'AUDIT: trainers on a plan — admin-only read',
  'TrainerProfile.promoCodeId': 'AUDIT: trainers on a promo — admin-only read',
}

describe('every foreign key can be looked up by an index', () => {
  it('has the FK column as the leading column of some index', () => {
    const unindexed = FKS.filter((fk) => {
      const m = BY_NAME.get(fk.model)!
      return !leadingIndexedColumns(m).has(fk.column)
    }).map((fk) => fk.columnKey)

    const newlyUnindexed = unindexed.filter((k) => !(k in UNINDEXED_FK_DEBT))
    expect(
      newlyUnindexed,
      `new unindexed foreign key(s): ${newlyUnindexed.join(', ')} — add @@index([<column>]).`,
    ).toEqual([])
  })

  it('does not carry debt entries that have since been indexed or removed', () => {
    const stillUnindexed = new Set(
      FKS.filter((fk) => !leadingIndexedColumns(BY_NAME.get(fk.model)!).has(fk.column)).map((fk) => fk.columnKey),
    )
    const stale = Object.keys(UNINDEXED_FK_DEBT).filter((k) => !stillUnindexed.has(k))
    expect(stale, `fixed — delete from UNINDEXED_FK_DEBT: ${stale.join(', ')}`).toEqual([])
  })
})

// ─── 4. Money is integer minor units, never a float ─────────────────────────

/**
 * Every price, amount and fee is an Int of cents. A Float silently rounds:
 * 0.1 + 0.2 is not 0.3, and a trainer's invoice total is the last place that
 * should be true.
 */
const MONEYISH = /(cents|amount|price|fee|total|balance|subtotal)/i
const FLOAT_MONEY_ALLOWED: Record<string, string> = {
  'SubscriptionPlan.priceMonthly':
    'NZD reference figure for display only — Stripe Price IDs are authoritative for what is charged',
  'BillingItem.priceMonthly':
    'NZD reference figure for display only — same as SubscriptionPlan (the comment in the schema says so)',
}

describe('money is never a float', () => {
  it('has no Float column with a money-shaped name', () => {
    const floats = MODELS.flatMap((m) =>
      m.fields
        .filter((f) => f.type === 'Float' && MONEYISH.test(f.name))
        .map((f) => `${m.name}.${f.name}`),
    ).filter((k) => !(k in FLOAT_MONEY_ALLOWED))
    expect(
      floats,
      `float money column(s): ${floats.join(', ')} — store minor units as Int (…Cents), or Decimal for a rate.`,
    ).toEqual([])
  })

  it('names integer money columns in minor units', () => {
    /**
     * `…Cents` is the convention: the suffix is what stops a call site reading
     * `amount` as dollars. The exceptions below are all minor units too — they
     * are named after the Stripe field they mirror, which is the one case where
     * matching the upstream name is worth more than matching ours.
     */
    const NON_CENTS_BUT_MINOR_UNITS: Record<string, string> = {
      'Payment.amountTotal': 'mirrors Stripe PaymentIntent.amount — minor units',
      'Payment.amountRefunded': 'mirrors Stripe amount_refunded — minor units',
      'Payment.applicationFeeAmount': 'mirrors Stripe application_fee_amount — minor units',
      'Payment.stripeFeeAmount': 'mirrors Stripe BalanceTransaction.fee — minor units',
      'PaymentItem.unitAmount': 'the per-unit half of Payment.amountTotal — minor units',
      'Refund.amount': 'mirrors Stripe Refund.amount — minor units',
      'MembershipInvoice.amountDue': 'mirrors Stripe Invoice.amount_due — minor units',
      'MembershipInvoice.amountPaid': 'mirrors Stripe Invoice.amount_paid — minor units',
      // Not money at all — caught by the name regex.
      'StockMovement.balanceAfter': 'a stock COUNT after the movement, not money',
      'TrainerProfile.cancellationFeeWindowHours': 'a number of HOURS, not a fee',
    }
    const bad = MODELS.flatMap((m) =>
      m.fields
        .filter((f) => f.type === 'Int' && MONEYISH.test(f.name) && !/Cents$/.test(f.name) && !/Percent$/.test(f.name))
        .map((f) => `${m.name}.${f.name}`),
    ).filter((k) => !(k in NON_CENTS_BUT_MINOR_UNITS))
    expect(
      bad,
      `money-shaped Int without a Cents suffix: ${bad.join(', ')} — rename to …Cents, or say here why it isn't money.`,
    ).toEqual([])
  })
})

// ─── 5. Every relation states its own onDelete ──────────────────────────────

/**
 * Prisma's implicit default — Restrict for a required relation, SetNull for an
 * optional one — is invisible in the schema, so nobody reviewing a new model
 * ever decides what a delete should do. They just inherit it.
 *
 * The eleven below predate the rule and are listed with what they actually do,
 * so the behaviour is at least written down somewhere. New relations must say
 * it out loud.
 */
const IMPLICIT_ONDELETE_LEGACY: Record<string, string> = {
  'TrainerProfile.subscriptionPlan': 'optional → SetNull: a retired plan leaves the trainer plan-less, which billing handles',
  'ClientProfile.trainer': 'required → Restrict: intended, but the DB actually holds Cascade from the other side',
  'ClientProfile.dog': 'optional → SetNull: the primary-dog back-link clears when the dog goes',
  'Dog.owner': 'optional → SetNull: AUDIT — this is what leaves an ownerless dog when a client is deleted',
  'ClientShare.sharedBy': 'required → Restrict: a share cannot outlive the trainer who made it',
  'ClientShare.sharedWith': 'required → Restrict: same, for the receiving trainer',
  'TrainingTask.dog': 'optional → SetNull: homework survives the dog, attached to the client',
  'TrainingSession.dog': 'optional → SetNull: history survives the dog',
  'Message.sender': 'required → Restrict: a message keeps its author',
  'GroupMessage.sender': 'required → Restrict: same for group chat',
  'TrainerAddon.item': 'required → Restrict: an add-on cannot outlive its BillingItem',
}

describe('every relation says what a delete does', () => {
  it('declares onDelete explicitly', () => {
    const implicit = FKS.filter((fk) => !fk.onDelete).map((fk) => fk.key)
    const added = implicit.filter((k) => !(k in IMPLICIT_ONDELETE_LEGACY))
    expect(
      added,
      `relation(s) with no onDelete: ${added.join(', ')} — state Cascade / SetNull / Restrict deliberately.`,
    ).toEqual([])
  })
})

// ─── 6. SetNull is a decision, and the column must tolerate null ────────────

/**
 * `onDelete: SetNull` means "the code downstream copes with this being null".
 * It is the quietest kind of data loss: nothing errors, a link simply vanishes.
 *
 * Two things are asserted. The first is structural and permanent: a SetNull FK
 * has to be on an OPTIONAL column, or the delete fails at runtime instead of at
 * schema-write time. The second pins today's set, so adding a 45th is a change
 * somebody chose rather than one that arrived with a copied model.
 */
const SETNULL_RELATIONS = [
  // Sessions keep their history when the thing that generated them goes. This
  // is the fix for the old bug where deleting one PackageSessionSlot cascaded
  // away a year of a trainer's sessions.
  'TrainingSession.packageSessionSlot',
  'TrainingSession.sessionPlan',
  'TrainingSession.clientPackage',
  'TrainingSession.bookingPage',
  'TrainingSession.client',
  'TrainingSession.assignedTrainer',
  'TrainingTask.session',
  'TrainingTask.libraryTask',
  // A library item survives its THEME being deleted. Cascade here meant a
  // trainer tidying their grouping — a rename-shaped action — silently
  // destroyed every exercise inside it, plus the offering defaults pointing at
  // them. The item keeps its category (LibraryTask.typeId, which is required),
  // so a null theme is not an orphan: it reappears on the category page under
  // "In this category", and every reader treats the theme as optional grouping.
  'LibraryTask.theme',
  'SessionBuddy.dog',
  // Money rows outlive what they were raised for — the amount stays, the link
  // to the deleted thing goes. (See the report: the invoice side does NOT do
  // this, which is the inconsistency worth fixing.)
  'Payment.client',
  'PaymentItem.clientPackage',
  'PaymentItem.trainingSession',
  'PaymentItem.product',
  'PaymentItem.variant',
  'PaymentItem.classEnrollment',
  'StockMovement.client',
  'StockMovement.user',
  'StockMovement.variant',
  'TimeEntry.rate',
  'TimeEntry.client',
  // A flow run's cursor clears when the step it points at is deleted. Cascade
  // would delete the PEOPLE walking through the journey because a trainer
  // removed one step of it; nextStepFor() recomputes the cursor from the
  // completions, so a null one is recoverable and an absent run is not.
  'FlowRun.currentStep',
  // Staff assignment clears when the staff member leaves; the work stays.
  'ClientProfile.assignedTrainer',
  'TrainerTodo.assignedTo',
  // Optional catalogue links — the offering survives losing its category/tier.
  'Product.productCategory',
  'Package.defaultSessionForm',
  'PackageSessionSlot.location',
  'ClassEnrollment.dog',
  'ClassEnrollment.ticketTier',
  'ClassEnrollment.sessionForm',
  'MessageGroup.classRun',
  'MessageGroupParticipant.client',
  'BookingPage.package',
  'WaitlistEntry.client',
  'WaitlistEntry.package',
  'MembershipPurchase.plan',
  'ProductRequest.variant',
  'ProductRequest.fulfilledSession',
  'TrainerProfile.promoCode',
  // Forms and enquiries — a submission outlives the form it came from.
  'ClientProfile.intakeForm',
  'Form.continueIntakeForm',
  'EmbedForm.autoReplyTemplate',
  'Enquiry.form',
  'Enquiry.unifiedForm',
  'Enquiry.clientProfile',
  'Subscriber.sourceLeadMagnet',
].sort()

describe('onDelete: SetNull only where null is survivable', () => {
  it('is only ever on an optional column', () => {
    const required = FKS.filter((fk) => fk.onDelete === 'SetNull' && !fk.optional).map((fk) => fk.key)
    expect(
      required,
      `SetNull on a required column: ${required.join(', ')} — the delete will fail at runtime.`,
    ).toEqual([])
  })

  it('is exactly the set that was reviewed', () => {
    const actual = FKS.filter((fk) => fk.onDelete === 'SetNull').map((fk) => fk.key).sort()
    expect(
      actual,
      'a SetNull relation was added or removed — confirm the reading code copes with null, then update this list',
    ).toEqual(SETNULL_RELATIONS)
  })
})

// ─── 7. Cascade never reaches a settled money row ───────────────────────────

/**
 * A Cascade into a money table deletes a receivable or a payment with no trace.
 * The two below are the ones that exist; both are flagged in the report, and
 * `Invoice.client` is the one that genuinely differs from how Payment behaves
 * (Payment.client is SetNull — the payment survives, the invoice does not).
 */
const MONEY_MODELS = new Set(['Invoice', 'InvoiceLineItem', 'Payment', 'PaymentItem', 'Refund', 'MembershipInvoice'])
const CASCADE_INTO_MONEY_KNOWN: Record<string, string> = {
  'Invoice.trainer': 'closing the whole business takes its ledger with it — deliberate',
  'Invoice.client': 'AUDIT: asymmetric with Payment.client (SetNull) — deleting a client destroys their invoices',
  'InvoiceLineItem.invoice': 'lines are part of the invoice, not separate records',
  'Payment.trainer': 'closing the whole business takes its ledger with it — deliberate',
  'PaymentItem.payment': 'lines are part of the payment',
  'Refund.payment': 'a refund is part of the payment it reverses',
  'MembershipInvoice.purchase': 'invoices belong to the subscription that raised them',
}

describe('nothing new cascades into a money table', () => {
  it('only cascades where the report says it should', () => {
    const cascades = FKS.filter((fk) => MONEY_MODELS.has(fk.model) && fk.onDelete === 'Cascade').map((fk) => fk.key)
    const added = cascades.filter((k) => !(k in CASCADE_INTO_MONEY_KNOWN))
    expect(
      added,
      `new Cascade into a money table: ${added.join(', ')} — deleting the parent will silently destroy financial records.`,
    ).toEqual([])
  })
})

// ─── 8. Calendar-day columns are declared, not discovered ───────────────────

/**
 * `@db.Date` is a calendar day with no time. Prisma renders a JS Date into it
 * from that Date's UTC components, so a bound has to be built at UTC midnight
 * (`dateOnlyUtc` in src/lib/timezone.ts) — NOT with `startOfDayInTz`, which
 * returns a real instant and shifts the whole window by a day. That has already
 * shipped as a bug twice, and the audit found the weekly-summary cron still
 * doing it.
 *
 * Pinning the list means adding a DATE column forces a look at how it is read.
 */
const DATE_ONLY_COLUMNS = [
  'AvailabilitySlot.date',
  'AvailabilitySlot.firstDate',
  'BlackoutPeriod.endDate',
  'BlackoutPeriod.startDate',
  'TimeEntry.date',
  'Timesheet.weekStart',
  'TrainingTask.date',
  'WaitlistEntry.earliestStart',
].sort()

describe('calendar-day columns', () => {
  it('are exactly the ones that have been checked against dateOnlyUtc', () => {
    const actual = MODELS.flatMap((m) =>
      m.fields.filter((f) => f.dbType === 'Date').map((f) => `${m.name}.${f.name}`),
    ).sort()
    expect(
      actual,
      'a @db.Date column changed — every read of it must build its bounds with dateOnlyUtc(), never startOfDayInTz()',
    ).toEqual(DATE_ONLY_COLUMNS)
  })
})

// ─── 9. Migrations address tables by their mapped name ──────────────────────

/**
 * A hand-written migration that says `ALTER TABLE "TrainerProfile"` instead of
 * `"trainer_profiles"` fails `prisma migrate deploy` with 42P01 — in
 * production, on the deploy, which is where the build then stops. It has
 * happened here before (see the memory note on migration table names).
 */
describe('migration files use the mapped table names', () => {
  const migrationFiles = existsSync(MIGRATIONS_DIR)
    ? readdirSync(MIGRATIONS_DIR)
        .map((d) => ({ dir: d, path: join(MIGRATIONS_DIR, d, 'migration.sql') }))
        .filter((f) => existsSync(f.path))
    : []

  it('finds migrations to check', () => {
    expect(migrationFiles.length).toBeGreaterThan(0)
  })

  it('never names a table by its Prisma model name', () => {
    const mapped = new Set(MODELS.map((m) => m.map!).filter(Boolean))
    // Tables Prisma or Postgres owns, which no model maps to.
    const INFRA_TABLES = new Set(['_prisma_migrations'])
    const offences: string[] = []
    for (const { dir, path } of migrationFiles) {
      const sql = readFileSync(path, 'utf8')
      const re =
        /\b(?:ALTER|CREATE(?:\s+UNIQUE)?|DROP|TRUNCATE)\s+TABLE(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+(?:ONLY\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi
      let hit: RegExpExecArray | null
      while ((hit = re.exec(sql))) {
        const t = hit[1]
        if (mapped.has(t) || INFRA_TABLES.has(t)) continue
        // A table an old migration created and a later one dropped is fine —
        // only flag the ones that match a CURRENT model name, which is the
        // mistake this rule exists for.
        if (BY_NAME.has(t)) offences.push(`${dir}: "${t}" — use "${BY_NAME.get(t)!.map}"`)
      }
    }
    expect(offences, `migration(s) using a model name as a table name:\n${offences.join('\n')}`).toEqual([])
  })
})

// ─── 10. The parser itself ──────────────────────────────────────────────────

/**
 * Every rule above is only as true as the parse. If a schema edit ever breaks
 * the field regex, the rules would quietly pass on an empty list — so assert
 * the parse still finds a plausible schema.
 */
describe('the schema parse is sane', () => {
  it('finds the models and their foreign keys', () => {
    expect(MODELS.length).toBeGreaterThan(100)
    expect(FKS.length).toBeGreaterThan(150)
    // Spot-check a model whose shape is load-bearing everywhere else.
    const session = BY_NAME.get('TrainingSession')
    expect(session?.map).toBe('training_sessions')
    expect(session?.fields.find((f) => f.name === 'trainerId')?.optional).toBe(false)
    expect(session?.fields.find((f) => f.name === 'packageSessionSlot')?.relation?.onDelete).toBe('SetNull')
  })
})
