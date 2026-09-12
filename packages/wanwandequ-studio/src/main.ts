import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import {
	RuntimeRpcFrameDecoder,
	assistantTextFromFrame,
	contextFromState,
	isObject,
	responseData,
	rpcError,
	toolEventFromFrame,
	type RpcObject,
} from "./runtime-protocol";

type StudioStatus = {
	api_key: boolean;
	team_token: boolean;
	running: boolean;
	runtime_mode: string;
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
type FilePreview = {
	name: string;
	path: string;
	size: number;
	text: string | null;
	binary: boolean;
	truncated: boolean;
};
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
type ToolObservation = { key: string; ts: number; name: string; summary: string; status: "运行" | "完成" | "失败" };
type ViewName = "chat" | "file" | "terminal";
type InspectorName = "run" | "tools" | "context" | "config";
type PendingRpc = { resolve: (frame: RpcObject) => void; reject: (error: Error) => void; timer: number };

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
<div class="studio-shell">
  <header class="titlebar">
    <div class="brand"><div class="brand-logo">WQ</div><div class="brand-copy"><strong>万万得取 Studio</strong><span>Wanwandequ Runtime · OMP AgentSession 客户端</span></div></div>
    <div class="titlebar-center"><span class="status-dot"></span><span id="runtimeText">Runtime 未连接</span></div>
    <div class="title-actions"><button id="doctorBtn" class="btn ghost">环境检查</button><button id="stopBtn" class="btn ghost danger-text">停止</button><button id="chatStartBtn" class="btn secondary">启动 Runtime</button><button id="competitionBtn" class="btn primary">正式比赛</button></div>
  </header>
  <div class="workbench">
    <nav class="activity-rail" aria-label="主导航"><button class="rail-btn active" title="工作区">▣</button><button class="rail-btn" id="railChat" title="对话">◈</button><button class="rail-btn" id="railTerminal" title="运行日志">›_</button><div class="rail-spacer"></div><button class="rail-btn" id="railConfig" title="配置">⚙</button></nav>
    <aside class="explorer panel-frame">
      <div class="panel-title-row"><div><span class="eyebrow">工作区</span><strong>资源管理器</strong></div><div class="icon-actions"><button id="refreshBtn" title="刷新">↻</button><button id="chooseBtn" title="选择工作区">＋</button></div></div>
      <button id="workspacePath" class="workspace-root" title="切换工作区"><span class="root-icon">⌂</span><span class="root-text">尚未选择工作区</span><span>⌄</span></button>
      <div class="tree-toolbar"><span>点击文件直接预览</span><span id="treeCount">0 项</span></div>
      <div id="fileTree" class="file-tree"><div class="empty-state compact"><b>还没有工作区</b><span>点击右上角 ＋ 选择题目目录</span></div></div>
      <div class="explorer-footer"><button id="solveBtn" class="btn wide secondary">分析当前工作区</button></div>
    </aside>
    <main class="main-stage panel-frame">
      <div class="stage-tabs"><button class="stage-tab active" data-view="chat"><span>◈</span> 对话</button><button class="stage-tab" data-view="file"><span>≡</span> <span id="fileTabName">文件预览</span></button><button class="stage-tab" data-view="terminal"><span>›_</span> Runtime 日志</button><div class="stage-spacer"></div><span id="modeBadge" class="mode-badge test">测试模式</span></div>
      <section id="chatView" class="stage-view chat-view active">
        <div id="chatTimeline" class="chat-timeline">
          <div class="welcome-card"><div class="welcome-icon">WQ</div><div><h2>直接连接 OMP AgentSession</h2><p>对话不再模拟键盘输入，也不解析 TUI。Studio 通过 OMP 原生 JSONL RPC 发送 prompt，并直接接收消息、工具、上下文和 Subagent 事件。</p></div></div>
          <div class="system-note"><span>Runtime-first</span> Studio 是客户端，不在模型、工具、MCP、Skill、Task/Subagent 和压缩执行链中间。</div>
        </div>
        <div class="composer-wrap"><div class="composer-status"><span id="composerMode">结构化 Runtime · 等待连接</span><span>Ctrl / ⌘ + Enter 发送</span></div><div class="composer"><textarea id="promptInput" rows="3" placeholder="把题目、分析目标或下一步操作交给 OMP Agent…"></textarea><div class="composer-actions"><button class="mini-btn" disabled>工作区即上下文根目录</button><button id="sendBtn" class="send-btn">发送 ↑</button></div></div></div>
      </section>
      <section id="fileView" class="stage-view file-view"><div class="file-preview-head"><div><strong id="previewName">未选择文件</strong><span id="previewPath"></span></div><button id="openExternalBtn" class="btn ghost" disabled>用系统程序打开</button></div><div id="filePreview" class="file-preview"><div class="empty-state"><b>点击左侧文件</b><span>文本直接预览；PDF、压缩包等可调用系统默认程序。</span></div></div></section>
      <section id="terminalView" class="stage-view terminal-view"><div class="terminal-toolbar"><div><strong>Runtime 事件日志</strong><span>只读 JSONL / stderr · 不作为 Agent 输入通道</span></div><div><button id="debugTuiBtn" class="btn ghost">打开原生 OMP TUI</button><span id="runState" class="runtime-pill">空闲</span></div></div><div id="terminal"></div></section>
    </main>
    <aside class="inspector panel-frame">
      <div class="inspector-tabs"><button class="inspector-tab active" data-inspector="run">运行</button><button class="inspector-tab" data-inspector="tools">工具</button><button class="inspector-tab" data-inspector="context">上下文</button><button class="inspector-tab" data-inspector="config">配置</button></div>
      <section id="runPanel" class="inspector-panel active"><div class="section-title"><div><span class="eyebrow">比赛状态</span><strong>控制面板</strong></div><span id="eventSeq" class="soft-badge">暂无事件</span></div><div class="metric-grid"><div class="metric accent"><span>已解出</span><strong id="solvedCount">0 / 0</strong></div><div class="metric"><span>正在处理</span><strong id="activeCount">0</strong></div><div class="metric good"><span>提交正确</span><strong id="acceptedCount">0</strong></div><div class="metric bad"><span>提交错误</span><strong id="rejectedCount">0</strong></div></div><div class="section-title tight"><strong>题目进度</strong><span id="dashboardState" class="muted">等待状态</span></div><div id="challengeList" class="challenge-list"><div class="empty-state compact"><b>还没有比赛状态</b><span>启动正式比赛后从 .wq 状态恢复。</span></div></div></section>
      <section id="toolsPanel" class="inspector-panel"><div class="section-title"><div><span class="eyebrow">结构化事件</span><strong>工具 / Subagent</strong></div><span id="toolCount" class="soft-badge">0 次</span></div><div class="observer-banner">这里消费 OMP 原生 <code>tool_execution_*</code> 与 <code>subagent_*</code> 事件，不再正则猜终端文本，也不会代理或修改工具调用。</div><div id="toolList" class="tool-list"><div class="empty-state compact"><b>暂无工具调用</b><span>Runtime 启动后会实时显示真实工具事件。</span></div></div></section>
      <section id="contextPanel" class="inspector-panel"><div class="section-title"><div><span class="eyebrow">AgentSession 状态</span><strong>上下文</strong></div><span class="lock-badge">赛事锁定</span></div><div class="context-card"><div class="context-ring" id="contextRing"><span id="contextPercent">—</span><small>占用</small></div><div class="context-copy"><strong id="contextValue">等待 Runtime 上报</strong><span>数据来自 OMP <code>get_state.contextUsage</code>，不再从终端输出猜 token。</span></div></div><div class="kv-list"><div><span>模型</span><strong id="modelValue">deepseek-v4-flash</strong></div><div><span>Provider</span><strong id="providerValue">deepseek</strong></div><div><span>Thinking</span><strong id="thinkingValue">—</strong></div><div><span>会话消息</span><strong id="messageCount">0</strong></div><div><span>可用工具</span><strong id="availableTools">—</strong></div><div><span>RPC 协议</span><strong id="protocolValue">v1</strong></div><div><span>当前预设</span><strong id="presetValue">turbo</strong></div></div><div class="capability-note"><b>能力不降级</b><span>GUI → OMP RPC → AgentSession。Tools、MCP、Skills、Task/Subagent、Compaction 仍由原生 OMP Runtime 执行。</span></div></section>
      <section id="configPanel" class="inspector-panel config-panel"><div class="section-title"><div><span class="eyebrow">运行配置</span><strong>API 与比赛接入</strong></div><span id="configSaved" class="soft-badge">本机配置</span></div><div class="form-block"><label>DeepSeek API Key <span id="apiConfigured" class="field-state">未配置</span></label><div class="secret-input"><input id="apiKey" type="password" autocomplete="off" placeholder="sk-…"><button class="reveal-btn" data-target="apiKey">显示</button></div><button id="saveApi" class="btn secondary wide">保存 API Key</button></div><div class="form-block"><label>比赛 Team Token <span id="tokenConfigured" class="field-state">未配置</span></label><div class="secret-input"><input id="teamToken" type="password" autocomplete="off" placeholder="比赛平台 Token"><button class="reveal-btn" data-target="teamToken">显示</button></div><button id="saveToken" class="btn secondary wide">保存 Team Token</button></div><div class="form-block"><label>模型网关 Provider</label><input id="providerInput" class="field" placeholder="deepseek"><p class="field-help">模型 ID 仍锁定 deepseek-v4-flash；Provider 仅用于赛事兼容网关。</p></div><div class="form-block two-col"><div><label>运行预设</label><select id="presetInput" class="field"><option value="safe">safe · 稳健</option><option value="turbo">turbo · 默认</option><option value="max">max · 激进</option></select></div><div><label>模型 ID</label><input class="field locked" value="deepseek-v4-flash" disabled></div></div><div class="form-block"><label>题目查询 API URL</label><input id="queryUrl" class="field mono" placeholder="必须配置 https://…"><label>容器重置 API URL</label><input id="resetUrl" class="field mono" placeholder="必须配置 https://…"><label>Flag 提交 API URL</label><input id="submitUrl" class="field mono" placeholder="必须配置 https://…"><button id="saveRuntimeConfig" class="btn primary wide">应用运行配置</button><p class="field-help">比赛端点不会写死在 Studio 或 Agent 中；配置保存到 Wanwandequ 本机环境，新 Runtime / 比赛进程生效。</p></div></section>
    </aside>
  </div>
  <footer class="statusbar"><div><span class="status-dot"></span><span>万万得取 Studio v0.4</span></div><div id="footerWorkspace">未选择工作区</div><div><span id="footerAgent">OMP Runtime：等待连接</span><span class="divider">·</span><span>RPC Client</span></div></footer>
  <div id="confirmModal" class="modal-backdrop hidden"><div class="modal"><div class="modal-icon">!</div><h3>进入正式比赛模式？</h3><p>正式模式直接启动独立的 <code>omp-wanwandequ run --root</code>。它不经过聊天 Runtime，Studio 关闭也不改变 Agent 的解题逻辑。</p><div class="modal-actions"><button id="cancelCompetition" class="btn ghost">取消</button><button id="confirmCompetition" class="btn primary">确认启动</button></div></div></div>
</div>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const qsa = <T extends Element>(selector: string) => [...document.querySelectorAll<T>(selector)];
const term = new Terminal({
	convertEol: true,
	disableStdin: true,
	cursorBlink: false,
	fontFamily: "Cascadia Code, JetBrains Mono, Consolas, monospace",
	fontSize: 12,
	lineHeight: 1.3,
	scrollback: 12000,
	theme: {
		background: "#090c12",
		foreground: "#cbd5e5",
		brightBlack: "#667085",
		blue: "#7c9cff",
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
term.writeln("\x1b[1;34m万万得取 Studio v0.4\x1b[0m · OMP JSONL Runtime 日志（只读）");

let currentWorkspace = localStorage.getItem("wq-workspace") ?? "";
let currentFilePath = "";
let currentView: ViewName = "chat";
let dashboardBusy = false;
let agentMode: "idle" | "runtime" | "competition" | "solve" | "doctor" = "idle";
let runtimeReady = false;
let protocolVersion = 1;
let rpcSeq = 0;
let liveAssistant: HTMLDivElement | null = null;
let lastAssistantText = "";
const tools = new Map<string, ToolObservation>();
const subagents = new Map<string, { name: string; status: string; ts: number }>();
const pendingRpc = new Map<string, PendingRpc>();
const runtimeDecoder = new RuntimeRpcFrameDecoder();

function escapeHtml(value: string) {
	return value.replace(
		/[&<>'\"]/g,
		c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '\"': "&quot;" })[c]!,
	);
}
function formatSize(n: number) {
	return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function setView(view: ViewName) {
	currentView = view;
	qsa<HTMLButtonElement>(".stage-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.view === view));
	qsa<HTMLElement>(".stage-view").forEach(el => el.classList.remove("active"));
	$(`${view}View`).classList.add("active");
	if (view === "terminal") requestAnimationFrame(() => fit.fit());
}
function setInspector(view: InspectorName) {
	qsa<HTMLButtonElement>(".inspector-tab").forEach(btn =>
		btn.classList.toggle("active", btn.dataset.inspector === view),
	);
	qsa<HTMLElement>(".inspector-panel").forEach(el => el.classList.remove("active"));
	$(`${view}Panel`).classList.add("active");
}
function addChatMessage(role: "user" | "assistant" | "system", text: string, live = false) {
	const row = document.createElement("div");
	row.className = `message-row ${role}`;
	const label = role === "user" ? "你" : role === "assistant" ? "OMP Agent" : "Runtime";
	row.innerHTML = `<div class="message-avatar">${role === "user" ? "你" : role === "assistant" ? "WQ" : "i"}</div><div class="message-card"><div class="message-head"><strong>${label}</strong><span>${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${live ? " · 运行中" : ""}</span></div><pre class="message-body"></pre></div>`;
	row.querySelector<HTMLElement>(".message-body")!.textContent = text;
	$("chatTimeline").appendChild(row);
	$("chatTimeline").scrollTop = $("chatTimeline").scrollHeight;
	if (role === "assistant" && live) liveAssistant = row;
	return row;
}
function ensureLiveAssistant() {
	if (!liveAssistant || !document.body.contains(liveAssistant)) addChatMessage("assistant", "正在处理…", true);
	return liveAssistant!;
}
function setLiveAssistant(text: string) {
	if (!text.trim()) return;
	lastAssistantText = text;
	const row = ensureLiveAssistant();
	row.querySelector<HTMLElement>(".message-body")!.textContent = text;
	$("chatTimeline").scrollTop = $("chatTimeline").scrollHeight;
}
function finalizeAssistant(text?: string) {
	if (text?.trim()) setLiveAssistant(text);
	if (!liveAssistant) return;
	const head = liveAssistant.querySelector<HTMLElement>(".message-head span");
	if (head) head.textContent = `${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · 已完成`;
	liveAssistant = null;
}
function logFrame(prefix: string, value: unknown, color = "90") {
	const text = typeof value === "string" ? value : JSON.stringify(value);
	term.writeln(`\x1b[${color}m${prefix}\x1b[0m ${text.length > 3200 ? `${text.slice(0, 3200)}…` : text}`);
}
function rejectPendingRpc(message: string) {
	for (const [id, pending] of pendingRpc) {
		window.clearTimeout(pending.timer);
		pending.reject(new Error(message));
		pendingRpc.delete(id);
	}
}
async function writeRpc(frame: RpcObject) {
	await invoke("runtime_command", { frame: JSON.stringify(frame) });
}
async function sendRpc(type: string, body: Record<string, unknown> = {}) {
	const id = `studio-${++rpcSeq}`;
	await writeRpc({ id, type, ...body });
	return id;
}
function requestRpc(type: string, body: Record<string, unknown> = {}, timeoutMs = 10000): Promise<RpcObject> {
	const id = `studio-${++rpcSeq}`;
	return new Promise((resolve, reject) => {
		const timer = window.setTimeout(() => {
			pendingRpc.delete(id);
			reject(new Error(`OMP RPC ${type} 超时`));
		}, timeoutMs);
		pendingRpc.set(id, { resolve, reject, timer });
		void writeRpc({ id, type, ...body }).catch(error => {
			const pending = pendingRpc.get(id);
			if (!pending) return;
			window.clearTimeout(pending.timer);
			pendingRpc.delete(id);
			pending.reject(error instanceof Error ? error : new Error(String(error)));
		});
	});
}
function settleRpcResponse(frame: RpcObject): boolean {
	if (frame.type !== "response" || typeof frame.id !== "string") return false;
	const pending = pendingRpc.get(frame.id);
	if (!pending) return false;
	window.clearTimeout(pending.timer);
	pendingRpc.delete(frame.id);
	if (frame.success === false)
		pending.reject(new Error(typeof frame.error === "string" ? frame.error : "OMP RPC 请求失败"));
	else pending.resolve(frame);
	return true;
}
async function refreshRuntimeState() {
	if (!runtimeReady) return;
	try {
		const frame = await requestRpc("get_state", {}, 8000);
		const state = responseData(frame, "get_state");
		if (state) applyRuntimeState(state);
	} catch {
		/* periodic probe is best-effort */
	}
}
function applyRuntimeState(state: Record<string, unknown>) {
	const ctx = contextFromState(state);
	if (ctx.used !== null && ctx.limit !== null && ctx.percent !== null) {
		$("contextPercent").textContent = `${ctx.percent}%`;
		$("contextValue").textContent = `${ctx.used.toLocaleString()} / ${ctx.limit.toLocaleString()} tokens`;
		$("contextRing").style.setProperty("--context", `${ctx.percent * 3.6}deg`);
	} else {
		$("contextPercent").textContent = "—";
		$("contextValue").textContent = "Runtime 未提供可计算的 token 占用";
		$("contextRing").style.setProperty("--context", "0deg");
	}
	if (isObject(state.model)) {
		if (typeof state.model.id === "string") $("modelValue").textContent = state.model.id;
		if (typeof state.model.provider === "string") $("providerValue").textContent = state.model.provider;
	}
	$("thinkingValue").textContent = typeof state.thinkingLevel === "string" ? state.thinkingLevel : "—";
	$("messageCount").textContent = typeof state.messageCount === "number" ? String(state.messageCount) : "0";
	$("availableTools").textContent = Array.isArray(state.dumpTools) ? String(state.dumpTools.length) : "—";
}
function renderTools() {
	const items = [...tools.values()].sort((a, b) => b.ts - a.ts).slice(0, 80);
	const agents = [...subagents.entries()].sort((a, b) => b[1].ts - a[1].ts);
	$("toolCount").textContent = `${items.length} 次 · ${agents.length} Agent`;
	const agentHtml = agents
		.map(
			([id, a]) =>
				`<div class="tool-item"><div class="tool-icon">A</div><div class="tool-copy"><div><strong>${escapeHtml(a.name)}</strong><span>${escapeHtml(id)}</span></div><p>Subagent · ${escapeHtml(a.status)}</p></div><span class="tool-status">${escapeHtml(a.status)}</span></div>`,
		)
		.join("");
	const toolHtml = items
		.map(
			t =>
				`<div class="tool-item"><div class="tool-icon">⌁</div><div class="tool-copy"><div><strong>${escapeHtml(t.name)}</strong><span>${new Date(t.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></div><p>${escapeHtml(t.summary)}</p></div><span class="tool-status">${t.status}</span></div>`,
		)
		.join("");
	$("toolList").innerHTML =
		agentHtml + toolHtml ||
		`<div class="empty-state compact"><b>暂无结构化工具事件</b><span>Runtime 启动后这里会直接消费 OMP 事件。</span></div>`;
}
function observeTool(frame: RpcObject) {
	const ev = toolEventFromFrame(frame);
	if (!ev) return;
	const old = tools.get(ev.key);
	tools.set(ev.key, {
		key: ev.key,
		ts: old?.ts ?? Date.now(),
		name: ev.name,
		summary: ev.summary || old?.summary || "",
		status: ev.status,
	});
	renderTools();
}
function observeSubagent(frame: RpcObject) {
	if (!frame.type?.startsWith("subagent_")) return;
	const payload = isObject(frame.payload) ? frame.payload : frame;
	const id = String(payload.id ?? payload.agentId ?? payload.subagentId ?? `agent-${subagents.size + 1}`);
	const name = String(payload.agent ?? payload.name ?? payload.description ?? "Subagent");
	const status = String(payload.status ?? (frame.type === "subagent_lifecycle" ? (payload.event ?? "更新") : "运行"));
	subagents.set(id, { name, status, ts: Date.now() });
	renderTools();
}
async function answerExtensionRequest(frame: RpcObject) {
	if (frame.type !== "extension_ui_request" || typeof frame.id !== "string" || typeof frame.method !== "string")
		return;
	const id = frame.id;
	switch (frame.method) {
		case "confirm": {
			const confirmed = window.confirm(`${String(frame.title ?? "OMP 请求确认")}\n\n${String(frame.message ?? "")}`);
			await writeRpc({ type: "extension_ui_response", id, confirmed });
			break;
		}
		case "input":
		case "editor": {
			const value = window.prompt(String(frame.title ?? "OMP 请求输入"), String(frame.prefill ?? ""));
			await writeRpc(
				value === null
					? { type: "extension_ui_response", id, cancelled: true }
					: { type: "extension_ui_response", id, value },
			);
			break;
		}
		case "select": {
			const options = Array.isArray(frame.options) ? frame.options.map(String) : [];
			const answer = window.prompt(
				`${String(frame.title ?? "OMP 请选择")}\n\n${options.map((o, i) => `${i + 1}. ${o}`).join("\n")}`,
				"1",
			);
			if (answer === null) await writeRpc({ type: "extension_ui_response", id, cancelled: true });
			else {
				const index = Math.max(0, Number.parseInt(answer, 10) - 1);
				await writeRpc({ type: "extension_ui_response", id, value: options[index] ?? answer });
			}
			break;
		}
		case "notify":
			addChatMessage("system", String(frame.message ?? "OMP 通知"));
			break;
		case "setStatus":
			if (frame.statusText) $("runtimeText").textContent = String(frame.statusText);
			break;
		case "set_editor_text":
			if (typeof frame.text === "string") ($("promptInput") as HTMLTextAreaElement).value = frame.text;
			break;
		case "setTitle":
			if (typeof frame.title === "string") document.title = `${frame.title} · 万万得取 Studio`;
			break;
		case "setWidget": {
			const lines = Array.isArray(frame.widgetLines) ? frame.widgetLines.map(String) : [];
			if (lines.length) logFrame(`[widget:${String(frame.widgetKey ?? "runtime")}]`, lines.join("\n"), "36");
			break;
		}
		case "open_url": {
			const url =
				typeof frame.launchUrl === "string" ? frame.launchUrl : typeof frame.url === "string" ? frame.url : "";
			if (url)
				addChatMessage(
					"system",
					`OMP 请求打开链接：${url}\n为避免 Agent 自动拉起外部站点，Studio 当前不会静默打开；请确认来源后手动访问。`,
				);
			break;
		}
		case "cancel":
			logFrame("[extension_ui cancel]", frame, "33");
			break;
	}
}
async function onRuntimeReady(frame: RpcObject) {
	runtimeReady = true;
	agentMode = "runtime";
	protocolVersion = 1;
	runtimeDecoder.reset();
	$("protocolValue").textContent = "v1";
	$("composerMode").textContent = "结构化 Runtime · 已连接 OMP AgentSession";
	const supported = Array.isArray(frame.supportedProtocolVersions) ? frame.supportedProtocolVersions.map(Number) : [1];
	if (supported.includes(2)) {
		try {
			const negotiated = await requestRpc("negotiate_protocol", { protocolVersion: 2 }, 5000);
			const data = responseData(negotiated, "negotiate_protocol");
			if (data?.protocolVersion === 2) {
				protocolVersion = 2;
				$("protocolValue").textContent = "v2";
				logFrame("[Studio]", "RPC protocol v2 negotiated · large-frame chunking enabled", "32");
			}
		} catch (error) {
			logFrame("[Studio]", `RPC v2 negotiation failed, staying on v1: ${String(error)}`, "33");
		}
	}
	await requestRpc("set_subagent_subscription", { level: "events" }, 5000).catch(() => {});
	await refreshRuntimeState();
}
async function handleRuntimeFrame(line: string) {
	let frame: RpcObject | null;
	try {
		frame = runtimeDecoder.pushLine(line);
	} catch (error) {
		runtimeDecoder.reset();
		logFrame("[RPC decode error]", String(error), "31");
		addChatMessage("system", `Runtime 协议帧损坏：${String(error)}`);
		return;
	}
	if (!frame) {
		const physical = (() => {
			try {
				const value = JSON.parse(line) as Record<string, unknown>;
				return {
					type: "rpc_chunk",
					chunkId: value.chunkId,
					index: value.index,
					count: value.count,
					byteLength: value.byteLength,
				};
			} catch {
				return { type: "rpc_chunk" };
			}
		})();
		logFrame("[rpc_chunk]", physical);
		return;
	}
	logFrame(`[${frame.type ?? "frame"}]`, frame);
	if (frame.type === "ready") {
		await onRuntimeReady(frame);
		return;
	}
	const matchedPending = settleRpcResponse(frame);
	const err = rpcError(frame);
	if (err && !matchedPending) addChatMessage("system", `RPC 错误：${err}`);
	const state = responseData(frame, "get_state");
	if (state) applyRuntimeState(state);
	const last = responseData(frame, "get_last_assistant_text");
	if (last && typeof last.text === "string") finalizeAssistant(last.text);
	if (frame.type === "agent_start") {
		lastAssistantText = "";
		ensureLiveAssistant();
	}
	const text = assistantTextFromFrame(frame);
	if (text) setLiveAssistant(text);
	if (frame.type === "agent_end" && frame.willContinue !== true) {
		try {
			const response = await requestRpc("get_last_assistant_text", {}, 5000);
			const final = responseData(response, "get_last_assistant_text");
			finalizeAssistant(final && typeof final.text === "string" ? final.text : lastAssistantText);
		} catch {
			finalizeAssistant(lastAssistantText);
		}
		await refreshRuntimeState();
	}
	observeTool(frame);
	observeSubagent(frame);
	await answerExtensionRequest(frame);
	if (frame.type === "command_output" && typeof frame.text === "string") addChatMessage("system", frame.text);
	if (frame.type === "notice" && typeof frame.message === "string") addChatMessage("system", frame.message);
}
function compactStatus(c: ChallengeView) {
	if (c.solved) return "已解出";
	if (c.active) return "处理中";
	const s = (c.last_status ?? "等待").toLowerCase();
	return (
		(
			{ accepted: "已通过", rejected: "未通过", failed: "失败", queued: "等待", running: "处理中" } as Record<
				string,
				string
			>
		)[s] ??
		c.last_status ??
		"等待"
	);
}
async function status() {
	const s = await invoke<StudioStatus>("studio_status", { workspace: currentWorkspace || null });
	const actualCompetition = s.running && s.runtime_mode === "competition";
	$("modeBadge").textContent = actualCompetition ? "正式比赛运行中" : s.team_token ? "已武装" : "测试模式";
	$("modeBadge").className = `mode-badge ${s.team_token ? "armed" : "test"}`;
	$("runState").textContent = s.running ? "运行中" : "空闲";
	const label =
		s.runtime_mode === "runtime"
			? "结构化 Runtime"
			: s.runtime_mode === "competition"
				? "正式比赛"
				: s.runtime_mode || "";
	$("runtimeText").textContent = s.running ? `OMP Agent 运行中 · ${label}` : "Runtime 未连接";
	document.querySelector(".titlebar-center .status-dot")?.classList.toggle("online", s.running);
	$("apiConfigured").textContent = s.api_key ? "已配置" : "未配置";
	$("apiConfigured").className = `field-state ${s.api_key ? "ok" : ""}`;
	$("tokenConfigured").textContent = s.team_token ? "已配置 · 已武装" : "未配置";
	$("tokenConfigured").className = `field-state ${s.team_token ? "warn" : ""}`;
	$("providerValue").textContent = s.provider || "deepseek";
	$("presetValue").textContent = s.preset || "turbo";
	if (document.activeElement !== $("providerInput"))
		($("providerInput") as HTMLInputElement).value = s.provider || "deepseek";
	if (document.activeElement !== $("presetInput")) ($("presetInput") as HTMLSelectElement).value = s.preset || "turbo";
	if (document.activeElement !== $("queryUrl")) ($("queryUrl") as HTMLInputElement).value = s.query_url;
	if (document.activeElement !== $("resetUrl")) ($("resetUrl") as HTMLInputElement).value = s.reset_url;
	if (document.activeElement !== $("submitUrl")) ($("submitUrl") as HTMLInputElement).value = s.submit_url;
	$("footerAgent").textContent = s.agent_path
		? s.runtime_mode === "runtime"
			? `OMP Runtime：已连接 · RPC v${protocolVersion}`
			: "OMP 原生能力：可用"
		: "OMP Agent：未找到";
	return s;
}
async function dashboard() {
	if (!currentWorkspace || dashboardBusy) return;
	dashboardBusy = true;
	try {
		const d = await invoke<DashboardSnapshot>("dashboard_snapshot", { cwd: currentWorkspace });
		$("solvedCount").textContent = `${d.solved} / ${d.total}`;
		$("activeCount").textContent = String(d.active);
		$("acceptedCount").textContent = String(d.accepted_submits);
		$("rejectedCount").textContent = String(d.rejected_submits);
		$("eventSeq").textContent = d.last_event_seq ? `事件 #${d.last_event_seq}` : "暂无事件";
		$("dashboardState").textContent = d.running ? "比赛进行中" : d.total ? "状态已恢复" : "等待状态";
		const rows = [...d.challenges].sort(
			(a, b) => Number(b.active) - Number(a.active) || Number(a.solved) - Number(b.solved) || b.visits - a.visits,
		);
		$("challengeList").innerHTML = rows.length
			? rows
					.map(
						c =>
							`<div class="challenge-row ${c.active ? "active" : ""} ${c.solved ? "solved" : ""}"><div class="challenge-line"><strong>${escapeHtml(c.question_id)}</strong><span>${escapeHtml(compactStatus(c))}</span></div><div class="challenge-title">${escapeHtml(c.title || c.category || "题目")}</div><div class="challenge-meta"><span>${escapeHtml(c.category || "未知")}</span><span>访问 ${c.visits}</span><span>事实 ${c.facts}</span><span>产物 ${c.artifacts}</span></div></div>`,
					)
					.join("")
			: `<div class="empty-state compact"><b>还没有比赛状态</b><span>启动正式比赛后会实时显示。</span></div>`;
	} catch (e) {
		$("eventSeq").textContent = "状态不可用";
		console.warn(e);
	} finally {
		dashboardBusy = false;
	}
}
async function renderDirectory(path: string, container: HTMLElement, depth = 0) {
	const items = await invoke<FileEntry[]>("list_workspace", { cwd: path });
	if (depth === 0) $("treeCount").textContent = `${items.length} 项`;
	container.innerHTML = "";
	for (const item of items) {
		if (item.is_dir) {
			const wrap = document.createElement("div");
			wrap.className = "tree-folder";
			const row = document.createElement("button");
			row.className = "tree-row folder";
			row.style.setProperty("--depth", String(depth));
			row.innerHTML = `<span class="twisty">›</span><span class="file-icon folder-icon">◆</span><span class="tree-name">${escapeHtml(item.name)}</span>`;
			const children = document.createElement("div");
			children.className = "tree-children hidden";
			let loaded = false;
			row.onclick = async () => {
				const open = children.classList.contains("hidden");
				children.classList.toggle("hidden", !open);
				row.classList.toggle("open", open);
				if (open && !loaded) {
					loaded = true;
					try {
						await renderDirectory(item.path, children, depth + 1);
					} catch (e) {
						children.innerHTML = `<div class="tree-error">${escapeHtml(String(e))}</div>`;
					}
				}
			};
			wrap.append(row, children);
			container.appendChild(wrap);
		} else {
			const row = document.createElement("button");
			row.className = "tree-row file";
			row.style.setProperty("--depth", String(depth));
			row.dataset.path = item.path;
			const ext = item.name.includes(".") ? item.name.split(".").pop()!.toLowerCase() : "";
			row.innerHTML = `<span class="twisty placeholder">·</span><span class="file-icon ext-${escapeHtml(ext)}">${ext === "pdf" ? "P" : ext === "py" ? "Py" : ext === "md" ? "M" : "·"}</span><span class="tree-name">${escapeHtml(item.name)}</span><small>${formatSize(item.size)}</small>`;
			row.onclick = () => void openFile(item);
			container.appendChild(row);
		}
	}
	if (!items.length) container.innerHTML = `<div class="tree-empty" style="--depth:${depth}">空文件夹</div>`;
}
async function refreshFiles() {
	if (currentWorkspace) await renderDirectory(currentWorkspace, $("fileTree"));
}
async function openFile(item: FileEntry) {
	currentFilePath = item.path;
	qsa<HTMLElement>(".tree-row.file").forEach(r => r.classList.toggle("selected", r.dataset.path === item.path));
	$("fileTabName").textContent = item.name;
	$("previewName").textContent = item.name;
	$("previewPath").textContent = item.path;
	setView("file");
	try {
		const p = await invoke<FilePreview>("read_workspace_file", { root: currentWorkspace, path: item.path });
		($("openExternalBtn") as HTMLButtonElement).disabled = false;
		if (p.text !== null)
			$("filePreview").innerHTML =
				`<pre class="code-preview">${escapeHtml(p.text)}</pre>${p.truncated ? `<div class="truncated-note">文件较大，仅预览前 1 MiB。</div>` : ""}`;
		else {
			$("filePreview").innerHTML =
				`<div class="binary-preview"><div class="binary-icon">${item.name.toLowerCase().endsWith(".pdf") ? "PDF" : "BIN"}</div><h3>使用系统程序打开</h3><p>${escapeHtml(item.name)} · ${formatSize(p.size)}</p><button id="binaryOpen" class="btn primary">打开文件</button></div>`;
			$("binaryOpen").onclick = () => void openExternal();
		}
	} catch (e) {
		$("filePreview").innerHTML =
			`<div class="empty-state"><b>读取失败</b><span>${escapeHtml(String(e))}</span></div>`;
	}
}
async function openExternal() {
	if (currentFilePath && currentWorkspace)
		await invoke("open_workspace_path", { root: currentWorkspace, path: currentFilePath });
}
async function chooseWorkspace() {
	const chosen = await invoke<string | null>("choose_workspace");
	if (!chosen) return;
	currentWorkspace = chosen;
	localStorage.setItem("wq-workspace", chosen);
	$("workspacePath").querySelector<HTMLElement>(".root-text")!.textContent = chosen;
	$("workspacePath").title = chosen;
	$("footerWorkspace").textContent = chosen;
	await Promise.all([refreshFiles(), status(), dashboard()]);
}
async function waitRuntimeReady(timeoutMs = 15000) {
	const start = Date.now();
	while (!runtimeReady && Date.now() - start < timeoutMs) await new Promise(r => setTimeout(r, 80));
	if (!runtimeReady) throw new Error("Runtime 启动超时：没有收到 OMP ready 帧");
}
async function probeExistingRuntime() {
	try {
		const response = await requestRpc("get_state", {}, 3500);
		const state = responseData(response, "get_state");
		if (!state) return false;
		runtimeReady = true;
		agentMode = "runtime";
		applyRuntimeState(state);
		$("composerMode").textContent = "结构化 Runtime · 已恢复连接";
		return true;
	} catch {
		return false;
	}
}
async function startRuntime() {
	if (!currentWorkspace) await chooseWorkspace();
	if (!currentWorkspace) return false;
	const s = await status();
	if (s.running) {
		if (s.runtime_mode === "runtime") {
			if (await probeExistingRuntime()) return true;
			throw new Error("Runtime 进程仍在，但 RPC 探测失败；请停止后重新启动");
		}
		throw new Error(`当前已有 ${s.runtime_mode || "Agent"} 进程运行，请先停止`);
	}
	runtimeReady = false;
	protocolVersion = 1;
	runtimeDecoder.reset();
	rejectPendingRpc("Runtime 正在重启");
	agentMode = "runtime";
	term.clear();
	term.writeln("\x1b[34m[Studio] 启动 omp-wanwandequ runtime\x1b[0m");
	await invoke("start_runtime", { cwd: currentWorkspace });
	await waitRuntimeReady();
	await status();
	return true;
}
async function launchHeadless(args: string[], label: "competition" | "solve" | "doctor") {
	if (!currentWorkspace) await chooseWorkspace();
	if (!currentWorkspace) return;
	const s = await status();
	if (s.running) throw new Error("已有 Agent 进程在运行，请先停止");
	runtimeReady = false;
	protocolVersion = 1;
	rejectPendingRpc("已切换到 headless 任务");
	runtimeDecoder.reset();
	agentMode = label;
	term.clear();
	term.writeln(`\x1b[34m[Studio] 启动 headless: ${args.join(" ")}\x1b[0m`);
	await invoke("start_headless", { cwd: currentWorkspace, args, label });
	await status();
}
async function sendPrompt() {
	const input = $("promptInput") as HTMLTextAreaElement;
	const text = input.value.trim();
	if (!text) return;
	try {
		await startRuntime();
		addChatMessage("user", text);
		liveAssistant = null;
		ensureLiveAssistant();
		input.value = "";
		await requestRpc("prompt", { message: text }, 10000);
	} catch (e) {
		finalizeAssistant();
		addChatMessage("system", `发送失败：${String(e)}`);
	}
}
async function saveSecret(kind: "api" | "token", inputId: string) {
	const input = $(inputId) as HTMLInputElement;
	const value = input.value.trim();
	if (!value) return;
	await invoke("save_secret", { kind, value });
	input.value = "";
	$("configSaved").textContent = "已保存";
	setTimeout(() => ($("configSaved").textContent = "本机配置"), 1500);
	await status();
}
async function saveRuntimeConfig() {
	const provider = ($("providerInput") as HTMLInputElement).value.trim() || "deepseek",
		preset = ($("presetInput") as HTMLSelectElement).value,
		queryUrl = ($("queryUrl") as HTMLInputElement).value.trim(),
		resetUrl = ($("resetUrl") as HTMLInputElement).value.trim(),
		submitUrl = ($("submitUrl") as HTMLInputElement).value.trim();
	for (const [kind, value] of [
		["provider", provider],
		["preset", preset],
		["query_url", queryUrl],
		["reset_url", resetUrl],
		["submit_url", submitUrl],
	] as const)
		await invoke("save_setting", { kind, value });
	$("configSaved").textContent = "配置已应用";
	setTimeout(() => ($("configSaved").textContent = "本机配置"), 1700);
	await status();
}
function showError(error: unknown) {
	addChatMessage("system", String(error));
	setView("chat");
}

qsa<HTMLButtonElement>(".stage-tab").forEach(btn => (btn.onclick = () => setView(btn.dataset.view as ViewName)));
qsa<HTMLButtonElement>(".inspector-tab").forEach(
	btn => (btn.onclick = () => setInspector(btn.dataset.inspector as InspectorName)),
);
qsa<HTMLButtonElement>(".reveal-btn").forEach(
	btn =>
		(btn.onclick = () => {
			const target = $(btn.dataset.target!) as HTMLInputElement;
			const visible = target.type === "text";
			target.type = visible ? "password" : "text";
			btn.textContent = visible ? "显示" : "隐藏";
		}),
);
$("chooseBtn").onclick = () => void chooseWorkspace();
$("workspacePath").onclick = () => void chooseWorkspace();
$("refreshBtn").onclick = () => void refreshFiles();
$("openExternalBtn").onclick = () => void openExternal();
$("railChat").onclick = () => setView("chat");
$("railTerminal").onclick = () => setView("terminal");
$("railConfig").onclick = () => setInspector("config");
$("chatStartBtn").onclick = () =>
	void startRuntime()
		.then(() => setView("chat"))
		.catch(showError);
$("sendBtn").onclick = () => void sendPrompt();
($("promptInput") as HTMLTextAreaElement).addEventListener("keydown", e => {
	if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
		e.preventDefault();
		void sendPrompt();
	}
});
$("solveBtn").onclick = () =>
	void launchHeadless(
		["solve", currentWorkspace || ".", "--preset", ($("presetInput") as HTMLSelectElement).value || "turbo"],
		"solve",
	)
		.then(() => setView("terminal"))
		.catch(showError);
$("doctorBtn").onclick = () =>
	void launchHeadless(["doctor"], "doctor")
		.then(() => setView("terminal"))
		.catch(showError);
$("debugTuiBtn").onclick = () =>
	void (async () => {
		if (!currentWorkspace) await chooseWorkspace();
		if (currentWorkspace) await invoke("open_debug_tui", { cwd: currentWorkspace });
	})().catch(showError);
$("stopBtn").onclick = () =>
	void invoke("stop_agent")
		.catch(() => {})
		.then(async () => {
			runtimeReady = false;
			protocolVersion = 1;
			runtimeDecoder.reset();
			rejectPendingRpc("Runtime 已停止");
			agentMode = "idle";
			finalizeAssistant();
			$("protocolValue").textContent = "v1";
			await status();
		});
$("competitionBtn").onclick = () =>
	void status().then(s => {
		if (!s.team_token) {
			setInspector("config");
			$("teamToken").focus();
			return;
		}
		if (!s.query_url || !s.reset_url || !s.submit_url) {
			setInspector("config");
			addChatMessage(
				"system",
				"正式比赛前必须显式配置 Query / Reset / Submit 三个赛事 API URL；Studio 不再提供写死的比赛端点。",
			);
			return;
		}
		$("confirmModal").classList.remove("hidden");
	});
$("cancelCompetition").onclick = () => $("confirmModal").classList.add("hidden");
$("confirmCompetition").onclick = () =>
	void (async () => {
		$("confirmModal").classList.add("hidden");
		await launchHeadless(["run", "--root", currentWorkspace], "competition");
		setInspector("run");
		setView("terminal");
	})().catch(showError);
$("saveApi").onclick = () => void saveSecret("api", "apiKey").catch(showError);
$("saveToken").onclick = () => void saveSecret("token", "teamToken").catch(showError);
$("saveRuntimeConfig").onclick = () => void saveRuntimeConfig().catch(showError);
window.addEventListener("resize", () => fit.fit());
new ResizeObserver(() => {
	if (currentView === "terminal") fit.fit();
}).observe($("terminalView"));
listen<string>("runtime-frame", e => void handleRuntimeFrame(e.payload));
listen<string>("process-output", e => term.write(e.payload));
listen<string>("process-stderr", e => term.write(`\x1b[31m${e.payload.replace(/\x1b/g, "")}\x1b[0m`));
listen<{ mode: string; code: number | null }>("agent-exited", async e => {
	logFrame("[exit]", e.payload, "33");
	runtimeReady = false;
	protocolVersion = 1;
	runtimeDecoder.reset();
	rejectPendingRpc(`OMP ${e.payload.mode} 已退出`);
	agentMode = "idle";
	finalizeAssistant(lastAssistantText);
	$("protocolValue").textContent = "v1";
	await Promise.all([status(), dashboard()]);
});

if (currentWorkspace) {
	$("workspacePath").querySelector<HTMLElement>(".root-text")!.textContent = currentWorkspace;
	$("workspacePath").title = currentWorkspace;
	$("footerWorkspace").textContent = currentWorkspace;
	refreshFiles().catch(console.warn);
}
renderTools();
status().catch(showError);
dashboard().catch(() => {});
setInterval(() => void dashboard(), 1200);
setInterval(() => void status(), 3500);
setInterval(() => void refreshRuntimeState(), 3000);
