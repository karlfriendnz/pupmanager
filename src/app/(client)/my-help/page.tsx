import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { Card, CardBody } from '@/components/ui/card'
import { ClientSupportForm } from './client-support-form'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Help' }

const FAQ = [
  { q: 'How do I log my training?', a: 'Open "My Diary", find today\'s tasks, and tap the circle next to each task to mark it complete. You can also add a note or video link.' },
  { q: 'Why can\'t I see my tasks?', a: 'Your trainer assigns tasks each day. If nothing appears, check that you\'re viewing today\'s date or contact your trainer.' },
  { q: 'How do I upload a video of my dog?', a: 'After completing a task, tap "Add a note or video". You can paste a YouTube link or upload a video directly from your device.' },
  { q: 'How do I change my notification settings?', a: 'Go to My Profile and toggle "Email reminders" on or off.' },
]

export default async function ClientHelpPage() {
  const active = await getActiveClient()
  if (!active) redirect('/login')

  // HELP-03: show trainer contact details. Prisma rejects `select` and
  // `include` on the same relation so we hoist the user select into the
  // trainer's select block.
  const clientProfile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    include: {
      trainer: {
        select: {
          businessName: true,
          phone: true,
          user: { select: { email: true } },
        },
      },
    },
  })

  const trainer = clientProfile?.trainer

  return (
    <div className="px-5 lg:px-8 py-6 max-w-3xl mx-auto w-full">
      <h1 className="text-2xl font-bold text-slate-900 mb-8">Help</h1>

      {/* Trainer contact — HELP-03 */}
      {trainer && (
        <div className="mb-8">
          <h2 className="font-semibold text-slate-900 mb-3">Contact your trainer</h2>
          <Card>
            <CardBody className="pt-4 pb-4">
              <p className="font-medium text-slate-900">{trainer.businessName}</p>
              {trainer.user.email && (
                <a
                  href={`mailto:${trainer.user.email}`}
                  className="flex items-center gap-2 text-sm text-blue-600 hover:underline mt-2"
                >
                  ✉️ {trainer.user.email}
                </a>
              )}
              {trainer.phone && (
                <a
                  href={`tel:${trainer.phone}`}
                  className="flex items-center gap-2 text-sm text-blue-600 hover:underline mt-1"
                >
                  📞 {trainer.phone}
                </a>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {/* FAQ — HELP-01 */}
      <div className="mb-8">
        <h2 className="font-semibold text-slate-900 mb-3">Frequently asked questions</h2>
        <div className="flex flex-col gap-2">
          {FAQ.map((item) => (
            <Card key={item.q}>
              <CardBody className="pt-4 pb-4">
                <p className="font-medium text-slate-900 text-sm mb-1">{item.q}</p>
                <p className="text-sm text-slate-600">{item.a}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      </div>

      {/* Support ticket — HELP-02 & HELP-04 */}
      <div>
        <h2 className="font-semibold text-slate-900 mb-3">Get help or share feedback</h2>
        <ClientSupportForm />
      </div>
    </div>
  )
}
