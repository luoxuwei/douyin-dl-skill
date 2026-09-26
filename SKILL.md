---
name: video-dl
description: 下载视频。用户给出抖音、B 站、YouTube、小红书或其他视频网站的链接，说"下载这个视频""把这条抖音存下来""把这个博主的视频都下下来""这个视频有哪些清晰度"时触发。一个入口自动选后端：抖音和小红书走无头浏览器截流，其他站点先走 yt-dlp 再回退浏览器。支持列格式选清晰度、按博主主页或合集批量下载（先列出、问确认、有上限）、扫码登录只存在专属 profile。
argument-hint: "<链接> [输出目录] [--quality 720] [--list] [--limit N]"
user-invocable: true
allowed-tools: Bash(node *), Bash(ffmpeg *), Bash(python -m yt_dlp *), Read, Glob, AskUserQuestion
---

# video-dl · 下载视频

## 命令

```
node ${CLAUDE_SKILL_DIR}/scripts/video-dl.mjs <链接> [输出目录] [选项]
```

| 选项 | 作用 |
| --- | --- |
| `--list` | 只列出可选格式（清晰度、编码、大小），不下载。仅 yt-dlp 站点有效 |
| `--quality 720` | 最高分辨率，取 ≤720p 的最佳画面加最佳音频合并。做笔记用 480 或 720 够了 |
| `--format 30064+30280` | 精确指定格式 id，来自 `--list` |
| `--limit N` | 批量下载的条数上限，默认 20 |
| `--since 2026-01-01` | 批量时只要这个日期之后的（有日期信息的站点） |
| `--dry-run` | 批量时只列清单不下载 |
| `--yes` | 批量时跳过确认。**只在用户已经明确看过清单并同意时用** |
| `--name x` | 指定输出文件名 |
| `--no-profile` | 不用登录 profile，匿名访问 |

登录：`node ${CLAUDE_SKILL_DIR}/scripts/login.mjs <douyin|xiaohongshu|bilibili|youtube>`，弹出可见浏览器让用户扫码，检测到登录后自动关闭；`--status` 看已登录哪些站；`--clear` 清掉。

## 步骤

### 单个视频

1. 取出链接。用户从 App 复制的文案里取 `https://` 开头那段。
2. 如果用户关心清晰度，或视频可能很大（B 站、YouTube 长视频），先跑 `--list`，用 AskUserQuestion 让用户在列出的清晰度里选，推荐 720p；用户没提就直接 `--quality 720`。抖音、小红书只有一路流，跳过这步。
3. 跑命令。成功标志：yt-dlp 路径 `[Merger] Merging formats into`；浏览器路径 `muxed ->` 或 `copied ->`。
4. 告诉用户文件路径和时长（`ffmpeg -i 文件 2>&1 | grep Duration`）。

### 博主主页、合集、播放列表

脚本按链接形态自动识别（抖音 `/user/`、B 站 `space.bilibili.com` 或分 P、YouTube 频道或 `list=`、小红书 `/user/profile/`），也可加 `--playlist` 强制。

1. 先 `--dry-run --limit 20` 列清单给用户看：作者、条数、每条的日期时长标题。
2. 用 AskUserQuestion 确认：全下、只下前几条、按日期过滤、还是取消。**没有用户确认不许加 `--yes`。**
3. 按确认结果跑，输出文件按 `001-标题.mp4` 编号，`_list.json` 记录成功和失败。
4. 报告：成功几条、失败几条、目录。

### 需要登录的站点

抖音博主主页、小红书任何页面，脚本会提示 `require login. Run once: node login.mjs <站点>`。这时：

1. 告诉用户要在弹出的浏览器里扫码，说明登录态只存在 `~/.video-dl/profile`，只有这个工具用，随时可以 `login.mjs --clear` 删掉。
2. 从当前会话后台跑 `login.mjs <站点>`（不要用 `start cmd` 另开窗口，那个窗口没有 Node 的 PATH）。它会一直等到检测到登录（最长 15 分钟），用户完成后自动关闭。
3. 重跑原命令。

