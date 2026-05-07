import { PrismaClient } from '../src/generated/prisma'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // Admin user
  const adminEmail = 'admin@pupmanager.app'
  const existing = await prisma.user.findUnique({ where: { email: adminEmail } })

  if (!existing) {
    const hash = await bcrypt.hash('admin1234', 12)
    const admin = await prisma.user.create({
      data: {
        name: 'Platform Admin',
        email: adminEmail,
        role: 'ADMIN',
        emailVerified: new Date(),
      },
    })
    await prisma.account.create({
      data: {
        userId: admin.id,
        type: 'credentials',
        provider: 'credentials',
        providerAccountId: hash,
      },
    })
    console.log('Created admin user:', adminEmail)
  }

  // Demo trainer
  const trainerEmail = 'trainer@demo.co.nz'
  const existingTrainer = await prisma.user.findUnique({ where: { email: trainerEmail } })

  if (!existingTrainer) {
    const hash = await bcrypt.hash('trainer1234', 12)
    const trainer = await prisma.user.create({
      data: {
        name: 'Sam Trainer',
        email: trainerEmail,
        role: 'TRAINER',
        emailVerified: new Date(),
      },
    })
    await prisma.account.create({
      data: {
        userId: trainer.id,
        type: 'credentials',
        provider: 'credentials',
        providerAccountId: hash,
      },
    })
    await prisma.trainerProfile.create({
      data: {
        userId: trainer.id,
        businessName: 'Pawsome Dog Training',
      },
    })
    console.log('Created demo trainer:', trainerEmail)
  }

  // Subscription plans
  const plans = [
    { name: 'Starter', priceMonthly: 0, maxClients: 3, description: 'Perfect for getting started' },
    { name: 'Pro', priceMonthly: 29, maxClients: 25, description: 'For growing trainers' },
    { name: 'Unlimited', priceMonthly: 79, maxClients: null, description: 'No limits' },
  ]

  for (const plan of plans) {
    await prisma.subscriptionPlan.upsert({
      where: { id: plan.name.toLowerCase() },
      create: { id: plan.name.toLowerCase(), ...plan },
      update: plan,
    })
  }

  await seedOnboarding()

  console.log('Seed complete.')
}

// ─── Onboarding ──────────────────────────────────────────────────────────────
// Seeds the 7 wizard steps and 6 drip emails. Idempotent. publishedAt is only
// set on create — re-seeding never re-publishes content the admin unpublished.

async function seedOnboarding() {
  for (const step of ONBOARDING_STEPS) {
    await prisma.onboardingStep.upsert({
      where: { key: step.key },
      create: { ...step, publishedAt: new Date() },
      update: step,
    })
  }

  for (const email of ONBOARDING_EMAILS) {
    await prisma.onboardingEmail.upsert({
      where: { key: email.key },
      create: { ...email, publishedAt: new Date() },
      update: email,
    })
  }

  console.log(`Seeded ${ONBOARDING_STEPS.length} onboarding steps + ${ONBOARDING_EMAILS.length} emails`)
}

const ONBOARDING_STEPS = [
  {
    key: 'business_profile',
    order: 1,
    title: 'Set up your business profile',
    body: 'Add your business name, phone, and logo. Your clients see this on every screen.',
    ctaLabel: 'Add business details',
    ctaHref: '/settings',
    skippable: true,
    skipWarning: null,
  },
  {
    key: 'intake_form',
    order: 2,
    title: 'Review your forms',
    body: "Take a look at your contact, intake, and session forms. Make sure each one asks for the info you actually need before clients start submitting them.",
    ctaLabel: 'Review forms',
    ctaHref: '/settings#forms',
    skippable: true,
    skipWarning: null,
  },
  {
    key: 'program_package',
    order: 3,
    title: 'Add a program or package',
    body: 'Describe one of your training programs so clients know what they\'re signing up for. Optional — you can do this later.',
    ctaLabel: 'Add a package',
    ctaHref: '/packages',
    skippable: true,
    skipWarning: null,
  },
  {
    key: 'achievements',
    order: 4,
    title: 'Pick your achievements',
    body: 'We\'ve set up some sensible defaults — keep them, edit, or add your own.',
    ctaLabel: 'Review achievements',
    ctaHref: '/achievements',
    skippable: true,
    skipWarning: null,
  },
  {
    key: 'client_view',
    order: 5,
    title: 'See it from your client\'s side',
    body: 'Pop into the sample client account (Sarah & Bailey) to see exactly what your real clients will experience.',
    ctaLabel: 'Preview as client',
    ctaHref: '/preview-as',
    skippable: true,
    skipWarning: null,
  },
  {
    key: 'invite_client',
    order: 6,
    title: 'Invite your first client',
    body: 'The moment this all starts paying off. Send an invite by email, SMS, or QR code.',
    ctaLabel: 'Invite a client',
    ctaHref: '/clients',
    skippable: true,
    skipWarning: 'Without inviting your first client, you won\'t reach the moment PupManager actually starts saving you time. Skip anyway?',
  },
  {
    key: 'schedule_session',
    order: 7,
    title: 'Schedule a session',
    body: "Book your first training session with a client. They'll get a reminder before it starts and the session shows up on their dashboard.",
    ctaLabel: 'Open the schedule',
    ctaHref: '/schedule',
    skippable: true,
    skipWarning: null,
  },
]

