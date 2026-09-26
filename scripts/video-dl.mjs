#!/usr/bin/env node
// video-dl: one entry point for downloading a video from any platform.
//
//   node video-dl.mjs <url> [outdir] [--quality 720 | --format <id>] [--list] [--name x]
//                           [--playlist --limit N --since YYYY-MM-DD --yes] [--ytdlp | --browser] [--no-profile] [--keep-parts]
//
// Routing:
//   channel / playlist URL, or --playlist  -> list-dl.mjs (enumerate, confirm, download one by one)
//   douyin.com / v.douyin.com              -> douyin-dl.mjs   (browser capture; yt-dlp is blocked there)
//   xiaohongshu.com / xhslink.com          -> browser-dl.mjs  (yt-dlp extractor broken as of 2026-09; needs login profile)
//   everything else                        -> yt-dlp first; if it fails, browser-dl.mjs as fallback
// --list prints the available formats (yt-dlp sites only) and exits; pick one with --format <id>.
// A login profile created by login.mjs is used automatically by the browser backends and passed to yt-dlp as cookies.

import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { findFfmpeg, findYtDlp, parseArgs, hasProfile, launchOpts, UA } from "./common.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const a = parseArgs(process.argv.slice(2), "video-dl.mjs");
const u = new URL(a.url);
const host = u.hostname.replace(/^www\./, "");

const run = (script, extra = []) => {
  const r = spawnSync(process.execPath, [path.join(here, script), a.url, a.outdir, ...(a.forcedName ? ["--name", a.forcedName] : []), ...(a.keepParts ? ["--keep-parts"] : []), ...(a.useProfile ? [] : ["--no-profile"]), ...extra], { stdio: "inherit" });
  return r.status === 0;
};

// ---- playlist / channel detection ----
const LIST_URL = [
  /douyin\.com$/.test(host) && /^\/user\//.test(u.pathname),
  /bilibili\.com$/.test(host) && (/^space\./.test(u.hostname) || /\/(medialist|list|favlist|collectiondetail)/.test(u.pathname) || u.searchParams.has("sid")),
  /youtube\.com$/.test(host) && (/^\/(@|c\/|channel\/|user\/|playlist)/.test(u.pathname) || u.searchParams.has("list")),
  /xiaohongshu\.com$/.test(host) && /^\/user\/profile\//.test(u.pathname),
].some(Boolean);
if (a.playlist || LIST_URL) {
  const extra = [];
  if (process.argv.includes("--limit")) extra.push("--limit", String(a.limit));
  if (a.since) extra.push("--since", a.since);
  if (a.quality) extra.push("--quality", a.quality);
  if (a.format) extra.push("--format", a.format);
  if (a.yes) extra.push("--yes");
  if (a.dryRun) extra.push("--dry-run");
  if (!a.useProfile) extra.push("--no-profile");
  const r = spawnSync(process.execPath, [path.join(here, "list-dl.mjs"), a.url, a.outdir, ...extra], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

// ---- cookies for yt-dlp from the login profile (exported through our own browser profile, never from the user's Chrome) ----
async function exportCookiesFor(hostname) {
  if (!a.useProfile || !hasProfile()) return null;
  const puppeteer = createRequire(import.meta.url)("puppeteer-core");
  const b = await puppeteer.launch(launchOpts({ headless: true }));
  try {
    const p = await b.newPage(); await p.setUserAgent(UA);
    await p.goto(`https://${hostname}/`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    const cookies = await p.cookies();
    if (!cookies.length) return null;
    const file = path.join(os.tmpdir(), `video-dl-cookies-${process.pid}.txt`);
    const lines = ["# Netscape HTTP Cookie File", ...cookies.map((c) => [c.domain, c.domain.startsWith(".") ? "TRUE" : "FALSE", c.path, c.secure ? "TRUE" : "FALSE", Math.floor(c.expires > 0 ? c.expires : Date.now() / 1000 + 86400), c.name, c.value].join("\t"))];
    fs.writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
    return file;
  } finally { await b.close(); }
}

const BROWSER_ONLY = [/douyin\.com$/, /xiaohongshu\.com$/, /xhslink\.com$/];
const isDouyin = /douyin\.com$/.test(host);

async function ytdlp() {
  const y = findYtDlp();
  if (!y) { console.log("yt-dlp not found (pip install yt-dlp)"); return false; }
  const ff = findFfmpeg();
  const cookieFile = await exportCookiesFor(host);
  const common = [...y.prefix, "--no-playlist", "-R", "5", "--socket-timeout", "30", ...(cookieFile ? ["--cookies", cookieFile] : []), ...(ff ? ["--ffmpeg-location", path.dirname(ff)] : [])];
  try {
    if (a.list) {
      const r = spawnSync(y.cmd, [...common, "-J", a.url], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      if (r.status !== 0) { console.log((r.stderr || "").split("\n").filter((l) => /ERROR/.test(l)).join("\n")); return false; }
      const j = JSON.parse(r.stdout);
      console.log(`title: ${j.title}\nduration: ${j.duration ? Math.round(j.duration) + "s" : "?"}`);
      console.log("formats (id | ext | height | vcodec | acodec | size MB | note):");
      for (const f of j.formats || []) {
        if (f.vcodec === "none" && f.acodec === "none") continue;
        const size = f.filesize || f.filesize_approx;
        console.log([f.format_id, f.ext, f.height || "audio", (f.vcodec || "none").split(".")[0], (f.acodec || "none").split(".")[0], size ? (size / 1e6).toFixed(1) : "?", f.format_note || ""].join(" | "));
      }
      console.log("\nuse:  --quality <height>  (best video<=height + best audio, merged)  or  --format <id>[+<audio id>]");
      return true;
    }
    const fmt = a.format ? a.format : a.quality ? `bv*[height<=${a.quality}]+ba/b[height<=${a.quality}]` : "bv*+ba/b";
    const args = [...common, "-f", fmt, "--merge-output-format", "mp4",
      "-o", path.join(a.outdir, (a.forcedName || "%(title).60s") + ".%(ext)s"), "--print-to-file", "%(id)s\t%(title)s\t%(uploader)s\t%(duration)s", path.join(a.outdir, ".yt-dlp-meta.txt"), a.url];
    console.log(`yt-dlp ${y.version} via ${y.cmd}${cookieFile ? " (with login profile cookies)" : ""}`);
    const r = spawnSync(y.cmd, args, { stdio: "inherit" });
    return r.status === 0;
  } finally { if (cookieFile) fs.rmSync(cookieFile, { force: true }); }
}

fs.mkdirSync(a.outdir, { recursive: true });
let ok;
if (a.list && (isDouyin || BROWSER_ONLY.some((re) => re.test(host)))) { console.log("this site serves a single stream; no format choice. Just download."); ok = true; }
else if (a.forceBrowser) ok = isDouyin ? run("douyin-dl.mjs") : run("browser-dl.mjs");
else if (a.forceYtdlp) ok = await ytdlp();
else if (isDouyin) ok = run("douyin-dl.mjs");
else if (BROWSER_ONLY.some((re) => re.test(host))) ok = run("browser-dl.mjs");
else {
  ok = await ytdlp();
  if (!ok && !a.list) { console.log("\nyt-dlp failed, falling back to browser capture..."); ok = run("browser-dl.mjs"); }
}
process.exit(ok ? 0 : 1);
