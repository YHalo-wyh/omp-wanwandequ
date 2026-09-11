mod dashboard;

use dashboard::DashboardSnapshot;
use serde::Serialize;
use std::{
    env,
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};

const DEFAULT_QUERY_URL: &str = "https://apiterminator.ichunqiu.com/04cb510e425bd8f64fa97ba66f3935e1";
const DEFAULT_RESET_URL: &str = "https://apiterminator.ichunqiu.com/deed3dba39e57b7cf95ea63ddd84e0c8";
const DEFAULT_SUBMIT_URL: &str = "https://apiterminator.ichunqiu.com/ff874ef3172cbf4fd6ec2c5653a568e2";
const MODEL_ID: &str = "deepseek-v4-flash";
const PREVIEW_LIMIT: u64 = 1024 * 1024;

#[derive(Default)]
struct StudioState {
    process: Arc<Mutex<Option<AgentHandle>>>,
    running: Arc<AtomicBool>,
    mode: Arc<Mutex<String>>,
}

struct AgentHandle {
    child: Arc<Mutex<Child>>,
    stdin: Option<ChildStdin>,
    mode: String,
    cwd: PathBuf,
}

#[derive(Serialize)]
struct StudioStatus {
    api_key: bool,
    team_token: bool,
    running: bool,
    runtime_mode: String,
    workspace: String,
    agent_path: Option<String>,
    provider: String,
    preset: String,
    model_id: String,
    query_url: String,
    reset_url: String,
    submit_url: String,
}

#[derive(Clone, Serialize)]
struct ProcessExit {
    mode: String,
    code: Option<i32>,
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
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("wanwandequ-studio.log"))
    {
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

fn apply_wq_environment(command: &mut Command) {
    for key in [
        "DEEPSEEK_API_KEY",
        "WQ_TEAM_TOKEN",
        "WANWANDEQU_PROVIDER",
        "WANWANDEQU_PRESET",
        "WANWANDEQU_THINKING",
        "WQ_QUERY_URL",
        "WQ_RESET_URL",
        "WQ_SUBMIT_URL",
    ] {
        if let Some(value) = read_env_value(key) {
            command.env(key, value);
        }
    }
}

fn validate_workspace(cwd: &str) -> Result<PathBuf, String> {
    let cwd_path = PathBuf::from(cwd);
    if !cwd_path.is_dir() {
        return Err("工作区目录不存在".into());
    }
    Ok(cwd_path)
}

fn competition_log_file(cwd: &Path, name: &str) -> Result<File, String> {
    let log_dir = cwd.join(".wq").join("logs");
    fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join(name))
        .map_err(|e| e.to_string())
}

fn terminate_child_tree(child: &mut Child) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let pid = child.id().to_string();
        if let Ok(status) = Command::new("taskkill")
            .args(["/PID", &pid, "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
        {
            if status.success() {
                let _ = child.wait();
                return Ok(());
            }
        }
    }
    child.kill().map_err(|e| e.to_string())
}

