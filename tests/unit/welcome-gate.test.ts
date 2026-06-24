import { describe, it, expect } from 'vitest'
import { shouldShowWelcome } from '@/lib/onboarding/welcome'

const fresh = { welcomeShownAt: null, backfilledAt: null, checklistDismissedAt: null, ahaReachedAt: null }

describe('shouldShowWelcome', () => {
  it('shows the welcome modal for a fresh trainer (not impersonating)', () => {
    expect(shouldShowWelcome(fresh, false)).toBe(true)
  })

  it('never shows during admin impersonation, even for a fresh trainer', () => {
    expect(shouldShowWelcome(fresh, true)).toBe(false)
  })

  it('does not show once seen / aha-reached / dismissed', () => {
    expect(shouldShowWelcome({ ...fresh, welcomeShownAt: new Date() }, false)).toBe(false)
    expect(shouldShowWelcome({ ...fresh, ahaReachedAt: new Date() }, false)).toBe(false)
    expect(shouldShowWelcome({ ...fresh, checklistDismissedAt: new Date() }, false)).toBe(false)
    expect(shouldShowWelcome({ ...fresh, backfilledAt: new Date() }, false)).toBe(false)
  })
})
