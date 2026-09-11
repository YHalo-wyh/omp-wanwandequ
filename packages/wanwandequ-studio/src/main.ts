import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";

type StudioStatus = {
  api_key: boolean;
  team_token: boolean;
  running: boolean;
  workspace: string;
  agent_path: string | null;
  provider: string;
  preset: string;
  model_id: string;
  query_url: string;
  reset_url: string;
  submit_url: string;
};

type FileEntry = { name: string; path: string; is_dir: boolean; size: number };
type FilePreview = { name: string; path: string; size: number; text: string | null; binary: boolean; truncated: boolean };
type ChallengeView = {
  question_id: string;
  title: string;
  category: string;
  visits: number;
  solved: boolean;
  last_status: string | null;
  last_attempt_at: number | null;
  last_elapsed_ms: number | null;
  facts: number;
  rejected: number;
  artifacts: number;
  rejected_flags: number;
  handoff: string | null;
  active: boolean;
};
type DashboardSnapshot = {
  started_at: number | null;
  solved: number;
  total: number;
  accepted_submits: number;
  rejected_submits: number;
  active: number;
  last_event_seq: number;
  last_event_at: number | null;
  running: boolean;
  challenges: ChallengeView[];
};
type ToolObservation = { id: number; ts: number; name: string; summary: string; status: "运行" | "完成" };

type ViewName = "chat" | "file" | "terminal";
type InspectorName = "run" | "tools" | "context" | "config";

