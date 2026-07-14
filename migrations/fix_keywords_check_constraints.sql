-- APPLIED to production 2026-07-14 via Supabase Management API.
--
-- Fix: new row for relation "keywords" violates check constraint "keywords_est_difficulty_check"
--
-- The seeded schema didn't match what the app writes:
--   * keywords_est_difficulty_check allowed 'low'|'medium'|'high', but
--     save/route.ts and research/route.ts write 'Easy'|'Medium'|'Hard'.
--   * keywords_keyword_key made keyword globally unique, contradicting the
--     per-cluster model (onConflict: "cluster_id,keyword") — the same keyword
--     could never be saved into two clusters.

BEGIN;

ALTER TABLE keywords DROP CONSTRAINT keywords_est_difficulty_check;

UPDATE keywords SET est_difficulty = CASE lower(est_difficulty)
    WHEN 'low' THEN 'Easy'    WHEN 'easy' THEN 'Easy'
    WHEN 'medium' THEN 'Medium' WHEN 'med' THEN 'Medium'
    WHEN 'high' THEN 'Hard'   WHEN 'hard' THEN 'Hard'
    ELSE est_difficulty END
  WHERE est_difficulty IS NOT NULL;

ALTER TABLE keywords ADD CONSTRAINT keywords_est_difficulty_check
  CHECK (est_difficulty IS NULL OR est_difficulty IN ('Easy', 'Medium', 'Hard'));

ALTER TABLE keywords DROP CONSTRAINT keywords_keyword_key;

COMMIT;
