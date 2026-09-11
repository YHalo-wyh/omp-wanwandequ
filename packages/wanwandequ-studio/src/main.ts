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
};

type FileEntry = { name: string; path: string; is_dir: boolean; size: number };

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark">WQ</span><div><strong>Wanwandequ Studio</strong><small>Autonomous CTF Workspace</small></div></div>
      <div class="top-actions">
        <span id="modeBadge" class="badge test">TEST MODE</span>
        <button id="doctorBtn" class="ghost">Health Check</button>
        <button id="stopBtn" class="danger">Stop</button>
        <button id="startBtn" class="primary">Start Agent</button>
      </div>
    </header>

    <aside class="sidebar left">
      <section class="panel-head"><span>WORKSPACE</span><button id="chooseBtn" title="Choose workspace">＋</button></section>
      <div id="workspacePath" class="workspace-path">No workspace selected</div>
      <div id="fileTree" class="file-tree"><div class="muted">Choose a challenge directory.</div></div>
      <div class="sidebar-bottom">
        <button id="solveBtn" class="wide">Solve Workspace</button>
        <button id="refreshBtn" class="wide ghost">Refresh Files</button>
      </div>
    </aside>

    <main class="center">
      <div class="terminal-head"><span>AGENT TERMINAL</span><span id="runState" class="muted">idle</span></div>
      <div id="terminal"></div>
    </main>

    <aside class="sidebar right">
      <section>
        <div class="panel-head"><span>COMPETITION</span></div>
        <div class="metric-grid">
          <div class="metric"><small>MODE</small><strong id="modeText">TEST</strong></div>
          <div class="metric"><small>PROCESS</small><strong id="processText">IDLE</strong></div>
          <div class="metric"><small>ACCEPTED</small><strong id="acceptedCount">0</strong></div>
          <div class="metric"><small>FLAGS SEEN</small><strong id="flagCount">0</strong></div>
        </div>
        <button id="competitionBtn" class="wide arm">Start Competition</button>
      </section>

      <section>
        <div class="panel-head"><span>CREDENTIALS</span></div>
        <label>DeepSeek API Key</label>
        <div class="secret-row"><input id="apiKey" type="password" placeholder="Paste API key"/><button id="saveApi">Save</button></div>
        <div id="apiStatus" class="status-line">Not configured</div>
        <label>Competition Team Token</label>
        <div class="secret-row"><input id="teamToken" type="password" placeholder="Paste team token"/><button id="saveToken">Save</button></div>
        <div id="tokenStatus" class="status-line">Not configured</div>
      </section>

      <section>
        <div class="panel-head"><span>RUNTIME</span></div>
        <div class="kv"><span>Preset</span><strong>turbo</strong></div>
        <div class="kv"><span>Model</span><strong>DeepSeek V4 Flash</strong></div>
        <div class="kv"><span>Agent</span><strong id="agentPath">detecting…</strong></div>
        <div class="kv"><span>Logs</span><strong>./logs</strong></div>
      </section>
    </aside>

    <footer class="statusbar">
      <span>Wanwandequ Studio v0.1</span>
      <span id="footerWorkspace">No workspace</span>
      <span>Audit logging enabled</span>
    </footer>
  </div>
