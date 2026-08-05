-- Per-day booking ranges, and the two window modes merged into one.
--
-- Before: ONE bookingWindowStart/bookingWindowEnd applied to every day in
-- bookingWindowDays — so "Tue and Thu, 9–1" was sayable and "Monday 3–5 and
-- Wednesday 1–7" was not. Each day now carries its own band, and a day may
-- carry SEVERAL (a morning block and an afternoon block).
--
-- Before: WEEKLY_WINDOW and EXACT_TIMES were alternatives. They are now the two
-- halves of RESTRICTED, unioned, so an offering can run Mon 3–5 AND at Saturday
-- 10:00 sharp.
--
-- ─── Migration of intent: none ──────────────────────────────────────────────
-- ANY_TIME rows stay ANY_TIME and keep behaving exactly as they do. A legacy
-- WEEKLY_WINDOW row becomes the EQUIVALENT set of per-day ranges — same days,
-- same hours, same bookable slots. A legacy EXACT_TIMES row already stored its
-- times in the column that survives, so it only changes mode.
--
-- The legacy columns are deliberately NOT dropped. Dropping is not additive,
-- production is behind on migrations, and lib/package-booking-window.ts folds
-- them in at READ time as well — so a row this deploy hasn't reached still
-- resolves to the right window.
--
-- House rules: @@map'd snake_case table name ("packages", never "Package" — a
-- model name fails `migrate deploy` with 42P01 in production, during the
-- build), and everything replay-safe.

-- ─── AlterTable ─────────────────────────────────────────────────────────────
-- [{"day":1,"start":"15:00","end":"17:00"}], ISO weekday + 24h wall clock.
ALTER TABLE "packages"
  ADD COLUMN IF NOT EXISTS "bookingWindowRanges" JSONB NOT NULL DEFAULT '[]';

-- ─── Backfill: one band × N days → N per-day bands ──────────────────────────
-- Guarded on the ranges column still being empty, so a re-run cannot double up.
UPDATE "packages" p
SET "bookingWindowRanges" = sub.ranges
FROM (
  SELECT
    q.id,
    jsonb_agg(
      jsonb_build_object('day', d.value, 'start', q."bookingWindowStart", 'end', q."bookingWindowEnd")
      ORDER BY (d.value)::int
    ) AS ranges
  FROM "packages" q
  CROSS JOIN LATERAL jsonb_array_elements(q."bookingWindowDays") AS d(value)
  WHERE q."bookingWindowMode" = 'WEEKLY_WINDOW'
    AND q."bookingWindowStart" IS NOT NULL
    AND q."bookingWindowEnd" IS NOT NULL
    AND jsonb_typeof(q."bookingWindowDays") = 'array'
    AND q."bookingWindowRanges" = '[]'::jsonb
  GROUP BY q.id
) AS sub
WHERE p.id = sub.id;

-- ─── Both legacy modes become RESTRICTED ────────────────────────────────────
-- Only where the row actually carries a window; a WEEKLY_WINDOW row that lost
-- its hours has nothing to restrict BY, and "restricted to nothing" would take
-- a working offering off sale. Those fall back to ANY_TIME, which is what the
-- reader already did with them.
UPDATE "packages"
SET "bookingWindowMode" = 'RESTRICTED'
WHERE "bookingWindowMode" IN ('WEEKLY_WINDOW', 'EXACT_TIMES')
  AND ("bookingWindowRanges" <> '[]'::jsonb OR "bookingWindowTimes" <> '[]'::jsonb);

UPDATE "packages"
SET "bookingWindowMode" = 'ANY_TIME'
WHERE "bookingWindowMode" IN ('WEEKLY_WINDOW', 'EXACT_TIMES');

-- ─── Retire the legacy columns' CONTENT, not the columns ────────────────────
-- Their meaning has moved into bookingWindowRanges. Clearing them stops a later
-- read folding the same band in twice.
UPDATE "packages"
SET "bookingWindowDays" = '[]'::jsonb,
    "bookingWindowStart" = NULL,
    "bookingWindowEnd" = NULL
WHERE "bookingWindowDays" <> '[]'::jsonb
   OR "bookingWindowStart" IS NOT NULL
   OR "bookingWindowEnd" IS NOT NULL;
