// Seed the trainer TRIAL-process email templates (distinct from the activation
// onboarding set). Drafts (publishedAt null) — visible in admin, not yet sent.
// Run: npx tsx scripts/seed-trial-emails.ts
import { prisma } from '../src/lib/prisma'

const TRIAL_EMAILS = [
  {
    key: 'trial_welcome',
    senderKey: 'karl',
    triggerRule: { type: 'on_signup' },
    subject: 'Welcome to PupManager 🐾',
    body: `Hi {{trainerName}},

Welcome aboard — really glad to have you. I'm Karl; my wife Brooke is a dog trainer, and we built PupManager to take the evening admin off her plate so she could focus on the dogs (and get her Sundays back).

Your {{businessName}} trial is live. The quickest way to feel the difference:

1. Add your business name and logo so the app feels like yours.
2. Add a client and send them their training diary link.
3. Run a session and write your notes once — your client sees them instantly.

That's the whole loop: less admin for you, more time for the dogs.

Need a hand getting set up? Just hit reply — Brooke or I will get back to you.

— Karl & Brooke
PupManager`,
  },
  {
    key: 'trial_day3_value',
    senderKey: 'karl',
    triggerRule: { type: 'after_signup', hours: 72 },
    subject: 'Getting the most out of your PupManager trial',
    body: `Hi {{trainerName}},

You're a few days into your {{businessName}} trial — here are the three things that make PupManager click for most trainers:

1. Add a client and send them their training diary link.
2. Run a session and write your notes once — your client sees them instantly.
3. Set a couple of homework tasks so they keep training between sessions.

That loop is the whole point: less admin for you, more time for the dogs.

Stuck on anything? Just hit reply — Brooke or I will get back to you.

— Karl & Brooke
PupManager`,
  },
  {
    key: 'trial_client_app',
    senderKey: 'karl',
    triggerRule: { type: 'after_signup', hours: 96 },
    subject: 'The bit your clients will love',
    body: `Hi {{trainerName}},

Quick one. What makes PupManager click for most trainers isn't the admin side — it's what their clients get: a clean little app showing their upcoming sessions, the homework you've set, your session notes, and their dog's progress over time.

That means fewer "what was I meant to practise again?" messages, and clients who actually keep training between sessions.

Want to see it the way they will? Open your dashboard and tap "Preview as client" — that's exactly what {{businessName}}'s clients see.

Any questions, just reply — Brooke or I will get back to you.

— Karl & Brooke
PupManager`,
  },
  {
    key: 'trial_brooke_routine',
    senderKey: 'brooke',
    triggerRule: { type: 'after_signup', hours: 120 },
    subject: 'How I actually use it with my own clients',
    body: `Hi {{trainerName}},

Brooke here — I'm a trainer too, so here's how I run it day to day.

After each session I write my notes once, right there in the app, and set two or three homework tasks. My client gets them instantly, ticks things off through the week, and by the next session we both know exactly where we're at. No paper, no late-night catch-up.

If you set up one client and run a session that way this week, you'll feel the difference straight away.

Stuck on anything? Reply and we'll get back to you.

— Brooke & Karl
PupManager`,
  },
  {
    key: 'trial_halfway',
    senderKey: 'brooke',
    triggerRule: { type: 'trial_days_left', days: 7 },
    subject: `How's it going with {{businessName}}?`,
    body: `Hi {{trainerName}},

You're about halfway through your trial. I'm Brooke — I'm a dog trainer too, and Karl and I built PupManager because I was drowning in admin every evening.

If anything isn't clicking yet, tell me what you're trying to do and we'll get back to you and help you set it up properly.

— Brooke & Karl
PupManager`,
  },
  {
    key: 'trial_3days_left',
    senderKey: 'karl',
    triggerRule: { type: 'trial_days_left', days: 3 },
    subject: 'Your PupManager trial ends in {{daysLeft}} days',
    body: `Hi {{trainerName}},

Your trial wraps up on {{trialEndDate}} — about {{daysLeft}} days away.

When it ends, your {{businessName}} account stays exactly as you left it. You just pick a plan to keep using it with your clients.

Want to keep going? Choose your plan: {{billingUrl}}

Any questions about plans? Reply here — Brooke or I will get back to you.

— Karl & Brooke
PupManager`,
  },
  {
    key: 'trial_1day_left',
    senderKey: 'karl',
    triggerRule: { type: 'trial_days_left', days: 1 },
    subject: 'Last day of your PupManager trial',
    body: `Hi {{trainerName}},

Your trial ends tomorrow. Pick a plan now and nothing skips a beat — your clients, sessions and notes all stay put.

Choose your plan: {{billingUrl}}

On the fence? Just reply — Brooke or I will get back to you.

— Karl & Brooke
PupManager`,
  },
  {
    key: 'trial_ended',
    senderKey: 'brooke',
    triggerRule: { type: 'trial_ended' },
    subject: `Your trial's wrapped up — pick up where you left off`,
    body: `Hi {{trainerName}},

Your PupManager trial has ended. Everything you set up for {{businessName}} is safe and waiting — reactivate any time and you're straight back in.

Reactivate {{businessName}}: {{billingUrl}}

And if PupManager wasn't quite right, I'd genuinely love to know why — reply and tell us, and we'll get back to you.

— Brooke & Karl
PupManager`,
  },
]

async function main() {
  for (const e of TRIAL_EMAILS) {
    await prisma.onboardingEmail.upsert({
      where: { key: e.key },
      create: { key: e.key, subject: e.subject, body: e.body, senderKey: e.senderKey, triggerRule: e.triggerRule, publishedAt: null },
      update: { subject: e.subject, body: e.body, senderKey: e.senderKey, triggerRule: e.triggerRule },
    })
  }
  console.log(`✅ Seeded ${TRIAL_EMAILS.length} trial-process email templates (as drafts).`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
