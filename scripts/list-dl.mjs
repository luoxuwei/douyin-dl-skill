#!/usr/bin/env node
// list-dl: enumerate the videos on a channel / uploader / playlist page, then download them one by one
// through video-dl.mjs. Always shows the list and asks for confirmation first (unless --yes), and
// caps the batch with --limit (default 20) so a stray command can't pull an entire account.
//
// usage: node list-dl.mjs <channel-or-playlist-url> [outdir] [--limit N] [--since YYYY-MM-DD] [--quality 720] [--yes] [--dry-run]
//
// Backends:
//   Douyin user page  -> headless browser scrolls the page and collects /video/<id> links (needs login profile,
//                        Douyin shows a login wall on user pages; run `node login.mjs douyin` once)
//   everything else   -> yt-dlp --flat-playlist (Bilibili spaces, YouTube channels/playlists, ...)

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { findYtDlp, parseArgs, launchOpts, hasProfile, UA } from "./common.mjs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const a = parseArgs(process.argv.slice(2), "list-dl.mjs");
const host = new URL(a.url).hostname.replace(/^www\./, "");
fs.mkdirSync(a.outdir, { recursive: true });

async function listDouyin() {
  if (!hasProfile()) {
    console.log("Douyin user pages require login. Run once:  node login.mjs douyin");
    process.exit(3);
  }
  const puppeteer = require("puppeteer-core");
  const browser = await puppeteer.launch(launchOpts({ headless: true }));
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.goto(a.url, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 3000));
    if (await page.evaluate(() => /扫码登录|登录后查看/.test(document.body.innerText.slice(0, 4000)) && !document.querySelector('a[href*="/video/"]'))) {
      throw new Error("Douyin still shows a login wall. Re-run `node login.mjs douyin` and log in.");
    }
    const author = (await page.title()).replace(/的抖音.*$/, "").trim();
    const seen = new Map();
    let stale = 0;
    while (seen.size < a.limit && stale < 6) {
      const before = seen.size;
      const items = await page.evaluate(() => [...document.querySelectorAll('a[href*="/video/"]')].map((el) => {
        // card text is "<like count>\n\n<title>"; keep the title only
        const lines = (el.innerText || el.getAttribute("title") || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
        const text = lines.filter((s) => !/^[\d.]+[万wk]?$/i.test(s)).join(" ").replace(/\s+/g, " ").slice(0, 80);
        return { href: el.getAttribute("href"), text };
      }));
      for (const it of items) {
        const id = (it.href.match(/\/video\/(\d+)/) || [])[1];
        if (id && !seen.has(id)) seen.set(id, { id, url: `https://www.douyin.com/video/${id}`, title: it.text });
      }
      stale = seen.size === before ? stale + 1 : 0;
      await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
      await new Promise((r) => setTimeout(r, 1500));
    }
    return { author, items: [...seen.values()].slice(0, a.limit), truncated: seen.size >= a.limit };
  } finally { await browser.close(); }
}

async function listXiaohongshu() {
  if (!hasProfile()) {
    console.log("Xiaohongshu pages require login. Run once:  node login.mjs xiaohongshu");
    process.exit(3);
  }
  const puppeteer = require("puppeteer-core");
  const browser = await puppeteer.launch(launchOpts({ headless: true }));
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.goto(a.url, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 3000));
    if (!/\/user\/profile\//.test(page.url())) throw new Error("Xiaohongshu redirected away from the profile (login expired?). Re-run `node login.mjs xiaohongshu`.");
    const author = (await page.title()).replace(/\s*-\s*小红书\s*$/, "").trim();
    const seen = new Map();
    let stale = 0;
    while (seen.size < a.limit && stale < 6) {
      const before = seen.size;
      // note cards: keep the full href (xsec_token query is required to open a note now); mark video notes by the play icon
      const items = await page.evaluate(() => [...document.querySelectorAll('a[href*="/explore/"]')].map((el) => {
        const card = el.closest("section, .note-item, li") || el;
        return { href: el.getAttribute("href"), text: (card.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean)[0] || "", video: !!card.querySelector('[class*="video"], [class*="play"], svg[class*="play"]') };
      }));
      for (const it of items) {
        const id = (it.href.match(/\/explore\/([0-9a-f]+)/) || [])[1];
        if (id && !seen.has(id)) seen.set(id, { id, url: new URL(it.href, "https://www.xiaohongshu.com").href, title: it.text.slice(0, 80), video: it.video });
      }
      stale = seen.size === before ? stale + 1 : 0;
      await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
      await new Promise((r) => setTimeout(r, 1500));
    }
    const all = [...seen.values()];
    const vids = all.filter((x) => x.video);
    // if the page marks videos, keep only those; otherwise return everything and let the downloader skip image notes
    return { author, items: (vids.length ? vids : all).slice(0, a.limit), truncated: seen.size >= a.limit };
  } finally { await browser.close(); }
}

