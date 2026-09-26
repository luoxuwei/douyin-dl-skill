import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function findBrowser() {
  if (process.env.BROWSER_PATH && fs.existsSync(process.env.BROWSER_PATH)) return process.env.BROWSER_PATH;
  const cands = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge",
  ];
  const hit = cands.find((p) => fs.existsSync(p));
  if (!hit) throw new Error("No Edge/Chrome found. Set BROWSER_PATH to the browser executable.");
  return hit;
}

export function findFfmpeg() {
  if (process.env.FFMPEG && fs.existsSync(process.env.FFMPEG)) return process.env.FFMPEG;
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["ffmpeg"], { encoding: "utf8" });
  if (probe.status === 0 && probe.stdout.trim()) return probe.stdout.trim().split(/\r?\n/)[0];
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

export function findYtDlp() {
  for (const cmd of [["yt-dlp", ["--version"]], ["python", ["-m", "yt_dlp", "--version"]], ["python3", ["-m", "yt_dlp", "--version"]], ["py", ["-m", "yt_dlp", "--version"]]]) {
    const r = spawnSync(cmd[0], cmd[1], { encoding: "utf8" });
    if (r.status === 0) return { cmd: cmd[0], prefix: cmd[1].slice(0, -1), version: r.stdout.trim() };
  }
  return null;
}

export function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "video";
}

// Login state lives in a dedicated browser profile the user can delete at any time.
// Default: ~/.video-dl/profile . Override with VIDEO_DL_PROFILE. Never inside the repo.
export function profileDir() {
  const home = process.env.USERPROFILE || process.env.HOME || ".";
  return process.env.VIDEO_DL_PROFILE || path.join(home, ".video-dl", "profile");
}
export function hasProfile() { return fs.existsSync(path.join(profileDir(), "Default")); }

// Launch options shared by all browser backends. headless=false opens a visible window (for login).
export function launchOpts({ headless = true, useProfile = true } = {}) {
  // ignoreDefaultArgs drops --enable-automation so sites (xiaohongshu) do not flag the window as a bot during QR login
  const opts = { executablePath: findBrowser(), headless, ignoreDefaultArgs: ["--enable-automation"], args: ["--disable-gpu", "--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled"] };
  if (useProfile && (hasProfile() || !headless)) { fs.mkdirSync(profileDir(), { recursive: true }); opts.userDataDir = profileDir(); }
  return opts;
}

const BOOL_FLAGS = ["--keep-parts", "--browser", "--ytdlp", "--list", "--yes", "--no-profile", "--playlist", "--dry-run"];
const VAL_FLAGS = ["--name", "--wait", "--quality", "--format", "--limit", "--since", "--profile"];

export function parseArgs(argv, self) {
  const url = argv.find((a) => /^https?:\/\//.test(a));
  if (!url) { console.error(`usage: node ${self} <url> [outdir] [--quality <height>] [--format <id>] [--list] [--name <basename>] [--playlist] [--limit N] [--yes] [--no-profile] [--keep-parts] [--wait <sec>]`); process.exit(2); }
  const flagVal = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const consumed = new Set([url, ...BOOL_FLAGS]);
  for (const k of VAL_FLAGS) { const i = argv.indexOf(k); if (i >= 0) { consumed.add(k); consumed.add(argv[i + 1]); } }
  const outdir = argv.find((a) => !consumed.has(a) && !a.startsWith("--")) || ".";
  if (flagVal("--profile")) process.env.VIDEO_DL_PROFILE = flagVal("--profile");
  return {
    url, outdir, forcedName: flagVal("--name"), keepParts: argv.includes("--keep-parts"), wait: Number(flagVal("--wait") || 15),
    quality: flagVal("--quality"), format: flagVal("--format"), list: argv.includes("--list"),
    forceBrowser: argv.includes("--browser"), forceYtdlp: argv.includes("--ytdlp"),
    useProfile: !argv.includes("--no-profile"),
    playlist: argv.includes("--playlist"), limit: Number(flagVal("--limit") || 20), since: flagVal("--since"), yes: argv.includes("--yes"), dryRun: argv.includes("--dry-run"),
  };
}
