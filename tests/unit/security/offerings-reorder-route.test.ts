import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The reorder endpoint writes the display order clients see, so it has to be
// as tenant-scoped as any other write. These pin the guards in the source: the
// permission check, that EVERY id is verified against the caller's own rows
// before anything is written, and that the writes go in one transaction.
const route = readFileSync(
  resolve(__dirname, '../../../src/app/api/trainer/offerings/reorder/route.ts'),
  'utf8',
)

describe('POST /api/trainer/offerings/reorder', () => {
  it('is behind the packages.manage permission', () => {
    expect(route).toContain("guardPermission('packages.manage')")
    expect(route).toContain('if (ctx instanceof NextResponse) return ctx')
  })

  it('only accepts the three offering tables it knows how to order', () => {
    expect(route).toContain("kind: z.enum(['package', 'classRun', 'membership'])")
  })

  it('scopes the ownership check to the caller’s own company', () => {
    expect(route).toContain('trainerId: ctx.companyId')
    // Every id must come back as owned, or nothing is written.
    expect(route).toContain('owned.length !== ids.length')
    expect(route).toMatch(/status:\s*404/)
  })

  it('rejects duplicate ids rather than letting one row win twice', () => {
    expect(route).toContain('new Set(ids).size !== ids.length')
  })

  it('writes every position in one transaction', () => {
    expect(route).toContain('prisma.$transaction')
    expect(route).toContain('data: { order }')
  })
})
