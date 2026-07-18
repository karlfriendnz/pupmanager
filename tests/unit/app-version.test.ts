import { describe, it, expect } from 'vitest'
import {
  parseVersion,
  compareVersions,
  evaluateUpdate,
  requirementsFromEnv,
  type PlatformRequirement,
} from '@/lib/app-version'

describe('parseVersion', () => {
  it('splits dotted numeric versions', () => {
    expect(parseVersion('1.4.2')).toEqual([1, 4, 2])
  })

  it('coerces non-numeric or missing segments to 0', () => {
    expect(parseVersion('1.x.3')).toEqual([1, 0, 3])
    expect(parseVersion('')).toEqual([0])
    // @ts-expect-error — guard against a bad runtime value
    expect(parseVersion(undefined)).toEqual([0])
  })
})

describe('compareVersions', () => {
  it('orders by segment', () => {
    expect(compareVersions('1.4.0', '1.4.1')).toBe(-1)
    expect(compareVersions('1.5.0', '1.4.9')).toBe(1)
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
  })

  it('treats missing trailing segments as 0', () => {
    expect(compareVersions('1.4', '1.4.0')).toBe(0)
    expect(compareVersions('1.4.0', '1.4')).toBe(0)
    expect(compareVersions('1.4', '1.4.1')).toBe(-1)
  })

  it('reports equality', () => {
    expect(compareVersions('1.0.1', '1.0.1')).toBe(0)
  })
})

describe('evaluateUpdate', () => {
  const req: PlatformRequirement = {
    minSupported: '1.4.0',
    latest: '1.6.0',
    storeUrl: 'https://example.com',
  }

  it('blocks builds below the hard floor', () => {
    expect(evaluateUpdate('1.3.9', req)).toBe('blocked')
    expect(evaluateUpdate('1.0.0', req)).toBe('blocked')
  })

  it('nudges builds at/above the floor but below latest', () => {
    expect(evaluateUpdate('1.4.0', req)).toBe('nudge')
    expect(evaluateUpdate('1.5.9', req)).toBe('nudge')
  })

  it('passes builds at or above latest', () => {
    expect(evaluateUpdate('1.6.0', req)).toBe('ok')
    expect(evaluateUpdate('2.0.0', req)).toBe('ok')
  })

  it('prefers blocked over nudge when a version is below both', () => {
    // floor and latest are the same here → below it must block, not nudge
    const strict: PlatformRequirement = { minSupported: '2.0.0', latest: '2.0.0', storeUrl: '' }
    expect(evaluateUpdate('1.9.9', strict)).toBe('blocked')
  })
})

describe('requirementsFromEnv', () => {
  it('is inert by default (never blocks) when no env is set', () => {
    const reqs = requirementsFromEnv({})
    expect(reqs.ios.minSupported).toBe('0.0.0')
    expect(reqs.android.minSupported).toBe('0.0.0')
    // A real build is always >= 0.0.0, so status is always 'ok'.
    expect(evaluateUpdate('1.0.1', reqs.ios)).toBe('ok')
    expect(evaluateUpdate('1.0.1', reqs.android)).toBe('ok')
  })

  it('reads per-platform floors and latest values', () => {
    const reqs = requirementsFromEnv({
      APP_MIN_VERSION_IOS: '1.4.0',
      APP_LATEST_VERSION_IOS: '1.6.0',
      APP_MIN_VERSION_ANDROID: '2.0.0',
      APP_LATEST_VERSION_ANDROID: '2.1.0',
    })
    expect(reqs.ios).toMatchObject({ minSupported: '1.4.0', latest: '1.6.0' })
    expect(reqs.android).toMatchObject({ minSupported: '2.0.0', latest: '2.1.0' })
  })

  it('defaults latest to the floor when only a floor is set', () => {
    const reqs = requirementsFromEnv({ APP_MIN_VERSION_IOS: '1.4.0' })
    expect(reqs.ios.latest).toBe('1.4.0')
    // No separate nudge tier: meet the floor or be blocked.
    expect(evaluateUpdate('1.3.0', reqs.ios)).toBe('blocked')
    expect(evaluateUpdate('1.4.0', reqs.ios)).toBe('ok')
  })

  it('uses default store URLs and allows overrides', () => {
    expect(requirementsFromEnv({}).android.storeUrl).toContain(
      'play.google.com/store/apps/details?id=com.pupmanager.app',
    )
    expect(requirementsFromEnv({}).ios.storeUrl).toBe('https://apps.apple.com/app/id6766399138')
    const overridden = requirementsFromEnv({ APP_STORE_URL_IOS: 'https://apps.apple.com/app/id123' })
    expect(overridden.ios.storeUrl).toBe('https://apps.apple.com/app/id123')
  })
})
