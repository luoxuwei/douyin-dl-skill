---
name: douyin-dl
description: 下载抖音视频。用户给出 v.douyin.com 分享链接或 douyin.com/video/ 链接，说"下载这个抖音视频""把这条抖音存下来"时触发。用本机 Edge/Chrome 无头打开页面截取音视频流，再用 ffmpeg 合并成一个 mp4；yt-dlp 在抖音上会被 403 拦截，本 Skill 是替代方案。不需要登录，cookie 只在内存里用。
argument-hint: "<抖音链接> [输出目录]"
user-invocable: true
allowed-tools: Bash(node *), Bash(ffmpeg *), Read, Glob
---

# douyin-dl · 下载抖音视频

## 做什么

```
node ${CLAUDE_SKILL_DIR}/scripts/douyin-dl.mjs <链接> [输出目录] [--name 文件名] [--keep-parts]
```

- 链接：`https://v.douyin.com/xxxx/` 分享短链或 `https://www.douyin.com/video/<id>`。用户从抖音 App 复制的那段"复制此链接，打开Dou音搜索"文案里，把 `https://v.douyin.com/...` 那一段取出来即可。
- 输出目录默认当前目录。产物：`<标题>.mp4`（画面加声音）和 `<标题>.json`（视频 id、标题、下载时间）。
- 第一次运行前在 Skill 目录 `npm install`（只装 puppeteer-core，不下浏览器）。

## 步骤

1. 从用户消息里取出链接。多个链接逐个跑。
2. 跑上面的命令。看输出里的 `streams captured:`，正常是 2（画面和声音分离）；`muxed ->` 出现即成功。
3. 成功后告诉用户文件路径和时长（`ffmpeg -i 文件 2>&1 | grep Duration`）。
4. 失败按下面的表处理，不要反复重试同一命令。

## 失败怎么办

| 输出 | 原因 | 处理 |
| --- | --- | --- |
| `No Edge/Chrome found` | 没找到浏览器 | 让用户告诉浏览器路径，`BROWSER_PATH=... node ...` |
| `streams captured: 0` | 页面没加载出播放器：视频私密、需要登录、或抖音改版 | 先用 `--keep-parts` 看临时目录有没有东西；让用户在浏览器里确认链接能正常看；改版则把 `page.on("response")` 里的匹配规则放宽 |
| `ffmpeg not found; saved raw parts` | 没有 ffmpeg | 下载已完成，两路流分开存着。装 ffmpeg（Windows `winget install Gyan.FFmpeg`）后用 `ffmpeg -i part0 -i part1 -c copy out.mp4` 合并，或设 `FFMPEG` 环境变量重跑 |
| `HTTP 403` 下载流时 | 流地址过期（几分钟有效） | 直接重跑，脚本每次重新截取 |

## 硬约束

- 只下载用户明确给出链接的视频，不爬列表、不批量抓号。
- cookie 不写盘，不打印，不发给任何服务。
- 下载的视频归原作者，只做个人学习和笔记用，提醒用户不要二次分发。
- 不装 yt-dlp 去试，它在抖音上会失败，浪费时间。

## 常见后续

下完通常是要做笔记：`ffmpeg -i x.mp4 -vn -ac 1 -ar 16000 x.wav` 提音频给 Whisper 转写；`ffmpeg -i x.mp4 -vf fps=1 帧/%04d.jpg` 每秒抽一帧找截图。这两步不在本 Skill 里，按用户需要做。
