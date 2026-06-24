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
  // A published public embed form, used to test the public-form rate limiter.
  embedFormId: 'e2eembedform0000000000000',
  // Business A clients with fixed ids: one assigned to staff (mass-assignment
  // target), one unassigned (staff without clients.viewAll must NOT reach it).
  assignedClientId: 'e2eaassignedclient000000x',
  unassignedClientId: 'e2eaunassignedclient00000',
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
  // Emails we invite trainers at during the multi-trainer spec.
  invitees: [
    { name: 'Manny Manager', email: 'manny@e2e.test', role: 'MANAGER' as const },
    { name: 'Stan Staff', email: 'stan@e2e.test', role: 'STAFF' as const },
    { name: 'Sara Staff', email: 'sara@e2e.test', role: 'STAFF' as const },
    { name: 'Mo Manager', email: 'mo@e2e.test', role: 'MANAGER' as const },
    { name: 'Tia Trainer', email: 'tia@e2e.test', role: 'STAFF' as const },
  ],
}
