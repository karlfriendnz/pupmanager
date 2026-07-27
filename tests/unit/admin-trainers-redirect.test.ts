import { describe, it, expect, vi, beforeEach } from 'vitest'

// The Super Admin trainers LIST merged into /admin. /admin/trainers is kept as a
// redirect because it's in bookmarks, in founder emails and in the
// impersonation round-trip — and because /admin/trainers/[trainerId] (a sibling
// route, untouched) still links back through that namespace.

const redirect = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ redirect }))

import AdminTrainersPage from '@/app/(admin)/admin/trainers/page'
import { ADMIN_TABS } from '@/app/(admin)/admin-tab-nav'

beforeEach(() => redirect.mockClear())

describe('/admin/trainers redirect', () => {
  it('sends a bare visit to /admin', async () => {
    await AdminTrainersPage({ searchParams: Promise.resolve({}) })
    expect(redirect).toHaveBeenCalledWith('/admin')
  })

  it('carries a bookmarked lifecycle tab through', async () => {
    await AdminTrainersPage({ searchParams: Promise.resolve({ tab: 'paying' }) })
    expect(redirect).toHaveBeenCalledWith('/admin?tab=paying')
  })

  it('carries the search term through, encoded', async () => {
    await AdminTrainersPage({ searchParams: Promise.resolve({ tab: 'all', q: 'jess@dog co' }) })
    expect(redirect).toHaveBeenCalledWith('/admin?tab=all&q=jess%40dog+co')
  })
})

describe('admin nav after the merge', () => {
  it('has no separate Trainers tab — /admin is the one businesses screen', () => {
    expect(ADMIN_TABS.filter(t => t.href === '/admin/trainers')).toHaveLength(0)
    expect(ADMIN_TABS.filter(t => t.href === '/admin')).toHaveLength(1)
  })

  it('never points two tabs at the same destination', () => {
    const hrefs = ADMIN_TABS.map(t => t.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })
})
