import { describe, it, expect, vi, beforeEach } from 'vitest'
import { enquiryClientBackLink } from '@/lib/client-upsert'

// Enquiry.clientProfileId is @unique — one enquiry per client, which was true
// right up until somebody enquired twice. They ask in March, get taken on, and
// ask again in September about a different course; the second accept resolves
// to the SAME ClientProfile, and writing the link again is a P2002 the trainer
// meets as a 500 on the Accept button.

const findFirst = vi.fn()
const tx = { enquiry: { findFirst } } as never

beforeEach(() => findFirst.mockReset())

describe('enquiryClientBackLink', () => {
  it('links the client when nothing else claims them', async () => {
    findFirst.mockResolvedValue(null)
    expect(await enquiryClientBackLink(tx, 'cp1', 'enq2')).toEqual({ clientProfileId: 'cp1' })
  })

  it('omits the link when an earlier enquiry already holds it', async () => {
    findFirst.mockResolvedValue({ id: 'the-march-enquiry' })
    // Nothing, not null — spread into the update it leaves the column untouched
    // and lets the accept go through. The arrow is a convenience; being able to
    // accept a returning client is not.
    expect(await enquiryClientBackLink(tx, 'cp1', 'enq2')).toEqual({})
  })

  it('does not count the enquiry being accepted as a clash with itself', async () => {
    findFirst.mockResolvedValue(null)
    await enquiryClientBackLink(tx, 'cp1', 'enq2')
    expect(findFirst).toHaveBeenCalledWith({
      where: { clientProfileId: 'cp1', id: { not: 'enq2' } },
      select: { id: true },
    })
  })
})
