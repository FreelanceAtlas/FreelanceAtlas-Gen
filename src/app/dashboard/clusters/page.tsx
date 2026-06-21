import { createClient } from "@/lib/supabase/server";
import KeywordStatusControl from "@/components/KeywordStatusControl";

export default async function ClustersPage() {
  const supabase = createClient();
  const { data: clusters } = await supabase.from("clusters").select("*").order("name");
  const { data: keywords } = await supabase.from("keywords").select("*").order("is_used");

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
                  .map((k) => (
                    <tr key={k.id} className="border-t border-atlasnavy/5">
                      <td className="py-1 text-blue-600 font-medium">{k.keyword}</td>
                      <td className="py-1 capitalize">{k.search_intent}</td>
                      <td className="py-1">
                        <KeywordStatusControl keywordId={k.id} isUsed={!!k.is_used} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
