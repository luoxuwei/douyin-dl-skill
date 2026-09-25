# douyin-dl

Download a Douyin (抖音) video with a real headless browser. A Claude Code skill, also usable as a plain CLI.

抖音网页版对非浏览器客户端返回 403，yt-dlp 会报 "Fresh cookies are needed"，而浏览器开着时它又读不了 cookie 库。本工具直接用本机的 Edge 或 Chrome 无头打开视频页，从网络请求里截到画面流和声音流（抖音网页版是分开的两个 mp4），带页面 cookie 下载后用 ffmpeg 合并。不需要登录，cookie 只在内存里用，不落盘。

## 用法

```bash
git clone https://github.com/luoxuwei/douyin-dl-skill
cd douyin-dl-skill && npm install          # 只装 puppeteer-core，不下载浏览器
node scripts/douyin-dl.mjs "https://v.douyin.com/xxxx/" ./out
```

输出 `out/<标题>.mp4` 和 `out/<标题>.json`。

参数：`--name 文件名` 指定输出名；`--keep-parts` 保留分离的两路流；环境变量 `BROWSER_PATH` 指定浏览器，`FFMPEG` 指定 ffmpeg 路径。

## 作为 Claude Code Skill

```bash
# 项目级
git clone https://github.com/luoxuwei/douyin-dl-skill .claude/skills/douyin-dl
# 或用户级
git clone https://github.com/luoxuwei/douyin-dl-skill ~/.claude/skills/douyin-dl
cd <那个目录> && npm install
```

然后在 Claude Code 里说 `/douyin-dl https://v.douyin.com/xxxx/`，或直接说"下载这个抖音视频"。

## 依赖

- Node 18 以上（用了内置 `fetch`）
- Edge 或 Chrome（Windows 自带 Edge；macOS 和 Linux 按 `scripts/douyin-dl.mjs` 里的候选路径找，找不到设 `BROWSER_PATH`）
- ffmpeg，用于合并音视频。没有也能下，会保存成两个分离文件。Windows：`winget install Gyan.FFmpeg`

## 原理

1. puppeteer-core 启动本机浏览器（无头），打开视频页，抖音的签名、指纹、cookie 校验由浏览器自己完成。
2. 监听 `response` 事件，记下 Content-Type 为 `video/mp4` 或 `audio/mp4` 且来自 `douyinvod` 域的地址。
3. 调用 `video.play()` 触发流请求，等到截到两路。
4. 用页面的 cookie、Referer 和 UA 用 `fetch` 下载两路到临时目录。
5. `ffmpeg -c copy` 合并，不重编码。

## 限制

- 只支持单个视频链接，不做列表、用户主页、批量。
- 抖音改版可能让流地址的匹配规则失效，改 `page.on("response")` 里的正则即可。
- 视频版权归原作者，本工具仅供个人学习和笔记使用。

## License

MIT
