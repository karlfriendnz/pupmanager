import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Marketing's audience used to be `status: 'ACTIVE'`, which quietly excluded
// every client sitting at status NEW — precisely the never-booked group, and
// the one a trainer most wants to follow up. Now that activity is derived, the
// audience is "everyone except archived" and the trainer CHOOSES the cut:
//
//   Past     — finished a course. The repeat-and-referral pool.
//   Contacts — on the list, never booked. The follow-up pile.
//   Current  — mid-course right now.
//
// Which is the honest answer to "who should this go to": not a filter buried in
// a query, but a control on the screen where the email is written.
const page = readFileSync('src/app/(trainer)/marketing/new/page.tsx', 'utf8')
const composer = readFileSync('src/app/(trainer)/clients/email-composer.tsx', 'utf8')

describe('the marketing audience', () => {
  it('is everyone except the people you have archived', () => {
    // The candidate query itself, not the comment above it explaining why.
    const where = page.split('\n').find(l => l.includes('where: { trainerId,') && l.includes('marketingEmailOptOut'))
    expect(where).toBeDefined()
    expect(where).toContain('...notArchived')
    expect(where).not.toContain("status: 'ACTIVE'")
  })

  // One definition, shared. "Past" in the composer has to mean what "Past"
  // means on the clients list, or the two drift and nobody notices.
  it('works out each stage with the clients list’s own filters', () => {
    expect(page).toContain("whereForView('current', now)")
    expect(page).toContain("whereForView('never', now)")
    expect(page).toContain("from '@/lib/client-activity'")
  })

  it('labels the stages from the same place the tabs do', () => {
    expect(page).toContain('VIEW_LABEL[v]')
  })

  // A stage nobody mailable is in would be a dead option.
  it('only offers a stage that somebody is actually in', () => {
    expect(page).toContain('.filter(st => st.count > 0)')
  })

  it('tells the trainer how many are in each', () => {
    expect(page).toContain('count: eligibleCandidates.filter(c => c.stage === v).length')
  })
})

describe('the composer', () => {
  it('can filter recipients by stage', () => {
    expect(composer).toContain("if (fStage && c.stage !== fStage) return false")
  })

  it('offers it first, ahead of breed and class', () => {
    const stage = composer.indexOf('label="Stage"')
    const cls = composer.indexOf('label="Class"')
    expect(stage).toBeGreaterThan(-1)
    expect(stage).toBeLessThan(cls)
  })

  it('clears with the other filters', () => {
    expect(composer).toContain("setFStage('')")
  })

  // Recomputing the recipient list has to notice the stage changing.
  it('recomputes the list when the stage changes', () => {
    expect(composer).toContain('[candidates, recipientQuery, fStage, fBreed, fClass, customFilters]')
  })
})
