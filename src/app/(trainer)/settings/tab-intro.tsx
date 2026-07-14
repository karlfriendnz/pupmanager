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
    title: 'Profile',
    blurb:
      'Your business details and branding — the name, logo and colours your clients see in their app, on your booking pages and on every email you send.',
    steps: [
      'Fill in your business name, contact details and the country you work in.',
      'Upload your logo and pick your brand colours.',
      'Choose whether clients can see your phone number.',
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
  addons: {
    title: 'Add-ons',
    blurb:
      'The parts of PupManager you switch on as you need them. Some are free, some are a few dollars a month — turn on only what suits how you work.',
    steps: [
      'Open an add-on to read what it does.',
      'Turn it on — free ones start straight away, paid ones go on your next invoice.',
      'It appears in your menu immediately; turn it off any time.',
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
      'Take card payments from your clients — for sessions, packages and class enrolments — straight through the app. Money lands in your bank account, not ours.',
    steps: [
      'Connect your Stripe account (or create one — it takes a few minutes).',
      'Choose which of your packages and classes need paying for up front.',
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
