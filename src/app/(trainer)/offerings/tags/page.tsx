import { redirect } from 'next/navigation'

/**
 * Tags moved into Settings (Karl, 2026-08-06: "please move tags to settings
 * area") — a tag is configuration, so it now sits with the rest of it, directly
 * after "What you call things".
 *
 * The route stays as a redirect rather than 404ing. It shipped as a top-level
 * nav item AND as a row on the Offerings hub, so it will be in histories,
 * bookmarks and links people sent each other — and a dead URL for a screen that
 * still exists is the worst version of moving something. Same treatment
 * /automations got when it moved.
 *
 * /offerings/tags/[tagId] is deliberately NOT redirected: it is a detail screen
 * about what is inside one tag, not a settings surface, and the list in Settings
 * still links straight to it.
 */
export default function TagsRedirect() {
  redirect('/settings?tab=tags')
}
