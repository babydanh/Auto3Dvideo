use super::tool_readiness::resolve_configured_tool;
use super::voice_tts::parse_vieneu_worker_output;
use super::*;

const MOCK_WORKER_STEPS: u64 = 6;

const MOCK_WORKER_STEP_MILLIS: u64 = 350;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CommandCodeProbeReport {
    status: String,
    http_status: Option<u16>,
    model: String,
    response_text: Option<String>,
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    total_tokens: Option<u64>,
    network_calls_made: bool,
    cost_status: String,
    process_started: bool,
    external_side_effect_unknown: bool,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExternalFixtureAttemptReport {
    pub(super) job: JobView,
    pub(super) attempt: AttemptView,
    output_path: String,
}

#[derive(Debug)]
pub(super) struct FixtureFailure {
    pub(super) output_path: String,
    pub(super) error_code: String,
    pub(super) message: String,
    pub(super) external_side_effect_unknown: bool,
    pub(super) termination_mode: String,
    pub(super) stdout_bytes: i64,
    pub(super) stderr_bytes: i64,
    pub(super) output_evidence: Vec<OutputEvidence>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LocalMediaFixtureReport {
    pub(super) output_path: String,
    pub(super) size_bytes: u64,
    pub(super) duration_seconds: f64,
    pub(super) stream_count: usize,
    pub(super) ffmpeg: ExternalProcessResult,
    pub(super) ffprobe: ExternalProcessResult,
}

fn ensure_commandcode_worker_script(workspace_root: &Path) -> Result<String, String> {
    let script_path = workspace_root
        .join(".auto3dvideo")
        .join("tools")
        .join("commandcode_llm_worker.py");
    fs::create_dir_all(
        script_path
            .parent()
            .ok_or_else(|| "Không xác định được thư mục Command Code worker".to_string())?,
    )
    .map_err(|error| format!("Không tạo được thư mục Command Code worker: {error}"))?;
    fs::write(&script_path, COMMANDCODE_LLM_WORKER_SCRIPT)
        .map_err(|error| format!("Không ghi được Command Code worker: {error}"))?;
    script_path
        .strip_prefix(workspace_root)
        .map_err(|_| "Command Code worker vượt app-data workspace".to_string())
        .map(|path| path.to_string_lossy().replace('\\', "/"))
}

pub(super) fn commandcode_worker_environment() -> Result<BTreeMap<String, String>, String> {
    let dotenv = provider_config::find_dotenv_path()
        .ok_or_else(|| "Không tìm thấy .env local để lấy credential Command Code".to_string())?;
    let canonical = fs::canonicalize(dotenv)
        .map_err(|error| format!("Không canonicalize được .env local: {error}"))?;
    let value = canonical.to_string_lossy().to_string();
    if value.len() > 4096 || value.contains(['\r', '\n', '\0']) {
        return Err("Đường dẫn .env local không hợp lệ".to_string());
    }
    Ok(BTreeMap::from([(
        "AUTO3DVIDEO_DOTENV_PATH".to_string(),
        value,
    )]))
}

pub(super) fn claim_mock_attempt(
    state: &AppState,
    attempt_id: &str,
) -> Result<(AttemptView, Arc<AtomicBool>), String> {
    let cancellation = Arc::new(AtomicBool::new(false));
    {
        let mut cancellations = state
            .cancellation_tokens
            .lock()
            .map_err(|_| "Không thể khóa mock worker registry".to_string())?;
        if cancellations.contains_key(attempt_id) {
            return Err("Attempt đang được mock worker xử lý".to_string());
        }
        cancellations.insert(attempt_id.to_string(), cancellation.clone());
    }

    let result = (|| {
        let mut connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Không mở được transaction: {error}"))?;
        let (job_id, project_id, attempt_state, job_state, timeout_seconds):
            (String, String, String, String, i64) = transaction
            .query_row(
                "SELECT a.job_id, j.project_id, a.state, j.state, a.timeout_seconds FROM job_attempts a JOIN jobs j ON j.job_id = a.job_id WHERE a.attempt_id = ?1",
                params![attempt_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .map_err(|error| format!("Không đọc được attempt: {error}"))?;
        if attempt_state != "pending" {
            return Err(format!(
                "Chỉ có thể claim mock worker cho attempt pending; hiện tại là {attempt_state}"
            ));
        }
        if job_state != "queued" {
            return Err(format!(
                "Job phải ở queued trước khi claim mock worker; hiện tại là {job_state}"
            ));
        }

        let timestamp = now_string();
        let lease_owner = format!("mock-worker:{attempt_id}");
        let changed = transaction
            .execute(
                "UPDATE job_attempts SET state='running', execution_mode='in_process_mock', worker_id='mock-worker', lease_owner=?1, lease_expires_at=?2, heartbeat_at=?3, started_at=?3, process_started=0, updated_at=?3 WHERE attempt_id=?4 AND state='pending'",
                params![lease_owner, lease_expiry_string(timeout_seconds as u64), timestamp, attempt_id],
            )
            .map_err(|error| format!("Không claim được attempt: {error}"))?;
        if changed != 1 {
            return Err("Attempt đã thay đổi trước khi claim".to_string());
        }
        let changed = transaction
            .execute(
                "UPDATE jobs SET state='running', progress=0.0, started_at=?1, error_code=NULL, error_message=NULL WHERE job_id=?2 AND state='queued'",
                params![timestamp, job_id],
            )
            .map_err(|error| format!("Không chuyển job sang running: {error}"))?;
        if changed != 1 {
            return Err("Job đã thay đổi trước khi claim mock worker".to_string());
        }
        audit_event(
            &transaction,
            Some(&project_id),
            "job.transition",
            "job",
            &job_id,
        )?;
        audit_event(
            &transaction,
            Some(&project_id),
            "attempt.claimed",
            "attempt",
            attempt_id,
        )?;
        transaction
            .commit()
            .map_err(|error| format!("Không commit được mock claim: {error}"))?;
        fetch_attempt(&connection, attempt_id)
    })();

    if result.is_err() {
        if let Ok(mut cancellations) = state.cancellation_tokens.lock() {
            cancellations.remove(attempt_id);
        }
    }
    result.map(|attempt| (attempt, cancellation))
}

pub(super) fn update_mock_heartbeat_for_state(
    state: &AppState,
    attempt_id: &str,
    progress: f64,
    timeout_seconds: u64,
) -> Result<bool, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let timestamp = now_string();
    let changed = connection
        .execute(
            "UPDATE job_attempts SET heartbeat_at=?1, lease_expires_at=?2, updated_at=?1 WHERE attempt_id=?3 AND state='running' AND lease_owner=?4",
            params![timestamp, lease_expiry_string(timeout_seconds), attempt_id, format!("mock-worker:{attempt_id}")],
        )
        .map_err(|error| format!("Không ghi được heartbeat: {error}"))?;
    if changed == 1 {
        connection
            .execute(
                "UPDATE jobs SET progress=?1 WHERE job_id=(SELECT job_id FROM job_attempts WHERE attempt_id=?2) AND state='running'",
                params![progress.clamp(0.0, 1.0), attempt_id],
            )
            .map_err(|error| format!("Không cập nhật được progress mock worker: {error}"))?;
    }
    Ok(changed == 1)
}

fn update_mock_heartbeat(
    app: &AppHandle,
    attempt_id: &str,
    progress: f64,
    timeout_seconds: u64,
) -> Result<bool, String> {
    let state = app.state::<AppState>();
    update_mock_heartbeat_for_state(&state, attempt_id, progress, timeout_seconds)
}

pub(super) fn request_attempt_cancel(state: &AppState, job_id: &str) -> Result<bool, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let attempt: Option<(String, String)> = connection
        .query_row(
            "SELECT a.attempt_id, j.project_id FROM job_attempts a JOIN jobs j ON j.job_id = a.job_id WHERE a.job_id = ?1 AND a.state IN ('running', 'cancel_requested') ORDER BY a.attempt_number DESC LIMIT 1",
            params![job_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| format!("Không đọc được attempt external/in-process đang chạy: {error}"))?;
    let Some((attempt_id, project_id)) = attempt else {
        return Ok(false);
    };
    let timestamp = now_string();
    let changed = connection
        .execute(
            "UPDATE job_attempts SET state='cancel_requested', cancellation_requested_at=?1, updated_at=?1 WHERE attempt_id=?2 AND state='running'",
            params![timestamp, attempt_id],
        )
        .map_err(|error| format!("Không ghi được yêu cầu hủy attempt: {error}"))?;
    if changed == 1 {
        audit_event(
            &connection,
            Some(&project_id),
            "attempt.cancel_requested",
            "attempt",
            &attempt_id,
        )?;
    }
    if let Ok(cancellations) = state.cancellation_tokens.lock() {
        if let Some(flag) = cancellations.get(&attempt_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }
    Ok(true)
}

pub(super) fn finish_mock_attempt_for_state(
    state: &AppState,
    attempt_id: &str,
    cancellation_requested: bool,
) -> Result<(), String> {
    let mut connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Không mở được finish transaction: {error}"))?;
    let row: Option<(String, String, String, String)> = transaction
        .query_row(
            "SELECT a.job_id, j.project_id, a.state, j.state FROM job_attempts a JOIN jobs j ON j.job_id = a.job_id WHERE a.attempt_id = ?1",
            params![attempt_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(|error| format!("Không đọc được attempt khi finish: {error}"))?;
    let Some((job_id, project_id, attempt_state, job_state)) = row else {
        return Ok(());
    };
    let cancelled = cancellation_requested
        || attempt_state == "cancel_requested"
        || job_state == "cancel_requested";
    if cancelled {
        if !matches!(attempt_state.as_str(), "running" | "cancel_requested") {
            return Ok(());
        }
        let timestamp = now_string();
        let changed = transaction
            .execute(
                "UPDATE job_attempts SET state='cancelled', finished_at=?1, termination_mode='cooperative', lease_expires_at=NULL, updated_at=?1, retryable=1 WHERE attempt_id=?2 AND state IN ('running', 'cancel_requested')",
                params![timestamp, attempt_id],
            )
            .map_err(|error| format!("Không hoàn tất cancellation attempt: {error}"))?;
        if changed != 1 {
            return Ok(());
        }
        transaction
            .execute(
                "UPDATE job_outputs SET validation_state='missing', validation_message='Mock worker dừng trước khi tạo output' WHERE attempt_id=?1",
                params![attempt_id],
            )
            .map_err(|error| format!("Không ghi evidence cancellation: {error}"))?;
        transaction
            .execute(
                "UPDATE jobs SET state='cancelled', finished_at=?1 WHERE job_id=?2 AND state IN ('running', 'cancel_requested')",
                params![timestamp, job_id],
            )
            .map_err(|error| format!("Không chuyển job sang cancelled: {error}"))?;
        audit_event(
            &transaction,
            Some(&project_id),
            "attempt.cancelled",
            "attempt",
            attempt_id,
        )?;
        audit_event(
            &transaction,
            Some(&project_id),
            "job.transition",
            "job",
            &job_id,
        )?;
    } else {
        if attempt_state != "running" {
            return Ok(());
        }
        let timestamp = now_string();
        transaction
            .execute(
                "UPDATE job_outputs SET validation_state='not_checked', validation_message='Deterministic mock không tạo binary output; chỉ hoàn tất lifecycle' WHERE attempt_id=?1",
                params![attempt_id],
            )
            .map_err(|error| format!("Không ghi mock output evidence: {error}"))?;
        let changed = transaction
            .execute(
                "UPDATE job_attempts SET state='succeeded', finished_at=?1, lease_owner=NULL, lease_expires_at=NULL, heartbeat_at=?1, updated_at=?1, retryable=0 WHERE attempt_id=?2 AND state='running'",
                params![timestamp, attempt_id],
            )
            .map_err(|error| format!("Không hoàn tất mock attempt: {error}"))?;
        if changed != 1 {
            return Ok(());
        }
        transaction
            .execute(
                "UPDATE jobs SET state='succeeded', progress=1.0, finished_at=?1 WHERE job_id=?2 AND state='running'",
                params![timestamp, job_id],
            )
            .map_err(|error| format!("Không chuyển job sang succeeded: {error}"))?;
        audit_event(
            &transaction,
            Some(&project_id),
            "attempt.succeeded",
            "attempt",
            attempt_id,
        )?;
        audit_event(
            &transaction,
            Some(&project_id),
            "job.transition",
            "job",
            &job_id,
        )?;
    }
    transaction
        .commit()
        .map_err(|error| format!("Không commit được mock finish: {error}"))?;
    Ok(())
}

fn finish_mock_attempt(
    app: &AppHandle,
    attempt_id: &str,
    cancellation_requested: bool,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    finish_mock_attempt_for_state(&state, attempt_id, cancellation_requested)
}

fn spawn_mock_worker(app: AppHandle, attempt: AttemptView, cancellation: Arc<AtomicBool>) {
    tauri::async_runtime::spawn(async move {
        for step in 1..=MOCK_WORKER_STEPS {
            tokio::time::sleep(Duration::from_millis(MOCK_WORKER_STEP_MILLIS)).await;
            if cancellation.load(Ordering::SeqCst) {
                let _ = finish_mock_attempt(&app, &attempt.attempt_id, true);
                break;
            }
            let progress = step as f64 / MOCK_WORKER_STEPS as f64;
            if !update_mock_heartbeat(
                &app,
                &attempt.attempt_id,
                progress,
                attempt.timeout_seconds as u64,
            )
            .unwrap_or(false)
            {
                let _ = finish_mock_attempt(&app, &attempt.attempt_id, true);
                break;
            }
            if step == MOCK_WORKER_STEPS {
                let _ = finish_mock_attempt(&app, &attempt.attempt_id, false);
            }
        }
        if let Some(state) = app.try_state::<AppState>() {
            if let Ok(mut cancellations) = state.cancellation_tokens.lock() {
                cancellations.remove(&attempt.attempt_id);
            }
        }
    });
}

#[tauri::command]
pub(super) fn start_mock_attempt(
    attempt_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AttemptView, String> {
    valid_text(&attempt_id, "Attempt ID")?;
    let (attempt, cancellation) = claim_mock_attempt(&state, attempt_id.trim())?;
    spawn_mock_worker(app, attempt.clone(), cancellation);
    Ok(attempt)
}

#[tauri::command]
pub(super) async fn run_ffmpeg_fixture(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<LocalMediaFixtureReport, String> {
    valid_text(&project_id, "Project ID")?;
    let (workspace_root, ffmpeg_path, ffprobe_path) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        let workspace_root: String = connection
            .query_row(
                "SELECT workspace_root FROM projects WHERE project_id = ?1",
                params![project_id.trim()],
                |row| row.get(0),
            )
            .map_err(|error| format!("Không đọc được project workspace: {error}"))?;
        let ffmpeg_path = resolve_configured_tool(&connection, "ffmpeg")?;
        let ffprobe_path = resolve_configured_tool(&connection, "ffprobe")?;
        (PathBuf::from(workspace_root), ffmpeg_path, ffprobe_path)
    };
    let workspace_root = fs::canonicalize(&workspace_root)
        .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?;
    let fixture_directory = workspace_root
        .join(".auto3dvideo")
        .join("fixtures")
        .join("ffmpeg");
    fs::create_dir_all(&fixture_directory)
        .map_err(|error| format!("Không tạo được fixture directory: {error}"))?;
    let fixture_name = format!("synthetic-1s-{}.mp4", now_id("fixture"));
    let output_path = fixture_directory.join(&fixture_name);
    let relative_output = output_path
        .strip_prefix(&workspace_root)
        .map_err(|_| "Fixture output vượt project workspace".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let working_directory = fixture_directory
        .strip_prefix(&workspace_root)
        .map_err(|_| "Fixture working directory vượt project workspace".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let cancellation = Arc::new(AtomicBool::new(false));
    let ffmpeg_spec = ProcessSpec {
        executable_id: "ffmpeg".to_string(),
        args: vec![
            "-hide_banner".to_string(),
            "-loglevel".to_string(),
            "error".to_string(),
            "-f".to_string(),
            "lavfi".to_string(),
            "-i".to_string(),
            "color=c=black:s=320x180:r=30".to_string(),
            "-f".to_string(),
            "lavfi".to_string(),
            "-i".to_string(),
            "anullsrc=channel_layout=stereo:sample_rate=48000".to_string(),
            "-t".to_string(),
            "1".to_string(),
            "-c:v".to_string(),
            "libx264".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
            "-c:a".to_string(),
            "aac".to_string(),
            "-shortest".to_string(),
            "-y".to_string(),
            fixture_name.clone(),
        ],
        working_directory: working_directory.clone(),
        environment: Default::default(),
        timeout_seconds: 60,
        expected_outputs: vec![relative_output.clone()],
    };
    let ffmpeg = run_external_process(ExternalProcessRequest {
        spec: ffmpeg_spec,
        executable_path: ffmpeg_path,
        absolute_working_directory: fixture_directory.clone(),
        output_root: workspace_root.clone(),
        cancellation: cancellation.clone(),
    })
    .await?;
    if !ffmpeg.succeeded {
        return Err("FFmpeg fixture không tạo output hợp lệ".to_string());
    }
    let ffprobe_spec = ProcessSpec {
        executable_id: "ffprobe".to_string(),
        args: vec![
            "-v".to_string(),
            "error".to_string(),
            "-print_format".to_string(),
            "json".to_string(),
            "-show_streams".to_string(),
            "-show_format".to_string(),
            fixture_name,
        ],
        working_directory,
        environment: Default::default(),
        timeout_seconds: 60,
        expected_outputs: Vec::new(),
    };
    let ffprobe = run_external_process(ExternalProcessRequest {
        spec: ffprobe_spec,
        executable_path: ffprobe_path,
        absolute_working_directory: fixture_directory,
        output_root: workspace_root,
        cancellation,
    })
    .await?;
    if !ffprobe.succeeded {
        return Err("FFprobe fixture không đọc được output".to_string());
    }
    let metadata: Value = serde_json::from_str(&ffprobe.stdout)
        .map_err(|error| format!("FFprobe trả JSON không hợp lệ: {error}"))?;
    let streams = metadata
        .get("streams")
        .and_then(Value::as_array)
        .ok_or_else(|| "FFprobe thiếu streams".to_string())?;
    let duration_seconds = metadata
        .get("format")
        .and_then(|format| format.get("duration"))
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<f64>().ok())
        .ok_or_else(|| "FFprobe thiếu duration hợp lệ".to_string())?;
    let size_bytes = fs::metadata(&output_path)
        .map_err(|error| format!("Không đọc được fixture output: {error}"))?
        .len();
    if streams.len() < 2 || duration_seconds <= 0.0 || size_bytes == 0 {
        return Err("Fixture output không đạt stream/duration/size check".to_string());
    }
    Ok(LocalMediaFixtureReport {
        output_path: relative_output,
        size_bytes,
        duration_seconds,
        stream_count: streams.len(),
        ffmpeg,
        ffprobe,
    })
}

fn claim_external_attempt(
    state: &AppState,
    attempt_id: &str,
    expected_executable: &str,
) -> Result<(AttemptView, Arc<AtomicBool>), String> {
    let cancellation = Arc::new(AtomicBool::new(false));
    {
        let mut cancellations = state
            .cancellation_tokens
            .lock()
            .map_err(|_| "Không thể khóa external worker registry".to_string())?;
        if cancellations.contains_key(attempt_id) {
            return Err("Attempt đang được external worker xử lý".to_string());
        }
        cancellations.insert(attempt_id.to_string(), cancellation.clone());
    }

    let result = (|| {
        let mut connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Không mở được transaction: {error}"))?;
        let (job_id, project_id, attempt_state, job_state, timeout_seconds, executable_id):
            (String, String, String, String, i64, Option<String>) = transaction
            .query_row(
                "SELECT a.job_id, j.project_id, a.state, j.state, a.timeout_seconds, a.executable_id FROM job_attempts a JOIN jobs j ON j.job_id = a.job_id WHERE a.attempt_id = ?1",
                params![attempt_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
            )
            .map_err(|error| format!("Không đọc được external attempt: {error}"))?;
        if attempt_state != "pending" {
            return Err(format!(
                "Chỉ có thể claim external worker cho attempt pending; hiện tại là {attempt_state}"
            ));
        }
        if job_state != "queued" {
            return Err(format!(
                "Job phải ở queued trước khi claim external worker; hiện tại là {job_state}"
            ));
        }
        if executable_id.as_deref() != Some(expected_executable) {
            return Err(format!(
                "External attempt phải dùng executable {expected_executable}"
            ));
        }

        let timestamp = now_string();
        let lease_owner = format!("external-worker:{attempt_id}");
        let changed = transaction
            .execute(
                "UPDATE job_attempts SET state='running', execution_mode='external_process', worker_id='native-external', lease_owner=?1, lease_expires_at=?2, heartbeat_at=?3, started_at=?3, process_started=1, external_side_effect_unknown=0, updated_at=?3 WHERE attempt_id=?4 AND state='pending'",
                params![lease_owner, lease_expiry_string(timeout_seconds as u64), timestamp, attempt_id],
            )
            .map_err(|error| format!("Không claim được external attempt: {error}"))?;
        if changed != 1 {
            return Err("Attempt đã thay đổi trước khi claim external worker".to_string());
        }
        let changed = transaction
            .execute(
                "UPDATE jobs SET state='running', progress=0.0, started_at=?1, error_code=NULL, error_message=NULL WHERE job_id=?2 AND state='queued'",
                params![timestamp, job_id],
            )
            .map_err(|error| format!("Không chuyển job sang running: {error}"))?;
        if changed != 1 {
            return Err("Job đã thay đổi trước khi claim external worker".to_string());
        }
        audit_event(
            &transaction,
            Some(&project_id),
            "attempt.external_claimed",
            "attempt",
            attempt_id,
        )?;
        transaction
            .commit()
            .map_err(|error| format!("Không commit được external claim: {error}"))?;
        fetch_attempt(&connection, attempt_id)
    })();

    if result.is_err() {
        if let Ok(mut cancellations) = state.cancellation_tokens.lock() {
            cancellations.remove(attempt_id);
        }
    }
    result.map(|attempt| (attempt, cancellation))
}

pub(super) fn reconcile_active_external_attempts(connection: &Connection) -> Result<usize, String> {
    let active: Vec<(String, String, String)> = {
        let mut statement = connection
            .prepare("SELECT a.attempt_id, a.job_id, j.project_id FROM job_attempts a JOIN jobs j ON j.job_id = a.job_id WHERE a.execution_mode='external_process' AND a.state IN ('running', 'cancel_requested')")
            .map_err(|error| format!("Không đọc được external attempts cần reconcile: {error}"))?;
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
    };
    if active.is_empty() {
        return Ok(0);
    }
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("Không mở được reconciliation transaction: {error}"))?;
    let timestamp = now_string();
    for (attempt_id, job_id, project_id) in &active {
        transaction
            .execute(
                "UPDATE job_attempts SET state='reconciliation_required', finished_at=?1, lease_owner=NULL, lease_expires_at=NULL, heartbeat_at=?1, external_side_effect_unknown=1, retryable=0, error_code='RESTART_RECONCILIATION_REQUIRED', redacted_message='App restart khi external process state chưa xác định', termination_mode='tree_force', updated_at=?1 WHERE attempt_id=?2 AND state IN ('running', 'cancel_requested')",
                params![timestamp, attempt_id],
            )
            .map_err(|error| format!("Không reconcile được attempt: {error}"))?;
        transaction
            .execute(
                "UPDATE job_outputs SET validation_state='not_checked', validation_message='App restart khi external process state chưa xác định' WHERE attempt_id=?1 AND validation_state='pending'",
                params![attempt_id],
            )
            .map_err(|error| format!("Không reconcile được output evidence: {error}"))?;
        transaction
            .execute(
                "UPDATE jobs SET state='reconciliation_required', finished_at=?1, error_code='RESTART_RECONCILIATION_REQUIRED', error_message='App restart khi external process state chưa xác định' WHERE job_id=?2 AND state IN ('running', 'cancel_requested')",
                params![timestamp, job_id],
            )
            .map_err(|error| format!("Không reconcile được job: {error}"))?;
        audit_event(
            &transaction,
            Some(project_id),
            "attempt.restart_reconciliation_required",
            "attempt",
            attempt_id,
        )?;
    }
    transaction
        .commit()
        .map_err(|error| format!("Không commit được reconciliation: {error}"))?;
    Ok(active.len())
}

fn failure_from_process_error(output_path: &str, message: String) -> FixtureFailure {
    FixtureFailure {
        output_path: output_path.to_string(),
        error_code: "EXTERNAL_WORKER_ERROR".to_string(),
        message: bounded_failure_message(&message),
        external_side_effect_unknown: true,
        termination_mode: "tree_force".to_string(),
        stdout_bytes: 0,
        stderr_bytes: 0,
        output_evidence: Vec::new(),
    }
}

pub(super) async fn execute_ffmpeg_fixture_for_attempt(
    workspace_root: PathBuf,
    fixture_directory: PathBuf,
    fixture_name: String,
    relative_output: String,
    ffmpeg_path: PathBuf,
    ffprobe_path: PathBuf,
    cancellation: Arc<AtomicBool>,
) -> Result<LocalMediaFixtureReport, FixtureFailure> {
    let working_directory = fixture_directory
        .strip_prefix(&workspace_root)
        .map_err(|_| {
            failure_from_process_error(
                &relative_output,
                "Fixture working directory vượt project workspace".to_string(),
            )
        })?
        .to_string_lossy()
        .replace('\\', "/");
    let ffmpeg_spec = ProcessSpec {
        executable_id: "ffmpeg".to_string(),
        args: vec![
            "-hide_banner".to_string(),
            "-loglevel".to_string(),
            "error".to_string(),
            "-f".to_string(),
            "lavfi".to_string(),
            "-i".to_string(),
            "color=c=black:s=320x180:r=30".to_string(),
            "-f".to_string(),
            "lavfi".to_string(),
            "-i".to_string(),
            "anullsrc=channel_layout=stereo:sample_rate=48000".to_string(),
            "-t".to_string(),
            "1".to_string(),
            "-c:v".to_string(),
            "libx264".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
            "-c:a".to_string(),
            "aac".to_string(),
            "-shortest".to_string(),
            "-y".to_string(),
            fixture_name.clone(),
        ],
        working_directory: working_directory.clone(),
        environment: Default::default(),
        timeout_seconds: 60,
        expected_outputs: vec![relative_output.clone()],
    };
    let ffmpeg = run_external_process(ExternalProcessRequest {
        spec: ffmpeg_spec,
        executable_path: ffmpeg_path,
        absolute_working_directory: fixture_directory.clone(),
        output_root: workspace_root.clone(),
        cancellation: cancellation.clone(),
    })
    .await
    .map_err(|error| failure_from_process_error(&relative_output, error))?;
    if !ffmpeg.succeeded {
        return Err(FixtureFailure {
            output_path: relative_output.clone(),
            error_code: if ffmpeg.timed_out {
                "FFMPEG_TIMEOUT".to_string()
            } else if ffmpeg.cancelled {
                "FFMPEG_CANCELLED".to_string()
            } else {
                "FFMPEG_FAILED".to_string()
            },
            message: "FFmpeg fixture process không tạo output hợp lệ".to_string(),
            external_side_effect_unknown: ffmpeg.external_side_effect_unknown,
            termination_mode: ffmpeg.termination_mode.clone(),
            stdout_bytes: ffmpeg.stdout_bytes as i64,
            stderr_bytes: ffmpeg.stderr_bytes as i64,
            output_evidence: ffmpeg.output_evidence.clone(),
        });
    }

    let ffprobe_spec = ProcessSpec {
        executable_id: "ffprobe".to_string(),
        args: vec![
            "-v".to_string(),
            "error".to_string(),
            "-print_format".to_string(),
            "json".to_string(),
            "-show_streams".to_string(),
            "-show_format".to_string(),
            fixture_name,
        ],
        working_directory,
        environment: Default::default(),
        timeout_seconds: 60,
        expected_outputs: Vec::new(),
    };
    let ffprobe = run_external_process(ExternalProcessRequest {
        spec: ffprobe_spec,
        executable_path: ffprobe_path,
        absolute_working_directory: fixture_directory,
        output_root: workspace_root.clone(),
        cancellation,
    })
    .await
    .map_err(|error| failure_from_process_error(&relative_output, error))?;
    if !ffprobe.succeeded {
        return Err(FixtureFailure {
            output_path: relative_output.clone(),
            error_code: if ffprobe.timed_out {
                "FFPROBE_TIMEOUT".to_string()
            } else if ffprobe.cancelled {
                "FFPROBE_CANCELLED".to_string()
            } else {
                "FFPROBE_FAILED".to_string()
            },
            message: "FFprobe fixture không đọc được output".to_string(),
            external_side_effect_unknown: ffprobe.external_side_effect_unknown,
            termination_mode: ffprobe.termination_mode.clone(),
            stdout_bytes: (ffmpeg.stdout_bytes + ffprobe.stdout_bytes) as i64,
            stderr_bytes: (ffmpeg.stderr_bytes + ffprobe.stderr_bytes) as i64,
            output_evidence: ffmpeg.output_evidence.clone(),
        });
    }
    let metadata: Value =
        serde_json::from_str(&ffprobe.stdout).map_err(|error| FixtureFailure {
            output_path: relative_output.clone(),
            error_code: "FFPROBE_INVALID_JSON".to_string(),
            message: bounded_failure_message(&format!("FFprobe trả JSON không hợp lệ: {error}")),
            external_side_effect_unknown: false,
            termination_mode: "none".to_string(),
            stdout_bytes: (ffmpeg.stdout_bytes + ffprobe.stdout_bytes) as i64,
            stderr_bytes: (ffmpeg.stderr_bytes + ffprobe.stderr_bytes) as i64,
            output_evidence: ffmpeg.output_evidence.clone(),
        })?;
    let streams = metadata
        .get("streams")
        .and_then(Value::as_array)
        .ok_or_else(|| FixtureFailure {
            output_path: relative_output.clone(),
            error_code: "FFPROBE_MISSING_STREAMS".to_string(),
            message: "FFprobe thiếu streams".to_string(),
            external_side_effect_unknown: false,
            termination_mode: "none".to_string(),
            stdout_bytes: (ffmpeg.stdout_bytes + ffprobe.stdout_bytes) as i64,
            stderr_bytes: (ffmpeg.stderr_bytes + ffprobe.stderr_bytes) as i64,
            output_evidence: ffmpeg.output_evidence.clone(),
        })?;
    let duration_seconds = metadata
        .get("format")
        .and_then(|format| format.get("duration"))
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<f64>().ok())
        .ok_or_else(|| FixtureFailure {
            output_path: relative_output.clone(),
            error_code: "FFPROBE_MISSING_DURATION".to_string(),
            message: "FFprobe thiếu duration hợp lệ".to_string(),
            external_side_effect_unknown: false,
            termination_mode: "none".to_string(),
            stdout_bytes: (ffmpeg.stdout_bytes + ffprobe.stdout_bytes) as i64,
            stderr_bytes: (ffmpeg.stderr_bytes + ffprobe.stderr_bytes) as i64,
            output_evidence: ffmpeg.output_evidence.clone(),
        })?;
    let output_path = workspace_root.join(&relative_output);
    let size_bytes = fs::metadata(&output_path)
        .map_err(|error| FixtureFailure {
            output_path: relative_output.clone(),
            error_code: "OUTPUT_MISSING".to_string(),
            message: bounded_failure_message(&format!("Không đọc được fixture output: {error}")),
            external_side_effect_unknown: false,
            termination_mode: "none".to_string(),
            stdout_bytes: (ffmpeg.stdout_bytes + ffprobe.stdout_bytes) as i64,
            stderr_bytes: (ffmpeg.stderr_bytes + ffprobe.stderr_bytes) as i64,
            output_evidence: ffmpeg.output_evidence.clone(),
        })?
        .len();
    if streams.len() < 2 || duration_seconds <= 0.0 || size_bytes == 0 {
        return Err(FixtureFailure {
            output_path: relative_output.clone(),
            error_code: "OUTPUT_INVALID".to_string(),
            message: "Fixture output không đạt stream/duration/size check".to_string(),
            external_side_effect_unknown: false,
            termination_mode: "none".to_string(),
            stdout_bytes: (ffmpeg.stdout_bytes + ffprobe.stdout_bytes) as i64,
            stderr_bytes: (ffmpeg.stderr_bytes + ffprobe.stderr_bytes) as i64,
            output_evidence: ffmpeg.output_evidence.clone(),
        });
    }
    Ok(LocalMediaFixtureReport {
        output_path: relative_output,
        size_bytes,
        duration_seconds,
        stream_count: streams.len(),
        ffmpeg,
        ffprobe,
    })
}

fn persist_output_evidence(
    transaction: &rusqlite::Transaction<'_>,
    attempt_id: &str,
    evidence: &[OutputEvidence],
    default_state: &str,
    default_message: &str,
) -> Result<(), String> {
    let outputs: Vec<String> = transaction
        .prepare("SELECT relative_path FROM job_outputs WHERE attempt_id = ?1")
        .map_err(|error| error.to_string())?
        .query_map(params![attempt_id], |row| row.get(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    for relative_path in outputs {
        let found = evidence
            .iter()
            .find(|item| item.relative_path == relative_path);
        let (validation_state, validation_message) = found
            .map(|item| {
                (
                    item.validation_state.as_str(),
                    item.validation_message
                        .as_deref()
                        .unwrap_or(default_message),
                )
            })
            .unwrap_or((default_state, default_message));
        transaction
            .execute(
                "UPDATE job_outputs SET validation_state=?1, validation_message=?2 WHERE attempt_id=?3 AND relative_path=?4",
                params![validation_state, validation_message, attempt_id, relative_path],
            )
            .map_err(|error| format!("Không ghi được output evidence: {error}"))?;
    }
    Ok(())
}

pub(super) fn persist_external_fixture_success(
    state: &AppState,
    attempt_id: &str,
    report: &LocalMediaFixtureReport,
) -> Result<ExternalFixtureAttemptReport, String> {
    let mut connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Không mở được success transaction: {error}"))?;
    let (job_id, project_id): (String, String) = transaction
        .query_row(
            "SELECT a.job_id, j.project_id FROM job_attempts a JOIN jobs j ON j.job_id = a.job_id WHERE a.attempt_id = ?1",
            params![attempt_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| format!("Không đọc được success attempt: {error}"))?;
    let timestamp = now_string();
    let stdout_bytes = (report.ffmpeg.stdout_bytes + report.ffprobe.stdout_bytes) as i64;
    let stderr_bytes = (report.ffmpeg.stderr_bytes + report.ffprobe.stderr_bytes) as i64;
    let changed = transaction
        .execute(
            "UPDATE job_attempts SET state='succeeded', finished_at=?1, lease_owner=NULL, lease_expires_at=NULL, heartbeat_at=?1, process_started=1, external_side_effect_unknown=0, retryable=0, error_code=NULL, redacted_message=NULL, stdout_bytes=?2, stderr_bytes=?3, termination_mode='none', updated_at=?1 WHERE attempt_id=?4 AND state IN ('running', 'cancel_requested')",
            params![timestamp, stdout_bytes, stderr_bytes, attempt_id],
        )
        .map_err(|error| format!("Không hoàn tất external attempt: {error}"))?;
    if changed != 1 {
        return Err("External attempt không còn ở running khi persist success".to_string());
    }
    persist_output_evidence(
        &transaction,
        attempt_id,
        &report.ffmpeg.output_evidence,
        "missing",
        "FFmpeg fixture không có output evidence",
    )?;
    transaction
        .execute(
            "UPDATE jobs SET state='succeeded', progress=1.0, finished_at=?1, error_code=NULL, error_message=NULL WHERE job_id=?2 AND state IN ('running', 'cancel_requested')",
            params![timestamp, job_id],
        )
        .map_err(|error| format!("Không hoàn tất external job: {error}"))?;
    audit_event(
        &transaction,
        Some(&project_id),
        "attempt.external_succeeded",
        "attempt",
        attempt_id,
    )?;
    audit_event(
        &transaction,
        Some(&project_id),
        "job.external_succeeded",
        "job",
        &job_id,
    )?;
    transaction
        .commit()
        .map_err(|error| format!("Không commit được external success: {error}"))?;
    Ok(ExternalFixtureAttemptReport {
        job: fetch_job(&connection, &job_id)?,
        attempt: fetch_attempt(&connection, attempt_id)?,
        output_path: report.output_path.clone(),
    })
}

pub(super) fn persist_external_fixture_failure(
    state: &AppState,
    attempt_id: &str,
    failure: FixtureFailure,
) -> Result<AttemptView, String> {
    let mut connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Không mở được failure transaction: {error}"))?;
    let (job_id, project_id): (String, String) = transaction
        .query_row(
            "SELECT a.job_id, j.project_id FROM job_attempts a JOIN jobs j ON j.job_id = a.job_id WHERE a.attempt_id = ?1",
            params![attempt_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| format!("Không đọc được failure attempt: {error}"))?;
    let timestamp = now_string();
    let state_name = if failure.external_side_effect_unknown {
        "reconciliation_required"
    } else {
        "failed"
    };
    let retryable = failure.external_side_effect_unknown || failure.error_code.ends_with("TIMEOUT");
    transaction
        .execute(
            "UPDATE job_attempts SET state=?1, finished_at=?2, lease_owner=NULL, lease_expires_at=NULL, heartbeat_at=?2, external_side_effect_unknown=?3, retryable=?4, error_code=?5, redacted_message=?6, stdout_bytes=?7, stderr_bytes=?8, termination_mode=?9, updated_at=?2 WHERE attempt_id=?10 AND state IN ('running', 'cancel_requested')",
            params![state_name, timestamp, failure.external_side_effect_unknown as i64, retryable as i64, failure.error_code, bounded_failure_message(&failure.message), failure.stdout_bytes, failure.stderr_bytes, failure.termination_mode, attempt_id],
        )
        .map_err(|error| format!("Không persist được external failure: {error}"))?;
    persist_output_evidence(
        &transaction,
        attempt_id,
        &failure.output_evidence,
        "missing",
        "External worker không tạo output evidence",
    )?;
    let job_error = bounded_failure_message(&format!(
        "{} (output: {})",
        failure.message, failure.output_path
    ));
    transaction
        .execute(
            "UPDATE jobs SET state=?1, finished_at=?2, error_code=?3, error_message=?4 WHERE job_id=?5 AND state IN ('running', 'cancel_requested')",
            params![state_name, timestamp, failure.error_code, job_error, job_id],
        )
        .map_err(|error| format!("Không persist được external job failure: {error}"))?;
    audit_event(
        &transaction,
        Some(&project_id),
        if failure.external_side_effect_unknown {
            "attempt.reconciliation_required"
        } else {
            "attempt.external_failed"
        },
        "attempt",
        attempt_id,
    )?;
    transaction
        .commit()
        .map_err(|error| format!("Không commit được external failure: {error}"))?;
    fetch_attempt(&connection, attempt_id)
}

fn spawn_external_fixture_worker(
    app: AppHandle,
    attempt_id: String,
    cancellation: Arc<AtomicBool>,
    workspace_root: PathBuf,
    fixture_directory: PathBuf,
    fixture_name: String,
    relative_output: String,
    ffmpeg_path: PathBuf,
    ffprobe_path: PathBuf,
) {
    tauri::async_runtime::spawn(async move {
        let result = execute_ffmpeg_fixture_for_attempt(
            workspace_root,
            fixture_directory,
            fixture_name,
            relative_output,
            ffmpeg_path,
            ffprobe_path,
            cancellation,
        )
        .await;
        if let Some(state) = app.try_state::<AppState>() {
            match result {
                Ok(report) => {
                    let _ = persist_external_fixture_success(&state, &attempt_id, &report);
                }
                Err(failure) => {
                    let _ = persist_external_fixture_failure(&state, &attempt_id, failure);
                }
            }
            if let Ok(mut cancellations) = state.cancellation_tokens.lock() {
                cancellations.remove(&attempt_id);
            }
        }
    });
}

#[tauri::command]
pub(super) async fn run_ffmpeg_fixture_attempt(
    project_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ExternalFixtureAttemptReport, String> {
    valid_text(&project_id, "Project ID")?;
    let (workspace_root, ffmpeg_path, ffprobe_path) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        let workspace_root: String = connection
            .query_row(
                "SELECT workspace_root FROM projects WHERE project_id = ?1",
                params![project_id.trim()],
                |row| row.get(0),
            )
            .map_err(|error| format!("Không đọc được project workspace: {error}"))?;
        let ffmpeg_path = resolve_configured_tool(&connection, "ffmpeg")?;
        let ffprobe_path = resolve_configured_tool(&connection, "ffprobe")?;
        (PathBuf::from(workspace_root), ffmpeg_path, ffprobe_path)
    };
    let workspace_root = fs::canonicalize(&workspace_root)
        .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?;
    let job_id = now_id("job");
    let attempt_id = now_id("attempt");
    let fixture_directory = workspace_root
        .join(".auto3dvideo")
        .join("fixtures")
        .join("attempts")
        .join(&attempt_id);
    fs::create_dir_all(&fixture_directory)
        .map_err(|error| format!("Không tạo được external fixture directory: {error}"))?;
    let fixture_name = "synthetic-1s.mp4".to_string();
    let relative_output = fixture_directory
        .join(&fixture_name)
        .strip_prefix(&workspace_root)
        .map_err(|_| "External fixture output vượt project workspace".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let timestamp = now_string();
    {
        let mut connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Không mở được external fixture transaction: {error}"))?;
        let project_exists: i64 = transaction
            .query_row(
                "SELECT COUNT(*) FROM projects WHERE project_id = ?1",
                params![project_id.trim()],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if project_exists == 0 {
            return Err("Project không tồn tại".to_string());
        }
        transaction
            .execute(
                "INSERT INTO jobs(job_id, project_id, kind, state, progress, attempt_count, created_at) VALUES (?1, ?2, 'ffmpeg_fixture', 'queued', 0.0, 1, ?3)",
                params![job_id, project_id.trim(), timestamp],
            )
            .map_err(|error| format!("Không tạo được external fixture job: {error}"))?;
        transaction
            .execute(
                "INSERT INTO job_attempts(attempt_id, job_id, attempt_number, state, executable_id, execution_mode, timeout_seconds, max_log_bytes, process_started, external_side_effect_unknown, retryable, created_at, updated_at) VALUES (?1, ?2, 1, 'pending', 'ffmpeg', 'external_process', 120, 1048576, 0, 0, 0, ?3, ?3)",
                params![attempt_id, job_id, timestamp],
            )
            .map_err(|error| format!("Không tạo được external fixture attempt: {error}"))?;
        transaction
            .execute(
                "INSERT INTO job_outputs(output_id, attempt_id, relative_path, media_kind, validation_state, created_at) VALUES (?1, ?2, ?3, 'video', 'pending', ?4)",
                params![now_id("output"), attempt_id, relative_output, timestamp],
            )
            .map_err(|error| format!("Không tạo được external fixture output: {error}"))?;
        audit_event(
            &transaction,
            Some(project_id.trim()),
            "job.external_fixture_created",
            "job",
            &job_id,
        )?;
        transaction
            .commit()
            .map_err(|error| format!("Không commit được external fixture job: {error}"))?;
    }
    let (attempt, cancellation) = claim_external_attempt(&state, &attempt_id, "ffmpeg")?;
    let job = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        fetch_job(&connection, &job_id)?
    };
    spawn_external_fixture_worker(
        app,
        attempt_id,
        cancellation,
        workspace_root,
        fixture_directory,
        fixture_name,
        relative_output.clone(),
        ffmpeg_path,
        ffprobe_path,
    );
    Ok(ExternalFixtureAttemptReport {
        job,
        attempt,
        output_path: relative_output,
    })
}

#[tauri::command]
pub(super) async fn test_commandcode_chat(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CommandCodeProbeReport, String> {
    let (python_path, probe_root) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        let python_path = resolve_configured_tool(&connection, "python")?;
        let probe_root = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Không xác định được app data directory: {error}"))?;
        (python_path, probe_root)
    };
    let probe_root = fs::canonicalize(&probe_root).unwrap_or(probe_root);
    fs::create_dir_all(&probe_root)
        .map_err(|error| format!("Không tạo được Command Code probe workspace: {error}"))?;
    let script_relative = ensure_commandcode_worker_script(&probe_root)?;
    let request_id = now_id("commandcode");
    let request_relative = format!(".auto3dvideo/requests/{request_id}.json");
    let request_path = probe_root.join(&request_relative);
    if let Some(parent) = request_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Không tạo được Command Code request directory: {error}"))?;
    }
    let request = serde_json::json!({
        "model": "ag/gemini-3.8-flash-medium",
        "messages": [{
            "role": "user",
            "content": "Trả lời đúng một câu ngắn bằng tiếng Việt: Auto3Dvideo đã kết nối Command Code thành công."
        }],
        "maxTokens": 32,
        "zeroDataRetention": true,
    });
    let request_bytes = serde_json::to_vec(&request)
        .map_err(|error| format!("Không serialize được Command Code request: {error}"))?;
    if request_bytes.len() > 256 * 1024 {
        return Err("Command Code request vượt quá giới hạn kích thước".to_string());
    }
    fs::write(&request_path, request_bytes)
        .map_err(|error| format!("Không ghi được Command Code request: {error}"))?;
    let process_result = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "python".to_string(),
            args: vec![script_relative, "--request".to_string(), request_relative],
            working_directory: ".".to_string(),
            environment: commandcode_worker_environment()?,
            timeout_seconds: 90,
            expected_outputs: Vec::new(),
        },
        executable_path: python_path,
        absolute_working_directory: probe_root.clone(),
        output_root: probe_root,
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await;
    let _ = fs::remove_file(&request_path);
    let process = process_result?;
    let payload = parse_vieneu_worker_output(&process);
    let succeeded = payload
        .as_ref()
        .map(|value| worker_string(value, "status", "") == "succeeded")
        .unwrap_or(false)
        && process.succeeded;
    let status = payload
        .as_ref()
        .map(|value| worker_string(value, "status", "worker_failed"))
        .unwrap_or_else(|| "worker_failed".to_string());
    let message = payload
        .as_ref()
        .map(|value| {
            worker_string(
                value,
                "message",
                "Command Code worker không trả JSON hợp lệ",
            )
        })
        .unwrap_or_else(|| {
            let stderr = process.stderr.trim();
            if stderr.is_empty() {
                format!(
                    "Worker không trả JSON hợp lệ; mã thoát: {}.",
                    process
                        .exit_code
                        .map(|code| code.to_string())
                        .unwrap_or_else(|| "không rõ".to_string())
                )
            } else {
                format!(
                    "Worker không trả JSON hợp lệ: {}",
                    stderr.chars().take(480).collect::<String>()
                )
            }
        });
    if let Ok(connection) = state.database.lock() {
        let _ = audit_event(
            &connection,
            None,
            if succeeded {
                "llm.commandcode_probe_succeeded"
            } else {
                "llm.commandcode_probe_failed"
            },
            "llm",
            &request_id,
        );
    }
    Ok(CommandCodeProbeReport {
        status,
        http_status: payload
            .as_ref()
            .and_then(|value| value.get("httpStatus"))
            .and_then(Value::as_u64)
            .and_then(|value| u16::try_from(value).ok()),
        model: payload
            .as_ref()
            .map(|value| worker_string(value, "model", "ag/gemini-3.8-flash-medium"))
            .unwrap_or_else(|| "ag/gemini-3.8-flash-medium".to_string()),
        response_text: payload
            .as_ref()
            .and_then(|value| value.get("responseText"))
            .and_then(Value::as_str)
            .map(|value| value.chars().take(16_000).collect()),
        prompt_tokens: payload
            .as_ref()
            .and_then(|value| value.get("promptTokens"))
            .and_then(Value::as_u64),
        completion_tokens: payload
            .as_ref()
            .and_then(|value| value.get("completionTokens"))
            .and_then(Value::as_u64),
        total_tokens: payload
            .as_ref()
            .and_then(|value| value.get("totalTokens"))
            .and_then(Value::as_u64),
        network_calls_made: payload
            .as_ref()
            .map(|value| worker_bool(value, "networkCallsMade"))
            .unwrap_or(false),
        cost_status: payload
            .as_ref()
            .map(|value| worker_string(value, "costStatus", "unknown"))
            .unwrap_or_else(|| "unknown".to_string()),
        process_started: true,
        external_side_effect_unknown: process.external_side_effect_unknown,
        message,
    })
}
