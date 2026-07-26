-- In-app is now a STAFF-only channel: a client's feed shouldn't fill up with a
-- duplicate of every push/email reminder. Drop IN_APP from any client-facing
-- step, and keep the step sending by falling back to PUSH if that emptied it.
UPDATE "comms_flow_steps"
SET "channels" = array_remove("channels", 'IN_APP'::"NotificationChannel")
WHERE "audience" <> 'STAFF' AND 'IN_APP' = ANY ("channels");

UPDATE "comms_flow_steps"
SET "channels" = ARRAY['PUSH']::"NotificationChannel"[]
WHERE "audience" <> 'STAFF' AND cardinality("channels") = 0;
