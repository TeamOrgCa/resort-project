"""Build the role-based HTML and PDF manual without downloading dependencies.

Run: python docs/build-user-manual-pdf.py
Requires Node.js, installed project dependencies and a local Chromium browser.
Use --html-only to build just the self-contained HTML.
"""

import argparse
import base64
import importlib.util
from html import escape
from pathlib import Path
import re
import subprocess
import sys


DOCS = Path(__file__).resolve().parent
ROOT = DOCS.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--html-only", action="store_true")
    args = parser.parse_args()
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("manual_markdown", DOCS / "build-user-manual.py")
    renderer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(renderer)
    source = (DOCS / "USER_MANUAL_ALL_ROLES.md").read_text(encoding="utf-8")
    chunks = re.split(r"<!-- page: ([a-z-]+) \| ([^>]+) -->", source)
    pages = [(chunks[i], chunks[i + 1].strip(), chunks[i + 2].strip()) for i in range(1, len(chunks), 3)]
    if not pages or len({key for key, _, _ in pages}) != len(pages):
        raise ValueError("Manual page identifiers must be present and unique.")

    sections = []
    for label in ["Guest account", "Cashier account", "Manager account", "Administrator account", "Shared reference"]:
        matches = [(index + 1, key) for index, (key, section, _) in enumerate(pages) if section == label]
        sections.append((label, matches[0][1], matches[0][0], matches[-1][0]))
    contents = '<table class="contents"><thead><tr><th>Guide</th><th>Pages</th></tr></thead><tbody>' + "".join(
        f'<tr><td><a href="#{key}">{label}</a></td><td>{start}–{end}</td></tr>'
        for label, key, start, end in sections
    ) + "</tbody></table>"

    font = base64.b64encode((ROOT / "assets/fonts/NotoSans-Regular.ttf").read_bytes()).decode()
    logo = base64.b64encode((ROOT / "public/website_logo_transparent.png").read_bytes()).decode()
    sheets = []
    for index, (key, section, body) in enumerate(pages, 1):
        body = renderer.markdown(body, key).replace("<p>CONTENTS_TABLE</p>", contents)
        if key == "cover":
            body = f'<div class="logo-window"><img alt="MarVille Resort logo" src="data:image/png;base64,{logo}"></div><p class="eyebrow">Operations &amp; account guide</p>' + body
        sheets.append(f'''<section id="{key}" class="sheet {"cover" if key == "cover" else ""}" data-page="{index}">
<div class="running-header"><span>MARVILLE RESORT COMPLEX</span><span>{escape(section)}</span></div>
<main class="content">{body}</main>
<footer><span>User manual · 11 November 2026</span><span>{index:02d} / {len(pages):02d}</span></footer>
</section>''')

    css = """
@font-face { font-family: Manual; src: url(data:font/ttf;base64,FONT_DATA) format('truetype'); font-display: block; }
:root { color-scheme: light; --ink: #293b32; --green: #315e48; --clay: #9b4934; --line: #d6dfd6; }
* { box-sizing: border-box; }
html { scroll-behavior: auto; }
body { margin: 0; background: #e5e9e3; color: var(--ink); font: 10pt/1.45 Manual, Arial, sans-serif; }
.sheet { position: relative; width: 210mm; height: 297mm; margin: 20px auto; padding: 22mm 19mm 21mm; background: white; box-shadow: 0 4px 24px #0001; break-after: page; }
.sheet:last-child { break-after: auto; }
.content { height: 254mm; }
.running-header { position: absolute; left: 19mm; right: 19mm; top: 10mm; display: flex; justify-content: space-between; align-items: center; padding-bottom: 7px; border-bottom: 1px solid var(--line); color: #607064; font-size: 7.2pt; letter-spacing: .7px; }
.running-header span:first-child { color: var(--green); font-weight: bold; }
footer { position: absolute; left: 19mm; right: 19mm; bottom: 10mm; display: flex; justify-content: space-between; border-top: 1px solid var(--line); padding-top: 7px; color: #607064; font-size: 7.5pt; }
footer span:last-child { color: var(--green); font-weight: bold; }
h1 { margin: 0 0 15px; color: var(--green); font-size: 24pt; line-height: 1.15; letter-spacing: -.7px; }
h2 { margin: 19px 0 9px; font-size: 13.5pt; line-height: 1.3; color: var(--clay); }
h1 + h2 { margin-top: 0; }
p { margin: 9px 0; }
ol, ul { margin: 8px 0 12px; padding-left: 22px; }
li { margin: 0 0 7px; padding-left: 3px; }
li::marker { color: var(--green); font-weight: bold; }
strong { font-weight: bold; color: #203d2d; }
code { font-family: Manual, Arial, sans-serif; font-size: 9pt; background: #edf3ed; padding: 1px 4px; border-radius: 3px; overflow-wrap: anywhere; }
a { color: var(--green); text-decoration: none; }
.table-wrap { margin: 11px 0 16px; }
table { border-collapse: collapse; width: 100%; font-size: 9.3pt; line-height: 1.4; table-layout: fixed; }
th, td { border: 1px solid var(--line); padding: 8px 10px; vertical-align: top; text-align: left; overflow-wrap: anywhere; }
th { background: #eaf1e9; color: var(--green); font-weight: bold; }
tbody tr:nth-child(even) { background: #f7f9f5; }
th:first-child, td:first-child { width: 34%; }
.contents th:first-child, .contents td:first-child { width: 83%; }
.contents td:last-child, .contents th:last-child { text-align: right; }
.contents td { padding-top: 9px; padding-bottom: 9px; }
.cover { border-top: 6mm solid var(--green); padding-top: 29mm; background: linear-gradient(145deg, white 58%, #edf3e9); }
.cover .running-header { display: none; }
.cover .content { height: 239mm; }
.logo-window { width: 300px; height: 100px; overflow: hidden; margin-bottom: 34px; }
.logo-window img { width: 300px; height: 300px; display: block; transform: translateY(-108px); }
.eyebrow { color: var(--clay); font-size: 8pt; letter-spacing: 2px; text-transform: uppercase; margin: 0 0 15px; }
.cover h1 { font-size: 22pt; margin-bottom: 12px; }
.cover h2 { color: var(--green); font-size: 45pt; line-height: 1.1; letter-spacing: -1.7px; margin: 0 0 20px; }
.cover h2 + p { font-size: 12pt; line-height: 1.6; color: var(--clay); margin-bottom: 24px; }
.cover p { max-width: 145mm; margin-bottom: 16px; }
@page { size: A4; margin: 0; }
@media print { body { background: white; } .sheet { margin: 0; box-shadow: none; } a { color: inherit; } }
""".replace("FONT_DATA", font)
    document = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>MarVille Resort Complex | User manual</title><style>' + css + '</style></head><body>' + "\n".join(sheets) + '</body></html>'
    check = renderer.LinkCheck()
    check.feed(document)
    missing = set(check.links) - check.ids
    if missing:
        raise ValueError(f"Missing internal links: {sorted(missing)}")
    (DOCS / "USER_MANUAL_ALL_ROLES.html").write_text(document, encoding="utf-8")
    print(f"Built {len(pages)} role-based manual pages; internal links validated.", flush=True)
    if not args.html_only:
        subprocess.run(["node", str(DOCS / "export-user-manual-pdf.mjs")], check=True, cwd=ROOT)


if __name__ == "__main__":
    main()
