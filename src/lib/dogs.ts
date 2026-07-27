// A dog reaches a client down TWO relations, and the same dog can travel both.
//
//   ClientProfile.dogId  ->  Dog        (`client.dog`  — the primary dog)
//   Dog.clientProfileId  ->  ClientProfile (`client.dogs` — the household list)
//
// Nothing stops a dog from being a client's primary AND sitting in their
// additional-dogs list; both rows are legitimate and pointing at ONE Dog row.
// So every screen that wrote `[...(client.dog ? [client.dog] : []), ...client.dogs]`
// drew that dog twice — which is why deleting "one of the copies" removed both.
// Mersea Mutts had 40 dogs in this state.
//
// This is a DISPLAY concern, not bad data. Fix it here, once, rather than in a
// `.filter` per call site — eight ad-hoc dedupes is how the bug came back.

/** The minimum a dog must carry for us to tell two of them apart. */
type Identified = { id: string }

/**
 * Every dog belonging to a client, primary first, each appearing ONCE.
 *
 * Pass the profile's `dog` relation and its `dogs` relation exactly as Prisma
 * returned them. Order is stable: the primary leads (callers such as the client
 * home hero take `[0]` as "the" dog), then the additional dogs in query order.
 */
export function mergeClientDogs<T extends Identified>(
  primary: T | null | undefined,
  additional: readonly T[] | null | undefined,
): T[] {
  const out: T[] = []
  const seen = new Set<string>()
  for (const dog of [...(primary ? [primary] : []), ...(additional ?? [])]) {
    if (seen.has(dog.id)) continue
    seen.add(dog.id)
    out.push(dog)
  }
  return out
}

/**
 * The same list, each dog tagged with whether it is the client's primary.
 *
 * A dog that is on both relations is primary — that's the stronger claim, and
 * it's the one the edit form and the dogs API need so the "primary" radio lands
 * on the right row.
 */
export function mergeClientDogsFlagged<T extends Identified>(
  primary: T | null | undefined,
  additional: readonly T[] | null | undefined,
): (T & { isPrimary: boolean })[] {
  const primaryId = primary?.id ?? null
  return mergeClientDogs(primary, additional).map(dog => ({
    ...dog,
    isPrimary: dog.id === primaryId,
  }))
}

/**
 * The dogs BESIDES the primary — what a "+2" badge or an "Extra dogs" column
 * means. A one-dog household that also has that dog on the household list must
 * read as no extras, not "+1 Bailey" beside "Bailey".
 *
 * Takes the primary's id (not the object) because list queries usually have
 * `clientProfile.dogId` in hand without joining the dog itself.
 */
export function extraClientDogs<T extends Identified>(
  primaryDogId: string | null | undefined,
  additional: readonly T[] | null | undefined,
): T[] {
  const out: T[] = []
  const seen = new Set<string>(primaryDogId ? [primaryDogId] : [])
  for (const dog of additional ?? []) {
    if (seen.has(dog.id)) continue
    seen.add(dog.id)
    out.push(dog)
  }
  return out
}

/** How many distinct dogs a client has. Counts a both-relations dog once. */
export function clientDogCount(
  primaryDogId: string | null | undefined,
  additional: readonly Identified[] | null | undefined,
): number {
  return (primaryDogId ? 1 : 0) + extraClientDogs(primaryDogId, additional).length
}
