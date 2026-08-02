import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Handing a library item to a client COPIES it — the homework is a snapshot, so
// editing the item later never rewrites work already given out. This has now
// dropped an attachment on the floor TWICE: the picture (reported 2026-07-30)
// and then the handout, which had nowhere to go on a TrainingTask at all.
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
    // EVERYTHING attached, in the trainer's order — clips, pictures, handouts
    // and links. One list, so there is no longer a field to forget: a new kind
    // of attachment travels the moment it can be added.
    ['every attachment', '...homeworkMediaColumns(readMedia(task))'],
  ])('carries %s', (_label, snippet) => {
    expect(assign()).toContain(snippet)
  })

  // readMedia, not `task.media` — an item saved before the list existed has its
  // picture, handout and clips only in the old columns, and assigning it must
  // still hand all of them over.
  it('reads the item through readMedia, so a pre-list item still copies', () => {
    expect(assign()).toContain('readMedia(task)')
    expect(assign()).not.toMatch(/media:\s*task\.media/)
  })

  // homeworkMediaColumns writes `media` AND the columns derived from it
  // (videos / videoUrl / imageUrls). Setting one without the others is how they
  // would drift apart while older readers still select the single fields.
  it('never writes the list without the derived columns beside it', () => {
    expect(assign()).not.toMatch(/\bvideos:\s*(?!.*homeworkMediaColumns)/)
    expect(assign()).not.toMatch(/\bimageUrls:\s*(?!.*homeworkMediaColumns)/)
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

  // Homework handed out before the list existed has only the old columns, and
  // it still has to show its video and its photos.
  it('reads the attachments through readMedia, so older homework keeps them', () => {
    expect(page()).toContain('readMedia(task)')
    expect(page()).toContain('<MediaList media={media}')
  })

  // The handout is the attachment that never reached a client at all — there
  // was nowhere on a TrainingTask to put a PDF. The renderer has to know the
  // kind exists, or it silently drops it again.
  const list = () => readFileSync(
    resolve(__dirname, '../../src/components/shared/media-list.tsx'), 'utf8')

  it('shows a handout to the client, with a way to keep it', () => {
    expect(list()).toContain("row.kind === 'document'")
    expect(list()).toContain('download={row.fileName')
  })
})
