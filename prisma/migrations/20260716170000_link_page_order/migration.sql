-- Global button order across the built-ins (book/website/contact) AND custom
-- links. Additive: existing rows default to '{}' which renders exactly as today.
ALTER TABLE "link_pages" ADD COLUMN "itemOrder" TEXT[] NOT NULL DEFAULT '{}';
