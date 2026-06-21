"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function setUserRole(userId: string, role: "admin" | "editor") {
  const supabase = createClient();

  // RLS only allows this update to succeed if the caller is an admin
  // (see profiles_admin_update_any policy). No service-role bypass needed.
  const { error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", userId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/dashboard/users");
}
