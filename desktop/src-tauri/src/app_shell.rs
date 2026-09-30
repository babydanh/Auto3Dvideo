use super::tool_readiness::tool_readiness_report;
use super::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AppSnapshot {
    app_version: String,
    locale: String,
    project_count: i64,
    job_count: i64,
    publish_enabled: bool,
    paid_generation_enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct HealthStatus {
    database: String,
    external_tools: String,
    publish_policy: String,
    locale: String,
}

#[tauri::command]
pub(super) fn app_snapshot(state: State<'_, AppState>) -> Result<AppSnapshot, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let project_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let job_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM jobs", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;

    Ok(AppSnapshot {
        app_version: "0.1.0-dev".to_string(),
        locale: "vi-VN".to_string(),
        project_count,
        job_count,
        publish_enabled: false,
        paid_generation_enabled: read_cloud_generation_enabled(&connection)?,
    })
}

#[tauri::command]
pub(super) fn set_cloud_generation_enabled(
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let mut connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database để ghi cài đặt Cloud/API".to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    save_cloud_generation_enabled(&transaction, enabled)?;
    audit_event(
        &transaction,
        None,
        if enabled {
            "cloud_generation.enabled"
        } else {
            "cloud_generation.disabled"
        },
        "provider_gate",
        if enabled {
            "cloud-api"
        } else {
            "cloud-api-off"
        },
    )?;
    transaction
        .commit()
        .map_err(|error| format!("Không commit được quyền Cloud/API: {error}"))?;
    Ok(enabled)
}

#[tauri::command]
pub(super) fn health_check(state: State<'_, AppState>) -> Result<HealthStatus, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let readiness = tool_readiness_report(&connection)?;
    Ok(HealthStatus {
        database: "ready".to_string(),
        external_tools: readiness.status,
        publish_policy: "blocked_by_default".to_string(),
        locale: "vi-VN".to_string(),
    })
}
