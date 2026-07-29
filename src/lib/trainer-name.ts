// What a CLIENT should be told the business is called.
//
// A trainer has two names: the business (`TrainerProfile.businessName`) and the
// person who owns the login (`User.name`). Clients deal with the business — the
// same reason `publicEmail` exists alongside the private login email, and
// `showPhoneToClients` gates the phone.
//
// Most client-facing paths already reached for businessName. A handful had the
// fallback the other way round, so a solo trainer's client mail went out signed
// with her personal name — "Alison Brock via PupManager" over a booking for
// Mersea Mutts — and the body read "Alison Brock added your dog to…". Same data,
// two different answers depending on which route sent it. Hence one function.
//
// No imports on purpose: the email renderers, the notification vars and the
// sender header all need it, and it must not drag Prisma into a renderer.

/** Shape this accepts — anything with the two names on it. */
export interface TrainerNameSource {
  businessName?: string | null
  user?: { name?: string | null } | null
}

/**
 * The business name, falling back to the owner's own name only when there isn't
 * one (OAuth and Apple signups can leave businessName empty until the
 * profile-completion gate is passed).
 */
export function clientFacingTrainerName(
  trainer: TrainerNameSource | null | undefined,
  fallback = 'Your trainer',
): string {
  return trainer?.businessName?.trim() || trainer?.user?.name?.trim() || fallback
}
