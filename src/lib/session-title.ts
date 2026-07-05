// Pure, prisma-free session-title helper. Kept separate from self-book.ts (which
// imports prisma) so it's safe to import from client components + preview logic.
export function sessionTitle(name: string, sessionCount: number, i: number): string {
  if (sessionCount === 1) return name
  if (sessionCount > 1) return `${name} — session ${i + 1}/${sessionCount}`
  return `${name} — session ${i + 1}`
}