const DEFAULT_QUERY_URL = "https://apiterminator.ichunqiu.com/04cb510e425bd8f64fa97ba66f3935e1";
const DEFAULT_RESET_URL = "https://apiterminator.ichunqiu.com/deed3dba39e57b7cf95ea63ddd84e0c8";
const DEFAULT_SUBMIT_URL = "https://apiterminator.ichunqiu.com/ff874ef3172cbf4fd6ec2c5653a568e2";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
<div class="studio-shell">
  <header class="titlebar">
    <div class="brand">
      <div class="brand-logo">WQ</div>
      <div class="brand-copy"><strong>万万得取 Studio</strong><span>OMP-Wanwandequ · CTF 智能工作台</span></div>
    </div>
    <div class="titlebar-center"><span class="status-dot"></span><span id="runtimeText">OMP Agent 未运行</span></div>
    <div class="title-actions">
      <button id="doctorBtn" class="btn ghost">环境检查</button>
      <button id="stopBtn" class="btn ghost danger-text">停止</button>
      <button id="chatStartBtn" class="btn secondary">测试对话</button>
      <button id="competitionBtn" class="btn primary">正式比赛</button>
    </div>
  </header>

  <div class="workbench">
    <nav class="activity-rail" aria-label="主导航">
      <button class="rail-btn active" data-rail="workspace" title="工作区">▣</button>
      <button class="rail-btn" id="railChat" title="对话">◈</button>
      <button class="rail-btn" id="railTerminal" title="原生终端">›_</button>
      <div class="rail-spacer"></div>
      <button class="rail-btn" id="railConfig" title="配置">⚙</button>
    </nav>

    <aside class="explorer panel-frame">
      <div class="panel-title-row">
        <div><span class="eyebrow">工作区</span><strong>资源管理器</strong></div>
        <div class="icon-actions"><button id="refreshBtn" title="刷新">↻</button><button id="chooseBtn" title="选择工作区">＋</button></div>
      </div>
      <button id="workspacePath" class="workspace-root" title="切换工作区"><span class="root-icon">⌂</span><span class="root-text">尚未选择工作区</span><span>⌄</span></button>
      <div class="tree-toolbar"><span id="treeHint">点击文件可直接预览</span><span id="treeCount">0 项</span></div>
      <div id="fileTree" class="file-tree"><div class="empty-state compact"><b>还没有工作区</b><span>点击右上角 ＋ 选择题目目录</span></div></div>
      <div class="explorer-footer">
        <button id="solveBtn" class="btn wide secondary">分析当前工作区</button>
      </div>
    </aside>

    <main class="main-stage panel-frame">
      <div class="stage-tabs">
        <button class="stage-tab active" data-view="chat"><span>◈</span> 对话</button>
        <button class="stage-tab" data-view="file"><span>≡</span> <span id="fileTabName">文件预览</span></button>
        <button class="stage-tab" data-view="terminal"><span>›_</span> OMP 原生终端</button>
        <div class="stage-spacer"></div>
        <span id="modeBadge" class="mode-badge test">测试模式</span>
      </div>

      <section id="chatView" class="stage-view chat-view active">
        <div id="chatTimeline" class="chat-timeline">
          <div class="welcome-card">
            <div class="welcome-icon">WQ</div>
            <div><h2>直接和 OMP Agent 对话</h2><p>这里不是另起一个模型。你的输入会原样送进 OMP 的 PTY，会话、工具、MCP、Subagent 和原生终端能力全部保留。</p></div>
          </div>
          <div class="system-note"><span>只读观测</span> Studio 只镜像 Agent 输出与工具迹象，不接管 OMP 的推理和执行链。</div>
        </div>
        <div class="composer-wrap">
          <div class="composer-status"><span id="composerMode">测试对话 · 原生 OMP 会话</span><span>Ctrl / ⌘ + Enter 发送</span></div>
          <div class="composer">
            <textarea id="promptInput" rows="3" placeholder="把题目、分析目标或下一步操作直接交给 OMP Agent…"></textarea>
            <div class="composer-actions"><button id="attachHint" class="mini-btn" title="当前工作区会自动成为上下文根目录">工作区已挂载</button><button id="sendBtn" class="send-btn">发送 ↑</button></div>
          </div>
        </div>
      </section>

      <section id="fileView" class="stage-view file-view">
        <div class="file-preview-head"><div><strong id="previewName">未选择文件</strong><span id="previewPath"></span></div><button id="openExternalBtn" class="btn ghost" disabled>用系统程序打开</button></div>
        <div id="filePreview" class="file-preview"><div class="empty-state"><b>点击左侧文件</b><span>文本文件会在这里直接预览；PDF、压缩包等可调用系统默认程序打开。</span></div></div>
      </section>

      <section id="terminalView" class="stage-view terminal-view">
        <div class="terminal-toolbar"><div><strong>OMP 原生终端</strong><span>PTY 直连 · 不裁剪任何 Agent 能力</span></div><div><span id="runState" class="runtime-pill">空闲</span></div></div>
        <div id="terminal"></div>
      </section>
    </main>

    <aside class="inspector panel-frame">
      <div class="inspector-tabs">
        <button class="inspector-tab active" data-inspector="run">运行</button>
        <button class="inspector-tab" data-inspector="tools">工具</button>
        <button class="inspector-tab" data-inspector="context">上下文</button>
        <button class="inspector-tab" data-inspector="config">配置</button>
      </div>

      <section id="runPanel" class="inspector-panel active">
        <div class="section-title"><div><span class="eyebrow">比赛状态</span><strong>控制面板</strong></div><span id="eventSeq" class="soft-badge">暂无事件</span></div>
        <div class="metric-grid">
          <div class="metric accent"><span>已解出</span><strong id="solvedCount">0 / 0</strong></div>
          <div class="metric"><span>正在处理</span><strong id="activeCount">0</strong></div>
          <div class="metric good"><span>提交正确</span><strong id="acceptedCount">0</strong></div>
          <div class="metric bad"><span>提交错误</span><strong id="rejectedCount">0</strong></div>
        </div>
        <div class="section-title tight"><strong>题目进度</strong><span id="dashboardState" class="muted">等待状态</span></div>
        <div id="challengeList" class="challenge-list"><div class="empty-state compact"><b>还没有比赛状态</b><span>启动正式比赛后会在这里实时恢复。</span></div></div>
      </section>

      <section id="toolsPanel" class="inspector-panel">
        <div class="section-title"><div><span class="eyebrow">只读观察</span><strong>工具调用</strong></div><span id="toolCount" class="soft-badge">0 次</span></div>
        <div class="observer-banner">工具仍由 OMP Agent 原生调度。这里仅从 PTY 输出中提取调用迹象，不拦截、不重放、不修改参数。</div>
        <div id="toolList" class="tool-list"><div class="empty-state compact"><b>暂无工具调用</b><span>启动会话后，识别到的 bash / read / edit / task / MCP 等会显示在这里。</span></div></div>
      </section>

      <section id="contextPanel" class="inspector-panel">
        <div class="section-title"><div><span class="eyebrow">模型状态</span><strong>上下文</strong></div><span class="lock-badge">赛事锁定</span></div>
        <div class="context-card">
          <div class="context-ring" id="contextRing"><span id="contextPercent">—</span><small>占用</small></div>
          <div class="context-copy"><strong id="contextValue">等待 OMP 上报</strong><span>Studio 不伪造 token 数；只有原生输出提供可解析数据时才显示精确占用。</span></div>
        </div>
        <div class="kv-list">
          <div><span>模型</span><strong id="modelValue">deepseek-v4-flash</strong></div>
          <div><span>Provider</span><strong id="providerValue">deepseek</strong></div>
          <div><span>压缩阈值</span><strong>72%</strong></div>
          <div><span>模型回退</span><strong>关闭</strong></div>
          <div><span>工具循环保护</span><strong>开启</strong></div>
          <div><span>当前预设</span><strong id="presetValue">turbo</strong></div>
        </div>
        <div class="capability-note"><b>能力不降级</b><span>GUI 输入 → PTY → 原始 OMP Agent。MCP、Skill、Task/Subagent、工具调用和压缩逻辑仍走原执行链。</span></div>
      </section>

      <section id="configPanel" class="inspector-panel config-panel">
        <div class="section-title"><div><span class="eyebrow">运行配置</span><strong>API 与比赛接入</strong></div><span id="configSaved" class="soft-badge">本机配置</span></div>
        <div class="form-block">
          <label>DeepSeek API Key <span id="apiConfigured" class="field-state">未配置</span></label>
          <div class="secret-input"><input id="apiKey" type="password" autocomplete="off" placeholder="sk-…"><button class="reveal-btn" data-target="apiKey">显示</button></div>
          <button id="saveApi" class="btn secondary wide">保存 API Key</button>
        </div>
        <div class="form-block">
          <label>比赛 Team Token <span id="tokenConfigured" class="field-state">未配置</span></label>
          <div class="secret-input"><input id="teamToken" type="password" autocomplete="off" placeholder="比赛平台 Token"><button class="reveal-btn" data-target="teamToken">显示</button></div>
          <button id="saveToken" class="btn secondary wide">保存 Team Token</button>
        </div>
        <div class="form-block">
          <label>模型网关 Provider</label>
          <input id="providerInput" class="field" placeholder="deepseek">
          <p class="field-help">只允许切换到赛事方提供的同模型网关；模型 ID 固定为 deepseek-v4-flash。</p>
        </div>
        <div class="form-block two-col">
          <div><label>运行预设</label><select id="presetInput" class="field"><option value="safe">safe · 稳健</option><option value="turbo">turbo · 默认</option><option value="max">max · 激进</option></select></div>
          <div><label>模型 ID</label><input class="field locked" value="deepseek-v4-flash" disabled></div>
        </div>
        <div class="form-block">
          <label>题目查询 API URL</label><input id="queryUrl" class="field mono" placeholder="https://…">
          <label>容器重置 API URL</label><input id="resetUrl" class="field mono" placeholder="https://…">
          <label>Flag 提交 API URL</label><input id="submitUrl" class="field mono" placeholder="https://…">
          <button id="saveRuntimeConfig" class="btn primary wide">应用运行配置</button>
          <p class="field-help">这些值会写入 OMP-Wanwandequ 自己读取的环境配置；不是 Studio 私有的“假设置”。新会话生效。</p>
        </div>
        <div class="form-block info-box"><b>为什么没有任意模型下拉框？</b><span>当前比赛代码明确锁定 DeepSeek V4 Flash。Studio 不绕过这条限制，否则反而会破坏 Wanwandequ 的比赛一致性。</span></div>
      </section>
    </aside>
  </div>

  <footer class="statusbar">
    <div><span class="status-dot"></span><span>万万得取 Studio v0.3</span></div>
    <div id="footerWorkspace">未选择工作区</div>
    <div><span id="footerAgent">OMP 原生能力：保留</span><span class="divider">·</span><span>Observer-only GUI</span></div>
  </footer>

  <div id="confirmModal" class="modal-backdrop hidden">
    <div class="modal"><div class="modal-icon">!</div><h3>进入正式比赛模式？</h3><p>正式模式会启动 <code>omp-wanwandequ run --root</code>，Agent 可按原能力获取题目、调用工具并提交 Flag。Studio 不会插手执行链。</p><div class="modal-actions"><button id="cancelCompetition" class="btn ghost">取消</button><button id="confirmCompetition" class="btn primary">确认启动</button></div></div>
  </div>
