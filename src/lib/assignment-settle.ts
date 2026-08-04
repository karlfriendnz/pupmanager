import { prisma } from '@/lib/prisma'

/**
 * A booking that has no sessions left is a booking nobody owes for.
 *
 * Self-booking creates a ClientPackage assignment and raises ONE receivable for
 * it (`sourceType: 'PACKAGE'`, `sourceId` = the assignment). Cancelling a
 * session deletes the session — and used to say nothing about that receivable,
 * so a client who booked and then cancelled was still billed for a package
 * whose only session no longer existed, sometimes with a cancellation fee on
 * top of it (audit T-12).
 *
 * Only when the LAST one goes. A six-session package with five left is still a
 * six-session package that was bought; cancelling one session out of it must not
 * wipe the bill for the other five.
 *
 * UNPAID only, the same rule as everywhere else: money that has already moved is
 * a refund decision, and that belongs to the trainer.
 */
export async function settleAssignmentIfEmptied(
  clientPackageId: string | null | undefined,
  trainerId: string,
): Promise<{ settled: boolean }> {
  if (!clientPackageId) return { settled: false }

  const remaining = await prisma.trainingSession.count({ where: { clientPackageId } })
  if (remaining > 0) return { settled: false }

  const updated = await prisma.invoice.updateMany({
    where: {
      trainerId,
      sourceType: 'PACKAGE',
      sourceId: clientPackageId,
      status: 'UNPAID',
    },
    data: { status: 'CANCELLED' },
  })
  return { settled: updated.count > 0 }
}
