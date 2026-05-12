import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Card } from '@/components/ui/card'
import { EnquiryActions } from './enquiry-actions'
import { PageHeader } from '@/components/shared/page-header'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Enquiry' }

export default async function EnquiryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const { id } = await params

  const enquiry = await prisma.enquiry.findFirst({
    where: { id, trainerId },
    include: {
      form: { select: { title: true } },
      messages: { orderBy: { createdAt: 'asc' } },
      clientProfile: { select: { id: true } },
    },
  })
  if (!enquiry) notFound()

  // First-view: clear the dashboard badge as soon as the trainer opens it.
  if (!enquiry.viewedAt) {
    await prisma.enquiry.update({ where: { id }, data: { viewedAt: new Date() } })
  }

  // Resolve labels for snapshotted custom-field answers.
  const customSnap = (enquiry.customFieldValues ?? {}) as Record<string, string>
  const fieldIds = Object.keys(customSnap)
  const fields = fieldIds.length
    ? await prisma.customField.findMany({
        where: { id: { in: fieldIds } },
        select: { id: true, label: true },
      })
    : []
  const labelById = Object.fromEntries(fields.map(f => [f.id, f.label]))

  return (
    <>
      <PageHeader
        title="Enquiry"
        subtitle={`Submitted ${enquiry.createdAt.toLocaleString()}${enquiry.form ? ` via "${enquiry.form.title}"` : ''}`}
        back={{ href: '/enquiries', label: 'Back to enquiries' }}
        actions={<StatusPill status={enquiry.status} />}
      />
      <div className="p-4 md:p-8 w-full max-w-3xl md:max-w-5xl xl:max-w-7xl mx-auto">

      <Card className="p-5 mb-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Contact</h2>
        <Field label="Name" value={enquiry.name} />
        <Field label="Email" value={<a href={`mailto:${enquiry.email}`} className="text-violet-700 hover:underline">{enquiry.email}</a>} />
        {enquiry.phone && <Field label="Phone" value={<a href={`tel:${enquiry.phone}`} className="text-violet-700 hover:underline">{enquiry.phone}</a>} />}
      </Card>

      {(enquiry.dogName || enquiry.dogBreed || enquiry.dogWeight || enquiry.dogDob) && (
        <Card className="p-5 mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Dog</h2>
          {enquiry.dogName && <Field label="Name" value={enquiry.dogName} />}
          {enquiry.dogBreed && <Field label="Breed" value={enquiry.dogBreed} />}
          {enquiry.dogWeight != null && <Field label="Weight" value={`${enquiry.dogWeight} kg`} />}
          {enquiry.dogDob && <Field label="Date of birth" value={enquiry.dogDob.toLocaleDateString()} />}
        </Card>
      )}

      {enquiry.message && (
        <Card className="p-5 mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Message</h2>
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{enquiry.message}</p>
        </Card>
      )}

      {fields.length > 0 && (
        <Card className="p-5 mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Other</h2>
          {fields.map(f => (
            <Field key={f.id} label={labelById[f.id] ?? f.id} value={customSnap[f.id]} />
          ))}
        </Card>
      )}

      {enquiry.messages.length > 0 && (
        <Card className="p-5 mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Replies sent</h2>
          <div className="flex flex-col gap-3">
            {enquiry.messages.map(m => (
              <div key={m.id} className="border-l-2 border-violet-200 pl-3">
                <p className="text-xs text-slate-500 mb-1">
                  {m.createdAt.toLocaleString()} · {m.subject}
                </p>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{m.bodyText}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <EnquiryActions
        enquiryId={enquiry.id}
        status={enquiry.status}
        clientProfileId={enquiry.clientProfile?.id ?? null}
        defaultSubject={`Re: your enquiry${enquiry.dogName ? ` about ${enquiry.dogName}` : ''}`}
        defaultGreeting={`Hi ${enquiry.name.split(' ')[0]},`}
      />
      </div>
    </>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-500 flex-shrink-0">{label}</span>
      <span className="text-sm text-slate-800 text-right truncate min-w-0">{value}</span>
    </div>
  )
}

function StatusPill({ status }: { status: 'NEW' | 'ACCEPTED' | 'DECLINED' | 'ARCHIVED' }) {
  const meta = {
    NEW:      { label: 'New',      cls: 'bg-violet-100 text-violet-700' },
    ACCEPTED: { label: 'Accepted', cls: 'bg-emerald-100 text-emerald-700' },
    DECLINED: { label: 'Declined', cls: 'bg-slate-100 text-slate-500' },
    ARCHIVED: { label: 'Archived', cls: 'bg-slate-100 text-slate-500' },
  }[status]
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${meta.cls}`}>{meta.label}</span>
}
