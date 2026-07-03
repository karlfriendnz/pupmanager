// Lightweight, dependency-free phone "mask" for the signup field. PupManager is
// NZ-based but takes signups globally, so we can't impose a strict single-country
// format. Behaviour:
//   • Leading "+"  → treat as international; keep the "+", group the digits in
//                    blocks of 3 for readability (permissive, no country rules).
//   • Otherwise    → NZ-style grouping (0XX XXX XXXX), which covers the common
//                    mobile case cleanly and degrades gracefully for others.
// This only formats for display — it never rejects input, so an unusual number
// still types through. Max 15 digits (E.164 ceiling).

export function formatPhoneInput(raw: string): string {
  const isIntl = raw.trimStart().startsWith('+')
  const digits = raw.replace(/\D/g, '').slice(0, 15)
  if (digits.length === 0) return isIntl ? '+' : ''

  if (isIntl) {
    const groups: string[] = []
    for (let i = 0; i < digits.length; i += 3) groups.push(digits.slice(i, i + 3))
    return `+${groups.join(' ')}`
  }

  // NZ-style: 0XX XXX XXXX (mobiles), tolerant of shorter/longer inputs.
  const d = digits.slice(0, 11)
  const parts: string[] = []
  parts.push(d.slice(0, 3))
  if (d.length > 3) parts.push(d.slice(3, 6))
  if (d.length > 6) parts.push(d.slice(6, 10))
  if (d.length > 10) parts.push(d.slice(10))
  return parts.filter(Boolean).join(' ')
}
