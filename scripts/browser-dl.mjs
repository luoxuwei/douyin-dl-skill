#!/usr/bin/env node
// browser-dl: generic fallback downloader. Opens the page in a real headless Edge/Chrome, plays the
// video, captures direct mp4/m4a/m4s media responses from the network, downloads them with the page's
// cookies, and muxes with ffmpeg. Works for sites that serve plain progressive mp4 or split audio/video
// mp4 (Douyin, Xiaohongshu, Weibo...). Does NOT handle HLS/DASH segment playlists or DRM; those sites
// should go through yt-dlp instead (see video-dl.mjs).
//
// usage: node browser-dl.mjs <url> [outdir] [--name <basename>] [--keep-parts] [--wait <sec>]
// env:   BROWSER_PATH (browser exe), FFMPEG (ffmpeg exe)
// Cookies stay in memory; nothing is written except the media files and a small .json.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { findFfmpeg, safeName, UA, parseArgs, launchOpts } from "./common.mjs";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const { url, outdir, forcedName, keepParts, wait, useProfile } = parseArgs(process.argv.slice(2), "browser-dl.mjs");
fs.mkdirSync(outdir, { recursive: true });

const MEDIA_CT = /^(video\/mp4|audio\/mp4|video\/webm|audio\/webm|application\/octet-stream)/;
const SKIP_URL = /\.(ts|m3u8|mpd)(\?|$)|\/hls\/|\/dash\//i;

const browser = await puppeteer.launch(launchOpts({ headless: true, useProfile }));
try {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  const streams = new Map(); // url -> {ct, bytes}
  page.on("response", async (r) => {
    const u = r.url();
    const ct = (r.headers()["content-type"] || "").toLowerCase();
    if (!MEDIA_CT.test(ct) || SKIP_URL.test(u)) return;
    // strip byte-range noise: same media is requested many times with different Range headers
    const key = u.replace(/([?&])(range|bytestart|byteend)=[^&]*/gi, "$1").replace(/[?&]$/, "");
    if (!streams.has(key)) streams.set(key, { ct, status: r.status() });
  });
  console.log("opening", url);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 }).catch((e) => console.log("goto:", e.message));
  await new Promise((r) => setTimeout(r, 2500));
  await page.evaluate(() => {
    for (const v of document.querySelectorAll("video")) {
      try { v.muted = true; const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch {}
    }
    if (!document.querySelector("video")) {
      const btn = document.querySelector('[class*="play"], [aria-label*="播放"], [aria-label*="Play"]');
      if (btn) try { btn.click(); } catch {}
    }
  }).catch((e) => console.log("play:", String(e.message).split("\n")[0]));
  for (let i = 0; i < wait && streams.size < 2; i++) await new Promise((r) => setTimeout(r, 1000));

  const title = (await page.title()).replace(/\s*[-|_]\s*(抖音|小红书|微博|bilibili|哔哩哔哩).*$/i, "").trim();
  const cookie = (await page.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  const urls = [...streams.keys()];
  console.log("title:", title.slice(0, 80));
  console.log("streams captured:", urls.length);
  if (!urls.length) throw new Error("No direct media streams captured. Site may use HLS/DASH (try yt-dlp) or require login.");

  const base = safeName(forcedName || title || "video");
  const tmpdir = fs.mkdtempSync(path.join(outdir, ".dl-"));
  const parts = [];
  for (let i = 0; i < urls.length; i++) {
    const f = path.join(tmpdir, `part${i}.bin`);
    const res = await fetch(urls[i], { headers: { "User-Agent": UA, Referer: new URL(page.url()).origin + "/", Cookie: cookie } });
    if (!res.ok) { console.log(`part${i}: HTTP ${res.status}, skipped`); continue; }
    fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
    const size = fs.statSync(f).size;
    if (size < 50_000) { fs.rmSync(f); continue; } // ads, thumbnails, probes
    parts.push(f);
    console.log(`part${i}: ${(size / 1e6).toFixed(1)} MB`);
  }
  if (!parts.length) throw new Error("All captured streams failed to download (expired or blocked).");

  const ffmpeg = findFfmpeg();
  const out = path.join(outdir, `${base}.mp4`);
  const probe = (f) => (ffmpeg ? spawnSync(ffmpeg, ["-i", f], { encoding: "utf8" }).stderr : "");
  if (ffmpeg) {
    const info = parts.map((f) => ({ f, s: probe(f), size: fs.statSync(f).size }));
    const withBoth = info.find((x) => /Video:/.test(x.s) && /Audio:/.test(x.s));
    const vid = withBoth || info.filter((x) => /Video:/.test(x.s)).sort((a, b) => b.size - a.size)[0];
    const aud = withBoth ? null : info.find((x) => x !== vid && /Audio:/.test(x.s));
    if (!vid) throw new Error("No video stream among downloaded parts");
    const args = aud
      ? ["-y", "-v", "error", "-i", vid.f, "-i", aud.f, "-c", "copy", "-map", "0:v:0", "-map", "1:a:0", out]
      : ["-y", "-v", "error", "-i", vid.f, "-c", "copy", out];
    const r = spawnSync(ffmpeg, args);
    if (r.status !== 0) throw new Error("ffmpeg failed: " + r.stderr);
    console.log((aud ? "muxed -> " : "copied -> ") + out);
  } else {
    parts.forEach((f, i) => fs.copyFileSync(f, path.join(outdir, `${base}.part${i}.mp4`)));
    console.log("ffmpeg not found; saved raw parts as", `${base}.part*.mp4`);
  }
  fs.writeFileSync(path.join(outdir, `${base}.json`), JSON.stringify({ title, url, finalUrl: page.url(), backend: "browser", downloadedAt: new Date().toISOString(), file: path.basename(out) }, null, 2));
  if (!keepParts) fs.rmSync(tmpdir, { recursive: true, force: true });
} finally {
  await browser.close();
}
