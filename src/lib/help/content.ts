// Help-center content: short, plain-English, step-by-step guides written at a
// "read it once and do it" level. Keep steps tiny — one action per line, no
// jargon. Searched + rendered by the trainer Help page (help-center.tsx).

export type HelpArticle = {
  slug: string
  title: string
  category: string
  // Extra words people might type when searching that aren't in the title.
  keywords: string[]
  // One-line "what this is for".
  summary: string
  // Numbered steps shown when the article is opened.
  steps: string[]
}

export type Faq = {
  q: string
  a: string
}

// Order here is the order categories appear in "Browse all guides".
export const HELP_CATEGORIES = [
  'Getting started',
  'Clients',
  'Scheduling',
  'Website & bookings',
  'Sessions & notes',
  'Programmes & products',
  'Your team',
  'Account & app',
] as const

export const HELP_ARTICLES: HelpArticle[] = [
  // ── Getting started ───────────────────────────────────────────────────────
  {
    slug: 'finish-setup',
    title: 'Finish setting up your account',
    category: 'Getting started',
    keywords: ['onboarding', 'setup', 'checklist', 'get started', 'steps'],
    summary: 'Work through the welcome checklist so PupManager is ready to use.',
    steps: [
      'Click "Dashboard" on the left.',
      'Find the teal "Welcome to PupManager" box at the top.',
      'Tap any item in the list to jump to that step.',
      'Do the steps one by one — each turns into a green tick when it\'s done.',
      'You can stop and come back any time. Your progress is saved.',
    ],
  },
  {
    slug: 'set-up-business-profile',
    title: 'Set up your business profile',
    category: 'Getting started',
    keywords: ['business', 'logo', 'name', 'phone', 'brand', 'profile'],
    summary: 'Add your business name, phone and logo. Clients see these everywhere.',
    steps: [
      'Click "Settings" on the left.',
      'Stay on the "Profile" tab.',
      'Type your business name and phone number.',
      'Click "Upload logo" and pick an image from your device.',
      'Click "Save". Your details now show across the app and in emails.',
    ],
  },
  {
    slug: 'review-publish-forms',
    title: 'Review and publish your forms',
    category: 'Getting started',
    keywords: ['intake form', 'contact form', 'session form', 'questions', 'publish'],
    summary: 'Check the questions new clients answer, then make the form live.',
    steps: [
      'Click "Settings" on the left.',
      'Click the "Forms" tab.',
      'Read through the questions on each form.',
      'Add, edit or remove questions so they ask for what you need.',
      'Click "Publish" to make the form live for clients.',
    ],
  },

  // ── Clients ────────────────────────────────────────────────────────────────
  {
    slug: 'add-client',
    title: 'Add a client (no email sent)',
    category: 'Clients',
    keywords: ['create client', 'new client', 'add', 'without invite', 'dog'],
    summary: 'Create a client record now and invite them later.',
    steps: [
      'Click "Clients" on the left.',
      'Click "Invite client" (top right).',
      'Type the client\'s name, email, and their dog\'s name.',
      'Turn the "Send invitation email" toggle OFF.',
      'Click "Add client". They\'re saved, but no email goes out yet.',
    ],
  },
  {
    slug: 'invite-client',
    title: 'Invite your first client',
    category: 'Clients',
    keywords: ['invite', 'sign up link', 'email', 'send invitation'],
    summary: 'Send a client a link so they can sign in and see their training.',
    steps: [
      'Click "Clients" on the left.',
      'Click "Invite client" (top right).',
      'Type their name, email, and their dog\'s name.',
      'Leave "Send invitation email" ON. You can edit the email text first.',
      'Click "Send invitation". They\'ll get an email with a sign-up link.',
    ],
  },
  {
    slug: 'resend-invite',
    title: 'Resend a client invite',
    category: 'Clients',
    keywords: ['resend', 'chase', 'reminder', 'did not get email', 'again'],
    summary: 'Send the sign-in link again if a client missed the first one.',
    steps: [
      'Click "Clients" on the left.',
      'Click the client\'s name to open their profile.',
      'Click "Resend invite".',
      'A fresh sign-in link is emailed to them straight away.',
    ],
  },
  {
    slug: 'preview-as-client',
    title: 'See the app as your client',
    category: 'Clients',
    keywords: ['preview', 'view as client', 'client side', 'what they see'],
    summary: 'Look around the client app exactly as your clients will.',
    steps: [
      'Click "Clients" on the left.',
      'Click "View as client" (or open a client and choose Preview).',
      'Click around to see their home, sessions and messages.',
      'Click "Exit preview" at the top when you\'re done.',
    ],
  },
  {
    slug: 'message-client',
    title: 'Message a client',
    category: 'Clients',
    keywords: ['message', 'chat', 'send a note', 'contact client'],
    summary: 'Send a client a message inside PupManager.',
    steps: [
      'Click "Messages" on the left.',
      'Pick the client you want to message.',
      'Type your message in the box at the bottom.',
      'Press Enter (or tap Send). They get a notification.',
    ],
  },
  {
    slug: 'handle-enquiries',
    title: 'Handle a new enquiry',
    category: 'Clients',
    keywords: ['enquiry', 'lead', 'new request', 'accept', 'decline', 'booking'],
    summary: 'Reply to people who ask about training through your forms or booking pages.',
    steps: [
      'Click "Enquiries" on the left.',
      'Click an enquiry to read it.',
      'Use "Reply" to message them back.',
      'Click "Accept" to turn them into a client, or "Decline" to close it.',
      'If they picked a time on a booking page, accepting also books that session for them.',
    ],
  },

  // ── Scheduling ───────────────────────────────────────────────────────────
  {
    slug: 'set-availability',
    title: 'Set your training hours',
    category: 'Scheduling',
    keywords: ['availability', 'hours', 'block out', 'when you train', 'days'],
    summary: 'Tell PupManager which days and times you can train.',
    steps: [
      'Click "Schedule" on the left.',
      'Click the "Hours" button at the top.',
      'Pick a day, then drag across the hours you can train.',
      'Click "Save". Even one day is enough to start.',
    ],
  },
  {
    slug: 'schedule-session',
    title: 'Schedule a session',
    category: 'Scheduling',
    keywords: ['book', 'session', 'calendar', 'add session', 'appointment'],
    summary: 'Put a training session on the calendar.',
    steps: [
      'Click "Schedule" on the left.',
      'Click any open time slot in the calendar.',
      'Choose the client and add any details.',
      'Click "Save". The session now shows on your schedule.',
    ],
  },
  {
    slug: 'create-class',
    title: 'Create a group class',
    category: 'Scheduling',
    keywords: ['class', 'group', 'enrol', 'spots', 'puppy class'],
    summary: 'Set up a class that several dogs can join.',
    steps: [
      'Click "Classes" on the left.',
      'Click "New class".',
      'Add the name, date/time, and how many spots there are.',
      'Click "Save". Clients can then be enrolled into it.',
    ],
  },

  // ── Website & bookings ────────────────────────────────────────────────────
  {
    slug: 'create-booking-page',
    title: 'Create a booking page',
    category: 'Website & bookings',
    keywords: ['booking', 'book a time', 'calendly', 'pick a time', 'self book', 'link'],
    summary: 'Make a "pick a time" page people can use to book you online.',
    steps: [
      'Click "Website" on the left.',
      'Find the "Booking pages" card and click "New page".',
      'You drop straight into the new page\'s editor.',
      'Set a "Page name" and a "Link slug" (the bit after /book/).',
      'When you\'re ready for people to use it, turn the "Live" toggle on.',
      'Click "Save changes".',
    ],
  },
  {
    slug: 'set-booking-times',
    title: 'Choose when a booking page offers times',
    category: 'Website & bookings',
    keywords: ['booking', 'availability', 'hours', 'slots', 'days', 'notice', 'length'],
    summary: 'Control the days, hours and slot sizes people can book.',
    steps: [
      'Click "Website" on the left, then open a booking page.',
      'In the "Availability" card, tap the days you want to offer.',
      'Set a "Start time" and "End time" for those days.',
      'Leave both times blank to use your normal Schedule hours instead.',
      'In "Slots", set the slot length, how often slots start, minimum notice, and how far ahead to show.',
      'Click "Save changes".',
    ],
  },
  {
    slug: 'booking-package-or-approval',
    title: 'Decide what a booking creates',
    category: 'Website & bookings',
    keywords: ['booking', 'package', 'approval', 'instant', 'confirm', 'single session'],
    summary: 'Book a single session or kick off a package, and choose instant vs confirm-first.',
    steps: [
      'Open a booking page from "Website".',
      'In "What gets booked", pick a package or leave it as "Single session".',
      'With a package, the chosen time becomes session 1 and the rest auto-schedule.',
      'Use "Existing clients need approval" to choose instant booking or confirm-first (package pages only).',
      'Single sessions by existing clients always book instantly; new people always become an enquiry you accept first.',
      'Click "Save changes".',
    ],
  },
  {
    slug: 'booking-automatic-emails',
    title: 'Send automatic booking emails',
    category: 'Website & bookings',
    keywords: ['automation', 'reminder', 'confirmation', 'follow up', 'email', 'booking'],
    summary: 'Auto-send a confirmation, a reminder before, or a follow-up after each booking.',
    steps: [
      'Open a booking page from "Website" and click the "Automations" tab.',
      'Add one: Confirmation (when someone books), Reminder (before the session), or Follow-up (after the session).',
      'Write the subject and message. Type {name}, {dog}, {time} or {business} to fill in details automatically.',
      'For a Reminder or Follow-up, set how long before/after the session it sends.',
      'Use the "Enabled" toggle on each email to switch it on or off.',
    ],
  },
  {
    slug: 'share-booking-link',
    title: 'Share your booking link',
    category: 'Website & bookings',
    keywords: ['booking', 'link', 'copy', 'share', 'website', 'social', 'url'],
    summary: 'Copy your booking page link to put on your website, socials or a message.',
    steps: [
      'Click "Website" on the left.',
      'In "Booking pages", find your page — it shows "Live" when it\'s on.',
      'Click the copy icon to copy its link, or the arrow icon to open it.',
      'Paste the link into your website, social bio, or a message to a client.',
    ],
  },
  {
    slug: 'embed-form-on-website',
    title: 'Add a sign-up form to your website',
    category: 'Website & bookings',
    keywords: ['embed', 'form', 'lead', 'capture', 'website', 'iframe', 'registration'],
    summary: 'Put a lead-capture form on your own site — submissions become enquiries.',
    steps: [
      'Click "Website" on the left.',
      'Find the "Lead-capture forms" card and click "New form".',
      'Add your questions, then turn the form on (Publish).',
      'Click "Embed code", then "Copy", and paste the snippet into your website.',
      'Anything people submit lands in your "Enquiries".',
    ],
  },

  // ── Sessions & notes ──────────────────────────────────────────────────────
  {
    slug: 'write-session-notes',
    title: 'Write up a session',
    category: 'Sessions & notes',
    keywords: ['notes', 'write up', 'homework', 'photos', 'after session'],
    summary: 'Add notes, photos and homework a client can see.',
    steps: [
      'Click "Schedule" on the left and open the session (or open it from "To do").',
      'Type your notes about how the session went.',
      'Add photos or homework if you like.',
      'Click "Save". Your client can now see it in their app.',
    ],
  },
  {
    slug: 'set-up-achievements',
    title: 'Set up achievements',
    category: 'Sessions & notes',
    keywords: ['achievements', 'badges', 'rewards', 'milestones'],
    summary: 'Choose the badges your clients can earn as they progress.',
    steps: [
      'Click "Achievements" on the left.',
      'Look through the ready-made achievements.',
      'Tap any one to publish it (or edit it first).',
      'Add your own with "New achievement" if you want.',
    ],
  },

  // ── Programmes & products ─────────────────────────────────────────────────
  {
    slug: 'create-package',
    title: 'Create a programme or package',
    category: 'Programmes & products',
    keywords: ['package', 'programme', 'program', 'plan', 'sell', 'sessions'],
    summary: 'Describe a training programme clients can sign up for.',
    steps: [
      'Click "Packages" on the left.',
      'Click "New package".',
      'Add a name, a short description, the price and number of sessions.',
      'Click "Save". It\'s ready to assign to clients.',
    ],
  },
  {
    slug: 'add-product',
    title: 'Add a product',
    category: 'Programmes & products',
    keywords: ['product', 'shop', 'sell', 'treats', 'gear'],
    summary: 'List something clients can buy, like treats or gear.',
    steps: [
      'Click "Products" on the left.',
      'Click "New product".',
      'Add the name, price and a photo.',
      'Click "Save". It shows in your client shop.',
    ],
  },

  // ── Your team ───────────────────────────────────────────────────────────
  {
    slug: 'invite-team',
    title: 'Invite a team member',
    category: 'Your team',
    keywords: ['staff', 'team', 'trainer', 'manager', 'add user', 'colleague'],
    summary: 'Give another trainer or helper their own login.',
    steps: [
      'Click "Settings" on the left.',
      'Click the "Team" tab.',
      'Click "Invite".',
      'Type their email and pick their role (Manager or Staff).',
      'Click "Send". They get an email to set up their login.',
    ],
  },

  // ── Account & app ─────────────────────────────────────────────────────────
  {
    slug: 'change-plan',
    title: 'Change your plan',
    category: 'Account & app',
    keywords: ['billing', 'subscription', 'upgrade', 'downgrade', 'plan', 'pay'],
    summary: 'View plans and upgrade or change your subscription.',
    steps: [
      'Click "Settings" on the left.',
      'Open the "Subscription" / "Billing" section.',
      'Look at the available plans.',
      'Click "Upgrade" or "Change plan" and follow the steps.',
    ],
  },
  {
    slug: 'download-app',
    title: 'Get the mobile app',
    category: 'Account & app',
    keywords: ['app', 'download', 'phone', 'ios', 'android', 'mobile', 'qr'],
    summary: 'Put PupManager on your phone.',
    steps: [
      'Open the "Get set up" box on your Dashboard.',
      'Tap "Download the app".',
      'A pop-up shows two QR codes — one for iPhone, one for Android.',
      'Open your phone camera and point it at the right code.',
      'Tap the link that appears to install the app.',
    ],
  },
]

