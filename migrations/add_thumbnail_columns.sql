-- Adds featured-image thumbnail state to the articles table.
-- Run once in the Supabase SQL editor before using the "Generate image" /
-- "Redo with notes" thumbnail features on ready-to-publish articles.

alter table public.articles
  add column if not exists thumbnail_media_id bigint,  -- WP media id (used as featured_media)
  add column if not exists thumbnail_url      text,    -- WP media source URL (for preview)
  add column if not exists thumbnail_scene    text;    -- JSON scene from Stage 1 (for redo context)
