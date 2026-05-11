import { redirect } from 'next/navigation'

// The dedicated per-client thread page is collapsed into /messages?client=…
// (split-pane layout). This stub keeps existing deep links from push
// notifications, session pages, etc. working — it just bounces to the
// combined URL.
export default async function TrainerMessageThreadPage({
  params,
}: {
  params: Promise<{ clientId: string }>
}) {
  const { clientId } = await params
  redirect(`/messages?client=${clientId}`)
}
