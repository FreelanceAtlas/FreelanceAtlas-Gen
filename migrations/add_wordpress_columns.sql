-- Adds WordPress publishing state to the articles table.
-- Run once in the Supabase SQL editor (or psql) before using the
-- "Send to WordPress" / "Pushed to site as draft" / "Publish live" features.

alter table public.articles
  add column if not exists wp_post_id   bigint,
  add column if not exists wp_edit_link text,
  add column if not exists wp_status    text;  -- 'draft' | 'published'

-- Quick lookup of what's been pushed to the site.
create index if not exists articles_wp_status_idx on public.articles (wp_status);
