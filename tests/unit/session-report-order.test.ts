import { describe, it, expect } from 'vitest'
import { SessionReport } from '@/components/shared/session-report'
import { ReportAttachmentsGallery } from '@/components/shared/report-attachments'

// Karl: "put questions at the top of the report then media then homework."
//
// It used to read media → questions → homework: the gallery was pinned near the
// top "to set the scene", which meant a client opened their recap to a strip of
// photos before anyone had said what the session was about.

/** Walk the rendered tree in document order, emitting a marker per section. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sections(node: any, out: string[] = []): string[] {
  if (node == null || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) sections(child, out)
    return out
  }
  if (node.type === ReportAttachmentsGallery) out.push('media')
  if (typeof node.props?.children === 'string' && node.props.children === 'Tasks for you to practise') {
    out.push('homework')
  }
  if (node.props?.children === 'What we worked on') out.push('questions')
  sections(node.props?.children ?? null, out)
  return out
}

const props = {
  sessionTitle: 'Recall',
  scheduledAt: new Date('2026-07-01T02:00:00Z'),
  dogName: 'Rusty',
  formResponses: [
    {
      id: 'resp-1',
      introMessage: null,
      closingMessage: null,
      answers: { q1: 'Rusty held a sit for thirty seconds.' },
      form: {
        id: 'f1', name: 'Session notes', introText: null, closingText: null,
        backgroundColor: null, backgroundUrl: null,
        questions: [{ id: 'q1', type: 'LONG_TEXT' as const, label: 'What we worked on' }],
      },
    },
  ],
  tasks: [
    { id: 't1', title: 'Ten recalls a day', description: null, repetitions: 10, videoUrl: null, trainerNote: null },
  ],
  attachments: [
    { id: 'a1', kind: 'IMAGE' as const, url: 'https://example.test/1.jpg', thumbnailUrl: null, caption: null, durationMs: null },
  ],
}

describe('the client report reads questions → media → homework', () => {
  it('puts all three sections in that order', () => {
    expect(sections(SessionReport(props))).toEqual(['questions', 'media', 'homework'])
  })

  it('holds the order when there is no media in between', () => {
    expect(sections(SessionReport({ ...props, attachments: [] })))
      .toEqual(['questions', 'homework'])
  })

  it('a media-only session still renders its gallery', () => {
    expect(sections(SessionReport({ ...props, formResponses: [], tasks: [] })))
      .toEqual(['media'])
  })
})
