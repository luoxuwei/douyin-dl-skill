#!/usr/bin/env node
// frames: dump one frame per N seconds from a video and build contact sheets, so an agent can look at
// a few overview images to find slides, book covers, code screens, etc., then crop from the exact frame.
//
// usage: node frames.mjs <video> [outdir] [--every 1] [--sheet 80] [--width 320]
//   outdir/NNNN.jpg          frames, NNNN = second index (1-based, matches --every 1)
//   outdir/sheet-K.jpg       contact sheets of --sheet frames each, 10 per row, second index drawn on each tile
// crop later with:  ffmpeg -i outdir/0123.jpg -vf crop=W:H:X:Y cover.jpg

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { findFfmpeg } from "./common.mjs";

const argv = process.argv.slice(2);
const video = argv.find((x) => !x.startsWith("--") && fs.existsSync(x));
if (!video) { console.error("usage: node frames.mjs <video> [outdir] [--every 1] [--sheet 80] [--width 320]"); process.exit(2); }
const val = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d; };
const outdir = argv.find((x, i) => !x.startsWith("--") && x !== video && argv[i - 1]?.startsWith("--") === false) || path.join(path.dirname(video), path.basename(video, path.extname(video)) + "-帧");
const every = val("--every", 1), per = val("--sheet", 80), width = val("--width", 320);
const ffmpeg = findFfmpeg();
if (!ffmpeg) { console.error("ffmpeg not found"); process.exit(1); }
fs.mkdirSync(outdir, { recursive: true });

let r = spawnSync(ffmpeg, ["-y", "-v", "error", "-i", video, "-vf", `fps=1/${every}`, path.join(outdir, "%04d.jpg")]);
if (r.status !== 0) { console.error(r.stderr.toString()); process.exit(1); }
const frames = fs.readdirSync(outdir).filter((f) => /^\d{4}\.jpg$/.test(f)).sort();
console.log(`frames: ${frames.length} (every ${every}s) -> ${outdir}`);

// contact sheets with the frame index burned in (drawtext needs a font; fall back to no label if it fails)
const cols = 10, rows = Math.ceil(per / cols);
let k = 0;
for (let start = 0; start < frames.length; start += per, k++) {
  const n = Math.min(per, frames.length - start);
  const sheet = path.join(outdir, `sheet-${String(k).padStart(2, "0")}-from-${String(start + 1).padStart(4, "0")}.jpg`);
  // drawtext needs an explicit font file on Windows (no fontconfig); the drive colon must be escaped for ffmpeg
  const fontCands = ["C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/msyh.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/System/Library/Fonts/Helvetica.ttc"];
  const font = fontCands.find((f) => fs.existsSync(f));
  const fontArg = font ? `fontfile='${font.replace(/:/g, "\\:")}':` : "";
  const label = `drawtext=${fontArg}text='%{eif\\:n+${start + 1}\\:d}':x=6:y=6:fontsize=28:fontcolor=yellow:box=1:boxcolor=black@0.6`;
  const vfWith = `${label},scale=${width}:-1,tile=${cols}x${Math.ceil(n / cols)}:padding=2:margin=2`;
  const vfNo = `scale=${width}:-1,tile=${cols}x${Math.ceil(n / cols)}:padding=2:margin=2`;
  const args = (vf) => ["-y", "-v", "error", "-start_number", String(start + 1), "-i", path.join(outdir, "%04d.jpg"), "-frames:v", "1", "-vf", `select='lt(n,${n})',${vf}`, "-update", "1", sheet];
  r = spawnSync(ffmpeg, args(vfWith));
  if (r.status !== 0) r = spawnSync(ffmpeg, args(vfNo));
  if (r.status !== 0) { console.error("sheet failed:", r.stderr.toString().slice(0, 200)); continue; }
  console.log(`sheet ${k}: frames ${start + 1}-${start + n} -> ${path.basename(sheet)}`);
}
console.log(`\nlook at the sheet-*.jpg files to find the seconds you want, then open ${outdir}/NNNN.jpg for the exact frame.`);
