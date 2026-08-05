/**
 * The trainer's welcome note, with the client's name in it.
 *
 * The app used to greet the client itself ("Hi Karl 👋") above a card labelled
 * WELCOME, above whatever the trainer had written — three greetings stacked,
 * two of them in the app's voice rather than the business's. The greeting is
 * the trainer's to write now (Karl, 2026-08-06), so the note needs a way to say
 * the client's name.
 *
 * `{{name}}` is the placeholder the comms flows already use, so a trainer who
 * has written a session reminder does not have to learn a second syntax.
 */

/** Escapes a name for insertion into already-sanitized HTML. */
function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Substitutes `{{name}}` in a welcome note.
 *
 * The note is HTML by the time this runs, and the name comes from the client's
 * own profile — which they can edit. Escaping is the point: without it a client
 * calling themselves `<script>…` writes markup into a page every one of that
 * trainer's clients sees. Spacing and case are forgiven (`{{ Name }}`) because
 * a trainer typing it by hand should not have to get it exactly right.
 */
export function personaliseWelcomeNote(
  html: string | null | undefined,
  firstName: string | null | undefined,
): string {
  if (!html) return ''
  // No name to substitute: drop the placeholder rather than print it raw. A
  // client reading "Hi {{name}}" is worse than one reading "Hi".
  const safe = firstName?.trim() ? escapeText(firstName.trim()) : ''
  return html.replace(/\{\{\s*name\s*\}\}/gi, safe)
}
