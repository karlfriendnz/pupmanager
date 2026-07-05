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
  'Marketing & emails',
  'Sessions & notes',
  'Programmes & products',
  'Getting paid',
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

  // ── Clients (new) ──────────────────────────────────────────────────────────
  {
    slug: 'quick-add-contact',
    title: 'Quick-add a contact you just met',
    category: 'Clients',
    keywords: ['quick add', 'capture', 'contact', 'in person', 'follow up', 'fast'],
    summary: 'Jot down someone you met in person in seconds, and finish their details later.',
    steps: [
      'Click "Clients" on the left.',
      'Click "Quick add" (top right).',
      'Fill in the few fields shown — these are the ones marked for quick-add.',
      'Click "Add contact". They\'re saved as a follow-up.',
      'Open them from your client list any time to finish the rest of their details.',
    ],
  },
  {
    slug: 'choose-quick-add-fields',
    title: 'Choose what shows on the quick-add form',
    category: 'Clients',
    keywords: ['quick add', 'fields', 'capture', 'required', 'custom field', 'forms'],
    summary: 'Pick which details you capture when quick-adding a contact.',
    steps: [
      'Click "Settings" on the left.',
      'Click the "Forms" tab.',
      'Find the "Client capture fields" list.',
      'Tick "Quick-add" on each field you want on the fast form.',
      'Use "Required" to decide what must be filled in when creating a full client. Changes save as you go.',
    ],
  },
  {
    slug: 'add-custom-client-field',
    title: 'Capture your own client or dog details',
    category: 'Clients',
    keywords: ['custom field', 'extra question', 'client', 'dog', 'capture', 'forms'],
    summary: 'Add your own fields to record extra details about clients and their dogs.',
    steps: [
      'Click "Settings" on the left.',
      'Click the "Forms" tab.',
      'Add your own fields in the form builder, choosing if each applies to the client or the dog.',
      'Mark a field "Required" if it must be filled in.',
      'Tick "Quick-add" in the "Client capture fields" list if you also want it on the fast quick-add form.',
    ],
  },

  // ── Scheduling (new) ───────────────────────────────────────────────────────
  {
    slug: 'send-draft-session-notes',
    title: 'Send your unsent session notes',
    category: 'Scheduling',
    keywords: ['draft notes', 'unsent', 'recap', 'send notes', 'send recap', 'bulk'],
    summary: 'Find session notes you saved but haven\'t sent, and send them to clients.',
    steps: [
      'Click "Notes" under Schedule on the left.',
      'You\'ll see every note you\'ve saved but not sent yet, oldest first.',
      'Click "Send" on a single note to send just that one.',
      'Or tick several (or "Select all"), then click "Send … selected" at the bottom.',
      'Use "Send all" to send every waiting note at once. The client gets their recap and a notification.',
    ],
  },

  // ── Sessions & notes (new) ─────────────────────────────────────────────────
  {
    slug: 'log-time-on-session',
    title: 'Log time against a session',
    category: 'Sessions & notes',
    keywords: ['time', 'hours', 'log time', 'time tracking', 'billable', 'session'],
    summary: 'Record how long a session took and who did it.',
    steps: [
      'Click "Schedule" on the left and open the session.',
      'Scroll to the "Time tracking" section.',
      'Click "Log time".',
      'Pick the team member, type the hours, and add a rate per hour and a note if you like.',
      'Click "Add". The hours (and billable amount) show on the session.',
    ],
  },

  // ── Account & app (new) ────────────────────────────────────────────────────
  {
    slug: 'create-timesheet',
    title: 'Start a timesheet',
    category: 'Account & app',
    keywords: ['timesheet', 'staff', 'hours', 'pay', 'week', 'time tracking'],
    summary: 'Create a weekly timesheet you can fill in with time entries.',
    steps: [
      'Click "Timesheets" on the left.',
      'In "Start a new timesheet", pick any day in the week you want.',
      'Click "New timesheet".',
      'It opens ready for you to add time entries.',
    ],
  },
  {
    slug: 'add-timesheet-entries',
    title: 'Add time to a timesheet',
    category: 'Account & app',
    keywords: ['timesheet', 'entry', 'hours', 'task', 'rate', 'log'],
    summary: 'Add each piece of work to a timesheet, with hours and an amount.',
    steps: [
      'Click "Timesheets" on the left and open a timesheet.',
      'In "Entries", click "Add entry".',
      'Set the date, hours and what you did.',
      'Pick a rate to work out the amount, or choose "No rate / manual amount" and type the amount yourself.',
      'Add a client, category or notes if you like, then click "Add entry".',
    ],
  },
  {
    slug: 'set-hourly-rates',
    title: 'Set your hourly rates',
    category: 'Account & app',
    keywords: ['rate', 'hourly', 'price', 'timesheet', 'pay rate'],
    summary: 'Create named hourly rates you can apply to timesheet entries.',
    steps: [
      'Click "Timesheets" on the left.',
      'Find the "Hourly rates" card.',
      'Type a "Rate name" and a "$ / hour" amount.',
      'Click "Add". The rate is now ready to pick on any time entry.',
      'Only the business owner can add or remove rates.',
    ],
  },
  {
    slug: 'finalise-and-send-timesheet',
    title: 'Finalise and send a timesheet',
    category: 'Account & app',
    keywords: ['timesheet', 'finalise', 'lock', 'send', 'pdf', 'email', 'export'],
    summary: 'Lock a timesheet, then email or download it as a PDF.',
    steps: [
      'Click "Timesheets" on the left and open the timesheet.',
      'In "Finalise & send", click "Finalise" to lock the entries.',
      'Type who to "Email the PDF to".',
      'Click "Email PDF" to send it, or "Download PDF" to save a copy.',
      'Click "Reopen" later if you need to change something.',
    ],
  },
  {
    slug: 'open-reports',
    title: 'See your reports',
    category: 'Account & app',
    keywords: ['reports', 'analytics', 'charts', 'stats', 'numbers', 'insights'],
    summary: 'Look at charts about your clients, sessions, revenue and more.',
    steps: [
      'Click "Reports" on the left.',
      'Read the four summary cards at the top — Clients, Dogs, Sessions and Revenue.',
      'Use the tabs ("Clients & dogs", "Sessions", "Engagement", "Revenue", "Custom fields") to switch what you\'re looking at.',
      'On any chart, click "View data" to see the exact numbers behind it.',
    ],
  },
  {
    slug: 'filter-reports',
    title: 'Filter your reports',
    category: 'Account & app',
    keywords: ['reports', 'filter', 'date range', 'team member', 'breed', 'narrow down'],
    summary: 'Narrow your reports down by team member, dates or dog breed.',
    steps: [
      'Click "Reports" on the left.',
      'In the "Filters" bar, pick a "Team member" to see just their numbers.',
      'Pick a "Date range" — or choose "Custom range" and set "From" and "To".',
      'Pick a "Breed" to focus on one type of dog.',
      'Click "Clear all" to go back to everything.',
    ],
  },
  {
    slug: 'create-email-template',
    title: 'Create a reusable email template',
    category: 'Account & app',
    keywords: ['email', 'template', 'reusable', 'canned', 'message', 'saved reply'],
    summary: 'Save an email you send often so you can reuse it in Messages.',
    steps: [
      'Click "Settings" on the left.',
      'Click the "Email templates" tab.',
      'Click "New template".',
      'Add a name, a subject and your message. Type {{clientName}}, {{dogName}} or {{businessName}} to fill in details automatically.',
      'Click "Create template". To use it later, open Messages and click the envelope button to pick a template.',
    ],
  },
  {
    slug: 'choose-notifications',
    title: 'Choose which notifications you get',
    category: 'Account & app',
    keywords: ['notifications', 'alerts', 'push', 'email', 'reminders', 'preferences'],
    summary: 'Pick what you\'re notified about, and whether it comes by phone or email.',
    steps: [
      'Click "Settings" on the left.',
      'Click the "Notifications" tab.',
      'For each row, tick the "Phone" and/or "Email" box to turn that notification on.',
      'Click "Customise" on a row to change its timing and wording, then "Done".',
      'Tap the "Phone" or "Email" icon at the top of a column to turn that channel on or off for everything. Use "Send test" to check it works.',
    ],
  },
  {
    slug: 'show-phone-to-clients',
    title: 'Show or hide your phone number',
    category: 'Account & app',
    keywords: ['phone', 'private', 'show number', 'call', 'contact', 'visibility'],
    summary: 'Decide whether clients can see and call your phone number.',
    steps: [
      'Click "Settings" on the left.',
      'Stay on the "Profile" tab and open "Business details".',
      'Find the tick box under "Phone number".',
      'Tick "Show my phone number to clients" to let them see and call it. Leave it unticked to keep it private.',
      'Click "Save business details".',
    ],
  },
  {
    slug: 'complete-your-profile',
    title: 'Complete your profile',
    category: 'Account & app',
    keywords: ['complete profile', 'business name', 'name', 'phone', 'setup', 'sign in with google', 'apple'],
    summary: 'Fill in the few details we need before you can use the app.',
    steps: [
      'On the "Finish setting up your account" screen, type "Your name".',
      'Type your "Business name" and "Phone number".',
      'Decide whether to tick "Show my phone number to clients".',
      'Add a "Business email" if you want clients to see one (optional).',
      'Click "Save and continue" to go to your dashboard.',
    ],
  },
  {
    slug: 'switch-business',
    title: 'Switch between businesses',
    category: 'Account & app',
    keywords: ['org', 'organisation', 'switch', 'business', 'multiple', 'team', 'company'],
    summary: 'If you belong to more than one business, switch which one you\'re working in.',
    steps: [
      'Find the business name with the building icon near the top of the sidebar.',
      'Click it to open the "Your organisations" list.',
      'Click the business you want to work in.',
      'The app reloads into that business\'s dashboard. (This only appears if you belong to more than one.)',
    ],
  },

  // ── Marketing & emails ─────────────────────────────────────────────────────
  {
    slug: 'turn-on-marketing',
    title: 'Turn on Marketing',
    category: 'Marketing & emails',
    keywords: ['marketing', 'bulk email', 'add-on', 'addon', 'enable', 'campaigns', 'switch on'],
    summary: 'Marketing is an add-on — switch it on to email your clients in bulk.',
    steps: [
      'Click "Settings" on the left.',
      'Click the "Add-ons" tab.',
      'Find the "Marketing" card and click its switch to turn it on.',
      '"Marketing" now appears in the left menu under Communication.',
      'It\'s a paid add-on — the price shows on the card and starts from your next billing cycle.',
    ],
  },
  {
    slug: 'send-bulk-email',
    title: 'Email all your clients',
    category: 'Marketing & emails',
    keywords: ['bulk email', 'campaign', 'newsletter', 'send email', 'marketing', 'blast', 'everyone'],
    summary: 'Write one email and send it to your clients, with open and click tracking.',
    steps: [
      'Click "Marketing" on the left.',
      'Click "New email".',
      'On "Create email", add a "Subject" and build your message with "Add text" and "Add image" blocks.',
      'Click "Choose recipients", then tick the clients to email (use "Select all shown" for everyone).',
      'Click "Review & send", check the preview, then click the "Send to …" button.',
    ],
  },
  {
    slug: 'email-some-clients',
    title: 'Email just a few clients',
    category: 'Marketing & emails',
    keywords: ['bulk email', 'selected', 'some clients', 'segment', 'marketing', 'pick'],
    summary: 'Pick a handful of clients first, then email only them.',
    steps: [
      'Click "Clients" on the left.',
      'Select the clients you want to email.',
      'Choose the email option that appears to open the composer with just those people.',
      'Build your email the same way as a campaign, then send it.',
    ],
  },
  {
    slug: 'personalise-email',
    title: 'Add a client\'s name to an email',
    category: 'Marketing & emails',
    keywords: ['placeholder', 'personalise', 'merge', 'client name', 'dog name', 'mail merge'],
    summary: 'Drop in each client\'s name, their dog or your business name automatically.',
    steps: [
      'In the email composer, click into the "Subject" or a text block.',
      'Under "Insert a placeholder", click "Client name", "Dog name", "Your name" or "Business name".',
      'The placeholder fills in with each recipient\'s own details when the email sends.',
      'Every email also includes an unsubscribe link automatically.',
    ],
  },
  {
    slug: 'filter-email-recipients',
    title: 'Choose who gets an email',
    category: 'Marketing & emails',
    keywords: ['recipients', 'filter', 'class', 'breed', 'custom field', 'search', 'segment'],
    summary: 'Narrow your recipient list by class, breed, a custom field or a search.',
    steps: [
      'In the composer, click "Choose recipients".',
      'Type in "Search clients by name, email or dog" to find people.',
      'Use the "Class", "Breed" or custom-field dropdowns to filter the list.',
      'Click "Select all shown" to pick everyone in the filtered list, or tick people one by one.',
      'Click "Clear filters" to start the list over.',
    ],
  },
  {
    slug: 'set-up-sending-domain',
    title: 'Set up your own email sending address',
    category: 'Marketing & emails',
    keywords: ['domain', 'dns', 'sending', 'verify', 'from address', 'deliverability', 'subdomain'],
    summary: 'Send marketing emails from your own domain so they land in inboxes.',
    steps: [
      'Click "Marketing" on the left.',
      'In "Set up email sending", type "Your domain" and click "Set up".',
      'Add the DNS records shown (Type, Name, Value) to your domain.',
      'Click "Check verification". Once it passes you\'ll see "Your domain is verified ✓".',
    ],
  },
  {
    slug: 'email-dns-to-developer',
    title: 'Get your developer to add your email records',
    category: 'Marketing & emails',
    keywords: ['dns', 'developer', 'web host', 'records', 'domain', 'help'],
    summary: 'Send your DNS records to whoever manages your domain.',
    steps: [
      'Click "Marketing", then open "Set up email sending".',
      'Find the "Don\'t manage your own DNS?" box.',
      'Type your developer\'s email address.',
      'Click "Email records". They\'ll get the records to add for you.',
    ],
  },
  {
    slug: 'try-test-sending',
    title: 'Try sending without setting up a domain',
    category: 'Marketing & emails',
    keywords: ['test', 'try', 'pupmanager address', 'trial', 'no dns', 'sending', 'limit'],
    summary: 'Send a test email from the PupManager address before setting up your domain.',
    steps: [
      'Click "Marketing" on the left.',
      'In "Set up email sending", click "Use the PupManager test domain".',
      'You can now send straight away — emails show as "your name via PupManager".',
      'On a trial you can email up to 5 clients a day; set up your own domain to send more.',
    ],
  },
  {
    slug: 'view-email-stats',
    title: 'See who opened your emails',
    category: 'Marketing & emails',
    keywords: ['stats', 'opens', 'clicks', 'tracking', 'sent emails', 'results', 'report'],
    summary: 'Track opens and clicks for every email you\'ve sent.',
    steps: [
      'Click "Marketing" on the left.',
      'Scroll to the "Sent emails" table.',
      'Read the "Opened" and "Clicked" columns for each campaign.',
      'Click a row to open that campaign and see the recipients.',
    ],
  },

  // ── Getting paid ───────────────────────────────────────────────────────────
  {
    slug: 'set-up-payments',
    title: 'Set up payments (get paid by clients)',
    category: 'Getting paid',
    keywords: ['payments', 'stripe', 'connect', 'get paid', 'payouts', 'bank', 'card', 'money'],
    summary: 'Connect Stripe so clients can pay you for packages, sessions and shop items.',
    steps: [
      'Click "Settings" on the left.',
      'Click the "Payments" tab.',
      'Click "Set up payments".',
      'Follow the Stripe steps: your business details, then a bank account for payouts.',
      'When you\'re done the status shows "Active" and you can start taking payments.',
    ],
  },
  {
    slug: 'request-payment',
    title: 'Get a client to pay an invoice',
    category: 'Getting paid',
    keywords: ['request payment', 'invoice', 'charge', 'collect', 'pay', 'pay link', 'package', 'session'],
    summary: 'Send a client their invoice with a secure pay-by-card link.',
    steps: [
      'Assign a priced package or product — an invoice is created for the client automatically.',
      'Open Finances → Invoices (or the client\'s Invoices tab) and open the invoice.',
      'Hit "Send" to email it, or "Copy pay link" to share the link yourself.',
      'The client opens the link and pays by card — no login needed. (Set up payments first in Settings → Payments.)',
    ],
  },
  {
    slug: 'accept-payments-toggle',
    title: 'Turn payments on or off',
    category: 'Getting paid',
    keywords: ['accept payments', 'display only', 'prices', 'card fees', 'toggle', 'payouts'],
    summary: 'Switch whether prices are payable, and whether clients cover card fees.',
    steps: [
      'Click "Settings" on the left, then the "Payments" tab.',
      'Turn "Accept payments" on so clients can pay (off makes prices display-only).',
      'Turn "Pass card fees to clients" on if you\'d like clients to cover the card fee.',
      'Use "Open Stripe dashboard →" to see payouts, or "Open Finances →" for invoices.',
    ],
  },

  // ── Clients (waitlist & comms) ─────────────────────────────────────────────
  {
    slug: 'add-to-waitlist',
    title: 'Add someone to your waitlist',
    category: 'Clients',
    keywords: ['waitlist', 'waiting', 'spot', 'full', 'queue', 'prospect', 'list'],
    summary: 'Keep a list of people waiting for a spot, and book them when one opens.',
    steps: [
      'Click "Waitlist" under Clients on the left.',
      'Click "Add to waitlist".',
      'Choose an existing client, or switch to "Prospect" for someone new.',
      'Add what they want — package, preferred days and times — then click "Add".',
      'When a spot opens, click "Book" on their row to schedule them.',
    ],
  },
  {
    slug: 'work-the-waitlist',
    title: 'Track who you\'ve contacted on the waitlist',
    category: 'Clients',
    keywords: ['waitlist', 'contacted', 'scheduled', 'waiting', 'status', 'follow up', 'reorder'],
    summary: 'Move people through Waiting, Contacted and Scheduled as you work the list.',
    steps: [
      'Click "Waitlist" under Clients on the left.',
      'Use the pills at the top — "Waiting", "Contacted", "Scheduled", "All" — to filter.',
      'Click "Mark contacted" once you\'ve reached out to someone.',
      'Click "Book" to schedule them — they move to "Scheduled".',
      'Drag a row by its handle to reorder who\'s next.',
    ],
  },
  {
    slug: 'client-comms-tab',
    title: 'See a client\'s emails and messages',
    category: 'Clients',
    keywords: ['comms', 'communication', 'history', 'emails', 'messages', 'client', 'thread'],
    summary: 'Look back over everything you\'ve sent a client in one place.',
    steps: [
      'Click "Clients" on the left and open the client.',
      'Click the "Comms" tab.',
      'Read their email and message history under "Emails & messages".',
      'Click "Open message thread →" to carry on the conversation.',
    ],
  },

  // ── Programmes & products (detail views) ───────────────────────────────────
  {
    slug: 'see-package-clients',
    title: 'See who\'s on a package',
    category: 'Programmes & products',
    keywords: ['package', 'programme', 'clients', 'who', 'revenue', 'completed', 'stats'],
    summary: 'Open a package to see its clients, revenue and how it\'s going.',
    steps: [
      'Click "Packages" on the left.',
      'Click a package to open it.',
      'Stay on "Details" for its sessions, price and settings.',
      'Click the "Clients" tab to see current and past clients, plus "Total clients", "Revenue" and "Active now".',
    ],
  },
  {
    slug: 'manage-class-roster',
    title: 'Manage a class roster',
    category: 'Scheduling',
    keywords: ['class', 'roster', 'enrol', 'waitlist', 'attendance', 'spots', 'clients'],
    summary: 'Open a class to enrol clients and track attendance and spots.',
    steps: [
      'Click "Classes" on the left.',
      'Click a class to open it.',
      'Click the "Clients" tab to see "Enrolled", "Spots left" and "Attendance".',
      'Click "Enrol client", pick the client, and click "Enrol".',
      'Use "Withdraw" or "Remove" on a row to take someone off.',
    ],
  },

  // ── Account & app (add-ons & dashboard scratchpad) ─────────────────────────
  {
    slug: 'turn-on-addon',
    title: 'Turn an add-on on or off',
    category: 'Account & app',
    keywords: ['add-on', 'addon', 'extras', 'enable', 'marketing', 'timesheets', 'route planner', 'switch on'],
    summary: 'Switch optional extras like Marketing, Timesheets and Route planner on or off.',
    steps: [
      'Click "Settings" on the left.',
      'Click the "Add-ons" tab.',
      'Read each card and click "Learn more" for the full details.',
      'Flip the switch on a card to turn that add-on on (or off).',
      'Free add-ons turn on straight away; paid ones start from your next billing cycle.',
    ],
  },
  {
    slug: 'dashboard-todos',
    title: 'Use the dashboard to-do list and brain dump',
    category: 'Account & app',
    keywords: ['to do', 'todo', 'brain dump', 'notes', 'scratchpad', 'tasks', 'dashboard'],
    summary: 'Jot quick tasks and loose notes right on your dashboard.',
    steps: [
      'Make sure the "To-do & brain dump" add-on is on (Settings → Add-ons).',
      'On your Dashboard, find the "To-do" / "Brain dump" panel on the right.',
      'On "To-do", type in "Add a to-do…" and press the plus to add it (assign a team member if you like).',
      'Tick an item off when it\'s done — it moves to "Done".',
      'Switch to "Brain dump" to type free notes; they save automatically.',
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
  {
    q: 'Why can\'t I send marketing emails?',
    a: 'You need the Marketing add-on switched on (Settings → Add-ons) and a sending address set up — either your own domain or the PupManager test domain to try it. On a trial you can email up to 5 clients a day.',
  },
  {
    q: 'When do add-on charges start?',
    a: 'Paid add-ons start from your next billing cycle, so there\'s no surprise mid-cycle charge. Free add-ons like Timesheets and the dashboard to-do list cost nothing.',
  },
  {
    q: 'How do clients pay me?',
    a: 'Set up payments in Settings → Payments (powered by Stripe). Once the status shows "Active" and "Accept payments" is on, clients can pay you by card for packages, sessions and shop items inside PupManager.',
  },
]
