// Canonical App Store / Google Play listing URLs + the official badge image
// paths (PNGs in /public, email-safe). Kept in one place so the invite flow,
// invite email, and onboarding surfaces all point at the same listings.
export const APP_STORE_URL = 'https://apps.apple.com/app/id6766399138'
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.pupmanager.app'

// Absolute, prod-hosted badge images (SVG isn't supported in email; these PNGs
// are whitelisted in src/proxy.ts so they load in any inbox).
export const APP_STORE_BADGE_URL = 'https://app.pupmanager.com/app-store-badge.png'
export const PLAY_STORE_BADGE_URL = 'https://app.pupmanager.com/google-play-badge.png'
