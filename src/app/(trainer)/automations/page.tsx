import { redirect } from 'next/navigation'

/**
 * Automations moved into Settings (Karl, 2026-08-06: "it should be in the
 * settings area and should a way to edit the automation from here").
 *
 * The route stays as a redirect rather than 404ing. It shipped as a top-level
 * nav item, so it may be in a trainer's history, a bookmark or a link somebody
 * sent — and a dead URL for a screen that still exists is the worst version of
 * moving something.
 */
export default function AutomationsRedirect() {
  redirect('/settings?tab=automations')
}
