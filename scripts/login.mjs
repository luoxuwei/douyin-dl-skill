#!/usr/bin/env node
// login: open a VISIBLE browser window on a site so the user can log in (QR code, phone, password).
// The session is saved in a dedicated profile directory (~/.video-dl/profile by default) that only
// this tool uses. Nothing is read from the user's normal browser, no password is ever seen by the
// script. Delete the directory to log out everywhere.
//
// usage: node login.mjs <site-or-url>        e.g. node login.mjs xiaohongshu | douyin | bilibili | https://...
//        node login.mjs --status              list which sites have cookies in the profile
//        node login.mjs --clear               delete the profile directory

import fs from "node:fs";
import readline from "node:readline";
import { createRequire } from "node:module";
import { launchOpts, profileDir } from "./common.mjs";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const SITES = {
  xiaohongshu: "https://www.xiaohongshu.com/explore",
  xhs: "https://www.xiaohongshu.com/explore",
  douyin: "https://www.douyin.com/",
  bilibili: "https://www.bilibili.com/",
  weibo: "https://weibo.com/",
  youtube: "https://www.youtube.com/",
};
const arg = process.argv[2];
if (!arg) { console.error("usage: node login.mjs <xiaohongshu|douyin|bilibili|weibo|youtube|url> | --status | --clear"); process.exit(2); }

if (arg === "--clear") {
  fs.rmSync(profileDir(), { recursive: true, force: true });
  console.log("profile removed:", profileDir());
  process.exit(0);
}

if (arg === "--status") {
  if (!fs.existsSync(profileDir())) { console.log("no profile yet:", profileDir()); process.exit(0); }
  const b = await puppeteer.launch(launchOpts({ headless: true }));
  const cookies = await (await b.newPage()).browser().cookies?.() ?? [];
  const hosts = {};
  for (const c of cookies) { const h = c.domain.replace(/^\./, "").split(".").slice(-2).join("."); hosts[h] = (hosts[h] || 0) + 1; }
  await b.close();
  console.log("profile:", profileDir());
  for (const [h, n] of Object.entries(hosts).sort()) console.log(`  ${h}: ${n} cookies`);
  process.exit(0);
}

const url = SITES[arg.toLowerCase()] || arg;
console.log("profile dir:", profileDir());
console.log("opening a visible browser window for", url);
console.log("log in there (QR code / phone / password). When the page shows you are logged in, come back here and press Enter.");

const browser = await puppeteer.launch(launchOpts({ headless: false }));
const page = (await browser.pages())[0] || (await browser.newPage());
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});

// Wait until the user is logged in (or closes the window). We poll the page for a login marker rather
// than relying on stdin, because stdin may be closed or non-interactive in some terminals.
const hostname = new URL(page.url()).hostname.replace(/^www\./, "");
// only cookies that appear AFTER a real login (anonymous sessions already carry passport_csrf_token, ttwid, a1, etc.)
const LOGIN_COOKIES = { "douyin.com": /^(sessionid|sid_guard|sessionid_ss)$/, "xiaohongshu.com": /^(customer-sso-sid|x-user-id-creator\.xiaohongshu\.com|access-token-creator\.xiaohongshu\.com)$/, "bilibili.com": /^SESSDATA$/, "weibo.com": /^SUB$/, "youtube.com": /^(SID|__Secure-1PSID)$/ };
// some sites (xiaohongshu) set session-looking cookies anonymously; also require the login wall text to be gone
const WALL_TEXT = { "xiaohongshu.com": /登录后推荐更懂你|新用户可直接登录/, "douyin.com": /扫码登录|登录后查看/ };
const marker = Object.entries(LOGIN_COOKIES).find(([h]) => hostname.endsWith(h))?.[1];
const wall = Object.entries(WALL_TEXT).find(([h]) => hostname.endsWith(h))?.[1];
console.log("waiting for login... (close the browser window to abort; this can take as long as you need)");
let loggedIn = false, closed = false;
browser.on("disconnected", () => { closed = true; });
if (process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("or press Enter here once you are logged in... ", () => { rl.close(); loggedIn = true; });
}
const started = Date.now();
while (!loggedIn && !closed && Date.now() - started < 15 * 60 * 1000) {
  await new Promise((r) => setTimeout(r, 2000));
  if (!marker) continue;
  try {
    const cookies = await page.cookies();
    const hasCookie = cookies.some((c) => marker.test(c.name) && c.value.length > 8);
    const wallGone = !wall || !(await page.evaluate((re) => new RegExp(re).test(document.body.innerText.slice(0, 4000)), wall.source).catch(() => true));
    if (hasCookie && wallGone) loggedIn = true;
  } catch {}
}
if (closed) { console.log("browser closed before login was detected; profile kept, run again to retry"); process.exit(1); }
if (!loggedIn) { console.log("timed out after 15 minutes; profile kept, run again to retry"); await browser.close(); process.exit(1); }
await new Promise((r) => setTimeout(r, 3000)); // let the site finish writing its cookies
const cookies = await page.cookies();
console.log(`login detected. saved ${cookies.length} cookies for ${hostname} into the profile`);
await browser.close();
process.exit(0);
