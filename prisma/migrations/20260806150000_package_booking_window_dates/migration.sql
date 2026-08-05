-- "Exact date and time" — a one-off start on a real calendar date.
--
-- The editor collapses to ONE list of "when" rows, whose first dropdown picks
-- the row's kind: a weekday (repeats weekly, shown as From/To) or "Exact date
-- and time" (a date picker + one start). Two concepts, one editing surface.
--
-- ─── Why weekday exact times go away ────────────────────────────────────────
-- They were `{day, time}` — a RECURRING exact start. A weekday range one
-- session long says exactly the same thing ("Tue 09:00–10:00" offers only
-- 09:00 for a 60-minute session), so keeping both would be two ways to say one
-- thing and a third row kind in the editor for no gain.
--
-- So they are CONVERTED, not dropped: each becomes a weekday range running
-- from its time for the offering's own durationMins. Behaviour-preserving at
-- today's duration. (lib/package-booking-window.ts does the identical fold at
-- READ time, so a row this deploy hasn't reached still behaves — production is
-- behind on migrations.)
--
-- House rules: @@map'd snake_case table name ("packages", never "Package"),
-- everything replay-safe.

-- ─── AlterTable ─────────────────────────────────────────────────────────────
-- [{"date":"2026-09-03","time":"10:00"}]
ALTER TABLE "packages"
  ADD COLUMN IF NOT EXISTS "bookingWindowDates" JSONB NOT NULL DEFAULT '[]';

-- ─── Convert weekday exact times into one-session-long weekday ranges ───────
-- Minute arithmetic rather than timestamp arithmetic so a late start cannot
-- wrap past midnight and produce an end BEFORE its start (which the reader
-- would then discard). 23:59 is the clamp.
UPDATE "packages" p
SET "bookingWindowRanges" = COALESCE(p."bookingWindowRanges", '[]'::jsonb) || sub.ranges
FROM (
  SELECT
    q.id,
    jsonb_agg(
      jsonb_build_object(
        'day', (t->>'day')::int,
        'start', t->>'time',
        'end', lpad((LEAST(
                 (split_part(t->>'time', ':', 1))::int * 60
                 + (split_part(t->>'time', ':', 2))::int
                 + q."durationMins", 1439) / 60)::text, 2, '0')
               || ':' ||
               lpad((LEAST(
                 (split_part(t->>'time', ':', 1))::int * 60
                 + (split_part(t->>'time', ':', 2))::int
                 + q."durationMins", 1439) % 60)::text, 2, '0')
      )
      ORDER BY (t->>'day')::int, t->>'time'
    ) AS ranges
  FROM "packages" q
  CROSS JOIN LATERAL jsonb_array_elements(q."bookingWindowTimes") AS t
  WHERE jsonb_typeof(q."bookingWindowTimes") = 'array'
    AND q."bookingWindowTimes" <> '[]'::jsonb
    AND t ? 'day' AND t ? 'time'
  GROUP BY q.id
) AS sub
WHERE p.id = sub.id;

-- Emptied once converted, which is also what makes this replay-safe: a second
-- run finds nothing left to convert.
UPDATE "packages"
SET "bookingWindowTimes" = '[]'::jsonb
WHERE jsonb_typeof("bookingWindowTimes") = 'array'
  AND "bookingWindowTimes" <> '[]'::jsonb;