const ONBOARDING_EMAILS = [
  {
    key: 'welcome',
    senderKey: 'karl',
    subject: 'Welcome to PupManager — built because my partner deserved her evenings back',
    triggerRule: { type: 'on_signup' },
    body: `Hey {{first_name}},

Welcome to PupManager. Quick intro to who's behind this thing:

I'm Karl. I build software. My partner Brooke is a dog trainer, and a few years ago I watched her spend an entire Sunday night writing up session notes, chasing clients for vax records, and cobbling together intake forms in Google Docs. That night turned into the next night. Then the next.

So we built PupManager. Brooke designs it from the trainer side — she's still seeing clients, still using it every day. I build it. The whole point is to give trainers their evenings back.

There's a 7-step setup waiting on your dashboard. It's designed to get you to one specific moment: your first real client signing in to their own PupManager account. Most trainers get there in under 15 minutes.

[Continue setup →]({{wizard_url}})

Hit reply if you get stuck — Brooke or I will get back to you.

Karl`,
  },
  {
    key: 'nudge_business_name_24h',
    senderKey: 'karl',
    subject: '30 seconds to add your business name',
    triggerRule: { type: 'after_signup', hours: 24, requireStepIncomplete: 'business_profile' },
    body: `Hey {{first_name}},

Saw you signed up yesterday but haven't added your business name yet. It's the only thing standing between you and the rest of your setup — your clients see it on every screen.

[Add it now →]({{wizard_url}})

Don't have a business name yet? "{{first_name}} Dog Training" is a perfectly good answer for now. You can change it any time.

Karl`,
  },
  {
    key: 'invite_chase_24h',
    senderKey: 'brooke',
    subject: 'Has {{client_name}} got your invite?',
    triggerRule: { type: 'after_first_invite_sent', hours: 24, requireNoClientSignedIn: true },
    body: `Hey {{first_name}},

Brooke here — I'm the trainer half of PupManager. I noticed {{client_name}} hasn't activated their account yet. Don't sweat it, this is the most common spot to get stuck and I've been there with my own clients plenty of times.

Here's the message I send when someone hasn't opened the invite — copy, paste, send via text or WhatsApp:

> Hey {{client_name}}! I'm using a new app called PupManager to share session notes, photos and homework for {{dog_name}}'s training. I sent you an invite — could you take 30 seconds to register? Makes our sessions way more organised. [link]

Works almost every time.

[Resend invite →]({{client_url}})   [Copy this message →]({{copy_url}})

Brooke`,
  },
  {
    key: 'invite_other_channel_72h',
    senderKey: 'brooke',
    subject: "Email's not always the right channel for this",
    triggerRule: { type: 'after_first_invite_sent', hours: 72, requireNoClientSignedIn: true },
    body: `Hey {{first_name}},

Three days in and {{client_name}} hasn't registered. From experience: email's usually the bottleneck. Things that work better with most of my clients:

- **SMS or WhatsApp** — way higher open rate
- **Show them at the next session** — pull up the QR code on your phone, they scan it in 5 seconds
- **Walk them through it on a quick call** — sometimes one minute on the phone beats a week of texts

[Get the invite link / QR code →]({{client_url}})

Brooke`,
  },
  {
    key: 'founder_check_in_7d',
    senderKey: 'brooke',
    subject: 'Stuck somewhere?',
    triggerRule: { type: 'after_signup', hours: 168, requireAhaNotReached: true },
    body: `Hey {{first_name}},

It's been a week and you haven't had your first client register on PupManager yet. As a trainer myself I know how it goes — admin stuff slips down the list every time a dog needs you.

Want to jump on a 15-minute call? I'll walk through your setup with you and we'll get one of your clients signed up before we hang up. No sales pitch, just unblocking you trainer-to-trainer.

[Book 15 minutes with me →]({{book_url}})

Or hit reply and tell me what's in the way — I'll work it out from there.

Brooke`,
  },
  {
    key: 'aha_celebration',
    senderKey: 'brooke',
    subject: '🎉 {{client_name}} is on the app',
    triggerRule: { type: 'on_aha_reached' },
    body: `Hey {{first_name}},

{{client_name}} just signed in to PupManager for the first time. Big moment — that's when this stops being software you set up and starts being a tool that actually saves you time.

Three things I'd do next:

1. **Schedule their first session** — they'll get a reminder, no more "wait, when are we training again?" texts
2. **Send a welcome message** — appears in their app inbox
3. **Set a first goal** — "Sit for 5 seconds" is a classic, easy win for week one

[Open {{client_name}}'s profile →]({{client_url}})

Inviting more clients gets faster every time — straight from your dashboard now.

Brooke

P.S. If you'd be up for sharing two sentences about your experience so far, hit reply — would love a quote for the website.`,
  },
]

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
