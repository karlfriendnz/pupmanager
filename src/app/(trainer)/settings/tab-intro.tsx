'use client'

// Every settings tab used to open straight into controls, with nothing telling
// you what the setting was for or how to get it working. Each one now leads with
// the same three things: what this is, what it's for, and the steps to set it up.
//
// Copy rules: say what the trainer gets, not what the software does. Steps are
// the shortest honest path to "it's working" — if a tab needs more than four,
// the tab is doing too much.

export interface TabIntroCopy {
  title: string
  blurb: string
  steps: string[]
}

export const TAB_INTRO: Record<string, TabIntroCopy> = {
  profile: {
    title: 'Details',
    blurb:
      'Your business details — the name, contact info and country behind everything else. What your clients see when they need to reach you.',
    steps: [
      'Fill in your business name, contact details and the country you work in.',
      'Choose whether clients can see your phone number.',
      'Set the base address your travel and routes are measured from.',
    ],
  },
  design: {
    title: 'Design',
    blurb:
      'Your logo, icon and brand colour — what clients see in their app, on your booking pages and on every email you send. Your colour also tints your own home screen on a phone.',
    steps: [
      'Upload your logo (the full wordmark) and your icon (a square mark).',
      'Pick the brand colour used across your client app and emails.',
      'Check the preview to see how it looks to a client.',
    ],
  },
  notifications: {
    title: 'Notifications',
    blurb:
      'What PupManager tells you about, and how it reaches you. These are your own settings — each team member picks their own.',
    steps: [
      'Turn email or push on for the things you want to hear about.',
      'Turn off anything that becomes noise — you can change it any time.',
    ],
  },
  configure: {
    title: 'Configure',
    blurb:
      'Everything that comes with your plan, on or off in one tap. Nothing here costs extra — switch on the parts that match how you work and the rest stay out of your way.',
    steps: [
      'Switch on what you use — each one adds its screen straight away.',
      'Switch off what you don’t — a quieter app is easier to work in.',
      'Some need a moment to set up; the link appears once it’s on.',
    ],
  },
  naming: {
    title: 'What you call things',
    blurb:
      'Your menu, in your words. A groomer says “Services”, a daycare says “Programmes” — you shouldn’t have to translate your own software. Leave a box empty to keep ours.',
    steps: [
      'Type your word next to ours. It changes the menu and the page it opens.',
      'Rename a group heading and everything under it sits beneath your word.',
      'A few keep their names — Stripe, Finances, Reports — so help articles still make sense.',
    ],
  },
  addons: {
    title: 'Add-ons',
    blurb:
      'The paid extras. A few dollars a month each, added to your subscription and cancellable any time. Everything included with your plan lives on Configure instead.',
    steps: [
      'Open an add-on to read what it does.',
      'Turn it on — free ones start straight away, paid ones go on your next invoice.',
      'It appears in your menu immediately; turn it off any time.',
    ],
  },
  daycare: {
    title: 'Daycare',
    blurb:
      'How your doggy daycare runs — what you charge, and the parts you split the day into. The days your parts run on are the days your board shows.',
    steps: [
      'Set the name and price on the offering itself.',
      'Add a card for each part of the day, on each day it runs — morning, afternoon, full day.',
      'Give each part a capacity and a price, then save. Your board follows.',
    ],
  },
  forms: {
    title: 'Fields & forms',
    blurb:
      'Fields are what you track about a client and their dog. Forms are where you ask for them — the intake form new clients fill in, and session forms for writing up your sessions.',
    steps: [
      'On Fields, hit "Suggest fields" and tick the ones you want — we suggest the usual ones for the work you do.',
      'The columns say where each field is asked: on intake, on quick add, and whether it has to be filled in.',
      'On Forms, preview your intake form and publish it when it looks right.',
    ],
  },
  locations: {
    title: 'Locations',
    blurb:
      'The places you work from — a training field, a hall you hire, a park you meet at. Save each one once, then pick it when you set up a 1:1 session, class or session instead of retyping the address.',
    steps: [
      'Add a location: give it a name and search for its address.',
      'Add a photo and any notes — parking, gate codes, where to meet.',
      'Pick it later when you create a 1:1 session, class or session.',
    ],
  },
  integration: {
    title: 'Connect Website',
    blurb:
      'Hook PupManager up to your own website: a branded login link for your clients, booking pages they can book you from, and forms you can embed to capture new enquiries.',
    steps: [
      'Copy your client login link and add it to your website menu.',
      'Create a booking page for the sessions you want people to book.',
      'Embed an enquiry form to capture leads straight into PupManager.',
    ],
  },
  team: {
    title: 'Team',
    blurb:
      'The people who work with you. Invite them, choose what they can see and do, and assign clients and sessions to them.',
    steps: [
      'Invite a team member by email — they set their own password.',
      'Give them a role: what they can see and change follows from it.',
      'Assign clients or sessions to them from the schedule.',
    ],
  },
  payments: {
    title: 'Payments',
    blurb:
      'Take card payments from your clients — for sessions, 1:1 sessions and class enrolments — straight through the app. Money lands in your bank account, not ours.',
    steps: [
      'Connect your Stripe account (or create one — it takes a few minutes).',
      'Choose which of your 1:1 sessions and classes need paying for up front.',
      'Clients pay in their app; you see it in Finances.',
    ],
  },
  xero: {
    title: 'Xero',
    blurb:
      "Send your invoices and payments to Xero automatically, so your books keep themselves up to date and you're not typing anything twice.",
    steps: [
      'Connect your Xero account.',
      'Map your products to the right income accounts and tax rates.',
      'Invoices and payments then sync across on their own.',
    ],
  },
  billing: {
    title: 'Billing',
    blurb:
      'Your own PupManager subscription — your plan, your seats, your invoices, and the card we bill.',
    steps: [
      'Check your plan and how many team seats you need.',
      'Update your card or download an invoice any time.',
    ],
  },
  activity: {
    title: 'Activity',
    blurb:
      'A record of what happened in your account and who did it — useful when you have a team, or when something changed and you want to know why.',
    steps: ['Scroll the log, or filter it by person or by what they did.'],
  },
}

export function TabIntro({ tab }: { tab: string }) {
  const copy = TAB_INTRO[tab]
  if (!copy) return null

  return (
    <div className="mb-6 max-w-2xl">
      <h2 className="font-display text-xl font-bold text-slate-900">{copy.title}</h2>
      <p className="text-sm text-slate-500 mt-1 leading-relaxed">{copy.blurb}</p>

      <ol className="mt-3 flex flex-col gap-1.5">
        {copy.steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm text-slate-600">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-teal-50 text-[11px] font-semibold text-teal-700">
              {i + 1}
            </span>
            <span className="leading-relaxed">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
