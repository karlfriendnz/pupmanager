-- Per-button style overrides for the Instagram "link in bio" page. Additive:
-- a JSON map keyed by button key ('book' | 'website' | 'contact' | 'custom:<id>')
-- → { imageUrl?, bgColor?, textColor?, font? }. NULL = no overrides (inherit page).
ALTER TABLE "link_pages" ADD COLUMN "buttonStyles" JSONB;
