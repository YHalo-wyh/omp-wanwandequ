use serde::Serialize;
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

const HEARTBEAT_FRESH_MS: u64 = 12_000;
const HEARTBEAT_FUTURE_SKEW_MS: u64 = 30_000;

#[derive(Debug, Clone, Serialize, Default)]
pub struct ChallengeView {
    pub question_id: String,
    pub title: String,
    pub category: String,
    pub visits: u64,
    pub solved: bool,
    pub last_status: Option<String>,
    pub last_attempt_at: Option<u64>,
    pub last_elapsed_ms: Option<u64>,
    pub facts: usize,
    pub rejected: usize,
    pub artifacts: usize,
    pub rejected_flags: usize,
    pub handoff: Option<String>,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct DashboardSnapshot {
    pub started_at: Option<u64>,
    pub solved: usize,
    pub total: usize,
    pub accepted_submits: usize,
    pub rejected_submits: usize,
    pub active: usize,
    pub last_event_seq: u64,
    pub last_event_at: Option<u64>,
    pub last_heartbeat_at: Option<u64>,
    pub running: bool,
    pub challenges: Vec<ChallengeView>,
}

#[derive(Debug, Clone, Default)]
struct ChallengeMetadata {
    title: String,
    category: String,
}

fn read_json(path: &Path) -> Option<Value> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn value_u64(v: Option<&Value>) -> Option<u64> {
    v.and_then(Value::as_u64)
}

fn value_string(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str).map(ToOwned::to_owned)
}

fn now_ms() -> Option<u64> {
    let duration = SystemTime::now().duration_since(UNIX_EPOCH).ok()?;
    u64::try_from(duration.as_millis()).ok()
}

fn heartbeat_fresh(runtime: &Path) -> (bool, Option<u64>) {
    let heartbeat = read_json(&runtime.join("heartbeat.json"));
    let updated_at = heartbeat.as_ref().and_then(|value| value_u64(value.get("updatedAt")));
    let Some(updated_at) = updated_at else {
        return (false, None);
    };
    let Some(now) = now_ms() else {
        return (false, Some(updated_at));
    };
    let not_implausibly_future = updated_at <= now.saturating_add(HEARTBEAT_FUTURE_SKEW_MS);
    let fresh = not_implausibly_future && now.saturating_sub(updated_at) <= HEARTBEAT_FRESH_MS;
    (fresh, Some(updated_at))
}

fn read_workspace_metadata(root: &Path) -> BTreeMap<String, ChallengeMetadata> {
    let mut out = BTreeMap::new();
    let Ok(entries) = fs::read_dir(root.join("workspaces")) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path().join("WQ_CHALLENGE.json");
        let Some(meta) = read_json(&path) else { continue };
        let Some(question_id) = meta.get("question_id").and_then(Value::as_str) else { continue };
        out.insert(
            question_id.to_owned(),
            ChallengeMetadata {
                title: value_string(meta.get("title")).unwrap_or_default(),
                category: value_string(meta.get("category")).unwrap_or_default(),
            },
        );
    }
    out
}

fn clear_active(challenges: &mut BTreeMap<String, ChallengeView>) {
    for item in challenges.values_mut() {
        item.active = false;
    }
}

pub fn read_dashboard(root: &Path) -> DashboardSnapshot {
    let runtime = root.join(".wq");
    let state = read_json(&runtime.join("state.json"));
    let metadata = read_workspace_metadata(root);
    let mut challenges: BTreeMap<String, ChallengeView> = BTreeMap::new();
    let mut snapshot = DashboardSnapshot::default();

    if let Some(state) = state.as_ref() {
        snapshot.started_at = value_u64(state.get("startedAt"));
        if let Some(map) = state.get("challenges").and_then(Value::as_object) {
            for (question_id, value) in map {
                let meta = metadata.get(question_id).cloned().unwrap_or_default();
                let item = ChallengeView {
                    question_id: question_id.clone(),
                    title: meta.title,
                    category: meta.category,
                    visits: value.get("visits").and_then(Value::as_u64).unwrap_or(0),
                    solved: value.get("solved").and_then(Value::as_bool).unwrap_or(false),
                    last_status: value_string(value.get("lastStatus")),
                    last_attempt_at: value_u64(value.get("lastAttemptAt")),
                    last_elapsed_ms: value_u64(value.get("lastElapsedMs")),
                    facts: value.get("facts").and_then(Value::as_array).map_or(0, Vec::len),
                    rejected: value.get("rejected").and_then(Value::as_array).map_or(0, Vec::len),
                    artifacts: value.get("artifacts").and_then(Value::as_array).map_or(0, Vec::len),
                    rejected_flags: value.get("rejectedFlags").and_then(Value::as_array).map_or(0, Vec::len),
                    handoff: value_string(value.get("lastHandoff")),
                    active: false,
                };
                challenges.insert(question_id.clone(), item);
            }
        }
    }

    // events.jsonl is an immutable history. It tells us whether the latest known
    // lifecycle entered a run, but it cannot prove that the process is still alive.
    let events_path = runtime.join("events.jsonl");
    if let Ok(text) = fs::read_to_string(events_path) {
        for line in text.lines().filter(|line| !line.trim().is_empty()) {
            let Ok(event) = serde_json::from_str::<Value>(line) else { continue };
            let seq = event.get("seq").and_then(Value::as_u64).unwrap_or(0);
            snapshot.last_event_seq = snapshot.last_event_seq.max(seq);
            snapshot.last_event_at = value_u64(event.get("ts")).or(snapshot.last_event_at);
            let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
            let data = event.get("data").and_then(Value::as_object);
            let question_id = data.and_then(|d| d.get("questionId")).and_then(Value::as_str);
            match event_type {
                "run.started" => {
                    snapshot.running = true;
                    clear_active(&mut challenges);
                }
                "run.finished" | "run.scope_solved" => {
                    snapshot.running = false;
                    clear_active(&mut challenges);
                }
                "submit.accepted" => snapshot.accepted_submits += 1,
                "submit.rejected" => snapshot.rejected_submits += 1,
                "challenge.started" => {
                    if let Some(id) = question_id {
                        let item = challenges.entry(id.to_owned()).or_insert_with(|| ChallengeView {
                            question_id: id.to_owned(),
                            ..ChallengeView::default()
                        });
                        item.active = true;
                        if item.title.is_empty() {
                            item.title = data.and_then(|d| d.get("title")).and_then(Value::as_str).unwrap_or("").to_owned();
                        }
                        if item.category.is_empty() {
                            item.category = data.and_then(|d| d.get("category")).and_then(Value::as_str).unwrap_or("").to_owned();
                        }
                    }
                }
                "visit.completed" | "visit.unstructured" => {
                    if let Some(id) = question_id {
                        if let Some(item) = challenges.get_mut(id) {
                            item.active = false;
                        }
                    }
                }
                _ => {}
            }
        }
    }

    let (heartbeat_is_fresh, heartbeat_at) = heartbeat_fresh(&runtime);
    snapshot.last_heartbeat_at = heartbeat_at;
    snapshot.running = snapshot.running && heartbeat_is_fresh;
    if !snapshot.running {
        clear_active(&mut challenges);
    }
    snapshot.total = challenges.len();
    snapshot.solved = challenges.values().filter(|item| item.solved).count();
    snapshot.active = challenges.values().filter(|item| item.active).count();
    snapshot.challenges = challenges.into_values().collect();
    snapshot
}
