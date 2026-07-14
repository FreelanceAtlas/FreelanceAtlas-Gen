-- APPLIED to production 2026-07-14 (run by Moazzan in the Supabase SQL editor).
--
-- Fix: "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- /api/keywords/save, /api/keywords/research and /api/suggest-topic all upsert into
-- `keywords` with onConflict: "cluster_id,keyword", but the table was created without
-- a unique constraint on that pair, so Postgres rejects every upsert (error 42P10).
--
-- Run in the Supabase SQL editor (project skjhgsazwnoaiwgcmkfl).

-- 1. Remove any duplicate (cluster_id, keyword) rows that accumulated while the
--    constraint was missing. Keeps the row that is marked used, then the most
--    recently refreshed one.
DELETE FROM keywords k
USING (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY cluster_id, keyword
           ORDER BY is_used DESC, dfs_updated_at DESC NULLS LAST, id
         ) AS rn
  FROM keywords
) d
WHERE k.id = d.id
  AND d.rn > 1;

-- 2. Add the constraint the upserts expect.
ALTER TABLE keywords
  ADD CONSTRAINT keywords_cluster_id_keyword_key UNIQUE (cluster_id, keyword);
