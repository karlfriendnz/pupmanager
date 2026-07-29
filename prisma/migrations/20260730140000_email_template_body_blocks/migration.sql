-- Keep the block structure a trainer edited, alongside the HTML that sends.
--
-- The email body builder (text + image blocks, shared with the marketing
-- composer and admin announcements) serialises one way: blocks -> HTML. That
-- is fine for something you write once and send, but a system email is edited
-- again next month, and nothing can turn arbitrary HTML back into blocks
-- without losing something.
--
-- So both are stored: bodyBlocks is what the editor loads, body stays the HTML
-- every sender already reads. Nullable — a row without it simply opens as a
-- single text block.

ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "bodyBlocks" JSONB;
