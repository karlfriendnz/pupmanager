// ISO 3166-1 alpha-2 country codes. Names are resolved at runtime via
// Intl.DisplayNames so we only maintain the code list (no hand-typed names to
// drift). Used by the trainer settings country selector + the mobile
// set-your-country prompt.
const CODES =
  'AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(
    ' ',
  )

const display =
  typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null

/** Human name for an ISO alpha-2 code, e.g. "NZ" → "New Zealand". */
export function countryName(code: string | null | undefined): string {
  if (!code) return ''
  try {
    return display?.of(code.toUpperCase()) ?? code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

export type Country = { code: string; name: string }

/** All countries, sorted by display name — for the settings/prompt dropdowns. */
export const COUNTRIES: Country[] = CODES.map(code => ({ code, name: countryName(code) })).sort(
  (a, b) => a.name.localeCompare(b.name),
)

/** A valid 2-letter code we know about (upper-cased), or null. */
export function normalizeCountry(code: string | null | undefined): string | null {
  if (!code) return null
  const up = code.toUpperCase()
  return CODES.includes(up) ? up : null
}
