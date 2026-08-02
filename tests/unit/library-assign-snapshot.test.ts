import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Handing a library item to a client COPIES it — the homework is a snapshot, so
// editing the item later never rewrites work already given out. The bug: the copy
// forgot the picture, so a trainer who attached a photo handed out homework that
// had silently lost it (reported 2026-07-30).
//
// A file check rather than a mocked call, because the risk isn't the logic — it's
// a field being left out of the copy again. This lists what has to travel.

const assign = () => readFileSync(
  resolve(__dirname, '../../src/app/api/library/tasks/[taskId]/assign/route.ts'), 'utf8')

describe('assigning a library item copies the whole item', () => {
  it.each([
    ['the title', 'title: task.title'],
    ['the description', 'description: task.description'],
    ['the reps', 'repetitions: task.repetitions'],
    // EVERY clip, not just the first. An exercise taught as three short videos
    // would otherwise reach the client as one, missing the two steps after it.
    ['the videos', '...videoColumns(readVideos(task))'],
    // The one that was missing.
    ['the picture', 'imageUrls: task.imageUrl ? [task.imageUrl] : []'],
  ])('carries %s', (_label, snippet) => {
    expect(assign()).toContain(snippet)
  })

  // videoColumns writes `videos` AND mirrors `videos[0]` into the old
  // `videoUrl` column. Setting one without the other is how the two would drift
  // apart while older readers still select the single field.
  it('never writes the video list without the single column beside it', () => {
    expect(assign()).not.toMatch(/videos:\s*(?!.*videoColumns)/)
  })

  // Provenance, so the library item can show who has it — but NOT a live link:
  // the copied fields above are what the client reads.
  it('records where it came from', () => {
    expect(assign()).toContain('libraryTaskId: task.id')
  })
})

describe('the client reads the homework as rich text', () => {
  const page = () => readFileSync(
    resolve(__dirname, '../../src/app/(client)/my-homework/[taskId]/page.tsx'), 'utf8')

  // It's Tiptap HTML. Rendered as text it printed its own <p> tags on screen.
  it('renders the description through RichText', () => {
    expect(page()).toContain('<RichText html={task.description} />')
  })

  it('does not print the description as plain text', () => {
    expect(page()).not.toMatch(/whitespace-pre-wrap[^>]*>\{task\.description\}/)
  })

  // An uploaded clip has no embed URL, so it fell through to a link that
  // navigated away from the exercise. The three-way choice moved into a shared
  // component when one exercise became a LIST of clips — same guard, new home.
  const player = () => readFileSync(
    resolve(__dirname, '../../src/components/shared/instructional-video.tsx'), 'utf8')

  it('plays an uploaded video inline instead of linking away', () => {
    expect(player()).toContain('isDirectVideo')
    expect(player()).toContain('<VideoPlayer src={video.url} />')
  })

  // Homework handed out before the list existed has only the single column, and
  // it still has to show its video.
  it('reads the clips through readVideos, so older homework keeps its video', () => {
    expect(page()).toContain('readVideos(task)')
    expect(page()).toContain('<InstructionalVideoList videos={videos} />')
  })
})
