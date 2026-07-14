import { createClient } from "@/lib/supabase/server";
import GenerateForm from "@/components/GenerateForm";

export default async function GeneratePage() {
  const supabase = createClient();
  const [{ data: clusters }, { data: keywords }] = await Promise.all([
    supabase.from("clusters").select("id, name").order("name"),
    supabase.from("keywords").select("id, keyword, cluster_id, is_used"),
  ]);

  return (
    <div>
      <div className="mx-auto max-w-3xl text-center">
        <h1 className="text-3xl font-bold tracking-tight text-atlasnavy">Generate a new post</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-atlasnavy/60">
          Pick a topic and the rest flows on its own — outline, keyword research, sources,
          duplicate checks, fact-checking, and internal links all happen automatically.
        </p>
      </div>
      <div className="mt-8">
        <GenerateForm clusters={clusters ?? []} keywords={keywords ?? []} />
      </div>
    </div>
  );
}
