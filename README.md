# FreelanceAtlas Gen

Internal, login-gated SEO blog generator for the FreelanceAtlas content team.

## What it does
1. **Login** (Supabase Auth, email/password) — only signed-in team members reach `/dashboard`.
2. **Clusters & keyword bank** (`/dashboard/clusters`) — the pillar-cluster topic map derived from
   auditing freelanceatlas.com's live blog (8 clusters, 46 existing posts catalogued) plus a gap
   keyword bank sourced from Wordstream, SEMrush Keyword Magic, Wordtracker, Ahrefs Keyword
   Generator, and Seobility.
3. **Generate** (`/dashboard/generate`) — pick a cluster, a primary keyword, supporting keywords,
   and paste in recent/credible source links. The system:
   - Checks the new topic against `existing_content` (scraped site) and `articles` (prior drafts)
     using token-overlap similarity, and blocks generation (with the matches shown) if it looks like
     a duplicate, unless you confirm "generate anyway."
   - Calls an LLM with a system prompt locked to FreelanceAtlas's voice and on-page SEO rules
     (keyword-in-H1/meta, H2/H3 hierarchy, FAQ block, natural keyword density, inline source
     citations, no fabricated stats).
   - Stores the result as a publish-ready draft: meta title/description, H1, body, FAQs, a
     keyword-to-source reference table, and the source list.
4. **Article view** (`/dashboard/articles/[slug]`) — every keyword actually used in the piece is
   rendered in blue inline, with a keyword reference table underneath mapping each one to its
   cluster, search intent, and research source.

## Setup
1. Supabase project is already provisioned (`FreelanceAtlas's Project`, RLS enabled on every
   table — see `supabase` migrations applied via MCP). Copy `.env.example` to `.env.local`.
2. Add `ANTHROPIC_API_KEY` (Vercel → Project → Settings → Environment Variables) to enable the
   generation engine. Without it, login/dashboard/clusters work but `/api/generate` will return a
   clear setup error instead of generating.
3. In Supabase Auth settings, disable "Confirm email" for faster internal onboarding, or enable it
   if you want an email-verification step before first login.
4. `npm install && npm run dev` locally, or deploy as-is to Vercel (this repo is already wired to
   the FreelanceAtlas Vercel team).

## Security
RLS is enabled on every table. All authenticated FreelanceAtlas team members can read/write
shared content tables (this is a single-tenant internal tool); only users with `profiles.role =
'admin'` can delete rows. No anonymous access anywhere.
