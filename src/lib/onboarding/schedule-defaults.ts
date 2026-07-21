import type { PrismaClient } from '@/generated/prisma'

// Sensible starting availability + schedule-grid hours per trade, so a new
// trainer's calendar and booking page aren't blank. Windows with two entries
// bake in a lunch break (a groomer breaks midday; a walker works straight
// through). dayOfWeek is 1=Mon … 7=Sun. All of this is editable in Settings.

export interface ScheduleDefault {
  days: number[]
  windows: Array<{ start: string; end: string }>
  gridStart: number
  gridEnd: number
}

const MON_SAT = [1, 2, 3, 4, 5, 6]
const MON_FRI = [1, 2, 3, 4, 5]
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7]

const SCHEDULE_BY_ROLE: Record<string, ScheduleDefault> = {
  // Trainers run evening classes; lunch break midday.
  trainer: { days: MON_SAT, windows: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '19:00' }], gridStart: 8, gridEnd: 20 },
  behaviourist: { days: MON_FRI, windows: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '18:00' }], gridStart: 8, gridEnd: 19 },
  // Puppy schools run weekday evening + weekend-morning classes.
  puppyschool: { days: MON_SAT, windows: [{ start: '09:00', end: '12:00' }, { start: '16:00', end: '20:00' }], gridStart: 8, gridEnd: 21 },
  // Walkers work straight through — walks happen over lunchtime.
  walker: { days: MON_FRI, windows: [{ start: '07:00', end: '18:00' }], gridStart: 6, gridEnd: 19 },
  // Groomers take a midday lunch between appointments.
  groomer: { days: MON_SAT, windows: [{ start: '08:00', end: '12:30' }, { start: '13:30', end: '17:00' }], gridStart: 7, gridEnd: 18 },
  // Sitters cover the whole day, any day.
  petsitter: { days: EVERY_DAY, windows: [{ start: '07:00', end: '19:00' }], gridStart: 6, gridEnd: 21 },
}

const DEFAULT_SCHEDULE: ScheduleDefault = {
  days: MON_FRI,
  windows: [{ start: '09:00', end: '17:00' }],
  gridStart: 7,
  gridEnd: 21,
}

// The schedule default for a set of roles — the first matching trade wins (a
// mixed trainer+groomer gets the trainer's rhythm), else a plain 9–5.
export function scheduleDefaultsForRoles(roles: string[]): ScheduleDefault {
  for (const r of roles) {
    if (SCHEDULE_BY_ROLE[r]) return SCHEDULE_BY_ROLE[r]
  }
  return DEFAULT_SCHEDULE
}

// Seed a fresh trainer's availability + grid hours from their trade. Idempotent
// by design: does nothing if they already have any availability, so it never
// clobbers hours they've set themselves.
export async function seedScheduleDefaultsForRoles(prisma: PrismaClient, trainerId: string, roles: string[]): Promise<void> {
  const existing = await prisma.availabilitySlot.count({ where: { trainerId } })
  if (existing > 0) return
  const cfg = scheduleDefaultsForRoles(roles)
  const rows = cfg.days.flatMap(dow =>
    cfg.windows.map(w => ({ trainerId, dayOfWeek: dow, startTime: w.start, endTime: w.end, title: 'Working hours' })),
  )
  await prisma.$transaction([
    prisma.availabilitySlot.createMany({ data: rows }),
    prisma.trainerProfile.update({
      where: { id: trainerId },
      data: { scheduleStartHour: cfg.gridStart, scheduleEndHour: cfg.gridEnd },
    }),
  ])
}
