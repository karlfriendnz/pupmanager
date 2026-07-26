import { z } from 'zod'

/**
 * A stored asset reference — an image, a downloadable file, a cover photo.
 *
 * Two shapes are legitimate and both live in the database today:
 *
 *  - an absolute `https://…` URL, which is what every upload returns (Vercel
 *    Blob), and what a trainer pastes when they host the file themselves; and
 *  - a root-relative app path like `/concept-products/leash.jpg`, which is what
 *    the in-app sample-data loader (`src/lib/demo-seed.ts`) writes so the demo
 *    shop has photos without uploading anything.
 *
 * A bare `z.string().url()` rejects the second kind, so any row the sample
 * loader created became uneditable: the form faithfully sent the imageUrl back
 * and the PATCH answered 400 `imageUrl: Invalid URL`. Validate the union.
 */
export function assetUrlSchema(max = 2048) {
  return z
    .string()
    .max(max)
    .refine(
      (v) => v === '' || /^https?:\/\//i.test(v) || v.startsWith('/'),
      'Enter a full https:// address, or an app path starting with /'
    )
}

/** Convenience: optional + nullable, the shape every route actually wants. */
export function optionalAssetUrlSchema(max = 2048) {
  return assetUrlSchema(max).nullable().optional()
}
