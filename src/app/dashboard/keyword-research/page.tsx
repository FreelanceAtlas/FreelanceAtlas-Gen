import { createClient } from "@/lib/supabase/server";
import KeywordResearchTool from "@/components/KeywordResearchTool";

export default async function Page() {
  const supabase = createClient();
  const { data: clusters } = await supabase
    .from("clusters")
    .select("id, name")
    .order("name");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-atlasnavy">Keyword Research</h1>
        <p className="mt-1 text-sm text-atlasnavy/50">
          Search DataForSEO directly. Select keywords and save them to any cluster.
        </p>
      </div>
      <KeywordResearchTool clusters={clusters ?? []} />
    </div>
  );
}
