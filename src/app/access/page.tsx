import { verifyAccessCode } from "./actions";

export default function AccessPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-atlassand px-4">
      <div className="w-full max-w-sm rounded-2xl border border-atlasnavy/5 bg-white p-8 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="FreelanceAtlas" className="h-9 w-auto" />
        <h1 className="mt-5 text-xl font-bold tracking-tight text-atlasnavy">Content studio</h1>
        <p className="mt-1 text-sm text-atlasnavy/60">Enter the access code to continue</p>

        <form action={verifyAccessCode} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-atlasnavy">Access code</label>
            <input
              type="password"
              name="code"
              required
              autoFocus
              className="mt-1 w-full rounded-lg border border-atlasnavy/15 px-3.5 py-2.5 text-sm focus:border-atlasteal focus:outline-none focus:ring-2 focus:ring-atlasteal/20"
            />
          </div>

          {searchParams?.error && (
            <p className="text-sm text-red-600">Incorrect code. Try again.</p>
          )}

          <button
            type="submit"
            className="w-full rounded-full bg-atlasnavy py-2.5 text-sm font-bold text-white transition-colors hover:bg-atlasteal"
          >
            Continue
          </button>
        </form>
      </div>
    </main>
  );
}
