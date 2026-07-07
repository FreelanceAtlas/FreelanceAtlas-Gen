import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import KeywordStatusControl from "@/components/KeywordStatusControl";

export default async function ClustersPage() {
  const supabase = createClient();
  const { data: clusters } = await supabase.from("clusters").select("*").order("name");
  const { data: keywords } = await supabase.from("keywords").select("*").order("is_used");

  // A keyword is marked is_used=true when a draft is generated with it, but the
  // link to *which* article isn't stored on the keyword row. Each article's
  // keyword_table lists every keyword it actually used, so build a
  // keyword -> article(s) map from there to show where each used keyword landed.
  const { data: articles } = await supabase.from("articles").select("id, title, slug, keyword_table");
  const usedOn = new Map<string, { title: string; slug: string }[]>();
  for (const a of articles ?? []) {
    const table = Array.isArray(a.keyword_table) ? a.keyword_table : [];
    for (const entry of table) {
      for (const key of [entry?.keyword, entry?.usedAs, entry?.used_as]) {
        if (typeof key !== "string" || !key.trim()) continue;
        const norm = key.trim().toLowerCase();
        const refs = usedOn.get(norm) ?? [];
        if (!refs.some((r) => r.slug === a.slug)) refs.push({ title: a.title, slug: a.slug });
        usedOn.set(norm, refs);
      }
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-atlasnavy">Clusters & keyword bank</h1>
      <p className="mt-1 text-sm text-atlasnavy/60">
        Pillar-cluster topic map seeded from the live freelanceatlas.com blog audit, plus keyword
        gaps sourced from Wordstream, SEMrush Keyword Magic, Wordtracker, Ahrefs Keyword Generator,
        and Seobility. Keywords are never deleted here — "Used" ones can be reverted back to
        "Available" so they stay in the bank for a future draft.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-6">
        {(clusters ?? []).map((c) => (
          <div key={c.id} className="rounded-xl bg-white p-5 shadow-sm">
            <p className="font-semibold text-atlasnavy">{c.name}</p>
            <p className="text-xs text-atlasteal">{c.pillar_keyword}</p>
            <p className="mt-2 text-sm text-atlasnavy/70">{c.description}</p>
            <table className="mt-4 w-full text-left text-xs">
              <thead>
                <tr className="text-atlasnavy/50">
                  <th className="py-1">Keyword</th>
                  <th className="py-1">Intent</th>
                  <th className="py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {(keywords ?? [])
                  .filter((k) => k.cluster_id === c.id)
                  .map((k) => {
                    const refs = usedOn.get((k.keyword ?? "").trim().toLowerCase()) ?? [];
                    return (
                      <tr key={k.id} className="border-t border-atlasnavy/5">
                        <td className="py-1 text-blue-600 font-medium align-top">{k.keyword}</td>
                        <td className="py-1 capitalize align-top">{k.search_intent}</td>
                        <td className="py-1 align-top">
                          <KeywordStatusControl keywordId={k.id} isUsed={!!k.is_used} />
                          {k.is_used &&
                            (refs.length > 0 ? (
                              <div className="mt-1 text-[11px] text-atlasnavy/50">
                                Used on:{" "}
                                {refs.map((r, i) => (
                                  <span key={r.slug}>
                                    {i > 0 && ", "}
                                    <Link
                                      href={`/dashboard/articles/${r.slug}`}
                                      className="underline hover:text-atlasnavy"
                                    >
                                      {r.title}
                                    </Link>
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <div className="mt-1 text-[11px] text-atlasnavy/40">
                                Used (article not found)
                              </div>
                            ))}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
