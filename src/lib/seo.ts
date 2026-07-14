// Shared SEO helpers: slugs, similarity scoring for de-dup, and keyword highlighting.

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Token-overlap similarity (Jaccard on significant words) — fast, dependency-free
// de-dup check. Anything >= 0.55 against an existing title/slug is flagged.
const STOPWORDS = new Set([
  "a","an","the","to","for","of","in","on","with","and","or","is","are",
  "how","what","why","your","you","2026","2025","guide","real","really",
]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const w of ta) if (tb.has(w)) intersection++;
  const union = new Set([...ta, ...tb]).size;
  return intersection / union;
}

export interface DuplicateMatch {
  slug: string;
  title: string;
  score: number;
}

export function findDuplicates(
  candidateTitle: string,
  existing: { slug: string; title: string }[],
  threshold = 0.55
): DuplicateMatch[] {
  return existing
    .map((e) => ({ slug: e.slug, title: e.title, score: similarity(candidateTitle, e.title) }))
    .filter((m) => m.score >= threshold)
    .sort((a, b) => b.score - a.score);
}

// Wraps every occurrence of each tracked keyword's ACTUAL surface form (`usedAs`
// — which differs from the canonical/original keyword whenever the writer merged
// or synonym-swapped it) in a styled blue <span>, immediately followed by a
// numbered marker, e.g. "time tracking tools<sup>[3]</sup>". The marker number is
// always rendered (not just on a swap) so every highlighted term has a stable,
// visible pointer to its row in the keyword reference table below. Longest match
// first so multi-word keywords aren't partially shadowed by shorter ones.
export interface MarkerEntry {
  marker: number;
  usedAs: string;
}

