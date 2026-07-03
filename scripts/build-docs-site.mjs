#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DOCS_DIR = join(ROOT, "docs");
const OUT_DIR = join(ROOT, "site", "docs");

// The site's information architecture: an ordered list of sections, each an
// ordered list of doc paths relative to docs/. This is the single source of
// truth for both the nav order and which docs are published — anything under
// docs/internal/ is absent here and therefore never rendered to the site.
const NAV_SECTIONS = Object.freeze([
  {
    section: "Start here",
    items: ["guide/01-getting-started.md", "guide/02-install.md", "guide/03-install-hook.md"],
  },
  {
    section: "Using it",
    items: [
      "guide/04-read-a-receipt.md",
      "guide/05-compare.md",
      "guide/06-week.md",
      "guide/07-statusline.md",
      "guide/08-budget.md",
      "guide/09-handoff.md",
      "guide/10-templates.md",
      "guide/11-share-and-export.md",
    ],
  },
  {
    section: "Reference",
    items: [
      "guide/12-troubleshooting.md",
      "json-schema.md",
      "statusline.md",
      "pr-receipts.md",
      "telemetry.md",
    ],
  },
  {
    section: "Why",
    items: ["guide/13-pricing.md", "guide/14-session-attribution.md"],
  },
]);

// Directories under docs/ that are intentionally never published to the site.
const EXCLUDED_DIRS = Object.freeze(["internal", "spikes"]);

