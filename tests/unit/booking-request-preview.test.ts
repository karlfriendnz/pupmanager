import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/lib/prisma', () => ({ prisma: {} }))

import {
  buildPreviewBlocks,
  schedulePreviewHref,
  previewClashKeys,
  type PreviewBlock,
} from '../../src/lib/booking-request-preview'

const PKG = { name: 'Reactive Rover', sessionCount: 3, durationMins: 60 }

describe('buildPreviewBlocks', () => {
  it('maps each valid ISO date to a titled, positioned block', () => {
    const blocks = buildPreviewBlocks(
      ['2026-07-06T18:00:00.000Z', '2026-07-13T18:00:00.000Z', '2026-07-20T18:00:00.000Z'],
      PKG,
    )
    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toEqual({
      key: 'preview-0',
      startIso: '2026-07-06T18:00:00.000Z',
      durationMins: 60,
      title: 'Reactive Rover — session 1/3',
    })
    expect(blocks[2].title).toBe('Reactive Rover — session 3/3')
  })

  it('titles a single-session package with no numbering', () => {
    const blocks = buildPreviewBlocks(['2026-07-06T18:00:00.000Z'], { name: 'Puppy Intro', sessionCount: 1, durationMins: 45 })
    expect(blocks).toHaveLength(1)
    expect(blocks[0].title).toBe('Puppy Intro')
    expect(blocks[0].durationMins).toBe(45)
  })

  it('drops unparseable / invalid entries', () => {
    const blocks = buildPreviewBlocks(['not-a-date', '2026-07-06T18:00:00.000Z', ''], PKG)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].startIso).toBe('2026-07-06T18:00:00.000Z')
  })

  it('returns [] for non-array sessionDates', () => {
    expect(buildPreviewBlocks(null, PKG)).toEqual([])
    expect(buildPreviewBlocks(undefined, PKG)).toEqual([])
    expect(buildPreviewBlocks('2026-07-06', PKG)).toEqual([])
  })
})

describe('schedulePreviewHref', () => {
  it('deep-links to the schedule with the request id', () => {
    expect(schedulePreviewHref('req_123')).toBe('/schedule?previewRequest=req_123')
  })
  it('url-encodes the id', () => {
    expect(schedulePreviewHref('a/b c')).toBe('/schedule?previewRequest=a%2Fb%20c')
  })
})

describe('previewClashKeys', () => {
  const blocks: PreviewBlock[] = [
    { key: 'preview-0', startIso: '2026-07-06T18:00:00.000Z', durationMins: 60, title: 'A' },
    { key: 'preview-1', startIso: '2026-07-13T18:00:00.000Z', durationMins: 60, title: 'B' },
  ]

  it('flags a block overlapping an existing session', () => {
    // Existing session 18:30–19:30 overlaps the first block (18:00–19:00).
    const clashes = previewClashKeys(blocks, [{ scheduledAt: '2026-07-06T18:30:00.000Z', durationMins: 60 }])
    expect(clashes.has('preview-0')).toBe(true)
    expect(clashes.has('preview-1')).toBe(false)
  })

  it('treats touching edges as non-overlapping (half-open)', () => {
    // Existing ends exactly when the block starts → no clash.
    const clashes = previewClashKeys(blocks, [{ scheduledAt: '2026-07-06T17:00:00.000Z', durationMins: 60 }])
    expect(clashes.size).toBe(0)
  })

  it('returns an empty set when nothing overlaps', () => {
    const clashes = previewClashKeys(blocks, [{ scheduledAt: '2026-07-06T09:00:00.000Z', durationMins: 30 }])
    expect(clashes.size).toBe(0)
  })

  it('ignores existing rows with a bad date or zero duration', () => {
    const clashes = previewClashKeys(blocks, [
      { scheduledAt: 'bogus', durationMins: 60 },
      { scheduledAt: '2026-07-06T18:00:00.000Z', durationMins: 0 },
    ])
    expect(clashes.size).toBe(0)
  })
})
