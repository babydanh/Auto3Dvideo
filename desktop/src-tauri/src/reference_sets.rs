use super::{
    audit_event, ensure_project_exists, fetch_asset, fetch_reference_set, now_id, now_string,
    preview_secret_like, valid_text, validate_asset_text, validate_reference_role,
    validate_reference_scope, AppState, ReferenceAssignmentInput, ReferenceSetInput,
    ReferenceSetView,
};
use rusqlite::params;
use tauri::State;

fn validate_reference_set_input(input: &ReferenceSetInput) -> Result<(), String> {
    valid_text(&input.project_id, "Project ID")?;
    validate_asset_text(&input.name, "Tên reference set", 160)?;
    validate_reference_scope(input.scope.trim())?;
    if input.continuity_note.chars().count() > 4000 || preview_secret_like(&input.continuity_note) {
        return Err("Continuity note không hợp lệ".to_string());
    }
    Ok(())
}

#[tauri::command]
pub(super) fn list_reference_sets(
    project_id: String,
    include_archived: bool,
    state: State<'_, AppState>,
) -> Result<Vec<ReferenceSetView>, String> {
    valid_text(&project_id, "Project ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    ensure_project_exists(&connection, project_id.trim())?;
    let suffix = if include_archived {
        ""
    } else {
        " AND status != 'archived'"
    };
    let sql = format!("SELECT reference_set_id FROM reference_sets WHERE project_id = ?1{} ORDER BY updated_at DESC", suffix);
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![project_id.trim()], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    let ids = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    ids.into_iter()
        .map(|id| fetch_reference_set(&connection, &id))
        .collect()
}

#[tauri::command]
pub(super) fn create_reference_set(
    input: ReferenceSetInput,
    state: State<'_, AppState>,
) -> Result<ReferenceSetView, String> {
    validate_reference_set_input(&input)?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    ensure_project_exists(&connection, input.project_id.trim())?;
    let reference_set_id = now_id("reference-set");
    let timestamp = now_string();
    connection.execute("INSERT INTO reference_sets(reference_set_id, project_id, name, scope, status, continuity_note, created_at, updated_at, archived_at) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6, ?6, NULL)", params![reference_set_id, input.project_id.trim(), input.name.trim(), input.scope.trim(), input.continuity_note.trim(), timestamp]).map_err(|error| format!("Không lưu được reference set: {error}"))?;
    audit_event(
        &connection,
        Some(input.project_id.trim()),
        "reference_set.created",
        "reference_set",
        &reference_set_id,
    )?;
    fetch_reference_set(&connection, &reference_set_id)
}

#[tauri::command]
pub(super) fn update_reference_set(
    reference_set_id: String,
    input: ReferenceSetInput,
    state: State<'_, AppState>,
) -> Result<ReferenceSetView, String> {
    valid_text(&reference_set_id, "Reference set ID")?;
    validate_reference_set_input(&input)?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let current = fetch_reference_set(&connection, reference_set_id.trim())?;
    if current.project_id != input.project_id.trim() {
        return Err("Không thể sửa reference set khác project".to_string());
    }
    if current.status == "archived" {
        return Err("Không thể sửa reference set đã lưu trữ; hãy khôi phục trước".to_string());
    }
    connection.execute("UPDATE reference_sets SET name=?1, scope=?2, continuity_note=?3, updated_at=?4 WHERE reference_set_id=?5 AND project_id=?6", params![input.name.trim(), input.scope.trim(), input.continuity_note.trim(), now_string(), reference_set_id.trim(), input.project_id.trim()]).map_err(|error| error.to_string())?;
    audit_event(
        &connection,
        Some(input.project_id.trim()),
        "reference_set.updated",
        "reference_set",
        reference_set_id.trim(),
    )?;
    fetch_reference_set(&connection, reference_set_id.trim())
}

#[tauri::command]
pub(super) fn archive_reference_set(
    project_id: String,
    reference_set_id: String,
    state: State<'_, AppState>,
) -> Result<ReferenceSetView, String> {
    valid_text(&project_id, "Project ID")?;
    valid_text(&reference_set_id, "Reference set ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let current = fetch_reference_set(&connection, reference_set_id.trim())?;
    if current.project_id != project_id.trim() {
        return Err("Không thể lưu trữ reference set khác project".to_string());
    }
    let timestamp = now_string();
    connection.execute("UPDATE reference_sets SET status='archived', archived_at=?1, updated_at=?1 WHERE reference_set_id=?2", params![timestamp, reference_set_id.trim()]).map_err(|error| error.to_string())?;
    audit_event(
        &connection,
        Some(project_id.trim()),
        "reference_set.archived",
        "reference_set",
        reference_set_id.trim(),
    )?;
    fetch_reference_set(&connection, reference_set_id.trim())
}

#[tauri::command]
pub(super) fn restore_reference_set(
    project_id: String,
    reference_set_id: String,
    state: State<'_, AppState>,
) -> Result<ReferenceSetView, String> {
    valid_text(&project_id, "Project ID")?;
    valid_text(&reference_set_id, "Reference set ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let current = fetch_reference_set(&connection, reference_set_id.trim())?;
    if current.project_id != project_id.trim() {
        return Err("Không thể khôi phục reference set khác project".to_string());
    }
    connection.execute("UPDATE reference_sets SET status='active', archived_at=NULL, updated_at=?1 WHERE reference_set_id=?2", params![now_string(), reference_set_id.trim()]).map_err(|error| error.to_string())?;
    audit_event(
        &connection,
        Some(project_id.trim()),
        "reference_set.restored",
        "reference_set",
        reference_set_id.trim(),
    )?;
    fetch_reference_set(&connection, reference_set_id.trim())
}

#[tauri::command]
pub(super) fn assign_reference(
    input: ReferenceAssignmentInput,
    state: State<'_, AppState>,
) -> Result<ReferenceSetView, String> {
    valid_text(&input.project_id, "Project ID")?;
    valid_text(&input.reference_set_id, "Reference set ID")?;
    valid_text(&input.asset_id, "Asset ID")?;
    validate_reference_role(input.role.trim())?;
    if !(0.0..=1.0).contains(&input.strength) || !input.strength.is_finite() {
        return Err("Strength phải nằm trong khoảng 0–1".to_string());
    }
    if input.priority < 0 {
        return Err("Priority không được âm".to_string());
    }
    for (value, field, max_len) in [(&input.notes, "Reference notes", 2000usize)] {
        if value.chars().count() > max_len || preview_secret_like(value) {
            return Err(format!("{field} không hợp lệ"));
        }
    }
    if let Some(shot_id) = &input.shot_id {
        if shot_id.chars().count() > 120 || shot_id.contains(['\r', '\n', '\0']) {
            return Err("Shot ID không hợp lệ".to_string());
        }
    }
    if let (Some(start), Some(end)) = (input.shot_range_start, input.shot_range_end) {
        if start < 0 || end < start {
            return Err("Shot range không hợp lệ".to_string());
        }
    }
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let reference_set = fetch_reference_set(&connection, input.reference_set_id.trim())?;
    if reference_set.project_id != input.project_id.trim() || reference_set.status == "archived" {
        return Err("Reference set không thuộc project hoặc đang lưu trữ".to_string());
    }
    let asset = fetch_asset(&connection, input.asset_id.trim())?;
    if asset.project_id != input.project_id.trim()
        || asset.status == "archived"
        || asset.status == "missing"
    {
        return Err("Asset không thuộc project hoặc chưa sẵn sàng để gán".to_string());
    }
    let assignment_id = now_id("reference");
    let timestamp = now_string();
    connection.execute("INSERT INTO reference_set_assignments(assignment_id, project_id, reference_set_id, asset_id, role, strength, priority, shot_id, shot_range_start, shot_range_end, crop, notes, approved, asset_sha256, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)", params![assignment_id, input.project_id.trim(), input.reference_set_id.trim(), input.asset_id.trim(), input.role.trim(), input.strength, input.priority, input.shot_id.as_deref().map(str::trim).filter(|value| !value.is_empty()), input.shot_range_start, input.shot_range_end, input.crop.as_deref().map(str::trim).filter(|value| !value.is_empty()), input.notes.trim(), if input.approved { 1 } else { 0 }, asset.sha256, timestamp]).map_err(|error| format!("Không gán được reference: {error}"))?;
    connection
        .execute(
            "UPDATE reference_sets SET updated_at=?1 WHERE reference_set_id=?2",
            params![timestamp, input.reference_set_id.trim()],
        )
        .map_err(|error| error.to_string())?;
    audit_event(
        &connection,
        Some(input.project_id.trim()),
        "reference.assigned",
        "reference_set",
        input.reference_set_id.trim(),
    )?;
    fetch_reference_set(&connection, input.reference_set_id.trim())
}

#[tauri::command]
pub(super) fn detach_reference(
    project_id: String,
    assignment_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    valid_text(&project_id, "Project ID")?;
    valid_text(&assignment_id, "Assignment ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let reference_set_id: String = connection.query_row("SELECT reference_set_id FROM reference_set_assignments WHERE assignment_id=?1 AND project_id=?2", params![assignment_id.trim(), project_id.trim()], |row| row.get(0)).map_err(|error| format!("Không đọc được assignment: {error}"))?;
    connection
        .execute(
            "DELETE FROM reference_set_assignments WHERE assignment_id=?1 AND project_id=?2",
            params![assignment_id.trim(), project_id.trim()],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "UPDATE reference_sets SET updated_at=?1 WHERE reference_set_id=?2",
            params![now_string(), reference_set_id],
        )
        .map_err(|error| error.to_string())?;
    audit_event(
        &connection,
        Some(project_id.trim()),
        "reference.detached",
        "reference",
        assignment_id.trim(),
    )?;
    Ok(())
}
