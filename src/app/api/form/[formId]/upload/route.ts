import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { put } from '@vercel/blob'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit'
import { fileSpecFor, type Question, type FileQuestion } from '@/lib/session-form-builder'

// One file, for one FILE_UPLOAD question on one Form.
//
// The upload happens BEFORE the form is submitted, so what the submit body
// carries is a URL rather than a photo — a 4 MB image inside a JSON body is the
// exact shape that hits Vercel's ~4.5 MB serverless request-body cap, which
// this app has already shipped an "upload is broken" report over.
//
// /api/upload/image can't serve this: it is gated to `role === 'TRAINER'`, and
// the people filling forms in are clients and strangers. So the authorisation
// here is the form's own:
//
//   • a form published as an ENQUIRY form is public, exactly as its submit
//     endpoint is — same rate limit, same reasoning;
//   • anything else needs a signed-in client whose OWN assigned form this is.
//
// Everything else — what may be attached, how big — is re-derived from the
// stored question. The browser sends a question id and a file and is believed
// about neither: the props of the screen that posts here are page source
// (AGENTS.md bug #5), and a size limit enforced in a browser is not a limit
// (bug #3).

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])
const DOCUMENT_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

/** The FILE_UPLOAD question with this id, or null. Read off the STORED form, so
 *  a question id for a text box can't be used as free file storage. */
function fileQuestion(questions: unknown, questionId: string): FileQuestion | null {
  const list = (Array.isArray(questions) ? questions : []) as unknown as Question[]
  const q = list.find(x => x?.id === questionId)
  return q && q.type === 'FILE_UPLOAD' ? q : null
}

export async function POST(req: Request, { params }: { params: Promise<{ formId: string }> }) {
  // Reachable without a session, and it writes to blob storage — so it is
  // capped per IP before anything else happens.
  const limited = await enforceRateLimit({ key: `form-upload:${getClientIp(req)}`, limit: 30, windowMs: 10 * 60_000 })
  if (limited) return limited

  const { formId } = await params
  const form = await prisma.form.findFirst({
    where: { id: formId, isActive: true },
    select: { id: true, trainerId: true, questions: true, usableAsEnquiry: true },
  })
  if (!form) return NextResponse.json({ error: 'Form not found' }, { status: 404 })

  const formData = await req.formData().catch(() => null)
  const file = formData?.get('file')
  const questionId = formData?.get('questionId')
  if (!(file instanceof File) || typeof questionId !== 'string' || !questionId) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  }

  const question = fileQuestion(form.questions, questionId)
  if (!question) return NextResponse.json({ error: 'That question does not take a file.' }, { status: 400 })

  // ── Who may upload here ────────────────────────────────────────────────────
  // A published enquiry form is answered by strangers, so its uploads are as
  // public as its submissions. Anything else is somebody's own client form, and
  // only the client it was assigned to may add to it — otherwise any signed-in
  // client could post files against any other trainer's form.
  if (!form.usableAsEnquiry) {
    const session = await auth()
    const active = session?.user.role === 'CLIENT' ? await getActiveClient() : null
    const profile = active
      ? await prisma.clientProfile.findUnique({
          where: { id: active.clientId },
          select: { intakeFormId: true, trainerId: true },
        })
      : null
    if (!profile || profile.intakeFormId !== form.id || profile.trainerId !== form.trainerId) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    }
  }

  // ── What may be uploaded ───────────────────────────────────────────────────
  const spec = fileSpecFor(question)
  if (file.size > spec.maxMb * 1024 * 1024) {
    return NextResponse.json({ error: `That file is too big — the limit is ${spec.maxMb} MB.` }, { status: 413 })
  }
  const allowed = spec.accept === 'IMAGE' ? IMAGE_TYPES : new Set([...IMAGE_TYPES, ...DOCUMENT_TYPES])
  if (!file.type || !allowed.has(file.type)) {
    return NextResponse.json(
      { error: spec.accept === 'IMAGE' ? 'Please choose a photo.' : `That file type isn’t accepted: ${file.type || 'unknown'}` },
      { status: 415 },
    )
  }

  // form-uploads/<trainerId>/<formId>/<questionId>/<uuid>.<ext>. The id segments
  // are ours (the form was looked up, the question was found on it), so nothing
  // the browser sent reaches the path.
  const ext = (file.name.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const safeExt = ext.length > 0 && ext.length <= 5 ? ext : 'jpg'
  const pathname = `form-uploads/${form.trainerId}/${form.id}/${question.id}/${crypto.randomUUID()}.${safeExt}`

  try {
    const blob = await put(pathname, file, {
      access: 'public',
      addRandomSuffix: false,
      contentType: file.type,
    })
    return NextResponse.json({ url: blob.url })
  } catch (err) {
    console.error('[form-upload] blob upload failed:', err)
    return NextResponse.json({ error: 'Upload failed — please try again.' }, { status: 502 })
  }
}
