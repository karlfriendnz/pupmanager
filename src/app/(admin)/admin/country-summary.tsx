import { countryName, flagEmoji } from '@/lib/countries'

export interface CountryCount {
  /** ISO alpha-2, or null for an account that never recorded one. */
  code: string | null
  count: number
}

/**
 * Split the groups into the ones we can name and the ones we can't, biggest
 * first.
 *
 * Biggest first because the point of the panel is "where are they", and
 * alphabetical buries a country with thirty accounts under one with a single
 * trialist. Ties break on country NAME (not code) so the order matches how the
 * chips read, and is stable between renders.
 *
 * Exported so the ordering can be tested without rendering.
 */
export function orderCountryCounts(rows: CountryCount[]): {
  known: CountryCount[]
  unknown: CountryCount | undefined
  total: number
} {
  const known = rows
    .filter(r => r.code)
    .sort((a, b) => b.count - a.count || countryName(a.code).localeCompare(countryName(b.code), 'en'))
  return {
    known,
    unknown: rows.find(r => !r.code),
    total: rows.reduce((n, r) => n + r.count, 0),
  }
}

/**
 * Where the businesses in the current tab are, as a headline count plus the
 * spread behind it.
 *
 * Scoped to the TAB, not the platform: it sits above a table you can sort by
 * country, and a number that didn't match the rows underneath would be worse
 * than no number. The tab's own name is in the heading so the scope is stated
 * rather than assumed.
 */
export function CountrySummary({
  rows,
  tabLabel,
}: {
  rows: CountryCount[]
  tabLabel: string
}) {
  const { known: sorted, unknown, total } = orderCountryCounts(rows)
  // An empty tab says nothing rather than "0 countries".
  if (total === 0) return null
  const top = sorted[0]

  return (
    <div className="mb-6 rounded-2xl border border-slate-700 bg-slate-800 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-3">
        <h2 className="text-sm font-semibold text-white">
          Countries
          <span className="ml-2 text-[11px] font-normal text-slate-400">{tabLabel}</span>
        </h2>
        <span className="text-xs tabular-nums text-slate-400">
          {sorted.length} {sorted.length === 1 ? 'country' : 'countries'}
          {top && (
            <>
              {' · '}
              <span className="text-slate-300">
                {countryName(top.code)} biggest at {top.count}
              </span>
            </>
          )}
          {unknown && <> · {unknown.count} unknown</>}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {sorted.map(r => {
          const flag = flagEmoji(r.code)
          const share = Math.round((r.count / total) * 100)
          return (
            <span
              key={r.code}
              title={`${countryName(r.code)} — ${r.count} of ${total} (${share}%)`}
              className="inline-flex items-baseline gap-1.5 rounded-lg border border-slate-700 bg-slate-900/40 px-2.5 py-1.5 text-sm text-slate-300"
            >
              {flag && <span aria-hidden className="text-base leading-none">{flag}</span>}
              <span className="font-medium">{r.code}</span>
              <span className="tabular-nums text-slate-400">{r.count}</span>
            </span>
          )
        })}
        {/* Signup country comes from the signup form, falling back to the IP geo
            header — an account created before that existed has neither, and
            hiding those would make the chips fail to add up to the tab count. */}
        {unknown && (
          <span
            title={`${unknown.count} of ${total} never recorded a country`}
            className="inline-flex items-baseline gap-1.5 rounded-lg border border-dashed border-slate-700 px-2.5 py-1.5 text-sm text-slate-500"
          >
            <span className="font-medium">Unknown</span>
            <span className="tabular-nums">{unknown.count}</span>
          </span>
        )}
      </div>
    </div>
  )
}
