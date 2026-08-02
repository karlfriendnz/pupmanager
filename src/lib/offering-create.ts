/**
 * Where the global "+" sends "New offering" from the page you are standing on.
 *
 * It answers one question — "does the create button already make THIS kind of
 * thing?" — and two places need the same answer:
 *
 *   • FloatingCreateButton, so the choice lands on the right form.
 *   • OfferingListBar, so a phone does not carry a page-level add button for a
 *     job the create button has already done. AGENTS.md: nothing says the same
 *     thing twice.
 *
 * Written down once because the second reader is the dangerous one. If this
 * list and the list the "+" uses ever drift, a list either grows a second add
 * button on a phone or — much worse — loses its only one.
 *
 * `null` means the "+" cannot pre-pick a kind here, and the page's own add
 * action is the ONLY way to make the thing. Tags, the waitlist, lead magnets,
 * achievements and memberships are all in that position: the "+" has no choice
 * that makes one, so their buttons stay put at every width.
 */
export function prePickedOfferingHref(pathname: string): string | null {
  if (pathname.startsWith('/classes')) return '/offerings/new?kind=group'
  if (pathname.startsWith('/casual-classes')) return '/offerings/new?kind=dropin'
  if (pathname.startsWith('/events')) return '/offerings/new?kind=oneoff'
  if (pathname.startsWith('/packages')) return '/offerings/new?kind=onetoone'
  return null
}
