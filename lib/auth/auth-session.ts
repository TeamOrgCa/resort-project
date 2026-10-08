const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read the session identifier from a Supabase-issued access token. Authorization
 * must still be based on auth.getUser() or a verified database request. */
export function getAuthSessionId(accessToken: string | undefined): string | null {
  if (!accessToken) return null;
  try {
    const encoded = accessToken.split(".")[1];
    const claims = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/"))) as { session_id?: unknown };
    return typeof claims.session_id === "string" && UUID_PATTERN.test(claims.session_id) ? claims.session_id : null;
  } catch {
    return null;
  }
}
