# video-dl

一个入口下载抖音、B 站、YouTube 等平台的视频。Claude Code Skill，也能当普通命令行用。

```
node scripts/video-dl.mjs <链接> [输出目录] [--quality 720] [--name 文件名] [--ytdlp | --browser] [--keep-parts]
```

## 它怎么选后端

| 站点 | 后端 | 为什么 |
| --- | --- | --- |
| 抖音 | `douyin-dl.mjs`：无头 Edge/Chrome 打开页面，从网络请求截到画面流和声音流，带页面 cookie 下载，ffmpeg 合并 | 抖音对非浏览器客户端返回 403，yt-dlp 报 "Fresh cookies are needed"，浏览器开着时它又读不了 cookie 库。真浏览器自己把签名、指纹、cookie 校验都过了 |
| 其他站点 | yt-dlp 优先（自动传 ffmpeg 位置，合并音视频，`--quality` 限清晰度） | yt-dlp 支持几千个站点，HLS/DASH 切片、字幕、清晰度选择都现成 |
| yt-dlp 失败的站点 | `browser-dl.mjs`：通用浏览器截流，截任何直出的 mp4/m4a 流 | 兜底。对走 HLS/DASH 切片或要登录的站点无效 |

`--ytdlp` 和 `--browser` 可以强制指定后端。

## 已验证（2026-09-25）

| 站点 | 结果 |
| --- | --- |
| 抖音 | 可用，不需要登录 |
| B 站 | 可用，yt-dlp 合并音视频，`--quality 480` 生效 |
| YouTube | 脚本正常，但本机代理会切断 Python 的 TLS 连接；换网络可用 |
| 小红书 | 未登录会被重定向到登录页，截不到流。本工具不做登录 |
| 微博、快手 | yt-dlp 不支持或解析器失效，浏览器截流也没截到，暂不可用 |

## 安装

```bash
git clone https://github.com/luoxuwei/douyin-dl-skill video-dl
cd video-dl && npm install       # 只装 puppeteer-core，不下载浏览器
pip install yt-dlp               # 非抖音站点需要
```

依赖：Node 18 以上；Edge 或 Chrome（Windows 自带 Edge，其他系统找不到就设 `BROWSER_PATH`）；ffmpeg（Windows `winget install Gyan.FFmpeg`，脚本会自动找 winget 的安装位置；没有 ffmpeg 也能下，两路流分开保存）。

## 作为 Claude Code Skill

```bash
git clone https://github.com/luoxuwei/douyin-dl-skill ~/.claude/skills/video-dl
cd ~/.claude/skills/video-dl && npm install
```

Skill 目录必须是真实目录，不能用符号链接或 Windows junction，Claude Code 扫描时会跳过链接目录。装完新开会话，说 `/video-dl <链接>` 或"下载这个视频"。

## 文件

```
scripts/
├─ video-dl.mjs     入口：按域名路由，yt-dlp 失败回退浏览器
├─ douyin-dl.mjs    抖音专用截流
├─ browser-dl.mjs   通用截流（直出 mp4/m4a 的站点）
└─ common.mjs       找浏览器、找 ffmpeg、找 yt-dlp、参数解析
SKILL.md            Claude Code 的操作手册和失败对照表
```

## 限制

- 单个视频，不做列表、主页、合集。
- 不做登录，cookie 只在内存里用；要登录才能看的站点不支持。
- 不碰 DRM 内容。
- 视频版权归原作者，仅供个人学习和笔记使用。

## License

MIT
