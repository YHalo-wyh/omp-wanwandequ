mod dashboard;

use dashboard::DashboardSnapshot;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    env,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
};
use tauri::{AppHandle, Emitter, Manager, State};

const DEFAULT_QUERY_URL: &str = "https://apiterminator.ichunqiu.com/04cb510e425bd8f64fa97ba66f3935e1";
const DEFAULT_RESET_URL: &str = "https://apiterminator.ichunqiu.com/deed3dba39e57b7cf95ea63ddd84e0c8";
const DEFAULT_SUBMIT_URL: &str = "https://apiterminator.ichunqiu.com/ff874ef3172cbf4fd6ec2c5653a568e2";
const MODEL_ID: &str = "deepseek-v4-flash";
const PREVIEW_LIMIT: u64 = 1024 * 1024;

#[derive(Default)]
struct StudioState {
    process: Mutex<Option<AgentHandle>>,
    running: Arc<AtomicBool>,
}

struct AgentHandle {
    child: Box<dyn Child + Send + Sync>,
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
}

#[derive(Serialize)]
struct StudioStatus {
    api_key: bool,
    team_token: bool,
    running: bool,
    workspace: String,
    agent_path: Option<String>,
    provider: String,
    preset: String,
    model_id: String,
    query_url: String,
    reset_url: String,
    submit_url: String,
}

#[derive(Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
}

#[derive(Serialize)]
struct FilePreview {
    name: String,
    path: String,
    size: u64,
    text: Option<String>,
    binary: bool,
    truncated: bool,
}

fn home_dir() -> PathBuf {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn env_file() -> PathBuf {
    home_dir().join(".omp-wanwandequ").join(".env")
}

fn read_env_value(key: &str) -> Option<String> {
    let text = fs::read_to_string(env_file()).ok()?;
    text.lines().find_map(|line| {
        let (k, v) = line.split_once('=')?;
        if k.trim() == key {
            let value = v.trim().trim_matches(['\'', '"']).to_string();
            (!value.is_empty()).then_some(value)
        } else {
            None
        }
    })
}

fn write_env_value(key: &str, value: &str) -> Result<(), String> {
    if value.contains(['\0', '\r', '\n']) {
        return Err("配置值不能包含换行或 NUL 字符".into());
    }
    let file = env_file();
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let old = fs::read_to_string(&file).unwrap_or_default();
    let prefix = format!("{key}=");
    let mut found = false;
    let mut lines: Vec<String> = old
        .lines()
        .map(|line| {
            if line.starts_with(&prefix) {
                found = true;
                format!("{prefix}{value}")
            } else {
                line.to_string()
            }
        })
        .collect();
    if !found {
        lines.push(format!("{prefix}{value}"));
    }
    if !lines.iter().any(|line| line.starts_with("WANWANDEQU_PRESET=")) {
        lines.push("WANWANDEQU_PRESET=turbo".into());
    }
    fs::write(&file, format!("{}\n", lines.join("\n"))).map_err(|e| e.to_string())
}

fn configured_or(key: &str, fallback: &str) -> String {
    read_env_value(key).unwrap_or_else(|| fallback.to_string())
}

fn path_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let exe = if cfg!(windows) { "omp-wanwandequ.exe" } else { "omp-wanwandequ" };
    let mut out = Vec::new();
    if let Some(path) = env::var_os("WANWANDEQU_BIN") {
        out.push(PathBuf::from(path));
    }
    if let Ok(current) = env::current_exe() {
        if let Some(dir) = current.parent() {
            out.push(dir.join(exe));
        }
    }
    if let Ok(dir) = app.path().resource_dir() {
        out.push(dir.join(exe));
        out.push(dir.join("binaries").join(exe));
    }
    if let Some(paths) = env::var_os("PATH") {
        for dir in env::split_paths(&paths) {
            out.push(dir.join(exe));
        }
    }
    out
}

fn find_agent(app: &AppHandle) -> Option<PathBuf> {
    path_candidates(app).into_iter().find(|path| path.is_file())
}

fn audit(cwd: &Path, message: &str) {
    let log_dir = cwd.join("logs");
    if fs::create_dir_all(&log_dir).is_err() {
        return;
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_dir.join("wanwandequ-studio.log")) {
        let _ = writeln!(file, "{}", message);
    }
}

