use super::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ToolReadinessView {
    tool_id: String,
    executable_ref: String,
    required: bool,
    configured: bool,
    available: bool,
    status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ToolReadinessReport {
    pub(super) status: String,
    required_missing: Vec<String>,
    tools: Vec<ToolReadinessView>,
    external_processes_started: bool,
    network_probe_performed: bool,
    allow_shell_wrapper: bool,
    reject_paths_outside_project: bool,
    worker_execution_enabled: bool,
    worker_gate: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkerPreflightReport {
    ready_to_start: bool,
    blockers: Vec<String>,
    checks: Vec<String>,
    external_processes_started: bool,
    network_probe_performed: bool,
    publish_enabled: bool,
    paid_generation_enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LocalToolProbeReport {
    tool_id: String,
    executable_path: String,
    status: String,
    exit_code: Option<i32>,
    version: String,
    stdout_bytes: usize,
    stderr_bytes: usize,
    process_started: bool,
    external_side_effect_unknown: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkerLaunchPlan {
    attempt_id: String,
    job_id: String,
    attempt_number: i64,
    state: String,
    executable_id: Option<String>,
    timeout_seconds: i64,
    expected_output_count: i64,
    can_start: bool,
    blockers: Vec<String>,
    process_started: bool,
    external_side_effect_unknown: bool,
}

const TOOL_DEFAULTS: [(&str, bool); 10] = [
    ("blender", false),
    ("ffmpeg", true),
    ("ffprobe", true),
    ("python", true),
    ("gflow", false),
    ("node", false),
    ("kdenlive", false),
    ("davinci_resolve", false),
    ("yt-dlp", false),
    ("obscura", false),
];

fn validate_tool_id(tool_id: &str) -> Result<(), String> {
    valid_text(tool_id, "Tool ID")?;
    if TOOL_DEFAULTS
        .iter()
        .any(|(allowed, _)| *allowed == tool_id.trim())
    {
        Ok(())
    } else {
        Err(format!(
            "Tool không nằm trong allowlist: {}",
            tool_id.trim()
        ))
    }
}

pub(super) fn validate_executable_ref(executable_ref: &str) -> Result<String, String> {
    valid_text(executable_ref, "Executable reference")?;
    // A Windows path copied from a terminal is often wrapped in quotes. The
    // process boundary receives a PathBuf, not a command line, so normalize
    // those outer quotes before resolving the executable.
    let mut trimmed = executable_ref.trim();
    loop {
        let unquoted = trimmed
            .strip_prefix('"')
            .and_then(|value| value.strip_suffix('"'))
            .or_else(|| {
                trimmed
                    .strip_prefix('\'')
                    .and_then(|value| value.strip_suffix('\''))
            });
        let Some(value) = unquoted else {
            break;
        };
        trimmed = value.trim();
    }
    if trimmed.is_empty() {
        return Err("Executable reference không được để trống sau khi bỏ dấu nháy".to_string());
    }
    if trimmed.len() > 1024
        || trimmed
            .chars()
            .any(|character| matches!(character, '\r' | '\n' | '\0'))
        || trimmed.contains('"')
        || ['&', '|', ';', '<', '>']
            .iter()
            .any(|character| trimmed.contains(*character))
    {
        return Err(
            "Executable reference chỉ được là path hoặc tên binary, không phải command string"
                .to_string(),
        );
    }
    let path = Path::new(trimmed);
    if !path.is_absolute() && path.components().count() != 1 {
        return Err("Executable reference tương đối chỉ được là tên binary trong PATH".to_string());
    }
    Ok(trimmed.to_string())
}

fn expected_binary_name(tool_id: &str) -> Option<&'static str> {
    match tool_id {
        "blender" => Some("blender.exe"),
        "ffmpeg" => Some("ffmpeg.exe"),
        "ffprobe" => Some("ffprobe.exe"),
        "python" => Some("python.exe"),
        "gflow" => Some("gflow.exe"),
        "yt-dlp" => Some("yt-dlp.exe"),
        "obscura" => Some("obscura.exe"),
        "kdenlive" => Some("kdenlive.exe"),
        "davinci_resolve" => Some("Resolve.exe"),
        _ => None,
    }
}

pub(super) fn executable_ref_available(tool_id: &str, executable_ref: &str) -> bool {
    let Ok(normalized) = validate_executable_ref(executable_ref) else {
        return false;
    };
    let path = Path::new(&normalized);
    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        match std::env::var_os("PATH") {
            Some(paths) => std::env::split_paths(&paths)
                .map(|directory| directory.join(&normalized))
                .find(|candidate| candidate.is_file())
                .unwrap_or_default(),
            None => return false,
        }
    };
    candidate.is_file()
        && expected_binary_name(tool_id).is_none_or(|expected| {
            candidate
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|actual| actual.eq_ignore_ascii_case(expected))
        })
}

pub(super) fn executable_ref_usable(tool_id: &str, executable_ref: &str) -> bool {
    if !executable_ref_available(tool_id, executable_ref) {
        return false;
    }
    if tool_id != "python" {
        return true;
    }

    // A Windows venv can leave a small launcher behind after its base Python
    // is removed. Inspect pyvenv.cfg so readiness does not report that broken
    // launcher as a usable interpreter and then fail with "No Python at ...".
    let path = Path::new(executable_ref);
    if !path.is_absolute() {
        return true;
    }
    let Some(venv_root) = path.parent().and_then(Path::parent) else {
        return true;
    };
    let config = venv_root.join("pyvenv.cfg");
    if !config.is_file() {
        return true;
    }
    let Ok(contents) = fs::read_to_string(config) else {
        return false;
    };
    let mut referenced_base = false;
    let mut base_exists = false;
    for line in contents.lines() {
        let Some((key, raw_value)) = line.split_once('=') else {
            continue;
        };
        if !matches!(
            key.trim().to_ascii_lowercase().as_str(),
            "home" | "executable"
        ) {
            continue;
        }
        referenced_base = true;
        let value = raw_value.trim().trim_matches(['"', '\'']);
        if !value.is_empty() {
            let candidate = Path::new(value);
            base_exists |= if key.trim().eq_ignore_ascii_case("home") {
                candidate.is_dir()
            } else {
                candidate.is_file()
            };
        }
    }
    !referenced_base || base_exists
}

fn app_managed_tool_default(tool_id: &str) -> Option<PathBuf> {
    if tool_id == "blender" {
        return [
            PathBuf::from(r"D:\Auto3DvideoTools\blender-5.2.1-windows-x64\blender.exe"),
            PathBuf::from(r"D:\Auto3DvideoTools\blender\blender.exe"),
        ]
        .into_iter()
        .find(|candidate| candidate.is_file());
    }
    if tool_id == "python" {
        return [
            PathBuf::from(r"D:\Auto3DvideoTools\omnivoice\.venv\Scripts\python.exe"),
            PathBuf::from(r"D:\Auto3DvideoTools\vieneu\.venv\Scripts\python.exe"),
            PathBuf::from(
                r"D:\Auto3DvideoTools\blender-5.2.1-windows-x64\5.2\python\bin\python.exe",
            ),
            PathBuf::from(r"C:\Users\GIGABYTE\AppData\Local\Programs\Python\Python312\python.exe"),
        ]
        .into_iter()
        .find(|candidate| executable_ref_usable("python", &candidate.to_string_lossy()));
    }
    if tool_id == "gflow" {
        return [
            PathBuf::from(
                r"C:\Users\GIGABYTE\AppData\Local\Programs\Python\Python312\Scripts\gflow.exe",
            ),
            PathBuf::from(
                r"C:\Users\GIGABYTE\AppData\Local\Programs\Python\Python311\Scripts\gflow.exe",
            ),
            PathBuf::from(r"C:\Users\GIGABYTE\.local\bin\gflow.exe"),
        ]
        .into_iter()
        .find(|candidate| candidate.is_file());
    }
    if tool_id == "node" {
        return [
            PathBuf::from(r"C:\Program Files\nodejs\node.exe"),
            PathBuf::from(r"C:\Program Files (x86)\nodejs\node.exe"),
        ]
        .into_iter()
        .find(|candidate| candidate.is_file());
    }
    if tool_id == "obscura" {
        return [
            PathBuf::from(r"D:\Auto3DvideoTools\obscura-source\target\release\obscura.exe"),
            PathBuf::from(r"D:\Auto3DvideoTools\obscura\obscura.exe"),
            PathBuf::from(r"D:\Auto3DvideoTools\obscura-source\target\debug\obscura.exe"),
        ]
        .into_iter()
        .find(|candidate| candidate.is_file());
    }
    if tool_id == "yt-dlp" {
        return [
            PathBuf::from(r"D:\Auto3DvideoTools\media2md-source\.venv\Scripts\yt-dlp.exe"),
            PathBuf::from(r"D:\Auto3DvideoTools\yt-dlp\yt-dlp.exe"),
        ]
        .into_iter()
        .find(|candidate| candidate.is_file());
    }
    None
}

pub(super) fn preferred_tool_reference(
    tool_id: &str,
    stored_reference: Option<String>,
) -> Option<String> {
    let configured =
        stored_reference.and_then(|reference| validate_executable_ref(&reference).ok());
    if let Some(reference) = configured.as_ref() {
        if executable_ref_usable(tool_id, reference) {
            return configured;
        }
    }

    let managed_default =
        app_managed_tool_default(tool_id).map(|path| path.to_string_lossy().to_string());
    if let Some(reference) = managed_default.as_ref() {
        if executable_ref_usable(tool_id, reference) {
            return managed_default;
        }
    }

    configured.or(managed_default)
}

pub(super) fn resolve_configured_tool(
    connection: &Connection,
    tool_id: &str,
) -> Result<PathBuf, String> {
    validate_tool_id(tool_id)?;
    let stored_reference: Option<String> = connection
        .query_row(
            "SELECT executable_ref FROM tool_configs WHERE tool_id = ?1",
            params![tool_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Không đọc được tool config {tool_id}: {error}"))?;
    let reference = preferred_tool_reference(tool_id, stored_reference)
        .ok_or_else(|| format!("Chưa cấu hình tool {tool_id}"))?;
    let candidate = Path::new(&reference);
    let resolved = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        std::env::var_os("PATH")
            .into_iter()
            .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
            .map(|directory| directory.join(&reference))
            .find(|path| path.is_file())
            .ok_or_else(|| format!("Không resolve được tool {tool_id} trong PATH"))?
    };
    if !resolved.is_file() {
        return Err(format!("Tool {tool_id} không tồn tại: {reference}"));
    }
    let canonical = fs::canonicalize(&resolved)
        .map_err(|error| format!("Không canonicalize được tool {tool_id}: {error}"))?;
    if expected_binary_name(tool_id).is_some_and(|expected| {
        canonical
            .file_name()
            .and_then(|name| name.to_str())
            .map(|actual| !actual.eq_ignore_ascii_case(expected))
            .unwrap_or(true)
    }) {
        return Err(format!(
            "Tool {tool_id} không khớp binary allowlist: cần {}",
            expected_binary_name(tool_id).unwrap_or("binary hợp lệ")
        ));
    }
    Ok(canonical)
}

pub(super) fn tool_readiness_report(
    connection: &Connection,
) -> Result<ToolReadinessReport, String> {
    let mut tools = Vec::with_capacity(TOOL_DEFAULTS.len());
    let mut required_missing = Vec::new();
    for (tool_id, default_required) in TOOL_DEFAULTS {
        let stored: Option<(String, i64)> = connection
            .query_row(
                "SELECT executable_ref, required FROM tool_configs WHERE tool_id = ?1",
                params![tool_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let executable_ref = preferred_tool_reference(
            tool_id,
            stored.as_ref().map(|(reference, _)| reference.clone()),
        )
        .unwrap_or_default();
        let required = stored
            .as_ref()
            .map(|(_, required)| *required != 0)
            .unwrap_or(default_required);
        let configured = !executable_ref.trim().is_empty();
        let available = configured && executable_ref_available(tool_id, &executable_ref);
        let status = if available {
            "ready"
        } else if required {
            required_missing.push(tool_id.to_string());
            "missing_required"
        } else {
            "optional_missing"
        };
        tools.push(ToolReadinessView {
            tool_id: tool_id.to_string(),
            executable_ref,
            required,
            configured,
            available,
            status: status.to_string(),
        });
    }
    Ok(ToolReadinessReport {
        status: if required_missing.is_empty() {
            "ready".to_string()
        } else {
            "blocked".to_string()
        },
        required_missing,
        tools,
        external_processes_started: false,
        network_probe_performed: false,
        allow_shell_wrapper: false,
        reject_paths_outside_project: true,
        worker_execution_enabled: false,
        worker_gate: "native_build_and_supervision_required".to_string(),
    })
}

pub(super) fn local_tool_probe_args(tool_id: &str) -> Result<Vec<String>, String> {
    match tool_id {
        "ffmpeg" | "ffprobe" | "blender" | "python" | "yt-dlp" | "obscura" => {
            Ok(vec!["--version".to_string()])
        }
        _ => Err(format!("Tool {tool_id} chưa có probe adapter an toàn")),
    }
}

#[tauri::command]
pub(super) async fn probe_local_tool(
    project_id: String,
    tool_id: String,
    state: State<'_, AppState>,
) -> Result<LocalToolProbeReport, String> {
    valid_text(&project_id, "Project ID")?;
    validate_tool_id(&tool_id)?;
    let (workspace_root, executable_path) = {
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
        let executable_path = resolve_configured_tool(&connection, tool_id.trim())?;
        (PathBuf::from(workspace_root), executable_path)
    };
    let workspace_root = fs::canonicalize(&workspace_root)
        .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?;
    let spec = ProcessSpec {
        executable_id: tool_id.trim().to_string(),
        args: local_tool_probe_args(tool_id.trim())?,
        working_directory: ".".to_string(),
        environment: Default::default(),
        timeout_seconds: 20,
        expected_outputs: Vec::new(),
    };
    let result = run_external_process(ExternalProcessRequest {
        spec,
        executable_path: executable_path.clone(),
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root,
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    let version = bounded_failure_message(&format!("{}{}", result.stdout, result.stderr));
    Ok(LocalToolProbeReport {
        tool_id: tool_id.trim().to_string(),
        executable_path: executable_path.to_string_lossy().to_string(),
        status: if result.succeeded {
            "ready".to_string()
        } else if result.timed_out {
            "timeout".to_string()
        } else {
            "failed".to_string()
        },
        exit_code: result.exit_code,
        version,
        stdout_bytes: result.stdout_bytes,
        stderr_bytes: result.stderr_bytes,
        process_started: true,
        external_side_effect_unknown: result.external_side_effect_unknown,
    })
}

#[tauri::command]
pub(super) fn list_tool_readiness(
    state: State<'_, AppState>,
) -> Result<ToolReadinessReport, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    tool_readiness_report(&connection)
}

#[tauri::command]
pub(super) fn preview_worker_launch(
    attempt_id: String,
    state: State<'_, AppState>,
) -> Result<WorkerLaunchPlan, String> {
    valid_text(&attempt_id, "Attempt ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let (job_id, attempt_number, state_name, executable_id, timeout_seconds, process_started, side_effect_unknown): (String, i64, String, Option<String>, i64, i64, i64) = connection
        .query_row(
            "SELECT job_id, attempt_number, state, executable_id, timeout_seconds, process_started, external_side_effect_unknown FROM job_attempts WHERE attempt_id = ?1",
            params![attempt_id.trim()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?)),
        )
        .map_err(|error| format!("Không đọc được attempt: {error}"))?;
    let expected_output_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM job_outputs WHERE attempt_id = ?1",
            params![attempt_id.trim()],
            |row| row.get(0),
        )
        .map_err(|error| format!("Không đọc được expected outputs: {error}"))?;
    let readiness = tool_readiness_report(&connection)?;
    let mut blockers = Vec::new();
    if state_name != "pending" {
        blockers.push(format!("Attempt không ở trạng thái pending: {state_name}"));
    }
    match executable_id.as_deref() {
        Some(tool_id) => {
            if let Some(tool) = readiness.tools.iter().find(|tool| tool.tool_id == tool_id) {
                if !tool.available {
                    blockers.push(format!("Tool chưa available: {tool_id}"));
                }
            } else {
                blockers.push(format!("Tool không nằm trong readiness catalog: {tool_id}"));
            }
        }
        None => blockers.push("Attempt chưa có executable reference".to_string()),
    }
    blockers.push(
        "External worker gate đang khóa cho tới khi fixture và output-reconciliation verification pass"
            .to_string(),
    );
    Ok(WorkerLaunchPlan {
        attempt_id: attempt_id.trim().to_string(),
        job_id,
        attempt_number,
        state: state_name,
        executable_id,
        timeout_seconds,
        expected_output_count,
        can_start: false,
        blockers,
        process_started: process_started != 0,
        external_side_effect_unknown: side_effect_unknown != 0,
    })
}

#[tauri::command]
pub(super) fn worker_preflight(
    state: State<'_, AppState>,
) -> Result<WorkerPreflightReport, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let readiness = tool_readiness_report(&connection)?;
    let mut blockers = readiness
        .required_missing
        .iter()
        .map(|tool| format!("Thiếu required tool: {tool}"))
        .collect::<Vec<_>>();
    blockers.push(
        "External worker gate chưa mở: cần fixture và output-reconciliation verification"
            .to_string(),
    );
    Ok(WorkerPreflightReport {
        ready_to_start: false,
        blockers,
        checks: vec![
            "Executable references được kiểm tra theo allowlist và file/PATH metadata".to_string(),
            "Không spawn external process trong preflight".to_string(),
            "Không probe network và không gọi provider".to_string(),
            "Preflight không chạy worker, không gọi provider và không publish; mỗi yêu cầu generation vẫn đọc Cloud/API gate đã lưu.".to_string(),
        ],
        external_processes_started: false,
        network_probe_performed: false,
        publish_enabled: false,
        paid_generation_enabled: read_cloud_generation_enabled(&connection)?,
    })
}

#[tauri::command]
pub(super) fn save_tool_config(
    tool_id: String,
    executable_ref: String,
    required: bool,
    state: State<'_, AppState>,
) -> Result<ToolReadinessView, String> {
    validate_tool_id(&tool_id)?;
    let executable_ref = validate_executable_ref(&executable_ref)?;
    let timestamp = now_string();
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    connection
        .execute(
            "INSERT INTO tool_configs(tool_id, executable_ref, required, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4) ON CONFLICT(tool_id) DO UPDATE SET executable_ref = excluded.executable_ref, required = excluded.required, updated_at = excluded.updated_at",
            params![tool_id.trim(), executable_ref, required as i64, timestamp],
        )
        .map_err(|error| error.to_string())?;
    audit_event(
        &connection,
        None,
        "tool_config.updated",
        "tool",
        tool_id.trim(),
    )?;
    tool_readiness_report(&connection)?
        .tools
        .into_iter()
        .find(|tool| tool.tool_id == tool_id.trim())
        .ok_or_else(|| "Không đọc được tool config vừa lưu".to_string())
}
