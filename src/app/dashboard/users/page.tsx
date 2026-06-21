import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { setUserRole } from "./actions";

export default async function UsersPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  // Belt-and-suspenders: middleware already blocks non-admins from this
  // route, but the page checks again since it's the only place this data
  // is rendered.
  if (me?.role !== "admin") redirect("/dashboard");

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, role, created_at")
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="text-2xl font-semibold text-atlasnavy">Users</h1>
      <p className="mt-1 text-sm text-atlasnavy/60">
        Only you (admins) can see this tab. Approve new sign-ins by assigning a role.
      </p>

      <div className="mt-6 overflow-hidden rounded-xl border border-atlasnavy/10 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-atlassand/50 text-atlasnavy/70">
            <tr>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(profiles ?? []).map((p) => (
              <tr key={p.id} className="border-t border-atlasnavy/10">
                <td className="px-4 py-3">{p.email}</td>
                <td className="px-4 py-3">
                  {p.role ? (
                    <span
                      className={
                        p.role === "admin"
                          ? "rounded-full bg-atlasteal/10 px-2 py-1 text-xs font-medium text-atlasteal"
                          : "rounded-full bg-atlasnavy/10 px-2 py-1 text-xs font-medium text-atlasnavy"
                      }
                    >
                      {p.role}
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">
                      pending approval
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-atlasnavy/60">
                  {p.created_at ? new Date(p.created_at).toLocaleDateString() : "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <form action={setUserRole.bind(null, p.id, "editor")}>
                      <button
                        type="submit"
                        disabled={p.role === "editor"}
                        className="rounded-md border border-atlasnavy/20 px-3 py-1 text-xs font-medium text-atlasnavy hover:bg-atlassand disabled:opacity-40"
                      >
                        Make editor
                      </button>
                    </form>
                    <form action={setUserRole.bind(null, p.id, "admin")}>
                      <button
                        type="submit"
                        disabled={p.role === "admin"}
                        className="rounded-md bg-atlasteal px-3 py-1 text-xs font-medium text-white hover:bg-atlasteal/90 disabled:opacity-40"
                      >
                        Make admin
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
