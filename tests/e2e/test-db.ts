// Shared config for the isolated E2E Postgres. The whole E2E suite runs against
// a throwaway embedded Postgres (no Docker, no prod) so creating businesses,
// trainers and clients never touches the real database. See global-setup.ts.
import path from 'node:path'

export const TEST_DB = {
  host: '127.0.0.1',
  port: 54329,
  user: 'postgres',
  password: 'postgres',
  database: 'pupmanager_test',
  dataDir: path.resolve(process.cwd(), '.test-db/data'),
}

export const TEST_DATABASE_URL = `postgresql://${TEST_DB.user}:${TEST_DB.password}@${TEST_DB.host}:${TEST_DB.port}/${TEST_DB.database}`

// Known seed credentials the specs log in with.
export const SEED = {
  owner: { email: 'owner@e2e.test', password: 'Password123!', name: 'Olivia Owner', businessName: 'E2E Dog School' },
  // Accepted members with passwords, so permission specs can log in as them.
  manager: { email: 'manager@e2e.test', password: 'Password123!', name: 'Morgan Manager' },
  staff: { email: 'staffer@e2e.test', password: 'Password123!', name: 'Sam Staff' },
  // Platform admin for /admin/* specs.
  admin: { email: 'admin@e2e.test', password: 'Password123!', name: 'Ada Admin' },
  // The seeded dog owner (Business A's assigned client). Has a password + phone
  // so the CLIENT app can actually be logged into (the client layout's intake
  // gate requires name + phone).
  client: { email: 'client@e2e.test', password: 'Password123!', name: 'Sarah Client' },
  // A published public embed form, used to test the public-form rate limiter.
  embedFormId: 'e2eembedform0000000000000',
  // Business A clients with fixed ids: one assigned to staff (mass-assignment
  // target), one unassigned (staff without clients.viewAll must NOT reach it).
  assignedClientId: 'e2eaassignedclient000000x',
  unassignedClientId: 'e2eaunassignedclient00000',
  // A FREE, instant, self-bookable package on Business A (no approval, no price)
  // plus 7-day 09:00–17:00 availability — drives the /my-availability booking
  // wizard happy path without any Stripe handoff.
  selfBookPackageId: 'e2eselfbookpkg0000000000x',
  // A SEPARATE business (different tenant) — the pentest tries to breach it
  // from Business A. Its resources have fixed ids so the attacker can target them.
  businessB: {
    ownerEmail: 'ownerb@e2e.test',
    ownerPassword: 'Password123!',
    name: 'Bianca Rival',
    businessName: 'Rival Dog Co',
    clientId: 'e2ebclient00000000000000',
    packageId: 'e2ebpackage0000000000000',
  },
  // ─── Invoicing / Xero fixtures (Business A unless noted) ───────────────────
  // Fixed-id rows the invoicing.spec.ts asserts against. Seeded in global-setup.
  invoicing: {
    // A PRICED package on Business A, so assigning it raises a receivable.
    pricedPackageId: 'e2epricedpkg000000000000x',
    // A PARTIAL invoice (amountPaidCents seeded) on Business A's assignedClient —
    // drives the "paid $X of $Y" / "Partially paid" UI assertions.
    partialInvoiceId: 'e2epartialinv00000000000x',
    // An editable UNPAID invoice on Business A's assignedClient — the edit spec
    // opens it, changes a line, and asserts the total updates. It carries a
    // FIXED pay token so the client-app spec (my-invoices) can assert the "Pay"
    // link points at the right public /pay/<token> page.
    editableInvoiceId: 'e2eeditableinv00000000000',
    editableInvoicePayToken: 'e2epaytoken0000000000000',
    // A fully PAID invoice on the same client — the client app shows it as a
    // receipt. Settled, so it's absent from every outstanding/receivable list.
    paidInvoiceId: 'e2epaidinvoice0000000000',
    // A Business B invoice — the cross-tenant guard target (A must 404 on it).
    businessBInvoiceId: 'e2ebinvoice0000000000000x',
  },
  // A homework task on Business A's assignedClient, dated at seed time so it
  // lands in the client home's current-week "This week" list. The homework-log
  // spec opens it and logs a practice against it.
  homework: {
    taskId: 'e2ehomeworktask000000000x',
    title: 'Loose-lead walking',
  },
  // Emails we invite trainers at during the multi-trainer spec.
  invitees: [
    { name: 'Manny Manager', email: 'manny@e2e.test', role: 'MANAGER' as const },
    { name: 'Stan Staff', email: 'stan@e2e.test', role: 'STAFF' as const },
    { name: 'Sara Staff', email: 'sara@e2e.test', role: 'STAFF' as const },
    { name: 'Mo Manager', email: 'mo@e2e.test', role: 'MANAGER' as const },
    { name: 'Tia Trainer', email: 'tia@e2e.test', role: 'STAFF' as const },
  ],
}
