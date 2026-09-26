# video-dl · transcribe · video-notes

三个 Claude Code Skill，把视频变成笔记的整条链路，也都能当普通命令行用。

| Skill | 做什么 | 入口 |
| --- | --- | --- |
| `video-dl` | 下载抖音、小红书、B 站、YouTube 等平台的视频；列格式选清晰度；博主主页或合集批量下载；扫码登录 | `scripts/video-dl.mjs`、`list-dl.mjs`、`login.mjs` |
| `transcribe` | 本地视频或音频的语音转成带时间戳的文字，输出 md / srt / txt / json；没字幕的课程视频直接变笔记 | `scripts/transcribe.py` |
| `video-notes` | 链接或本地视频 → 下载 → 转写 → 抽帧找封面和幻灯片 → 核对资料链接 → Markdown 和 PDF | 编排上面两个，加 `frames.mjs`、`notes-pdf.mjs` |

## video-dl

```
node scripts/video-dl.mjs <链接> [输出目录] [--quality 720 | --format <id>] [--list] [--limit N --since 日期 --dry-run --yes] [--name 文件名] [--no-profile]
node scripts/login.mjs <douyin|xiaohongshu|bilibili|youtube>     # 扫码登录，存到专属 profile
node scripts/login.mjs --status | --clear
```

后端选择：

| 站点 | 后端 | 为什么 |
| --- | --- | --- |
| 抖音 | `douyin-dl.mjs`：无头 Edge/Chrome 打开页面，从网络请求截到画面流和声音流，ffmpeg 合并 | 抖音对非浏览器客户端返回 403；真浏览器自己把签名、指纹、cookie 校验都过了 |
| 小红书 | `browser-dl.mjs`：通用截流 | yt-dlp 解析器失效；所有页面都要登录 |
| 其他站点 | yt-dlp 优先，`--list` 列格式，`--quality` 限清晰度，自动合并音视频 | yt-dlp 支持几千个站点，HLS/DASH、字幕、清晰度都现成 |
| yt-dlp 失败的站点 | `browser-dl.mjs` 兜底 | 对走 HLS/DASH 切片或要登录的站点无效 |

批量：`list-dl.mjs` 先列出清单（抖音、小红书用浏览器滚动收集链接，其他站用 yt-dlp `--flat-playlist`），问你 y/N，默认最多 20 条，逐条调用单视频下载，文件按 `001-标题.mp4` 编号，`_list.json` 汇总。

登录：`login.mjs` 打开可见浏览器窗口让你扫码，每两秒检查一次登录标志，检测到自动关闭。登录态存在 `~/.video-dl/profile`（可用 `VIDEO_DL_PROFILE` 改），只有这个工具用，不读你平时的浏览器；三个后端自动使用，yt-dlp 那条路会临时导出 cookie 文件用完即删。

已验证（2026-09-26）：

| 站点 | 单视频 | 列格式 | 博主主页 / 合集 | 登录 |
| --- | --- | --- | --- | --- |
| 抖音 | 可用，不用登录 | 单路流，无可选 | 可用，要登录 | 扫码通过 |
| 小红书 | 可用，要登录 | 单路流，无可选 | 可用，要登录；图文笔记跳过 | 扫码通过 |
| B 站 | 可用 | 15 种格式 | 分 P 可用；UP 主主页接口连续请求会触发 412 限流，间隔几分钟可用 | 未测 |
| YouTube | 脚本正常，本机代理切断 Python 的 TLS | 同左 | 同左 | 未测 |
| 微博、快手 | 不可用 | | | |

## transcribe

```
.venv-transcribe\Scripts\python.exe scripts\transcribe.py <文件或文件夹> [--outdir 目录] [--lang zh] [--prompt "人名, 术语"] [--model large-v3] [--merge 25] [--cpu]
```

本地跑 faster-whisper，有 NVIDIA 显卡走 GPU（7 分钟视频约 1 分钟），否则 CPU int8。每个输入出四个文件：`.md`（带时间戳段落，直接当笔记）、`.txt`、`.srt`（字幕）、`.asr.json`。`--prompt` 放人名书名术语能明显减少同音字错误，实测把"赵诗玉、张伟南"纠正为"赵世钰、张伟楠"。一次性环境：`powershell -File scripts\setup-transcribe.ps1` 建 `.venv-transcribe`；首次运行下载 large-v3 模型约 3 GB，国内先 `$env:HF_ENDPOINT='https://hf-mirror.com'`。

## video-notes

