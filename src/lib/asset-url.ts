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

/**
 * A stricter reference, for assets that end up inside a CSS `url()` rather than
 * an `<img src>` — currently the trainer home's background photo.
 *
 * `assetUrlSchema` above is deliberately permissive because it has to accept the
 * app-relative paths the demo seeder writes. That is the wrong trade here: the
 * value arrives from the browser (only the browser knows the upload succeeded),
 * so the server has to treat the string as arbitrary, and it ends up pasted into
 * a stylesheet. Anything that could close the `url()` and open a new declaration
 * is refused outright rather than escaped downstream — escaping still happens at
 * the point of use, but a value that NEEDS escaping has no business being stored.
 *
 * The test is an allowlist, not a blocklist: RFC 3986's unreserved + reserved
 * characters, minus the quotes, parentheses, backslashes and angle brackets that
 * mean something in CSS and HTML. Control characters cannot sneak through a set
 * that only says what IS allowed.
 *
 * https only — every upload route returns a Vercel Blob https URL, and a plain
 * http image would be blocked as mixed content on the real app anyway.
 */
export function cssImageUrlSchema(max = 2048) {
  return z
    .string()
    .max(max)
    .refine(
      (v) => v === '' || /^https:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&*+,;=%]+$/.test(v),
      'Enter a full https:// image address'
    )
}
