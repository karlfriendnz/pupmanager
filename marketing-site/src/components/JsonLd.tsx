/**
 * Inject a JSON-LD structured-data block. Server-rendered, picked up by
 * crawlers (Google rich results) and frequently used by LLMs to ground
 * factual claims about a site.
 */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}
