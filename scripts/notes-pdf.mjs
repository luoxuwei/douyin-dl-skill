#!/usr/bin/env node
// notes-pdf: render a Markdown notes file to PDF with the local Edge/Chrome. Images referenced by relative
// path resolve against the Markdown file's directory. No external CSS or fonts; works offline.
//
// usage: node notes-pdf.mjs <notes.md> [out.pdf] [--footer "文字"]

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { findBrowser } from "./common.mjs";

const require = createRequire(import.meta.url);
const MarkdownIt = require("markdown-it");
const puppeteer = require("puppeteer-core");

const argv = process.argv.slice(2);
const mdFile = argv.find((x) => /\.md$/i.test(x));
if (!mdFile || !fs.existsSync(mdFile)) { console.error("usage: node notes-pdf.mjs <notes.md> [out.pdf] [--footer 文字]"); process.exit(2); }
const out = argv.find((x) => /\.pdf$/i.test(x)) || mdFile.replace(/\.md$/i, ".pdf");
const fi = argv.indexOf("--footer");
const footer = fi >= 0 ? argv[fi + 1] : path.basename(mdFile, ".md");

const md = new MarkdownIt({ html: true, linkify: true });
const src = fs.readFileSync(mdFile, "utf8");
const dir = pathToFileURL(path.resolve(path.dirname(mdFile))).href + "/";
let html = md.render(src).replace(/src="(?!https?:|file:|data:)([^"]+)"/g, (m, p) => `src="${dir}${p.split("/").map(encodeURIComponent).join("/")}"`);
html = html.replace(/<h2>/, '<h2 class="first">');
const css = `
body{font-family:"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif;color:#2b2b2b;line-height:1.7;font-size:10.5pt;margin:0}
h1{font-size:22pt;color:#1F3A5F;border-bottom:3px solid #1F3A5F;padding-bottom:6px}
h2{font-size:16pt;color:#1F3A5F;margin-top:28px;page-break-before:always}
h2.first{page-break-before:auto}
h3{font-size:13pt;color:#E8842B;margin-top:22px}
h4{font-size:12pt;margin-top:20px;page-break-after:avoid}
blockquote{border-left:4px solid #E8842B;background:#FFF4E6;margin:0;padding:8px 14px;font-size:9.5pt}
table{border-collapse:collapse;width:100%;font-size:9.5pt;margin:10px 0}
th,td{border:1px solid #E5E7EB;padding:5px 8px;vertical-align:top;text-align:left}
th{background:#E8EEF6}
img{max-width:360px;max-height:340px;display:block;margin:10px 0;border:1px solid #E5E7EB;page-break-inside:avoid}
a{color:#1F3A5F;word-break:break-all}
p strong{color:#6B7280;font-weight:600}
li{margin:2px 0}
hr{border:0;border-top:1px solid #E5E7EB;margin:24px 0}
code{background:#F1F3F5;padding:1px 4px;border-radius:3px;font-size:9.5pt}
pre{background:#F1F3F5;padding:10px;border-radius:6px;overflow:hidden;white-space:pre-wrap;font-size:9pt}
`;
const tmp = path.join(path.dirname(path.resolve(mdFile)), ".notes-pdf.html");
fs.writeFileSync(tmp, `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`);
const b = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ["--disable-gpu", "--no-sandbox"] });
try {
  const p = await b.newPage();
  await p.goto(pathToFileURL(tmp).href, { waitUntil: "networkidle0" });
  await p.pdf({ path: out, format: "A4", printBackground: true, margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" }, displayHeaderFooter: true, headerTemplate: "<div></div>",
    footerTemplate: `<div style="font-size:8px;color:#888;width:100%;text-align:center">${footer.replace(/</g, "&lt;")} · <span class="pageNumber"></span> / <span class="totalPages"></span></div>` });
} finally { await b.close(); fs.rmSync(tmp, { force: true }); }
console.log("pdf ->", out, (fs.statSync(out).size / 1024).toFixed(0) + " KB");
