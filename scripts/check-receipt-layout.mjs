// Offline, credential-free checks and previews for the actual printable receipt.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PDFDocument } from "pdf-lib";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { loadTsModule } from "../tests/helpers/load-ts-module.mjs";

const browserPath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(path => path && existsSync(path));
if (!browserPath) throw Error("Set CHROME_PATH to an installed Chromium browser.");
const branding = { "resort.name": "MarVille Resort Complex", "resort.address": "Cabrera Road, Hapay na Mangga, Brgy. Dolores, Taytay, Rizal 1920", "resort.email": "emailmarvilleresort@gmail.com", "resort.contact_numbers": ["09172796592", "82360633"], "content.branding.logo": "/website_logo_transparent.png" };
globalThis.document = { body: {} };
const Modal = loadTsModule("components/admin/transactions/KeyValueDetailsModal.tsx", {
  "react-dom": { createPortal: element => element }, "next/image": ({ src, alt, width, height, className }) => createElement("img", { src, alt, width, height, className }),
  "@/components/content/SiteContent": { useSiteContent: () => branding, contentText: (content, key) => content[key] ?? "" },
}).default;
const samples = {
  private: [["Receipt No.", "RCPT-2026-000127"], ["Issued At", "Nov 20, 2026, 10:30 AM"], ["Guest Name", "Maria Alexandra Reyes Santos"], ["Reservation Ref", "MV-2026-000081"], ["Payment for", "Reservation down payment - Whole Day - Overnight"], ["Payment Method", "GCash"], ["Payment Ref", "0001234567890"], ["Paid At", "Nov 20, 2026, 10:25 AM"], ["Amount Paid", "PHP 3,000.00"], ["Booking Total at Payment", "PHP 15,000.00"], ["Balance After Payment", "PHP 12,000.00"]],
  public: [["Receipt No.", "PA-RCPT-2026-000021"], ["Issued At", "Nov 20, 2026, 11:30 AM"], ["Guest Name", "Juan dela Cruz"], ["Contact No.", "09171234567"], ["Collection Ref", "PA-2026-000021"], ["Access Type", "Public swimming"], ["Payment for", "Two adult swimming admissions"], ["Payment Method", "Cash"], ["Payment Ref", "CASH-1234567890"], ["Paid At", "Nov 20, 2026, 11:30 AM"], ["Amount Paid", "PHP 400.00"], ["Collection Total", "PHP 400.00"], ["Balance After Payment", "PHP 0.00"]],
};
const fixtures = Object.fromEntries(Object.entries(samples).map(([key, rows]) => [key, renderToStaticMarkup(createElement(Modal, { details: { title: "Receipt details", kind: "receipt", fields: rows.map(([label, value]) => ({ label, value: value.replace(/^PHP /, "\u20b1") })) }, onClose() {} }))]));
const InvoiceModal = loadTsModule("components/admin/transactions/InvoiceDetailsModal.tsx", {
  "react-dom": { createPortal: element => element },
  "@/lib/use-portal-target": { usePortalTarget: () => document.body },
  "next/image": ({ src, alt, width, height, className }) => createElement("img", { src, alt, width, height, className }),
  "@/components/content/SiteContent": { useSiteContent: () => branding, contentText: (content, key) => content[key] ?? "" },
}).default;
for (const [kind, count] of [["invoice", 2], ["invoice-long", 65]]) {
  const invoiceDetails = {
    invoice: { invoice_id: "INV-2026-000081", reservation_id: "r1", total_amount: 15000, created_at: "2026-11-20T02:30:00Z" },
    reservation: { reference_number: "MV-2026-000081", status: "confirmed", booking_type: "online", start_datetime: "2026-11-21T02:00:00Z", end_datetime: "2026-11-21T10:00:00Z" },
    transaction: { total_amount: 15000, paid_amount: 3000, balance: 12000, status: "partial" },
    nights: 1, unitBreakdown: [{ name: "Private pool package", quantity: 1, pricePerNight: 12000, lineTotal: 12000 }],
    serviceBreakdown: Array.from({ length: count }, (_, i) => ({ name: `Optional resort service ${i + 1}`, quantity: 2, priceAtTime: 750, lineTotal: 1500 })),
    unitsSubtotal: 12000, servicesSubtotal: count * 1500, computedTotal: 12000 + count * 1500,
    verifiedPayments: [{ payment_id: "p1", reference_number: "0001234567890", amount: 3000, status: "verified", paid_at: "2026-11-20T02:25:00Z" }],
    latestReceipt: { receipt_number: "RCPT-2026-000127", issued_at: "2026-11-20T02:30:00Z" },
  };
  fixtures[kind] = renderToStaticMarkup(createElement(InvoiceModal, { isOpen: true, isLoading: false, error: null, invoiceDetails, onClose() {} }));
}
delete globalThis.document;
const css = (await postcss([tailwind()]).process(readFileSync("app/globals.css", "utf8"), { from: "app/globals.css" })).css;
const server = createServer((request, response) => {
  if (request.url === "/website_logo_transparent.png") { response.setHeader("Content-Type", "image/png"); response.end(readFileSync("public/website_logo_transparent.png")); return; }
  const key = new URL(request.url, "http://localhost").searchParams.get("kind") ?? "private";
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="margin:0;background:#f8f4ec" data-fixture="${key}"><main>Staff interface must not print</main>${fixtures[key]}</body></html>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const profile = mkdtempSync(join(tmpdir(), "marville-receipts-"));
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
    const id = nextId++, timeout = setTimeout(() => { pending.delete(id); reject(Error(`Timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
  const out = resolve(".next/receipt-preview"); mkdirSync(out, { recursive: true }); await send("Page.enable");
  for (const kind of Object.keys(fixtures)) {
    await send("Emulation.setEmulatedMedia", { media: "screen" });
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?kind=${kind}` });
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) { await sleep(50); ready = (await send("Runtime.evaluate", { expression: `document.readyState==='complete' && document.body.dataset.fixture==='${kind}'`, returnByValue: true })).result?.value; }
    if (!ready) throw Error(`Receipt did not load: ${kind}`);
    const overflow = (await send("Runtime.evaluate", { expression: "document.documentElement.scrollWidth > innerWidth || document.querySelector('.receipt-document').scrollWidth > document.querySelector('.receipt-document').clientWidth", returnByValue: true })).result.value;
    if (overflow) throw Error(`Mobile receipt overflows: ${kind}`);
    const mobile = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(out, `${kind}-mobile.png`), Buffer.from(mobile.data, "base64"));
    await send("Emulation.setDeviceMetricsOverride", { width: 794, height: 1123, deviceScaleFactor: 1, mobile: false });
    await send("Emulation.setEmulatedMedia", { media: "print" });
    const toolbarVisible = (await send("Runtime.evaluate", { expression: "getComputedStyle(document.querySelector('.receipt-toolbar')).display !== 'none' || getComputedStyle(document.querySelector('main')).display !== 'none'", returnByValue: true })).result.value;
    if (toolbarVisible) throw Error("Receipt prints interface controls.");
    const visibleDialogs = (await send("Runtime.evaluate", { expression: "[...document.querySelectorAll('[role=dialog]')].some(node=>getComputedStyle(node).display!=='none')", returnByValue: true })).result.value;
    if (visibleDialogs && kind.startsWith("invoice")) throw Error("Invoice prints its screen dialog.");
    const result = await send("Page.printToPDF", { printBackground: true, displayHeaderFooter: false, preferCSSPageSize: true });
    const bytes = Buffer.from(result.data, "base64"), pdf = await PDFDocument.load(bytes);
    if (!kind.startsWith("invoice") && pdf.getPageCount() !== 1) throw Error(`Expected one page for ${kind}, got ${pdf.getPageCount()}`);
    if (kind === "invoice" && pdf.getPageCount() > 2) throw Error("Short invoice unexpectedly exceeds two pages.");
    if (kind === "invoice-long" && pdf.getPageCount() < 2) throw Error("Long invoice did not paginate.");
    const { width, height } = pdf.getPage(0).getSize(); if (width > height) throw Error("Receipt must print in portrait.");
    writeFileSync(join(out, `${kind}-receipt.pdf`), bytes);
    const print = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); writeFileSync(join(out, `${kind}-print.png`), Buffer.from(print.data, "base64"));
  }
  console.log(`Passed private/public receipt and invoice mobile layout, A4 printing, and long invoice pagination. Previews: ${out}`);
} finally {
  if (send && socket?.readyState === WebSocket.OPEN) await send("Browser.close").catch(() => {});
  socket?.close(); browser.kill(); server.close();
  if (dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith("marville-receipts-")) {
    await sleep(300); try { rmSync(profile, { recursive: true, force: true }); } catch { /* A closing browser may briefly retain files. */ }
  }
}
