export type CategoryId =
  | 'dog-training-scheduling'
  | 'dog-training-session-notes'
  | 'dog-training-client-app'
  | 'dog-trainer-new-clients'
  | 'dog-training-team-management'

export type Category = {
  id: CategoryId
  eyebrow: string
  title: string
  blurb: string
  shortBlurb: string
  // SEO-only — used in <title> for category pages.
  seoTitle: string
  comingSoon?: boolean
}

export type FeatureSection = {
  category: CategoryId
  id: string
  eyebrow: string
  title: string
  body: string
  bullets: string[]
  imageLabel: string
  comingSoon?: boolean
}

export const categories: Category[] = [
  {
    id: 'dog-training-scheduling',
    eyebrow: 'Day to day',
    title: 'Dog training scheduling, sorted.',
    seoTitle: 'Scheduling Software for Dog Trainers',
    shortBlurb:
      "Open the app and you're already up to speed.",
    blurb:
      "The everyday stuff — what's happening today, what's booked next, who's in your group class on Tuesday. Open the app and you're already up to speed.",
  },
  {
    id: 'dog-training-session-notes',
    eyebrow: 'The actual training',
    title: 'Dog training session notes that tell a real story.',
    seoTitle: 'Session Notes & AI Plans for Dog Trainers',
    shortBlurb: 'Notes that build into a real story you can show. AI drafting is on its way.',
    blurb:
      "The bit that's actually about dogs. Take notes, score the work, and drop in a video — all in one place, all in your pocket. An AI helper that drafts plans and progress write-ups is coming soon.",
  },
  {
    id: 'dog-training-client-app',
    eyebrow: 'For your clients',
    title: 'A dog training client app your customers will love.',
    seoTitle: 'Client App for Dog Training Businesses',
    shortBlurb: 'A beautiful app, simple messages, little wins to share.',
    blurb:
      "What your clients see, swipe, and share. A beautiful app with your name on it, simple messaging, and little wins they'll want to brag about.",
  },
  {
    id: 'dog-trainer-new-clients',
    eyebrow: 'Bring in new clients',
    title: 'Capture new clients without the back-and-forth.',
    seoTitle: 'Lead Capture & Intake Forms for Dog Trainers',
    shortBlurb: 'Intake forms that go straight into a tidy inbox. Selling packages is coming next.',
    blurb:
      "Build a sign-up form, drop it on your website, and new clients fill it in before they even arrive. Everything lands in one tidy inbox you can work through whenever you have ten minutes. A simple shop for selling sessions and packages is on its way.",
  },
  {
    id: 'dog-training-team-management',
    eyebrow: 'For teams',
    title: 'Team management for multi-trainer dog schools.',
    seoTitle: 'Team Management for Multi-Trainer Dog Schools',
    shortBlurb: 'Shared calendar, roles, and admin tools for multi-trainer teams.',
    blurb:
      "If you've got more than one trainer, this is for you. Shared calendars, role-based access, and admin tools that keep everyone on the same page.",
    comingSoon: true,
  },
]

