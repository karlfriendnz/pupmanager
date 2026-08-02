import { describe, it, expect } from 'vitest'
import { resolveVariantPresentation } from '@/lib/product-price'
import { sanitizeRichHtml } from '@/lib/rich-text'

// A variant's PHOTO and DESCRIPTION inherit from the product exactly as its
// price does, and for the same reason: three sizes of one harness share one
// picture and one blurb, typed once. The trainer's editor, the client's shop
// and the buy path all have to agree about what a blank field means, so the
// rule lives in one helper — resolveVariantPresentation — and this pins it.

const PRODUCT = {
  imageUrl: 'https://blob.example/harness.jpg',
  description: '<p>Front-clip harness, padded chest.</p>',
}

describe('resolveVariantPresentation — description', () => {
  it('inherits the product’s description when the variant has none', () => {
    const r = resolveVariantPresentation(PRODUCT, { description: null, imageUrl: null })
    expect(r.description).toBe('<p>Front-clip harness, padded chest.</p>')
    expect(r.inheritsDescription).toBe(true)
  })

  it('the variant’s own description overrides it', () => {
    const r = resolveVariantPresentation(PRODUCT, { description: '<p>Fits 12–18kg.</p>' })
    expect(r.description).toBe('<p>Fits 12–18kg.</p>')
    expect(r.inheritsDescription).toBe(false)
  })

  it('an EMPTIED editor document still inherits — `<p></p>` is not an override', () => {
    // The trap this closes: a trainer types notes on the Medium, changes their
    // mind and deletes them. Tiptap leaves `<p></p>`, not null. Treating that
    // as an override would blank the product's blurb on the shop while the
    // editor showed nothing wrong.
    const r = resolveVariantPresentation(PRODUCT, { description: '<p></p>' })
    expect(r.description).toBe('<p>Front-clip harness, padded chest.</p>')
    expect(r.inheritsDescription).toBe(true)
  })

  it('whitespace and empty strings inherit too', () => {
    expect(resolveVariantPresentation(PRODUCT, { description: '   ' }).inheritsDescription).toBe(true)
    expect(resolveVariantPresentation(PRODUCT, { description: '' }).inheritsDescription).toBe(true)
    expect(resolveVariantPresentation(PRODUCT, { description: '<p>&nbsp;</p>' }).inheritsDescription).toBe(true)
  })

  it('a product with no description and a variant with none leaves nothing to show', () => {
    const r = resolveVariantPresentation({ imageUrl: null, description: null }, { description: null })
    expect(r.description).toBeNull()
    expect(r.inheritsDescription).toBe(true)
  })

  it('no variant at all is just the product’s own', () => {
    const r = resolveVariantPresentation(PRODUCT, null)
    expect(r.description).toBe(PRODUCT.description)
    expect(r.imageUrl).toBe(PRODUCT.imageUrl)
  })
})

describe('resolveVariantPresentation — photo', () => {
  it('inherits the product’s photo when the variant has none', () => {
    const r = resolveVariantPresentation(PRODUCT, { imageUrl: null })
    expect(r.imageUrl).toBe('https://blob.example/harness.jpg')
    expect(r.inheritsImage).toBe(true)
  })

  it('the variant’s own photo overrides it — the Red one shows red', () => {
    const r = resolveVariantPresentation(PRODUCT, { imageUrl: 'https://blob.example/red.jpg' })
    expect(r.imageUrl).toBe('https://blob.example/red.jpg')
    expect(r.inheritsImage).toBe(false)
  })

  it('an empty string is a cleared field, not a photo', () => {
    // What a cleared file input hands back. Overriding with "" would render a
    // broken <img> where the product's photo used to be.
    const r = resolveVariantPresentation(PRODUCT, { imageUrl: '' })
    expect(r.imageUrl).toBe('https://blob.example/harness.jpg')
    expect(r.inheritsImage).toBe(true)
  })

  it('the two inherit INDEPENDENTLY — own photo, product’s words', () => {
    const r = resolveVariantPresentation(PRODUCT, { imageUrl: 'https://blob.example/red.jpg', description: null })
    expect(r.inheritsImage).toBe(false)
    expect(r.inheritsDescription).toBe(true)
  })
})

describe('a variant description is an XSS boundary', () => {
  // Trainers author it, clients read it. The helper deliberately returns the
  // stored HTML unchanged — sanitizing is the DISPLAY step (<RichText>, which
  // runs sanitizeRichHtml) — so what matters is that nothing dangerous can
  // survive the journey to a client's screen.
  const NASTY = '<p>Fits 12–18kg.</p><script>alert(document.cookie)</script><img src=x onerror="steal()">'

  it('does not sanitize on resolve — that is the display step’s job', () => {
    expect(resolveVariantPresentation(PRODUCT, { description: NASTY }).description).toBe(NASTY)
  })

  it('and the display step strips the script, the img and the handler', () => {
    const resolved = resolveVariantPresentation(PRODUCT, { description: NASTY })
    const safe = sanitizeRichHtml(resolved.description)
    expect(safe).not.toContain('<script')
    expect(safe).not.toContain('alert(')
    expect(safe).not.toContain('onerror')
    expect(safe).not.toContain('<img')
    // The trainer's actual words survive.
    expect(safe).toContain('Fits 12–18kg.')
  })

  it('a javascript: link in a variant’s notes does not survive either', () => {
    const resolved = resolveVariantPresentation(PRODUCT, {
      description: '<p><a href="javascript:alert(1)">size guide</a></p>',
    })
    const safe = sanitizeRichHtml(resolved.description)
    expect(safe).not.toContain('javascript:')
    expect(safe).toContain('size guide')
  })
})
