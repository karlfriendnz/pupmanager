// Audit-only: the drift that actually bites is WHERE a control is, not what it
// is called ("Click Settings on the left" long after Settings left the desktop
// menu). Check every step that makes a location claim against the real nav.
// Run: npx tsx tests/audit/check-locations.ts
import { HELP_ARTICLES } from '../../src/lib/help/content'
import fs from 'fs'

// ── Ground truth, read off app-shell.tsx TRAINER_NAV ──────────────────────
// Top-level rows the DESKTOP sidebar renders.
const DESKTOP_LEFT = [
  'Dashboard', 'Messages', 'Schedule',
  'Clients',
  '1:1 Sessions', 'Group Classes', 'Casual Classes', 'Events', 'Packages', 'Tags',
  'Route', 'Library', 'Products', 'Achievements',
  'Marketing', 'Instagram link',
  'Finances', 'Stripe', 'Timesheets', 'Reports',
]
// Children: a hover flyout on desktop, flat rows in the phone "More" sheet.
// Reached "under" their parent, never as a top-level row of their own.
const NAV_CHILDREN: Record<string, string[]> = {
  Clients: ['Enquiries', 'Notes', 'Waitlist'],
}
// desktopHidden — NOT on the desktop left menu at all.
const NOT_ON_DESKTOP_LEFT = ['Settings', 'Help']
// Section headings in the sidebar.
const NAV_SECTIONS = ['Clients', 'Offerings', 'Tools', 'Business']

// ── Ground truth, read off settings/settings-tabs.tsx ALL_TABS ────────────
const SETTINGS_TABS = [
  'Details', 'Design', 'Notifications', 'Configure', 'What you call things',
  'Add-ons', 'Daycare', 'Forms', 'Locations', 'Integrations', 'Email templates',
  'Team', 'Billing', 'Activity',
]
// Real tabs, but reached through an Integrations card's Manage link, not the menu.
const SETTINGS_TABS_HIDDEN = ['Connect Website', 'Calendar', 'Payments', 'Xero']

type Finding = { slug: string; title: string; step: number; text: string; problem: string }
const findings: Finding[] = []
let claims = 0

const LEFT_RE = /"([^"]+)"\s+(?:on|in)\s+the\s+left/gi
const LEFT_MENU_RE = /(?:open|click)\s+"([^"]+)"\s+in\s+the\s+left\s+menu(?:,\s*then\s+(?:click|open)\s+"([^"]+)")?/gi
const TAB_RE = /(?:click|open|stay on)\s+the\s+"([^"]+)"\s+tab/gi

for (const a of HELP_ARTICLES) {
  a.steps.forEach((step, i) => {
    const add = (problem: string) => findings.push({ slug: a.slug, title: a.title, step: i + 1, text: step, problem })

    // 1. '… "X" on the left'
    for (const m of step.matchAll(LEFT_RE)) {
      claims++
      const name = m[1]
      if (DESKTOP_LEFT.includes(name)) continue
      if (NOT_ON_DESKTOP_LEFT.includes(name)) { add(`"${name}" is NOT on the desktop left menu (desktopHidden)`); continue }
      const parent = Object.keys(NAV_CHILDREN).find(p => NAV_CHILDREN[p].includes(name))
      if (parent) { add(`"${name}" is a CHILD of "${parent}" — not a top-level left-menu row`); continue }
      if (NAV_SECTIONS.includes(name)) continue // a heading, fine
      add(`"${name}" is not a left-menu row at all`)
    }

    // 2. 'Open "X" in the left menu, then click "Y"'
    for (const m of step.matchAll(LEFT_MENU_RE)) {
      claims++
      const [, parent, child] = m
      if (!DESKTOP_LEFT.includes(parent) && !NAV_SECTIONS.includes(parent)) add(`"${parent}" is not a left-menu row`)
      if (child && !(NAV_CHILDREN[parent] ?? []).includes(child)) add(`"${child}" is not a child of "${parent}"`)
    }

    // 3. 'Click the "X" tab' — only meaningful when the article is in Settings.
    const inSettings = a.steps.slice(0, i + 1).some(s => /open settings|settings →|settings,/i.test(s))
    for (const m of step.matchAll(TAB_RE)) {
      const name = m[1]
      if (!inSettings) continue
      claims++
      if (SETTINGS_TABS.includes(name)) continue
      if (SETTINGS_TABS_HIDDEN.includes(name)) { add(`Settings tab "${name}" exists but is menuHidden — it is reached through an Integrations card, not the tab list`); continue }
      add(`"${name}" is not a Settings tab`)
    }
  })
}

console.log(`location claims checked: ${claims}`)
console.log(`problems: ${findings.length}\n`)
for (const f of findings) {
  console.log(`── ${f.slug} (step ${f.step}) — ${f.title}`)
  console.log(`   ${f.problem}`)
  console.log(`   ↳ ${f.text}\n`)
}
fs.writeFileSync('tests/audit/out/location-findings.json', JSON.stringify(findings, null, 2))
