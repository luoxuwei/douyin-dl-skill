---
name: video-tools-update
description: 给 video-dl、transcribe、video-notes 三个 Skill 做定期体检和升级：检查 yt-dlp、faster-whisper、puppeteer-core 有没有新版，抖音等站点的下载路径还通不通，网上有没有新的平台支持或更好的转写模型，然后出一份报告，用户确认后升级并记录。用户说"检查一下视频工具有没有更新""视频下载技能该升级了""/video-tools-update"时触发；video-dl 开工时发现上次体检超过 30 天也会建议跑一次。
argument-hint: "[--check-only]"
user-invocable: true
allowed-tools: Bash(*), Read, Write, Edit, Glob, WebSearch, WebFetch, Agent, AskUserQuestion
---

# video-tools-update · 让工具跟着外面走

工具目录：`${CLAUDE_SKILL_DIR}/../video-dl/`（脚本、依赖、`经验.md`、`CHANGELOG.md`、`最近体检.json`）。

## 原则

- AI 发现并提议，用户拍板，AI 执行并记录。**不自动改脚本，不自动提交。**
- 每次体检的结论写 `最近体检.json`（日期、各项结果）；每次实际改动写 `CHANGELOG.md` 和 `经验.md`。
- 升级前先跑通"升级前基线"，升级后再跑一遍同样的检查，不通就回滚。

## 第一部分：本地自检（不联网也能跑）

逐项跑，结果记成表：

| 项 | 怎么查 | 通过标准 |
| --- | --- | --- |
| yt-dlp 版本 | `python -m yt_dlp --version`，对比 `pip index versions yt-dlp` 的最新版 | 落后超过 2 个月标"建议升级"。yt-dlp 每月都修站点解析器，落后就是失效的主因 |
| faster-whisper | venv 里 `pip index versions faster-whisper` | 有新版标"可升级"；大版本变化查 changelog 再定 |
| puppeteer-core | `npm outdated` | 同上 |
| ffmpeg | `ffmpeg -version` 首行 | 只记录，一般不用动 |
| 抖音单视频 | `node scripts/video-dl.mjs <经验里记的测试链接> /tmp/x --no-profile` | `muxed ->` 出现 |
| B 站单视频 | 同上一条测试链接，`--quality 360` | `[Merger]` 出现 |
| 抖音主页列表 | 有登录 profile 时 `--dry-run --limit 3` | 列出 3 条 |
| 小红书单视频 | 有登录 profile 时 | `copied ->` 或 `muxed ->` |
| 转写 | venv 跑 `transcribe.py` 一个 10 秒音频 | 输出 segments |
| 登录态 | `login.mjs --status` | 记录哪些站有 cookie，过期的提示重新登录 |

测试链接放 `最近体检.json` 的 `test_urls`，第一次由用户给或用经验里的。

## 第二部分：联网跟进（需要网络）

起两个子代理并行查，各限 800 字，只要可执行的结论：

1. **下载生态**：yt-dlp 最近两个 release 的 changelog 里有没有抖音、B 站、小红书、YouTube、微博、快手的解析器变动；GitHub 上 `yt-dlp` 的 issue 里这几个站点有没有新的失效报告；有没有新出现的、值得支持的平台（用户群里常见的），以及社区对它的下载方法。
2. **转写生态**：faster-whisper 和 Whisper 系列有没有新模型（large-v3-turbo 之类）、速度和中文准确率对比；有没有中文场景更好的开源转写模型（如 FunASR、SenseVoice），以及它们和 faster-whisper 的接口差异。

查到的东西按"值得做 / 观望 / 不做"三档整理，每条给理由和预估改动量。

## 第三部分：报告和决定

用 AskUserQuestion 把报告交给用户，选项：全部升级、只升级依赖不改脚本、只看不动。

报告格式：

```
## 视频工具体检 · YYYY-MM-DD
### 自检
| 项 | 结果 | 建议 |
### 外面的变化
- 值得做：...
- 观望：...
### 建议的改动
1. ...（改哪个文件，多大）
```

## 第四部分：执行（用户确认后）

1. 记基线：把自检结果存 `最近体检.json`。
2. 升级依赖：`pip install -U yt-dlp`、venv 里 `pip install -U faster-whisper`、`npm update`。
3. 改脚本：按报告逐项做，每项改完跑对应的自检。
4. 复检：第一部分全跑一遍，对比基线。有退步就回滚那一项。
5. 记录：`CHANGELOG.md` 加一节（日期、升级了什么、改了什么、复检结果）；新踩的坑进 `经验.md`；`最近体检.json` 更新日期。
6. 同步：改动在仓库目录做，然后复制到 `~/.claude/skills/` 的三个目录；提交推送由用户决定。

## 什么时候跑

- 用户主动说。
- video-dl 开工时看 `最近体检.json` 的日期，超过 30 天提醒一句"视频工具 N 天没体检了，要不要先跑 /video-tools-update"，用户说不用就继续。
- 某个站点连续两次下载失败且 `经验.md` 里没有对应条目，先跑第一部分自检再排查。

## 硬约束

- 不自动改脚本、不自动提交、不自动升级大版本。
- 升级失败要能回滚：pip 记原版本号，npm 靠 lockfile。
- 联网查到的方法要自己跑通再写进脚本，不抄没验证的代码。
