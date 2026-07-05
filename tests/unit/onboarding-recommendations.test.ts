import { describe, it, expect } from 'vitest'
import { ADDONS } from '@/lib/pricing'
import { defaultAnswers, recommendedAddons, coreAddonState, questionApplies, packageOptionsFor, WIZ_QUESTIONS, MANAGED_ADDON_IDS } from '@/lib/onboarding-recommendations'

describe('onboarding recommendations', () => {
  it('every option (and follow-up) maps only to real add-on ids', () => {
    const ids = new Set(ADDONS.map(a => a.id))
    for (const q of WIZ_QUESTIONS) {
      for (const opt of q.options) {
        for (const addon of opt.addons) {
          expect(ids.has(addon as never), `${addon} is a real add-on`).toBe(true)
        }
        for (const fopt of opt.followUp?.options ?? []) {
          for (const addon of fopt.addons) {
            expect(ids.has(addon as never), `${addon} is a real add-on`).toBe(true)
          }
        }
      }
    }
  })

  it('accounting software → Xero switches on the Xero add-on', () => {
    const rec = recommendedAddons({ invoice: 'software', invoiceSoftware: 'xero', team: 'solo', travel: 'no' })
    expect(rec.has('xero')).toBe(true)
  })

  it('accounting software → a non-Xero tool does NOT switch on Xero', () => {
    for (const tool of ['stripe', 'hnry', 'quickbooks', 'other']) {
      const rec = recommendedAddons({ invoice: 'software', invoiceSoftware: tool })
      expect(rec.has('xero'), `${tool} should not enable Xero`).toBe(false)
    }
  })

  it('accounting software with no tool chosen yet does not enable Xero', () => {
    expect(recommendedAddons({ invoice: 'software' }).has('xero')).toBe(false)
  })

  it('manual invoicing does not enable Xero', () => {
    expect(recommendedAddons({ invoice: 'manual' }).has('xero')).toBe(false)
  })

  it('growth add-ons (marketing, lead magnets) are NOT part of onboarding', () => {
    // Deferred to Settings — onboarding only decides operational add-ons.
    expect(MANAGED_ADDON_IDS).not.toContain('marketing')
    expect(MANAGED_ADDON_IDS).not.toContain('leadmagnets')
  })

  it('a mobile role (dog walker) defaults to travelling → recommends route planner', () => {
    const answers = defaultAnswers(['walker'])
    expect(answers.travel).toEqual(['travel'])
    expect(recommendedAddons(answers).has('routeplanner')).toBe(true)
  })

  it('travel is multi-select — travelling recommends route planner, not "they come to me"', () => {
    expect(recommendedAddons({ travel: ['travel'] }).has('routeplanner')).toBe(true)
    expect(recommendedAddons({ travel: ['travel', 'no'] }).has('routeplanner')).toBe(true)
    expect(recommendedAddons({ travel: ['no'] }).has('routeplanner')).toBe(false)
  })

  it('a studio role (dog trainer) does not recommend route planner', () => {
    const answers = defaultAnswers(['trainer'])
    expect(answers.travel).toEqual(['no'])
    expect(recommendedAddons(answers).has('routeplanner')).toBe(false)
  })

  it('trainer defaults recommend achievements', () => {
    expect(recommendedAddons(defaultAnswers(['trainer'])).has('achievements')).toBe(true)
  })

  it('“No, but I should” still recommends the add-on (warm intent)', () => {
    expect(recommendedAddons({ sell: 'aspire' }).has('shop')).toBe(true)
    expect(recommendedAddons({ reward: 'aspire' }).has('achievements')).toBe(true)
  })

  it('a plain “No” recommends nothing', () => {
    const rec = recommendedAddons({ sell: 'no', reward: 'no' })
    expect(rec.has('shop')).toBe(false)
    expect(rec.has('achievements')).toBe(false)
  })

  it('groomer defaults recommend the client shop', () => {
    expect(recommendedAddons(defaultAnswers(['groomer'])).has('shop')).toBe(true)
  })

  it('multi-select roles union their recommendations', () => {
    const rec = recommendedAddons(defaultAnswers(['walker', 'groomer']))
    expect(rec.has('routeplanner')).toBe(true) // from walker (mobile)
    expect(rec.has('shop')).toBe(true) // from groomer
  })

  it('invoice=none removes the Xero recommendation', () => {
    const rec = recommendedAddons({ invoice: 'none', travel: 'no', team: 'solo' })
    expect(rec.has('xero')).toBe(false)
  })

  it('team question drives timesheets', () => {
    expect(recommendedAddons({ invoice: 'manual', travel: 'no', team: 'team' }).has('timesheets')).toBe(true)
    expect(recommendedAddons({ invoice: 'manual', travel: 'no', team: 'solo' }).has('timesheets')).toBe(false)
  })

  it('no roles → empty answers → no recommendations', () => {
    expect(recommendedAddons({}).size).toBe(0)
  })

  it('role-gates questions: a walker skips classes-y questions, a trainer skips travel', () => {
    const q = (id: string) => WIZ_QUESTIONS.find(x => x.id === id)!
    // Dog walker sees travel, but NOT the trainer-only "reward progress" question.
    expect(questionApplies(q('travel'), ['walker'])).toBe(true)
    expect(questionApplies(q('reward'), ['walker'])).toBe(false)
    // A studio trainer skips the travel question but gets "reward".
    expect(questionApplies(q('travel'), ['trainer'])).toBe(false)
    expect(questionApplies(q('reward'), ['trainer'])).toBe(true)
    // Universal questions (no roles) show for anyone.
    expect(questionApplies(q('invoice'), ['walker'])).toBe(true)
    expect(questionApplies(q('clientapp'), ['groomer'])).toBe(true)
  })

  it('package options are tailored per role and unioned across roles', () => {
    expect(packageOptionsFor(['walker']).map(o => o.id)).toContain('solo-walk')
    expect(packageOptionsFor(['groomer']).map(o => o.id)).toContain('full-groom')
    // walker + trainer unions both, de-duped.
    const combined = packageOptionsFor(['walker', 'trainer']).map(o => o.id)
    expect(combined).toEqual(expect.arrayContaining(['solo-walk', 'group-class']))
    expect(new Set(combined).size).toBe(combined.length) // no dupes
    expect(packageOptionsFor([])).toEqual([])
  })

  it('core add-ons default on; Notes “No” and Client interaction Email/None turn them off', () => {
    expect(coreAddonState({})).toEqual({ clientapp: true, notes: true, classes: true })

    // Mobile app keeps the client app on; Email / No interaction turn it off.
    expect(coreAddonState({ clientapp: 'app' }).clientapp).toBe(true)
    expect(coreAddonState({ clientapp: 'email' }).clientapp).toBe(false)
    expect(coreAddonState({ clientapp: 'none' }).clientapp).toBe(false)

    expect(coreAddonState({ notes: 'no' }).notes).toBe(false)
  })

  it('classes add-on is inferred from the packages offered (not a question)', () => {
    // Offers group classes → classes on.
    expect(coreAddonState({ packages: ['private', 'group-class'] }).classes).toBe(true)
    // Offers only non-class packages → classes off.
    expect(coreAddonState({ packages: ['solo-walk', 'drop-in'] }).classes).toBe(false)
    // Didn't answer packages → stays default on.
    expect(coreAddonState({}).classes).toBe(true)
  })
})