`;

const term = new Terminal({
  convertEol: true,
  cursorBlink: true,
  fontFamily: "Cascadia Code, JetBrains Mono, Consolas, monospace",
  fontSize: 13,
  scrollback: 10000,
  theme: { background: "#0b0e14", foreground: "#d7dae0", cursor: "#8b5cf6" },
});
const fit = new FitAddon();
term.loadAddon(fit);
term.open(document.querySelector<HTMLDivElement>("#terminal")!);
fit.fit();
term.writeln("\x1b[1;35mWanwandequ Studio\x1b[0m — select a workspace, configure credentials, then start.");

let accepted = 0;
let flags = 0;
let currentWorkspace = "";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function status() {
  const s = await invoke<StudioStatus>("studio_status", { workspace: currentWorkspace || null });
  $("modeBadge").textContent = s.team_token ? "ARMED" : "TEST MODE";
  $("modeBadge").className = `badge ${s.team_token ? "armed" : "test"}`;
  $("modeText").textContent = s.team_token ? "ARMED" : "TEST";
  $("processText").textContent = s.running ? "RUNNING" : "IDLE";
  $("runState").textContent = s.running ? "running" : "idle";
  $("apiStatus").textContent = s.api_key ? "Configured" : "Not configured";
  $("apiStatus").className = `status-line ${s.api_key ? "ok" : ""}`;
  $("tokenStatus").textContent = s.team_token ? "Configured · ARMED" : "Not configured · TEST MODE";
  $("tokenStatus").className = `status-line ${s.team_token ? "warn" : ""}`;
  $("agentPath").textContent = s.agent_path ?? "not found";
}

async function refreshFiles() {
  if (!currentWorkspace) return;
  const items = await invoke<FileEntry[]>("list_workspace", { cwd: currentWorkspace });
  $("fileTree").innerHTML = items.length
    ? items.map(i => `<div class="file-row"><span>${i.is_dir ? "▸" : "·"}</span><span title="${escapeHtml(i.path)}">${escapeHtml(i.name)}</span><small>${i.is_dir ? "" : formatSize(i.size)}</small></div>`).join("")
    : `<div class="muted">Workspace is empty.</div>`;
}

function escapeHtml(v: string) { return v.replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[c]!)); }
function formatSize(n: number) { return n < 1024 ? `${n} B` : n < 1024*1024 ? `${(n/1024).toFixed(1)} KB` : `${(n/1024/1024).toFixed(1)} MB`; }

async function chooseWorkspace() {
  const chosen = await invoke<string | null>("choose_workspace");
  if (!chosen) return;
  currentWorkspace = chosen;
  $("workspacePath").textContent = chosen;
  $("footerWorkspace").textContent = chosen;
  await refreshFiles();
  await status();
}

async function launch(args: string[]) {
  if (!currentWorkspace) await chooseWorkspace();
  if (!currentWorkspace) return;
  term.clear();
  await invoke("start_agent", { cwd: currentWorkspace, args });
  await status();
  term.focus();
}

$("chooseBtn").onclick = chooseWorkspace;
$("refreshBtn").onclick = refreshFiles;
$("startBtn").onclick = () => launch(["chat"]);
$("solveBtn").onclick = () => launch(["solve", currentWorkspace || ".", "--preset", "turbo"]);
$("doctorBtn").onclick = () => launch(["doctor"]);
$("competitionBtn").onclick = async () => {
  const s = await invoke<StudioStatus>("studio_status", { workspace: currentWorkspace || null });
  if (!s.team_token) { term.writeln("\r\n\x1b[31m[Studio] Team token is not configured. Save it first.\x1b[0m"); return; }
  await launch([]);
};
$("stopBtn").onclick = async () => { await invoke("stop_agent"); await status(); };

$("saveApi").onclick = async () => {
  const value = $("apiKey") as HTMLInputElement;
  if (!value.value.trim()) return;
  await invoke("save_secret", { kind: "api", value: value.value.trim() });
  value.value = "";
  await status();
};
$("saveToken").onclick = async () => {
  const value = $("teamToken") as HTMLInputElement;
  await invoke("save_secret", { kind: "token", value: value.value.trim() });
  value.value = "";
  await status();
};

term.onData(data => invoke("write_agent", { data }).catch(() => {}));
window.addEventListener("resize", () => fit.fit());
new ResizeObserver(() => fit.fit()).observe(document.querySelector(".center")!);

listen<string>("terminal-output", e => {
  term.write(e.payload);
  const upper = e.payload.toUpperCase();
  const acceptedHits = (upper.match(/ACCEPTED/g) || []).length;
  const flagHits = (e.payload.match(/flag\{/gi) || []).length;
  if (acceptedHits) { accepted += acceptedHits; $("acceptedCount").textContent = String(accepted); }
  if (flagHits) { flags += flagHits; $("flagCount").textContent = String(flags); }
});
listen("agent-exited", async () => { await status(); });

status().catch(err => term.writeln(`\r\n[Studio] ${String(err)}`));
