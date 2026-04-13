'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/utils'
import { Users } from 'lucide-react'

type Field = { id: string; label: string; type: string }
type Section = { id: string; title: string; fields: Field[] }
type Lead = {
  id: string
  name: string | null
  email: string | null
  dogName: string | null
  status: string
  answers: unknown
  submittedAt: string
}

type Form = {
  id: string
  sections: Section[]
  submissions: Lead[]
}

const STATUS_LABELS: Record<string, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  ARCHIVED: 'Archived',
  REJECTED: 'Rejected',
  CONVERTED: 'Converted',
}

const STATUS_STYLES: Record<string, string> = {
  NEW: 'bg-blue-50 text-blue-700',
  CONTACTED: 'bg-amber-50 text-amber-700',
  ARCHIVED: 'bg-slate-100 text-slate-500',
  REJECTED: 'bg-red-50 text-red-600',
  CONVERTED: 'bg-green-50 text-green-700',
}

export function LeadsDashboard({ form }: { form: Form }) {
  const router = useRouter()
  const [leads, setLeads] = useState(form.submissions)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState<string | null>(null)

  const allFields = form.sections.flatMap(s => s.fields)

  function getAnswer(lead: Lead, fieldId: string): string {
    const answers = Array.isArray(lead.answers) ? lead.answers as { fieldId: string; value: string | string[] }[] : []
    const ans = answers.find(a => a.fieldId === fieldId)
    if (!ans) return '—'
    return Array.isArray(ans.value) ? ans.value.join(', ') : ans.value || '—'
  }

  async function updateStatus(leadId: string, status: string) {
    setLoading(leadId)
    const res = await fetch(`/api/forms/${form.id}/leads/${leadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status } : l))
    }
    setLoading(null)
  }

  async function convertLead(leadId: string) {
    setLoading(leadId)
    const res = await fetch(`/api/forms/${form.id}/leads/${leadId}`, {
      method: 'POST',
    })
    if (res.ok) {
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: 'CONVERTED' } : l))
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      alert(data.error ?? 'Failed to convert lead.')
    }
    setLoading(null)
  }

  if (leads.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
        <p className="font-medium text-slate-500">No submissions yet</p>
        <p className="text-sm mt-1">Share your form link or embed it on your website to start receiving enquiries.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {leads.map(lead => (
        <Card key={lead.id}>
          <CardBody className="pt-4 pb-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-slate-900">{lead.name ?? 'Unknown'}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[lead.status] ?? ''}`}>
                    {STATUS_LABELS[lead.status] ?? lead.status}
                  </span>
                </div>
                <p className="text-sm text-slate-500">{lead.email ?? 'No email'}{lead.dogName ? ` · 🐕 ${lead.dogName}` : ''}</p>
                <p className="text-xs text-slate-400 mt-0.5">Submitted {formatDate(lead.submittedAt)}</p>
              </div>

              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => setExpanded(expanded === lead.id ? null : lead.id)}
                  className="text-sm text-blue-600 hover:underline"
                >
                  {expanded === lead.id ? 'Hide' : 'View answers'}
                </button>
              </div>
            </div>

            {expanded === lead.id && (
              <div className="mt-4 border-t border-slate-100 pt-4 flex flex-col gap-3">
                {allFields.map(field => (
                  <div key={field.id}>
                    <p className="text-xs font-medium text-slate-500">{field.label}</p>
                    <p className="text-sm text-slate-800 mt-0.5">{getAnswer(lead, field.id)}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Actions */}
            {lead.status !== 'CONVERTED' && lead.status !== 'REJECTED' && (
              <div className="flex gap-2 mt-3 flex-wrap">
                {lead.status !== 'CONTACTED' && (
                  <Button size="sm" variant="secondary" loading={loading === lead.id} onClick={() => updateStatus(lead.id, 'CONTACTED')}>
                    Mark contacted
                  </Button>
                )}
                {lead.email && (
                  <Button size="sm" loading={loading === lead.id} onClick={() => convertLead(lead.id)}>
                    Accept — convert to client
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="text-slate-400" loading={loading === lead.id} onClick={() => updateStatus(lead.id, 'ARCHIVED')}>
                  Archive
                </Button>
                <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-600" loading={loading === lead.id} onClick={() => updateStatus(lead.id, 'REJECTED')}>
                  Reject
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  )
}
