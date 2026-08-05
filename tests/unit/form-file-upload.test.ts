import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The file/image upload question, end to end.
 *
 * A form could ask for words, numbers and choices and nothing else, which is
 * why "upload a photo of your dog" had nowhere to live. The answer is a list of
 * URLs — the shape SessionFormResponse.imagesByQuestion has always used — and
 * the file itself goes to blob storage BEFORE the form is submitted, because a
 * photo inside a JSON body is the ~4.5 MB request-body cap waiting to happen.
 *
 * Three things are pinned here, and all three are AGENTS.md bugs this repo has
 * already written once:
 *
 *   #1 what the trainer configured survives a save and a reload;
 *   #3 an un-uploaded required file is refused BY THE SERVER, not by the form;
 *   #5 the browser is believed about nothing — the route re-derives what the
 *      question allows from the stored form.
 */

const h = vi.hoisted(() => ({
  formFindFirst: vi.fn(),
  clientFindUnique: vi.fn(),
  auth: vi.fn(),
  getActiveClient: vi.fn(),
  enforceRateLimit: vi.fn(),
  put: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    form: { findFirst: h.formFindFirst },
    clientProfile: { findUnique: h.clientFindUnique },
  },
}))
vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/client-context', () => ({ getActiveClient: h.getActiveClient }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.enforceRateLimit, getClientIp: () => '1.2.3.4' }))
vi.mock('@vercel/blob', () => ({ put: h.put }))

import {
  fileSpecFor,
  fileAnswerUrls,
  isQuestionAnswered,
  missingRequiredQuestions,
  serializeQuestions,
  validateForm,
  createQuestion,
  TYPE_LABELS,
  NEW_QUESTION_TYPES,
  type FileQuestion,
  type Question,
} from '@/lib/session-form-builder'
import { questionSchema } from '@/lib/form-api'
import { POST } from '@/app/api/form/[formId]/upload/route'

const TRAINER = 'trainer-1'
const FORM = 'form-1'
const PHOTO_Q: FileQuestion = { id: 'q_photo', type: 'FILE_UPLOAD', label: 'A photo of your dog', required: true }

// ─── The question type ──────────────────────────────────────────────────────

describe('the file question', () => {
  it('is offered in the builder and reads as words', () => {
    expect(NEW_QUESTION_TYPES).toContain('FILE_UPLOAD')
    expect(TYPE_LABELS.FILE_UPLOAD).toBe('File or photo')
  })

  it('starts as one photo, which is what "upload dog image" means', () => {
    const q = createQuestion('FILE_UPLOAD', 'q1') as FileQuestion
    expect(q).toMatchObject({ id: 'q1', type: 'FILE_UPLOAD', label: '', required: false })
    expect(fileSpecFor(q)).toEqual({ accept: 'IMAGE', maxFiles: 1, maxMb: 10 })
  })

  it('lets a trainer widen it to several documents', () => {
    expect(fileSpecFor({ ...PHOTO_Q, accept: 'ANY', maxFiles: 3 })).toEqual({ accept: 'ANY', maxFiles: 3, maxMb: 10 })
  })

  it('clamps a silly count rather than trusting the stored number', () => {
    expect(fileSpecFor({ ...PHOTO_Q, maxFiles: 999 }).maxFiles).toBe(10)
    expect(fileSpecFor({ ...PHOTO_Q, maxFiles: 0 }).maxFiles).toBe(1)
  })

  it('still needs a label like every other authored question', () => {
    expect(validateForm('Intake', [{ ...PHOTO_Q, label: '  ' }])).toBe('Every question needs a label')
    expect(validateForm('Intake', [PHOTO_Q])).toBeNull()
  })
})

