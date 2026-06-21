import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function PendingPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-atlasnavy/10 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-atlasnavy">Awaiting approval</h1>
        <p className="mt-2 text-sm text-atlasnavy/60">
          Your account ({user.email}) is signed in but hasn&apos;t been approved yet.
          An admin needs to assign you a role before you can access the dashboard.
        </p>
      </div>
    </main>
  );
}