fn spawn_managed_process(
    app: &AppHandle,
    state: &State<StudioState>,
    cwd: &str,
    args: &[String],
    mode_name: &str,
    structured_stdout: bool,
) -> Result<(), String> {
    if state.running.load(Ordering::SeqCst) {
        return Err("OMP Agent 已在运行".into());
    }
    let cwd_path = validate_workspace(cwd)?;
    let executable = find_agent(app)
        .ok_or_else(|| "未找到 omp-wanwandequ。请安装 Agent 或通过 WANWANDEQU_BIN 指定路径。".to_string())?;

    let persistent_competition = mode_name == "competition";
    let mut command = Command::new(executable);
    command.current_dir(&cwd_path).args(args);
    apply_wq_environment(&mut command);

    if persistent_competition {
        // Competition must not depend on Studio's WebView or pipe lifetime. If the
        // GUI closes, these file-backed descriptors stay valid and the controller
        // keeps solving until its own deadline.
        let stdout = competition_log_file(&cwd_path, "competition-supervisor.stdout.log")?;
        let stderr = competition_log_file(&cwd_path, "competition-supervisor.stderr.log")?;
        command
            .stdin(Stdio::null())
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr));
    } else {
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
    }

    let mut child = command.spawn().map_err(|e| format!("启动 OMP Agent 失败：{e}"))?;
    let stdin = if persistent_competition { None } else { child.stdin.take() };
    let stdout = if persistent_competition { None } else { child.stdout.take() };
    let stderr = if persistent_competition { None } else { child.stderr.take() };
    let child = Arc::new(Mutex::new(child));

    // Publish ownership before starting monitor threads so an unusually fast
    // child exit cannot race with a late handle assignment.
    {
        let mut process = state.process.lock().map_err(|_| "进程锁异常")?;
        *process = Some(AgentHandle {
            child: child.clone(),
            stdin,
            mode: mode_name.to_string(),
            cwd: cwd_path.clone(),
        });
    }
    state.running.store(true, Ordering::SeqCst);
    if let Ok(mut current_mode) = state.mode.lock() {
        *current_mode = mode_name.to_string();
    }

    if let Some(stdout) = stdout {
        let stdout_app = app.clone();
        let stdout_mode = mode_name.to_string();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                if structured_stdout {
                    if !line.trim().is_empty() {
                        let _ = stdout_app.emit("runtime-frame", line);
                    }
                } else {
                    let _ = stdout_app.emit("process-output", format!("{line}\n"));
                }
            }
            let _ = stdout_app.emit("process-stream-closed", stdout_mode);
        });
    } else if persistent_competition {
        let _ = app.emit(
            "process-output",
            format!(
                "[Studio] 正式比赛已使用文件日志运行：{}\n",
                cwd_path.join(".wq").join("logs").to_string_lossy()
            ),
        );
    }

    if let Some(stderr) = stderr {
        let stderr_app = app.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                let _ = stderr_app.emit("process-stderr", format!("{line}\n"));
            }
        });
    }

    let monitor_child = child.clone();
    let monitor_app = app.clone();
    let monitor_running = state.running.clone();
    let monitor_mode_state = state.mode.clone();
    let monitor_process_state = state.process.clone();
    let monitor_mode = mode_name.to_string();
    thread::spawn(move || loop {
        let status = {
            let mut guard = match monitor_child.lock() {
                Ok(guard) => guard,
                Err(_) => break,
            };
            guard.try_wait()
        };
        match status {
            Ok(Some(exit)) => {
                monitor_running.store(false, Ordering::SeqCst);
                if let Ok(mut current_mode) = monitor_mode_state.lock() {
                    current_mode.clear();
                }
                if let Ok(mut process) = monitor_process_state.lock() {
                    if process.as_ref().is_some_and(|handle| handle.mode == monitor_mode) {
                        process.take();
                    }
                }
                let _ = monitor_app.emit(
                    "agent-exited",
                    ProcessExit {
                        mode: monitor_mode,
                        code: exit.code(),
                    },
                );
                break;
            }
            Ok(None) => thread::sleep(Duration::from_millis(120)),
            Err(_) => {
                monitor_running.store(false, Ordering::SeqCst);
                break;
            }
        }
    });

    audit(&cwd_path, &format!("[studio] start mode={mode_name} args={args:?}"));
    Ok(())
}

