import { describe, it, expect } from 'vitest'
import {
  MAX_VIDEOS,
  readVideos,
  sanitizeVideos,
  videoColumns,
  videoLabel,
} from '@/lib/instructional-videos'

describe('sanitizeVideos — the URL rule', () => {
  it('keeps http and https', () => {
    expect(sanitizeVideos([
      { url: 'https://example.com/a.mp4' },
      { url: 'http://example.com/b.mp4' },
    ])).toEqual([
      { url: 'https://example.com/a.mp4' },
      { url: 'http://example.com/b.mp4' },
    ])
  })

  it('drops javascript: — it passes a naive URL parse and would run in the client’s app', () => {
    expect(sanitizeVideos([{ url: 'javascript:alert(1)' }])).toEqual([])
  })

  it('drops data:, file: and anything that isn’t a URL at all', () => {
    expect(sanitizeVideos([
      { url: 'data:text/html,<script>alert(1)</script>' },
      { url: 'file:///etc/passwd' },
      { url: 'not a url' },
      { url: '' },
      { url: null },
      { url: 42 },
      'https://example.com/ok.mp4',
    ])).toEqual([{ url: 'https://example.com/ok.mp4' }])
  })

  it('loses one bad clip, not the whole save', () => {
    expect(sanitizeVideos([
      { url: 'https://example.com/a.mp4' },
      { url: 'javascript:alert(1)' },
      { url: 'https://example.com/c.mp4' },
    ])).toHaveLength(2)
  })

  it('is empty for anything that isn’t a list', () => {
    for (const input of [null, undefined, 'https://example.com/a.mp4', {}, 7]) {
      expect(sanitizeVideos(input)).toEqual([])
    }
  })
})

describe('sanitizeVideos — titles and duplicates', () => {
  it('trims a title and drops an empty one', () => {
    expect(sanitizeVideos([
      { url: 'https://example.com/a.mp4', title: '  Step 1 — approach  ' },
      { url: 'https://example.com/b.mp4', title: '   ' },
    ])).toEqual([
      { url: 'https://example.com/a.mp4', title: 'Step 1 — approach' },
      { url: 'https://example.com/b.mp4' },
    ])
  })

  it('caps a very long title rather than refusing the clip', () => {
    const [only] = sanitizeVideos([{ url: 'https://example.com/a.mp4', title: 'x'.repeat(500) }])
    expect(only!.title).toHaveLength(80)
  })

  it('ignores a non-string title', () => {
    expect(sanitizeVideos([{ url: 'https://example.com/a.mp4', title: { evil: true } }]))
      .toEqual([{ url: 'https://example.com/a.mp4' }])
  })

  it('drops the same clip listed twice — a client would watch the same step again', () => {
    expect(sanitizeVideos([
      { url: 'https://example.com/a.mp4', title: 'First' },
      { url: 'https://example.com/a.mp4', title: 'Also first' },
    ])).toEqual([{ url: 'https://example.com/a.mp4', title: 'First' }])
  })

  it('stops at MAX_VIDEOS', () => {
    const many = Array.from({ length: MAX_VIDEOS + 5 }, (_, i) => ({ url: `https://example.com/${i}.mp4` }))
    expect(sanitizeVideos(many)).toHaveLength(MAX_VIDEOS)
  })

  it('keeps the order it was given — it is the order a client watches them', () => {
    const urls = sanitizeVideos([
      { url: 'https://example.com/c.mp4' },
      { url: 'https://example.com/a.mp4' },
      { url: 'https://example.com/b.mp4' },
    ]).map(v => v.url)
    expect(urls).toEqual([
      'https://example.com/c.mp4',
      'https://example.com/a.mp4',
      'https://example.com/b.mp4',
    ])
  })
})

describe('readVideos — rows saved in either era', () => {
  it('reads the list when there is one', () => {
    expect(readVideos({ videos: [{ url: 'https://example.com/a.mp4' }], videoUrl: 'https://example.com/a.mp4' }))
      .toEqual([{ url: 'https://example.com/a.mp4' }])
  })

  it('falls back to the single column for an item saved before the list existed', () => {
    expect(readVideos({ videos: [], videoUrl: 'https://example.com/old.mp4' }))
      .toEqual([{ url: 'https://example.com/old.mp4' }])
  })

  it('falls back when videos is null — the column default may not have been applied', () => {
    expect(readVideos({ videos: null, videoUrl: 'https://example.com/old.mp4' }))
      .toEqual([{ url: 'https://example.com/old.mp4' }])
  })

  it('is empty when there is no video at all', () => {
    expect(readVideos({ videos: [], videoUrl: null })).toEqual([])
    expect(readVideos(null)).toEqual([])
    expect(readVideos(undefined)).toEqual([])
  })

  it('does not resurrect a junk videoUrl', () => {
    expect(readVideos({ videos: [], videoUrl: 'javascript:alert(1)' })).toEqual([])
  })
})

describe('videoColumns — the two columns can never disagree', () => {
  it('mirrors the first video into videoUrl, so older readers still see one', () => {
    expect(videoColumns([
      { url: 'https://example.com/a.mp4', title: 'Step 1' },
      { url: 'https://example.com/b.mp4' },
    ])).toEqual({
      videos: [
        { url: 'https://example.com/a.mp4', title: 'Step 1' },
        { url: 'https://example.com/b.mp4' },
      ],
      videoUrl: 'https://example.com/a.mp4',
    })
  })

  it('clears videoUrl when the last video is removed', () => {
    expect(videoColumns([])).toEqual({ videos: [], videoUrl: null })
  })

  it('mirrors the first SURVIVING video when the first one was rejected', () => {
    expect(videoColumns([
      { url: 'javascript:alert(1)' },
      { url: 'https://example.com/b.mp4' },
    ])).toEqual({
      videos: [{ url: 'https://example.com/b.mp4' }],
      videoUrl: 'https://example.com/b.mp4',
    })
  })
})

describe('videoLabel', () => {
  it('uses the trainer’s own title', () => {
    expect(videoLabel({ url: 'https://example.com/a.mp4', title: 'Step 1' }, 0)).toBe('Step 1')
  })

  it('numbers an untitled clip from one, not zero', () => {
    expect(videoLabel({ url: 'https://example.com/a.mp4' }, 0)).toBe('Video 1')
    expect(videoLabel({ url: 'https://example.com/b.mp4', title: '  ' }, 2)).toBe('Video 3')
  })
})
