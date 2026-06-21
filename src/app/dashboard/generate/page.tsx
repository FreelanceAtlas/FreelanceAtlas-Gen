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
      <h1 className="text-2xl font-bold text-atlasnavy">Generate a new post</h1>
      <p className="mt-1 text-sm text-atlasnavy/60">
        Every topic is checked against existing FreelanceAtlas posts and prior drafts before
        anything is written, so the same angle never gets published twice.
      </p>
      <div className="mt-6">
        <GenerateForm clusters={clusters ?? []} keywords={keywords ?? []} />
      </div>
    </div>
  );
}