export function highlightKeywords(html: string, entries: MarkerEntry[]): string {
  const sorted = [...entries]
    .filter((e) => e.usedAs)
    .sort((a, b) => b.usedAs.length - a.usedAs.length);
  let result = html;
  for (const { marker, usedAs } of sorted) {
    const escaped = usedAs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?![^<]*>)(${escaped})`, "gi");
    result = result.replace(
      re,
      `<span class="text-blue-600 font-semibold" data-keyword-marker="${marker}">$1<sup class="ml-0.5 text-[0.65em] font-bold text-atlasteal">[${marker}]</sup></span>`
    );
  }
  return result;
}

export interface KeywordTableRow {
  marker: number;
  keyword: string;       // original/canonical keyword as researched
  usedAs: string;        // exact form actually written into the article
  merged: boolean;       // true whenever usedAs !== keyword (synonym swap or merge)
  cluster: string | null;
  searchIntent: string | null;
  source: string | null;
  occurrences: number;
}

export interface KeywordUsageInput {
  original: string;
  used_as: string;
}

export function buildKeywordTable(
  contentMd: string,
  usage: KeywordUsageInput[],
  keywordRecords: { keyword: string; cluster?: string | null; search_intent?: string | null; research_source?: string | null }[]
): KeywordTableRow[] {
  const lower = contentMd.toLowerCase();
  return usage
    .map((u, i) => {
      const surfaceForm = u.used_as || u.original;
      const escaped = surfaceForm.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matches = lower.match(new RegExp(escaped, "g"));
      const match = keywordRecords.find((k) => k.keyword.toLowerCase() === u.original.toLowerCase());
      return {
        marker: i + 1,
        keyword: u.original,
        usedAs: surfaceForm,
        merged: surfaceForm.toLowerCase() !== u.original.toLowerCase(),
        cluster: match?.cluster ?? null,
        searchIntent: match?.search_intent ?? null,
        source: match?.research_source ?? null,
        occurrences: matches ? matches.length : 0,
      };
    })
    .filter((row) => row.occurrences > 0);
}

// Auto-picks supporting keywords from the cluster bank when the editor didn't
// choose any: unused keywords that share at least one significant token with the
// primary topic, capped so the writer prompt doesn't get flooded.
export function pickSupportingKeywords(
  primaryKeyword: string,
  bank: { keyword: string; is_used?: boolean | null }[],
  max = 10
): string[] {
  const topicTokens = tokens(primaryKeyword);
  if (topicTokens.size === 0) return [];
  const primaryLower = primaryKeyword.toLowerCase();
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const row of bank) {
    if (row.is_used) continue;
    const kw = row.keyword.trim();
    const lower = kw.toLowerCase();
    if (!kw || lower === primaryLower || seen.has(lower)) continue;
    let overlaps = false;
    for (const t of tokens(kw)) if (topicTokens.has(t)) { overlaps = true; break; }
    if (!overlaps) continue;
    seen.add(lower);
    picked.push(kw);
    if (picked.length >= max) break;
  }
  return picked;
}

export interface InternalLinkCandidate {
  url: string;
  title: string;
  slug: string;
  terms: string[]; // this article's keyword surface forms to look for in new content
}

export interface InternalLinkApplication {
  title: string;
  url: string;
  matchedTerm: string;
}

// True when every significant token of the keyword appears in the title — a strong
// signal the post is actually about that keyword, not just sharing a word with it.
function titleCoversKeyword(title: string, keyword: string): boolean {
  const kwTokens = tokens(keyword);
  if (kwTokens.size === 0) return false;
  const titleTokens = tokens(title);
  for (const t of kwTokens) if (!titleTokens.has(t)) return false;
  return true;
}

// Maps each of the new article's keywords (primary + supporting, in their actual
// written surface forms) to another live blog post that covers that keyword —
// either a generated article whose keyword_table contains it, or a scraped
// existing_content post whose title covers it. Generated-article matches win
// because their keyword coverage is exact, not inferred from the title.
export function buildInternalLinkCandidates(
  articleTerms: { keyword: string; surface: string }[],
  liveArticles: { slug: string; title: string; keyword_table?: { keyword?: string; usedAs?: string }[] | null }[],
  existingContent: { slug: string; title: string; source_url?: string | null }[],
  excludeSlug: string,
  siteBase = "https://freelanceatlas.com"
): InternalLinkCandidate[] {
  const bySlug = new Map<string, InternalLinkCandidate>();

  for (const { keyword, surface } of articleTerms) {
    const kwLower = keyword.toLowerCase();

    let target: { slug: string; title: string; url: string } | null = null;
    for (const a of liveArticles) {
      if (a.slug === excludeSlug) continue;
      const rows = a.keyword_table ?? [];
      const covers =
        rows.some(
          (r) =>
            r.keyword?.toLowerCase() === kwLower ||
            r.usedAs?.toLowerCase() === kwLower
        ) || titleCoversKeyword(a.title, keyword);
      if (covers) {
        target = { slug: a.slug, title: a.title, url: `${siteBase}/${a.slug}/` };
        break;
      }
    }
    if (!target) {
      for (const e of existingContent) {
        if (e.slug === excludeSlug) continue;
        if (titleCoversKeyword(e.title, keyword)) {
          target = { slug: e.slug, title: e.title, url: e.source_url || `${siteBase}/${e.slug}/` };
          break;
        }
      }
    }
    if (!target) continue;

    const existing = bySlug.get(target.slug);
    if (existing) {
      if (!existing.terms.some((t) => t.toLowerCase() === surface.toLowerCase())) existing.terms.push(surface);
    } else {
      bySlug.set(target.slug, { url: target.url, title: target.title, slug: target.slug, terms: [surface] });
    }
  }

  return Array.from(bySlug.values());
}

// Links the FIRST mention of each candidate's matched keyword to the blog post
// that covers it. Same safety rules as applyAffiliateLinks: never nests inside an
// existing markdown link, one link per target post, and skips heading lines so
// H2/H3s stay clean. Capped to avoid turning the piece into a link farm.
export function applyInternalLinks(
  contentMd: string,
  candidates: InternalLinkCandidate[],
  maxLinks = 5
): { content: string; used: InternalLinkApplication[] } {
  let content = contentMd;
  const used: InternalLinkApplication[] = [];

  for (const candidate of candidates) {
    if (used.length >= maxLinks) break;
    let linked = false;
    for (const term of candidate.terms) {
      if (linked) break;
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b(${escaped})\\b`, "gi");
      let match: RegExpExecArray | null;
      while ((match = re.exec(content)) !== null) {
        const idx = match.index;

        // Don't relink text already part of a markdown link: [text](url)
        const before = content.slice(Math.max(0, idx - 2), idx);
        if (before.includes("(") || before.includes("[")) continue;

        // Skip heading lines
        const lineStart = content.lastIndexOf("\n", idx) + 1;
        if (content.slice(lineStart, lineStart + 1) === "#") continue;

        content =
          content.slice(0, idx) +
          `[${match[0]}](${candidate.url})` +
          content.slice(idx + match[0].length);
        used.push({ title: candidate.title, url: candidate.url, matchedTerm: match[0] });
        linked = true;
        break;
      }
    }
  }

  return { content, used };
}

export interface AffiliateLink {
  id: string;
  label: string;
  url: string | null;
  trigger_keywords: string[];
}

export interface AffiliateApplication {
  label: string;
  url: string;
  matchedTerm: string;
}

// Scans generated markdown for affiliate-link opportunities and auto-links the
// FIRST mention of each active tool. Skips any link row with no url so a
// missing affiliate ID never produces a dead or fabricated link, and skips
// text that's already inside a markdown link so links never get nested.
export function applyAffiliateLinks(
  contentMd: string,
  links: AffiliateLink[]
): { content: string; used: AffiliateApplication[] } {
  let content = contentMd;
  const used: AffiliateApplication[] = [];

  for (const link of links) {
    if (!link.url) continue;
    for (const term of link.trigger_keywords) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b(${escaped})\\b`, "i");
      const match = content.match(re);
      if (!match) continue;

      // Don't relink text that's already part of a markdown link: [text](url)
      const idx = match.index!;
      const before = content.slice(Math.max(0, idx - 2), idx);
      if (before.includes("(") || before.includes("[")) continue;

      content =
        content.slice(0, idx) +
        `[${match[0]}](${link.url})` +
        content.slice(idx + match[0].length);

      used.push({ label: link.label, url: link.url, matchedTerm: match[0] });
      break; // one link per tool per article
    }
  }

  return { content, used };
}
