# One-time setup for transcribe.py: a private Python venv with faster-whisper (+ CUDA if an NVIDIA GPU is present).
# usage (PowerShell):  .\scripts\setup-transcribe.ps1          # auto-detect GPU
#                      .\scripts\setup-transcribe.ps1 -Cpu     # force CPU-only (smaller, slower)
# Afterwards run:      .\.venv-transcribe\Scripts\python.exe scripts\transcribe.py <file>
param([switch]$Cpu)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root ".venv-transcribe"
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { throw "python not found. Install Python 3.10-3.12 from python.org or Microsoft Store." }
$ver = & python -c "import sys;print(f'{sys.version_info.major}.{sys.version_info.minor}')"
Write-Host "python $ver"
if (-not (Test-Path $venv)) { & python -m venv $venv }
$pip = Join-Path $venv "Scripts\pip.exe"
$pyv = Join-Path $venv "Scripts\python.exe"
& $pyv -m pip install -q -U pip
# China mirror for PyPI if the default is slow: uncomment the next line
# & $pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple
& $pip install -q faster-whisper
$hasGpu = (-not $Cpu) -and (Get-Command nvidia-smi -ErrorAction SilentlyContinue)
if ($hasGpu) {
  Write-Host "NVIDIA GPU detected, installing CUDA runtime libs for ctranslate2"
  & $pip install -q nvidia-cublas-cu12 nvidia-cudnn-cu12
} else {
  Write-Host "no GPU (or -Cpu): transcription will run on CPU with int8; use --model medium for speed"
}
& $pyv -c "import faster_whisper, ctranslate2; print('faster-whisper', faster_whisper.__version__, '| cuda types:', ctranslate2.get_supported_compute_types('cuda') if ctranslate2.get_cuda_device_count() else 'none')"
Write-Host ""
Write-Host "done. run:  $pyv scripts\transcribe.py <video-or-audio> [--lang zh]"
Write-Host "first run downloads the model (large-v3 ~3 GB). In China set:  `$env:HF_ENDPOINT='https://hf-mirror.com'"
