'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/page-header'
import { Plus, GraduationCap, Users, ChevronRight } from 'lucide-react'
import { ClassFormModal } from './class-form-modal'

type RunRow = {
  id: string
  name: string
  scheduleNote: string | null
  startDate: string
  status: 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED'
  sessionCount: number
  enrolledCount: number
  capacity: number | null
}

const STATUS_STYLE: Record<RunRow['status'], string> = {
  SCHEDULED: 'bg-blue-50 text-blue-700',
  RUNNING: 'bg-emerald-50 text-emerald-700',
  COMPLETED: 'bg-slate-100 text-slate-600',
  CANCELLED: 'bg-red-50 text-red-600',
}

export function ClassesView({ runs }: { runs: RunRow[] }) {
  const router = useRouter()
  const [showCreate, setShowCreate] = useState(false)

  return (
    <>
      <PageHeader
        title="Classes"
        subtitle="Run a class — pick the day, time and how many weeks. Clients enrol into one shared timetable with a roster, capacity and waitlist."
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> New class
          </Button>
        }
      />

      <div className="p-4 md:p-8 w-full max-w-3xl md:max-w-5xl xl:max-w-7xl mx-auto">
      {runs.length === 0 ? (
        <Card>
          <CardBody>
            <div className="text-center py-10 px-4">
              <GraduationCap className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-600 font-medium">No classes yet</p>
              <p className="text-sm text-slate-400 mt-1 max-w-sm mx-auto">
                Create your first class — e.g. &ldquo;Puppy Class, Thursdays 4pm for 6 weeks&rdquo;.
              </p>
              <Button className="mt-4" onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4" /> New class
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {runs.map(r => (
            <Link key={r.id} href={`/classes/${r.id}`} className="block">
              <Card className="hover:border-blue-200 transition-colors">
                <CardBody className="py-4">
                  <div className="flex items-center gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600 flex-shrink-0">
                      <GraduationCap className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-slate-900 truncate">{r.name}</p>
                        <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_STYLE[r.status]}`}>
                          {r.status.toLowerCase()}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {new Date(r.startDate).toLocaleDateString()} ·{' '}
                        {r.scheduleNote || `${r.sessionCount} session${r.sessionCount === 1 ? '' : 's'}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-slate-600 flex-shrink-0">
                      <Users className="h-4 w-4 text-slate-400" />
                      {r.enrolledCount}
                      {r.capacity != null && <span className="text-slate-400">/ {r.capacity}</span>}
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
                  </div>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {showCreate && (
        <ClassFormModal
          mode="create"
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false)
            router.refresh()
          }}
        />
      )}
      </div>
    </>
  )
}
