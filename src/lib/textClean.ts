// Shared text-sanitization helpers, applied at every point article text is
// written (generation, recheck/rewrite, manual edit, and again defensively at
// publish): no em dashes, and no hyphen used as a dash substitute should ever
// reach saved content_md/h1/meta fields.

// Replaces em dashes (—), en dashes used as a pause (–), and hyphen/double-hyphen
// used as a dash substitute (" - " or "--") with a comma, so sentences stay
// grammatical without the dash. Deliberately leaves alone:
//   - hyphens with no surrounding whitespace, i.e. normal compound words
//     ("well-formatted", "e-commerce", "non-negotiable")
//   - en dashes with no surrounding whitespace, i.e. numeric ranges ("10–15")
//   - a single leading "- " at the start of a line, i.e. a markdown list bullet
export function stripDashes(text: string): string {
  if (!text) return text;

  let result = text;

  // Em dash, with or without surrounding spaces -> comma
  result = result.replace(/\s*—\s*/g, ", ");

  // En dash used as a pause (has whitespace on at least one side) -> comma.
  // A bare numeric range like "10–15" has no surrounding whitespace and is left alone.
  result = result.replace(/(\s)\s*–\s*(\s|$)/g, "$1, ");
  result = result.replace(/^–\s*/gm, "");

  // Double hyphen used as a dash substitute ("--") -> comma
  result = result.replace(/\s*--\s*/g, ", ");

  // Single hyphen with whitespace on BOTH sides (a stray dash, not a compound
  // word and not a markdown list bullet, which only has trailing whitespace) -> comma
  result = result.replace(/(\S)\s+-\s+(\S)/g, "$1, $2");

  // Tidy up any double commas or trailing comma-space artifacts left behind
  result = result.replace(/,\s*,/g, ",").replace(/,\s*([.!?])/g, "$1");

  return result;
}

// Strips bracketed keyword-reference marker sequences (e.g. "[4][91][6]") if
// they ever end up baked into stored text rather than applied only at render
// time. Defensive — the dashboard currently injects these as a display-only
// transform, but this guards against any future code path that bakes them in.
export function stripKeywordMarkers(text: string): string {
  if (!text) return text;
  return text.replace(/(\[\d+\])+/g, "");
}