export const sections: FeatureSection[] = [
  // ── Your day, sorted ──────────────────────────────────────────────────
  {
    category: 'dog-training-scheduling',
    id: 'dashboard',
    eyebrow: 'Dashboard',
    title: 'One screen. Everything that matters today.',
    body:
      "Open the app and see exactly what you need. Today's sessions. Who's waiting on a reply. Who hasn't done their homework. How much you've billed this week. The five things that used to take five tabs.",
    bullets: [
      "Today's sessions, where they are, and how many credits each client has left",
      'New enquiries and unread messages — right there, no digging',
      "A gentle nudge for clients who haven't done their homework yet",
      "How much you've billed this week, plus no-shows and class numbers",
      'Loads in under a second — phone or laptop',
    ],
    imageLabel: "Trainer dashboard — today's sessions, messages, revenue summary",
  },
  {
    category: 'dog-training-scheduling',
    id: 'scheduling',
    eyebrow: 'Scheduling',
    title: 'A calendar that gets it.',
    body:
      "Most scheduling tools were built for haircuts. Ours was built for dog training. Drive time between visits. Package credits. Recurring sessions. The little things that make a real difference.",
    bullets: [
      'Track package credits automatically — no spreadsheet to maintain',
      'Add drive-time buffers between in-home visits',
      'Clients reschedule from one link — no more 5-text back-and-forth',
      'Syncs both ways with Google and Apple Calendar',
    ],
    imageLabel: 'Trainer calendar view with sessions + package credits',
  },
  {
    category: 'dog-training-scheduling',
    id: 'group-classes',
    eyebrow: 'Group classes',
    title: 'Group classes without the printed sign-in sheet.',
    body:
      'Run a 6-week class with eight families signed up. Take attendance in two taps. Catch-up sessions track themselves. The end-of-term scramble disappears.',
    bullets: [
      'Sign-ups and attendance all in one place',
      'Catch-up sessions tracked automatically — no more "who\'s owed what?"',
      'Send the same homework to everyone in the class with one click',
      'Waitlists with auto-fill coming soon',
    ],
    imageLabel: 'Group-class roster with attendance ticked per team',
  },
  {
    category: 'dog-training-scheduling',
    id: 'notifications',
    eyebrow: 'Auto reminders',
    title: 'Reminders that remember for you.',
    body:
      "The session reminder you forgot to send. The follow-up that slipped. The \"did you do your homework?\" nudge. PupManager pings clients before sessions, prompts them about homework, and pings you when something needs your eyes — a new enquiry, a reply that's been sitting, a class with empty seats. Configure once, then stop thinking about it.",
    bullets: [
      'Session reminders to clients at -24h and -2h',
      'Homework nudges so practice actually happens between sessions',
      'New-enquiry alerts straight to you — never lose a lead in your inbox',
      'A gentle ping for clients who haven\'t booked in a while',
      'Trainer reminders for things that need your attention today',
      'You configure once. They run forever.',
    ],
    imageLabel: 'Phone showing a PupManager session reminder + homework nudge',
  },

  // ── The training ──────────────────────────────────────────────────────
  {
    category: 'dog-training-session-notes',
    id: 'progress',
    eyebrow: 'Session notes',
    title: 'Notes that turn into a story you can show.',
    body:
      "Each session has tasks, scores, a quick note, and the video you shot. Not a wall of text in your phone you'll never read again. Two weeks in, show your client a chart of how their dog is doing — they'll book the next package on the spot.",
    bullets: [
      'Score each task and add a one-line note. Drop in a 10-second video.',
      "Your client sees tonight's homework before they're home from your session",
      'Save your favourite class plans (puppy class, reactivity, recall basics) and reuse them with one click',
      'Pretty progress charts you can pull up in any consult',
    ],
    imageLabel: 'Trainer-side session view with tasks + scores + attached video',
  },
  {
    category: 'dog-training-session-notes',
    id: 'ai',
    eyebrow: 'AI helper',
    comingSoon: true,
    title: 'AI that drafts the boring bits. You stay in charge.',
    body:
      'Paste a few notes about a new dog and get a six-week plan you can edit. Click a button and get a friendly progress update for your client that sounds like you wrote it. The AI does the typing — you stay in charge of the training.',
    bullets: [
      'Get a draft training plan from a few notes',
      "Turn this month's sessions into a friendly client update — instantly",
      'Always a draft. You read it and approve it. Nothing sends on its own.',
      'Built around how trainers actually write — not generic AI fluff',
    ],
    imageLabel: 'AI plan generator with editable session steps',
  },

  // ── For your clients ──────────────────────────────────────────────────
  {
    category: 'dog-training-client-app',
    id: 'client-app',
    eyebrow: 'Client app',
    title: 'An app your clients will actually open.',
    body:
      "It's the kind of app that makes new clients ask which app you use. Yours. Your name on it. Your colours. They open it, see the homework, watch the video, tick it off, and message you back if they're stuck.",
    bullets: [
      'iPhone, Android, or a web link — pick whatever the client prefers',
      "Reminders for tonight's homework and tomorrow's session",
      'Every cue you taught them, on video, ready to replay',
      'Your business name and colours — clients see your brand, not ours',
    ],
    imageLabel: "Client-app screen on phone — today's homework view",
  },
  {
    category: 'dog-training-client-app',
    id: 'messages',
    eyebrow: 'Messages',
    title: "Messages that come with the dog's full story.",
    body:
      "Stop digging through three apps to remember what Riley's family told you on Tuesday. Each conversation sits next to the dog's history and last session, so the context is right there when you reply.",
    bullets: [
      'One thread per client. Nothing buried in a group chat.',
      'Reply on your phone or laptop — same conversation either way',
      'See the last session and homework status without leaving the chat',
      'Attach a clip from the session you just finished',
    ],
    imageLabel: 'Client thread with dog profile + last-session card',
  },
  {
    category: 'dog-training-client-app',
    id: 'achievements',
    eyebrow: 'Client wins',
    title: 'Little wins that keep clients coming back.',
    body:
      'Every time a dog hits a milestone — first solid recall, first month of consistent practice, finishing a 6-week class — they get a little badge in the app. Owners love it. They share it. New clients show up because of it.',
    bullets: [
      'Badges hand themselves out — no extra work for you',
      'Your business name and colours on every badge',
      'Owners can share their wins (free marketing for you)',
      "Spot clients who haven't earned anything in a while — gentle nudge to book again",
    ],
    imageLabel: 'Client-app achievement card + share sheet',
  },

  // ── Grow your business ────────────────────────────────────────────────
  {
    category: 'dog-trainer-new-clients',
    id: 'forms',
    eyebrow: 'New client forms',
    title: 'Get the info you need before the first session.',
    body:
      'Build a sign-up form, drop it on your website, and new clients fill it in before they arrive. The answers land in one tidy inbox you can work through whenever you have ten minutes.',
    bullets: [
      'Easy form builder — drag, drop, save, reuse',
      'Embed it on your site, share a link, or print a QR code for events',
      'All your new enquiries in one inbox — convert to a client in one click',
      'We chase the form for you so the client actually fills it in',
    ],
    imageLabel: 'Enquiries inbox + intake-form builder',
  },
  {
    category: 'dog-trainer-new-clients',
    id: 'shop',
    eyebrow: 'Shop',
    comingSoon: true,
    title: 'A simple shop for sessions and packages.',
    body:
      "We're building a clean little shop where your clients can buy single sessions, packages, and extras — your prices, your packages, your name on it. Aiming to ship this alongside the new payments features so the whole loop closes in one go.",
    bullets: [
      'Sell single sessions, packages, and extras from one shop',
      'Credits track themselves so clients see what they have left',
      'Discount codes, intro offers, and gift cards',
      'Refunds and credits without a spreadsheet',
    ],
    imageLabel: 'Client-side shop with packages + sessions',
  },

  // ── For teams (Coming soon) ───────────────────────────────────────────
  {
    category: 'dog-training-team-management',
    id: 'team-admin',
    eyebrow: 'Team admin',
    comingSoon: true,
    title: 'Run a team without the headaches.',
    body:
      "More than one trainer? You'll want this. Shared team calendar so everyone sees what's on. Roles and permissions so the right people see the right thing. One admin view to keep the whole business on track.",
    bullets: [
      'Up to 5 trainers on one shared calendar',
      'Roles and permissions — front-desk, trainer, owner — each sees what they need',
      'One admin dashboard for the whole business',
      'Switch between trainers in one tap',
      'Available on the Team and Studio plans when they ship',
    ],
    imageLabel: 'Team admin view — multi-trainer calendar + roles',
  },
]

export function getCategory(id: string): Category | undefined {
  return categories.find((c) => c.id === id)
}

export function getSectionsByCategory(id: CategoryId): FeatureSection[] {
  return sections.filter((s) => s.category === id)
}
