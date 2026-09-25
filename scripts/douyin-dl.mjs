#!/usr/bin/env node
// douyin-dl: download a Douyin (抖音) video through a real headless browser.
//
// Why a browser: Douyin's web API rejects non-browser clients (403, "fresh cookies needed"),
// and yt-dlp can't read Chrome/Edge cookie DBs while the browser is open. A headless Edge/Chrome
// passes every check by itself. We watch its network traffic for the video and audio streams
// (Douyin web serves them as separate mp4s), download both with the page's cookies, then mux.
//
// usage: node douyin-dl.mjs <share-url-or-video-url> [outdir] [--name <basename>] [--keep-parts]
// needs: Edge or Chrome installed; ffmpeg on PATH (or FFMPEG env var) for muxing.
// Cookies are used in-memory only and never written to disk.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a));
if (!url) {
  console.error("usage: node douyin-dl.mjs <url> [outdir] [--name <basename>] [--keep-parts]");
  process.exit(2);
}
const outdir = args.find((a, i) => !a.startsWith("--") && a !== url && args[i - 1] !== "--name") || ".";
const nameIdx = args.indexOf("--name");
const forcedName = nameIdx >= 0 ? args[nameIdx + 1] : null;
const keepParts = args.includes("--keep-parts");
fs.mkdirSync(outdir, { recursive: true });

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function findBrowser() {
  if (process.env.BROWSER_PATH && fs.existsSync(process.env.BROWSER_PATH)) return process.env.BROWSER_PATH;
  const cands = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/microsoft-edge",
  ];
  const hit = cands.find((p) => fs.existsSync(p));
  if (!hit) throw new Error("No Edge/Chrome found. Set BROWSER_PATH to the browser executable.");
  return hit;
}

function findFfmpeg() {
  if (process.env.FFMPEG && fs.existsSync(process.env.FFMPEG)) return process.env.FFMPEG;
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["ffmpeg"], { encoding: "utf8" });
  if (probe.status === 0) return probe.stdout.trim().split(/\r?\n/)[0];
  // winget's Gyan.FFmpeg install location on Windows
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const pk = path.join(local, "Microsoft", "WinGet", "Packages");
    if (fs.existsSync(pk)) {
      for (const d of fs.readdirSync(pk)) if (d.startsWith("Gyan.FFmpeg")) {
        for (const sub of fs.readdirSync(path.join(pk, d))) {
          const bin = path.join(pk, d, sub, "bin", "ffmpeg.exe");
          if (fs.existsSync(bin)) return bin;
        }
      }
    }
  }
  return null;
}

function safeName(s) {
  return s.replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "douyin";
}

async function fetchTo(u, file, cookie) {
  const res = await fetch(u, { headers: { "User-Agent": UA, Referer: "https://www.douyin.com/", Cookie: cookie } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${u.slice(0, 80)}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return fs.statSync(file).size;
}

const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true,
  args: ["--disable-gpu", "--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--mute-audio"],
});
try {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  const streams = new Map();
  page.on("response", (r) => {
    const u = r.url();
    const ct = r.headers()["content-type"] || "";
    if (/video\/mp4|audio\/mp4/.test(ct) && /douyinvod|\/play\//.test(u) && !streams.has(u)) streams.set(u, { ct, status: r.status() });
  });
  console.log("opening", url);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 }).catch((e) => console.log("goto:", e.message));
  await new Promise((r) => setTimeout(r, 3000));
  await page.evaluate(() => { const v = document.querySelector("video"); if (v) { v.muted = true; v.play().catch(() => {}); } });
  for (let i = 0; i < 12 && streams.size < 2; i++) await new Promise((r) => setTimeout(r, 1000));

  const title = (await page.title()).replace(/\s*-\s*抖音\s*$/, "");
  const finalUrl = page.url();
  const id = (finalUrl.match(/video\/(\d+)/) || [])[1] || "unknown";
  const cookie = (await page.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  const urls = [...streams.keys()];
  console.log("title:", title.slice(0, 80));
  console.log("video id:", id, "| streams captured:", urls.length);
  if (!urls.length) throw new Error("No media streams captured. Page may require login or the video is private.");

  const base = safeName(forcedName || title.split(/\s|#/)[0] || id);
  const tmpdir = fs.mkdtempSync(path.join(outdir, ".dl-"));
  const parts = [];
  for (let i = 0; i < urls.length; i++) {
    const f = path.join(tmpdir, `part${i}.mp4`);
    const size = await fetchTo(urls[i], f, cookie);
    parts.push(f);
    console.log(`part${i}: ${(size / 1e6).toFixed(1)} MB`);
  }

  const ffmpeg = findFfmpeg();
  const out = path.join(outdir, `${base}.mp4`);
  if (ffmpeg && parts.length >= 2) {
    // identify which part has video via ffprobe-less heuristic: larger file is video; verify with ffmpeg -i
    const probe = (f) => spawnSync(ffmpeg, ["-i", f], { encoding: "utf8" }).stderr;
    const vid = parts.find((f) => /Video:/.test(probe(f)));
    const aud = parts.find((f) => f !== vid && /Audio:/.test(probe(f)));
    if (!vid || !aud) throw new Error("Could not identify video/audio parts");
    const r = spawnSync(ffmpeg, ["-y", "-v", "error", "-i", vid, "-i", aud, "-c", "copy", "-map", "0:v:0", "-map", "1:a:0", out]);
    if (r.status !== 0) throw new Error("ffmpeg mux failed: " + r.stderr);
    console.log("muxed ->", out);
  } else if (parts.length === 1) {
    fs.copyFileSync(parts[0], out);
    console.log("single stream ->", out);
  } else {
    for (let i = 0; i < parts.length; i++) fs.copyFileSync(parts[i], path.join(outdir, `${base}.part${i}.mp4`));
    console.log("ffmpeg not found; saved raw parts as", `${base}.part*.mp4`, "(set FFMPEG or install ffmpeg to mux)");
  }
  const meta = { id, title, url, finalUrl, downloadedAt: new Date().toISOString(), file: path.basename(out) };
  fs.writeFileSync(path.join(outdir, `${base}.json`), JSON.stringify(meta, null, 2));
  if (!keepParts) fs.rmSync(tmpdir, { recursive: true, force: true });
} finally {
  await browser.close();
}
