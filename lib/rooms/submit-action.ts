export const ROOM_ACTION_TIMEOUT_MS = 30000;
export class RoomActionUnconfirmedError extends Error {
  constructor() {
    super("No save confirmation was received. The action may have completed. Close and refresh rooms, then check the reservation and room history before submitting again.");
    this.name = "RoomActionUnconfirmedError";
  }
}

// A timeout or lost response does not prove that a database write failed. Do
// not automatically retry financial/occupancy mutations after either case.
export async function submitRoomAction(payload: { action: string; roomId?: string; input: Record<string, unknown>; confirmed: true }) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const request = async () => {
    let response: Response;
    try {
      response = await fetch("/api/admin/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal });
    } catch { throw new RoomActionUnconfirmedError(); }
    const result = await response.json().catch(() => null);
    if (response.status >= 500 && result?.outcome !== "not_applied") throw new RoomActionUnconfirmedError();
    if (response.ok && (result?.success !== true || !result.result || typeof result.result !== "object" ||
      payload.action === "reserve" && typeof result.result.reference_number !== "string")) throw new RoomActionUnconfirmedError();
    if (!response.ok) throw new Error(result?.message ?? `Unable to save the room action (${response.status}).`);
    return result as { success: true; result: { reference_number?: string }; message?: string };
  };
  try {
    return await Promise.race([request(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new RoomActionUnconfirmedError()); }, ROOM_ACTION_TIMEOUT_MS);
    })]);
  } finally { clearTimeout(timer); }
}