function listYtdlp() {
  const y = findYtDlp();
  if (!y) throw new Error("yt-dlp not found (pip install yt-dlp)");
  // --print per entry is lighter than -J and less likely to trip anti-bot checks (Bilibili returns 352 on -J)
  const args = [...y.prefix, "--flat-playlist", "--playlist-end", String(a.limit + 1), "--print", "%(id)s\t%(url,webpage_url,original_url)s\t%(title)s\t%(duration)s\t%(upload_date)s\t%(playlist_uploader,uploader,channel,playlist_title)s\t%(playlist_index)s", a.url];
  const r = spawnSync(y.cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 && !r.stdout.trim()) throw new Error("yt-dlp list failed: " + (r.stderr || "").split("\n").filter((l) => /ERROR/.test(l)).join(" | "));
  const rows = r.stdout.split(/\r?\n/).filter((l) => l.includes("\t")).map((l) => l.split("\t"));
  const na = (v) => v && v !== "NA" ? v : null;
  const items = rows.map(([id, url, title, duration, date, , idx]) => ({
    id: na(idx) ? `${id}-p${idx}` : id, url,
    title: na(title) || (na(idx) ? `${id} 第${idx}部分` : id),
    duration: na(duration) ? Number(duration) : null,
    date: date && /^\d{8}$/.test(date) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : null,
  }));
  const author = (rows[0] && na(rows[0][5])) || host;
  return { author, items: items.slice(0, a.limit), truncated: items.length > a.limit };
}

const listing = /douyin\.com$/.test(host) ? await listDouyin() : /xiaohongshu\.com$/.test(host) ? await listXiaohongshu() : listYtdlp();
let items = listing.items;
if (a.since) items = items.filter((it) => !it.date || it.date >= a.since);

console.log(`\n${listing.author} · ${items.length} videos${listing.truncated ? ` (showing first ${a.limit}, raise --limit for more)` : ""}`);
items.forEach((it, i) => console.log(`${String(i + 1).padStart(3)}. ${it.date ? it.date + "  " : ""}${it.duration ? Math.round(it.duration / 60) + "min  " : ""}${it.title.slice(0, 60)}`));
if (!items.length) { console.log("nothing to download"); process.exit(0); }
if (a.dryRun) process.exit(0);

if (!a.yes) {
  const ok = await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\ndownload these ${items.length} videos into ${path.resolve(a.outdir)}? [y/N] `, (ans) => { rl.close(); resolve(/^y(es)?$/i.test(ans.trim())); });
  });
  if (!ok) { console.log("cancelled"); process.exit(0); }
}

const done = [], failed = [];
for (const [i, it] of items.entries()) {
  console.log(`\n[${i + 1}/${items.length}] ${it.title.slice(0, 60)}`);
  const extra = [];
  if (a.quality) extra.push("--quality", a.quality);
  if (a.format) extra.push("--format", a.format);
  if (!a.useProfile) extra.push("--no-profile");
  const r = spawnSync(process.execPath, [path.join(here, "video-dl.mjs"), it.url, a.outdir, "--name", `${String(i + 1).padStart(3, "0")}-${(it.title || it.id).replace(/[\\/:*?"<>|\r\n]+/g, " ").trim().slice(0, 50)}`, ...extra], { stdio: "inherit" });
  (r.status === 0 ? done : failed).push(it);
}
fs.writeFileSync(path.join(a.outdir, "_list.json"), JSON.stringify({ source: a.url, author: listing.author, listedAt: new Date().toISOString(), done, failed }, null, 2));
console.log(`\ndone ${done.length}, failed ${failed.length}${failed.length ? " (see _list.json)" : ""}`);
process.exit(failed.length ? 1 : 0);
