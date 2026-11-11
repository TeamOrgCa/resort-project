// Credential-free layout checks using the real component and compiled Tailwind CSS.
// Run: node scripts/check-chatbot-layout.mjs (or set CHROME_PATH).
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { loadTsModule } from "../tests/helpers/load-ts-module.mjs";

const browserPath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(path => path && existsSync(path));
if (!browserPath) throw Error("Set CHROME_PATH to an installed Chromium browser.");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true });
for (const name of ["window", "document", "HTMLElement"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const Chat = loadTsModule("components/ChatBotMars.tsx", {
  "@/components/content/SiteContent": { useSiteContent: () => ({ "chatbot.faqs": Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`Custom question ${i + 1} about the resort and services?`, "Approved answer."])) }) },
  "next/image": { __esModule: true, default: ({ alt }) => createElement("span", null, alt) },
}).default;
const container = document.createElement("div"); document.body.append(container);
const root = createRoot(container), fixtures = new Map();
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => Response.json({ reply: "Additional services currently offered:\n- Extra mattress: PHP 300.00\n".repeat(18) + "long-text-".repeat(80) });
await act(async () => root.render(createElement(Chat)));
await act(async () => container.querySelector('[aria-label="Open ChatBot Mars"]').click());
await act(async () => [...container.querySelectorAll("button")].find(el => el.textContent === "Show me services").click());
fixtures.set("conversation", container.innerHTML);
await act(async () => [...container.querySelectorAll("button")].find(el => el.textContent === "Talk to a resort employee").click());
fixtures.set("support", container.innerHTML);
await act(async () => root.unmount()); dom.window.close(); globalThis.fetch = originalFetch;
const css = (await postcss([tailwind()]).process(readFileSync("app/globals.css", "utf8"), { from: "app/globals.css" })).css;
const server = createServer((request, response) => {
  const state = new URL(request.url, "http://localhost").searchParams.get("state");
  response.setHeader("Content-Type", "text/html");
  response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body data-state="${state}"><main style="height:2000px">Resort page</main>${fixtures.get(state) ?? ""}</body></html>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const profile = mkdtempSync(join(tmpdir(), "marville-chatbot-"));
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
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const pending = new Map(); let nextId = 1;
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data); if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id); pending.delete(message.id); clearTimeout(request.timeout);
    if (message.error) request.reject(Error(message.error.message)); else request.resolve(message.result);
  });
  send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++, timeout = setTimeout(() => { pending.delete(id); reject(Error(`Timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
  const sizes = [[320, 568], [390, 844], [430, 932], [568, 320], [844, 390], [390, 340], [768, 1024], [1280, 900]];
  const failures = [], preview = resolve(".next/chatbot-preview"); mkdirSync(preview, { recursive: true });
  for (const [width, height] of sizes) for (const state of fixtures.keys()) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 900 });
    await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?state=${state}` });
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      await sleep(40);
      ready = (await send("Runtime.evaluate", { expression: `document.readyState === 'complete' && document.body.dataset.state === '${state}' && !!document.getElementById('chatbot-message')`, returnByValue: true })).result.value;
    }
    if (!ready) throw Error("Fixture did not load.");
    const result = await send("Runtime.evaluate", { expression: `JSON.stringify((()=>{
      const panel=document.querySelector('section'), log=document.querySelector('[role="log"]'), rail=document.querySelector('[aria-label="FAQ shortcuts"]'), input=document.getElementById('chatbot-message'), send=input.form.querySelector('button'), r=panel.getBoundingClientRect(), l=log.getBoundingClientRect(), f=input.getBoundingClientRect(), b=send.getBoundingClientRect(), chips=[...rail.children];
      log.scrollTop=log.scrollHeight; rail.scrollLeft=rail.scrollWidth;
      return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,logHeight:l.height,railHeight:rail.getBoundingClientRect().height,singleRow:new Set(chips.map(el=>el.getBoundingClientRect().top)).size===1,railScrolls:rail.scrollLeft>0,logScrolls:log.scrollTop>0,inputVisible:f.top>=l.bottom && f.bottom<=r.bottom && b.right<=r.right,controls:chips.every(el=>el.getBoundingClientRect().height>=44),pageOverflow:document.documentElement.scrollWidth>innerWidth,pageScroll:scrollY};
    })())`, returnByValue: true });
    const m = JSON.parse(result.result.value);
    if (m.left < 0 || m.right > width + 1 || m.top < 0 || m.bottom > height + 1 || m.logHeight < height * .3 || m.railHeight > 80 || !m.singleRow || !m.railScrolls || !m.logScrolls || !m.inputVisible || !m.controls || m.pageOverflow || m.pageScroll) failures.push({ width, height, state, ...m });
    if (width === 390 && state === "conversation") {
      const shot = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(preview, `${width}x${height}.png`), Buffer.from(shot.data, "base64"));
    }
  }
  if (failures.length) throw Error(JSON.stringify(failures, null, 2));
  console.log(`Passed ${sizes.length * fixtures.size} Chromium layouts with 40 FAQs: one scrollable chip row, readable conversation, visible composer, 44px touch targets, and no page overflow.`);
} finally {
  if (send && socket?.readyState === WebSocket.OPEN) await send("Browser.close").catch(() => {});
  socket?.close(); browser.kill(); server.close();
  if (dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith("marville-chatbot-")) {
    await sleep(300); try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chromium may briefly retain its temporary profile. */ }
  }
}
