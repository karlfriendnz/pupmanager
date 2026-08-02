import { describe, it, expect } from 'vitest'
import {
  MAX_MEDIA,
  guessKind,
  homeworkMediaColumns,
  legacyRows,
  mediaColumns,
  mediaLabel,
  mediaVideos,
  readMedia,
  sanitizeMedia,
  type MediaItem,
} from '@/lib/library-media'

const V1 = 'https://example.com/step-1.mp4'
const V2 = 'https://example.com/step-2.mp4'
const IMG = 'https://example.com/pic.jpg'
const PDF = 'https://example.com/handout.pdf'

describe('sanitizeMedia — the URL rule', () => {
  it('keeps http and https rows', () => {
    expect(sanitizeMedia([
      { kind: 'video', url: 'http://example.com/a.mp4' },
      { kind: 'image', url: 'https://example.com/b.png' },
    ])).toHaveLength(2)
  })

  // These land in <img src>, <video src> and <a href> on a CLIENT's screen, and
  // a trainer types them. z.url() and a naive URL check both accept this.
  it('drops a javascript: URL', () => {
    expect(sanitizeMedia([{ kind: 'link', url: 'javascript:alert(1)' }])).toEqual([])
  })

  it('drops data: and file: URLs', () => {
    expect(sanitizeMedia([
      { kind: 'image', url: 'data:image/png;base64,iVBOR' },
      { kind: 'document', url: 'file:///etc/passwd' },
    ])).toEqual([])
  })

  it.each([[null], [undefined], ['not an array'], [42], [{}]])('returns [] for %s', input => {
    expect(sanitizeMedia(input)).toEqual([])
  })

  it('drops a row with no usable url rather than throwing the whole save away', () => {
    expect(sanitizeMedia([
      { kind: 'video', url: 'nonsense' },
      { kind: 'video', url: V1 },
    ])).toEqual([{ kind: 'video', url: V1 }])
  })
})

describe('sanitizeMedia — kinds, titles and duplicates', () => {
  it('keeps a stated kind', () => {
    // A .mp4 hosted anywhere is still whatever the trainer said it was — they
    // chose it in the sheet, and a file extension does not know better.
    expect(sanitizeMedia([{ kind: 'link', url: V1 }])[0].kind).toBe('link')
  })

  it('falls back to guessing when no kind is given', () => {
    expect(sanitizeMedia([{ url: IMG }])[0].kind).toBe('image')
    expect(sanitizeMedia([{ url: PDF }])[0].kind).toBe('document')
    expect(sanitizeMedia([{ url: V1 }])[0].kind).toBe('video')
    expect(sanitizeMedia([{ url: 'https://example.com/article' }])[0].kind).toBe('link')
  })

  it('rejects a made-up kind and guesses instead', () => {
    expect(sanitizeMedia([{ kind: 'audio', url: IMG }])[0].kind).toBe('image')
  })

  it('accepts a bare string as a row', () => {
    expect(sanitizeMedia([IMG])).toEqual([{ kind: 'image', url: IMG }])
  })

  it('trims a title and drops an empty one', () => {
    expect(sanitizeMedia([{ kind: 'video', url: V1, title: '  Step 1  ' }]))
      .toEqual([{ kind: 'video', url: V1, title: 'Step 1' }])
    expect(sanitizeMedia([{ kind: 'video', url: V1, title: '   ' }]))
      .toEqual([{ kind: 'video', url: V1 }])
  })

  it('caps a very long title', () => {
    expect(sanitizeMedia([{ kind: 'video', url: V1, title: 'x'.repeat(500) }])[0].title)
      .toHaveLength(80)
  })

  it('ignores a non-string title', () => {
    expect(sanitizeMedia([{ kind: 'video', url: V1, title: { evil: true } }]))
      .toEqual([{ kind: 'video', url: V1 }])
  })

  it('keeps a document filename, for the download link label', () => {
    expect(sanitizeMedia([{ kind: 'document', url: PDF, fileName: 'Week 1.pdf' }]))
      .toEqual([{ kind: 'document', url: PDF, fileName: 'Week 1.pdf' }])
  })

  // The same file twice is always a mistake, and it would give a client the
  // same step to do twice.
  it('drops a repeated url', () => {
    expect(sanitizeMedia([
      { kind: 'video', url: V1 },
      { kind: 'video', url: V1, title: 'again' },
    ])).toHaveLength(1)
  })

  it('caps the list', () => {
    const many = Array.from({ length: MAX_MEDIA + 5 }, (_, i) => ({ kind: 'link', url: `https://example.com/${i}` }))
    expect(sanitizeMedia(many)).toHaveLength(MAX_MEDIA)
  })

  it('keeps the trainer’s order — it is the order a client meets them in', () => {
    const urls = sanitizeMedia([
      { kind: 'document', url: PDF },
      { kind: 'video', url: V1 },
      { kind: 'image', url: IMG },
    ]).map(m => m.url)
    expect(urls).toEqual([PDF, V1, IMG])
  })
})

