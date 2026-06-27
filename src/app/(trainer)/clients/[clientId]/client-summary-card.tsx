import { PawPrint, Phone, Mail, CalendarDays, MapPin, Car, CalendarRange } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

// At-a-glance client summary shown alongside the profile tabs: the dog's photo
// as the hero, then the name, status and the handful of facts a trainer wants
// without digging into the Details tab — phone, email, join date, address,
// drive distance and a session count.

interface SummaryDog {
  name: string
  breed: string | null
  photoUrl: string | null
}

interface Props {
  name: string
  status: string
  dog: SummaryDog | null
  dogCount: number
  phone: string | null
  email: string | null
  clientSince: string
  address: string | null
  distanceFromBase: string | null
  sessionCount: number
}

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'Active', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  INACTIVE: { label: 'Inactive', cls: 'bg-slate-100 text-slate-500 ring-slate-200' },
  NEW: { label: 'New', cls: 'bg-blue-50 text-blue-700 ring-blue-200' },
}

function StatRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
      <div className="min-w-0">
        <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
        <dd className="text-sm text-slate-700 break-words">{value}</dd>
      </div>
    </div>
  )
}

export function ClientSummaryCard({
  name,
  status,
  dog,
  dogCount,
  phone,
  email,
  clientSince,
  address,
  distanceFromBase,
  sessionCount,
}: Props) {
  const statusMeta = STATUS_STYLES[status] ?? { label: status, cls: 'bg-slate-100 text-slate-500 ring-slate-200' }

  return (
    <Card className="overflow-hidden">
      {/* Dog photo hero — falls back to a branded paw tile when there's none. */}
      <div className="relative h-40 bg-gradient-to-br from-[#2A9DA9] to-[#1F818C]">
        {dog?.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dog.photoUrl} alt={dog.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <PawPrint className="h-12 w-12 text-white/70" />
          </div>
        )}
      </div>

      <div className="p-5">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-bold leading-tight text-slate-900">{name}</h2>
          <span className={cn('flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1', statusMeta.cls)}>
            {statusMeta.label}
          </span>
        </div>
        {dog && (
          <p className="mt-0.5 text-sm text-slate-500">
            {dog.name}
            {dog.breed ? ` · ${dog.breed}` : ''}
            {dogCount > 1 ? ` · +${dogCount - 1} more` : ''}
          </p>
        )}

        <dl className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4">
          {phone && <StatRow icon={Phone} label="Phone" value={phone} />}
          {email && <StatRow icon={Mail} label="Email" value={email} />}
          <StatRow icon={CalendarDays} label="Client since" value={clientSince} />
          {address && <StatRow icon={MapPin} label="Address" value={address} />}
          {distanceFromBase && <StatRow icon={Car} label="From base" value={distanceFromBase} />}
          <StatRow icon={CalendarRange} label="Sessions" value={String(sessionCount)} />
        </dl>
      </div>
    </Card>
  )
}
