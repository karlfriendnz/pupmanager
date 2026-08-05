import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { clientLabelFor, sanitizeNavLabels } from '@/lib/nav-labels'
import { Card, CardBody } from '@/components/ui/card'
import { ClientSupportForm } from './client-support-form'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Help' }

/**
 * The answers a confused client is sent here for.
 *
 * Written against the app as it actually is. The old set described "My Diary",
 * a circle you tapped to tick a task off, and an "Email reminders" toggle on a
 * screen called My Profile — none of which had existed for a long time (audit
 * C-6). Screen names come from the trainer's own menu labels rather than being
 * hard-coded, because a trainer can rename any of them.
 */
function faqFor(label: (href: string, fallback: string) => string) {
  const home = label('/home', 'Home')
  const offerings = label('/my-availability', 'Offerings')
  const invoices = label('/my-invoices', 'Invoices')
  const messages = label('/my-messages', 'Messages')
  // Dogs and notifications each have their own screen now; they used to be
  // tabs on My details, and the answers below said so (audit C-6 all over
  // again). Derived from the menu, so a rename carries.
  const dogs = label('/my-dogs', 'My dogs')
  const notifications = label('/my-notifications', 'Notifications')
  return [
    {
      q: 'How do I log my training at home?',
      a: `Open ${home}. Your homework is listed there. Tap the one you did, then tap “Log a session” and say how it went. You can add photos.`,
    },
    {
      q: 'Why is there no homework for me?',
      a: `Your trainer sets homework after a session, so there may not be any yet. If you think something is missing, send them a message from ${messages}.`,
    },
    {
      q: 'How do I book my next session?',
      a: `Go to ${offerings}. It lists everything your trainer offers and what you can book right now.`,
    },
    {
      q: 'Where do I see what I owe?',
      a: `${invoices} shows every invoice, what has been paid, and what is still due.`,
    },
    {
      q: 'How do I change what you email me?',
      a: `Open ${notifications} and pick Settings. You can turn each kind of message on or off.`,
    },
    {
      q: 'How do I add another dog?',
      a: `Open ${dogs} and tap “Add a dog”. Add as many as you need — your trainer sees them all.`,
    },
  ]
}

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
          showPhoneToClients: true,
          // The trainer's own menu wording, so the answers name the screens the
          // client is actually looking at.
          navLabels: true,
          // Company contact email shown to clients — NOT the trainer's private
          // sign-in email.
          publicEmail: true,
        },
      },
    },
  })

  const trainer = clientProfile?.trainer
  const labels = sanitizeNavLabels(trainer?.navLabels)
  const FAQ = faqFor((href, fallback) => clientLabelFor(href, fallback, labels))

  return (
    <div className="px-5 lg:px-8 py-6 max-w-3xl mx-auto w-full">
      <h1 className="text-2xl font-bold text-slate-900 mb-8">Help</h1>

      {/* Trainer contact — HELP-03 */}
      {trainer && (
        <div className="mb-8">
          <h2 className="font-semibold text-slate-900 mb-3">Get in touch</h2>
          <Card>
            <CardBody className="pt-4 pb-4">
              <p className="font-medium text-slate-900">{trainer.businessName}</p>
              {trainer.publicEmail && (
                <a
                  href={`mailto:${trainer.publicEmail}`}
                  className="flex items-center gap-2 text-sm text-blue-600 hover:underline mt-2"
                >
                  ✉️ {trainer.publicEmail}
                </a>
              )}
              {trainer.showPhoneToClients && trainer.phone && (
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
