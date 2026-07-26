import { permanentRedirect } from 'next/navigation'

// The Library moved to /library.
//
// /templates used to host TWO unrelated features: the Library (its index) and
// the training-template screens that still live in this folder
// (/templates/[templateId], /templates/new). Only the Library moved; this stub
// keeps every bookmark, in-app link and deep link that pointed at the old
// index working, rather than 404ing on a segment that no longer has a page.
export default function TemplatesIndexRedirect(): never {
  permanentRedirect('/library')
}
