import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const { submitRoomAction, RoomActionUnconfirmedError, ROOM_ACTION_TIMEOUT_MS } = loadTsModule("lib/rooms/submit-action.ts");
const payload = { roomId: "room", action: "reserve", input: {}, confirmed: true };
test("room request timeouts stop waiting without resending an uncertain mutation", async () => {
  const originalFetch = globalThis.fetch, originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  let timeout, signal, calls = 0, complete;
  globalThis.setTimeout = (callback, ms) => { assert.equal(ms, ROOM_ACTION_TIMEOUT_MS); timeout = callback; return 1; };
  globalThis.clearTimeout = () => {};
  globalThis.fetch = async (_url, options) => { calls++; signal = options.signal; return new Promise(resolve => { complete = resolve; }); };
  try {
    const result = submitRoomAction(payload);
    const rejected = assert.rejects(result, e => e instanceof RoomActionUnconfirmedError && /may have completed/.test(e.message));
    timeout(); await rejected;
    assert.equal(signal.aborted, true); assert.equal(calls, 1);
    complete(Response.json({ success: true, result: { reference_number: "RM-LATE" } }));
    await Promise.resolve(); assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
});
test("confirmed rejections retain actionable messages, while lost or invalid responses stay unconfirmed", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [status, body] of [[409, { message: "Room already reserved" }], [503, { message: "Apply the room migration", outcome: "not_applied" }]]) {
      globalThis.fetch = async () => Response.json(body, { status });
      await assert.rejects(submitRoomAction(payload), e => !(e instanceof RoomActionUnconfirmedError) && e.message === body.message);
    }
    for (const response of [new Response("Proxy error", { status: 502 }), new Response("Login page", { status: 200 }), Response.json({ success: true })]) {
      globalThis.fetch = async () => response;
      await assert.rejects(submitRoomAction(payload), RoomActionUnconfirmedError);
    }
    globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
    await assert.rejects(submitRoomAction(payload), RoomActionUnconfirmedError);
  } finally { globalThis.fetch = originalFetch; }
});
