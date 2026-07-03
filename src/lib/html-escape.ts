// Pure HTML-escaping utility. Deliberately dependency-free so it can be imported
// by client components (e.g. via email-html.ts) WITHOUT dragging in server-only
// modules. It previously lived in enquiries.ts, which imports prisma — creating
// a client→prisma bundle leak (pg pulled into the browser bundle). Keep this
// module free of any server imports.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