fn checked_workspace_path(root: &str, target: &str) -> Result<(PathBuf, PathBuf), String> {
    let root = fs::canonicalize(root).map_err(|e| format!("工作区路径无效：{e}"))?;
    let target = fs::canonicalize(target).map_err(|e| format!("文件路径无效：{e}"))?;
    if !target.starts_with(&root) {
        return Err("拒绝访问工作区之外的路径".into());
    }
    Ok((root, target))
}

fn apply_wq_environment(command: &mut CommandBuilder) {
    for key in [
        "DEEPSEEK_API_KEY",
        "WQ_TEAM_TOKEN",
        "WANWANDEQU_PROVIDER",
        "WANWANDEQU_PRESET",
        "WQ_QUERY_URL",
        "WQ_RESET_URL",
        "WQ_SUBMIT_URL",
    ] {
        if let Some(value) = read_env_value(key) {
            command.env(key, value);
        }
    }
}

#[tauri::command]
fn studio_status(app: AppHandle, state: State<StudioState>, workspace: Option<String>) -> StudioStatus {
    StudioStatus {
        api_key: read_env_value("DEEPSEEK_API_KEY").is_some(),
        team_token: read_env_value("WQ_TEAM_TOKEN").is_some(),
        running: state.running.load(Ordering::SeqCst),
        workspace: workspace.unwrap_or_default(),
        agent_path: find_agent(&app).map(|path| path.to_string_lossy().into_owned()),
        provider: configured_or("WANWANDEQU_PROVIDER", "deepseek"),
        preset: configured_or("WANWANDEQU_PRESET", "turbo"),
        model_id: MODEL_ID.to_string(),
        query_url: configured_or("WQ_QUERY_URL", DEFAULT_QUERY_URL),
        reset_url: configured_or("WQ_RESET_URL", DEFAULT_RESET_URL),
        submit_url: configured_or("WQ_SUBMIT_URL", DEFAULT_SUBMIT_URL),
    }
}

#[tauri::command]
fn dashboard_snapshot(cwd: String) -> Result<DashboardSnapshot, String> {
    let root = PathBuf::from(cwd);
    if !root.is_dir() {
        return Err("工作区目录不存在".into());
    }
    Ok(dashboard::read_dashboard(&root))
}

#[tauri::command]
fn choose_workspace() -> Option<String> {
    rfd::FileDialog::new().set_title("选择 CTF 工作区").pick_folder().map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_workspace(cwd: String) -> Result<Vec<FileEntry>, String> {
    let root = PathBuf::from(cwd);
    let mut entries = Vec::new();
    for item in fs::read_dir(&root).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let meta = item.metadata().map_err(|e| e.to_string())?;
        entries.push(FileEntry {
            name: item.file_name().to_string_lossy().into_owned(),
            path: item.path().to_string_lossy().into_owned(),
            is_dir: meta.is_dir(),
            size: if meta.is_file() { meta.len() } else { 0 },
        });
    }
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(entries)
}

#[tauri::command]
fn read_workspace_file(root: String, path: String) -> Result<FilePreview, String> {
    let (_, target) = checked_workspace_path(&root, &path)?;
    let meta = fs::metadata(&target).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("所选路径不是文件".into());
    }
    let mut file = File::open(&target).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    std::io::Read::by_ref(&mut file)
        .take(PREVIEW_LIMIT)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let truncated = meta.len() > PREVIEW_LIMIT;
    let text = String::from_utf8(bytes).ok();
    let binary = text.is_none();
    Ok(FilePreview {
        name: target.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default(),
        path: target.to_string_lossy().into_owned(),
        size: meta.len(),
        text,
        binary,
        truncated,
    })
}

#[tauri::command]
fn open_workspace_path(root: String, path: String) -> Result<(), String> {
    let (_, target) = checked_workspace_path(&root, &path)?;
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C").arg("start").arg("").arg(&target);
        cmd
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(&target);
        cmd
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(&target);
        cmd
    };
    command.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_secret(kind: String, value: String) -> Result<(), String> {
    let key = match kind.as_str() {
        "api" => "DEEPSEEK_API_KEY",
        "token" => "WQ_TEAM_TOKEN",
        _ => return Err("未知的密钥类型".into()),
    };
    write_env_value(key, value.trim())
}