</div>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const qsa = <T extends Element>(selector: string) => [...document.querySelectorAll<T>(selector)];

const term = new Terminal({
  convertEol: true,
  cursorBlink: true,
  fontFamily: "Cascadia Code, JetBrains Mono, SFMono-Regular, Consolas, monospace",
  fontSize: 13,
  lineHeight: 1.32,
  scrollback: 20000,
  theme: {
    background: "#090c12",
    foreground: "#dce4f2",
    cursor: "#8ea8ff",
    selectionBackground: "#33446e88",
    black: "#111722",
    brightBlack: "#667085",
    blue: "#7c9cff",
    brightBlue: "#9eb4ff",
    cyan: "#4fd1c5",
    green: "#5fd6a0",
    yellow: "#f0c36a",
    red: "#ff7b86",
    magenta: "#bd93f9",
  },
});
const fit = new FitAddon();
term.loadAddon(fit);
term.open($("terminal"));
fit.fit();
term.writeln("\x1b[1;34m万万得取 Studio v0.3\x1b[0m  ·  OMP 原生 PTY 已就绪");

let currentWorkspace = localStorage.getItem("wq-workspace") ?? "";
let currentFilePath = "";
let currentView: ViewName = "chat";
let dashboardBusy = false;
let agentMode: "idle" | "chat" | "competition" | "solve" | "doctor" = "idle";
let outputBuffer = "";
let liveAssistant: HTMLDivElement | null = null;
let contextUsed: number | null = null;
let contextLimit: number | null = null;
let toolSeq = 0;
const tools: ToolObservation[] = [];

