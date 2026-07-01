import { prisma } from '@/lib/prisma'
import { isXeroConfigured } from '@/lib/xero'
import { XeroConnectionCard } from './xero-connection-card'

// Settings → Xero tab. Only rendered when the Xero add-on is enabled (gated in
// page.tsx via hasAddon). Holds the connection card + account/tax mapping.
export async function XeroTab({ companyId }: { companyId: string }) {
  const xero = await prisma.xeroConnection.findUnique({
    where: { trainerId: companyId },
    select: { tenantName: true },
  })

  return (
    <div className="w-full max-w-2xl">
      <XeroConnectionCard
        connected={!!xero}
        orgName={xero?.tenantName ?? null}
        configured={isXeroConfigured()}
      />
    </div>
  )
}
