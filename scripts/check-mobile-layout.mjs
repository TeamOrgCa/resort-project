// Local, credential-free layout checks using the installed Chromium browser.
// Usage: node scripts/check-mobile-layout.mjs (or set CHROME_PATH).
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createElement as el } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { loadTsModule } from "../tests/helpers/load-ts-module.mjs";
import { legacyRates } from "../tests/helpers/package-rates.mjs";

const chrome = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(path => path && existsSync(path));
if (!chrome) throw Error("Set CHROME_PATH to an installed Chromium browser.");
const noop = () => {}, date = "2027-06-15";
const draft = { packageRateVersion: 1, packageRates: legacyRates, checkIn: date, checkOut: date, bookingMode: "day", startDatetime: date + "T08:00:00+08:00", endDatetime: date + "T16:00:00+08:00", wholeDayVariant: "day_to_night", firstName: "Alexandra", lastName: "Dela Cruz", email: "guest@example.com", phone: "09123456789", address: "Taytay, Rizal", adultCount: 20, childCount: 0, unitId: "unit", roomName: "Private swimming package with cottage and rooms", roomPrice: 7500, nights: 1, subtotal: 7500, total: 7500, tax: 0, downPayment: 1500, services: [], specialRequests: "", reservationId: "", reservationReference: "" };
const mocks = {
  "next/link": ({ href, children, ...props }) => el("a", { href, ...props }, children),
  "next/image": props => { const image = { ...props }; for (const key of ["fill", "unoptimized", "priority", "quality", "sizes"]) delete image[key]; return el("img", { ...image, style: props.fill ? { position: "absolute", width: "100%", height: "100%", inset: 0, ...props.style } : props.style }); },
  "next/navigation": { useRouter: () => ({ push: noop, replace: noop }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/admin" },
  "@/lib/supabase/client": { createClient: () => ({}) },
  "@/lib/stores/booking-store": { useBookingStore: selector => selector({ bookingDraft: draft, setBookingDraft: noop, setBookingDates: noop, setBookingWindow: noop, clearReservationMetadata: noop }) },
  "@/lib/booking/use-package-rates": { usePackageRates: () => ({ schedule: { version: 1, rates: legacyRates }, rates: legacyRates, loading: false, error: null, refresh: noop }) },
};
const cache = new Map();
const component = path => loadTsModule(path, mocks, cache).default;
const Header = component("components/admin/AdminSectionHeader.tsx"), Table = component("components/admin/AdminTablePreview.tsx"), Shell = component("components/admin/AdminShell.tsx");
const Chart = component("components/admin/ReportChart.tsx"), Period = component("components/admin/ReportPeriodFilter.tsx"), Metric = component("components/admin/AdminMetricCard.tsx");
const { contentDefinitions } = loadTsModule("lib/settings/content-catalog.ts");
const Content = component("components/admin/WebsiteContentEditor.tsx"), Calendar = component("components/booking/BookingDateCalendar.tsx"), Dialog = component("components/admin/catalog/CatalogDialog.tsx");
const { PERMISSIONS } = loadTsModule("lib/auth/role-access.ts");
const pages = new Map();
for (const path of ["app/page.tsx", "app/about/page.tsx", "app/booking/page.tsx", "app/booking/form/page.tsx", "app/booking/details/page.tsx", "app/booking/payment/page.tsx", "app/ocular/page.tsx", "app/reviews/page.tsx", "app/auth/login/page.tsx", "app/auth/register/page.tsx", "app/auth/forgot/page.tsx", "app/auth/reset/page.tsx", "app/privacy/page.tsx", "app/terms/page.tsx"]) {
  pages.set(path, renderToStaticMarkup(el(component(path))));
}
const table = el(Table, { title: "Reservation records", columns: [{ key: "reference", label: "Reference" }, { key: "guest", label: "Guest" }, { key: "email", label: "Email address" }, { key: "amount", label: "Remaining balance" }, { key: "status", label: "Status" }],
  rows: [{ id: "one", reference: "MV-TEST-LONG-BOOKING-REFERENCE-123456789", guest: "Alexandra Maria Dela Cruz", email: "averylongguestemailaddress@example.com", amount: "PHP 123,456.78", status: "Payment submitted" }], filters: [{ key: "status", label: "Status", options: ["Payment submitted"] }], rowActions: ["View details", "Approve payment", "Reject payment"], actions: ["Export records", "Add reservation"], pageSize: 10 });
const section = (name, children) => el(Shell, { role: "admin", permissions: PERMISSIONS }, el(Header, { title: name, subtitle: "Review resort records, update details and follow up on requests.", actions: el(Period, { period: "Custom", range: { startDate: date, endDate: date }, onPeriodChange: noop, onRangeChange: noop }) }), children);
for (const name of ["Transactions", "Records", "Users", "Audit log", "Business catalog"]) pages.set(`admin/${name}`, renderToStaticMarkup(section(name, table)));
for (const name of ["Dashboard", "Reports", "Analytics"]) pages.set(`admin/${name}`, renderToStaticMarkup(section(name, el("div", { className: "grid min-w-0 gap-4" }, el(Metric, { metric: { label: "Verified payments", value: "PHP 123,456.78", trend: "Actual verified receipts" } }), el(Chart, { title: "Booking activity", points: [{ label: "Confirmed reservations", value: 8 }, { label: "Awaiting payment verification", value: 4 }] }), table))));
const ReservationCalendar = component("components/admin/ReservationCalendar.tsx");
pages.set("admin/Reservations", renderToStaticMarkup(el(Shell, { role: "admin", permissions: PERMISSIONS }, el(ReservationCalendar, { initialAccess: { role: "admin", permissions: PERMISSIONS } }))));
pages.set("admin/Manual booking calendar", renderToStaticMarkup(section("Manual reservation", el(Calendar, { value: date, minDate: "2027-06-01", initialDate: date, onChange: noop }))));
for (const group of ["Branding", "Home page", "About page"]) pages.set(`admin/Configuration ${group}`, renderToStaticMarkup(section("Website content", el("div", { className: "admin-panel" }, el(Content, { group, definitions: contentDefinitions.filter(definition => definition.group === group), values: {}, disabled: false, onChange: noop, onUploadingChange: noop })))));
pages.set("admin/Content restore dialog", renderToStaticMarkup(el(Dialog, { title: "Restore default website content?", description: "Restore the original logo, home page and about page text and images. This publishes immediately and replaces unsaved website content edits.", busy: false, onClose: noop }, el("div", { className: "flex flex-col-reverse gap-3 sm:flex-row" }, el("button", { className: "admin-button-secondary" }, "Keep current content"), el("button", { className: "admin-button-primary" }, "Restore and publish defaults")))));
const css = (await postcss([tailwind()]).process(readFileSync("app/globals.css", "utf8"), { from: "app/globals.css" })).css;
const server = createServer((request, response) => {
  const key = new URL(request.url, "http://localhost").searchParams.get("fixture");
  if (key && pages.has(key)) { response.setHeader("Content-Type", "text/html"); response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body data-fixture="${encodeURIComponent(key)}">${pages.get(key)}</body></html>`); return; }
  const file = resolve("public", `.${decodeURIComponent(request.url.split("?")[0])}`);
  if (file.startsWith(resolve("public") + "/") || file.startsWith(resolve("public") + "\\")) {
    if (existsSync(file)) { response.setHeader("Content-Type", /\.png$/i.test(file) ? "image/png" : /\.webp$/i.test(file) ? "image/webp" : "image/jpeg"); response.end(readFileSync(file)); return; }
  }
  response.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const profile = join(tmpdir(), `marville-mobile-layout-${process.pid}`);
mkdirSync(profile, { recursive: true });
const browser = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--disable-background-networking", "--disable-extensions", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
let socket, send;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) throw Error("Headless browser did not start.");
  const port = readFileSync(portFile, "utf8").split("\n")[0];
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const pending = new Map(); let nextId = 1;
  socket.addEventListener("message", event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const { resolve, reject, timeout } = pending.get(message.id); clearTimeout(timeout); pending.delete(message.id); if (message.error) reject(Error(message.error.message)); else resolve(message.result); } });
  send = (method, params = {}) => new Promise((resolve, reject) => { const id = nextId++; const timeout = setTimeout(() => { pending.delete(id); reject(Error(`Timed out: ${method}`)); }, 15000); pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params })); });
  await send("Page.enable");
  const failures = []; let checked = 0;
  for (const [width, height] of [[320, 568], [390, 844], [667, 375], [768, 1024], [1024, 768], [1280, 900]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
    for (const [name] of pages) {
      await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?fixture=${encodeURIComponent(name)}` });
      let ready = false;
      for (let attempt = 0; attempt < 100 && !ready; attempt++) {
        await sleep(40);
        const state = await send("Runtime.evaluate", { expression: `document.readyState === 'complete' && document.body?.dataset.fixture === ${JSON.stringify(encodeURIComponent(name))}`, returnByValue: true });
        ready = state.result?.value === true;
      }
      if (!ready) throw Error(`Layout did not load: ${name}`);
      const result = await send("Runtime.evaluate", { expression: `JSON.stringify({ width:innerWidth, scroll:document.documentElement.scrollWidth, title:document.title, oversized:[...document.querySelectorAll('main,section,form,[role="dialog"],.admin-table-scroll')].filter(el=>el.getBoundingClientRect().width && el.getBoundingClientRect().right>innerWidth+1).map(el=>el.tagName+'.'+el.className).slice(0,5), smallInputs: innerWidth<640?[...document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]),select,textarea')].filter(el=>el.getBoundingClientRect().width && parseFloat(getComputedStyle(el).fontSize)<16).length:0 })`, returnByValue: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      const measured = JSON.parse(result.result.value); checked++;
      if (measured.scroll > width + 1 || measured.oversized.length || measured.smallInputs) failures.push({ name, width, height, ...measured });
    }
    console.log(`Checked ${pages.size} layouts at ${width} x ${height}.`);
  }
  if (failures.length) { console.error(JSON.stringify(failures, null, 2)); process.exitCode = 1; }
  else console.log(`Passed ${checked} Chromium layout checks: no page overflow, clipped module containers or undersized phone input text.`);
} finally {
  if (send && socket?.readyState === WebSocket.OPEN) await send("Browser.close").catch(() => {});
  socket?.close(); browser.kill(); server.close();
  // This is a unique temporary profile created by this script, never a user's browser profile.
  if (profile.startsWith(join(tmpdir(), "marville-mobile-layout-"))) { await sleep(300); try { rmSync(profile, { recursive: true, force: true }); } catch {} }
}
