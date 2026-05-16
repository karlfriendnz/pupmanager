import { prisma } from '@/lib/prisma'
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/lib/demo-seed'
import { DemoSeedControls } from './demo-seed-controls'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Admin · Demo data' }

// Surfaces the seed / reset controls and a live count of what's currently
// in the demo trainer's data — so the admin can confirm the action did
// what they expected without leaving the page.
export default async function AdminDemoPage() {
  const trainer = await prisma.trainerProfile.findFirst({
    where: { user: { email: DEMO_EMAIL } },
    select: { id: true, businessName: true, createdAt: true },
  })

  const counts = trainer
    ? await Promise.all([
        prisma.clientProfile.count({ where: { trainerId: trainer.id } }),
        prisma.package.count({ where: { trainerId: trainer.id } }),
        prisma.trainingSession.count({ where: { trainerId: trainer.id } }),
        prisma.libraryType.count({ where: { trainerId: trainer.id } }),
        prisma.product.count({ where: { trainerId: trainer.id } }),
        prisma.achievement.count({ where: { trainerId: trainer.id } }),
        prisma.enquiry.count({ where: { trainerId: trainer.id } }),
      ])
    : [0, 0, 0, 0, 0, 0, 0]

  const stats = [
    { label: 'Clients',      value: counts[0] },
    { label: 'Packages',     value: counts[1] },
    { label: 'Sessions',     value: counts[2] },
    { label: 'Library types', value: counts[3] },
    { label: 'Products',     value: counts[4] },
    { label: 'Achievements', value: counts[5] },
    { label: 'Enquiries',    value: counts[6] },
  ]

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Demo data</h1>
        <p className="text-slate-400 text-sm mt-1">
          Manage the demo trainer&apos;s data so live demos always start from a populated, predictable state.
        </p>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 mb-6">
        <h2 className="font-semibold text-slate-200 mb-2">Demo trainer</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
          <div className="flex justify-between sm:block">
            <dt className="text-slate-400">Email</dt>
            <dd className="font-mono">{DEMO_EMAIL}</dd>
          </div>
          <div className="flex justify-between sm:block">
            <dt className="text-slate-400">Password</dt>
            <dd className="font-mono">{DEMO_PASSWORD}</dd>
          </div>
          <div className="flex justify-between sm:block">
            <dt className="text-slate-400">Business name</dt>
            <dd>{trainer?.businessName || <span className="text-slate-500">— not set —</span>}</dd>
          </div>
          <div className="flex justify-between sm:block">
            <dt className="text-slate-400">Status</dt>
            <dd>{trainer ? 'Provisioned' : 'Not yet provisioned'}</dd>
          </div>
        </dl>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        {stats.map(s => (
          <div key={s.label} className="bg-slate-800 border border-slate-700 rounded-xl p-3">
            <p className="text-2xl font-bold tabular-nums">{s.value}</p>
            <p className="text-[11px] text-slate-400 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <DemoSeedControls />

      <div className="mt-8 text-xs text-slate-500 space-y-1">
        <p><strong className="text-slate-400">Seed</strong> wipes the demo trainer&apos;s data and rebuilds ~50 clients + supporting records.</p>
        <p><strong className="text-slate-400">Reset</strong> wipes only — useful before a demo when you want a clean slate to walk through onboarding.</p>
        <p>From a terminal: <code className="bg-slate-800 px-1.5 py-0.5 rounded">npm run db:seed-demo</code> · <code className="bg-slate-800 px-1.5 py-0.5 rounded">npm run db:reset-demo</code></p>
      </div>
    </div>
  )
}
