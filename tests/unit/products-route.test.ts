import { describe, it, expect, vi, beforeEach } from 'vitest'

// Products save. The regression this file exists for: every product created by
// the in-app sample-data loader (src/lib/demo-seed.ts) stores a ROOT-RELATIVE
// image path — `/concept-products/leash.jpg` — while both routes validated
// imageUrl with a bare `z.string().url()`. So the edit form loaded the product
// fine, sent the same imageUrl straight back, and the PATCH answered
// 400 `{"error":{"fieldErrors":{"imageUrl":["Invalid URL"]}}}`. Every sample
// product was uneditable; the trainer just saw "Save failed".
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  guardPermission: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  findUnique: vi.fn(),
  del: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    product: {
      create: h.create,
      update: h.update,
      findUnique: h.findUnique,
      delete: h.del,
      findMany: vi.fn(),
    },
  },
}))

import { POST } from '@/app/api/products/route'
import { PATCH } from '@/app/api/products/[productId]/route'

const TRAINER = 'trainer_1'
const PRODUCT = 'prod_1'

const post = (body: unknown) =>
  POST(new Request('https://app.pupmanager.com/api/products', {
    method: 'POST',
    body: JSON.stringify(body),
  }))

const patch = (body: unknown, productId = PRODUCT) =>
  PATCH(
    new Request(`https://app.pupmanager.com/api/products/${productId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ productId }) }
  )

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  h.guardPermission.mockResolvedValue({ companyId: TRAINER, role: 'OWNER' })
  h.auth.mockResolvedValue({ user: { role: 'TRAINER', trainerId: TRAINER } })
  h.findUnique.mockResolvedValue({ id: PRODUCT, trainerId: TRAINER })
  h.create.mockImplementation(({ data }: { data: object }) => ({ id: PRODUCT, ...data }))
  h.update.mockImplementation(({ data }: { data: object }) => ({ id: PRODUCT, ...data }))
})

describe('product save — asset paths the app itself writes', () => {
  // THE regression. Fails without the asset-url fix.
  it('PATCH accepts the root-relative image path the sample loader stores', async () => {
    const res = await patch({
      name: 'Long line — 10m',
      description: 'Biothane long line for recall practice.',
      kind: 'PHYSICAL',
      priceCents: 4500,
      stockCount: null,
      imageUrl: '/concept-products/leash.jpg',
      downloadUrl: null,
      category: 'Equipment',
      featured: true,
      active: true,
      xeroAccountCode: null,
      requirePayment: null,
    })
    expect(res.status).toBe(200)
    expect(h.update).toHaveBeenCalledTimes(1)
    expect(h.update.mock.calls[0][0].data).toMatchObject({
      imageUrl: '/concept-products/leash.jpg',
    })
  })

  it('POST accepts a root-relative image path too', async () => {
    const res = await post({ name: 'Treat pouch', imageUrl: '/concept-products/treats.jpg' })
    expect(res.status).toBe(201)
    expect(h.create.mock.calls[0][0].data).toMatchObject({
      imageUrl: '/concept-products/treats.jpg',
    })
  })

  it('a root-relative download path is accepted on a digital product', async () => {
    const res = await patch({ kind: 'DIGITAL', downloadUrl: '/concept-products/guide.pdf' })
    expect(res.status).toBe(200)
  })

  it('still accepts an absolute https upload URL', async () => {
    const res = await patch({ imageUrl: 'https://blob.vercel-storage.com/x.jpg' })
    expect(res.status).toBe(200)
  })

  it('still accepts null (image removed) and empty string', async () => {
    expect((await patch({ imageUrl: null })).status).toBe(200)
    expect((await patch({ imageUrl: '' })).status).toBe(200)
  })

  it('still rejects junk that is neither a URL nor a path', async () => {
    const res = await patch({ imageUrl: 'javascript:alert(1)' })
    expect(res.status).toBe(400)
  })

  it('a long rich-text description saves — the old 2000-char cap rejected it', async () => {
    const html = `<p>${'Loose leash walking. '.repeat(300)}</p>`
    expect(html.length).toBeGreaterThan(2000)
    const res = await patch({ description: html })
    expect(res.status).toBe(200)
  })
})

describe('product save — tenant + permission guards', () => {
  it('PATCH 404s on another trainer’s product', async () => {
    h.findUnique.mockResolvedValue({ id: PRODUCT, trainerId: 'someone_else' })
    const res = await patch({ name: 'Hijacked' })
    expect(res.status).toBe(404)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('POST refuses a session without products.manage', async () => {
    const { NextResponse } = await import('next/server')
    h.guardPermission.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    )
    const res = await post({ name: 'Nope' })
    expect(res.status).toBe(403)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('PATCH refuses a non-trainer session', async () => {
    h.auth.mockResolvedValue({ user: { role: 'CLIENT' } })
    const res = await patch({ name: 'Nope' })
    expect(res.status).toBe(401)
    expect(h.update).not.toHaveBeenCalled()
  })
})
