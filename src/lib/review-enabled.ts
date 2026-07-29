/**
 * The review widget is a BUILD TOOL, not a feature.
 *
 * Its endpoints write into the working tree (the task brief, uploaded
 * screenshots) and take unauthenticated PATCHes so an agent can mark items off
 * with curl. None of that has any business existing on a deployed instance, so
 * every review route asks this first and 404s when it's off.
 *
 * Off in production unless REVIEW_TOOLS=1 is set deliberately — there is no
 * legitimate reason to set it on app.pupmanager.com.
 */
export function reviewToolsEnabled(): boolean {
  if (process.env.REVIEW_TOOLS === '1') return true
  return process.env.NODE_ENV !== 'production'
}
