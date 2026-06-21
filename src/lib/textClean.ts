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
//
// IMPORTANT: every "surrounding whitespace" check below uses [^\S\n] (horizontal
// whitespace only: spaces/tabs), never bare \s. \s also matches newlines, and a
// markdown bulleted list looks like "...item one.\n- Item two." to a regex that
// doesn't draw that distinction, the line break plus the bullet's "- " reads as
// a stray dash with whitespace on both sides and gets collapsed to ", ",
// silently deleting the bullet and the line break. Repeated down a whole list
// that turns real bullets into one comma/period run-on sentence. Keeping these
// patterns scoped to a single line is what protects list structure.
export function stripDashes(text: string): string {
  if (!text) return text;

  let result = text;

  // Em dash, with or without surrounding horizontal whitespace -> comma
  result = result.replace(/[^\S\n]*—[^\S\n]*/g, ", ");

  // En dash used as a pause (horizontal whitespace on at least one side) -> comma.
  // A bare numeric range like "10–15" has no surrounding whitespace and is left alone.
  result = result.replace(/([^\S\n])[^\S\n]*–[^\S\n]*([^\S\n]|$)/g, "$1, ");
  result = result.replace(/^–[^\S\n]*/gm, "");

  // Double hyphen used as a dash substitute ("--") -> comma
  result = result.replace(/[^\S\n]*--[^\S\n]*/g, ", ");

  // Single hyphen with horizontal whitespace on BOTH sides, on the same line
  // (a stray dash, not a compound word and not a markdown list bullet, which
  // only has trailing whitespace) -> comma. Restricted to [^\S\n] so this can
  // never match across a line break and eat a list bullet.
  result = result.replace(/(\S)[^\S\n]+-[^\S\n]+(\S)/g, "$1, $2");

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
