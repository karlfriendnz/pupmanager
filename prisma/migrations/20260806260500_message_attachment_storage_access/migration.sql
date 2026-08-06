-- Which access mode a chat photo's blob was written with.
--
-- A Vercel Blob store is public OR private for its whole life. This app's store
-- is public, so `put(..., { access: 'private' })` is refused outright:
--
--   "Vercel Blob: Cannot use private access on a public store."
--
-- The upload route therefore ASKS for private and accepts public when the store
-- cannot do better. `get()` has to be told which one a given object used, and
-- rows written before a store is ever switched must keep resolving — so it is a
-- per-row column, not a constant.
--
-- Defaulted to 'public', which is what every row written today actually is.
-- Additive; no existing row changes meaning.
--
-- Replay-safe: run it twice and the second run is a no-op.

ALTER TABLE "message_attachments"
  ADD COLUMN IF NOT EXISTS "storageAccess" TEXT NOT NULL DEFAULT 'public';