// AGENTS.md bug #1 — the one this repo keeps writing. A question's own settings
// have to come back off a save, or "attach up to 3 photos" silently becomes
// "attach 1" the next time the trainer opens the form.
describe('a file question round-trips', () => {
  it('keeps accept and maxFiles through serialise → validate → parse', () => {
    const authored: FileQuestion = { ...PHOTO_Q, accept: 'ANY', maxFiles: 4, isPrivate: true, step: 'dog' }
    const stored = JSON.parse(JSON.stringify(serializeQuestions([authored])))[0]
    const parsed = questionSchema.parse(stored)
    expect(parsed).toMatchObject({
      id: 'q_photo', type: 'FILE_UPLOAD', label: 'A photo of your dog',
      required: true, isPrivate: true, accept: 'ANY', maxFiles: 4, step: 'dog',
    })
    expect(fileSpecFor(parsed as FileQuestion)).toEqual({ accept: 'ANY', maxFiles: 4, maxMb: 10 })
  })

  it('adds nothing the trainer never set', () => {
    const stored = serializeQuestions([PHOTO_Q])[0] as unknown as Record<string, unknown>
    expect(stored.accept).toBeUndefined()
    expect(stored.maxFiles).toBeUndefined()
  })

  it('is refused by the API when its settings are nonsense', () => {
    expect(questionSchema.safeParse({ ...PHOTO_Q, accept: 'VIDEO' }).success).toBe(false)
    expect(questionSchema.safeParse({ ...PHOTO_Q, maxFiles: 99 }).success).toBe(false)
    expect(questionSchema.safeParse({ ...PHOTO_Q, label: '' }).success).toBe(false)
  })
})

// AGENTS.md bug #3 — validation in the browser is not validation. An empty
// intake once stamped itself complete and lifted the gate.
describe('a required file the client never uploaded is missing, server-side', () => {
  const questions: Question[] = [PHOTO_Q]

  it('counts an upload that happened', () => {
    expect(isQuestionAnswered(PHOTO_Q, { q_photo: ['https://blob/x.jpg'] })).toBe(true)
    expect(missingRequiredQuestions(questions, { q_photo: ['https://blob/x.jpg'] })).toEqual([])
  })

  it('refuses every shape of "nothing was uploaded"', () => {
    for (const answer of [undefined, [], [''], ['   '], '', '  '] as (string | string[] | undefined)[]) {
      expect(isQuestionAnswered(PHOTO_Q, { q_photo: answer }), JSON.stringify(answer)).toBe(false)
      expect(missingRequiredQuestions(questions, { q_photo: answer }).map(q => q.id)).toEqual(['q_photo'])
    }
  })

  it('does not block an optional one', () => {
    expect(missingRequiredQuestions([{ ...PHOTO_Q, required: false }], {})).toEqual([])
  })

  // A single URL stored as a bare string reads as one file, not as the
  // characters of a URL.
  it('reads one url or many the same way', () => {
    expect(fileAnswerUrls('https://blob/x.jpg')).toEqual(['https://blob/x.jpg'])
    expect(fileAnswerUrls(['https://blob/x.jpg', ''])).toEqual(['https://blob/x.jpg'])
    expect(fileAnswerUrls(undefined)).toEqual([])
  })
})

// ─── The upload endpoint ────────────────────────────────────────────────────

function upload(opts: {
  size?: number
  type?: string
  questionId?: string
  name?: string
  formId?: string
}) {
  const { size = 1024, type = 'image/jpeg', questionId = 'q_photo', name = 'dog.jpg', formId = FORM } = opts
  const file = new File([new Uint8Array(size)], name, { type })
  const fd = new FormData()
  fd.append('file', file)
  fd.append('questionId', questionId)
  return POST(new Request(`https://app.pupmanager.com/api/form/${formId}/upload`, { method: 'POST', body: fd }), {
    params: Promise.resolve({ formId }),
  })
}

const publicForm = (questions: unknown[] = [PHOTO_Q]) => ({
  id: FORM, trainerId: TRAINER, questions, usableAsEnquiry: true,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.enforceRateLimit.mockResolvedValue(null)
  h.formFindFirst.mockResolvedValue(publicForm())
  h.auth.mockResolvedValue(null)
  h.getActiveClient.mockResolvedValue(null)
  h.clientFindUnique.mockResolvedValue(null)
  h.put.mockResolvedValue({ url: 'https://blob.test/form-uploads/x.jpg' })
})

