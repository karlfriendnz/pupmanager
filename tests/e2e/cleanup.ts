// Teardown helpers for the shared seeded E2E database.
//
// The suite runs single-worker against ONE seeded Postgres, so anything a spec
// creates and fails to delete changes what the NEXT spec counts. Two rules keep
// that honest:
//
//  1. Delete deepest-CHILD-first. `ClassRun.packageId` is the only RESTRICT
//     foreign key in the schema, so a Package can never be deleted while one of
//     its ClassRuns still exists. A spec that collects teardown callbacks in a
//     `cleanup` array and runs them through `.reverse()` must therefore PUSH
//     them outermost-first (package → run → sessions → enrolments).
//  2. Never swallow the failure silently. Teardown stays best-effort — a row a
//     parent already cascaded away is expected and fine — but a genuine
//     ordering mistake has to announce itself, or the leaked rows are invisible
//     until some unrelated spec starts failing in the full suite.
export function bestEffort(what: string) {
  return (err: unknown) => {
    // P2025 = "record to delete does not exist": already gone, almost always
    // because a parent's ON DELETE CASCADE took it. Not a leak.
    if ((err as { code?: string } | null)?.code === 'P2025') return
    console.warn(
      `[e2e cleanup] ${what} was not deleted — rows may leak into later specs:`,
      (err as Error)?.message,
    )
  }
}
