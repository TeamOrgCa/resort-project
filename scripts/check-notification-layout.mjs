// Credential-free Chromium checks for the shared customer/staff popup layout.
// Run: node scripts/check-notification-layout.mjs (or set CHROME_PATH).
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { loadTsModule } from "../tests/helpers/load-ts-module.mjs";

const browserPath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(path => path && existsSync(path));
if (!browserPath) throw Error("Set CHROME_PATH to an installed Chromium browser.");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true });
for (const name of ["window", "document", "HTMLElement"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const Alerts = loadTsModule("components/notifications/NotificationAlerts.tsx").default;
const items = Array.from({ length: 3 }, (_, index) => ({ notification_id: `notice-${index}`, title: "Reservation and refund update for a very long customer name and booking reference ".repeat(4), message: "Your payment and reservation details are available in your notifications. ".repeat(100), action_url: "/manage", is_read: false, recipient_id: "fixture", created_at: "2026-11-11T00:00:00Z" }));
const sizes = [[320, 568], [390, 844], [430, 932], [568, 320], [667, 375], [844, 390], [768, 1024], [1280, 900]];
const fixtures = new Map();
for (const [width, height] of sizes) {
  const compact = width < 640 || height <= 500;
  dom.window.matchMedia = () => ({ matches: compact, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(Alerts, { items, remaining: 27, onDismiss() {}, onDismissAll() {} })));
  fixtures.set(`${width}x${height}`, document.querySelector('[aria-label="New notifications"]').outerHTML);
  await act(async () => root.unmount()); container.remove();
}
dom.window.close();
const css = (await postcss([tailwind()]).process(readFileSync("app/globals.css", "utf8"), { from: "app/globals.css" })).css;
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost"), key = url.searchParams.get("size"), role = url.searchParams.get("role");
  if (!fixtures.has(key)) { response.writeHead(404).end(); return; }
  response.setHeader("Content-Type", "text/html");
  response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body data-fixture="${key}-${role}" style="min-height:100vh;background:#f8f4ec"><header style="height:${role === 'customer' ? 80 : 64}px;background:white;padding:20px;font-weight:bold">${role === "customer" ? "MarVille Resort" : "Staff portal"}</header><main style="padding:24px"><h1 style="font-size:24px;margin:116px 0 16px">${role === "customer" ? "Manage your booking" : "Reservation calendar"}</h1><button id="page-action" style="height:48px;padding:0 18px;background:#a9442b;color:white;border-radius:8px" onclick="this.dataset.clicked='true'">Continue working</button></main>${fixtures.get(key)}</body></html>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const profile = mkdtempSync(join(tmpdir(), "marville-notifications-"));
const browser = spawn(browserPath, ["--headless=new", "--disable-gpu", "--no-first-run", "--disable-background-networking", "--disable-extensions", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, send;
try {
  const portFile = join(profile, "DevToolsActivePort");
  for (let attempt = 0; attempt < 150 && !existsSync(portFile); attempt++) await sleep(100);
  if (!existsSync(portFile)) throw Error("Headless browser did not start.");
  const port = readFileSync(portFile, "utf8").split("\n")[0];
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const pending = new Map(); let nextId = 1;
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data); if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id); pending.delete(message.id); clearTimeout(request.timeout);
    if (message.error) request.reject(Error(message.error.message)); else request.resolve(message.result);
  });
  send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++; const timeout = setTimeout(() => { pending.delete(id); reject(Error(`Timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
  await send("Page.enable");
  const failures = [], preview = resolve(".next/notification-preview"); mkdirSync(preview, { recursive: true });
  let checked = 0;
  for (const role of ["customer", "staff"]) for (const [width, height] of sizes) {
    const key = `${width}x${height}`, compact = width < 640 || height <= 500;
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 900 });
    await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?size=${key}&role=${role}` });
    let ready = false;
    for (let attempt = 0; attempt < 100 && !ready; attempt++) {
      await sleep(40);
      const state = await send("Runtime.evaluate", { expression: `document.readyState === 'complete' && document.body.dataset.fixture === ${JSON.stringify(`${key}-${role}`)}`, returnByValue: true }); ready = state.result?.value === true;
    }
    if (!ready) throw Error(`Fixture did not load: ${key}-${role}`);
    const result = await send("Runtime.evaluate", { expression: `JSON.stringify((()=>{const a=document.querySelector('[aria-label="New notifications"]'),r=a.getBoundingClientRect(),b=document.getElementById('page-action'),p=b.getBoundingClientRect();return {height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom,count:a.querySelectorAll('article').length,overflow:document.documentElement.scrollWidth>innerWidth,controls:[...a.querySelectorAll('button,a')].every(el=>el.getBoundingClientRect().height>=44),target:{x:p.x+p.width/2,y:p.y+p.height/2},targetClear:document.elementFromPoint(p.x+p.width/2,p.y+p.height/2)===b};})())`, returnByValue: true });
    const measured = JSON.parse(result.result.value);
    if (measured.overflow || !measured.controls || measured.left < 0 || measured.right > width + 1 || (compact && (measured.height > 128 || measured.height > height * .35 || measured.count !== 1 || measured.top < 80 || measured.bottom > height || !measured.targetClear)) || (!compact && measured.count !== 3)) failures.push({ role, width, height, ...measured });
    if (compact) {
      await send("Input.dispatchMouseEvent", { type: "mousePressed", ...measured.target, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...measured.target, button: "left", clickCount: 1 });
      const clicked = await send("Runtime.evaluate", { expression: "document.getElementById('page-action').dataset.clicked", returnByValue: true });
      if (clicked.result.value !== "true") failures.push({ role, width, height, clickBlocked: true });
    }
    if (width === 390 || width === 667) {
      const screenshot = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(preview, `${role}-${key}.png`), Buffer.from(screenshot.data, "base64"));
    }
    checked++;
  }
  if (failures.length) throw Error(JSON.stringify(failures, null, 2));
  console.log(`Passed ${checked} customer/staff Chromium layouts: compact alerts stay below 128px and 35% of viewport height, page actions remain clickable, and touch controls stay at least 44px tall.`);
} finally {
  if (send && socket?.readyState === WebSocket.OPEN) await send("Browser.close").catch(() => {});
  socket?.close(); browser.kill(); server.close();
  if (dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith("marville-notifications-")) {
    await sleep(300); try { rmSync(profile, { recursive: true, force: true }); } catch { /* Browser shutdown may retain a temporary file briefly. */ }
  }
}
