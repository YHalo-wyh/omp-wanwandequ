# WQCup — OMP CTF Autonomous Solver Config

这是一个**纯 WQCup 配置仓库**，给已经安装 OMP 的用户直接使用。仓库不包含 OMP 源码，也不包含任何比赛 Token、会话日志或浏览器 Cookie。

核心结构：

```text
wqcup
├── wqcup-solver × N          # DeepSeek/当前 OMP 主线，多题并发
└── wqcup-browser-expert      # 1 个 Chrome/ChatGPT 网页专家槽位
```

两条路线独立工作，谁先拿到平台验证通过的 candidate，谁结束该题并进入下一题。

## 1. 获取

```bash
git clone https://github.com/YHalo-wyh/omp-wanwandequ.git
cd omp-wanwandequ
```

## 2. 初始化

WSL / Linux：

```bash
python3 setup.py
```

Windows PowerShell：

```powershell
py .\setup.py
```

`setup.py` 会：
- 创建 `.env`；
- 按 Windows / WSL / Linux 自动生成 `.omp/mcp.json`；
- 拉取最新版 `ljagiello/ctf-skills` 中常用 CTF Skills。

## 3. 配置比赛 Token

编辑 `.env`：

```bash
WQCUP_TEAM_TOKEN=你的队伍token
```

不要提交 `.env`。

测试：

```bash
python3 tools/wqctl.py sync
python3 tools/wqctl.py list --unsolved
```

## 4. ChatGPT Browser Expert 一次性准备

1. 用本机 Chrome 登录 `https://chatgpt.com/`。
2. 打开 `chrome://inspect/#remote-debugging` 并启用 Remote Debugging。
3. 确保 Chrome 所在系统可以运行：

```text
npx --version
```

4. 启动 OMP 后测试：

```text
/mcp reload
/mcp test chrome-devtools
```

Browser Expert 只允许操作 `chatgpt.com`。如果登录失效、CAPTCHA、Chrome MCP 断开，它会返回 `STALLED_BROWSER`，DeepSeek/OMP 主线继续，不会一起停。

## 5. 启动

WSL / Linux：

```bash
./wqcup-start.sh
```

通用方式：

```bash
python3 wqcup_start.py
```

Windows：

```powershell
py .\wqcup_start.py
```

进入 OMP 后发送：

```text
用 task 启动 wqcup。接管当前比赛；保持主线并发解题，同时启用一个 ChatGPT Browser Expert 槽位，first verified candidate wins。
```

`Alt+A` 查看 Agent Hub。

## 6. Agent 推荐设置

```text
wqcup
  prewalk OFF
  advisor ON

wqcup-solver
  prewalk OFF
  advisor OFF

wqcup-browser-expert
  prewalk OFF
  advisor OFF
```

## 7. 附件

比赛附件由 `wqctl fetch <qid>` 下载。Browser Expert 使用：

```bash
python3 tools/wqctl.py prepare-browser <qid> --lane chatgpt
```

在 WSL + Windows Chrome 环境中，附件会复制到 Windows `%TEMP%\wqcup-browser\...`，再由 `chrome-devtools-mcp` 的 `upload_file` 上传到 ChatGPT。

完整网页回答保存到：

```text
.wq/challenges/<qid>/browser-runs/<run>/CHATGPT_RESPONSE.md
```

结果摘要保存到 `RESULT.md`。

## 8. 状态与恢复

OMP 自己保存 session/subagent transcript；WQCup 保存 `.wq/board.json`、题目附件、STATE、RESULT 和提交去重记录。

浏览器支线失败不会拖死主线。整机/WSL 重启后，正在运行的进程需要重新启动，但磁盘状态仍在。

## 9. 更新 CTF Skills

```bash
python3 tools/install_ctf_skills.py
```

## 10. 安全/隐私

仓库明确忽略：
- `.env`
- `.wq/`
- `.omp/mcp.json`
- Python cache

不要提交队伍 Token、OMP Session、ChatGPT Cookie、浏览器用户目录。
