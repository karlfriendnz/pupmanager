/**
 * Audit: who could receive a notification they shouldn't?
 *
 * Read-only. Checks the conditions that would make a reminder fire wrongly:
 * stale UPCOMING sessions in the past, sessions on cancelled classes, sessions
 * whose client is gone or deactivated, demo data that could reach real people,
 * and duplicate-send guards that aren't holding.
 */
import { prisma } from '../src/lib/prisma'

const MAX_LEAD_MIN = 24 * 60

async function main() {
  const now = new Date()
  const soon = new Date(now.getTime() + MAX_LEAD_MIN * 60_000)
  const line = (label: string, n: number, note = '') =>
    console.log(`${n > 0 ? '⚠️ ' : '✅ '} ${label.padEnd(58)} ${String(n).padStart(5)}${note ? '  ' + note : ''}`)

  console.log(`\nNOTIFICATION RISK AUDIT — ${now.toISOString()}\n${'─'.repeat(84)}`)

  // 1. Sessions the reminder cron will look at in the next 24h.
  const upcoming = await prisma.trainingSession.count({
    where: { scheduledAt: { gt: now, lte: soon }, status: 'UPCOMING' },
  })
  line('sessions due in the next 24h (reminder candidates)', upcoming)

  // 2. Of those, ones with NO client, package or class — like the 9am seminar.
  //    These still push the trainer. Legitimate for a blocked-out slot, but the
  //    common cause of "why did I get told about that?".
  const detached = await prisma.trainingSession.count({
    where: { scheduledAt: { gt: now, lte: soon }, status: 'UPCOMING',
             clientId: null, clientPackageId: null, classRunId: null },
  })
  line('…of those, attached to nothing (no client/package/class)', detached, '← trainer-only push')

  // 3. Sessions on a CANCELLED class run that are still UPCOMING. A cancelled
  //    class must never remind anyone.
  const onCancelledRun = await prisma.trainingSession.count({
    where: { scheduledAt: { gt: now }, status: 'UPCOMING',
             classRun: { status: 'CANCELLED' } },
  })
  line('upcoming sessions on a CANCELLED class', onCancelledRun)

  // 4. Sessions whose client has been deactivated — they'd still be emailed.
  const deactivatedClient = await prisma.trainingSession.count({
    where: { scheduledAt: { gt: now }, status: 'UPCOMING',
             client: { user: { deactivatedAt: { not: null } } } },
  })
  line('upcoming sessions whose client is deactivated', deactivatedClient)

  // 5. Class sessions where every enrolment is WITHDRAWN — nobody left to tell.
  const emptyRuns = await prisma.classRun.count({
    where: { status: { in: ['SCHEDULED', 'RUNNING'] },
             sessions: { some: { scheduledAt: { gt: now }, status: 'UPCOMING' } },
             enrollments: { none: { status: 'ENROLLED' } } },
  })
  line('classes still running with zero enrolled clients', emptyRuns)

  // 6. Demo/sample data that could reach a real inbox. The crons exclude
  //    isSample, so this should be 0 by construction — verify, don't assume.
  const sampleUpcoming = await prisma.trainingSession.count({
    where: { scheduledAt: { gt: now, lte: soon }, status: 'UPCOMING',
             OR: [{ client: { isSample: true } }, { classRun: { isSample: true } }] },
  })
  line('sample/demo sessions in the reminder window (excluded by cron)', sampleUpcoming, '(filtered — informational)')

  // 7. Internal/demo businesses whose sessions are NOT sample-flagged: these
  //    are NOT excluded and would push for real.
  const internalNotSample = await prisma.trainingSession.count({
    where: { scheduledAt: { gt: now, lte: soon }, status: 'UPCOMING',
             trainer: { isInternal: true },
             NOT: { OR: [{ client: { isSample: true } }, { classRun: { isSample: true } }] } },
  })
  line('internal-business sessions that WOULD push (not sample-flagged)', internalNotSample)

  // 8. Stale: long past but still UPCOMING with no reminder sent. The cron's
  //    in-code window stops these firing; a regression in that guard would
  //    unleash them all at once, so the size of the pile matters.
  const stalePast = await prisma.trainingSession.count({
    where: { scheduledAt: { lt: new Date(now.getTime() - 7 * 86400_000) },
             status: 'UPCOMING', reminderPushSentAt: null },
  })
  line('sessions >7 days past, still UPCOMING, never reminded', stalePast, '← only the in-code window holds these back')

  // 9. Duplicate sends: the reminderPushSentAt guard is what stops a session
  //    being announced twice. Anything already flagged but still pending is a
  //    sign the guard isn't holding.
  const doubleRisk = await prisma.trainingSession.count({
    where: { scheduledAt: { gt: now, lte: soon }, status: 'UPCOMING',
             reminderPushSentAt: { not: null }, notesReminderPushSentAt: null },
  })
  line('upcoming sessions already reminded (guard holding)', doubleRisk, '(expected — informational)')

  console.log(`${'─'.repeat(84)}\n`)

  if (detached > 0) {
    const rows = await prisma.trainingSession.findMany({
      where: { scheduledAt: { gt: now, lte: soon }, status: 'UPCOMING',
               clientId: null, clientPackageId: null, classRunId: null },
      select: { title: true, scheduledAt: true, trainer: { select: { businessName: true } } },
      orderBy: { scheduledAt: 'asc' }, take: 20,
    })
    console.log('Detached sessions due in the next 24h:')
    for (const r of rows) console.log(`  ${r.scheduledAt.toISOString()} | ${r.trainer.businessName} | ${r.title}`)
    console.log('')
  }
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