describe('guessKind', () => {
  it.each([
    ['https://youtu.be/abc', 'video'],
    ['https://www.youtube.com/watch?v=abc', 'video'],
    ['https://vimeo.com/12345', 'video'],
    ['https://www.loom.com/share/abc', 'video'],
    ['https://example.com/a.HEIC', 'image'],
    ['https://example.com/a.docx', 'document'],
    ['https://example.com/shop', 'link'],
  ])('reads %s as %s', (url, kind) => {
    expect(guessKind(url)).toBe(kind)
  })

  it('does not throw on something that is not a URL', () => {
    expect(guessKind('nonsense')).toBe('link')
  })
})

describe('readMedia — rows saved in either era', () => {
  it('prefers the stored list', () => {
    expect(readMedia({
      media: [{ kind: 'image', url: IMG }],
      videoUrl: V1,
      imageUrl: 'https://example.com/old.png',
    })).toEqual([{ kind: 'image', url: IMG }])
  })

  // The whole point of this change is that nobody's handout goes missing. An
  // item saved before the list existed has to open showing everything it had.
  it('rebuilds a pre-list item from its old columns, in the screen’s order', () => {
    expect(readMedia({
      media: [],
      videos: [{ url: V1, title: 'Step 1' }, { url: V2 }],
      videoUrl: V1,
      imageUrl: IMG,
      fileUrl: PDF,
      fileName: 'Handout.pdf',
    })).toEqual([
      { kind: 'video', url: V1, title: 'Step 1' },
      { kind: 'video', url: V2 },
      { kind: 'image', url: IMG },
      { kind: 'document', url: PDF, fileName: 'Handout.pdf' },
    ])
  })

  it('rebuilds an item that only ever had the single videoUrl', () => {
    expect(readMedia({ media: [], videos: [], videoUrl: V1 }))
      .toEqual([{ kind: 'video', url: V1 }])
  })

  it('rebuilds a homework snapshot, whose images are a list', () => {
    expect(readMedia({ media: [], imageUrls: [IMG, 'https://example.com/two.png'] }))
      .toEqual([
        { kind: 'image', url: IMG },
        { kind: 'image', url: 'https://example.com/two.png' },
      ])
  })

  it('is empty for a row with nothing attached', () => {
    expect(readMedia({ media: [] })).toEqual([])
    expect(readMedia(null)).toEqual([])
    expect(readMedia(undefined)).toEqual([])
  })

  it('does not resurrect a javascript: URL from an old column', () => {
    expect(readMedia({ media: [], imageUrl: 'javascript:alert(1)' })).toEqual([])
  })

  it('handles a media column that is not an array', () => {
    expect(readMedia({ media: 'oops', imageUrl: IMG })).toEqual([{ kind: 'image', url: IMG }])
  })
})

describe('legacyRows', () => {
  it('leaves out a handout with no filename’s label rather than inventing one', () => {
    expect(legacyRows({ fileUrl: PDF })).toEqual([{ kind: 'document', url: PDF }])
  })
})

