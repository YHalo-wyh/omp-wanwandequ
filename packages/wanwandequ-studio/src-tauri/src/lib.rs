use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    env,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
};
use tauri::{AppHandle, Emitter, Manager, State};

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
}

#[derive(Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
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
        return Err("Secret contains an invalid newline/NUL character".into());
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
    if !lines.iter().any(|l| l.starts_with("WANWANDEQU_PRESET=")) {
        lines.push("WANWANDEQU_PRESET=turbo".into());
    }
    fs::write(&file, format!("{}\n", lines.join("\n"))).map_err(|e| e.to_string())
}

fn path_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let exe = if cfg!(windows) { "omp-wanwandequ.exe" } else { "omp-wanwandequ" };
    let mut out = Vec::new();
    if let Some(p) = env::var_os("WANWANDEQU_BIN") {
        out.push(PathBuf::from(p));
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
    path_candidates(app).into_iter().find(|p| p.is_file())
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

#[tauri::command]
fn studio_status(app: AppHandle, state: State<StudioState>, workspace: Option<String>) -> StudioStatus {
    StudioStatus {
        api_key: read_env_value("DEEPSEEK_API_KEY").is_some(),
        team_token: read_env_value("WQ_TEAM_TOKEN").is_some(),
        running: state.running.load(Ordering::SeqCst),
        workspace: workspace.unwrap_or_default(),
        agent_path: find_agent(&app).map(|p| p.to_string_lossy().into_owned()),
    }
}

#[tauri::command]
fn choose_workspace() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Choose CTF workspace")
        .pick_folder()
        .map(|p| p.to_string_lossy().into_owned())
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
fn save_secret(kind: String, value: String) -> Result<(), String> {
    let key = match kind.as_str() {
        "api" => "DEEPSEEK_API_KEY",
        "token" => "WQ_TEAM_TOKEN",
        _ => return Err("Unknown secret kind".into()),
    };
    write_env_value(key, value.trim())
}

#[tauri::command]
fn start_agent(app: AppHandle, state: State<StudioState>, cwd: String, args: Vec<String>) -> Result<(), String> {
    if state.running.load(Ordering::SeqCst) {
        return Err("Agent is already running".into());
    }
    let cwd_path = PathBuf::from(&cwd);
    if !cwd_path.is_dir() {
        return Err("Workspace directory does not exist".into());
    }
    let executable = find_agent(&app).ok_or_else(|| {
        "omp-wanwandequ was not found. Install the agent or set WANWANDEQU_BIN to its path.".to_string()
    })?;

    let pair = native_pty_system()
        .openpty(PtySize { rows: 35, cols: 130, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let mut command = CommandBuilder::new(executable.to_string_lossy().to_string());
    command.cwd(cwd_path.clone());
    command.env("TERM", "xterm-256color");
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

    *state.process.lock().map_err(|_| "process lock poisoned")? = Some(AgentHandle {
        child,
        writer,
        master: pair.master,
    });
    audit(&cwd_path, &format!("[studio] start args={:?}", args));
    Ok(())
}

#[tauri::command]
fn write_agent(state: State<StudioState>, data: String) -> Result<(), String> {
    let mut guard = state.process.lock().map_err(|_| "process lock poisoned")?;
    let handle = guard.as_mut().ok_or_else(|| "Agent is not running".to_string())?;
    handle.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    handle.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
fn resize_agent(state: State<StudioState>, cols: u16, rows: u16) -> Result<(), String> {
    let mut guard = state.process.lock().map_err(|_| "process lock poisoned")?;
    if let Some(handle) = guard.as_mut() {
        handle.master.resize(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn stop_agent(state: State<StudioState>) -> Result<(), String> {
    let mut guard = state.process.lock().map_err(|_| "process lock poisoned")?;
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
            choose_workspace,
            list_workspace,
            save_secret,
            start_agent,
            write_agent,
            resize_agent,
            stop_agent
        ])
        .run(tauri::generate_context!())
        .expect("error while running Wanwandequ Studio");
}
