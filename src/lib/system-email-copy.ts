import { prisma } from './prisma'
import { systemEmailDef } from './system-emails'

/**
 * The wording to actually send: whatever the trainer saved, else our default.
 *
 * Server-only, which is why it isn't in system-emails.ts — that file is the
 * registry and stays importable from a client component.
 *
 * Falls back to the default on ANY failure. A lookup problem must never stop
 * an email going out: the email is what the client is waiting for, and the
 * wording is the part that can safely be ours.
 */
export async function resolveSystemEmail(
  trainerId: string,
  key: string,
): Promise<{ subject: string; body: string }> {
  const def = systemEmailDef(key)
  const fallback = { subject: def?.defaultSubject ?? '', body: def?.defaultBody ?? '' }
  if (!def) return fallback
  try {
    // The invite keeps its long-standing home on the trainer's profile, where
    // three senders already read it.
    if (key === 'client_invite') {
      const p = await prisma.trainerProfile.findUnique({
        where: { id: trainerId },
        select: { inviteTemplate: true },
      })
      return p?.inviteTemplate?.trim() ? { subject: '', body: p.inviteTemplate } : fallback
    }
    const saved = await prisma.emailTemplate.findFirst({
      where: { trainerId, systemKey: key },
      select: { subject: true, body: true },
    })
    return saved ?? fallback
  } catch {
    return fallback
  }
}
