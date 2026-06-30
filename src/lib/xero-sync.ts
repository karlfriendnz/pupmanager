import { prisma } from '@/lib/prisma'
import { ensureXeroContact } from '@/lib/xero'

// Higher-level Xero sync orchestrators that load app data, call the low-level
// client in @/lib/xero, and persist the resulting Xero ids back. Phase 3's
// invoice push builds on ensureClientXeroContact to attach invoices to a contact.

/**
 * Ensure the client has a matching Xero Contact in their trainer's org and
 * return its ContactID. The id is persisted on the ClientProfile on first sync,
 * so subsequent calls are a no-op lookup.
 *
 * Returns null when there's nothing to do (client gone, or the trainer hasn't
 * connected Xero). Throws if the Xero API call itself fails, so the caller can
 * decide whether to surface or swallow.
 */
export async function ensureClientXeroContact(clientId: string): Promise<string | null> {
  const client = await prisma.clientProfile.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      xeroContactId: true,
      phone: true,
      user: { select: { name: true, email: true } },
      trainer: { select: { xeroConnection: true } },
    },
  })
  if (!client) return null
  if (client.xeroContactId) return client.xeroContactId

  const connection = client.trainer.xeroConnection
  if (!connection) return null

  const name = client.user.name?.trim() || client.user.email || 'Client'
  const contactId = await ensureXeroContact(connection, {
    name,
    email: client.user.email,
    phone: client.phone,
  })

  await prisma.clientProfile.update({
    where: { id: client.id },
    data: { xeroContactId: contactId },
  })
  return contactId
}
