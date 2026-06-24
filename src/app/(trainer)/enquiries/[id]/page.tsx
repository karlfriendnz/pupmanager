import { redirect, notFound } from 'next/navigation'
import { after } from 'next/server'
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
  // Deferred to after() — it's a side effect that doesn't change this render.
  if (!enquiry.viewedAt) {
    after(() => prisma.enquiry.update({ where: { id }, data: { viewedAt: new Date() } }).catch(() => {}))
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

  // Format the requested booking slot (if any) in the trainer's timezone.
  let bookedLabel: string | null = null
  if (enquiry.bookedSlotAt) {
    const trainerUser = await prisma.trainerProfile.findUnique({
      where: { id: trainerId },
      select: { user: { select: { timezone: true } } },
    })
    const tz = trainerUser?.user.timezone ?? 'UTC'
    bookedLabel = new Intl.DateTimeFormat('en-NZ', {
      timeZone: tz, weekday: 'long', day: 'numeric', month: 'long',
      hour: 'numeric', minute: '2-digit',
    }).format(enquiry.bookedSlotAt)
  }

  return (
    <>
      <PageHeader
        title="Enquiry"
        subtitle={`Submitted ${enquiry.createdAt.toLocaleString()}${enquiry.form ? ` via "${enquiry.form.title}"` : ''}`}
        back={{ href: '/enquiries', label: 'Back to enquiries' }}
        actions={<StatusPill status={enquiry.status} />}
      />
      <div className="p-4 md:p-8 w-full max-w-3xl md:max-w-5xl xl:max-w-7xl mx-auto">

      {bookedLabel && (
        <Card className="p-5 mb-4 border-violet-200 bg-violet-50/50">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-violet-600 mb-1">Requested booking</h2>
          <p className="text-sm font-semibold text-slate-900">{bookedLabel}</p>
          <p className="text-xs text-slate-500 mt-1">
            {enquiry.status === 'NEW'
              ? 'Accepting this enquiry will add the session to your calendar.'
              : enquiry.status === 'ACCEPTED'
                ? 'The session was added to your calendar.'
                : 'This time was not booked.'}
          </p>
        </Card>
      )}

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
                {m.bodyHtml
                  ? <div className="tiptap-body tiptap-light text-sm text-slate-700" dangerouslySetInnerHTML={{ __html: m.bodyHtml }} />
                  : <p className="text-sm text-slate-700 whitespace-pre-wrap">{m.bodyText}</p>}
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