function escapeHtml(value: string) {
  return value.replace(/[&<>'\"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '\"': "&quot;" }[c]!));
}
function formatSize(n: number) { return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`; }
function stripAnsi(input: string) {
  return input.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b[@-_]/g, "").replace(/\r/g, "").replace(/[^\x09\x0a\x20-\x7e\u0080-\uffff]/g, "");
}
function setView(view: ViewName) {
  currentView = view;
  qsa<HTMLButtonElement>(".stage-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.view === view));
  qsa<HTMLElement>(".stage-view").forEach(el => el.classList.remove("active"));
  $(`${view}View`).classList.add("active");
  if (view === "terminal") requestAnimationFrame(() => void syncTerminalSize());
}
function setInspector(view: InspectorName) {
  qsa<HTMLButtonElement>(".inspector-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.inspector === view));
  qsa<HTMLElement>(".inspector-panel").forEach(el => el.classList.remove("active"));
  $(`${view}Panel`).classList.add("active");
}
function addChatMessage(role: "user" | "assistant" | "system", text: string, live = false) {
  const row = document.createElement("div");
  row.className = `message-row ${role}`;
  const label = role === "user" ? "你" : role === "assistant" ? "OMP Agent" : "Studio";
  row.innerHTML = `<div class="message-avatar">${role === "user" ? "你" : role === "assistant" ? "WQ" : "i"}</div><div class="message-card"><div class="message-head"><strong>${label}</strong><span>${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${live ? " · 输出中" : ""}</span></div><pre class="message-body"></pre></div>`;
  row.querySelector<HTMLElement>(".message-body")!.textContent = text;
  $("chatTimeline").appendChild(row);
  $("chatTimeline").scrollTop = $("chatTimeline").scrollHeight;
  if (role === "assistant" && live) liveAssistant = row;
  return row;
}
function updateLiveAssistant(chunk: string) {
  const clean = stripAnsi(chunk);
  if (!clean.trim()) return;
  if (!liveAssistant || !document.body.contains(liveAssistant)) addChatMessage("assistant", "", true);
  const body = liveAssistant!.querySelector<HTMLElement>(".message-body")!;
  body.textContent = (body.textContent + clean.replace(/\n{4,}/g, "\n\n\n")).slice(-24000);
  const timeline = $("chatTimeline");
  if (timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 160) timeline.scrollTop = timeline.scrollHeight;
}
function finalizeLiveAssistant() {
  if (!liveAssistant) return;
  const head = liveAssistant.querySelector<HTMLElement>(".message-head span");
  if (head) head.textContent = `${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · 已结束`;
  liveAssistant = null;
}
function toolNameFromLine(line: string): string | null {
  const hints: Array<[string, RegExp]> = [
    ["Bash / Shell", /(?:tool|调用|running|execute|exec|shell|bash).{0,24}\b(?:bash|shell|exec|command)\b/i],
    ["读取文件", /(?:tool|调用|read|reading).{0,20}\b(?:read|cat|view)\b/i],
    ["编辑文件", /(?:tool|调用|edit|write|patch).{0,20}\b(?:edit|write|patch|apply_patch)\b/i],
    ["搜索", /(?:tool|调用|search|grep|find).{0,20}\b(?:grep|search|find|rg)\b/i],
    ["Task / Subagent", /(?:tool|调用|task|subagent|agent).{0,24}\b(?:task|subagent|agent)\b/i],
    ["MCP", /\bmcp\b/i], ["Python", /(?:tool|调用|python).{0,16}\bpython\b/i],
  ];
  for (const [name, regex] of hints) if (regex.test(line)) return name;
  return null;
}
function observeOutput(raw: string) {
  const clean = stripAnsi(raw);
  outputBuffer = (outputBuffer + clean).slice(-50000);
  updateLiveAssistant(raw);
  for (const regex of [/(?:context|上下文)[^\d]{0,24}([\d,.]+)\s*\/\s*([\d,.]+)\s*(?:tokens?|token)?/i, /(?:tokens?|token)[^\d]{0,24}([\d,.]+)\s*\/\s*([\d,.]+)/i]) {
    const match = outputBuffer.match(regex);
    if (match) {
      const used = Number(match[1].replace(/,/g, "")), limit = Number(match[2].replace(/,/g, ""));
      if (Number.isFinite(used) && Number.isFinite(limit) && limit > 0) { contextUsed = used; contextLimit = limit; renderContext(); }
    }
  }
  for (const line of clean.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 600) continue;
    const name = toolNameFromLine(trimmed); if (!name) continue;
    const duplicate = tools[0] && tools[0].name === name && tools[0].summary === trimmed.slice(0, 180) && Date.now() - tools[0].ts < 1200;
    if (duplicate) continue;
    tools.unshift({ id: ++toolSeq, ts: Date.now(), name, summary: trimmed.slice(0, 180), status: "完成" });
    if (tools.length > 80) tools.length = 80;
    renderTools();
  }
}
function renderContext() {
  if (contextUsed !== null && contextLimit !== null) {
    const percent = Math.min(100, Math.max(0, Math.round((contextUsed / contextLimit) * 100)));
    $("contextPercent").textContent = `${percent}%`;
    $("contextValue").textContent = `${contextUsed.toLocaleString()} / ${contextLimit.toLocaleString()} tokens`;
    $("contextRing").style.setProperty("--context", `${percent * 3.6}deg`);
  } else { $("contextPercent").textContent = "—"; $("contextValue").textContent = "等待 OMP 上报"; $("contextRing").style.setProperty("--context", "0deg"); }
}
function renderTools() {
  $("toolCount").textContent = `${tools.length} 次`;
  $("toolList").innerHTML = tools.length ? tools.map(t => `<div class="tool-item"><div class="tool-icon">⌁</div><div class="tool-copy"><div><strong>${escapeHtml(t.name)}</strong><span>${new Date(t.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></div><p>${escapeHtml(t.summary)}</p></div><span class="tool-status">${t.status}</span></div>`).join("") : `<div class="empty-state compact"><b>暂无工具调用</b><span>启动会话后，识别到的调用会显示在这里。</span></div>`;
}
function compactStatus(challenge: ChallengeView) {
  if (challenge.solved) return "已解出"; if (challenge.active) return "处理中";
  const s = (challenge.last_status ?? "等待").toLowerCase();
  return ({ accepted: "已通过", rejected: "未通过", failed: "失败", queued: "等待", running: "处理中" } as Record<string,string>)[s] ?? challenge.last_status ?? "等待";
}
async function status() {
  const s = await invoke<StudioStatus>("studio_status", { workspace: currentWorkspace || null });
  $("modeBadge").textContent = s.team_token ? "已武装 · 正式模式" : "测试模式";
  $("modeBadge").className = `mode-badge ${s.team_token ? "armed" : "test"}`;
  $("runState").textContent = s.running ? "运行中" : "空闲";
  $("runtimeText").textContent = s.running ? `OMP Agent 运行中 · ${agentMode === "competition" ? "正式比赛" : "交互会话"}` : "OMP Agent 未运行";
  document.querySelector(".titlebar-center .status-dot")?.classList.toggle("online", s.running);
  $("apiConfigured").textContent = s.api_key ? "已配置" : "未配置"; $("apiConfigured").className = `field-state ${s.api_key ? "ok" : ""}`;
  $("tokenConfigured").textContent = s.team_token ? "已配置 · 已武装" : "未配置"; $("tokenConfigured").className = `field-state ${s.team_token ? "warn" : ""}`;
  $("providerValue").textContent = s.provider || "deepseek"; $("presetValue").textContent = s.preset || "turbo"; $("modelValue").textContent = s.model_id || "deepseek-v4-flash";
  if (document.activeElement !== $("providerInput")) ($("providerInput") as HTMLInputElement).value = s.provider || "deepseek";
  if (document.activeElement !== $("presetInput")) ($("presetInput") as HTMLSelectElement).value = s.preset || "turbo";
  if (document.activeElement !== $("queryUrl")) ($("queryUrl") as HTMLInputElement).value = s.query_url || DEFAULT_QUERY_URL;
  if (document.activeElement !== $("resetUrl")) ($("resetUrl") as HTMLInputElement).value = s.reset_url || DEFAULT_RESET_URL;
  if (document.activeElement !== $("submitUrl")) ($("submitUrl") as HTMLInputElement).value = s.submit_url || DEFAULT_SUBMIT_URL;
  $("footerAgent").textContent = s.agent_path ? "OMP 原生能力：已连接" : "OMP Agent：未找到";
  return s;
}
async function dashboard() {
  if (!currentWorkspace || dashboardBusy) return; dashboardBusy = true;
  try {
    const d = await invoke<DashboardSnapshot>("dashboard_snapshot", { cwd: currentWorkspace });
    $("solvedCount").textContent = `${d.solved} / ${d.total}`; $("activeCount").textContent = String(d.active); $("acceptedCount").textContent = String(d.accepted_submits); $("rejectedCount").textContent = String(d.rejected_submits);
    $("eventSeq").textContent = d.last_event_seq ? `事件 #${d.last_event_seq}` : "暂无事件"; $("dashboardState").textContent = d.running ? "比赛进行中" : d.total ? "状态已恢复" : "等待状态";
    const rows = [...d.challenges].sort((a,b) => Number(b.active)-Number(a.active) || Number(a.solved)-Number(b.solved) || b.visits-a.visits);
    $("challengeList").innerHTML = rows.length ? rows.map(c => `<div class="challenge-row ${c.active ? "active" : ""} ${c.solved ? "solved" : ""}"><div class="challenge-line"><strong>${escapeHtml(c.question_id)}</strong><span>${escapeHtml(compactStatus(c))}</span></div><div class="challenge-title">${escapeHtml(c.title || c.category || "题目")}</div><div class="challenge-meta"><span>${escapeHtml(c.category || "未知")}</span><span>访问 ${c.visits}</span><span>事实 ${c.facts}</span><span>产物 ${c.artifacts}</span></div></div>`).join("") : `<div class="empty-state compact"><b>还没有比赛状态</b><span>启动正式比赛后会实时显示。</span></div>`;
  } catch (error) { $("eventSeq").textContent = "状态不可用"; console.warn(error); } finally { dashboardBusy = false; }
}
async function renderDirectory(path: string, container: HTMLElement, depth = 0) {
  const items = await invoke<FileEntry[]>("list_workspace", { cwd: path }); if (depth === 0) $("treeCount").textContent = `${items.length} 项`; container.innerHTML = "";
  for (const item of items) {
    if (item.is_dir) {
      const wrapper = document.createElement("div"); wrapper.className = "tree-folder";
      const row = document.createElement("button"); row.className = "tree-row folder"; row.style.setProperty("--depth", String(depth)); row.innerHTML = `<span class="twisty">›</span><span class="file-icon folder-icon">◆</span><span class="tree-name">${escapeHtml(item.name)}</span>`;
      const children = document.createElement("div"); children.className = "tree-children hidden"; let loaded = false;
      row.onclick = async () => { const open = children.classList.contains("hidden"); children.classList.toggle("hidden", !open); row.classList.toggle("open", open); if (open && !loaded) { loaded = true; children.innerHTML = `<div class="tree-loading" style="--depth:${depth + 1}">读取中…</div>`; try { await renderDirectory(item.path, children, depth + 1); } catch (e) { children.innerHTML = `<div class="tree-error">${escapeHtml(String(e))}</div>`; } } };
      wrapper.append(row, children); container.appendChild(wrapper);
    } else {
      const row = document.createElement("button"); row.className = "tree-row file"; row.style.setProperty("--depth", String(depth)); row.dataset.path = item.path;
      const ext = item.name.includes(".") ? item.name.split(".").pop()!.toLowerCase() : "";
      row.innerHTML = `<span class="twisty placeholder">·</span><span class="file-icon ext-${escapeHtml(ext)}">${ext === "pdf" ? "P" : ext === "py" ? "Py" : ext === "md" ? "M" : "·"}</span><span class="tree-name">${escapeHtml(item.name)}</span><small>${formatSize(item.size)}</small>`;
      row.onclick = () => void openFile(item); container.appendChild(row);
    }
  }
  if (!items.length) container.innerHTML = `<div class="tree-empty" style="--depth:${depth}">空文件夹</div>`;
}
async function refreshFiles() { if (currentWorkspace) await renderDirectory(currentWorkspace, $("fileTree")); }
async function openFile(item: FileEntry) {
  currentFilePath = item.path; qsa<HTMLElement>(".tree-row.file").forEach(row => row.classList.toggle("selected", row.dataset.path === item.path));
  $("fileTabName").textContent = item.name; $("previewName").textContent = item.name; $("previewPath").textContent = item.path; $("filePreview").innerHTML = `<div class="file-loading">正在读取 ${escapeHtml(item.name)}…</div>`; setView("file");
  try {
    const preview = await invoke<FilePreview>("read_workspace_file", { root: currentWorkspace, path: item.path }); const openButton = $("openExternalBtn") as HTMLButtonElement; openButton.disabled = false;
    if (preview.text !== null) $("filePreview").innerHTML = `<pre class="code-preview">${escapeHtml(preview.text)}</pre>${preview.truncated ? `<div class="truncated-note">文件较大，仅预览前 1 MiB。原文件没有被修改。</div>` : ""}`;
    else { $("filePreview").innerHTML = `<div class="binary-preview"><div class="binary-icon">${item.name.toLowerCase().endsWith(".pdf") ? "PDF" : "BIN"}</div><h3>这个文件不适合在 Studio 内直接渲染</h3><p>${escapeHtml(item.name)} · ${formatSize(preview.size)}</p><button id="binaryOpen" class="btn primary">用系统默认程序打开</button></div>`; $("binaryOpen").onclick = () => void openExternal(); }
  } catch (error) { $("filePreview").innerHTML = `<div class="empty-state"><b>文件读取失败</b><span>${escapeHtml(String(error))}</span></div>`; }
}
async function openExternal() { if (currentFilePath && currentWorkspace) await invoke("open_workspace_path", { root: currentWorkspace, path: currentFilePath }); }
async function chooseWorkspace() {
  const chosen = await invoke<string | null>("choose_workspace"); if (!chosen) return; currentWorkspace = chosen; localStorage.setItem("wq-workspace", chosen);
  $("workspacePath").querySelector<HTMLElement>(".root-text")!.textContent = chosen; $("workspacePath").title = chosen; $("footerWorkspace").textContent = chosen; await Promise.all([refreshFiles(), status(), dashboard()]);
}
async function syncTerminalSize() { if (currentView !== "terminal") return; fit.fit(); if (term.cols > 0 && term.rows > 0) await invoke("resize_agent", { cols: term.cols, rows: term.rows }).catch(() => {}); }
async function launch(args: string[], mode: typeof agentMode) {
  if (!currentWorkspace) await chooseWorkspace(); if (!currentWorkspace) return false; const s = await status(); if (s.running) return true;
  agentMode = mode; outputBuffer = ""; liveAssistant = null; term.clear(); term.writeln(`\x1b[90m[Studio] 启动 OMP-Wanwandequ: ${args.join(" ")}\x1b[0m`); await invoke("start_agent", { cwd: currentWorkspace, args }); await status();
  if (mode === "chat") { addChatMessage("system", "OMP 原生交互会话已启动。你的消息将通过 PTY 原样发送。", false); $("composerMode").textContent = "测试对话 · 原生 OMP 会话"; }
  else if (mode === "competition") { $("composerMode").textContent = "正式比赛运行中 · 为避免干扰自动 Agent，输入框已锁定"; ($("promptInput") as HTMLTextAreaElement).disabled = true; ($("sendBtn") as HTMLButtonElement).disabled = true; }
  return true;
}
async function sendPrompt() {
  const input = $("promptInput") as HTMLTextAreaElement, text = input.value.trim(); if (!text) return; const s = await status(); if (s.running && agentMode === "competition") return;
  if (!s.running) { await launch(["chat"], "chat"); await new Promise(resolve => setTimeout(resolve, 750)); }
  addChatMessage("user", text); liveAssistant = null; addChatMessage("assistant", "", true); input.value = ""; await invoke("write_agent", { data: `${text}\r` });
}
async function saveSecret(kind: "api" | "token", inputId: string) {
  const input = $(inputId) as HTMLInputElement, value = input.value.trim(); if (!value) return; await invoke("save_secret", { kind, value }); input.value = ""; $("configSaved").textContent = "已保存"; setTimeout(() => $("configSaved").textContent = "本机配置", 1600); await status();
}
async function saveRuntimeConfig() {
  const provider = ($("providerInput") as HTMLInputElement).value.trim() || "deepseek", preset = ($("presetInput") as HTMLSelectElement).value, queryUrl = ($("queryUrl") as HTMLInputElement).value.trim(), resetUrl = ($("resetUrl") as HTMLInputElement).value.trim(), submitUrl = ($("submitUrl") as HTMLInputElement).value.trim();
  await invoke("save_setting", { kind: "provider", value: provider }); await invoke("save_setting", { kind: "preset", value: preset }); await invoke("save_setting", { kind: "query_url", value: queryUrl }); await invoke("save_setting", { kind: "reset_url", value: resetUrl }); await invoke("save_setting", { kind: "submit_url", value: submitUrl }); $("configSaved").textContent = "配置已应用"; setTimeout(() => $("configSaved").textContent = "本机配置", 1800); await status();
}
qsa<HTMLButtonElement>(".stage-tab").forEach(btn => btn.onclick = () => setView(btn.dataset.view as ViewName));
qsa<HTMLButtonElement>(".inspector-tab").forEach(btn => btn.onclick = () => setInspector(btn.dataset.inspector as InspectorName));
qsa<HTMLButtonElement>(".reveal-btn").forEach(btn => btn.onclick = () => { const target = $(btn.dataset.target!) as HTMLInputElement, visible = target.type === "text"; target.type = visible ? "password" : "text"; btn.textContent = visible ? "显示" : "隐藏"; });
$("chooseBtn").onclick = chooseWorkspace; $("workspacePath").onclick = chooseWorkspace; $("refreshBtn").onclick = () => void refreshFiles(); $("openExternalBtn").onclick = () => void openExternal();
$("chatStartBtn").onclick = async () => { setView("chat"); await launch(["chat"], "chat"); };
$("solveBtn").onclick = async () => { await launch(["solve", currentWorkspace || ".", "--preset", ($("presetInput") as HTMLSelectElement).value || "turbo"], "solve"); setView("terminal"); };
$("doctorBtn").onclick = async () => { await launch(["doctor"], "doctor"); setView("terminal"); };
$("stopBtn").onclick = async () => { await invoke("stop_agent").catch(() => {}); agentMode = "idle"; finalizeLiveAssistant(); ($("promptInput") as HTMLTextAreaElement).disabled = false; ($("sendBtn") as HTMLButtonElement).disabled = false; $("composerMode").textContent = "测试对话 · 原生 OMP 会话"; await status(); };
$("competitionBtn").onclick = async () => { const s = await status(); if (!s.team_token) { setInspector("config"); $("teamToken").focus(); return; } $("confirmModal").classList.remove("hidden"); };
$("cancelCompetition").onclick = () => $("confirmModal").classList.add("hidden");
$("confirmCompetition").onclick = async () => { $("confirmModal").classList.add("hidden"); await launch(["run", "--root", currentWorkspace], "competition"); setInspector("run"); setView("terminal"); };
$("sendBtn").onclick = () => void sendPrompt();
($("promptInput") as HTMLTextAreaElement).addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void sendPrompt(); } });
$("saveApi").onclick = () => void saveSecret("api", "apiKey"); $("saveToken").onclick = () => void saveSecret("token", "teamToken"); $("saveRuntimeConfig").onclick = () => void saveRuntimeConfig();
$("railChat").onclick = () => setView("chat"); $("railTerminal").onclick = () => setView("terminal"); $("railConfig").onclick = () => setInspector("config");
term.onData(data => invoke("write_agent", { data }).catch(() => {})); window.addEventListener("resize", () => void syncTerminalSize()); new ResizeObserver(() => void syncTerminalSize()).observe($("terminalView"));
listen<string>("terminal-output", event => { term.write(event.payload); observeOutput(event.payload); });
listen("agent-exited", async () => { finalizeLiveAssistant(); agentMode = "idle"; ($("promptInput") as HTMLTextAreaElement).disabled = false; ($("sendBtn") as HTMLButtonElement).disabled = false; $("composerMode").textContent = "测试对话 · 原生 OMP 会话"; await Promise.all([status(), dashboard()]); });
if (currentWorkspace) { $("workspacePath").querySelector<HTMLElement>(".root-text")!.textContent = currentWorkspace; $("workspacePath").title = currentWorkspace; $("footerWorkspace").textContent = currentWorkspace; refreshFiles().catch(console.warn); }
renderContext(); renderTools(); status().catch(error => addChatMessage("system", `状态读取失败：${String(error)}`)); dashboard().catch(() => {}); setInterval(() => void dashboard(), 1200); setInterval(() => void status(), 3500);
