import { Card, CardBody } from '@/components/ui/card'
import { SupportTicketForm } from './support-ticket-form'
import { PageHeader } from '@/components/shared/page-header'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Help & Support' }

const FAQ = [
  {
    category: 'Getting started',
    items: [
      { q: 'How do I invite a client?', a: 'Go to Clients → Invite client. Enter their name, dog\'s name, and email. You can customise the invitation email before sending.' },
      { q: 'How do I assign training tasks?', a: 'Go to Training Diary, select a client and date, then click "Add task". Tasks immediately appear in the client\'s diary view.' },
    ],
  },
  {
    category: 'Clients & compliance',
    items: [
      { q: 'What does the compliance percentage mean?', a: 'It\'s the percentage of assigned tasks that a client has marked as complete over the past 7 days.' },
      { q: 'Can I share a client with another trainer?', a: 'Yes — open the client\'s profile and tap Share. You can grant read-only access or fully transfer them.' },
    ],
  },
  {
    category: 'Billing & account',
    items: [
      { q: 'How do I upgrade my plan?', a: 'Go to Settings → Subscription to view available plans and upgrade.' },
      { q: 'Can I cancel my account?', a: 'Yes — go to Settings → Danger zone → Delete my account. This is permanent and removes all data.' },
    ],
  },
]

export default function TrainerHelpPage() {
  return (
    <>
      <PageHeader title="Help & Support" />
      <div className="p-4 md:p-8 w-full max-w-2xl mx-auto">
      <div className="mb-8" />

      {/* FAQ */}
      <div className="mb-10">
        <h2 className="font-semibold text-slate-900 mb-4">Frequently asked questions</h2>
        <div className="flex flex-col gap-6">
          {FAQ.map((section) => (
            <div key={section.category}>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">{section.category}</p>
              <div className="flex flex-col gap-2">
                {section.items.map((item) => (
                  <FaqItem key={item.q} q={item.q} a={item.a} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Support ticket */}
      <div className="mb-10">
        <h2 className="font-semibold text-slate-900 mb-4">Submit a support ticket</h2>
        <SupportTicketForm type="support" />
      </div>

      {/* Feedback */}
      <div>
        <h2 className="font-semibold text-slate-900 mb-4">Share feedback or ideas</h2>
        <SupportTicketForm type="feedback" />
      </div>
      </div>
    </>
  )
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <Card>
      <CardBody className="pt-4 pb-4">
        <p className="font-medium text-slate-900 text-sm mb-1">{q}</p>
        <p className="text-sm text-slate-600">{a}</p>
      </CardBody>
    </Card>
  )
}
