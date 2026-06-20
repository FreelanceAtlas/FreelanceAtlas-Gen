import { createClient } from "@/lib/supabase/server";
import AffiliateLinkRow from "@/components/AffiliateLinkRow";

export default async function AffiliateLinksPage() {
  const supabase = createClient();
  const { data: links } = await supabase.from("affiliate_links").select("*").order("label");

  return (
    <div>
      <h1 className="text-2xl font-bold text-atlasnavy">Affiliate link bank</h1>
      <p className="mt-1 max-w-2xl text-sm text-atlasnavy/60">
        Whenever the generator mentions one of these tools, it auto-links the first mention to the
        URL below — no fake or placeholder links ever ship; a tool stays a plain mention until you
        paste a real affiliate URL here.
      </p>

      <div className="mt-6 overflow-x-auto rounded-xl bg-white p-5 shadow-sm">
        <table className="w-full text-left">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-atlasnavy/40">
              <th className="py-2">Tool</th>
              <th className="py-2">Category</th>
              <th className="py-2">Trigger words</th>
              <th className="py-2">Affiliate URL</th>
              <th className="py-2 text-center">Active</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(links ?? []).map((l) => (
              <AffiliateLinkRow
                key={l.id}
                id={l.id}
                label={l.label}
                category={l.category}
                url={l.url}
                triggerKeywords={l.trigger_keywords ?? []}
                isActive={l.is_active}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
