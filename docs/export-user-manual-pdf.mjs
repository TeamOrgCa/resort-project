// Print the self-contained role manual using a local headless Chromium browser.
// Run python docs/build-user-manual-pdf.py to build both HTML and PDF.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PDFDocument, PDFName } from "pdf-lib";
import sharp from "sharp";

const docs = dirname(fileURLToPath(import.meta.url));
const html = join(docs, "USER_MANUAL_ALL_ROLES.html");
let destination = join(docs, "USER_MANUAL.pdf");
const imagesOnly = process.argv.includes("--images-only");
const browserPath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(path => path && existsSync(path));
if (!browserPath) throw Error("Set CHROME_PATH to an installed Chromium browser.");
if (!existsSync(html)) throw Error("Build the role manual HTML first.");
const edition = readFileSync(html, "utf8").match(/<meta name="manual-edition" content="([^"]+)">/)?.[1];
if (!edition) throw Error("Build the manual HTML with an Edition date before exporting.");
const profile = mkdtempSync(join(tmpdir(), "marville-manual-"));
const browser = spawn(browserPath, ["--headless=new", "--disable-gpu", "--no-first-run", "--disable-background-networking", "--disable-extensions", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, send;
async function writeImage(filename, bytes) {
  for (let attempt = 0; ; attempt++) {
    try { writeFileSync(filename, bytes); return; }
    catch (error) {
      if (attempt >= 5 || !["UNKNOWN", "EBUSY", "EPERM"].includes(error.code)) throw error;
      await sleep(250);
    }
  }
}
async function exportImages(pages) {
  const directory = join(docs, "user-manual-images");
  mkdirSync(directory, { recursive: true });
  await send("Emulation.setEmulatedMedia", { media: "print" });
  const exported = [];
  for (const page of pages) {
    const result = await send("Runtime.evaluate", { expression: `JSON.stringify((()=>{const sheet=document.getElementById(${JSON.stringify(page.id)}),r=sheet.getBoundingClientRect();return {title:sheet.querySelector('h1')?.innerText??sheet.id,clip:{x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:2480/r.width}};})())`, returnByValue: true });
    const { title, clip } = JSON.parse(result.result.value);
    const captured = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip });
    const bytes = await sharp(Buffer.from(captured.data, "base64")).resize(2480, 3508, { fit: "fill" }).withMetadata({ density: 300 }).png().toBuffer();
    const metadata = await sharp(bytes).metadata();
    if (metadata.width !== 2480 || metadata.height !== 3508 || metadata.density !== 300) throw Error(`Unexpected image dimensions: ${page.id}`);
    const filename = `${String(page.page).padStart(2, "0")}-${page.id}.png`;
    await writeImage(join(directory, filename), bytes);
    exported.push({ page: page.page, id: page.id, title, filename, width: metadata.width, height: metadata.height, dpi: 300 });
    if (exported.length % 5 === 0 || exported.length === pages.length) console.log(`Exported ${exported.length}/${pages.length} manual PNG pages.`);
  }
  writeFileSync(join(directory, "manifest.json"), JSON.stringify({ edition, format: "PNG", pages: exported }, null, 2) + "\n");
  const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  writeFileSync(join(directory, "index.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MarVille Resort User Manual Images</title><style>body{margin:0;background:#e5e9e3;color:#293b32;font:16px Arial,sans-serif}header{padding:24px;text-align:center}main{max-width:1000px;margin:auto;padding:0 16px}figure{margin:0 0 32px}img{width:100%;height:auto;display:block;background:white}figcaption{padding:12px}a{color:#315e48}</style><header><h1>MarVille Resort Complex User Manual</h1><p>Edition: ${escape(edition)} · ${exported.length} PNG pages · 300 DPI</p><a href="../USER_MANUAL_IMAGES.zip">Download all pages as ZIP</a></header><main>${exported.map(page => `<figure><a href="${page.filename}" download><img src="${page.filename}" alt="Page ${page.page}: ${escape(page.title)}" loading="lazy" width="2480" height="3508"></a><figcaption>${page.page}. ${escape(page.title)} — <a href="${page.filename}" download>Download PNG</a></figcaption></figure>`).join("")}</main></html>`);
  console.log(`Created ${exported.length} PNG images at 2480 x 3508 pixels / 300 DPI: ${directory}`);
}
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
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id); pending.delete(message.id); clearTimeout(request.timeout);
    if (message.error) request.reject(Error(message.error.message)); else request.resolve(message.result);
  });
  send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timeout = setTimeout(() => { pending.delete(id); reject(Error(`Timed out: ${method}`)); }, 30000);
    pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 1250, deviceScaleFactor: 1, mobile: false });
  const url = pathToFileURL(html).href;
  await send("Page.navigate", { url });
  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt++) {
    await sleep(50);
    const state = await send("Runtime.evaluate", { expression: `location.href === ${JSON.stringify(url)} && document.readyState === 'complete' && document.fonts.status === 'loaded'`, returnByValue: true });
    ready = state.result?.value === true;
  }
  if (!ready) throw Error("Manual HTML or embedded fonts did not finish loading.");
  const measured = await send("Runtime.evaluate", { expression: `JSON.stringify([...document.querySelectorAll('.sheet')].map(sheet => ({ page:Number(sheet.dataset.page), id:sheet.id, overflow:sheet.querySelector('.content').scrollHeight-sheet.querySelector('.content').clientHeight, horizontal:sheet.querySelector('.content').scrollWidth-sheet.querySelector('.content').clientWidth, links:[...sheet.querySelectorAll('a[href^="#"]')].every(a=>document.getElementById(a.hash.slice(1))), text:sheet.querySelector('.content').innerText.length })))`, returnByValue: true });
  const pages = JSON.parse(measured.result.value);
  const failures = pages.filter(page => page.overflow > 2 || page.horizontal > 2 || !page.links || page.text < 100);
  if (failures.length) throw Error(`Manual page layout failed: ${JSON.stringify(failures)}`);
  if (imagesOnly) {
    await exportImages(pages);
  } else {
  const printed = await send("Page.printToPDF", { printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0, generateTaggedPDF: true, generateDocumentOutline: true });
  const pdf = await PDFDocument.load(Buffer.from(printed.data, "base64"));
  if (pdf.getPageCount() !== pages.length) throw Error(`Expected ${pages.length} PDF pages; found ${pdf.getPageCount()}.`);
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    if (Math.abs(width - 595.28) > 1 || Math.abs(height - 841.89) > 1) throw Error("Unexpected PDF paper size.");
  }
  pdf.setTitle("MarVille Resort Complex — User Manual");
  pdf.setAuthor("MarVille Resort Complex");
  pdf.setSubject(`Guest, cashier, manager and administrator account guide — ${edition}`);
  pdf.setKeywords(["MarVille Resort", "user manual", "guest", "cashier", "manager", "administrator"]);
  const pdfBytes = await pdf.save();
  try { writeFileSync(destination, pdfBytes); }
  catch (error) {
    if (error.code !== "EBUSY") throw error;
    destination = join(docs, "USER_MANUAL_UPDATED.pdf");
    writeFileSync(destination, pdfBytes);
    console.log("USER_MANUAL.pdf is locked by another application; saved the revised copy as USER_MANUAL_UPDATED.pdf.");
  }
  const previews = resolve(docs, "../.next/manual-preview"); mkdirSync(previews, { recursive: true });
  for (const id of ["cover", "contents", "guest-agreements-documents", "cashier-payments", "cashier-public-access", "manager-refunds", "admin-legal-policies", "calendar-notifications"]) {
    const result = await send("Runtime.evaluate", { expression: `JSON.stringify((()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1};})())`, returnByValue: true });
    const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: JSON.parse(result.result.value) });
    writeFileSync(join(previews, `${id}.png`), Buffer.from(screenshot.data, "base64"));
    if (id === "cover") writeFileSync(join(docs, "USER_MANUAL_PREVIEW.png"), Buffer.from(screenshot.data, "base64"));
  }
  console.log(`Created ${destination}: ${pdf.getPageCount()} A4 pages, ${Math.round(readFileSync(destination).length / 1024)} KB.`);
  console.log(`Validated every page for overflow and internal links; PDF outline ${pdf.catalog.has(PDFName.of("Outlines")) ? "present" : "not supplied by browser"}.`);
  console.log(`Preview images: ${previews}`);
  }
} finally {
  if (send && socket?.readyState === WebSocket.OPEN) await send("Browser.close").catch(() => {});
  socket?.close(); browser.kill();
  // Delete only the unique temporary profile created above, within the OS temp directory.
  if (dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith("marville-manual-")) {
    await sleep(300); try { rmSync(profile, { recursive: true, force: true }); } catch { /* A browser subprocess may still hold a temporary file. */ }
  }
}
