use super::{
    audit_event, fetch_attempt, fetch_job, now_id, now_string, plan_process_dry_run,
    prepare_workspace_root, preview_recipe, request_attempt_cancel, transition_job_locked,
    valid_text, validate_attempt_media_kind, validate_attempt_output_path, AppState,
    AttemptOutputView, AttemptView, AuditEventView, JobView, PendingOutputSpec, ProcessDryRunPlan,
    ProcessSpec, ProjectView,
};
use rusqlite::params;
use tauri::State;

#[tauri::command]
pub(super) fn list_projects(state: State<'_, AppState>) -> Result<Vec<ProjectView>, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let mut statement = connection
        .prepare("SELECT project_id, name, locale, workspace_root, policy_profile, updated_at FROM projects ORDER BY updated_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(ProjectView {
                project_id: row.get(0)?,
                name: row.get(1)?,
                locale: row.get(2)?,
                workspace_root: row.get(3)?,
                policy_profile: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn create_project(
    name: String,
    workspace_root: String,
    state: State<'_, AppState>,
) -> Result<ProjectView, String> {
    valid_text(&name, "Tên project")?;
    let workspace_root = prepare_workspace_root(&workspace_root)?;
    let project_id = now_id("project");
    let timestamp = now_string();
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    connection
        .execute(
            "INSERT INTO projects(project_id, name, locale, workspace_root, policy_profile, created_at, updated_at) VALUES (?1, ?2, 'vi-VN', ?3, 'safe-local', ?4, ?4)",
            params![project_id, name.trim(), workspace_root, timestamp],
        )
        .map_err(|error| error.to_string())?;

    Ok(ProjectView {
        project_id,
        name: name.trim().to_string(),
        locale: "vi-VN".to_string(),
        workspace_root,
        policy_profile: "safe-local".to_string(),
        updated_at: timestamp,
    })
}

#[tauri::command]
pub(super) fn delete_project(project_id: String, state: State<'_, AppState>) -> Result<(), String> {
    valid_text(&project_id, "Project ID")?;
    if project_id.trim() == "project-default" {
        return Err("Không thể xoá project mặc định của ứng dụng".to_string());
    }
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let deleted = connection
        .execute(
            "DELETE FROM projects WHERE project_id = ?1",
            params![project_id.trim()],
        )
        .map_err(|error| error.to_string())?;
    if deleted == 0 {
        return Err("Project không tồn tại hoặc đã được xoá".to_string());
    }
    audit_event(
        &connection,
        None,
        "project.deleted",
        "project",
        project_id.trim(),
    )?;
    Ok(())
}

#[tauri::command]
pub(super) fn list_jobs(state: State<'_, AppState>) -> Result<Vec<JobView>, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let mut statement = connection
        .prepare("SELECT job_id, project_id, kind, state, progress, attempt_count, created_at FROM jobs ORDER BY created_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(JobView {
                job_id: row.get(0)?,
                project_id: row.get(1)?,
                kind: row.get(2)?,
                state: row.get(3)?,
                progress: row.get(4)?,
                attempt_count: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn enqueue_mock_job(
    project_id: String,
    recipe_kind: String,
    state: State<'_, AppState>,
) -> Result<JobView, String> {
    valid_text(&project_id, "Project ID")?;
    valid_text(&recipe_kind, "Recipe")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let exists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE project_id = ?1",
            params![project_id.trim()],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if exists == 0 {
        return Err("Project không tồn tại".to_string());
    }

    let job_id = now_id("job");
    let timestamp = now_string();
    connection
        .execute(
            "INSERT INTO jobs(job_id, project_id, kind, state, progress, attempt_count, created_at) VALUES (?1, ?2, ?3, 'queued', 0.0, 0, ?4)",
            params![job_id, project_id.trim(), recipe_kind.trim(), timestamp],
        )
        .map_err(|error| error.to_string())?;
    audit_event(
        &connection,
        Some(project_id.trim()),
        "job.created",
        "job",
        &job_id,
    )?;
    let _running = transition_job_locked(&connection, &job_id, "running", None)?;
    let succeeded_job = transition_job_locked(&connection, &job_id, "succeeded", None)?;
    let attempt_id = now_id("attempt");
    let timestamp = now_string();
    connection
        .execute(
            "INSERT INTO job_attempts(attempt_id, job_id, attempt_number, state, executable_id, execution_mode, timeout_seconds, max_log_bytes, process_started, external_side_effect_unknown, retryable, finished_at, created_at, updated_at) VALUES (?1, ?2, 1, 'succeeded', 'mock', 'in_process_mock', 60, 1048576, 0, 0, 0, ?3, ?3, ?3)",
            params![attempt_id, job_id, timestamp],
        )
        .map_err(|error| format!("Không ghi được mock execution attempt: {error}"))?;
    audit_event(
        &connection,
        Some(project_id.trim()),
        "attempt.mock_succeeded",
        "attempt",
        &attempt_id,
    )?;
    Ok(succeeded_job)
}

#[tauri::command]
pub(super) fn enqueue_pending_job(
    project_id: String,
    recipe_kind: String,
    state: State<'_, AppState>,
) -> Result<JobView, String> {
    valid_text(&project_id, "Project ID")?;
    valid_text(&recipe_kind, "Recipe")?;
    let _preview = preview_recipe(recipe_kind.clone())?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let exists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE project_id = ?1",
            params![project_id.trim()],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if exists == 0 {
        return Err("Project không tồn tại".to_string());
    }

    let job_id = now_id("job");
    let timestamp = now_string();
    connection
        .execute(
            "INSERT INTO jobs(job_id, project_id, kind, state, progress, attempt_count, created_at) VALUES (?1, ?2, ?3, 'queued', 0.0, 0, ?4)",
            params![job_id, project_id.trim(), recipe_kind.trim(), timestamp],
        )
        .map_err(|error| error.to_string())?;
    audit_event(
        &connection,
        Some(project_id.trim()),
        "job.pending_created",
        "job",
        &job_id,
    )?;
    fetch_job(&connection, &job_id)
}

#[tauri::command]
pub(super) fn prepare_pending_attempt(
    job_id: String,
    executable_id: Option<String>,
    timeout_seconds: u64,
    outputs: Vec<PendingOutputSpec>,
    state: State<'_, AppState>,
) -> Result<AttemptView, String> {
    valid_text(&job_id, "Job ID")?;
    if timeout_seconds == 0 || timeout_seconds > 604_800 {
        return Err("Timeout phải nằm trong khoảng 1..604800 giây".to_string());
    }
    if outputs.len() > 256 {
        return Err("Không được có quá 256 expected outputs".to_string());
    }
    if let Some(executable) = executable_id.as_deref() {
        if !matches!(
            executable,
            "blender" | "ffmpeg" | "ffprobe" | "node" | "obs" | "python"
        ) {
            return Err(format!("Executable chưa được allowlist: {executable}"));
        }
    }
    let mut normalized_outputs: Vec<(String, String)> = Vec::with_capacity(outputs.len());
    for output in outputs {
        let relative_path = validate_attempt_output_path(&output.relative_path)?;
        validate_attempt_media_kind(output.media_kind.trim())?;
        if normalized_outputs
            .iter()
            .any(|existing| existing.0 == relative_path)
        {
            return Err(format!("Expected output bị trùng: {relative_path}"));
        }
        normalized_outputs.push((relative_path, output.media_kind.trim().to_string()));
    }

    let mut connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Không mở được transaction: {error}"))?;
    let (project_id, current_state, attempt_count): (String, String, i64) = transaction
        .query_row(
            "SELECT project_id, state, attempt_count FROM jobs WHERE job_id = ?1",
            params![job_id.trim()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| format!("Không đọc được job: {error}"))?;
    if current_state != "queued" {
        return Err(format!(
            "Chỉ có thể chuẩn bị attempt cho job queued; hiện tại là {current_state}"
        ));
    }
    let active_attempts: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM job_attempts WHERE job_id = ?1 AND state IN ('pending', 'running', 'cancel_requested')",
            params![job_id.trim()],
            |row| row.get(0),
        )
        .map_err(|error| format!("Không đọc được attempt đang hoạt động: {error}"))?;
    if active_attempts > 0 {
        return Err("Job đã có execution attempt đang hoạt động".to_string());
    }
    let attempt_number = attempt_count + 1;
    if !(1..=10).contains(&attempt_number) {
        return Err("Số attempt vượt quá giới hạn 10".to_string());
    }
    let attempt_id = now_id("attempt");
    let timestamp = now_string();
    transaction
        .execute(
            "INSERT INTO job_attempts(attempt_id, job_id, attempt_number, state, executable_id, timeout_seconds, max_log_bytes, process_started, external_side_effect_unknown, retryable, created_at, updated_at) VALUES (?1, ?2, ?3, 'pending', ?4, ?5, 1048576, 0, 0, 0, ?6, ?6)",
            params![
                attempt_id,
                job_id.trim(),
                attempt_number,
                executable_id,
                timeout_seconds as i64,
                timestamp
            ],
        )
        .map_err(|error| format!("Không tạo được execution attempt: {error}"))?;
    for (index, (relative_path, media_kind)) in normalized_outputs.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO job_outputs(output_id, attempt_id, relative_path, media_kind, validation_state, created_at) VALUES (?1, ?2, ?3, ?4, 'pending', ?5)",
                params![
                    format!("{}-{index}", now_id("output")),
                    attempt_id,
                    relative_path,
                    media_kind,
                    timestamp
                ],
            )
            .map_err(|error| format!("Không tạo được expected output: {error}"))?;
    }
    transaction
        .execute(
            "UPDATE jobs SET attempt_count = ?1 WHERE job_id = ?2 AND state = 'queued'",
            params![attempt_number, job_id.trim()],
        )
        .map_err(|error| format!("Không cập nhật được attempt count của job: {error}"))?;
    audit_event(
        &transaction,
        Some(&project_id),
        "job.attempt_prepared",
        "attempt",
        &attempt_id,
    )?;
    transaction
        .commit()
        .map_err(|error| format!("Không commit được execution attempt: {error}"))?;
    fetch_attempt(&connection, &attempt_id)
}

#[tauri::command]
pub(super) fn list_job_attempts(
    job_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<AttemptView>, String> {
    valid_text(&job_id, "Job ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let mut statement = connection
        .prepare("SELECT attempt_id, job_id, attempt_number, state, executable_id, execution_mode, timeout_seconds, process_started, external_side_effect_unknown, created_at, updated_at FROM job_attempts WHERE job_id = ?1 ORDER BY attempt_number DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![job_id.trim()], |row| {
            Ok(AttemptView {
                attempt_id: row.get(0)?,
                job_id: row.get(1)?,
                attempt_number: row.get(2)?,
                state: row.get(3)?,
                executable_id: row.get(4)?,
                execution_mode: row.get(5)?,
                timeout_seconds: row.get(6)?,
                process_started: row.get::<_, i64>(7)? == 1,
                external_side_effect_unknown: row.get::<_, i64>(8)? == 1,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Không đọc được execution attempts: {error}"))
}

#[tauri::command]
pub(super) fn list_audit_events(
    project_id: Option<String>,
    limit: u32,
    state: State<'_, AppState>,
) -> Result<Vec<AuditEventView>, String> {
    if limit == 0 || limit > 100 {
        return Err("Audit limit phải nằm trong khoảng 1..100".to_string());
    }
    if let Some(project) = project_id.as_deref() {
        valid_text(project, "Project ID")?;
    }
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let limit = limit as i64;
    let mut events = Vec::new();
    if let Some(project) = project_id.as_deref() {
        let mut statement = connection
            .prepare("SELECT event_id, project_id, event_type, subject_type, subject_id, created_at FROM audit_events WHERE project_id = ?1 ORDER BY created_at DESC, event_id DESC LIMIT ?2")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![project.trim(), limit], |row| {
                Ok(AuditEventView {
                    event_id: row.get(0)?,
                    project_id: row.get(1)?,
                    event_type: row.get(2)?,
                    subject_type: row.get(3)?,
                    subject_id: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })
            .map_err(|error| error.to_string())?;
        for row in rows {
            events.push(row.map_err(|error| error.to_string())?);
        }
    } else {
        let mut statement = connection
            .prepare("SELECT event_id, project_id, event_type, subject_type, subject_id, created_at FROM audit_events ORDER BY created_at DESC, event_id DESC LIMIT ?1")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![limit], |row| {
                Ok(AuditEventView {
                    event_id: row.get(0)?,
                    project_id: row.get(1)?,
                    event_type: row.get(2)?,
                    subject_type: row.get(3)?,
                    subject_id: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })
            .map_err(|error| error.to_string())?;
        for row in rows {
            events.push(row.map_err(|error| error.to_string())?);
        }
    }
    Ok(events)
}

#[tauri::command]
pub(super) fn list_attempt_outputs(
    attempt_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<AttemptOutputView>, String> {
    valid_text(&attempt_id, "Attempt ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let mut statement = connection
        .prepare("SELECT output_id, attempt_id, relative_path, media_kind, validation_state, validation_message FROM job_outputs WHERE attempt_id = ?1 ORDER BY relative_path")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![attempt_id.trim()], |row| {
            Ok(AttemptOutputView {
                output_id: row.get(0)?,
                attempt_id: row.get(1)?,
                relative_path: row.get(2)?,
                media_kind: row.get(3)?,
                validation_state: row.get(4)?,
                validation_message: row.get(5)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Không đọc được output evidence: {error}"))
}

#[tauri::command]
pub(super) fn preview_process(spec: ProcessSpec) -> Result<ProcessDryRunPlan, String> {
    plan_process_dry_run(spec)
}

#[tauri::command]
pub(super) fn retry_job(job_id: String, state: State<'_, AppState>) -> Result<JobView, String> {
    valid_text(&job_id, "Job ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    transition_job_locked(&connection, job_id.trim(), "queued", None)
}

#[tauri::command]
pub(super) fn cancel_job(job_id: String, state: State<'_, AppState>) -> Result<JobView, String> {
    valid_text(&job_id, "Job ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let current_state: String = connection
        .query_row(
            "SELECT state FROM jobs WHERE job_id = ?1",
            params![job_id.trim()],
            |row| row.get(0),
        )
        .map_err(|error| format!("Không đọc được job: {error}"))?;
    let next_state = match current_state.as_str() {
        "queued" => "cancelled",
        "running" => "cancel_requested",
        "cancel_requested" => "cancelled",
        _ => return Err(format!("Không thể hủy job đang ở state {current_state}")),
    };
    let job = transition_job_locked(&connection, job_id.trim(), next_state, None)?;
    drop(connection);
    if current_state == "running" {
        request_attempt_cancel(&state, job_id.trim())?;
    }
    Ok(job)
}
