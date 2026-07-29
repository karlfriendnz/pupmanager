// A dialable href for a phone number a human typed.
//
// Numbers arrive formatted for reading ("021 555 0100", "+64 21 555 0100",
// "(09) 555-0100"). A tel: URL wants the digits, and a leading + kept — that is
// what makes an international number dial from another country. Everything else
// (spaces, brackets, dashes) is decoration a dialler chokes on.

/** `tel:` href for a typed number, or null when there is nothing to dial. */
export function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null
  // Keep a + only in the leading position: "+64…" is a country code, a + in the
  // middle is a typo and would make the whole href invalid.
  const cleaned = phone.trim().replace(/[^\d+]/g, '')
  const digits = cleaned.replace(/\+/g, '')
  if (!digits) return null
  return `tel:${cleaned.startsWith('+') ? '+' : ''}${digits}`
}
