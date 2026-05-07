// Starter achievement set seeded per trainer when their TrainerOnboardingProgress
// row is created. Surfaces in wizard Step 5 ("Pick your achievements") where the
// trainer can keep, edit, or extend them. Picked to cover the main shapes of the
// trigger system — time-based, count-based, behavioural, and manual — so a new
// trainer sees what's possible without having to read docs.

import type { AchievementTrigger } from '@/generated/prisma'

export interface DefaultAchievement {
  name: string
  description: string
  icon: string
  color: string
  order: number
  // Seeded as drafts so the trainer reviews each one and publishes the ones
  // that fit their programme. The wizard step nudges them to do this.
  published: boolean
  triggerType: AchievementTrigger
  triggerValue: number | null
}

export const DEFAULT_ACHIEVEMENTS: DefaultAchievement[] = [
  {
    name: 'First Session',
    description: 'Completed their very first training session.',
    icon: '🐾',
    color: 'blue',
    order: 1,
    triggerType: 'FIRST_SESSION',
    triggerValue: null,
    published: false,
  },
  {
    name: '5 Sessions Together',
    description: 'Five training sessions complete — this dog is on the way.',
    icon: '⭐',
    color: 'amber',
    order: 2,
    triggerType: 'SESSIONS_COMPLETED',
    triggerValue: 5,
    published: false,
  },
  {
    name: 'First Homework Done',
    description: 'Completed their first piece of training homework at home.',
    icon: '📓',
    color: 'sky',
    order: 3,
    triggerType: 'FIRST_HOMEWORK_DONE',
    triggerValue: null,
    published: false,
  },
  {
    name: 'Perfect Week',
    description: 'Finished every assigned homework task for a full week.',
    icon: '🏆',
    color: 'violet',
    order: 4,
    triggerType: 'PERFECT_WEEK',
    triggerValue: 1,
    published: false,
  },
  {
    name: '1 Month Together',
    description: 'One month of training together — habits forming.',
    icon: '📅',
    color: 'emerald',
    order: 5,
    triggerType: 'CLIENT_ANNIVERSARY_DAYS',
    triggerValue: 30,
    published: false,
  },
  {
    name: 'Loose Leash Walking',
    description: 'Mastered walking calmly on a loose leash. Awarded by trainer.',
    icon: '🦮',
    color: 'rose',
    order: 6,
    triggerType: 'MANUAL',
    triggerValue: null,
    published: false,
  },
]