export const HELP_FAQS: Faq[] = [
  {
    q: 'What does the compliance percentage mean?',
    a: 'It\'s how many of the tasks you set a client they\'ve marked done over the last 7 days. Higher means they\'re keeping up with training.',
  },
  {
    q: 'Can I share a client with another trainer?',
    a: 'Yes. Open the client\'s profile and tap "Share". You can give read-only access or hand them over completely.',
  },
  {
    q: 'A client says they didn\'t get their invite email.',
    a: 'Open the client, tap "Resend invite", and ask them to check their spam folder. The new link replaces the old one.',
  },
  {
    q: 'Do I have to finish the setup checklist all at once?',
    a: 'No. Do as much as you like, then come back later — your progress is saved on the Dashboard.',
  },
  {
    q: 'How do I cancel my account?',
    a: 'Go to Settings → Danger zone → Delete my account. This is permanent and removes all your data, so download anything you need first.',
  },
  {
    q: 'What\'s the difference between a booking page and a lead-capture form?',
    a: 'A booking page lets people pick a real time slot and book it. A lead-capture form just collects their details as an enquiry — no time is chosen. Both live under "Website".',
  },
  {
    q: 'Does someone need an account to book a time?',
    a: 'No. New people just pick a time and their booking arrives as an enquiry you accept — accepting both creates their client record and books the session. Existing clients book straight from the page.',
  },
  {
    q: 'Why isn\'t my booking page showing any times?',
    a: 'Check the page is "Live", that you\'ve ticked some days, and either set start/end times on the page or have Schedule hours set. Times inside your "minimum notice" window are hidden too.',
  },
  {
    q: 'Is my clients\' data private?',
    a: 'Yes. Each client only sees their own information, and only you (and team members you invite) can see your business\'s data.',
  },
]
