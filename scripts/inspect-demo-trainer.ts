import { PrismaClient } from '../src/generated/prisma'

const prisma = new PrismaClient()

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: 'trainer@demo.co.nz' },
    include: {
      trainerProfile: {
        include: {
          _count: {
            select: {
              clients: true,
              embedForms: true,
              sessionForms: true,
              packages: true,
              achievements: true,
              trainingSessions: true,
            },
          },
        },
      },
    },
  })

  if (!user || !user.trainerProfile) {
    console.log('Demo trainer not found')
    return
  }

  const tp = user.trainerProfile
  console.log('Demo trainer:')
  console.log('  email           :', user.email)
  console.log('  trainerId       :', tp.id)
  console.log('  businessName    :', tp.businessName)
  console.log('  profile created :', tp.createdAt.toISOString())
  console.log('  age (hours)     :', Math.round((Date.now() - tp.createdAt.getTime()) / 3_600_000))
  console.log('  clients         :', tp._count.clients)
  console.log('  embed forms     :', tp._count.embedForms)
  console.log('  session forms   :', tp._count.sessionForms)
  console.log('  packages        :', tp._count.packages)
  console.log('  achievements    :', tp._count.achievements)
  console.log('  sessions        :', tp._count.trainingSessions)

  const progress = await prisma.trainerOnboardingProgress.findUnique({
    where: { trainerId: tp.id },
    include: { _count: { select: { steps: true, emails: true } } },
  })
  console.log('\nOnboarding progress:')
  if (!progress) {
    console.log('  (none — would init on next dashboard load)')
  } else {
    console.log('  startedAt       :', progress.startedAt.toISOString())
    console.log('  ahaReachedAt    :', progress.ahaReachedAt?.toISOString() ?? '(null)')
    console.log('  backfilledAt    :', progress.backfilledAt?.toISOString() ?? '(null)')
    console.log('  dismissedAt     :', progress.checklistDismissedAt?.toISOString() ?? '(null)')
    console.log('  step rows       :', progress._count.steps)
    console.log('  email send log  :', progress._count.emails)
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
