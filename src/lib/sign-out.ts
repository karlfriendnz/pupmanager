import { signOut } from 'next-auth/react'

// Sign out, first deregistering this device's push token so the user stops
// receiving native notifications for the account they're leaving. The token is
// stashed by NativeBootstrap on APNs registration; on web there's nothing to
// remove and this is a no-op before the normal sign-out.
export async function signOutWithPush(callbackUrl = '/login') {
  try {
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('pm-push-token') : null
    if (token) {
      await fetch('/api/devices/register', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }).catch(() => {})
      window.localStorage.removeItem('pm-push-token')
    }
  } catch {
    // Never let push cleanup block the actual sign-out.
  }
  await signOut({ callbackUrl })
}
