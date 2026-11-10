// Server auth routes change cookies without necessarily emitting a browser
// Supabase auth event. Hide account data while those requests are in progress.
export const SESSION_CHANGE_EVENT = "marville:session-change";
export const SESSION_CHANGE_STORAGE_KEY = "marville:session-changed";

export function beginSessionChange() {
  if (typeof window === "undefined") return () => {};
  window.dispatchEvent(new window.CustomEvent(SESSION_CHANGE_EVENT, { detail: "changing" }));
  return () => {
    window.dispatchEvent(new window.CustomEvent(SESSION_CHANGE_EVENT, { detail: "changed" }));
    try {
      window.localStorage.setItem(SESSION_CHANGE_STORAGE_KEY, `${Date.now()}:${Math.random()}`);
    } catch { /* Same-tab synchronization works without browser storage. */ }
  };
}
