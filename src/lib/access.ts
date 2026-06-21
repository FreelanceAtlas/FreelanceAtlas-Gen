function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Derives a fixed token from SESSION_SECRET via HMAC-SHA256. There is no
 * per-user state in this app (single shared access code), so the signed
 * cookie value is just this deterministic token — anyone who knows the
 * access code gets the same session token, which is checked on every
 * request by middleware.
 */
export async function signToken(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode("freelanceatlas-gen-access")
  );
  return toHex(sig);
}

export const ACCESS_COOKIE_NAME = "atlas_access";
