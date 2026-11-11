// Credential-free visual checks of real booking markup, tour copy and Driver.js.
// Run: node scripts/check-booking-guide-layout.mjs (or set CHROME_PATH).
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { createElement as el } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { loadTsModule } from "../tests/helpers/load-ts-module.mjs";
import { legacyRates } from "../tests/helpers/package-rates.mjs";

const chrome = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(path => path && existsSync(path));
if (!chrome) throw Error("Set CHROME_PATH to an installed Chromium browser.");
const noop = () => {};
const draft = { packageRateVersion: 1, packageRates: legacyRates, bookingMode: "day", wholeDayVariant: "day_to_night", checkIn: "2027-06-15", checkOut: "2027-06-15", startDatetime: "2027-06-15T08:00:00+08:00", endDatetime: "2027-06-15T16:00:00+08:00", firstName: "Maria", lastName: "Cruz", email: "guest@example.com", phone: "09123456789", address: "Taytay, Rizal", adultCount: 20, childCount: 0, unitId: "unit", roomName: "Private resort package", roomPrice: 7500, nights: 1, subtotal: 7500, total: 7500, tax: 0, downPayment: 1500, services: [], specialRequests: "", reservationId: "", reservationReference: "" };
const mocks = {
  "next/link": ({ href, children, ...props }) => el("a", { href, ...props }, children),
  "next/image": props => { const image = { ...props }; for (const key of ["fill", "unoptimized", "priority", "quality", "sizes"]) delete image[key]; return el("img", { ...image, style: props.fill ? { position: "absolute", width: "100%", height: "100%", inset: 0, ...props.style } : props.style }); },
  "next/navigation": { useRouter: () => ({ push: noop, replace: noop }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/booking" },
  "@/lib/supabase/client": { createClient: () => ({}) },
  "@/lib/stores/booking-store": { useBookingStore: selector => selector({ bookingDraft: draft, setBookingDraft: noop, setBookingWindow: noop, resetBookingDraft: noop }) },
  "@/lib/booking/use-package-rates": { usePackageRates: () => ({ schedule: { version: 1, rates: legacyRates }, rates: legacyRates, loading: false, error: null, refresh: noop }) },
};
const { bookingGuide } = loadTsModule("components/booking/booking-guide.ts");
const { keepBookingPopoverInView } = loadTsModule("components/booking/booking-guide-viewport.ts");
const fixtures = new Map([["dates", "app/booking/page.tsx"], ["guest", "app/booking/form/page.tsx"], ["review", "app/booking/details/page.tsx"], ["payment", "app/booking/payment/page.tsx"]].map(([key, file]) => [key, renderToStaticMarkup(el(loadTsModule(file, mocks).default))]));
const css = (await postcss([tailwind()]).process(readFileSync("app/globals.css", "utf8"), { from: "app/globals.css" })).css
  + readFileSync("node_modules/driver.js/dist/driver.css", "utf8") + readFileSync("app/booking/booking-guide.css", "utf8");
const driverScript = readFileSync("node_modules/driver.js/dist/driver.js.iife.js", "utf8");
const server = createServer((req, res) => {
  if (req.url === "/driver.js") { res.setHeader("Content-Type", "application/javascript"); res.end(driverScript); return; }
  const key = new URL(req.url, "http://localhost").searchParams.get("page");
  if (!fixtures.has(key)) { res.writeHead(404).end(); return; }
  const guide = bookingGuide(key);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body data-guide-fixture="${key}">${fixtures.get(key)}<script src="/driver.js"></script><script>
    const guide=${JSON.stringify(guide)};
    const keepBookingPopoverInView=${keepBookingPopoverInView.toString()};
    let stopFitting;
    const trigger=document.querySelector('.booking-guide-button');
    trigger.onclick=()=>{window.tour=window.driver.js.driver({steps:[{popover:{title:guide.title,description:guide.description}},...guide.steps.filter(s=>document.querySelector(s.element)?.getClientRects().length)],animate:false,smoothScroll:false,disableActiveInteraction:true,onInteraction:()=>false,stagePadding:6,stageRadius:14,popoverClass:'booking-guide-popover',showProgress:true,nextBtnText:'Next',prevBtnText:'Back',doneBtnText:'Finish guide',closeBtnLabel:'Close booking guide',onPopoverRender:p=>{stopFitting?.();stopFitting=keepBookingPopoverInView(p.wrapper)},onDestroyed:()=>{stopFitting?.();trigger.hidden=false;trigger.focus({preventScroll:true})}});trigger.hidden=true;window.tour.drive()};
  </script></body></html>`);
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const profile = mkdtempSync(join(tmpdir(), "marville-booking-guide-"));
const browser = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--disable-background-networking", "--disable-extensions", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
const sleep = ms => new Promise(done => setTimeout(done, ms));
let socket, send;
try {
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) throw Error("Headless browser did not start.");
  const port = readFileSync(portFile, "utf8").split("\n")[0];
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const pending = new Map(); let id = 0;
  socket.addEventListener("message", event => { const message = JSON.parse(event.data), item = pending.get(message.id); if (!item) return; clearTimeout(item.timer); pending.delete(message.id); if (message.error) item.reject(Error(message.error.message)); else item.done(message.result); });
  send = (method, params = {}) => new Promise((done, reject) => { const key = ++id; const timer = setTimeout(() => { pending.delete(key); reject(Error(`Timed out: ${method}`)); }, 15000); pending.set(key, { done, reject, timer }); socket.send(JSON.stringify({ id: key, method, params })); });
  const evaluate = async expression => { const r = await send("Runtime.evaluate", { expression, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.text); return r.result.value; };
  await send("Page.enable");
  const failures = []; let checked = 0;
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1280, 900]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
    for (const page of fixtures.keys()) {
      await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?page=${page}` });
      for (let i = 0; i < 60 && !await evaluate(`document.body.dataset.guideFixture === ${JSON.stringify(page)} && Boolean(document.querySelector('.booking-guide-button')?.onclick)`); i++) await sleep(50);
      await evaluate("document.querySelector('.booking-guide-button').click()");
      for (let step = 0; step < 12 && await evaluate("window.tour.isActive()"); step++) {
        await sleep(150);
        const metrics = await evaluate(`(()=>{const p=document.querySelector('.driver-popover'),r=p.getBoundingClientRect(),controls=[...p.querySelectorAll('button')].filter(b=>b.getClientRects().length&&getComputedStyle(b).display!=='none');return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,smallControls:controls.some(b=>b.getBoundingClientRect().height<44),title:p.querySelector('.driver-popover-title').textContent}})()`);
        if (metrics.left < 0 || metrics.top < 0 || metrics.right > width + 1 || metrics.bottom > height + 1 || metrics.overflow || metrics.smallControls) failures.push({ width, height, page, step, ...metrics });
        checked++;
        if (width === 390 && step === 2) { const preview = join(tmpdir(), "marville-booking-guide-previews"); mkdirSync(preview, { recursive: true }); const shot = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(preview, `${page}.png`), Buffer.from(shot.data, "base64")); }
        await evaluate("window.tour.moveNext()");
      }
    }
  }
  if (failures.length) throw Error(JSON.stringify(failures, null, 2));
  console.log(`Passed ${checked} booking guide steps at phone, landscape and desktop sizes: popovers fit, 44px controls, no page overflow.`);
} finally {
  if (send && socket?.readyState === WebSocket.OPEN) await send("Browser.close").catch(() => {});
  socket?.close(); browser.kill(); server.close();
  if (dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith("marville-booking-guide-")) { await sleep(300); try { rmSync(profile, { recursive: true, force: true }); } catch { /* Browser may briefly retain its profile. */ } }
}
