---
name: video-dl
description: 下载视频。用户给出抖音、B 站、YouTube 或其他视频网站的链接，说"下载这个视频""把这条抖音存下来""把这个 B 站视频下下来"时触发。一个入口自动选后端：抖音走无头浏览器截流（yt-dlp 在抖音上会被 403 拦截），其他站点先走 yt-dlp，失败再回退到浏览器截流。不需要登录，cookie 只在内存里用。
argument-hint: "<视频链接> [输出目录] [--quality 720]"
user-invocable: true
allowed-tools: Bash(node *), Bash(ffmpeg *), Bash(python -m yt_dlp *), Read, Glob
---

# video-dl · 下载视频

## 做什么

```
node ${CLAUDE_SKILL_DIR}/scripts/video-dl.mjs <链接> [输出目录] [--quality 720] [--name 文件名] [--ytdlp | --browser] [--keep-parts]
```

- 链接：抖音分享短链 `https://v.douyin.com/xxxx/`、B 站 `BV` 链接、YouTube、或任何 yt-dlp 支持的站点。用户从 App 复制的一段文案里，把 `https://` 开头那段取出来即可。
- 输出目录默认当前目录。产物：`<标题>.mp4` 和 `<标题>.json`（yt-dlp 路径是 `.yt-dlp-meta.txt`）。
- `--quality 720` 限制最高分辨率（只对 yt-dlp 路径有效），做笔记用 480 或 720 够了，省流量。
- 第一次运行前在 Skill 目录 `npm install`；yt-dlp 用 `pip install yt-dlp`。

## 路由（脚本自动做，这里让你知道它在干什么）

| 站点 | 后端 | 原因 |
| --- | --- | --- |
| 抖音 douyin.com | `douyin-dl.mjs` 浏览器截流 | yt-dlp 被 403 拦截 |
| 小红书 xiaohongshu.com | `browser-dl.mjs` | yt-dlp 的解析器已失效；但小红书网页版要登录才能看，目前截不到，见下 |
| B 站、YouTube、其他 | yt-dlp，失败回退 `browser-dl.mjs` | yt-dlp 支持几千个站点，选清晰度、合并音视频都现成 |

## 步骤

1. 从用户消息里取出链接。多个链接逐个跑。
2. 跑上面的命令。成功标志：yt-dlp 路径看到 `[Merger] Merging formats into`；浏览器路径看到 `muxed ->`。
3. 成功后告诉用户文件路径和时长（`ffmpeg -i 文件 2>&1 | grep Duration`）。
4. 失败按下表处理，不要反复重试同一命令。

## 失败怎么办

| 输出 | 原因 | 处理 |
| --- | --- | --- |
| `yt-dlp not found` | 没装 | `pip install yt-dlp`，装完重跑 |
| `Unsupported URL` | yt-dlp 不认这个站 | 脚本会自动回退浏览器；若浏览器也失败，说明该站要登录或用 HLS，告诉用户 |
| `SSL: UNEXPECTED_EOF` 或反复 `timed out` | 本机代理对该站的 TLS 有问题，YouTube 常见 | 不是脚本问题。让用户换网络或临时关代理再试；不要反复重试 |
| `No direct media streams captured` | 页面没加载出播放器：要登录、私密、或走 HLS/DASH | 加 `--keep-parts` 看临时目录；让用户在浏览器里确认链接能不登录看；HLS 站点用 `--ytdlp` 强制 |
| `No Edge/Chrome found` | 没找到浏览器 | `BROWSER_PATH=... node ...` |
| `ffmpeg not found; saved raw parts` | 没有 ffmpeg | 两路流已分开保存。装 ffmpeg（`winget install Gyan.FFmpeg`）后 `ffmpeg -i part0 -i part1 -c copy out.mp4` |
| 下载流时 `HTTP 403` | 流地址过期 | 直接重跑，每次重新截取 |

## 已验证的站点（2026-09-25）

- 抖音：可用，无需登录。
- B 站：可用，yt-dlp 自动合并音视频，`--quality` 生效。
- YouTube：脚本没问题，但本机代理会切断 Python 的 TLS 连接，换网络可用。
- 小红书：网页版未登录会跳到登录页，截不到流。要下的话用户得先登录并把 cookie 交给脚本，本 Skill 不做这个。
- 微博、快手：yt-dlp 不支持或解析器失效，浏览器截流也没截到，未验证可用。

## 硬约束

- 只下载用户明确给出链接的视频，不爬列表、不批量抓号、不下整个合集（`--no-playlist` 已写死）。
- cookie 不写盘，不打印，不发给任何服务；不要为了绕登录去导入用户的浏览器 profile。
- 不碰带 DRM 的付费内容（爱奇艺、腾讯视频、优酷会员），任何工具都不该。
- 下载的视频归原作者，只做个人学习和笔记用，提醒用户不要二次分发。

## 常见后续

下完通常是要做笔记：`ffmpeg -i x.mp4 -vn -ac 1 -ar 16000 x.wav` 提音频给 Whisper 转写；`ffmpeg -i x.mp4 -vf fps=1 帧/%04d.jpg` 每秒抽一帧找截图。这两步不在本 Skill 里，按用户需要做。
