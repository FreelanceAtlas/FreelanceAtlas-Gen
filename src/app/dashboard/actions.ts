"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function updateAffiliateLink(id: string, url: string, isActive: boolean) {
  const supabase = createClient();
  const { error } = await supabase
    .from("affiliate_links")
    .update({ url: url || null, is_active: isActive })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/affiliate-links");
}

export async function updateArticleStatus(articleId: string, status: string) {
  const supabase = createClient();
  const { error } = await supabase.from("articles").update({ status }).eq("id", articleId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/articles");
}