## 路由

| 站点 | 后端 | 说明 |
| --- | --- | --- |
| 抖音 | 浏览器截流 | yt-dlp 被 403 拦；单视频不用登录，博主主页要登录 |
| 小红书 | 浏览器截流 | yt-dlp 解析器失效；单视频和主页都要登录 |
| B 站、YouTube、其他 | yt-dlp，失败回退浏览器 | 支持 `--list` 和 `--quality`；B 站大会员清晰度要登录后才有 |

## 失败怎么办

| 输出 | 原因 | 处理 |
| --- | --- | --- |
| `require login. Run once: node login.mjs ...` | 该页面要登录 | 按"需要登录的站点"走 |
| `still shows a login wall` / `redirected away from the profile` | 登录过期 | 重跑 `login.mjs <站点>` |
| `Request is blocked by server (412)` / `rejected (352)` | B 站限流，短时间请求太多 | 等几分钟再试，不要连续重试 |
| `SSL: UNEXPECTED_EOF` 或反复 `timed out` | 本机代理对该站的 TLS 有问题，YouTube 常见 | 让用户换网络，不要反复重试 |
| `No direct media streams captured` | 页面没出播放器：私密、走 HLS、或链接需要 token（小红书链接要带 `xsec_token`） | 让用户从浏览器地址栏重新复制完整链接；HLS 站点加 `--ytdlp` |
| `The browser is already running for ...profile` | 上一次的浏览器没关 | 关掉那个 Edge 窗口再跑 |
| `yt-dlp not found` | 没装 | `pip install yt-dlp` |
| `ffmpeg not found; saved raw parts` | 没有 ffmpeg | 两路流已分开保存；装 ffmpeg 后 `-c copy` 合并 |

## 已验证（2026-09-26）

- 抖音：单视频不登录可用；登录后博主主页列 8 条、批量下 2 条通过。
- 小红书：登录后单视频可用（7 秒竖屏短片，画面声音一体）；主页列出笔记并批量下载通过。图文笔记会报截不到流。
- B 站：单视频 `--list` 列出 15 种格式，`--quality 480` 合并通过；分 P 视频按 P 列出；UP 主主页接口在连续探测后触发 412 限流，间隔几分钟可用。
- YouTube：脚本正常，本机代理切断 Python 的 TLS，换网络可用。
- 微博、快手：yt-dlp 不支持或失效，浏览器截流未截到，不可用。

## 用中学：经验日志

`${CLAUDE_SKILL_DIR}/经验.md` 是三个 Skill 共用的踩坑记录。

- **开工前**读最近 20 条，站点相关的先看。
- **下载失败时**先在里面搜同样的现象；有就照解法做，没有再排查。
- **排查完或用户纠正后**必须追加一条：日期、skill、现象、原因、解法、影响。不写等于下次再踩。
- 解法涉及改脚本的，改在 `${CLAUDE_SKILL_DIR}/scripts/`，告诉用户改了什么，提交由用户决定。
- 看一眼 `${CLAUDE_SKILL_DIR}/最近体检.json` 的 `checked_at`，超过 30 天提醒一句"视频工具 N 天没体检了，要不要先跑 /video-tools-update"，用户说不用就继续。

## 硬约束

- 批量下载必须先列清单、用户确认、有上限。不把 `--yes` 当默认。
- 只下载用户给出的链接或该链接对应的博主、合集，不搜索、不推荐、不爬相关视频。
- 登录 profile 只存在 `~/.video-dl/profile`，不读用户平时的浏览器，不打印 cookie，不上传。
- 不碰 DRM 付费内容。视频归原作者，仅供个人学习和笔记，提醒用户不要二次分发。
- 不装 yt-dlp 去试抖音，它会失败。