#[tauri::command]
fn save_setting(kind: String, value: String) -> Result<(), String> {
    let value = value.trim();
    let key = match kind.as_str() {
        "provider" => {
            if value.is_empty() || !value.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.')) {
                return Err("Provider 名称包含非法字符".into());
            }
            "WANWANDEQU_PROVIDER"
        }
        "preset" => {
            if !matches!(value, "safe" | "turbo" | "max") {
                return Err("预设必须是 safe、turbo 或 max".into());
            }
            "WANWANDEQU_PRESET"
        }
        "query_url" | "reset_url" | "submit_url" => {
            if !value.starts_with("https://") && !value.starts_with("http://") {
                return Err("API URL 必须以 http:// 或 https:// 开头".into());
            }
            match kind.as_str() {
                "query_url" => "WQ_QUERY_URL",
                "reset_url" => "WQ_RESET_URL",
                _ => "WQ_SUBMIT_URL",
            }
        }
        _ => return Err("未知的运行配置项".into()),
    };
    write_env_value(key, value)
}

#[tauri::command]
fn start_agent(app: AppHandle, state: State<StudioState>, cwd: String, args: Vec<String>) -> Result<(), String> {
    if state.running.load(Ordering::SeqCst) {
        return Err("OMP Agent 已在运行".into());
    }
    let cwd_path = PathBuf::from(&cwd);
    if !cwd_path.is_dir() {
        return Err("工作区目录不存在".into());
    }
    let executable = find_agent(&app).ok_or_else(|| "未找到 omp-wanwandequ。请安装 Agent 或通过 WANWANDEQU_BIN 指定路径。".to_string())?;
    let pair = native_pty_system()
        .openpty(PtySize { rows: 35, cols: 130, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let mut command = CommandBuilder::new(executable.to_string_lossy().to_string());
    command.cwd(cwd_path.clone());
    command.env("TERM", "xterm-256color");
    apply_wq_environment(&mut command);
    for arg in &args {
        command.arg(arg);
    }
    let child = pair.slave.spawn_command(command).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    state.running.store(true, Ordering::SeqCst);
    let running = state.running.clone();
    let emit_app = app.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = emit_app.emit("terminal-output", text);
                }
            }
        }
        running.store(false, Ordering::SeqCst);
        let _ = emit_app.emit("agent-exited", ());
    });
    *state.process.lock().map_err(|_| "进程锁异常")? = Some(AgentHandle { child, writer, master: pair.master });
    audit(&cwd_path, &format!("[studio] start args={:?}", args));
    Ok(())
}

#[tauri::command]
fn write_agent(state: State<StudioState>, data: String) -> Result<(), String> {
    let mut guard = state.process.lock().map_err(|_| "进程锁异常")?;
    let handle = guard.as_mut().ok_or_else(|| "OMP Agent 当前没有运行".to_string())?;
    handle.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    handle.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
fn resize_agent(state: State<StudioState>, cols: u16, rows: u16) -> Result<(), String> {
    let mut guard = state.process.lock().map_err(|_| "进程锁异常")?;
    if let Some(handle) = guard.as_mut() {
        handle
            .master
            .resize(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn stop_agent(state: State<StudioState>) -> Result<(), String> {
    let mut guard = state.process.lock().map_err(|_| "进程锁异常")?;
    if let Some(mut handle) = guard.take() {
        handle.child.kill().map_err(|e| e.to_string())?;
    }
    state.running.store(false, Ordering::SeqCst);
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .manage(StudioState::default())
        .invoke_handler(tauri::generate_handler![
            studio_status,
            dashboard_snapshot,
            choose_workspace,
            list_workspace,
            read_workspace_file,
            open_workspace_path,
            save_secret,
            save_setting,
            start_agent,
            write_agent,
            resize_agent,
            stop_agent
        ])
        .run(tauri::generate_context!())
        .expect("启动万万得取 Studio 失败");
}