describe('mediaColumns — the list and its columns can never disagree', () => {
  const list: MediaItem[] = [
    { kind: 'document', url: PDF, fileName: 'Handout.pdf' },
    { kind: 'video', url: V1, title: 'Step 1' },
    { kind: 'image', url: IMG },
    { kind: 'video', url: V2 },
  ]

  it('derives every old column from the list', () => {
    expect(mediaColumns(list)).toEqual({
      media: list,
      videos: [{ url: V1, title: 'Step 1' }, { url: V2 }],
      videoUrl: V1,
      imageUrl: IMG,
      fileUrl: PDF,
      fileName: 'Handout.pdf',
    })
  })

  // The cover is a consequence of the order the trainer already drags into,
  // rather than a checkbox asking them to say the same thing twice.
  it('makes the FIRST image the item’s picture, so a reorder changes it', () => {
    const two: MediaItem[] = [
      { kind: 'image', url: 'https://example.com/first.png' },
      { kind: 'image', url: IMG },
    ]
    expect(mediaColumns(two).imageUrl).toBe('https://example.com/first.png')
    expect(mediaColumns([...two].reverse()).imageUrl).toBe(IMG)
  })

  it('nulls every column for an empty list', () => {
    expect(mediaColumns([])).toEqual({
      media: [], videos: [], videoUrl: null, imageUrl: null, fileUrl: null, fileName: null,
    })
  })

  it('sanitizes on the way in, so a bad row never reaches a column', () => {
    expect(mediaColumns([{ kind: 'image', url: 'javascript:alert(1)' } as MediaItem]).imageUrl).toBeNull()
  })
})

describe('homeworkMediaColumns — the snapshot shape', () => {
  it('keeps every image, because TrainingTask holds a list of them', () => {
    const list: MediaItem[] = [
      { kind: 'image', url: IMG },
      { kind: 'video', url: V1 },
      { kind: 'image', url: 'https://example.com/two.png' },
    ]
    expect(homeworkMediaColumns(list)).toEqual({
      media: list,
      videos: [{ url: V1 }],
      videoUrl: V1,
      imageUrls: [IMG, 'https://example.com/two.png'],
    })
  })

  // A handout has no column of its own on a TrainingTask — `media` is the only
  // place it can live, and that is exactly why it was being lost.
  it('carries a handout in the list even though no column holds it', () => {
    const out = homeworkMediaColumns([{ kind: 'document', url: PDF, fileName: 'Handout.pdf' }])
    expect(out.media).toEqual([{ kind: 'document', url: PDF, fileName: 'Handout.pdf' }])
    expect(out.imageUrls).toEqual([])
    expect(out.videoUrl).toBeNull()
  })
})

describe('mediaVideos', () => {
  it('is just the video rows, in order', () => {
    expect(mediaVideos([
      { kind: 'image', url: IMG },
      { kind: 'video', url: V1, title: 'Step 1' },
      { kind: 'video', url: V2 },
    ])).toEqual([{ url: V1, title: 'Step 1' }, { url: V2 }])
  })
})

describe('mediaLabel — what to call a row with no name', () => {
  const list: MediaItem[] = [
    { kind: 'video', url: V1 },
    { kind: 'image', url: IMG },
    { kind: 'video', url: V2 },
    { kind: 'document', url: PDF, fileName: 'Week 1.pdf' },
  ]

  it('numbers within the kind, which is what a trainer means', () => {
    expect(mediaLabel(list, 0)).toBe('Video 1')
    expect(mediaLabel(list, 1)).toBe('Image 1')
    expect(mediaLabel(list, 2)).toBe('Video 2')
  })

  it('uses a document’s filename before a made-up number', () => {
    expect(mediaLabel(list, 3)).toBe('Week 1.pdf')
  })

  it('prefers the trainer’s own title', () => {
    expect(mediaLabel([{ kind: 'video', url: V1, title: 'Step 1 — approach' }], 0))
      .toBe('Step 1 — approach')
  })

  it('is empty for an index that is not there', () => {
    expect(mediaLabel(list, 99)).toBe('')
  })
})
