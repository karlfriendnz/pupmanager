/**
 * Where the global "+" sends "New offering" from the page you are standing on.
 *
 * It answers one question — "does the create button already make THIS kind of
 * thing?" — so the "New offering" choice lands on the right form rather than
 * on the pick-a-kind step you have just answered by standing here.
 *
 * OfferingListBar used to read it too, to hide its own add button on a phone
 * where the "+" duplicated it. It no longer does: the phone's create circle is
 * home-only now (Karl, 2026-08-06), so every list carries its own add button at
 * every width. This is therefore only consulted from the home screen today,
 * where it returns null — kept because the desktop bar's "+" and any future
 * home for the circle would want the same answer.
 */
export function prePickedOfferingHref(pathname: string): string | null {
  if (pathname.startsWith('/classes')) return '/offerings/new?kind=group'
  if (pathname.startsWith('/casual-classes')) return '/offerings/new?kind=dropin'
  if (pathname.startsWith('/events')) return '/offerings/new?kind=oneoff'
  if (pathname.startsWith('/packages')) return '/offerings/new?kind=onetoone'
  return null
}