describe('POST /api/form/[formId]/upload', () => {
  it('accepts a photo for a published enquiry form and hands back its url', async () => {
    const res = await upload({})
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://blob.test/form-uploads/x.jpg' })
    // Every segment of the path is ours — the form was looked up and the
    // question was found ON it, so nothing the browser sent reaches the key.
    expect(h.put.mock.calls[0][0]).toMatch(new RegExp(`^form-uploads/${TRAINER}/${FORM}/q_photo/[0-9a-f-]+\\.jpg$`))
    expect(h.put.mock.calls[0][2]).toMatchObject({ access: 'public', addRandomSuffix: false })
  })

  it('is rate limited before it looks at anything', async () => {
    h.enforceRateLimit.mockResolvedValue(new Response('slow down', { status: 429 }))
    const res = await upload({})
    expect(res.status).toBe(429)
    expect(h.formFindFirst).not.toHaveBeenCalled()
  })

  it('only looks at a published form', async () => {
    h.formFindFirst.mockResolvedValue(null)
    expect((await upload({})).status).toBe(404)
    expect(h.formFindFirst.mock.calls[0][0].where).toMatchObject({ id: FORM, isActive: true })
    expect(h.put).not.toHaveBeenCalled()
  })

  // The whole point of re-reading the question off the stored form: a question
  // id posted from a browser is a claim, not a fact.
  it('refuses a question id that is not a file question', async () => {
    h.formFindFirst.mockResolvedValue(publicForm([{ id: 'q_name', type: 'SHORT_TEXT', label: 'Name', required: true }]))
    const res = await upload({ questionId: 'q_name' })
    expect(res.status).toBe(400)
    expect(h.put).not.toHaveBeenCalled()
  })

  it('refuses a question that is not on this form at all', async () => {
    expect((await upload({ questionId: 'q_somewhere_else' })).status).toBe(400)
    expect(h.put).not.toHaveBeenCalled()
  })

  // AGENTS.md bug #3 again: the browser also checks the size, and the browser
  // is not what enforces it.
  it('refuses a file over the cap even though the picker already checked', async () => {
    const res = await upload({ size: 11 * 1024 * 1024 })
    expect(res.status).toBe(413)
    expect(h.put).not.toHaveBeenCalled()
  })

  it('refuses a document for a photo question', async () => {
    const res = await upload({ type: 'application/pdf', name: 'vet.pdf' })
    expect(res.status).toBe(415)
    expect(h.put).not.toHaveBeenCalled()
  })

  it('accepts a document when the question asks for one', async () => {
    h.formFindFirst.mockResolvedValue(publicForm([{ ...PHOTO_Q, accept: 'ANY' }]))
    expect((await upload({ type: 'application/pdf', name: 'vet.pdf' })).status).toBe(200)
    expect(h.put.mock.calls[0][0]).toMatch(/\.pdf$/)
  })

  it('refuses a file with no type at all', async () => {
    expect((await upload({ type: '' })).status).toBe(415)
  })
})

// A client form is not public. Only the client it was assigned to may add to
// it — otherwise any signed-in client could post files against any trainer's
// form, which is the same tenant hole a form id from a browser always is.
describe('a form that is not published as an enquiry form', () => {
  const clientForm = { id: FORM, trainerId: TRAINER, questions: [PHOTO_Q], usableAsEnquiry: false }

  beforeEach(() => h.formFindFirst.mockResolvedValue(clientForm))

  it('refuses a stranger', async () => {
    expect((await upload({})).status).toBe(401)
    expect(h.put).not.toHaveBeenCalled()
  })

  it('refuses a client this form was not assigned to', async () => {
    h.auth.mockResolvedValue({ user: { role: 'CLIENT' } })
    h.getActiveClient.mockResolvedValue({ clientId: 'c1' })
    h.clientFindUnique.mockResolvedValue({ intakeFormId: 'some-other-form', trainerId: TRAINER })
    expect((await upload({})).status).toBe(401)
    expect(h.put).not.toHaveBeenCalled()
  })

  it('refuses a client of another business holding the same form id', async () => {
    h.auth.mockResolvedValue({ user: { role: 'CLIENT' } })
    h.getActiveClient.mockResolvedValue({ clientId: 'c1' })
    h.clientFindUnique.mockResolvedValue({ intakeFormId: FORM, trainerId: 'another-trainer' })
    expect((await upload({})).status).toBe(401)
  })

  it('refuses a signed-in TRAINER — this is the client’s own form', async () => {
    h.auth.mockResolvedValue({ user: { role: 'TRAINER' } })
    expect((await upload({})).status).toBe(401)
  })

  it('lets the client it was assigned to upload', async () => {
    h.auth.mockResolvedValue({ user: { role: 'CLIENT' } })
    h.getActiveClient.mockResolvedValue({ clientId: 'c1' })
    h.clientFindUnique.mockResolvedValue({ intakeFormId: FORM, trainerId: TRAINER })
    expect((await upload({})).status).toBe(200)
  })
})
