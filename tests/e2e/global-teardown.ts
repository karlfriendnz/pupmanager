// Stops the embedded Postgres started in global-setup (shares the instance via
// globalThis — both run in the same Playwright runner process).
import type EmbeddedPostgres from 'embedded-postgres'

export default async function globalTeardown() {
  const pg = (globalThis as unknown as { __E2E_PG__?: EmbeddedPostgres }).__E2E_PG__
  if (pg) {
    try {
      await pg.stop()
      console.log('[e2e] embedded postgres stopped')
    } catch (err) {
      console.warn('[e2e] failed to stop embedded postgres', err)
    }
  }
}