#[tauri::command]
fn studio_status(app: AppHandle, state: State<StudioState>, workspace: Option<String>) -> StudioStatus {
    StudioStatus {
        api_key: read_env_value("DEEPSEEK_API_KEY").is_some(),
        team_token: read_env_value("WQ_TEAM_TOKEN").is_some(),
        running: state.running.load(Ordering::SeqCst),
        runtime_mode: state.mode.lock().map(|mode| mode.clone()).unwrap_or_default(),
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
    rfd::FileDialog::new()
        .set_title("选择 CTF 工作区")
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned())
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
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
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
    Read::by_ref(&mut file)
        .take(PREVIEW_LIMIT)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let truncated = meta.len() > PREVIEW_LIMIT;
    let text = String::from_utf8(bytes).ok();
    let binary = text.is_none();
    Ok(FilePreview {
        name: target
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
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
            if value.is_empty()
                || !value
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
            {
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
fn start_runtime(app: AppHandle, state: State<StudioState>, cwd: String) -> Result<(), String> {
    spawn_managed_process(&app, &state, &cwd, &["runtime".to_string()], "runtime", true)
}

#[tauri::command]
fn start_headless(
    app: AppHandle,
    state: State<StudioState>,
    cwd: String,
    args: Vec<String>,
    label: String,
) -> Result<(), String> {
    let action = args.first().map(String::as_str).unwrap_or_default();
    let expected_label = match action {
        "doctor" => "doctor",
        "solve" => "solve",
        "run" => "competition",
        _ => return Err("Studio 只允许启动 doctor / solve / run 三类无界面任务".into()),
    };
    if label != expected_label {
        return Err("Headless 任务标签与实际命令不一致".into());
    }
    if action == "run" && dashboard::read_dashboard(Path::new(&cwd)).running {
        return Err("该工作区已有存活的正式比赛控制器，拒绝重复启动".into());
    }
    spawn_managed_process(&app, &state, &cwd, &args, expected_label, false)
}

#[tauri::command]
fn runtime_command(state: State<StudioState>, frame: String) -> Result<(), String> {
    let parsed: serde_json::Value = serde_json::from_str(&frame).map_err(|e| format!("RPC 命令不是合法 JSON：{e}"))?;
    if !parsed.is_object() {
        return Err("RPC 命令必须是 JSON 对象".into());
    }
    let mut guard = state.process.lock().map_err(|_| "进程锁异常")?;
    let handle = guard.as_mut().ok_or_else(|| "Wanwandequ Runtime 当前没有运行".to_string())?;
    if handle.mode != "runtime" {
        return Err("当前运行的不是结构化 Runtime".into());
    }
    let stdin = handle.stdin.as_mut().ok_or_else(|| "Runtime stdin 已关闭".to_string())?;
    stdin.write_all(frame.as_bytes()).map_err(|e| e.to_string())?;
    stdin.write_all(b"\n").map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())
}

#[tauri::command]
fn stop_agent(state: State<StudioState>) -> Result<(), String> {
    let mut guard = state.process.lock().map_err(|_| "进程锁异常")?;
    if let Some(handle) = guard.take() {
        let mode = handle.mode.clone();
        let cwd = handle.cwd.clone();
        let mut child = handle.child.lock().map_err(|_| "子进程锁异常")?;
        terminate_child_tree(&mut child)?;
        if mode == "competition" {
            let _ = fs::remove_file(cwd.join(".wq").join("heartbeat.json"));
        }
    }
    state.running.store(false, Ordering::SeqCst);
    if let Ok(mut mode) = state.mode.lock() {
        mode.clear();
    }
    Ok(())
}

#[tauri::command]
fn open_debug_tui(app: AppHandle, cwd: String) -> Result<(), String> {
    let cwd_path = validate_workspace(&cwd)?;
    let executable = find_agent(&app)
        .ok_or_else(|| "未找到 omp-wanwandequ。请安装 Agent 或通过 WANWANDEQU_BIN 指定路径。".to_string())?;

    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("cmd");
        command
            .current_dir(&cwd_path)
            .arg("/C")
            .arg("start")
            .arg("Wanwandequ Debug TUI")
            .arg("cmd")
            .arg("/K")
            .arg(executable)
            .arg("chat");
        apply_wq_environment(&mut command);
        command.spawn().map_err(|e| e.to_string())?;
        audit(&cwd_path, "[studio] opened native debug TUI");
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = executable;
        Err("当前版本只在 Windows 上自动打开独立调试终端；其他平台请手动运行 omp-wanwandequ chat".into())
    }
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
            start_runtime,
            start_headless,
            runtime_command,
            stop_agent,
            open_debug_tui
        ])
        .run(tauri::generate_context!())
        .expect("启动万万得取 Studio 失败");
}
