"""Build the offline, printable user manual from its two Markdown guides.

Uses only the standard library. Supports the headings, paragraphs, tables,
lists and inline formatting used in these documents; it is not a general
Markdown parser. Run from any directory with: python docs/build-user-manual.py
"""

from html import escape
from html.parser import HTMLParser
from pathlib import Path
import re


DOCS = Path(__file__).resolve().parent
TOKEN = re.compile(r"(`[^`]+`|\*\*.+?\*\*|\[[^\]]+\]\([^)]+\))")
LIST = re.compile(r"^(\s*)([-*]|\d+\.)\s+(.*)$")


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def inline(text, prefix):
    parts = []
    for index, token in enumerate(TOKEN.split(text)):
        if index % 2 == 0:
            parts.append(escape(token))
        elif token.startswith("`"):
            parts.append(f"<code>{escape(token[1:-1])}</code>")
        elif token.startswith("**"):
            parts.append(f"<strong>{inline(token[2:-2], prefix)}</strong>")
        else:
            label, href = re.fullmatch(r"\[([^\]]+)\]\(([^)]+)\)", token).groups()
            if href.startswith("#"):
                href = f"#{prefix}-{href[1:]}"
            else:
                href = {
                    "CLIENT_USER_MANUAL.md": "#client",
                    "ADMIN_USER_MANUAL.md": "#admin",
                    "USER_MANUAL.md": "#manual-overview",
                }.get(href, href)
            parts.append(f'<a href="{escape(href, quote=True)}">{inline(label, prefix)}</a>')
    return "".join(parts)


def list_block(lines, index, prefix):
    first = LIST.match(lines[index])
    indent = len(first[1])
    ordered = first[2].endswith(".")
    tag = "ol" if ordered else "ul"
    start = f' start="{int(first[2][:-1])}"' if ordered and first[2] != "1." else ""
    parts = [f"<{tag}{start}>"]
    while index < len(lines):
        match = LIST.match(lines[index])
        if not match or len(match[1]) != indent or match[2].endswith(".") != ordered:
            break
        parts.append(f"<li>{inline(match[3], prefix)}")
        index += 1
        while index < len(lines):
            child = LIST.match(lines[index])
            if not child or len(child[1]) <= indent:
                break
            html, index = list_block(lines, index, prefix)
            parts.append(html)
        parts.append("</li>")
    parts.append(f"</{tag}>")
    return "\n".join(parts), index


def markdown(source, prefix):
    lines = source.splitlines()
    parts, paragraphs = [], []
    index = 0

    def flush():
        if paragraphs:
            body = "".join(inline(line.rstrip(), prefix) + ("<br>" if line.endswith("  ") else " ") for line in paragraphs)
            parts.append(f"<p>{body.rstrip()}</p>")
            paragraphs.clear()

    while index < len(lines):
        line = lines[index]
        if not line.strip():
            flush()
            index += 1
            continue
        heading = re.match(r"^(#{1,6})\s+(.+)$", line)
        if heading:
            flush()
            level, title = len(heading[1]), heading[2]
            parts.append(f'<h{level} id="{prefix}-{slug(title)}">{inline(title, prefix)}</h{level}>')
        elif line.startswith("|") and index + 1 < len(lines) and re.fullmatch(r"[\s|:\-]+", lines[index + 1]):
            flush()
            cells = lambda row: [inline(cell.strip(), prefix) for cell in row.strip().strip("|").split("|")]
            headers = cells(line)
            parts.append('<div class="table-wrap"><table><thead><tr>' + "".join(f'<th scope="col">{cell}</th>' for cell in headers) + "</tr></thead><tbody>")
            index += 2
            while index < len(lines) and lines[index].startswith("|"):
                row = cells(lines[index])
                if len(row) != len(headers):
                    raise ValueError(f"Table column mismatch in {prefix}: {lines[index]}")
                parts.append("<tr>" + "".join(f"<td>{cell}</td>" for cell in row) + "</tr>")
                index += 1
            parts.append("</tbody></table></div>")
            continue
        elif LIST.match(line):
            flush()
            html, index = list_block(lines, index, prefix)
            parts.append(html)
            continue
        else:
            paragraphs.append(line)
        index += 1
    flush()
    return "\n".join(parts)


