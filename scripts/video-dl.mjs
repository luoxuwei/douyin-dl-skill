#!/usr/bin/env node
// video-dl: one entry point for downloading a video from any platform.
//
//   node video-dl.mjs <url> [outdir] [--quality 720] [--name x] [--ytdlp] [--browser] [--keep-parts]
//
// Routing:
//   douyin.com / v.douyin.com      -> douyin-dl.mjs   (browser capture; yt-dlp is blocked there)
//   xiaohongshu.com / xhslink.com  -> browser-dl.mjs  (yt-dlp extractor broken as of 2026-09)
//   everything else                -> yt-dlp first; if it fails, browser-dl.mjs as fallback
// --ytdlp / --browser force a backend. yt-dlp gets --ffmpeg-location so merged mp4 comes out.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findFfmpeg, findYtDlp, parseArgs } from "./common.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const a = parseArgs(process.argv.slice(2), "video-dl.mjs");
const host = new URL(a.url).hostname.replace(/^www\./, "");

const run = (script, extra = []) => {
  const r = spawnSync(process.execPath, [path.join(here, script), a.url, a.outdir, ...(a.forcedName ? ["--name", a.forcedName] : []), ...(a.keepParts ? ["--keep-parts"] : []), ...extra], { stdio: "inherit" });
  return r.status === 0;
};

const BROWSER_ONLY = [/douyin\.com$/, /xiaohongshu\.com$/, /xhslink\.com$/];
const isDouyin = /douyin\.com$/.test(host);

function ytdlp() {
  const y = findYtDlp();
  if (!y) { console.log("yt-dlp not found (pip install yt-dlp)"); return false; }
  const ff = findFfmpeg();
  const q = a.quality ? `bv*[height<=${a.quality}]+ba/b[height<=${a.quality}]` : "bv*+ba/b";
  const args = [...y.prefix, "--no-playlist", "-f", q, "--merge-output-format", "mp4", "-R", "5", "--socket-timeout", "30",
    "-o", path.join(a.outdir, (a.forcedName || "%(title).60s") + ".%(ext)s"), "--print-to-file", "%(id)s\t%(title)s\t%(uploader)s\t%(duration)s", path.join(a.outdir, ".yt-dlp-meta.txt"),
    ...(ff ? ["--ffmpeg-location", path.dirname(ff)] : []), a.url];
  console.log(`yt-dlp ${y.version} via ${y.cmd}`);
  const r = spawnSync(y.cmd, args, { stdio: "inherit" });
  return r.status === 0;
}

let ok;
if (a.forceBrowser) ok = isDouyin ? run("douyin-dl.mjs") : run("browser-dl.mjs");
else if (a.forceYtdlp) ok = ytdlp();
else if (isDouyin) ok = run("douyin-dl.mjs");
else if (BROWSER_ONLY.some((re) => re.test(host))) ok = run("browser-dl.mjs");
else {
  ok = ytdlp();
  if (!ok) { console.log("\nyt-dlp failed, falling back to browser capture..."); ok = run("browser-dl.mjs"); }
}
process.exit(ok ? 0 : 1);
