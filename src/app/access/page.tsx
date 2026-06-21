import { verifyAccessCode } from "./actions";

export default function AccessPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-atlasnavy/10 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-atlasnavy">FreelanceAtlas Gen</h1>
        <p className="mt-1 text-sm text-atlasnavy/60">Enter the access code to continue</p>

        <form action={verifyAccessCode} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-atlasnavy">Access code</label>
            <input
              type="password"
              name="code"
              required
              autoFocus
              className="mt-1 w-full rounded-md border border-atlasnavy/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-atlasteal"
            />
          </div>

          {searchParams?.error && (
            <p className="text-sm text-red-600">Incorrect code. Try again.</p>
          )}

          <button
            type="submit"
            className="w-full rounded-md bg-atlasteal py-2 text-sm font-semibold text-white hover:bg-atlasteal/90"
          >
            Continue
          </button>
        </form>
      </div>
    </main>
  );
}
