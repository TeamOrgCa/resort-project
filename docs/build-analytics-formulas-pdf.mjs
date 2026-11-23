// Offline: node docs/build-analytics-formulas-pdf.mjs
// Regenerate the PDF directly from ANALYTICS_FORMULAS.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";

const directory = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(directory, "ANALYTICS_FORMULAS.md"), "utf8");
const pdf = await PDFDocument.create();
const fonts = {
  regular: await pdf.embedFont(StandardFonts.Helvetica),
  bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  mono: await pdf.embedFont(StandardFonts.Courier),
};
const ink = "#263D34", green = "#315E48", muted = "#607064", line = "#D6DFD6", light = "#F0F5EF";
const width = 595.28, height = 841.89, margin = 43, contentWidth = width - margin * 2, bottom = height - 53;
const color = hex => rgb(...hex.slice(1).match(/../g).map(part => parseInt(part, 16) / 255));
const escape = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const plain = value => value.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
const pages = [];
let page, top, section = "Analytics formulas";
function rect(x, y, w, h, fill, stroke) {
  page.pdf.drawRectangle({ x, y: height - y - h, width: w, height: h, color: color(fill), ...(stroke ? { borderColor: color(stroke), borderWidth: .6 } : {}) });
  page.svg.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${stroke ? `stroke="${stroke}" stroke-width=".6"` : ""}/>`);
}
function text(value, x, y, size = 10, font = "regular", fill = ink) {
  const measured = fonts[font].widthOfTextAtSize(value, size);
  if (x + measured > width - margin + 1 || y + size > bottom + 1 || x < margin - 1) throw Error(`Text exceeds the page: ${value}`);
  page.pdf.drawText(value, { x, y: height - y - size, size, font: fonts[font], color: color(fill) });
  page.svg.push(`<text x="${x}" y="${y + size}" font-family="${font === "mono" ? "monospace" : "Arial, sans-serif"}" font-size="${size}" font-weight="${font === "bold" ? "700" : "400"}" fill="${fill}">${escape(value)}</text>`);
}
function newPage(continuation = false) {
  page = { pdf: pdf.addPage([width, height]), svg: [], blocks: 0 };
  pages.push(page); top = 70;
  rect(0, 0, width, 7, green);
  text("MARVILLE RESORT COMPLEX", margin, 27, 9, "bold", green);
  text("ANALYTICS FORMULAS", width - margin - 118, 28, 8, "regular", muted);
  rect(margin, 48, contentWidth, .7, line);
  if (continuation) { text(`${section} (continued)`, margin, top, 12, "bold", green); top += 28; }
}
function reserve(blockHeight) { if (top + blockHeight > bottom) newPage(true); }
function wrap(value, maxWidth, size, font = "regular") {
  const lines = []; let current = "";
  for (const word of value.split(/\s+/).filter(Boolean)) {
    if (current && fonts[font].widthOfTextAtSize(`${current} ${word}`, size) > maxWidth) { lines.push(current); current = ""; }
    if (fonts[font].widthOfTextAtSize(word, size) > maxWidth) {
      for (const letter of word) {
        if (fonts[font].widthOfTextAtSize(current + letter, size) > maxWidth) { lines.push(current); current = ""; }
        current += letter;
      }
    } else current = current ? `${current} ${word}` : word;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}
function paragraph(value, { size = 9.7, font = "regular", indent = 0, gap = 8 } = {}) {
  const lines = wrap(plain(value), contentWidth - indent, size, font), leading = size * 1.43;
  reserve(lines.length * leading + gap);
  for (const item of lines) { reserve(leading); text(item, margin + indent, top, size, font); top += leading; }
  top += gap; page.blocks++;
}
function heading(value, level) {
  if (level === 1) {
    text("Resort Booking and Reservation Management System", margin, top, 10, "regular", muted); top += 27;
    paragraph("Analytics formulas", { size: 25, font: "bold", gap: 8 }); return;
  }
  if (level === 2) section = value;
  if (level === 2 && !["Dates, comparisons and rounding", "Guest feedback"].includes(value)) newPage();
  if (top + (value === "Guest feedback" ? 150 : 76) > bottom) newPage();
  top += level === 2 ? 6 : 4;
  paragraph(value, { size: level === 2 ? 16 : 11.5, font: "bold", gap: 7 });
}
function formula(lines) {
  const size = 8.6, leading = 12.8;
  const wrapped = lines.flatMap(value => wrap(value, contentWidth - 24, size, "mono"));
  const h = wrapped.length * leading + 22;
  reserve(h + 8); rect(margin, top, contentWidth, h, light, line);
  for (const value of wrapped) { text(value, margin + 12, top + 10, size, "mono"); top += leading; }
  top += 30; page.blocks++;
}
function table(rows) {
  const columns = [contentWidth * .36, contentWidth * .64], size = 9.1, leading = 12.6;
  const renderRow = (cells, header = false) => {
    const font = header ? "bold" : "regular";
    const lines = cells.map((cell, i) => wrap(plain(cell), columns[i] - 18, size, font));
    const h = Math.max(...lines.map(items => items.length)) * leading + 14;
    if (!header && top + h > bottom) { newPage(true); renderRow(rows[0], true); }
    reserve(h);
    let x = margin;
    for (let i = 0; i < cells.length; i++) {
      rect(x, top, columns[i], h, header ? light : "#FFFFFF", line);
      lines[i].forEach((value, index) => text(value, x + 9, top + 7 + index * leading, size, font, header ? green : ink));
      x += columns[i];
    }
    top += h; page.blocks++;
  };
  reserve(85);
  rows.forEach((cells, i) => renderRow(cells, i === 0));
  top += 12;
}

newPage();
const lines = source.split(/\r?\n/);
for (let index = 0; index < lines.length;) {
  const value = lines[index];
  if (!value.trim()) { index++; continue; }
  if (value.startsWith("```")) {
    const code = []; index++;
    while (index < lines.length && !lines[index].startsWith("```")) code.push(lines[index++]);
    formula(code); index++; continue;
  }
  const title = /^(#{1,3})\s+(.+)$/.exec(value);
  if (title) { heading(title[2], title[1].length); index++; continue; }
  if (value.startsWith("|")) {
    const rows = [];
    while (index < lines.length && lines[index].startsWith("|")) {
      if (!/^\|[\s|:-]+$/.test(lines[index])) rows.push(lines[index].trim().slice(1, -1).split("|").map(cell => cell.trim()));
      index++;
    }
    table(rows); continue;
  }
  if (value.startsWith("- ")) { paragraph(`- ${value.slice(2)}`, { indent: 8, gap: 4 }); index++; continue; }
  const body = [value]; index++;
  while (index < lines.length && lines[index].trim() && !/^(#|\||```|- )/.test(lines[index])) body.push(lines[index++]);
  paragraph(body.join(" "));
}
for (const [index, item] of pages.entries()) {
  if (!item.blocks) throw Error(`Empty page ${index + 1}`);
  page = item;
  rect(margin, height - 39, contentWidth, .7, line);
  // Footer intentionally has no capture or edition date.
  const foot = "Analytics formula reference", ref = `F${index + 1}`;
  item.pdf.drawText(foot, { x: margin, y: 23, size: 8, font: fonts.regular, color: color(muted) });
  item.pdf.drawText(ref, { x: width - margin - fonts.bold.widthOfTextAtSize(ref, 8), y: 23, size: 8, font: fonts.bold, color: color(green) });
  item.svg.push(`<text x="${margin}" y="${height - 23}" font-family="Arial,sans-serif" font-size="8" fill="${muted}">${foot}</text><text x="${width - margin}" y="${height - 23}" text-anchor="end" font-family="Arial,sans-serif" font-size="8" fill="${green}">${ref}</text>`);
}
pdf.setTitle("MarVille Resort Complex - Analytics Formulas");
pdf.setAuthor("MarVille Resort Complex");
pdf.setSubject("Booking, collection forecast, operations and guest feedback calculations");
const output = path.join(directory, "ANALYTICS_FORMULAS.pdf");
fs.writeFileSync(output, await pdf.save());
const check = await PDFDocument.load(fs.readFileSync(output));
if (check.getPageCount() !== pages.length) throw Error("PDF page count mismatch");
const previewDirectory = path.resolve(directory, "../.next/analytics-formulas-preview");
fs.mkdirSync(previewDirectory, { recursive: true });
for (const [index, item] of pages.entries()) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/>${item.svg.join("")}</svg>`;
  await sharp(Buffer.from(svg), { density: 144 }).png().toFile(path.join(previewDirectory, `F${index + 1}.png`));
}
console.log(`Created ${output}: ${pages.length} A4 pages, ${Math.round(fs.statSync(output).size / 1024)} KB. Text bounds validated on every page.`);
console.log(`Layout previews: ${previewDirectory}`);
