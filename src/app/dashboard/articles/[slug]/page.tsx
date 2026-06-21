import { notFound } from "next/navigation";
import { marked } from "marked";
import { createClient } from "@/lib/supabase/server";
import { highlightKeywords } from "@/lib/seo";
import { ORIGINALITY_PASS_THRESHOLD } from "@/lib/originality";
import StatusControl from "@/components/StatusControl";

export default async function ArticleDetail({ params }: { params: { slug: string } }) {
  const supabase = createClient();
  const { data: article } = await supabase
    .from("articles")
    .select("*, clusters(name)")
    .eq("slug", params.slug)
    .single();

  if (!article) notFound();

  const markerEntries = (article.keyword_table ?? []).map((k: any) => ({
    marker: k.marker,
    usedAs: k.usedAs ?? k.keyword,
  }));
  const bodyHtml = highlightKeywords(marked.parse(article.content_md) as string, markerEntries);
  const h1Html = highlightKeywords(article.h1, markerEntries);

  const factCheck = article.fact_check as
    | { accuracy_score: number; needs_review: boolean; issues: { claim: string; concern: string; severity: "low" | "medium" | "high" }[] }
    | null;

  const originalityCheck = article.originality_check as
    | {
        originality_score: number;
        needs_review: boolean;
        issues: { excerpt: string; likely_source: string; concern: string; severity: "low" | "medium" | "high" }[];
      }
    | null;

  const severityStyles: Record<string, string> = {
    high: "bg-red-100 text-red-700",
    medium: "bg-amber-100 text-amber-700",
    low: "bg-atlasnavy/10 text-atlasnavy/70",
  };

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-atlasteal">
            {article.clusters?.name}
          </p>
          <h1
            className="mt-1 text-2xl font-bold text-atlasnavy"
            dangerouslySetInnerHTML={{ __html: h1Html }}
          />
        </div>
        <StatusControl articleId={article.id} status={article.status} />
      </div>

      <div className="mt-4 rounded-xl bg-white p-4 text-sm shadow-sm">
        <p><span className="font-semibold text-atlasnavy">Meta title:</span> {article.meta_title}</p>
        <p className="mt-1"><span className="font-semibold text-atlasnavy">Meta description:</span> {article.meta_description}</p>
        <p className="mt-1"><span className="font-semibold text-atlasnavy">Slug:</span> /{article.slug}</p>
      </div>

      {originalityCheck && (
        <div
          className={`mt-6 rounded-xl border p-6 shadow-sm ${
            originalityCheck.needs_review ? "border-amber-300 bg-amber-50" : "border-emerald-300 bg-emerald-50"
          }`}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-atlasnavy">Originality</h2>
            <span
              className={`rounded-full px-3 py-1 text-sm font-bold ${
                originalityCheck.originality_score >= ORIGINALITY_PASS_THRESHOLD
                  ? "bg-emerald-600 text-white"
                  : originalityCheck.originality_score >= 60
                  ? "bg-amber-500 text-white"
                  : "bg-red-600 text-white"
              }`}
            >
              {originalityCheck.originality_score}/100 original
            </span>
          </div>
          <p className="mt-1 text-sm text-atlasnavy/70">
            {originalityCheck.needs_review
              ? `Below the ${ORIGINALITY_PASS_THRESHOLD}/100 publish threshold — publishing is blocked until the flagged passages are rewritten and the article is regenerated, or an editor explicitly overrides it.`
              : "Reads as an independent synthesis — no passage traced back to a single source's wording or structure."}
          </p>

          {originalityCheck.issues.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-atlasnavy/60">
                Flagged passages
              </p>
              <ul className="mt-2 space-y-2">
                {originalityCheck.issues.map((issue, i) => (
                  <li key={i} className="rounded-md bg-white/70 p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${severityStyles[issue.severity] ?? severityStyles.low}`}
                      >
                        {issue.severity}
                      </span>
                      <span className="text-xs text-atlasnavy/50">resembles: {issue.likely_source}</span>
                    </div>
                    <p className="mt-1 italic text-atlasnavy/80">&ldquo;{issue.excerpt}&rdquo;</p>
                    <p className="mt-1 text-atlasnavy/70">{issue.concern}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {factCheck && (
        <div
          className={`mt-6 rounded-xl border p-6 shadow-sm ${
            factCheck.needs_review ? "border-amber-300 bg-amber-50" : "border-emerald-300 bg-emerald-50"
          }`}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-atlasnavy">Fact-check</h2>
            <span
              className={`rounded-full px-3 py-1 text-sm font-bold ${
                factCheck.accuracy_score >= 90
                  ? "bg-emerald-600 text-white"
                  : factCheck.accuracy_score >= 70
                  ? "bg-amber-500 text-white"
                  : "bg-red-600 text-white"
              }`}
            >
              {factCheck.accuracy_score}/100 accuracy
            </span>
          </div>
          <p className="mt-1 text-sm text-atlasnavy/70">
            {factCheck.needs_review
              ? "An editor should review the items below before publishing."
              : "No unsupported claims found against the supplied sources."}
          </p>

          {factCheck.issues.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-atlasnavy/60">
                Needs review
              </p>
              <ul className="mt-2 space-y-2">
                {factCheck.issues.map((issue, i) => (
                  <li key={i} className="rounded-md bg-white/70 p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${severityStyles[issue.severity] ?? severityStyles.low}`}
                      >
                        {issue.severity}
                      </span>
                      <span className="font-medium text-atlasnavy">{issue.claim}</span>
                    </div>
                    <p className="mt-1 text-atlasnavy/70">{issue.concern}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <article
        className="prose prose-sm mt-6 max-w-none rounded-xl bg-white p-6 shadow-sm prose-headings:text-atlasnavy"
        dangerouslySetInnerHTML={{ __html: bodyHtml }}
      />

      {article.faqs?.length > 0 && (
        <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-atlasnavy">FAQs</h2>
          <dl className="mt-3 space-y-4">
            {article.faqs.map((f: any, i: number) => (
              <div key={i}>
                <dt className="font-medium text-atlasnavy">{f.question}</dt>
                <dd className="mt-1 text-sm text-atlasnavy/80">{f.answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-atlasnavy">Keyword reference table</h2>
        <p className="mt-1 text-xs text-atlasnavy/50">
          Every keyword rendered in blue above carries a numbered marker ([n]) tying it back to a row
          here. "Original" is the researched target keyword; "Used as" is the literal text written
          into the article — they only differ when a keyword was merged with another or swapped for a
          synonym, which is flagged below.
        </p>
        <table className="mt-3 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-atlasnavy/10 text-atlasnavy/60">
              <th className="py-2">#</th>
              <th className="py-2">Original keyword</th>
              <th className="py-2">Used as</th>
              <th className="py-2">Cluster</th>
              <th className="py-2">Search intent</th>
              <th className="py-2">Source</th>
            </tr>
          </thead>
          <tbody>
            {(article.keyword_table ?? []).map((k: any, i: number) => (
              <tr key={i} className="border-b border-atlasnavy/5">
                <td className="py-2 font-semibold text-atlasteal">[{k.marker}]</td>
                <td className="py-2 font-semibold text-blue-600">{k.keyword}</td>
                <td className="py-2">
                  {k.usedAs && k.usedAs.toLowerCase() !== k.keyword.toLowerCase() ? (
                    <>
                      <span className="font-semibold text-blue-600">{k.usedAs}</span>
                      <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                        synonym/merge
                      </span>
                    </>
                  ) : (
                    <span className="text-atlasnavy/50">same</span>
                  )}
                </td>
                <td className="py-2">{k.cluster}</td>
                <td className="py-2 capitalize">{k.searchIntent ?? "—"}</td>
                <td className="py-2">{k.source ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {article.affiliate_links_used?.length > 0 && (
        <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-atlasnavy">Affiliate links applied</h2>
          <p className="mt-1 text-xs text-atlasnavy/50">
            Auto-inserted the first time each tool below was mentioned in the article.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {article.affiliate_links_used.map((a: any, i: number) => (
              <li key={i}>
                <span className="font-semibold text-atlasnavy">{a.label}</span>
                <span className="text-atlasnavy/50"> — matched "{a.matchedTerm}" →</span>{" "}
                <a href={a.url} className="text-atlasteal underline" target="_blank" rel="noreferrer">
                  {a.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {article.sources?.length > 0 && (
        <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-atlasnavy">Sources</h2>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {article.sources.map((s: any, i: number) => (
              <li key={i}>
                <a href={s.url} className="text-atlasteal underline" target="_blank" rel="noreferrer">
                  {s.title}
                </a>
                {s.publishedDate ? ` — ${s.publishedDate}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
