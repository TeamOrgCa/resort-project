// Print the self-contained role manual using a local headless Chromium browser.
// Run python docs/build-user-manual-pdf.py to build both HTML and PDF.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PDFDocument, PDFName } from "pdf-lib";

const docs = dirname(fileURLToPath(import.meta.url));
const html = join(docs, "USER_MANUAL_ALL_ROLES.html");
const destination = join(docs, "USER_MANUAL.pdf");
const browserPath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(path => path && existsSync(path));
if (!browserPath) throw Error("Set CHROME_PATH to an installed Chromium browser.");
if (!existsSync(html)) throw Error("Build the role manual HTML first.");
const profile = mkdtempSync(join(tmpdir(), "marville-manual-"));
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
  const printed = await send("Page.printToPDF", { printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0, generateTaggedPDF: true, generateDocumentOutline: true });
  const pdf = await PDFDocument.load(Buffer.from(printed.data, "base64"));
  if (pdf.getPageCount() !== pages.length) throw Error(`Expected ${pages.length} PDF pages; found ${pdf.getPageCount()}.`);
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    if (Math.abs(width - 595.28) > 1 || Math.abs(height - 841.89) > 1) throw Error("Unexpected PDF paper size.");
  }
  pdf.setTitle("MarVille Resort Complex — User Manual");
  pdf.setAuthor("MarVille Resort Complex");
  pdf.setSubject("Guest, cashier, manager and administrator account guide — 11 November 2026");
  pdf.setKeywords(["MarVille Resort", "user manual", "guest", "cashier", "manager", "administrator"]);
  writeFileSync(destination, await pdf.save());
  const previews = resolve(docs, "../.next/manual-preview"); mkdirSync(previews, { recursive: true });
  for (const id of ["cover", "contents", "manager-refunds", "admin-accounts"]) {
    const result = await send("Runtime.evaluate", { expression: `JSON.stringify((()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1};})())`, returnByValue: true });
    const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: JSON.parse(result.result.value) });
    writeFileSync(join(previews, `${id}.png`), Buffer.from(screenshot.data, "base64"));
  }
  console.log(`Created ${destination}: ${pdf.getPageCount()} A4 pages, ${Math.round(readFileSync(destination).length / 1024)} KB.`);
  console.log(`Validated every page for overflow and internal links; PDF outline ${pdf.catalog.has(PDFName.of("Outlines")) ? "present" : "not supplied by browser"}.`);
  console.log(`Preview images: ${previews}`);
} finally {
  if (send && socket?.readyState === WebSocket.OPEN) await send("Browser.close").catch(() => {});
  socket?.close(); browser.kill();
  // Delete only the unique temporary profile created above, within the OS temp directory.
  if (dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith("marville-manual-")) {
    await sleep(300); try { rmSync(profile, { recursive: true, force: true }); } catch { /* A browser subprocess may still hold a temporary file. */ }
  }
}
