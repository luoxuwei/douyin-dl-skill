---
name: transcribe
description: 把视频或音频里的语音转成带时间戳的文字。用户给本地的 mp4、mp3、wav、m4a 等文件或一个文件夹，说"转成文字""把这节课的讲解转成笔记""生成字幕""这个录音说了什么"时触发。本地跑 faster-whisper，GPU 优先，不上传任何音频。输出 json、srt、txt、md 四种格式，md 可直接当笔记。
argument-hint: "<文件或文件夹> [--lang zh] [--prompt '人名, 术语']"
user-invocable: true
allowed-tools: Bash(*python* *transcribe.py*), Bash(ffmpeg *), Read, Glob
---

# transcribe · 语音转文字

## 命令

```
<venv python> ${CLAUDE_SKILL_DIR}/../video-dl/scripts/transcribe.py <文件或文件夹> [--outdir 目录] [--lang zh] [--prompt "术语, 人名"] [--model large-v3] [--merge 25] [--cpu]
```

`<venv python>` 是 `${CLAUDE_SKILL_DIR}/../video-dl/.venv-transcribe/Scripts/python.exe`。不存在就先跑一次 `powershell -File ${CLAUDE_SKILL_DIR}/../video-dl/scripts/setup-transcribe.ps1`（装 faster-whisper，有 NVIDIA 显卡会一起装 CUDA 库）。

| 选项 | 作用 |
| --- | --- |
| `--lang zh` | 指定语言，比自动检测稳；中文课程一律加 |
| `--prompt "..."` | 逗号分隔的人名、书名、术语，能显著减少同音字错误。课程视频把课程名、老师名、章节里的专有名词都放进去 |
| `--model medium` | 显存不够或 CPU 跑时用，速度快一倍，准确率略降 |
| `--merge 25` | 把短句合并成约 25 秒一段，笔记好读；要逐句字幕用 `--merge 0` |
| `--outdir` | 输出目录，默认和输入文件放一起 |

## 输出（每个输入文件四个）

| 文件 | 用途 |
| --- | --- |
| `<名>.md` | 带时间戳的段落，标题加一句提示，直接当笔记或粘进第二大脑 |
| `<名>.txt` | 纯文本版本，每段 `[m:ss]` 开头 |
| `<名>.srt` | 字幕，播放器直接加载，也能导进剪辑软件 |
| `<名>.asr.json` | 原始分段，给其他脚本用 |

## 步骤

1. 确认输入是文件还是文件夹；文件夹会处理里面全部音视频。
2. 问清或推断语言；中文加 `--lang zh`。有人名术语就拼进 `--prompt`，用户给的课程名、讲义目录、书名都值得放。
3. 跑命令。输出行 `N segments, m:ss of speech, lang zh (0.99), Ns` 表示成功；`lang` 概率低于 0.8 说明语言可能选错。
4. 打开 `.md` 抽查两三段：人名、书名、数字对不对。常见错法是同音字（沐神李沐写成牧神李牧），发现了用 Edit 改，并建议用户把这些词加进 `--prompt` 重跑。
5. 告诉用户四个文件的路径和转写时长。

## 课程视频做笔记的建议

- 一门课一个文件夹，整个丢进去一次跑完，每节课一个 md。
- `--prompt` 放课程大纲里的术语，效果最明显。
- 转完的 md 顶部按需补三行：课程、第几讲、日期；然后进第二大脑的 `raw/transcripts/`，用 `/ingest` 提炼。
- 一小时课程 GPU 约 8 分钟，CPU 约 1 小时；长课程先用 `--model medium` 试一节。

## 失败怎么办

| 输出 | 原因 | 处理 |
| --- | --- | --- |
| `No module named faster_whisper` | 没建环境 | 跑 `setup-transcribe.ps1` |
| `cuda unavailable ..., falling back to cpu` | 没有 NVIDIA 显卡或 CUDA 库缺 | 能跑，只是慢；要快装 `nvidia-cublas-cu12 nvidia-cudnn-cu12` |
| `cublas64_12.dll is not found` | Windows 上 DLL 路径 | 脚本已自动加 torch 和 nvidia 包的 lib 目录；仍报错就重跑 setup |
| 模型下载卡住 | 访问 huggingface 慢 | `$env:HF_ENDPOINT='https://hf-mirror.com'` 后重跑；代理会截断大文件，必要时 `-u` 掉代理变量 |
| `ffmpeg not found` | 没装 | `winget install Gyan.FFmpeg` |
| 输出全是标点或重复句 | VAD 把音乐当成语音，或语言选错 | 加 `--lang`，或 `--model large-v3` |

## 硬约束

- 全程本地运行，音频不上传。
- 不改原始音视频文件。
- 转写结果标"AI 生成，可能有错"，人名数字引用前核对。
- 课程、讲座内容版权归讲者，仅供个人学习。
