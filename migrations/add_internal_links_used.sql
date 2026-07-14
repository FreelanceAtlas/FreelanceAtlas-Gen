-- APPLIED to production 2026-07-14 via Supabase Management API.
--
-- Auto internal linking: /api/generate now links the first mention of any
-- primary/supporting keyword that another live blog already covers, and records
-- what it linked here (same pattern as affiliate_links_used).

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS internal_links_used jsonb NOT NULL DEFAULT '[]'::jsonb;
