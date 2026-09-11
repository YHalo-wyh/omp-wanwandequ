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
        <div class="panel-head"><span>COMPETITION</span><span id="eventSeq" class="mini">no state</span></div>
        <div class="metric-grid">
          <div class="metric"><small>SOLVED</small><strong id="solvedCount">0 / 0</strong></div>
          <div class="metric"><small>ACTIVE</small><strong id="activeCount">0</strong></div>
          <div class="metric"><small>ACCEPTED</small><strong id="acceptedCount">0</strong></div>
          <div class="metric"><small>REJECTED</small><strong id="rejectedCount">0</strong></div>
        </div>
        <button id="competitionBtn" class="wide arm">Start Competition</button>
      </section>

      <section>
        <div class="panel-head"><span>CHALLENGES</span></div>
        <div id="challengeList" class="challenge-list"><div class="muted">No competition state yet.</div></div>
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
        <div class="kv"><span>State</span><strong>.wq/state.json</strong></div>
        <div class="kv"><span>Events</span><strong>.wq/events.jsonl</strong></div>
      </section>
    </aside>

    <footer class="statusbar">
      <span>Wanwandequ Studio v0.2</span>
      <span id="footerWorkspace">No workspace</span>
      <span>Persistent observer protocol</span>
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

let currentWorkspace = localStorage.getItem("wq-workspace") ?? "";
let dashboardBusy = false;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function escapeHtml(v: string) {
  return v.replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[c]!));
}
function formatSize(n: number) { return n < 1024 ? `${n} B` : n < 1024*1024 ? `${(n/1024).toFixed(1)} KB` : `${(n/1024/1024).toFixed(1)} MB`; }
function compactStatus(challenge: ChallengeView) {
  if (challenge.solved) return "SOLVED";
  if (challenge.active) return "RUNNING";
  return (challenge.last_status ?? "QUEUED").toUpperCase();
}

async function status() {
  const s = await invoke<StudioStatus>("studio_status", { workspace: currentWorkspace || null });
  $("modeBadge").textContent = s.team_token ? "ARMED" : "TEST MODE";
  $("modeBadge").className = `badge ${s.team_token ? "armed" : "test"}`;
  $("runState").textContent = s.running ? "terminal attached" : "terminal idle";
  $("apiStatus").textContent = s.api_key ? "Configured" : "Not configured";
  $("apiStatus").className = `status-line ${s.api_key ? "ok" : ""}`;
  $("tokenStatus").textContent = s.team_token ? "Configured · ARMED" : "Not configured · TEST MODE";
  $("tokenStatus").className = `status-line ${s.team_token ? "warn" : ""}`;
  $("agentPath").textContent = s.agent_path ?? "not found";
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
    $("eventSeq").textContent = d.last_event_seq ? `event #${d.last_event_seq}` : "no events";
    const rows = [...d.challenges].sort((a, b) => Number(b.active) - Number(a.active) || Number(a.solved) - Number(b.solved) || b.visits - a.visits);
    $("challengeList").innerHTML = rows.length ? rows.map(c => `
      <div class="challenge-row ${c.active ? "active" : ""} ${c.solved ? "solved" : ""}">
        <div class="challenge-top"><strong>${escapeHtml(c.question_id)}</strong><span class="challenge-status">${escapeHtml(compactStatus(c))}</span></div>
        <div class="challenge-title">${escapeHtml(c.title || c.category || "challenge")}</div>
        <div class="challenge-meta"><span>${escapeHtml(c.category || "unknown")}</span><span>visit ${c.visits}</span><span>${c.facts} facts</span><span>${c.artifacts} artifacts</span></div>
      </div>`).join("") : `<div class="muted">No competition state yet.</div>`;
  } catch {
    $("eventSeq").textContent = "state unavailable";
  } finally {
    dashboardBusy = false;
  }
}

async function refreshFiles() {
  if (!currentWorkspace) return;
  const items = await invoke<FileEntry[]>("list_workspace", { cwd: currentWorkspace });
  $("fileTree").innerHTML = items.length
    ? items.map(i => `<div class="file-row"><span>${i.is_dir ? "▸" : "·"}</span><span title="${escapeHtml(i.path)}">${escapeHtml(i.name)}</span><small>${i.is_dir ? "" : formatSize(i.size)}</small></div>`).join("")
    : `<div class="muted">Workspace is empty.</div>`;
}

async function chooseWorkspace() {
  const chosen = await invoke<string | null>("choose_workspace");
  if (!chosen) return;
  currentWorkspace = chosen;
  localStorage.setItem("wq-workspace", chosen);
  $("workspacePath").textContent = chosen;
  $("footerWorkspace").textContent = chosen;
  await Promise.all([refreshFiles(), status(), dashboard()]);
}

async function launch(args: string[]) {
  if (!currentWorkspace) await chooseWorkspace();
  if (!currentWorkspace) return;
  term.clear();
  await invoke("start_agent", { cwd: currentWorkspace, args });
  await status();
  term.focus();
  await syncTerminalSize();
}

async function syncTerminalSize() {
  fit.fit();
  if (term.cols > 0 && term.rows > 0) {
    await invoke("resize_agent", { cols: term.cols, rows: term.rows }).catch(() => {});
  }
}

$("chooseBtn").onclick = chooseWorkspace;
$("refreshBtn").onclick = refreshFiles;
$("startBtn").onclick = () => launch(["chat"]);
$("solveBtn").onclick = () => launch(["solve", currentWorkspace || ".", "--preset", "turbo"]);
$("doctorBtn").onclick = () => launch(["doctor"]);
$("competitionBtn").onclick = async () => {
  const s = await invoke<StudioStatus>("studio_status", { workspace: currentWorkspace || null });
  if (!s.team_token) {
    term.writeln("\r\n\x1b[31m[Studio] Team token is not configured. Save it first.\x1b[0m");
    return;
  }
  await launch(["run", "--root", currentWorkspace]);
};
$("stopBtn").onclick = async () => { await invoke("stop_agent"); await status(); };

$("saveApi").onclick = async () => {
  const input = $("apiKey") as HTMLInputElement;
  if (!input.value.trim()) return;
  await invoke("save_secret", { kind: "api", value: input.value.trim() });
  input.value = "";
  await status();
};
$("saveToken").onclick = async () => {
  const input = $("teamToken") as HTMLInputElement;
  await invoke("save_secret", { kind: "token", value: input.value.trim() });
  input.value = "";
  await status();
};

term.onData(data => invoke("write_agent", { data }).catch(() => {}));
window.addEventListener("resize", () => void syncTerminalSize());
new ResizeObserver(() => void syncTerminalSize()).observe(document.querySelector(".center")!);

listen<string>("terminal-output", e => term.write(e.payload));
listen("agent-exited", async () => { await Promise.all([status(), dashboard()]); });

if (currentWorkspace) {
  $("workspacePath").textContent = currentWorkspace;
  $("footerWorkspace").textContent = currentWorkspace;
  refreshFiles().catch(() => {});
}
status().catch(err => term.writeln(`\r\n[Studio] ${String(err)}`));
dashboard().catch(() => {});
setInterval(() => void dashboard(), 1000);
setInterval(() => void status(), 3000);
