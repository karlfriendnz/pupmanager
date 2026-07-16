-- Unify every "link in bio" button into a single per-row smart-link model.
-- Each LinkPageButton now carries a `type` (CUSTOM | BOOKING | LEADMAGNET | FORM
-- | SIGNIN | WEBSITE | EMAIL | CALL), an optional type-specific `targetId`, and
-- its own per-button style (imageUrl / bgColor / textColor). `url` becomes
-- nullable — only CUSTOM buttons store a raw URL. Additive + non-destructive:
-- the now-unused LinkPage columns (showBooking/showWebsite/showContact/itemOrder/
-- buttonStyles) are left in place and simply stop being read or written.
ALTER TABLE "link_page_buttons" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'CUSTOM';
ALTER TABLE "link_page_buttons" ADD COLUMN "targetId" TEXT;
ALTER TABLE "link_page_buttons" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "link_page_buttons" ADD COLUMN "bgColor" TEXT;
ALTER TABLE "link_page_buttons" ADD COLUMN "textColor" TEXT;
ALTER TABLE "link_page_buttons" ALTER COLUMN "url" DROP NOT NULL;
