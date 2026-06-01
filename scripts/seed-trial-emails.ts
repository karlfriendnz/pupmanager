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
    key: 'trial_transform_workday',
    senderKey: 'karl',
    triggerRule: { type: 'after_signup', hours: 84 },
    subject: 'How PupManager transforms your work day',
    body: `Hi {{trainerName}},

Picture a normal training week without the evening admin.

A client books in through your page — no back-and-forth texts. You run the session and write your notes once, right there on your phone. Your client sees them instantly, along with the homework you've set, and ticks it off through the week. Their dog's progress builds up on its own.

No spreadsheets. No "what did we cover last time?". No Sunday night catching up on paperwork.

That's the shift PupManager is built for — you spend your time with the dogs, and the admin mostly runs itself.

Have a proper play this week: set up one client and run a session, and you'll feel the difference.

Need a hand? Just reply — Brooke or I will get back to you.

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
    subject: 'Why I write my session notes in the car',
    body: `Hi {{trainerName}},

Brooke here — I'm a trainer too, so here's a little confession about how I actually use PupManager during my day.

I write my session notes in the car. The second a session wraps, before I drive to the next one, I sit in the car park and tap out what we covered and the homework for the week — straight into PupManager on my phone. Two minutes, while it's all still fresh.

By the time I get home the admin's already done. No notebook to write up later, no "what did we work on again?" — and my evenings are actually mine.

That's the whole reason Karl and I built this: the paperwork happens in the gaps you already have between clients, not after the kids are in bed.

Try it after your next session — set the notes and a couple of homework tasks right there, and you'll feel the difference by the end of the week.

Anything I can help with? Just reply — Brooke or I will get back to you.

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
  let created = 0
  for (const e of TRIAL_EMAILS) {
    // NON-DESTRUCTIVE: only create missing templates. We deliberately do NOT
    // update existing rows — their subject/body/etc. are the source of truth in
    // the admin editor, and an `update` here would clobber admin edits (it did,
    // once). Edit copy in the admin, not by re-running this seed.
    const existing = await prisma.onboardingEmail.findUnique({ where: { key: e.key }, select: { id: true } })
    if (existing) continue
    await prisma.onboardingEmail.create({
      data: { key: e.key, subject: e.subject, body: e.body, senderKey: e.senderKey, triggerRule: e.triggerRule, publishedAt: null },
    })
    created++
  }
  console.log(`✅ Trial email seed: created ${created} missing template(s); existing ones left untouched.`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
