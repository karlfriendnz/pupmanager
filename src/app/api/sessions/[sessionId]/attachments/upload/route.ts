import { NextResponse } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { accessibleSessionWhere } from '@/lib/session-access'

// Vercel Blob client-upload handshake. The browser hits this twice:
//   1. before upload — to get a one-shot token (`onBeforeGenerateToken`)
//   2. after upload — Blob calls back here with the final URL
//      (`onUploadCompleted`) and we persist the SessionAttachment row.
// Direct-to-Blob upload bypasses our function's body limit, which lets
// us accept the 100 MB videos cap without setting up multipart streaming.
//
// Hard limits (also enforced client-side, but never trust the client):
//   image: 10 MB
//   video: 100 MB
const IMAGE_MAX = 10 * 1024 * 1024
const VIDEO_MAX = 100 * 1024 * 1024

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const trainerId = ctx.companyId

  const { sessionId } = await params

  // Verify the caller can access this session before issuing a token.
  const owns = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId, ...accessibleSessionWhere(ctx) },
    select: { id: true },
  })
  if (!owns) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = (await req.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayloadStr) => {
        // The client tells us {kind, sizeBytes, durationMs?, caption?}
        // through clientPayload. We re-validate the size against the
        // type-specific cap so a hostile client can't bypass it.
        // 'THUMBNAIL' is a child asset of a VIDEO row — uploaded
        // through the same auth path but never given its own
        // SessionAttachment row (the video row's thumbnailUrl points
        // at it). Treated as a tiny image for size purposes.
        const payload = parsePayload(clientPayloadStr)
        const isVideo = payload.kind === 'VIDEO'
        const isImage = payload.kind === 'IMAGE'
        const isThumbnail = payload.kind === 'THUMBNAIL'
        if (!isVideo && !isImage && !isThumbnail) throw new Error('Unsupported attachment kind')
        const max = isVideo ? VIDEO_MAX : isThumbnail ? 2 * 1024 * 1024 : IMAGE_MAX
        if (payload.sizeBytes && payload.sizeBytes > max) {
          throw new Error(isVideo ? 'Video exceeds 100 MB' : 'Image exceeds 10 MB')
        }
        // We deliberately don't restrict by allowedContentTypes here —
        // iOS sometimes sends `video/quicktime` for an .mp4 picked from
        // the camera roll, or `application/octet-stream` when the
        // extension is unfamiliar, and Vercel Blob 400s the upload if
        // the file's reported MIME isn't in the allow-list. Trust the
        // `kind` from clientPayload (already validated above) and
        // enforce size + auth at the route level.
        return {
          maximumSizeInBytes: max,
          // The pathname itself stays untouched — Blob inserts a random
          // suffix when we set addRandomSuffix:true (default), giving
          // unguessable URLs without a separate signing layer.
          tokenPayload: JSON.stringify({
            trainerId,
            sessionId,
            kind: payload.kind,
            sizeBytes: payload.sizeBytes,
            durationMs: payload.durationMs ?? null,
            caption: payload.caption ?? null,
          }),
        }
      },

      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Prod-only safety net. The browser also POSTs back to
        // /api/sessions/[id]/attachments with the same URL after
        // upload() resolves — that route is idempotent on URL, so
        // whichever path fires first wins and the other is a no-op.
        // (In local dev this webhook never fires because Vercel
        // can't reach localhost; the client-side POST is the only
        // mechanism that actually persists rows there.)
        if (!tokenPayload) return
        const meta = JSON.parse(tokenPayload) as {
          trainerId: string
          sessionId: string
          kind: 'IMAGE' | 'VIDEO' | 'THUMBNAIL'
          sizeBytes: number
          durationMs: number | null
          caption: string | null
        }
        // Thumbnails are children of a video — we don't write a row
        // for them; the parent video row's thumbnailUrl will reference
        // this URL once the client confirms the video.
        if (meta.kind === 'THUMBNAIL') return
        const existing = await prisma.sessionAttachment.findFirst({
          where: { sessionId: meta.sessionId, url: blob.url },
        })
        if (existing) return
        await prisma.sessionAttachment.create({
          data: {
            sessionId: meta.sessionId,
            trainerId: meta.trainerId,
            kind: meta.kind,
            url: blob.url,
            sizeBytes: meta.sizeBytes,
            durationMs: meta.durationMs,
            caption: meta.caption,
          },
        })
      },
    })
    return NextResponse.json(jsonResponse)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload setup failed'
    console.error('[session attachments upload]', message)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

function parsePayload(raw: string | null): {
  kind?: 'IMAGE' | 'VIDEO' | 'THUMBNAIL'
  sizeBytes?: number
  durationMs?: number | null
  caption?: string | null
} {
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}