流水线：`video-dl.mjs` 下载（本地文件跳过）→ `transcribe.py` 转写 → `frames.mjs` 每秒抽帧并拼成带秒数的缩略图 → Claude 看缩略图定位封面、幻灯片、图表，`ffmpeg crop` 裁出 → 子代理核对资料链接 → 按 `skills/video-notes/模板.md` 写 Markdown → `notes-pdf.mjs` 用本机 Edge 转 PDF。示例：两条 5 分钟的抖音书单视频，整理成 13 页 PDF，含 8 本书的封面、作者、核对过的链接和视频里的评价。

## 安装

```bash
git clone https://github.com/luoxuwei/douyin-dl-skill video-dl
cd video-dl && npm install                       # puppeteer-core、markdown-it，不下载浏览器
pip install yt-dlp                               # 非抖音、小红书站点需要
powershell -File scripts/setup-transcribe.ps1    # transcribe 用，建 .venv-transcribe
```

依赖：Node 18 以上；Edge 或 Chrome（找不到设 `BROWSER_PATH`）；ffmpeg（Windows `winget install Gyan.FFmpeg`，脚本会自动找 winget 的安装位置）；Python 3.10 到 3.12。

## 作为 Claude Code Skill

三个 Skill 共用一套脚本，`transcribe` 和 `video-notes` 通过 `../video-dl/` 引用，所以三个目录要并排放在同一个 skills 目录下：

```bash
git clone https://github.com/luoxuwei/douyin-dl-skill ~/.claude/skills/video-dl
cp -r ~/.claude/skills/video-dl/skills/transcribe  ~/.claude/skills/transcribe
cp -r ~/.claude/skills/video-dl/skills/video-notes ~/.claude/skills/video-notes
cd ~/.claude/skills/video-dl && npm install && powershell -File scripts/setup-transcribe.ps1
```

Skill 目录必须是真实目录，不能用符号链接或 Windows junction。装完新开会话，说 `/video-dl <链接>`、`/transcribe <文件>`、`/video-notes <链接或文件>`，或用自然语言："下载这个视频""把这节课转成文字""把这几条视频做成一份 PDF"。

## 文件

```
scripts/
├─ video-dl.mjs           入口：识别链接类型，路由到下面的后端；--list 列格式
├─ list-dl.mjs            批量：列清单、确认、逐条下载
├─ login.mjs              扫码登录到专属 profile
├─ douyin-dl.mjs          抖音截流
├─ browser-dl.mjs         通用截流
├─ common.mjs             找浏览器、ffmpeg、yt-dlp；profile；参数解析
├─ transcribe.py          语音转文字（faster-whisper）
├─ setup-transcribe.ps1   建 .venv-transcribe
├─ frames.mjs             抽帧加带秒数的缩略图
└─ notes-pdf.mjs          Markdown 转 PDF
SKILL.md                  video-dl 的操作手册
skills/transcribe/        transcribe 的 SKILL.md
skills/video-notes/       video-notes 的 SKILL.md 和笔记模板
```

## 坑

- 小红书笔记链接现在要带 `xsec_token` 参数才能打开，从浏览器地址栏复制完整链接；App 分享的短链有时会跳回首页。
- 小红书和抖音给未登录用户也发一些像会话的 cookie，登录检测只认真正登录后才出现的那几个（`sessionid`、`customer-sso-sid`）加登录墙消失。
- 浏览器带 `--enable-automation` 时小红书扫码会提示"重新扫码"，已在启动参数里去掉。
- 上一次的登录浏览器没关时，再启动会报 `browser is already running for ...profile`，关掉那个窗口即可。
- Windows 上 ctranslate2 找不到 `cublas64_12.dll`：`transcribe.py` 会把 torch 和 nvidia 包的 lib 目录加进搜索路径；`setup-transcribe.ps1` 装了 `nvidia-cublas-cu12`、`nvidia-cudnn-cu12`。
- ffmpeg `drawtext` 在 Windows 上要显式指定字体文件，`frames.mjs` 会找 `C:/Windows/Fonts/arial.ttf`。
- 本机代理会切断 Python 的 TLS（YouTube、pypi 偶发）；HTTPS 的 git push 时常 502，改用 SSH 走 443 端口（`~/.ssh/config` 里 `HostName ssh.github.com`、`Port 443`）就稳定。

## 限制

- 不搜索、不推荐、不爬相关视频；批量只针对用户给出的博主或合集，有条数上限。
- 不碰 DRM 内容。转写和抽帧全在本地，音频不上传。
- 视频版权归原作者，仅供个人学习和笔记使用。

## License

MIT
