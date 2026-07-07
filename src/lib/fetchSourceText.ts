// Server-side source fetcher for the redo/fact-check path.
//
// Anthropic's web_fetch tool reliably fails to extract prices from JS-rendered
// vendor pricing pages (Trello/ClickUp/Asana), which left the fact-check unable to
// verify any figure and capped the score. A plain server-side GET with a browser
// User-Agent, however, returns the real price tables in the static HTML. This
// fetches each source, strips it to text, and returns a { url: text } map that
// both the rewriter and factCheckArticle use as ground truth.

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const PER_SOURCE_CHAR_CAP = 12000;
const FETCH_TIMEOUT_MS = 20000;

function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchOne(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const text = htmlToText(html);
    if (!text) return null;
    return text.slice(0, PER_SOURCE_CHAR_CAP);
  } catch {
    return null;
  }
}

// Fetches all sources concurrently and returns a { url: text } map. URLs that
// fail (timeout, block, empty) are simply omitted, so the caller degrades to
// "unverifiable" for those rather than crashing.
export async function fetchSourcesText(
  sources: { url: string }[]
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(sources.map((s) => s?.url).filter((u): u is string => !!u)));
  const results = await Promise.all(
    unique.map(async (url) => [url, await fetchOne(url)] as const)
  );
  const map: Record<string, string> = {};
  for (const [url, text] of results) {
    if (text) map[url] = text;
  }
  return map;
}
