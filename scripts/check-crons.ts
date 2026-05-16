// Diagnostic: dump Supabase pg_cron job commands so we can match the
// existing auth pattern. Run: tsx scripts/check-crons.ts
import { prisma } from '../src/lib/prisma'

async function main() {
  try {
    const rows = await prisma.$queryRawUnsafe<
      { jobname: string; schedule: string; active: boolean; command: string }[]
    >('SELECT jobname, schedule, active, command FROM cron.job ORDER BY jobname')
    for (const r of rows) {
      console.log(`\n── ${r.jobname}  [${r.schedule}]  active=${r.active}`)
      // Redact any bearer token so the secret never prints.
      console.log(r.command.replace(/Bearer\s+[^"'\s]+/gi, 'Bearer ***').trim())
    }
  } catch (e) {
    console.log(`cron not reachable: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`)
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