const RESOURCE_LOAD_PATTERNS = [
  /<script\b[^>]*\bsrc=["']https?:/iu,
  /<link\b[^>]*\bhref=["']https?:/iu,
  /<img\b[^>]*\bsrc=["']https?:/iu,
  /<iframe\b[^>]*\bsrc=["']https?:/iu,
  /\bsrcset=["'][^"']*https?:/iu,
  /@import\s+(?:url\()?["']?https?:/iu,
  /url\(\s*["']?https?:/iu,
];

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function stripInlineMarkdown(value) {
  return value
    .replace(/`([^`]*)`/gu, "$1")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .trim();
}

function slugify(value, seen) {
  const base = stripInlineMarkdown(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/gu, "")
    .trim()
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-") || "section";
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

function normalizeHref(href) {
  const [pathPart, fragment = ""] = href.split("#", 2);
  const hash = fragment === "" ? "" : `#${fragment}`;
  if (/^(?:https?:|mailto:|#)/iu.test(href)) return href;
  if (pathPart.endsWith(".md")) return `${basename(pathPart, ".md")}.html${hash}`;
  return `${pathPart}${hash}`;
}

function findClosingParen(value, start) {
  let escaped = false;
  for (let index = start; index < value.length; index++) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === ")") return index;
  }
  return -1;
}

function findClosingMarker(value, start, marker) {
  let escaped = false;
  for (let index = start; index < value.length; index++) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === marker) return index;
  }
  return -1;
}

function renderInline(value) {
  let html = "";
  for (let index = 0; index < value.length;) {
    if (value.startsWith("`", index)) {
      const end = value.indexOf("`", index + 1);
      if (end !== -1) {
        html += `<code>${escapeHtml(value.slice(index + 1, end))}</code>`;
        index = end + 1;
        continue;
      }
    }

    if (value.startsWith("**", index)) {
      const end = value.indexOf("**", index + 2);
      if (end !== -1) {
        html += `<strong>${renderInline(value.slice(index + 2, end))}</strong>`;
        index = end + 2;
        continue;
      }
    }

    if (value[index] === "*" && value[index + 1] !== "*") {
      const end = findClosingMarker(value, index + 1, "*");
      if (end !== -1) {
        html += `<em>${renderInline(value.slice(index + 1, end))}</em>`;
        index = end + 1;
        continue;
      }
    }

    if (value[index] === "[") {
      const closeLabel = value.indexOf("]", index + 1);
      if (closeLabel !== -1 && value[closeLabel + 1] === "(") {
        const closeHref = findClosingParen(value, closeLabel + 2);
        if (closeHref !== -1) {
          const label = value.slice(index + 1, closeLabel);
          const href = normalizeHref(value.slice(closeLabel + 2, closeHref));
          html += `<a href="${escapeAttr(href)}">${renderInline(label)}</a>`;
          index = closeHref + 1;
          continue;
        }
      }
    }

    if (value[index] === "\\" && index + 1 < value.length) {
      html += escapeHtml(value[index + 1]);
      index += 2;
      continue;
    }

    html += escapeHtml(value[index]);
    index++;
  }
  return html;
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(line);
}

function splitTableRow(line) {
  const trimmed = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  const cells = [];
  let current = "";
  let escaped = false;

  for (const char of trimmed) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function isBlockStart(line, nextLine) {
  return (
    /^#{1,6}\s+/u.test(line) ||
    /^```/u.test(line) ||
    /^\s{0,3}(?:[-*]\s+|\d+\.\s+)/u.test(line) ||
    (line.trim().startsWith("|") && nextLine !== undefined && isTableSeparator(nextLine)) ||
    /^>\s?/u.test(line) ||
    /^<!--.*-->$/u.test(line.trim())
  );
}

function renderList(lines, startIndex, ordered) {
  const tag = ordered ? "ol" : "ul";
  const itemPattern = ordered ? /^\s{0,3}\d+\.\s+(.*)$/u : /^\s{0,3}[-*]\s+(.*)$/u;
  const otherPattern = ordered ? /^\s{0,3}[-*]\s+/u : /^\s{0,3}\d+\.\s+/u;
  const items = [];
  let current = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    const match = itemPattern.exec(line);
    if (match) {
      if (current.length > 0) items.push(current.join(" "));
      current = [match[1].trim()];
      index++;
      continue;
    }
    if (line.trim() === "") break;
    if (otherPattern.test(line) || /^#{1,6}\s+/u.test(line) || /^```/u.test(line)) break;
    if (/^\s{2,}\S/u.test(line) && current.length > 0) {
      current.push(line.trim());
      index++;
      continue;
    }
    break;
  }

  if (current.length > 0) items.push(current.join(" "));
  const html = `<${tag}>\n${items.map((item) => `  <li>${renderInline(item)}</li>`).join("\n")}\n</${tag}>`;
  return { html, nextIndex: index };
}

function renderTable(lines, startIndex) {
  const header = splitTableRow(lines[startIndex]);
  const rows = [];
  let index = startIndex + 2;

  while (index < lines.length && lines[index].trim().startsWith("|")) {
    rows.push(splitTableRow(lines[index]));
    index++;
  }

  const headHtml = header.map((cell) => `<th>${renderInline(cell)}</th>`).join("");
  const rowsHtml = rows
    .map((row) => `    <tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`)
    .join("\n");
  return {
    html: `<div class="table-wrap"><table>\n  <thead><tr>${headHtml}</tr></thead>\n  <tbody>\n${rowsHtml}\n  </tbody>\n</table></div>`,
    nextIndex: index,
  };
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const blocks = [];
  const seenHeadings = new Map();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed === "") {
      index++;
      continue;
    }

    if (/^<!--.*-->$/u.test(trimmed)) {
      index++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/u.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = slugify(text, seenHeadings);
      blocks.push(`<h${level} id="${escapeAttr(id)}">${renderInline(text)}</h${level}>`);
      index++;
      continue;
    }

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code = [];
      index++;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index++;
      }
      if (index < lines.length) index++;
      const className = language === "" ? "" : ` class="language-${escapeAttr(language)}"`;
      blocks.push(`<pre class="doc-code"><code${className}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    if (trimmed.startsWith("|") && lines[index + 1] !== undefined && isTableSeparator(lines[index + 1])) {
      const table = renderTable(lines, index);
      blocks.push(table.html);
      index = table.nextIndex;
      continue;
    }

    if (/^\s{0,3}[-*]\s+/u.test(line)) {
      const list = renderList(lines, index, false);
      blocks.push(list.html);
      index = list.nextIndex;
      continue;
    }

    if (/^\s{0,3}\d+\.\s+/u.test(line)) {
      const list = renderList(lines, index, true);
      blocks.push(list.html);
      index = list.nextIndex;
      continue;
    }

    if (/^>\s?/u.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/u.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/u, "").trim());
        index++;
      }
      blocks.push(`<blockquote>${renderInline(quote.join(" "))}</blockquote>`);
      continue;
    }

    const paragraph = [trimmed];
    index++;
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !isBlockStart(lines[index], lines[index + 1])
    ) {
      paragraph.push(lines[index].trim());
      index++;
    }
    blocks.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }

  return blocks.join("\n\n");
}

function getTitle(markdown, fallback) {
  const line = markdown.split(/\r?\n/u).find((entry) => /^#\s+/u.test(entry));
  return line === undefined ? fallback : stripInlineMarkdown(line.replace(/^#\s+/u, ""));
}

function getExcerpt(markdown) {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const start = lines.findIndex((line) => /^#\s+/u.test(line));
  const afterTitle = start === -1 ? lines : lines.slice(start + 1);
  const paragraph = [];

  for (const line of afterTitle) {
    const trimmed = line.trim();
    if (trimmed === "" || /^<!--.*-->$/u.test(trimmed)) {
      if (paragraph.length > 0) break;
      continue;
    }
    if (isBlockStart(trimmed)) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(stripInlineMarkdown(trimmed));
  }

  const joined = paragraph.join(" ");
  if (joined.length <= 180) return joined;
  const cut = joined.slice(0, 180);
  // Prefer a whole sentence; fall back to a word boundary. Never cut mid-word.
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (sentence > 60) return cut.slice(0, sentence + 1);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

function css() {
  return `:root{
  --field:#e7ecef;
  --sheet:#ffffff;
  --ink:#14181c;
  --muted:#586570;
  --faint:#8a949c;
  --rule:#e3e8eb;
  --rule-strong:#c2cbd1;
  --seal:#b23a3a;
  --ledger:#2f5d3a;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,"Times New Roman",serif;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --mono:ui-monospace,"SF Mono","Cascadia Code","JetBrains Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0;
  background:var(--field);
  color:var(--ink);
  font-family:var(--sans);
  font-size:16px;
  line-height:1.6;
  padding:clamp(16px,3.5vw,40px) 16px clamp(40px,6vw,72px);
}
a{color:var(--ledger);text-underline-offset:2px;text-decoration-thickness:1px}
a:focus-visible{outline:2px solid var(--ledger);outline-offset:2px;border-radius:2px}
.sheet{
  width:100%;
  max-width:1040px;
  margin:0 auto;
  background:var(--sheet);
  border:1px solid var(--rule-strong);
  border-radius:3px;
  padding:clamp(20px,3.6vw,44px) clamp(18px,4vw,52px) clamp(28px,4vw,44px);
  box-shadow:0 1px 0 #fff inset,0 30px 64px -42px rgba(20,32,44,.42);
}
header.mast{padding-top:2px}
.masthead-row{
  display:flex;
  justify-content:space-between;
  align-items:baseline;
  gap:16px;
  font-family:var(--sans);
  font-size:11.5px;
  font-weight:700;
  letter-spacing:.26em;
  text-transform:uppercase;
  color:var(--faint);
}
.masthead-row .brand{color:var(--ink);letter-spacing:.30em;text-decoration:none}
.masthead-row nav{display:flex;gap:16px;flex-wrap:wrap;justify-content:flex-end}
.masthead-row nav a{color:var(--muted);letter-spacing:.12em;text-decoration:none}
.masthead-row nav a:hover{color:var(--ink)}
.rule2{
  margin:12px 0 0;
  height:0;
  border-top:3px solid var(--ink);
  box-shadow:0 5px 0 -4px var(--ink);
}
.doc-hero{padding:clamp(24px,4vw,38px) 0 clamp(20px,3vw,30px)}
.doc-label{
  display:flex;
  align-items:center;
  gap:14px;
  margin:0 0 16px;
  font-size:11.5px;
  font-weight:700;
  letter-spacing:.22em;
  text-transform:uppercase;
  color:var(--faint);
}
.doc-label::after{content:"";flex:1 1 auto;height:1px;background:var(--rule-strong)}
h1{
  font-family:var(--serif);
  font-size:clamp(30px,5vw,50px);
  line-height:1.1;
  font-weight:600;
  letter-spacing:0;
  margin:0;
  max-width:19ch;
}
.sub{
  color:var(--muted);
  font-size:clamp(15px,2.2vw,17.5px);
  max-width:58ch;
  margin:15px 0 0;
  line-height:1.55;
}
.doc-grid{
  display:grid;
  grid-template-columns:minmax(190px,240px) minmax(0,1fr);
  gap:clamp(24px,4vw,46px);
  border-top:1px solid var(--rule);
  padding-top:clamp(24px,4vw,38px);
}
.toc{
  align-self:start;
  position:sticky;
  top:18px;
  border-right:1px solid var(--rule);
  padding-right:20px;
}
.toc h2{
  margin:0 0 12px;
  color:var(--faint);
  font-size:11px;
  letter-spacing:.18em;
  text-transform:uppercase;
}
.toc-section{
  margin:18px 0 8px;
  color:var(--faint);
  font-size:10.5px;
  font-weight:700;
  letter-spacing:.16em;
  text-transform:uppercase;
}
.toc-section:first-of-type{margin-top:0}
.toc ol,.toc ul{list-style:none;margin:0;padding:0;display:grid;gap:9px}
.toc a{color:var(--muted);font-size:14px;text-decoration:none}
.toc a:hover{color:var(--ink);text-decoration:underline}
.doc-content{min-width:0}
.doc-content > :first-child{margin-top:0}
.doc-content h1{font-size:clamp(28px,4vw,42px)}
.doc-content h2{
  margin:clamp(32px,4vw,44px) 0 12px;
  padding-top:18px;
  border-top:1px solid var(--rule);
  font-family:var(--serif);
  font-size:clamp(22px,3vw,30px);
  line-height:1.2;
  font-weight:600;
  letter-spacing:0;
}
.doc-content h3{
  margin:28px 0 10px;
  font-family:var(--serif);
  font-size:21px;
  line-height:1.25;
  font-weight:600;
  letter-spacing:0;
}
.doc-content h4,.doc-content h5,.doc-content h6{margin:22px 0 8px;font-size:16px;line-height:1.35}
.doc-content p{margin:0 0 16px;color:var(--ink)}
.doc-content ul,.doc-content ol{margin:0 0 18px;padding-left:22px}
.doc-content li{margin:7px 0}
.doc-content blockquote{
  margin:20px 0;
  padding:14px 18px;
  border-left:4px solid var(--ledger);
  background:#f7f9fa;
  color:var(--muted);
}
code{
  font-family:var(--mono);
  font-size:.92em;
  background:#f6f8f9;
  border:1px solid var(--rule);
  border-radius:4px;
  padding:.08em .32em;
}
pre.doc-code{
  margin:18px 0;
  overflow-x:auto;
  max-width:100%;
  background:#0f1518;
  border:1px solid #1c272d;
  border-radius:9px;
  padding:14px 16px;
  box-shadow:0 20px 44px -34px rgba(9,14,18,.9);
}
pre.doc-code code{
  display:block;
  background:transparent;
  border:0;
  border-radius:0;
  padding:0;
  color:#d6dde2;
  font-size:13px;
  line-height:1.5;
}
.table-wrap{overflow-x:auto;margin:18px 0;border:1px solid var(--rule-strong);border-radius:8px}
table{width:100%;border-collapse:collapse;font-size:14px;min-width:560px}
th,td{padding:10px 12px;border-bottom:1px solid var(--rule);vertical-align:top;text-align:left}
th{background:#f6f8f9;color:var(--ink);font-weight:700}
tr:last-child td{border-bottom:0}
.doc-index-list{list-style:none;margin:0;padding:0;display:grid;gap:0;border-top:1px solid var(--rule)}
.doc-index-list li{padding:18px 0;border-bottom:1px solid var(--rule)}
.doc-index-list a{
  display:inline-block;
  font-family:var(--serif);
  font-size:22px;
  line-height:1.2;
  font-weight:600;
}
.doc-index-list .path{
  display:block;
  margin-top:4px;
  color:var(--faint);
  font-family:var(--mono);
  font-size:12px;
}
.doc-index-list p{margin:8px 0 0;color:var(--muted);max-width:70ch}
footer{
  border-top:1px solid var(--rule);
  margin-top:clamp(34px,5vw,52px);
  padding-top:clamp(26px,4vw,34px);
}
.close{
  display:flex;
  justify-content:space-between;
  align-items:flex-end;
  gap:20px;
  flex-wrap:wrap;
}
.close-copy{max-width:34ch}
.issued{
  font-size:11px;
  font-weight:700;
  letter-spacing:.16em;
  text-transform:uppercase;
  color:var(--faint);
  display:flex;
  gap:18px;
  flex-wrap:wrap;
  margin:0 0 14px;
}
.thanks{
  font-family:var(--serif);
  font-size:19px;
  font-weight:600;
  color:var(--ink);
  margin:0 0 10px;
}
.serial{
  font-family:var(--mono);
  font-size:10.5px;
  letter-spacing:.34em;
  color:var(--faint);
  margin:0;
  padding-left:.34em;
}
.seal{flex:0 0 auto;width:clamp(104px,17vw,128px);height:auto;color:var(--seal);transform:rotate(-5deg)}
.barcode{color:var(--rule-strong);height:30px;display:block;margin:24px 0 8px}
.flinks{font-size:14px;color:var(--muted);line-height:2}
.flinks a{color:var(--ledger)}
.flinks .sep{color:var(--rule-strong);padding:0 .6ch}
.samosa{color:var(--muted);margin:10px 0 0;font-size:13.5px}
@media (max-width:760px){
  .doc-grid{grid-template-columns:minmax(0,1fr)}
  .toc{position:static;border-right:0;border-bottom:1px solid var(--rule);padding:0 0 18px}
}
@media (max-width:480px){
  .masthead-row{letter-spacing:.16em;align-items:flex-start}
  .masthead-row nav{gap:10px}
  .close{flex-direction:column-reverse;align-items:flex-start}
}
@media (prefers-reduced-motion:reduce){
  *{transition:none!important;animation:none!important}
}`;
}

function sealSvg() {
  return `<svg class="seal" viewBox="0 0 200 200" role="img" aria-label="A round vermillion seal reading RECEIPTED, SETTLED, and NO FABRICATED DOLLARS.">
  <defs>
    <path id="ring-top" d="M 30 100 A 70 70 0 0 1 170 100"/>
    <path id="ring-bot" d="M 34 100 A 66 66 0 0 0 166 100"/>
  </defs>
  <circle cx="100" cy="100" r="95" fill="none" stroke="currentColor" stroke-width="2.5"/>
  <circle cx="100" cy="100" r="83" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <g fill="currentColor" font-family="system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif" font-weight="700">
    <text font-size="14.5" letter-spacing="3.5" text-anchor="middle"><textPath href="#ring-top" startOffset="50%">RECEIPTED</textPath></text>
    <text font-size="14.5" letter-spacing="3.5" text-anchor="middle"><textPath href="#ring-bot" startOffset="50%">SETTLED</textPath></text>
  </g>
  <line x1="66" y1="70" x2="134" y2="70" stroke="currentColor" stroke-width="1.5"/>
  <line x1="66" y1="130" x2="134" y2="130" stroke="currentColor" stroke-width="1.5"/>
  <g fill="currentColor" font-family="system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif" font-weight="700" text-anchor="middle" letter-spacing="1.5">
    <text x="100" y="91" font-size="15">NO</text>
    <text x="100" y="106" font-size="13">FABRICATED</text>
    <text x="100" y="121" font-size="15">DOLLARS</text>
  </g>
</svg>`;
}

function barcodeSvg() {
  return `<svg class="barcode" viewBox="0 0 90 34" width="180" height="30" fill="currentColor" role="img" aria-label="Barcode encoding the word aireceipts.">
  <rect x="0" y="0" width="3" height="34"/><rect x="4" y="0" width="2" height="34"/><rect x="8" y="0" width="3" height="34"/><rect x="12" y="0" width="2" height="34"/><rect x="16" y="0" width="4" height="34"/><rect x="21" y="0" width="3" height="34"/><rect x="26" y="0" width="3" height="34"/><rect x="31" y="0" width="2" height="34"/><rect x="35" y="0" width="3" height="34"/><rect x="39" y="0" width="4" height="34"/><rect x="45" y="0" width="3" height="34"/><rect x="50" y="0" width="2" height="34"/><rect x="54" y="0" width="3" height="34"/><rect x="58" y="0" width="2" height="34"/><rect x="62" y="0" width="4" height="34"/><rect x="67" y="0" width="1" height="34"/><rect x="70" y="0" width="4" height="34"/><rect x="76" y="0" width="1" height="34"/><rect x="79" y="0" width="4" height="34"/><rect x="84" y="0" width="4" height="34"/>
</svg>`;
}

function wrapPage({ title, sourcePath, body, navSections }) {
  const sourceLine = sourcePath === undefined
    ? "Start with your first receipt in 60 seconds. Then one guide per command, a reference, and the why-pages."
    : `Rendered from <code>${escapeHtml(sourcePath)}</code>.`;
  const navMarkup = navSections
    .map((sec) => {
      const items = sec.items
        .map((doc) => `        <li><a href="${escapeAttr(doc.href)}">${escapeHtml(doc.title)}</a></li>`)
        .join("\n");
      return `      <p class="toc-section">${escapeHtml(sec.section)}</p>\n      <ul>\n${items}\n      </ul>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — aireceipts docs</title>
<meta name="description" content="Static aireceipts documentation rendered from the repository docs folder.">
<meta name="theme-color" content="#e9edf0">
<style>
${css()}
</style>
</head>
<body>
<div class="sheet">
  <header class="mast">
    <div class="masthead-row">
      <a class="brand" href="../index.html">AIRECEIPTS</a>
      <nav aria-label="Primary">
        <a href="../index.html">Home</a>
        <a href="index.html">Docs</a>
      </nav>
    </div>
    <div class="rule2" aria-hidden="true"></div>
    <div class="doc-hero">
      <p class="doc-label">Docs ledger</p>
      <h1>${escapeHtml(title)}</h1>
      <p class="sub">${sourceLine}</p>
    </div>
  </header>
  <main class="doc-grid">
    <aside class="toc" aria-label="Docs contents">
      <h2>Contents</h2>
${navMarkup}
    </aside>
    <article class="doc-content">
${body}
    </article>
  </main>
  <footer>
    <div class="close">
      <div class="close-copy">
        <p class="issued"><span>No account</span><span>No upload</span><span>Docs</span></p>
        <p class="thanks">Thank you for your tokens.</p>
        <p class="serial">AIRECEIPTS · NO. 0001</p>
      </div>
      ${sealSvg()}
    </div>
    ${barcodeSvg()}
    <p class="flinks">
      <a href="../index.html">Home</a><span class="sep" aria-hidden="true">·</span><a href="index.html">Docs</a><span class="sep" aria-hidden="true">·</span><span>Apache-2.0</span>
    </p>
    <p class="samosa">buy me a samosa</p>
  </footer>
</div>
</body>
</html>
`;
}

function assertNoExternalLoads(html, file) {
  for (const pattern of RESOURCE_LOAD_PATTERNS) {
    if (pattern.test(html)) {
      throw new Error(`${file}: generated HTML contains an external resource load`);
    }
  }
}

function writeHtml(file, html) {
  assertNoExternalLoads(html, relative(ROOT, file));
  writeFileSync(file, html, "utf8");
}

/** Every publishable `.md` under docs/, as paths relative to docs/, excluding {@link EXCLUDED_DIRS}. */
function collectPublishableMdFiles() {
  const results = [];
  const walk = (relDir) => {
    const abs = relDir === "" ? DOCS_DIR : join(DOCS_DIR, relDir);
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.includes(entry.name)) continue;
        walk(rel);
      } else if (entry.name.endsWith(".md")) {
        results.push(rel);
      }
    }
  };
  walk("");
  return results;
}

function main() {
  const manifestItems = NAV_SECTIONS.flatMap((s) => s.items);

  // Completeness + integrity: every publishable doc must be placed in the nav,
  // every nav item must exist on disk, and no two docs may collapse to the same
  // output file. A new page therefore can't be silently dropped, and internal/
  // is provably excluded because nothing there is in NAV_SECTIONS.
  const onDisk = collectPublishableMdFiles();
  const inManifest = new Set(manifestItems);
  if (manifestItems.length !== inManifest.size) {
    throw new Error("docs-site: NAV_SECTIONS contains a duplicate item");
  }
  const missingFromManifest = onDisk.filter((f) => !inManifest.has(f)).sort();
  if (missingFromManifest.length > 0) {
    throw new Error(`docs-site: publishable docs missing from NAV_SECTIONS: ${missingFromManifest.join(", ")}`);
  }
  const missingOnDisk = manifestItems.filter((f) => !existsSync(join(DOCS_DIR, f)));
  if (missingOnDisk.length > 0) {
    throw new Error(`docs-site: NAV_SECTIONS references missing file(s): ${missingOnDisk.join(", ")}`);
  }

  const docByPath = new Map();
  const byHref = new Map();
  for (const rel of manifestItems) {
    const markdown = readFileSync(join(DOCS_DIR, rel), "utf8");
    const href = `${basename(rel, ".md")}.html`;
    if (byHref.has(href)) {
      throw new Error(`docs-site: basename collision on ${href} (${byHref.get(href)} vs ${rel})`);
    }
    byHref.set(href, rel);
    docByPath.set(rel, {
      rel,
      sourcePath: `docs/${rel}`,
      href,
      title: getTitle(markdown, basename(rel, ".md")),
      excerpt: getExcerpt(markdown),
      markdown,
    });
  }

  const navSections = NAV_SECTIONS.map((s) => ({
    section: s.section,
    items: s.items.map((rel) => ({ href: docByPath.get(rel).href, title: docByPath.get(rel).title })),
  }));

  mkdirSync(OUT_DIR, { recursive: true });
  for (const name of readdirSync(OUT_DIR)) {
    if (name.endsWith(".html")) rmSync(join(OUT_DIR, name));
  }

  for (const doc of docByPath.values()) {
    const body = renderMarkdown(doc.markdown);
    const html = wrapPage({ title: doc.title, sourcePath: doc.sourcePath, body, navSections });
    writeHtml(join(OUT_DIR, doc.href), html);
  }

  const indexBody = `
<p>New here? <strong>Get started</strong> walks you to your first receipt in under a minute. Everything else answers one question each.</p>
${NAV_SECTIONS.map((s) => `<h2>${escapeHtml(s.section)}</h2>
<ul class="doc-index-list">
${s.items.map((rel) => {
  const doc = docByPath.get(rel);
  return `  <li>
    <a href="${escapeAttr(doc.href)}">${escapeHtml(doc.title)}</a>
    <span class="path">${escapeHtml(doc.sourcePath)}</span>
    <p>${escapeHtml(doc.excerpt)}</p>
  </li>`;
}).join("\n")}
</ul>`).join("\n")}`;
  const indexHtml = wrapPage({ title: "Docs", body: indexBody, navSections });
  writeHtml(join(OUT_DIR, "index.html"), indexHtml);

  console.log(`build-docs-site: wrote ${docByPath.size + 1} page(s) to ${relative(ROOT, OUT_DIR)}`);
}

main();
