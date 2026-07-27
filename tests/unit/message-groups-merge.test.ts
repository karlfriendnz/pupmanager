import { describe, it, expect } from 'vitest'
import { mergeThreadsAndGroups } from '@/app/(trainer)/messages/messages-view'
import type { ClientRow, GroupRow } from '@/app/(trainer)/messages/messages-view'

// The messages screen used to enumerate CLIENTS, not conversations, so a group
// had nothing to hang off it. Merging is what makes a group behave like any
// other thread — and the existing rule (unread floats to the top, then most
// recent first) has to survive the merge, or the screen quietly changes
// behaviour for the 1:1 threads that were already there.

function client(opts: { id: string; at?: string; unread?: number } ): ClientRow {
  return {
    id: opts.id,
    status: 'ACTIVE',
    displayName: opts.id,
    dogName: null,
    dogPhotoUrl: null,
    unread: opts.unread ?? 0,
    lastMessage: opts.at
      ? { body: 'hi', createdAt: opts.at, senderName: 'Jess', outgoing: true, readAt: null }
      : null,
  }
}

function group(opts: { id: string; at?: string; unread?: number }): GroupRow {
  return {
    id: opts.id,
    name: opts.id,
    mode: 'BROADCAST',
    archived: false,
    memberCount: 5,
    invitedCount: 0,
    unread: opts.unread ?? 0,
    lastMessage: opts.at ? { body: 'hi', createdAt: opts.at, senderName: 'Jess' } : null,
  }
}

const idOf = (e: ReturnType<typeof mergeThreadsAndGroups>[number]) =>
  e.kind === 'client' ? e.client.id : e.group.id

describe('mergeThreadsAndGroups', () => {
  it('interleaves groups and client threads by recency', () => {
    const out = mergeThreadsAndGroups(
      [client({ id: 'older', at: '2026-07-01T09:00:00Z' }), client({ id: 'newest', at: '2026-07-27T09:00:00Z' })],
      [group({ id: 'middle', at: '2026-07-10T09:00:00Z' })],
    )
    expect(out.map(idOf)).toEqual(['newest', 'middle', 'older'])
  })

  it('floats anything unread to the top, group or thread, however stale', () => {
    const out = mergeThreadsAndGroups(
      [client({ id: 'recent-read', at: '2026-07-27T09:00:00Z' })],
      [group({ id: 'ancient-unread', at: '2020-01-01T09:00:00Z', unread: 3 })],
    )
    expect(out.map(idOf)).toEqual(['ancient-unread', 'recent-read'])
  })

  it('keeps a brand-new group with no posts visible at the bottom rather than dropping it', () => {
    const out = mergeThreadsAndGroups(
      [client({ id: 'chatty', at: '2026-07-27T09:00:00Z' })],
      [group({ id: 'empty' })],
    )
    expect(out.map(idOf)).toEqual(['chatty', 'empty'])
  })

  it('is a no-op on the ordering when there are no groups at all', () => {
    const rows = [
      client({ id: 'a', at: '2026-07-01T09:00:00Z' }),
      client({ id: 'b', at: '2026-07-27T09:00:00Z', unread: 1 }),
      client({ id: 'c' }),
    ]
    expect(mergeThreadsAndGroups(rows, []).map(idOf)).toEqual(['b', 'a', 'c'])
  })

  it('tags each entry so the list can render two different row shapes', () => {
    const out = mergeThreadsAndGroups([client({ id: 'a' })], [group({ id: 'g' })])
    expect(out.map(e => e.kind).sort()).toEqual(['client', 'group'])
  })
})
