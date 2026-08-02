// Help-center content: everything a trainer SELLS.
//
// Sibling of content.ts — same voice, same shape, same rules. Short steps, one
// action per line, controls named exactly as they read on screen. Every step
// here was walked in the running app before it was written down.
//
// Wired into the Help page alongside HELP_ARTICLES.

import type { HelpArticle } from './content'

export const OFFERING_ARTICLES: HelpArticle[] = [
  // ── Finding your way round ────────────────────────────────────────────────
  {
    slug: 'find-your-offerings',
    title: 'Find everything you sell in one place',
    category: 'Programmes & products',
    keywords: [
      'offerings', 'what i sell', 'hub', 'all', 'products', 'classes',
      'packages', 'where is', 'menu', 'list',
    ],
    summary: 'One screen listing every kind of thing you sell, and how many of each you have.',
    steps: [
      'Look at the left menu for the "Offerings" heading. Everything under it is something you sell.',
      'On a phone, tap "Offerings" on your home screen instead.',
      'Each row shows a count, like "3 classes", or "tap to create one" if you have none.',
      'Only the kinds you\'ve switched on appear. See "Turn on Events, Casual Classes or Packages" to add more.',
      '"Tags" sits at the bottom. It isn\'t a thing you sell — it\'s a word that crosses all of them.',
    ],
  },
  {
    slug: 'turn-on-offering-type',
    title: 'Turn on Events, Casual Classes or Packages',
    category: 'Programmes & products',
    keywords: [
      'events', 'packages', 'casual classes', 'drop in', 'turn on', 'enable',
      'missing', 'not there', 'switch on', 'configure', 'memberships',
    ],
    summary: 'Each kind of offering has its own switch. Turn on the ones that match how you work.',
    steps: [
      'Open Settings (the cog at the top right, or the menu on a phone).',
      'Click the "Configure" tab.',
      'Find the "What you offer" group at the top.',
      'Switch on "Events", "Packages", "Casual classes" or "Group classes".',
      'The screen appears in your left menu straight away. Nothing here costs extra.',
    ],
  },

  // ── 1:1 programmes ────────────────────────────────────────────────────────
  {
    slug: 'assign-package-to-client',
    title: 'Give a client a 1:1 programme',
    category: 'Programmes & products',
    keywords: [
      'assign', 'package', '1:1 session', 'programme', 'sign up client',
      'book a course', 'give', 'start', 'sell to client',
    ],
    summary: 'Put a client on a 1:1 programme and book all its sessions in one go.',
    steps: [
      'Click "Clients" on the left and open the client.',
      'Under "Client actions", click "Assign 1:1 session".',
      'Pick the programme from the "1:1 Session" list, then pick the dog.',
      'Set a "Start day". PupManager fills in every session for you, using your free time.',
      'Check the "Proposed sessions" list, choose "Create an invoice" or "Already invoiced", then click "Assign & create sessions".',
    ],
  },
  {
    slug: 'track-package-progress',
    title: 'See how far a client is through a programme',
    category: 'Programmes & products',
    keywords: [
      'progress', 'sessions used', 'sessions left', 'run out', 'finished',
      'completed', 'how many left', 'renew', 'top up', 'package',
    ],
    summary: 'Check who has sessions left, who has finished, and what to do next.',
    steps: [
      'Click "1:1 Sessions" on the left and open the programme.',
      'Click the "Clients" tab.',
      'The "Sessions" column reads like "3 / 6" — used out of bought.',
      'When someone reaches the last one they turn into "Completed" and move to the "Past" tab.',
      'Sessions don\'t top themselves up. To carry on, assign the programme to them again from their client page.',
    ],
  },
  {
    slug: 'plan-session-by-session',
    title: 'Plan what each session covers',
    category: 'Programmes & products',
    keywords: [
      'curriculum', 'plan', 'session 1', 'what we cover', 'lesson plan',
      'week 1', 'steps', 'series', 'description',
    ],
    summary: 'Write the plan for session 1, session 2 and so on. Your clients read it.',
    steps: [
      'Open the programme or class, then click the "Sessions" tab.',
      'You\'ll see a numbered row for every session, plus "Every session" at the bottom.',
      'Tap a session to open it.',
      'Fill in "What you\'ll cover" — this is the bit your client reads.',
      'Use "Private note" for anything only you should see.',
      'Click "All sessions" to go back and do the next one.',
    ],
  },

  // ── Homework ──────────────────────────────────────────────────────────────
  {
    slug: 'default-homework',
    title: 'Set the homework an offering hands out',
    category: 'Programmes & products',
    keywords: [
      'homework', 'default homework', 'tasks', 'exercises', 'library',
      'every session', 'set once', 'training tasks',
    ],
    summary: 'Choose the homework for each session once, instead of picking it every time.',
    steps: [
      'Open the programme or class, then click the "Sessions" tab. (On a one-off or ongoing offering that tab reads "Homework".)',
      'Tap the session you want to set homework for.',
      'Under "Homework", click "Add homework".',
      'Search your library and tap a task to add it. Click "Add another" for more.',
      'Use the "Every session" row for homework that goes out after all of them.',
      'Nothing sends on its own — when you write up a session these are waiting for you to confirm in one tap.',
    ],
  },
  {
    slug: 'homework-before-or-after',
    title: 'Send homework before a session, not after',
    category: 'Programmes & products',
    keywords: [
      'before', 'after', 'preparation', 'bring', 'hungry dog', 'chicken',
      'read first', 'homework timing', 'prep', 'in advance',
    ],
    summary: '"Bring a hungry dog and some chicken" is no use read on the way home. Mark it "Before".',
    steps: [
      'Open the programme or class, then click the "Sessions" tab.',
      'Tap the session, and find the homework row under "Homework".',
      'Under the task name you\'ll see two buttons: "Before the session" and "After the session".',
      'Click "Before the session" for anything they must do or bring first.',
      'Leave it on "After the session" for practice — the client can\'t see that until the session has started or you\'ve marked it done.',
      '"Before" homework shows the moment you hand it over, however many weeks early, and stays on their list until the session.',
    ],
  },

  // ── Group classes ─────────────────────────────────────────────────────────
  {
    slug: 'enrol-client-in-class',
    title: 'Enrol a client into a class',
    category: 'Scheduling',
    keywords: [
      'enrol', 'enroll', 'add to class', 'sign up', 'spot', 'place',
      'roster', 'book into class', 'seat',
    ],
    summary: 'Put a client and their dog on a class roster, and raise the invoice at the same time.',
    steps: [
      'Click "Group Classes" on the left and open the class.',
      'Click the "Clients" tab. The seats read like "6 / 8" at the top.',
      'Click "Enrol client", pick the person on "Step 1 of 2 · Who", then click "Next".',
      'On "Step 2 of 2", leave "Notify the client they\'re enrolled" ticked so they know.',
      'Leave "Send the invoice" ticked to put a "Pay now" button in their email, or untick it to raise it quietly and chase it later.',
      'Click "Enrol". Use "Withdraw" on their row to take them off later.',
    ],
  },
  {
    slug: 'class-waitlist',
    title: 'Keep a waitlist when a class is full',
    category: 'Programmes & products',
    keywords: [
      'waitlist', 'full', 'no spaces', 'sold out', 'queue', 'waiting list',
      'capacity', 'turned away',
    ],
    summary: 'Let people register interest once every place is taken, instead of being turned away.',
    steps: [
      'Open the class, then click "Edit" at the top of "Details".',
      'Scroll to the "Settings" section.',
      'Tick "Keep a waitlist when this is full".',
      'Click "Save changes". The class\'s "Waitlist" line now reads "Enabled".',
      'Someone on the waitlist is enrolled automatically when a place frees up.',
      'To see everyone waiting, open "Clients" in the left menu, then click "Waitlist".',
    ],
  },

  // ── Casual / drop-in classes ──────────────────────────────────────────────
  {
    slug: 'create-casual-class',
    title: 'Set up a casual class people drop into',
    category: 'Programmes & products',
    keywords: [
      'casual', 'drop in', 'dropin', 'single session', 'pay per session',
      'one off spot', 'social walk', 'regulars', 'per session price',
    ],
    summary: 'A timetable of single sessions. Each one has its own day, time, price and limit.',
    steps: [
      'Click "Casual Classes" on the left, then "New casual class".',
      'Type a name and click "Next".',
      'On "Sessions & schedule", set the "Day", the "Starts from" date and the "Time" for your first slot.',
      'Add a "Capacity" and a "Price" for that slot, and set "Repeat" to "Weekly" if it runs every week.',
      'Click "Add session" for each other slot you run — a Tuesday morning and a Saturday can have different prices.',
      'Click "Next", then "Create offering".',
    ],
  },
  {
    slug: 'change-casual-class-slots',
    title: 'Change the days and prices of a casual class',
    category: 'Programmes & products',
    keywords: [
      'casual', 'drop in', 'slot', 'change price', 'add a day', 'timetable',
      'duplicate', 'reorder sessions', 'remove a day',
    ],
    summary: 'Add a day, drop one, or change what a single slot costs.',
    steps: [
      'Click "Casual Classes" on the left and open the class.',
      'Click "Edit" at the top of "Details".',
      'Go to the "Sessions & schedule" section.',
      'Change the day, time, capacity or price on any session card.',
      'Use "Duplicate this session" to copy one, or "Remove this session" to drop it. Drag the handle to reorder.',
      'Click "Save changes".',
    ],
  },

  // ── One week of a run ─────────────────────────────────────────────────────
  {
    slug: 'cancel-one-class-week',
    title: 'Cancel one week of a class',
    category: 'Scheduling',
    keywords: [
      'cancel a class', 'skip a week', 'holiday', 'public holiday',
      'labour day', 'closed', 'one week', 'no class this week', 'sick',
    ],
    summary: 'Call off a single week without touching the other fifteen.',
    steps: [
      'Click "Casual Classes" on the left and open the class.',
      'Click the "Sessions" tab and find the week you want to call off.',
      'Click the "…" button at the end of that row.',
      'Click "Cancel just this one".',
      'Type what they should be told — "Labour Day", say — then click "Cancel this session".',
      'Nobody loses their place. Bookings for that week stay booked, so you can refund or move them yourself.',
    ],
  },
  {
    slug: 'move-one-class-week',
    title: 'Move one week of a class to a different time',
    category: 'Scheduling',
    keywords: [
      'move a class', 'reschedule', 'one week', 'different time', 'hall',
      'venue', 'change time', 'later', 'this week only', 'shorter',
    ],
    summary: 'Run one week at a different time, length or venue. The rest of the run stays put.',
    steps: [
      'Click "Casual Classes" on the left and open the class.',
      'Click the "Sessions" tab and find the week you want to move.',
      'Click the "…" button at the end of that row, then "Move just this one".',
      'Set the new "Starts" date and time. Change "Minutes" if it runs shorter or longer.',
      'Type a "Where" if it\'s at a different venue, or leave it blank to keep the usual one.',
      'Click "Move this session". Only that week moves, and nothing puts it back.',
    ],
  },
  {
    slug: 'undo-a-cancelled-week',
    title: 'Put a cancelled week back on',
    category: 'Scheduling',
    keywords: [
      'undo', 'uncancel', 'put back', 'reinstate', 'mistake', 'restore',
      'cancelled by accident', 'back on',
    ],
    summary: 'Changed your mind about a week you called off? Turn it back on.',
    steps: [
      'Open the class and click the "Sessions" tab.',
      'A cancelled week has a line through it and says why.',
      'Click the "…" button at the end of that row.',
      'Click "Put this one back on". It runs as normal again.',
    ],
  },

  // ── Events ────────────────────────────────────────────────────────────────
  {
    slug: 'create-event',
    title: 'Sell tickets to a one-off event',
    category: 'Programmes & products',
    keywords: [
      'event', 'workshop', 'seminar', 'meet up', 'ticket', 'one off',
      'single date', 'guest list', 'early bird',
    ],
    summary: 'A workshop, seminar or meet-up on one date, with tickets people buy.',
    steps: [
      'Click "Events" on the left, then "New event".',
      'Type a name and click "Next".',
      'Set the "Date", "Time" and "Duration (mins)", plus a "Capacity" and a "Location" if you need them.',
      'Click "Next" to reach "Pricing".',
      'Under "Tickets", type a "Ticket name", a "Price" and a "Capacity" — "Early bird", say. Click "Add ticket" for another kind.',
      'Click "Next", then "Create offering".',
    ],
  },
  {
    slug: 'manage-event-guests',
    title: 'See who is coming to an event',
    category: 'Programmes & products',
    keywords: [
      'event', 'guest list', 'attendees', 'who is coming', 'tickets sold',
      'sign ups', 'places left', 'takings',
    ],
    summary: 'Check your ticket sales and add someone to the guest list yourself.',
    steps: [
      'Click "Events" on the left and open the event.',
      'Stay on "Details" to see "Tickets" — each kind shows "sold" and "left".',
      'Read "Capacity" and "Takings" for the totals.',
      'Click the "Guest list" tab for everyone who has signed up.',
      'Click "Enrol client" to add someone yourself.',
    ],
  },

  // ── Packages (bundles) ────────────────────────────────────────────────────
  {
    slug: 'create-membership-package',
    title: 'Bundle things together into a package',
    category: 'Programmes & products',
    keywords: [
      'package', 'bundle', 'membership', 'combo', 'deal', 'starter pack',
      'buy in one go', 'included', 'offer',
    ],
    summary: 'Sell a 1:1 programme, a class place and a product together for one price.',
    steps: [
      'Click "Packages" on the left, then "New package".',
      'Type a "Package name" and a "Price". Leave it on "One-off".',
      'Click "Included", then "Add item".',
      'Choose "1:1 session", "Class place" or "Product", then pick the exact one. Click "Add item" for each extra thing.',
      'Tick "Published (buyable on your booking page)" when you want clients to see it.',
      'Click "Save". The preview on the right is exactly what your client sees.',
    ],
  },
  {
    slug: 'package-who-can-buy',
    title: 'Choose who can buy a package',
    category: 'Programmes & products',
    keywords: [
      'package', 'who can join', 'invite only', 'private', 'achievement',
      'earned', 'members only', 'hidden package', 'exclusive',
    ],
    summary: 'Open a package to everyone, to people who\'ve earned it, or only to people you invite.',
    steps: [
      'Click "Packages" on the left and open the package.',
      'Click "Who it\'s for".',
      'Under "Who can join this?", pick one of the three.',
      '"Anyone" — every client can see and buy it.',
      '"Once they\'ve earned it" — they must already hold the achievements you pick.',
      '"Only people I invite" — nobody sees a way in until you invite them. Click "Save".',
    ],
  },

  // ── Doggy Daycare ─────────────────────────────────────────────────────────
  {
    slug: 'doggy-daycare-setup',
    title: 'Set up Doggy Daycare',
    category: 'Programmes & products',
    keywords: [
      'daycare', 'doggy daycare', 'day care', 'day parts', 'half day',
      'full day', 'week board', 'drop off', 'pick up', 'creche',
    ],
    summary: 'Doggy Daycare isn\'t switched on for most trainers yet — ask us first, then set up your day-parts.',
    steps: [
      'Doggy Daycare is still being finished, so you can\'t switch it on yourself. Ask PupManager to turn it on for you.',
      'Once it\'s on, open Settings → "Configure" and find "Doggy Daycare" (it\'s marked "Unfinished").',
      'Click "Set up your daycare".',
      'Type a "School name" and pick how you sell the day: "Full day", "Half days", or "Full day + half days".',
      'Under "Parts of the day", give each part its hours, price and limit, and tick the days it "Runs". Use "Add a part" for more.',
      'Set a "Starts from" date and click "Create doggy daycare".',
    ],
  },
  {
    slug: 'doggy-daycare-day',
    title: 'Run your daycare week',
    category: 'Scheduling',
    keywords: [
      'daycare', 'board', 'week board', 'today', 'who is in', 'day parts',
      'change price', 'add a part', 'daycare settings',
    ],
    summary: 'The week board shows who is booked into each part of each day.',
    steps: [
      'Doggy Daycare has no menu item yet. Add /doggy-daycare to the end of your PupManager web address to open the board.',
      'The board shows this week, split into the parts you set up. It says "No sessions scheduled this week yet" until bookings start.',
      'Click "Daycare settings" at the top to change anything.',
      'Under "Parts of the day", tap a row to change its time, price, capacity or venue. Click "Add part" for a new one.',
      'Click "Name & price" to rename the daycare or change what it costs.',
      'Days already in the diary keep the times they were created with — change one of those on the day itself.',
    ],
  },

  // ── Across every offering ─────────────────────────────────────────────────
  {
    slug: 'hold-offering-back',
    title: 'Build next term now, show it later',
    category: 'Programmes & products',
    keywords: [
      'hide', 'hidden', 'not yet', 'next term', 'publish', 'go live',
      'release date', 'coming soon', 'draft', 'schedule', 'hold back',
    ],
    summary: 'Set up next term today, and let clients see it on the date you choose.',
    steps: [
      'Open the class, 1:1 session, casual class or event, then click "Edit".',
      'Scroll to the "Settings" section.',
      'Tick "Hold this back until a date".',
      'A "Clients see it from" box appears. Pick the date.',
      'Click "Save changes".',
      'Until that morning it\'s yours alone — it won\'t show on their booking screen, your booking page, or anywhere else.',
    ],
  },
  {
    slug: 'reorder-offerings',
    title: 'Change the order clients see things in',
    category: 'Programmes & products',
    keywords: [
      'order', 'reorder', 'sort', 'move up', 'first', 'top', 'drag',
      'rearrange', 'position', 'sequence',
    ],
    summary: 'Drag your list into the order you want. That order is what clients get when they book.',
    steps: [
      'Open "1:1 Sessions", "Group Classes", "Casual Classes", "Events" or "Packages".',
      'Find the drag handle at the left of a row (its label is "Drag to reorder").',
      'Drag the row up or down. On a phone, press and hold, then drag.',
      'The order saves on its own — there\'s no Save button.',
      'Put your best seller first. That\'s the order clients see when they book.',
    ],
  },
  {
    slug: 'tag-an-offering',
    title: 'Put a tag on something you sell',
    category: 'Programmes & products',
    keywords: [
      'tag', 'tags', 'label', 'puppy', 'group', 'browse by tag', 'category',
      'theme',
    ],
    summary: 'One word — "Puppy", say — that ties a class, a 1:1 session and a product together.',
    steps: [
      'Open the class, 1:1 session, casual class or event, then click "Edit".',
      'In the "Details" section, find "Tags".',
      'Click "New tag", type a word, and click "Add" — or tap a tag you already have.',
      'Click "Save changes".',
      'Do the same on anything else that belongs under that word.',
      'For the full picture, see "Group things together with a tag".',
    ],
  },
  {
    slug: 'group-offerings-by-tag',
    title: 'Group your list by tag',
    category: 'Programmes & products',
    keywords: [
      'group by tag', 'sort by tag', 'headings', 'find', 'long list',
      'tidy', 'browse',
    ],
    summary: 'Break a long list into headed groups so you can find your place.',
    steps: [
      'Open "1:1 Sessions", "Group Classes", "Casual Classes" or "Events".',
      'Look for the tag button in the bar at the top — it reads "Group by tag".',
      'Click it. Your list splits into a heading per tag, with a count beside each.',
      'Click it again to go back to one flat list.',
      'The button only appears once something in that list has a tag on it.',
    ],
  },
  {
    slug: 'duplicate-or-convert-offering',
    title: 'Copy an offering, or turn it into another kind',
    category: 'Programmes & products',
    keywords: [
      'copy', 'duplicate', 'clone', 'convert', 'change type', 'reuse',
      'next term', 'same again', 'turn into', 'delete',
    ],
    summary: 'Run the same class again next term, or turn a course into casual sessions.',
    steps: [
      'Open the class, casual class, event or 1:1 session.',
      'Click the "…" button beside "Edit" at the top of "Details".',
      'Click "Duplicate this class" to open a copy you can change. (It names whatever you opened — "Duplicate this event", "Duplicate this package".)',
      'On a group class you also get "Convert to a casual class" so people book single sessions, and "Convert to an event" for a one-off.',
      '"Delete this class" is on the same menu — it asks first, and it can\'t be undone.',
    ],
  },
  {
    slug: 'require-payment-to-book',
    title: 'Make clients pay before they get a place',
    category: 'Programmes & products',
    keywords: [
      'payment', 'pay first', 'up front', 'deposit', 'require payment',
      'confirm spot', 'no shows', 'prepay',
    ],
    summary: 'Ask for the money up front so a place is only held once it\'s paid for.',
    steps: [
      'Open the 1:1 session, class or event and click "Edit".',
      'Go to the "Pricing" section.',
      'Turn on "Require payment to book", then click "Save changes".',
      'A casual class has no "Pricing" section — each session sets its own. Open "Sessions & schedule" and pick "Require payment" or "Don\'t require" on that session card.',
      'This only bites once you can take card payments (Settings → Integrations → "Card payments").',
    ],
  },
]
