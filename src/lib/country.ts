// Country-name → ISO 3166-1 alpha-2 normalisation, shared by billing (Stripe
// customer address) and the address autocomplete (which localises Places results
// to the trainer's country via includedRegionCodes).
//
// `addressCountry` is stored as a human name ("New Zealand"); `signupCountry` is
// already an alpha-2 code from the signup IP geo. Both flow through here — the
// passthrough branch handles the already-coded case for every country, while the
// name map covers the handful we present as full names in the billing form.
export function countryToISO(name: string | null | undefined): string | undefined {
  if (!name) return undefined
  const v = name.trim().toLowerCase()
  const map: Record<string, string> = {
    'new zealand': 'NZ', 'nz': 'NZ', 'aotearoa': 'NZ',
    'australia': 'AU', 'au': 'AU',
    'united kingdom': 'GB', 'uk': 'GB', 'great britain': 'GB', 'england': 'GB', 'scotland': 'GB', 'wales': 'GB', 'gb': 'GB',
    'united states': 'US', 'us': 'US', 'usa': 'US', 'america': 'US',
    'canada': 'CA', 'ca': 'CA',
    'south africa': 'ZA', 'za': 'ZA',
    'ireland': 'IE', 'ie': 'IE',
  }
  if (map[v]) return map[v]
  // Already a 2-letter code? Pass through uppercased.
  if (/^[a-z]{2}$/.test(v)) return v.toUpperCase()
  return undefined
}

// The ISO alpha-2 country an address search should localise to for a trainer:
// their business address country, falling back to the country their account was
// created from. Undefined when neither is known — callers then let the browser
// locale decide.
export function trainerRegionCode(trainer: {
  addressCountry?: string | null
  signupCountry?: string | null
}): string | undefined {
  return countryToISO(trainer.addressCountry) ?? countryToISO(trainer.signupCountry)
}
