// Credential-free browser check using the real calendar markup, CSS and focus helper.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { loadTsModule } from "../tests/helpers/load-ts-module.mjs";
import { legacyRates } from "../tests/helpers/package-rates.mjs";

const browserPath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(path => path && existsSync(path));
if (!browserPath) throw Error("Set CHROME_PATH to an installed Chromium browser.");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true });
for (const name of ["window", "document", "HTMLElement", "Node"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const targetId = "11111111-1111-4111-8111-111111111111", targetDate = "2027-03-28";
const data = {
  reservations: [{ reservation_id: targetId, reference_number: "MV-TARGET", guest_id: "fixture", start_datetime: `${targetDate}T08:00:00+08:00`, end_datetime: `${targetDate}T16:00:00+08:00`, adult_count: 5, child_count: 0, status: "confirmed", payment_deadline_at: null }],
  guests: [{ id: "fixture", first_name: "Sample", last_name: "Guest" }],
  transactions: [{ reservation_id: targetId, paid_amount: 5000, balance: 0 }],
};
const client = { auth: { getUser: async () => ({ data: { user: { id: "manager" } } }) }, from(table) {
  const q = { select: () => q, neq: () => q, lt: () => q, gt: () => q, gte: () => q, in: () => q, eq: () => q, order: () => q, limit: () => q,
    then: (yes, no) => Promise.resolve({ data: data[table] ?? [], error: null }).then(yes, no) };
  return q;
} };
const Calendar = loadTsModule("components/admin/ReservationCalendar.tsx", {
  "@/lib/supabase/client": { createClient: () => client },
  "@/lib/booking/use-package-rates": { usePackageRates: () => ({ schedule: { version: 1, rates: legacyRates } }) },
  "@/components/admin/ManualBookingDialog": { __esModule: true, default: () => null },
  "@/components/admin/ReservationEditor": { __esModule: true, default: () => null },
  "next/link": { __esModule: true, default: ({ children, ...props }) => createElement("a", props, children) },
}).default;
const { focusCalendarNotification } = loadTsModule("lib/booking/calendar-notification-focus.ts");
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => Response.json({ blocks: [] });
const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
await act(async () => root.render(createElement(Calendar, { initialReservationId: targetId, initialDate: targetDate, highlightOnly: true, initialAccess: { role: "staff", permissions: ["reservations"] } })));
await act(async () => new Promise(resolve => setTimeout(resolve, 150)));
const markup = container.innerHTML;
await act(async () => root.unmount()); dom.window.close(); globalThis.fetch = originalFetch;
const css = (await postcss([tailwind()]).process(readFileSync("app/globals.css", "utf8"), { from: "app/globals.css" })).css;
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body class="admin-workspace" style="font-family:Arial"><header style="position:fixed;inset:0 0 auto;height:64px;background:white;z-index:100">Staff header</header><div style="height:600px"></div><main style="padding:24px">${markup}</main><div style="height:900px"></div></body></html>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const profile = mkdtempSync(join(tmpdir(), "marville-calendar-focus-"));
const browser = spawn(browserPath, ["--headless=new", "--disable-gpu", "--no-first-run", "--disable-background-networking", "--disable-extensions", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, send;
try {
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) throw Error("Headless browser did not start.");
  const port = readFileSync(portFile, "utf8").split("\n")[0];
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((yes, no) => { socket.addEventListener("open", yes, { once: true }); socket.addEventListener("error", no, { once: true }); });
  const pending = new Map(); let nextId = 0;
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(Error(message.error.message)); else request.resolve(message.result);
  });
  send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(Error(`Timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const sizes = [[390, 844], [568, 320], [768, 1024], [1280, 900]];
  for (const [width, height] of sizes) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
    await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      await sleep(40);
      ready = (await send("Runtime.evaluate", { expression: "document.readyState === 'complete' && !!document.querySelector('[data-notification-target]')", returnByValue: true })).result.value;
    }
    if (!ready) throw Error("Calendar fixture did not load.");
    const focused = await send("Runtime.evaluate", { expression: `(${focusCalendarNotification.toString()})(document.querySelector('[aria-label="Full reservation calendar"]'),${JSON.stringify(targetId)},${JSON.stringify(targetDate)},true)`, returnByValue: true });
    if (!focused.result.value) throw Error(`Target not found at ${width}x${height}`);
    const result = await send("Runtime.evaluate", { expression: `JSON.stringify((()=>{const e=document.activeElement,r=e.getBoundingClientRect(),s=getComputedStyle(e);return {target:e.dataset.calendarEvent,top:r.top,bottom:r.bottom,left:r.left,right:r.right,outline:s.outlineColor,outlineWidth:s.outlineWidth,dayMarked:!!e.closest('.calendar-notification-date'),month:document.querySelector('[aria-label="Desktop reservation calendar"] h2').textContent,scrolled:scrollY>0};})())`, returnByValue: true });
    const m = JSON.parse(result.result.value);
    if (m.target !== `${targetId}:${targetDate}` || m.top < 64 || m.bottom > height || m.left < 0 || m.right > width || m.outline !== "rgb(15, 23, 42)" || m.outlineWidth !== "3px" || !m.dayMarked || !m.scrolled || m.month !== "March 2027") throw Error(`${width}x${height}: ${JSON.stringify(m)}`);
  }
  console.log(`Passed ${sizes.length} Chromium calendar checks: correct month/date, visible target below header, horizontal scrolling, keyboard focus and black outline on desktop/mobile.`);
} finally {
  if (send && socket?.readyState === WebSocket.OPEN) await send("Browser.close").catch(() => {});
  socket?.close(); browser.kill(); server.close();
  if (dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith("marville-calendar-focus-")) {
    await sleep(300); try { rmSync(profile, { recursive: true, force: true }); } catch { /* Browser may briefly retain its temporary profile. */ }
  }
}