class LinkCheck(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids, self.links = set(), []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            if attrs["id"] in self.ids:
                raise ValueError(f'Duplicate anchor: {attrs["id"]}')
            self.ids.add(attrs["id"])
        if tag == "a" and attrs.get("href", "").startswith("#"):
            self.links.append(attrs["href"][1:])


def main():
    client = markdown((DOCS / "CLIENT_USER_MANUAL.md").read_text(encoding="utf-8"), "client")
    admin = markdown((DOCS / "ADMIN_USER_MANUAL.md").read_text(encoding="utf-8"), "admin")
    template = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MarVille Resort Complex - Client and Admin User Manual</title>
<style>
:root { color-scheme: only light; --ink: #3b2a1e; --brand: #a9442b; --green: #2f6b3f; --paper: #f8f4ec; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.7; }
a { color: var(--brand); text-underline-offset: 3px; }
.toolbar { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px max(20px, calc((100vw - 1080px) / 2)); background: #fff; border-bottom: 1px solid #e6ddd2; }
.toolbar nav { display: flex; flex-wrap: wrap; gap: 18px; }
.toolbar button { border: 0; border-radius: 8px; background: var(--brand); color: #fff; padding: 11px 16px; cursor: pointer; font: inherit; font-weight: bold; }
main { max-width: 1080px; margin: 32px auto; padding: 0 20px; }
.cover, .manual-section { background: #fff; border: 1px solid #e6ddd2; border-radius: 16px; padding: 36px 42px; margin-bottom: 28px; }
.cover { border-top: 6px solid var(--brand); }
.eyebrow { color: var(--green); font-size: 12px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; }
h1 { font-size: 30px; line-height: 1.25; margin: 12px 0 20px; }
h2 { margin-top: 38px; padding-top: 16px; border-top: 1px solid #e6ddd2; font-size: 22px; line-height: 1.35; color: var(--brand); }
h3 { font-size: 17px; line-height: 1.4; margin-top: 25px; }
h1, h2, h3, section { scroll-margin-top: 90px; }
p { margin: 12px 0; }
li { margin: 5px 0; }
ol, ul { padding-left: 24px; }
li ul, li ol { margin-top: 6px; }
code { background: #f5f1ec; border-radius: 4px; padding: 2px 5px; font-size: .92em; overflow-wrap: anywhere; }
.table-wrap { width: 100%; overflow-x: auto; margin: 20px 0; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { border: 1px solid #e6ddd2; padding: 11px 13px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th { background: #f4eee7; font-weight: bold; }
tbody tr:nth-child(even) { background: #fcfaf7; }
.guide-links { display: flex; flex-wrap: wrap; gap: 12px; margin: 22px 0; }
.guide-links a { border: 1px solid #e6ddd2; border-radius: 8px; padding: 10px 16px; font-weight: bold; text-decoration: none; }
.hint { color: #726255; font-size: 13px; }
footer { padding: 15px 20px 35px; text-align: center; color: #726255; font-size: 12px; }
@media (max-width: 640px) { main { margin-top: 18px; padding: 0 12px; } .cover, .manual-section { padding: 22px 18px; } h1 { font-size: 25px; } .toolbar { align-items: flex-start; padding: 12px; } .toolbar nav { gap: 10px; font-size: 13px; } .toolbar button { font-size: 12px; padding: 9px; } table { min-width: 520px; } }
@page { size: A4; margin: 16mm; }
@media print {
body { background: #fff; color: #000; font-size: 10pt; line-height: 1.5; }
.toolbar, .guide-links, .print-hint { display: none; }
main { max-width: none; margin: 0; padding: 0; }
.cover, .manual-section { border: 0; border-radius: 0; margin: 0; padding: 0; }
.cover { break-after: page; padding-top: 25mm; }
#admin { break-before: page; }
h1 { font-size: 23pt; } h2 { font-size: 15pt; } h3 { font-size: 12pt; }
h1, h2, h3 { break-after: avoid; color: #000; }
a { color: #000; } .table-wrap { overflow: visible; }
table { min-width: 0; font-size: 9pt; table-layout: fixed; }
thead { display: table-header-group; } tr { break-inside: avoid; }
th, td { padding: 6px 8px; } footer { padding: 8mm 0 0; }
}
</style>
</head>
<body>
<div class="toolbar">
  <nav aria-label="Manual navigation"><a href="#manual-overview">Overview</a><a href="#client">Client guide</a><a href="#admin">Admin guide</a></nav>
  <button type="button" onclick="window.print()">Print / Save as PDF</button>
</div>
<main>
<header id="manual-overview" class="cover">
  <p class="eyebrow">MarVille Resort Complex</p>
  <h1>Client and Admin User Manual</h1>
  <p>Step-by-step instructions for guests, administrators, managers and cashiers.</p>
  <p><strong>Updated:</strong> 13 October 2026</p>
  <div class="guide-links"><a href="#client">Open client guide</a><a href="#admin">Open admin guide</a></div>
  <p>Use the website address provided by the resort. Follow the displayed prices, deadlines, policies and success/error messages. Booking schedules and receipt validation use Philippine time.</p>
  <p>The guides describe the current application and identify older demonstration screens. They contain no account credentials or private configuration values.</p>
  <p class="hint print-hint">This document works offline. Select Print / Save as PDF, then choose a printer or your browser's PDF destination.</p>
</header>
<section id="client" class="manual-section" aria-label="Client user manual">CLIENT_CONTENT</section>
<section id="admin" class="manual-section" aria-label="Admin and staff user manual">ADMIN_CONTENT</section>
</main>
<footer>MarVille Resort Complex · User Manual · Updated 13 October 2026</footer>
</body>
</html>
"""
    document = template.replace("CLIENT_CONTENT", client).replace("ADMIN_CONTENT", admin)
    check = LinkCheck()
    check.feed(document)
    missing = set(check.links) - check.ids
    if missing:
        raise ValueError(f"Missing navigation targets: {sorted(missing)}")
    output = DOCS / "USER_MANUAL.html"
    output.write_text(document, encoding="utf-8")
    print(f"Built {output.name}; checked {len(check.links)} internal links and {len(check.ids)} anchors.")


if __name__ == "__main__":
    main()
