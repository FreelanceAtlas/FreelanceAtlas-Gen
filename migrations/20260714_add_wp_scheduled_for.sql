-- WP-native future scheduling for the 2-3-posts-a-week publish cadence.
-- Stores the UTC time a post was scheduled to auto-publish on WordPress
-- (wp_status = 'scheduled'), purely for dashboard display; WordPress itself
-- performs the actual publish at that time. Distinct from scheduled_publish_at,
-- which drives this app's own cron-based status flip.
alter table public.articles
  add column if not exists wp_scheduled_for timestamptz;
