// Native-shell version gating.
//
// The App Store / Play Store never *prompt* a user to update from inside the
// app — the only way to make PupManager actively ask (or hard-block) is to
// compare the running native build against a floor we control and show our
// own UI. These are the pure helpers behind that gate; the runtime lives in
// `src/components/native/UpdateGate.tsx` and the config is served by
// `/api/app/version-requirements`.
//
// Two tiers:
//   • minSupported — the hard floor. Below it the app is BLOCKED (a build old
//     enough to be broken/unsafe). Bump this when you must force everyone off
//     a bad binary.
//   • latest — the soft target. Between minSupported and latest we NUDGE with a
//     dismissable banner.
//
// Only native platforms are gated — web / PWA sessions never see any of this.

export type Platform = 'ios' | 'android'

export interface PlatformRequirement {
  /** Hard floor — a running version below this is blocked from using the app. */
  minSupported: string
  /** Latest shipped version — below this (but at/above the floor) shows a soft nudge. */
  latest: string
  /** Store URL the "Update" button opens externally (App Store / Play Store). */
  storeUrl: string
}

export type VersionRequirements = Record<Platform, PlatformRequirement>

export type UpdateStatus = 'ok' | 'nudge' | 'blocked'

// Split a dotted version ("1.4.2") into numeric segments. Non-numeric or
// missing segments collapse to 0 so a malformed value can never throw or
// accidentally read as "newer than everything".
export function parseVersion(v: string): number[] {
  return String(v ?? '')
    .split('.')
    .map((part) => {
      const n = parseInt(part, 10)
      return Number.isFinite(n) ? n : 0
    })
}

// Segment-wise compare. Returns -1 when a < b, 0 when equal, 1 when a > b.
// Missing trailing segments count as 0, so "1.4" === "1.4.0".
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x < y) return -1
    if (x > y) return 1
  }
  return 0
}

// Decide what the running build should see. Order matters: check the hard
// floor first, so a version below minSupported is always 'blocked' even if it
// is also below latest.
export function evaluateUpdate(current: string, req: PlatformRequirement): UpdateStatus {
  if (compareVersions(current, req.minSupported) < 0) return 'blocked'
  if (compareVersions(current, req.latest) < 0) return 'nudge'
  return 'ok'
}

// Build the requirements payload from environment variables. Defaults are
// deliberately inert — minSupported/latest fall back to '0.0.0', so the gate
// stays completely dormant until you explicitly set the floor in Vercel. That
// makes it impossible to lock users out by simply shipping this code; you have
// to opt in per platform by setting APP_MIN_VERSION_* / APP_LATEST_VERSION_*.
//
// Takes the env map as an argument (rather than reading process.env directly)
// so it is trivially unit-testable.
export function requirementsFromEnv(env: Record<string, string | undefined>): VersionRequirements {
  const iosMin = env.APP_MIN_VERSION_IOS ?? '0.0.0'
  const androidMin = env.APP_MIN_VERSION_ANDROID ?? '0.0.0'
  return {
    ios: {
      minSupported: iosMin,
      // latest defaults to the floor: if you only set a floor, there's no
      // separate nudge tier — you either meet the floor or you're blocked.
      latest: env.APP_LATEST_VERSION_IOS ?? iosMin,
      storeUrl: env.APP_STORE_URL_IOS ?? 'https://apps.apple.com/app/id6766399138',
    },
    android: {
      minSupported: androidMin,
      latest: env.APP_LATEST_VERSION_ANDROID ?? androidMin,
      storeUrl:
        env.APP_STORE_URL_ANDROID ??
        'https://play.google.com/store/apps/details?id=com.pupmanager.app',
    },
  }
}
