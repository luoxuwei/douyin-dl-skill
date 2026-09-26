#!/usr/bin/env python
"""transcribe: speech in any audio/video file -> timestamped text.

Outputs next to the input (or in --outdir):
  <name>.asr.json   segments [{start, end, text}]      machine-readable
  <name>.srt        subtitles                          load into any player / editor
  <name>.txt        "[m:ss] text" one paragraph per segment   paste into notes
  <name>.md         Markdown with a heading and the paragraphs, ready for a notes doc

usage:
  python transcribe.py <file-or-dir> [--outdir D] [--lang zh] [--model large-v3] [--prompt "术语, 人名"] [--cpu] [--merge 25]

Engine: faster-whisper (CTranslate2). GPU if available (float16), else CPU (int8, slower but works).
Model is downloaded on first run to the HuggingFace cache (large-v3 ~3 GB; use --model medium or small for
a lighter download). Set HF_ENDPOINT=https://hf-mirror.com in China if huggingface.co is slow.
"""
import argparse, json, os, sys, subprocess, tempfile, shutil, time
from pathlib import Path

MEDIA = {".mp4", ".mkv", ".mov", ".avi", ".webm", ".flv", ".m4v", ".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma"}


def find_ffmpeg():
    if os.environ.get("FFMPEG") and Path(os.environ["FFMPEG"]).exists():
        return os.environ["FFMPEG"]
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    local = os.environ.get("LOCALAPPDATA")
    if local:
        pk = Path(local) / "Microsoft" / "WinGet" / "Packages"
        if pk.exists():
            for d in pk.iterdir():
                if d.name.startswith("Gyan.FFmpeg"):
                    for bin_ in d.glob("*/bin/ffmpeg.exe"):
                        return str(bin_)
    return None


def to_wav(src: Path, ffmpeg: str) -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="transcribe-")) / (src.stem + ".wav")
    subprocess.run([ffmpeg, "-y", "-v", "error", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000", str(tmp)], check=True)
    return tmp


def add_cuda_dlls():
    """ctranslate2 on Windows needs cublas/cudnn DLLs on the search path; torch's lib dir has them."""
    if sys.platform != "win32":
        return
    try:
        import torch  # noqa
        lib = Path(torch.__file__).parent / "lib"
        if lib.exists():
            os.add_dll_directory(str(lib))
            os.environ["PATH"] = str(lib) + os.pathsep + os.environ.get("PATH", "")
    except Exception:
        pass
    for pkg in ("nvidia/cublas/bin", "nvidia/cudnn/bin"):
        for sp in sys.path:
            p = Path(sp) / pkg
            if p.exists():
                os.add_dll_directory(str(p))
                os.environ["PATH"] = str(p) + os.pathsep + os.environ.get("PATH", "")


def fmt_ts(sec: float, srt=False) -> str:
    h, rem = divmod(int(sec), 3600)
    m, s = divmod(rem, 60)
    if srt:
        ms = int(round((sec - int(sec)) * 1000))
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def merge_segments(segs, max_len: int):
    """Merge consecutive short segments into paragraphs of roughly max_len seconds for readable notes."""
    if max_len <= 0:
        return segs
    out, cur = [], None
    for s in segs:
        if cur is None:
            cur = dict(s)
            continue
        if s["end"] - cur["start"] <= max_len and not cur["text"].endswith(("。", "！", "？", ".", "!", "?")):
            cur["end"] = s["end"]
            cjk = bool(cur["text"]) and ord(cur["text"][-1]) > 0x2E7F  # CJK text joins without a space
            cur["text"] = (cur["text"] + ("" if cjk or cur["text"][-1:] in "，,、" else " ") + s["text"]).strip()
        else:
            out.append(cur)
            cur = dict(s)
    if cur:
        out.append(cur)
    return out


def tidy(text: str, lang: str) -> str:
    """Whisper emits half-width punctuation inside Chinese; switch to full-width for zh/ja."""
    if lang not in ("zh", "ja", "yue"):
        return text
    for a, b in ((",", "，"), ("?", "？"), ("!", "！"), (":", "："), (";", "；")):
        text = text.replace(a, b)
    text = text.replace("， ", "，").replace("。 ", "。").replace("？ ", "？").replace("！ ", "！")
    return text.replace("，，", "，")


def write_outputs(segs, base: Path, title: str, merge: int):
    json.dump(segs, open(base.with_suffix(".asr.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    with open(base.with_suffix(".srt"), "w", encoding="utf-8") as f:
        for i, s in enumerate(segs, 1):
            f.write(f"{i}\n{fmt_ts(s['start'], True)} --> {fmt_ts(s['end'], True)}\n{s['text']}\n\n")
    paras = merge_segments(segs, merge)
    with open(base.with_suffix(".txt"), "w", encoding="utf-8") as f:
        f.write("\n\n".join(f"[{fmt_ts(p['start'])}] {p['text']}" for p in paras) + "\n")
    with open(base.with_suffix(".md"), "w", encoding="utf-8") as f:
        f.write(f"# {title}\n\n> 语音转文字，faster-whisper 生成，人名和专业术语可能有同音字错误，引用前核对。\n\n")
        f.write("\n\n".join(f"**[{fmt_ts(p['start'])}]** {p['text']}" for p in paras) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("--outdir")
    ap.add_argument("--lang", default=None, help="zh / en / ja ...; default auto-detect")
    ap.add_argument("--model", default="large-v3")
    ap.add_argument("--prompt", default="", help="comma-separated names/terms to bias recognition")
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--merge", type=int, default=25, help="merge segments into paragraphs up to N seconds (0 = off)")
    a = ap.parse_args()

    src = Path(a.input)
    files = sorted(p for p in src.iterdir() if p.suffix.lower() in MEDIA) if src.is_dir() else [src]
    if not files:
        sys.exit("no media files found")
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        sys.exit("ffmpeg not found (winget install Gyan.FFmpeg, or set FFMPEG)")

    add_cuda_dlls()
    from faster_whisper import WhisperModel
    device, ctype = ("cpu", "int8") if a.cpu else ("cuda", "float16")
    try:
        model = WhisperModel(a.model, device=device, compute_type=ctype)
    except Exception as e:  # no CUDA or DLL trouble -> CPU
        if device == "cuda":
            print(f"cuda unavailable ({str(e)[:80]}), falling back to cpu int8", flush=True)
            model = WhisperModel(a.model, device="cpu", compute_type="int8")
        else:
            raise
    print(f"model {a.model} on {model.model.device if hasattr(model, 'model') else device}", flush=True)

    outdir = Path(a.outdir) if a.outdir else None
    if outdir:
        outdir.mkdir(parents=True, exist_ok=True)
    prompt = a.prompt.strip() or None
    for f in files:
        t0 = time.time()
        wav = to_wav(f, ffmpeg)
        try:
            segs_iter, info = model.transcribe(str(wav), language=a.lang, beam_size=5, vad_filter=True, initial_prompt=prompt)
            segs = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": tidy(s.text.strip(), info.language)} for s in segs_iter if s.text.strip()]
        finally:
            shutil.rmtree(wav.parent, ignore_errors=True)
        base = (outdir / f.stem) if outdir else f.with_suffix("")
        write_outputs(segs, base, f.stem, a.merge)
        dur = segs[-1]["end"] if segs else 0
        print(f"{f.name}: {len(segs)} segments, {fmt_ts(dur)} of speech, lang {info.language} ({info.language_probability:.2f}), {time.time() - t0:.0f}s -> {base}.md", flush=True)


if __name__ == "__main__":
    main()
