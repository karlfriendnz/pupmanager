import { Suspense } from 'react'
import { auth } from '@/lib/auth'
import { reviewToolsEnabled } from '@/lib/review-enabled'
import { ReviewWidget } from './review-widget'

/**
 * Mounts the review widget, or nothing at all.
 *
 * One line per layout, so the widget is present on every screen worth reviewing
 * without each of them knowing anything about it. Returns null in production —
 * the gate is checked HERE, on the server, so the widget's code and its API paths
 * never reach a deployed page at all.
 *
 * Suspense because the widget reads the query string (a tab is part of a screen's
 * identity), and useSearchParams suspends during a static render.
 */
export async function ReviewMount() {
  if (!reviewToolsEnabled()) return null
  const session = await auth().catch(() => null)
  return (
    <Suspense fallback={null}>
      <ReviewWidget authorName={session?.user?.name ?? null} />
    </Suspense>
  )
}
