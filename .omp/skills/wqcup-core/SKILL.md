---
name: wqcup-core
description: WQCup 授权 CTF 比赛控制、并发、状态与证据协议。用于多题并发、多 solver race、平台轮询/提交、共享 FACT/INTENT 状态和可复现验证。
---

# WQCup Core

## Control plane
比赛平台控制永远走 `python3 tools/wqctl.py`：
- `sync`：查询并对账题目状态。
- `watch`：固定轮询，不消耗 LLM 上下文。
- `reset <qid>`：仅交互/容器题，执行后自动再 sync。
- `submit <qid> <flag>`：URL 参数由程序编码；只有平台确认才 solved。
- `prepare-run <qid> --lane <label>`：创建隔离 solver 工作目录。
- `fetch <qid>`：下载附件到 challenge attachments 目录。

Token 只来自环境或 `.env`；绝不写进 prompt、STATE.md、日志或 Git。

## Category skill routing
若对应目录存在，solver 在开始阶段读取该 skill 的 `SKILL.md`：
- pwn -> `.omp/skills/ctf-pwn/SKILL.md`
- reverse/rev -> `.omp/skills/ctf-reverse/SKILL.md`
- web -> `.omp/skills/ctf-web/SKILL.md`
- crypto -> `.omp/skills/ctf-crypto/SKILL.md`
- forensics -> `.omp/skills/ctf-forensics/SKILL.md`
- misc -> `.omp/skills/ctf-misc/SKILL.md`
- ai/ml -> `.omp/skills/ctf-ai-ml/SKILL.md`
- malware -> `.omp/skills/ctf-malware/SKILL.md`
- osint -> `.omp/skills/ctf-osint/SKILL.md`

没有匹配 skill 也继续，用 OMP 原生工具/MCP，不要因此停止。

## Two-dimensional concurrency
并发分两维：
1. Challenge parallelism：多个不同题并行，优先扩大得分覆盖面。
2. Solver race：同一题有价值时再增加 fresh solver。

默认先“多题单 solver”，再对高价值 stalled 题增加第二 solver。禁止一开始每题开满。

同题多个 solver 必须：
- 独立 run_dir；
- 共享只读 STATE.md；
- 策略有差异；
- first verified candidate wins；
- 兄弟 run 在 winner 确认后停止。

## Evidence model
FACT：工具/程序/服务/确定性计算直接支持。
HYPOTHESIS：待验证。
REJECTED：已被证伪且记录原因。
ARTIFACT：可重放脚本、payload、dump、日志路径。
Candidate ≠ solved。平台 accepted/reconciled 才 solved。

## Context hygiene
STATE.md 是压缩后的事实平面，不是聊天记录。
大输出落盘，只把关键行、地址、hash、offset、路径放进 STATE.md。
fresh solver 应继承事实，不继承整段旧推理。

## Browser Expert lane
在原来的 two-dimensional concurrency 旁边增加一个独立浏览器 lane：

- 主线：`wqcup-solver`，保持主线行为。
- 浏览器：`wqcup-browser-expert`，通过 `chrome-devtools` MCP 操作用户已经登录 ChatGPT 的 Chrome。
- 默认浏览器 lane 并发 = 1；不要和主线 solver 数量绑定。
- Browser Expert 必须先通过：
  `python3 tools/wqctl.py prepare-browser <qid> --lane chatgpt`
  创建独立 `browser_run_dir`。
- `browser_run_dir/browser.json` 提供可上传给浏览器宿主的路径。
- Browser Expert 的完整网页回答只保存在自己的 run_dir；STATE.md 只合并验证后的事实。
- Browser Expert 可以对唯一 exact candidate 调用一次 `wqctl submit`；普通 `wqcup-solver` 仍禁止 submit。
- first platform-verified candidate wins：任一 lane accepted 后，其他 lane 立即停止继续扩大工作。

### Browser safety
Browser Expert 只允许操作 chatgpt.com。
不得读取/点击/关闭用户其他站点标签页。
如果登录态、CAPTCHA、权限弹窗等需要人工干预，返回 STALLED_BROWSER；不得绕过。
