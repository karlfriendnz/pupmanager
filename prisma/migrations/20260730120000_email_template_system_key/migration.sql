-- Let an email_templates row override one of the platform's own emails.
--
-- The table has always held reusable templates a trainer picks from when
-- writing to a client by hand. systemKey marks a row as the trainer's version
-- of a SYSTEM email instead (the invite, the welcome, the invoice...), so
-- Settings → Email templates can list all of them in one place and each sender
-- resolves "saved override → built-in default".
--
-- Nullable, so every existing row keeps its meaning untouched.

ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "systemKey" TEXT;

-- One override per email per trainer. Postgres treats NULLs as distinct, so
-- this constrains the system rows without limiting the free-form ones.
CREATE UNIQUE INDEX IF NOT EXISTS "email_templates_trainerId_systemKey_key"
  ON "email_templates"("trainerId", "systemKey");
