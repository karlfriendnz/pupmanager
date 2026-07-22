// Internal sales judgement of how likely a trialing trainer is to convert.
// Set by hand from the "Likely" column on /admin/trainers — never derived from
// behaviour, and never shown to the trainer themselves.

export const LIKELIHOODS = ['NAH', 'MAYBE', 'YEAH', 'DEFINITELY'] as const

export type ConversionLikelihood = (typeof LIKELIHOODS)[number]

export function isConversionLikelihood(v: string): v is ConversionLikelihood {
  return (LIKELIHOODS as readonly string[]).includes(v)
}

// Label + chip colours, ordered coldest → warmest so the column scans as a
// temperature at a glance on the dark admin table.
export const LIKELIHOOD_META: Record<ConversionLikelihood, { label: string; cls: string }> = {
  NAH:        { label: 'Nah',        cls: 'bg-slate-700 text-slate-300' },
  MAYBE:      { label: 'Maybe',      cls: 'bg-amber-900 text-amber-300' },
  YEAH:       { label: 'Yeah',       cls: 'bg-blue-900 text-blue-300' },
  DEFINITELY: { label: 'Definitely', cls: 'bg-green-900 text-green-300' },
}

/** Chip label for a stored value, or a dash placeholder when unset. */
export function likelihoodLabel(v: string | null): string {
  return v && isConversionLikelihood(v) ? LIKELIHOOD_META[v].label : '—'
}
