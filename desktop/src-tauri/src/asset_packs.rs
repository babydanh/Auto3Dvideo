use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Arc},
};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use super::{
    asset_status_for_rights, audit_event, ensure_project_exists, fetch_asset, now_id, now_string,
    preview_secret_like, project_workspace_root, resolve_configured_tool, safe_preview_id,
    sha256_file, valid_text, validate_asset_rights, validate_attempt_output_path, AppState,
    AssetView, BLENDER_ASSET_BINDING_WORKER_SCRIPT,
};
use super::{
    external_worker::{run_external_process, ExternalProcessRequest, ExternalProcessResult},
    process_executor::ProcessSpec,
};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AssetPackSourceView {
    pack_relative_path: String,
    items_relative_path: String,
    report_relative_path: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AssetPackReportView {
    relative_path: String,
    status: String,
    run_id: String,
    item_counts: Value,
    errors: Vec<Value>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AssetPackReviewItemView {
    asset_item_id: String,
    title: String,
    identity_anchor_id: Option<String>,
    role: String,
    status: String,
    review_state: String,
    rights_status: String,
    prompt: String,
    negative_prompt: String,
    shot_ids: Vec<String>,
    required_views: Vec<String>,
    scale_meters: Option<f64>,
    output_asset_ids: Vec<String>,
    output_paths: Vec<String>,
    output_assets: Vec<AssetView>,
    acceptance_checks: Vec<Value>,
    generation_attempts: Vec<Value>,
    note: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct AssetPackReviewView {
    schema_version: String,
    project_id: String,
    pack_id: String,
    title: String,
    status: String,
    source: AssetPackSourceView,
    acceptance_policy: Value,
    items: Vec<AssetPackReviewItemView>,
    report: Option<AssetPackReportView>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct AssetPackBlenderBindingReport {
    schema_version: String,
    binding_id: String,
    project_id: String,
    pack_id: String,
    status: String,
    binding_path: Option<String>,
    job_path: Option<String>,
    asset_count: usize,
    shot_ids: Vec<String>,
    world_scale_meters: Option<f64>,
    approved_reference_hashes: Vec<String>,
    blockers: Vec<String>,
    blender_execution_started: bool,
    human_review_required: bool,
    message: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct AssetPackBlenderBindingRunReport {
    binding_id: String,
    status: String,
    scene_path: String,
    preview_outputs: Vec<String>,
    report_path: String,
    process: ExternalProcessResult,
    message: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct AssetPackSourceInput {
    project_id: String,
    pack_path: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct AssetPackReviewUpdateInput {
    project_id: String,
    pack_id: String,
    asset_item_id: String,
    review_state: String,
    rights_status: String,
    #[serde(default)]
    acceptance_checks: Vec<Value>,
    #[serde(default)]
    note: String,
}

fn asset_pack_json_path(workspace_root: &Path, raw: &str, field: &str) -> Result<PathBuf, String> {
    let normalized = validate_attempt_output_path(raw)?;
    let candidate = workspace_root.join(normalized.replace('/', "\\"));
    let canonical =
        fs::canonicalize(&candidate).map_err(|error| format!("Không đọc được {field}: {error}"))?;
    let canonical_root = fs::canonicalize(workspace_root)
        .map_err(|error| format!("Không canonicalize được workspace cho {field}: {error}"))?;
    if !canonical.starts_with(&canonical_root) || !canonical.is_file() {
        return Err(format!("{field} phải là file trong project workspace"));
    }
    let size = fs::metadata(&canonical)
        .map_err(|error| format!("Không đọc được kích thước {field}: {error}"))?
        .len();
    if size == 0 || size > 16 * 1024 * 1024 {
        return Err(format!("{field} phải lớn hơn 0 và không vượt quá 16 MB"));
    }
    Ok(canonical)
}

fn read_asset_pack_json(path: &Path, field: &str) -> Result<Value, String> {
    let size = fs::metadata(path)
        .map_err(|error| format!("Không đọc được kích thước {field}: {error}"))?
        .len();
    if size == 0 || size > 16 * 1024 * 1024 {
        return Err(format!("{field} phải lớn hơn 0 và không vượt quá 16 MB"));
    }
    let text =
        fs::read_to_string(path).map_err(|error| format!("Không đọc được {field}: {error}"))?;
    serde_json::from_str(&text).map_err(|error| format!("{field} không phải JSON hợp lệ: {error}"))
}

fn json_string(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn json_optional_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
}

fn json_string_vec(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn workspace_relative_path(workspace_root: &Path, path: &Path) -> Result<String, String> {
    path.strip_prefix(workspace_root)
        .map(|value| value.to_string_lossy().replace('\\', "/"))
        .map_err(|_| "Asset Pack path vượt project workspace".to_string())
}

fn collect_asset_pack_paths(root: &Path, max_depth: usize, max_files: usize) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut stack = vec![(root.to_path_buf(), 0_usize)];
    let ignored = [".git", "node_modules", "target", "cache", "venv", ".venv"];
    while let Some((directory, depth)) = stack.pop() {
        if found.len() >= max_files {
            break;
        }
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            if found.len() >= max_files {
                break;
            }
            let path = entry.path();
            let file_type = match entry.file_type() {
                Ok(value) => value,
                Err(_) => continue,
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() && depth < max_depth {
                let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                if !ignored.iter().any(|item| *item == name) {
                    stack.push((path, depth + 1));
                }
            } else if file_type.is_file()
                && path.file_name().and_then(|value| value.to_str()) == Some("asset-pack.json")
            {
                found.push(path);
            }
        }
    }
    found
}

fn find_asset_pack_report(
    workspace_root: &Path,
    project_id: &str,
    pack_id: &str,
) -> Result<Option<String>, String> {
    let mut stack = Vec::new();
    let mut visited_files = 0_usize;
    for relative_root in [".auto3dvideo", "outputs"] {
        let root = workspace_root.join(relative_root);
        if root.is_dir() {
            stack.push((root, 0_usize));
        }
    }
    let ignored = [".git", "node_modules", "target", "cache", "venv", ".venv"];
    while let Some((directory, depth)) = stack.pop() {
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            visited_files += 1;
            if visited_files > 1024 {
                return Err("Quét Asset Pack report vượt giới hạn 1024 entry".to_string());
            }
            let path = entry.path();
            let file_type = match entry.file_type() {
                Ok(value) => value,
                Err(_) => continue,
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() && depth < 6 {
                let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                if !ignored.iter().any(|item| *item == name) {
                    stack.push((path, depth + 1));
                }
                continue;
            }
            if !file_type.is_file()
                || path.file_name().and_then(|value| value.to_str())
                    != Some("asset-generation-report.json")
            {
                continue;
            }
            let report = match read_asset_pack_json(&path, "asset-generation-report.json") {
                Ok(value) => value,
                Err(_) => continue,
            };
            if json_string(&report, "projectId") == project_id
                && json_string(&report, "packId") == pack_id
            {
                return Ok(Some(workspace_relative_path(workspace_root, &path)?));
            }
        }
    }
    Ok(None)
}

fn validate_asset_pack_item_value(item: &Value, pack_id: &str) -> Result<(), String> {
    let item_id = json_string(item, "assetItemId");
    if !safe_preview_id(&item_id) {
        return Err("Asset Pack có assetItemId không hợp lệ".to_string());
    }
    if json_string(item, "packId") != pack_id {
        return Err(format!("Asset Pack item {item_id} không khớp packId"));
    }
    if json_string(item, "title").is_empty() || json_string(item, "role").is_empty() {
        return Err(format!("Asset Pack item {item_id} thiếu title/role"));
    }
    Ok(())
}

fn asset_pack_source_candidates(
    workspace_root: &Path,
    project_id: &str,
) -> Result<Vec<(String, String, Option<String>)>, String> {
    let mut sources = Vec::new();
    for relative_root in [".auto3dvideo", "outputs"] {
        let root = workspace_root.join(relative_root);
        if !root.is_dir() {
            continue;
        }
        for pack_path in collect_asset_pack_paths(&root, 5, 64) {
            let items_path = pack_path.with_file_name("asset-items.json");
            if !items_path.is_file() {
                continue;
            }
            let pack = match read_asset_pack_json(&pack_path, "asset-pack.json") {
                Ok(value) => value,
                Err(_) => continue,
            };
            if json_string(&pack, "projectId") != project_id {
                continue;
            }
            let report_path = pack_path.with_file_name("asset-generation-report.json");
            let pack_relative = workspace_relative_path(workspace_root, &pack_path)?;
            let items_relative = workspace_relative_path(workspace_root, &items_path)?;
            let report_relative = if report_path.is_file() {
                Some(workspace_relative_path(workspace_root, &report_path)?)
            } else {
                find_asset_pack_report(workspace_root, project_id, &json_string(&pack, "packId"))?
            };
            if !sources
                .iter()
                .any(|item: &(String, String, Option<String>)| item.0 == pack_relative)
            {
                sources.push((pack_relative, items_relative, report_relative));
            }
        }
    }
    Ok(sources)
}

fn load_asset_pack_review(
    connection: &Connection,
    workspace_root: &Path,
    project_id: &str,
    source: &(String, String, Option<String>),
) -> Result<AssetPackReviewView, String> {
    let pack_path = asset_pack_json_path(workspace_root, &source.0, "asset-pack.json")?;
    let items_path = asset_pack_json_path(workspace_root, &source.1, "asset-items.json")?;
    let pack = read_asset_pack_json(&pack_path, "asset-pack.json")?;
    let items_document = read_asset_pack_json(&items_path, "asset-items.json")?;
    let pack_id = json_string(&pack, "packId");
    if !safe_preview_id(&pack_id) || json_string(&pack, "projectId") != project_id {
        return Err("Asset Pack không khớp project hoặc packId không an toàn".to_string());
    }
    let items = items_document
        .get("items")
        .and_then(Value::as_array)
        .ok_or_else(|| "asset-items.json thiếu mảng items".to_string())?;
    let mut overlay: HashMap<String, (String, String, Vec<Value>, String)> = HashMap::new();
    let mut statement = connection
        .prepare("SELECT asset_item_id, review_state, rights_status, acceptance_checks_json, note FROM asset_pack_item_reviews WHERE project_id = ?1 AND pack_id = ?2")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![project_id, pack_id.as_str()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    for row in rows {
        let (item_id, review_state, rights_status, checks_json, note) =
            row.map_err(|error| error.to_string())?;
        let checks = serde_json::from_str::<Vec<Value>>(&checks_json).unwrap_or_default();
        overlay.insert(item_id, (review_state, rights_status, checks, note));
    }

    let mut report_items: HashMap<String, Vec<String>> = HashMap::new();
    let mut report = None;
    let discovered_report = if source.2.is_none() {
        find_asset_pack_report(workspace_root, project_id, &pack_id)?
    } else {
        None
    };
    if let Some(report_relative) = source.2.as_ref().or(discovered_report.as_ref()) {
        if let Ok(report_path) = asset_pack_json_path(
            workspace_root,
            report_relative,
            "asset-generation-report.json",
        ) {
            if let Ok(document) = read_asset_pack_json(&report_path, "asset-generation-report.json")
            {
                if let Some(report_array) = document.get("items").and_then(Value::as_array) {
                    for report_item in report_array {
                        let item_id = json_string(report_item, "assetItemId");
                        let paths = report_item
                            .get("outputs")
                            .and_then(Value::as_array)
                            .into_iter()
                            .flatten()
                            .filter_map(|output| output.get("relativePath").and_then(Value::as_str))
                            .filter_map(|path| validate_attempt_output_path(path).ok())
                            .collect::<Vec<_>>();
                        report_items.insert(item_id, paths);
                    }
                }
                report = Some(AssetPackReportView {
                    relative_path: report_relative.clone(),
                    status: json_string(&document, "status"),
                    run_id: json_string(&document, "runId"),
                    item_counts: document.get("itemCounts").cloned().unwrap_or(Value::Null),
                    errors: document
                        .get("errors")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default(),
                });
            }
        }
    }

    let mut review_items = Vec::new();
    for item in items {
        validate_asset_pack_item_value(item, &pack_id)?;
        let item_id = json_string(item, "assetItemId");
        let output_asset_ids = json_string_vec(item, "outputAssetIds");
        let mut output_paths = report_items.remove(&item_id).unwrap_or_default();
        let mut output_assets = Vec::new();
        for asset_id in &output_asset_ids {
            if let Ok(asset) = fetch_asset(connection, asset_id) {
                if asset.project_id == project_id {
                    if !output_paths.iter().any(|path| path == &asset.relative_path) {
                        output_paths.push(asset.relative_path.clone());
                    }
                    output_assets.push(asset);
                }
            }
        }
        let manifest_checks = item
            .get("acceptanceChecks")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let (review_state, rights_status, acceptance_checks, note) = overlay
            .remove(&item_id)
            .map(|value| {
                let checks = if value.2.is_empty() {
                    manifest_checks.clone()
                } else {
                    value.2
                };
                (value.0, value.1, checks, value.3)
            })
            .unwrap_or_else(|| {
                (
                    json_string(item, "reviewState"),
                    json_string(item, "rightsStatus"),
                    manifest_checks,
                    json_string(item, "note"),
                )
            });
        review_items.push(AssetPackReviewItemView {
            asset_item_id: item_id,
            title: json_string(item, "title"),
            identity_anchor_id: json_optional_string(item, "identityAnchorId"),
            role: json_string(item, "role"),
            status: if review_state == "approved" {
                "approved".to_string()
            } else {
                json_string(item, "status")
            },
            review_state,
            rights_status,
            prompt: json_string(item, "prompt"),
            negative_prompt: json_string(item, "negativePrompt"),
            shot_ids: json_string_vec(item, "shotIds"),
            required_views: json_string_vec(item, "requiredViews"),
            scale_meters: item.get("scaleMeters").and_then(Value::as_f64),
            output_asset_ids,
            output_paths,
            output_assets,
            acceptance_checks,
            generation_attempts: item
                .get("generationAttempts")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
            note,
        });
    }
    let all_approved = !review_items.is_empty()
        && review_items
            .iter()
            .all(|item| item.review_state == "approved");
    let source_view = AssetPackSourceView {
        pack_relative_path: source.0.clone(),
        items_relative_path: source.1.clone(),
        report_relative_path: source.2.clone(),
    };
    Ok(AssetPackReviewView {
        schema_version: "1.0.0".to_string(),
        project_id: project_id.to_string(),
        pack_id,
        title: json_string(&pack, "title"),
        status: if all_approved {
            "approved".to_string()
        } else {
            json_string(&pack, "status")
        },
        source: source_view,
        acceptance_policy: pack.get("acceptancePolicy").cloned().unwrap_or(Value::Null),
        items: review_items,
        report,
        created_at: json_string(&pack, "createdAt"),
        updated_at: json_string(&pack, "updatedAt"),
    })
}

fn list_asset_pack_reviews_with_connection(
    connection: &Connection,
    project_id: &str,
) -> Result<Vec<AssetPackReviewView>, String> {
    ensure_project_exists(connection, project_id)?;
    let workspace_root = project_workspace_root(connection, project_id)?;
    let mut sources = Vec::<(String, String, Option<String>)>::new();
    let mut statement = connection
        .prepare("SELECT pack_relative_path, items_relative_path, report_relative_path FROM asset_pack_sources WHERE project_id = ?1 ORDER BY updated_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![project_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    for row in rows {
        sources.push(row.map_err(|error| error.to_string())?);
    }
    for candidate in asset_pack_source_candidates(&workspace_root, project_id)? {
        if !sources.iter().any(|item| item.0 == candidate.0) {
            sources.push(candidate);
        }
    }
    let mut views = Vec::new();
    for source in sources {
        views.push(load_asset_pack_review(
            connection,
            &workspace_root,
            project_id,
            &source,
        )?);
    }
    Ok(views)
}

#[tauri::command]
pub(super) fn list_asset_pack_reviews(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<AssetPackReviewView>, String> {
    valid_text(&project_id, "Project ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    list_asset_pack_reviews_with_connection(&connection, project_id.trim())
}

#[tauri::command]
pub(super) fn register_asset_pack_source(
    input: AssetPackSourceInput,
    state: State<'_, AppState>,
) -> Result<Vec<AssetPackReviewView>, String> {
    valid_text(&input.project_id, "Project ID")?;
    valid_text(&input.pack_path, "Đường dẫn asset-pack.json")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    ensure_project_exists(&connection, input.project_id.trim())?;
    let workspace_root = project_workspace_root(&connection, input.project_id.trim())?;
    let canonical_root = fs::canonicalize(&workspace_root).map_err(|error| error.to_string())?;
    let pack_path = fs::canonicalize(Path::new(input.pack_path.trim()))
        .map_err(|error| format!("Không đọc được asset-pack.json: {error}"))?;
    if !pack_path.starts_with(&canonical_root) || !pack_path.is_file() {
        return Err("Asset Pack phải nằm trong workspace của project".to_string());
    }
    let pack = read_asset_pack_json(&pack_path, "asset-pack.json")?;
    let pack_id = json_string(&pack, "packId");
    if !safe_preview_id(&pack_id) || json_string(&pack, "projectId") != input.project_id.trim() {
        return Err("asset-pack.json không khớp project hoặc packId không hợp lệ".to_string());
    }
    let items_path = pack_path.with_file_name("asset-items.json");
    if !items_path.is_file() {
        return Err("Cần asset-items.json nằm cùng thư mục với asset-pack.json".to_string());
    }
    let items = read_asset_pack_json(&items_path, "asset-items.json")?;
    let item_values = items
        .get("items")
        .and_then(Value::as_array)
        .ok_or_else(|| "asset-items.json thiếu mảng items".to_string())?;
    for item in item_values {
        validate_asset_pack_item_value(item, &pack_id)?;
    }
    let report_path = pack_path.with_file_name("asset-generation-report.json");
    let pack_relative = workspace_relative_path(&canonical_root, &pack_path)?;
    let items_relative = workspace_relative_path(&canonical_root, &items_path)?;
    let report_relative = if report_path.is_file() {
        Some(workspace_relative_path(&canonical_root, &report_path)?)
    } else {
        find_asset_pack_report(&canonical_root, input.project_id.trim(), &pack_id)?
    };
    let timestamp = now_string();
    connection
        .execute(
            "INSERT INTO asset_pack_sources(project_id, pack_id, pack_relative_path, items_relative_path, report_relative_path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, COALESCE((SELECT created_at FROM asset_pack_sources WHERE project_id=?1 AND pack_id=?2), ?6), ?6) ON CONFLICT(project_id, pack_id) DO UPDATE SET pack_relative_path=excluded.pack_relative_path, items_relative_path=excluded.items_relative_path, report_relative_path=excluded.report_relative_path, updated_at=excluded.updated_at",
            params![input.project_id.trim(), pack_id, pack_relative, items_relative, report_relative, timestamp],
        )
        .map_err(|error| format!("Không lưu được nguồn Asset Pack: {error}"))?;
    audit_event(
        &connection,
        Some(input.project_id.trim()),
        "asset_pack.source_registered",
        "asset_pack",
        &pack_id,
    )?;
    list_asset_pack_reviews_with_connection(&connection, input.project_id.trim())
}

fn validate_asset_pack_review_checks(checks: &[Value]) -> Result<(), String> {
    if checks.len() > 64 {
        return Err("Asset Pack chỉ được có tối đa 64 acceptance checks".to_string());
    }
    for check in checks {
        let check_id = json_string(check, "checkId");
        let status = json_string(check, "status");
        if !safe_preview_id(&check_id)
            || !matches!(
                status.as_str(),
                "pending" | "pass" | "fail" | "not_applicable"
            )
        {
            return Err("Acceptance check của Asset Pack không hợp lệ".to_string());
        }
        if let Some(evidence) = check.get("evidence").and_then(Value::as_str) {
            if evidence.chars().count() > 1000 || preview_secret_like(evidence) {
                return Err("Evidence của Asset Pack không hợp lệ".to_string());
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub(super) fn update_asset_pack_item_review(
    input: AssetPackReviewUpdateInput,
    state: State<'_, AppState>,
) -> Result<AssetPackReviewView, String> {
    valid_text(&input.project_id, "Project ID")?;
    valid_text(&input.pack_id, "Pack ID")?;
    valid_text(&input.asset_item_id, "Asset item ID")?;
    if !safe_preview_id(input.pack_id.trim()) || !safe_preview_id(input.asset_item_id.trim()) {
        return Err("Pack ID hoặc asset item ID không hợp lệ".to_string());
    }
    if !matches!(
        input.review_state.trim(),
        "not_started" | "in_review" | "approved" | "rejected" | "needs_revision"
    ) {
        return Err("Review state của Asset Pack không hợp lệ".to_string());
    }
    validate_asset_rights(input.rights_status.trim())?;
    if input.note.chars().count() > 4000 || preview_secret_like(&input.note) {
        return Err("Ghi chú review Asset Pack không hợp lệ".to_string());
    }
    validate_asset_pack_review_checks(&input.acceptance_checks)?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let views = list_asset_pack_reviews_with_connection(&connection, input.project_id.trim())?;
    let pack = views
        .iter()
        .find(|view| view.pack_id == input.pack_id.trim())
        .ok_or_else(|| "Không tìm thấy Asset Pack đã đăng ký".to_string())?;
    let item = pack
        .items
        .iter()
        .find(|item| item.asset_item_id == input.asset_item_id.trim())
        .ok_or_else(|| "Không tìm thấy item trong Asset Pack".to_string())?;
    if item.review_state == "approved" && input.review_state.trim() != "approved" {
        return Err(
            "Asset đã approved là bất biến; hãy tạo item/version mới thay vì ghi đè".to_string(),
        );
    }
    let checks = if input.acceptance_checks.is_empty() {
        item.acceptance_checks.clone()
    } else {
        input.acceptance_checks.clone()
    };
    if input.review_state.trim() == "approved" {
        if !matches!(
            input.rights_status.trim(),
            "personal" | "owned" | "licensed" | "public_domain"
        ) {
            return Err("Chỉ được approve Asset Pack item sau khi quyền là personal/owned/licensed/public_domain".to_string());
        }
        let required_checks_pass = checks.iter().all(|check| {
            !check
                .get("required")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                || check.get("status").and_then(Value::as_str) == Some("pass")
        });
        if !required_checks_pass {
            return Err("Chưa pass đủ acceptance checks bắt buộc của item".to_string());
        }
    }
    let checks_json = serde_json::to_string(&checks).map_err(|error| error.to_string())?;
    let timestamp = now_string();
    connection
        .execute(
            "INSERT INTO asset_pack_item_reviews(project_id, pack_id, asset_item_id, review_state, rights_status, acceptance_checks_json, note, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8) ON CONFLICT(project_id, pack_id, asset_item_id) DO UPDATE SET review_state=excluded.review_state, rights_status=excluded.rights_status, acceptance_checks_json=excluded.acceptance_checks_json, note=excluded.note, updated_at=excluded.updated_at",
            params![input.project_id.trim(), input.pack_id.trim(), input.asset_item_id.trim(), input.review_state.trim(), input.rights_status.trim(), checks_json, input.note.trim(), timestamp],
        )
        .map_err(|error| format!("Không lưu được review Asset Pack: {error}"))?;
    for asset_id in &item.output_asset_ids {
        connection
            .execute(
                "UPDATE asset_library SET rights_status=?1, status=?2, updated_at=?3 WHERE project_id=?4 AND asset_id=?5",
                params![input.rights_status.trim(), asset_status_for_rights(input.rights_status.trim()), now_string(), input.project_id.trim(), asset_id],
            )
            .map_err(|error| format!("Không cập nhật được output asset {asset_id}: {error}"))?;
    }
    audit_event(
        &connection,
        Some(input.project_id.trim()),
        "asset_pack.item_review_updated",
        "asset_pack_item",
        input.asset_item_id.trim(),
    )?;
    let refreshed = list_asset_pack_reviews_with_connection(&connection, input.project_id.trim())?;
    refreshed
        .into_iter()
        .find(|view| view.pack_id == input.pack_id.trim())
        .ok_or_else(|| "Không đọc lại được Asset Pack sau khi lưu review".to_string())
}

fn validate_asset_pack_blender_shot_id(value: &str) -> bool {
    (3..=64).contains(&value.len())
        && value.chars().enumerate().all(|(index, character)| {
            character.is_ascii_uppercase()
                || character.is_ascii_digit()
                || (index > 0 && (character == '-' || character == '_'))
        })
        && value
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_uppercase() || character.is_ascii_digit())
}

fn asset_pack_blender_role(role: &str) -> Result<&'static str, String> {
    match role {
        "identity" => Ok("identity"),
        "composition" => Ok("composition"),
        "pose" => Ok("pose"),
        "camera" => Ok("camera"),
        "style" => Ok("style"),
        "environment" => Ok("environment"),
        "prop" | "scale_reference" => Ok("composition"),
        "start_frame" => Ok("start_frame"),
        "end_frame" => Ok("end_frame"),
        _ => Err(format!("Role Asset Pack không thể bind Blender: {role}")),
    }
}

fn asset_pack_blender_reference_kind(asset: Option<&AssetView>, path: &str) -> &'static str {
    match asset.map(|item| item.kind.as_str()).or_else(|| {
        Path::new(path)
            .extension()
            .and_then(|extension| extension.to_str())
    }) {
        Some("model3d") | Some("gltf") | Some("glb") | Some("obj") | Some("fbx") => "model3d",
        Some("texture") => "texture",
        Some("scene") | Some("blend") => "scene",
        _ => "reference_image",
    }
}

#[tauri::command]
pub(super) fn prepare_asset_pack_blender_binding(
    project_id: String,
    pack_id: String,
    state: State<'_, AppState>,
) -> Result<AssetPackBlenderBindingReport, String> {
    valid_text(&project_id, "Project ID")?;
    valid_text(&pack_id, "Pack ID")?;
    let project_id = project_id.trim().to_string();
    let pack_id = pack_id.trim().to_string();
    if !safe_preview_id(&project_id) || !safe_preview_id(&pack_id) {
        return Err("Project ID hoặc Pack ID không hợp lệ".to_string());
    }

    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    ensure_project_exists(&connection, &project_id)?;
    let workspace_root = project_workspace_root(&connection, &project_id)?;
    let packs = list_asset_pack_reviews_with_connection(&connection, &project_id)?;
    let pack_view = packs
        .into_iter()
        .find(|pack| pack.pack_id == pack_id)
        .ok_or_else(|| "Không tìm thấy Asset Pack đã đăng ký".to_string())?;
    let pack_path = asset_pack_json_path(
        &workspace_root,
        &pack_view.source.pack_relative_path,
        "asset-pack.json",
    )?;
    let items_path = asset_pack_json_path(
        &workspace_root,
        &pack_view.source.items_relative_path,
        "asset-items.json",
    )?;
    let pack_document = read_asset_pack_json(&pack_path, "asset-pack.json")?;
    let items_document = read_asset_pack_json(&items_path, "asset-items.json")?;
    if json_string(&pack_document, "projectId") != project_id
        || json_string(&pack_document, "packId") != pack_id
    {
        return Err("Asset Pack không khớp project hoặc packId".to_string());
    }
    let raw_items = items_document
        .get("items")
        .and_then(Value::as_array)
        .ok_or_else(|| "asset-items.json thiếu mảng items".to_string())?;
    let identity_anchor_ids = pack_document
        .get("identityAnchors")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let raw_by_item_id: HashMap<String, &Value> = raw_items
        .iter()
        .filter_map(|item| {
            let item_id = json_string(item, "assetItemId");
            (!item_id.is_empty()).then_some((item_id, item))
        })
        .collect();
    let required_roles = pack_document
        .get("acceptancePolicy")
        .and_then(|policy| policy.get("requiredRoles"))
        .and_then(Value::as_array)
        .map(|roles| {
            roles
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut blockers = Vec::new();
    let allowed_rights = ["personal", "owned", "licensed", "public_domain"];
    let mut approved_reference_hashes = Vec::new();
    let mut shot_ids = Vec::new();
    let mut asset_bindings = Vec::new();
    let mut required_views = Vec::new();
    let mut continuity_anchors = Vec::new();
    let mut scale_values = Vec::new();
    let binding_id = now_id("asset-pack-binding");

    for required_role in &required_roles {
        if !pack_view
            .items
            .iter()
            .any(|item| item.role == *required_role && item.review_state == "approved")
        {
            blockers.push(format!(
                "Thiếu item approved cho role bắt buộc {required_role}"
            ));
        }
    }

    for item in &pack_view.items {
        if item.review_state != "approved" {
            blockers.push(format!("Item {} chưa approved", item.asset_item_id));
            continue;
        }
        if !allowed_rights.contains(&item.rights_status.as_str()) {
            blockers.push(format!(
                "Item {} có quyền {} không đủ để bind",
                item.asset_item_id, item.rights_status
            ));
        }
        let role = match asset_pack_blender_role(&item.role) {
            Ok(role) => role,
            Err(error) => {
                blockers.push(error);
                continue;
            }
        };
        if item.shot_ids.is_empty() {
            blockers.push(format!("Item {} chưa có shot ID", item.asset_item_id));
        }
        for shot_id in &item.shot_ids {
            if !validate_asset_pack_blender_shot_id(shot_id) {
                blockers.push(format!(
                    "Shot ID {} của item {} không hợp lệ",
                    shot_id, item.asset_item_id
                ));
            } else if !shot_ids.contains(shot_id) {
                shot_ids.push(shot_id.clone());
            }
        }
        if item.role == "identity" {
            if item.identity_anchor_id.is_none()
                || !item
                    .identity_anchor_id
                    .as_ref()
                    .is_some_and(|anchor| identity_anchor_ids.contains(anchor))
            {
                blockers.push(format!(
                    "Identity item {} thiếu anchor đã đăng ký",
                    item.asset_item_id
                ));
            }
        }
        if item.role == "scale_reference" {
            match item.scale_meters {
                Some(scale) if scale > 0.0 && scale <= 1000.0 => scale_values.push(scale),
                _ => blockers.push(format!(
                    "Scale reference {} thiếu scaleMeters hợp lệ",
                    item.asset_item_id
                )),
            }
        }

        let raw_item = raw_by_item_id.get(&item.asset_item_id).copied();
        let item_continuity = raw_item
            .and_then(|value| value.get("continuityAnchors"))
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let item_views = raw_item
            .and_then(|value| value.get("requiredViews"))
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_else(|| item.required_views.clone());
        for view in item_views {
            if !required_views.contains(&view) {
                required_views.push(view);
            }
        }
        for anchor in &item_continuity {
            if !continuity_anchors.contains(anchor) {
                continuity_anchors.push(anchor.clone());
            }
        }
        if item_continuity.is_empty() {
            blockers.push(format!(
                "Item {} thiếu continuityAnchors",
                item.asset_item_id
            ));
        }

        let asset = item.output_assets.first();
        let source_path = asset
            .map(|value| value.relative_path.clone())
            .or_else(|| item.output_paths.first().cloned());
        let asset_id = asset
            .map(|value| value.asset_id.clone())
            .or_else(|| item.output_asset_ids.first().cloned());
        let (source_path, asset_id) = match (source_path, asset_id) {
            (Some(path), Some(asset_id)) => (path, asset_id),
            _ => {
                blockers.push(format!(
                    "Item {} chưa có output asset/path",
                    item.asset_item_id
                ));
                continue;
            }
        };
        if !safe_preview_id(&asset_id) {
            blockers.push(format!("Output asset ID {} không hợp lệ", asset_id));
            continue;
        }
        let source_file = match asset_pack_json_path(&workspace_root, &source_path, "output asset")
        {
            Ok(path) => path,
            Err(error) => {
                blockers.push(format!("Item {}: {error}", item.asset_item_id));
                continue;
            }
        };
        let actual_hash = match sha256_file(&source_file) {
            Ok(hash) => hash,
            Err(error) => {
                blockers.push(format!(
                    "Không hash được output {}: {error}",
                    item.asset_item_id
                ));
                continue;
            }
        };
        if let Some(asset_view) = asset {
            if asset_view.status != "ready" {
                blockers.push(format!(
                    "Output asset {} chưa ở trạng thái ready",
                    asset_view.asset_id
                ));
            }
            if asset_view.sha256 != actual_hash {
                blockers.push(format!(
                    "Hash output {} không khớp Asset Library",
                    asset_view.asset_id
                ));
            }
        }
        if !approved_reference_hashes.contains(&actual_hash) {
            approved_reference_hashes.push(actual_hash.clone());
        }
        let source_path = workspace_relative_path(&workspace_root, &source_file)?;
        let reference_kind = asset_pack_blender_reference_kind(asset, &source_path);
        for shot_id in &item.shot_ids {
            let shot_suffix = shot_id.to_ascii_lowercase().replace('_', "-");
            let item_binding_id = format!("{}-{}-{}", binding_id, item.asset_item_id, shot_suffix);
            if item_binding_id.len() > 120 {
                blockers.push(format!(
                    "Binding ID của item {} / {} quá dài",
                    item.asset_item_id, shot_id
                ));
                continue;
            }
            asset_bindings.push(serde_json::json!({
                "bindingId": item_binding_id,
                "assetId": asset_id,
                "assetItemId": item.asset_item_id,
                "shotId": shot_id,
                "sourceRole": item.role,
                "role": role,
                "sourcePath": source_path,
                "assetSha256": actual_hash,
                "referenceKind": reference_kind,
                "identityAnchorId": item.identity_anchor_id,
                "scaleMeters": item.scale_meters,
                "continuityAnchors": item_continuity,
                "rightsStatus": item.rights_status,
                "reviewState": "approved",
                "locked": true,
            }));
        }
    }

    if scale_values.is_empty() {
        blockers.push("Blender binding bắt buộc có một scale reference approved".to_string());
    } else if scale_values
        .iter()
        .any(|value| (value - scale_values[0]).abs() > 0.001)
    {
        blockers.push("Các scale reference approved không đồng nhất".to_string());
    }
    if required_views.is_empty() {
        blockers.push("Binding thiếu requiredViews để giữ camera continuity".to_string());
    }
    if continuity_anchors.is_empty() {
        blockers.push("Binding thiếu continuity anchors".to_string());
    }
    if shot_ids.is_empty() {
        blockers.push("Asset Pack chưa có shot nào để dựng Blender".to_string());
    }
    let world_scale_meters = scale_values.first().copied();
    let output_root = workspace_root
        .join(".auto3dvideo")
        .join("runs")
        .join(&binding_id);
    if output_root.exists() {
        return Err("Binding ID đã tồn tại; từ chối ghi đè output".to_string());
    }
    fs::create_dir_all(&output_root)
        .map_err(|error| format!("Không tạo được binding run directory: {error}"))?;
    let relative = |path: &Path| -> Result<String, String> {
        path.strip_prefix(&workspace_root)
            .map_err(|_| "Blender binding output vượt project workspace".to_string())
            .map(|value| value.to_string_lossy().replace('\\', "/"))
    };
    let report_path = output_root.join("binding-report.json");
    let binding_path = output_root.join("asset-pack-blender-binding.json");
    let job_path = output_root.join("blender-job.json");
    let worker_path = output_root.join("blender_asset_binding_worker.py");
    let binding_relative = relative(&binding_path)?;
    let job_relative = relative(&job_path)?;
    let worker_relative = relative(&worker_path)?;
    let render_root = format!("outputs/blender/{binding_id}/render");
    let job = serde_json::json!({
        "schemaVersion": "1.0.0",
        "jobType": "scene.build",
        "scenePath": format!("outputs/blender/{binding_id}/scene.blend"),
        "scriptPath": worker_relative,
        "outputDirectory": render_root,
        "executionMode": "preview",
        "timeoutSeconds": 900,
        "allowNetwork": false,
        "expectedOutputKind": "image_sequence",
    });
    let status = if blockers.is_empty() {
        "ready_for_blender_review"
    } else {
        "blocked"
    };
    let report = AssetPackBlenderBindingReport {
        schema_version: "1.0.0".to_string(),
        binding_id: binding_id.clone(),
        project_id: project_id.clone(),
        pack_id: pack_id.clone(),
        status: status.to_string(),
        binding_path: if blockers.is_empty() {
            Some(binding_relative.clone())
        } else {
            None
        },
        job_path: if blockers.is_empty() {
            Some(job_relative.clone())
        } else {
            None
        },
        asset_count: asset_bindings.len(),
        shot_ids: shot_ids.clone(),
        world_scale_meters,
        approved_reference_hashes: approved_reference_hashes.clone(),
        blockers: blockers.clone(),
        blender_execution_started: false,
        human_review_required: true,
        message: if blockers.is_empty() {
            "Đã chuẩn bị binding và Blender preview job; bấm Chạy Blender preview để chạy worker local có giới hạn.".to_string()
        } else {
            "Binding bị chặn; chưa ghi Blender job vì Asset Pack chưa đạt gate.".to_string()
        },
    };
    let report_value = serde_json::to_value(&report).map_err(|error| error.to_string())?;
    fs::write(
        &report_path,
        serde_json::to_vec_pretty(&report_value).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Không ghi được binding report: {error}"))?;
    if blockers.is_empty() {
        let binding = serde_json::json!({
            "schemaVersion": "1.0.0",
            "bindingId": binding_id,
            "projectId": project_id,
            "packId": pack_id,
            "status": status,
            "identityAnchorIds": identity_anchor_ids,
            "assetBindings": asset_bindings,
            "worldScaleMeters": world_scale_meters.ok_or_else(|| "Thiếu world scale".to_string())?,
            "cameraContinuity": {
                "policy": "preserve_pack_views_and_anchors",
                "requiredViews": required_views,
                "continuityAnchors": continuity_anchors,
            },
            "screenDirection": "unspecified",
            "materialPalette": [json_string(&pack_document.get("bibleVersions").cloned().unwrap_or(Value::Null), "style")],
            "approvedReferenceHashes": approved_reference_hashes,
            "blenderJob": job,
            "humanReviewRequired": true,
            "blenderExecutionStarted": false,
        });
        fs::write(
            &binding_path,
            serde_json::to_vec_pretty(&binding).map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("Không ghi được Blender binding: {error}"))?;
        fs::write(
            &job_path,
            serde_json::to_vec_pretty(&binding.get("blenderJob").cloned().unwrap_or(Value::Null))
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("Không ghi được Blender job: {error}"))?;
        fs::write(&worker_path, BLENDER_ASSET_BINDING_WORKER_SCRIPT)
            .map_err(|error| format!("Không ghi được Blender binding worker: {error}"))?;
    }
    audit_event(
        &connection,
        Some(project_id.as_str()),
        if blockers.is_empty() {
            "asset_pack.blender_binding_prepared"
        } else {
            "asset_pack.blender_binding_blocked"
        },
        "asset_pack_blender_binding",
        &binding_id,
    )?;
    Ok(report)
}

#[tauri::command]
pub(super) async fn run_asset_pack_blender_binding(
    project_id: String,
    binding_id: String,
    state: State<'_, AppState>,
) -> Result<AssetPackBlenderBindingRunReport, String> {
    valid_text(&project_id, "Project ID")?;
    valid_text(&binding_id, "Binding ID")?;
    let project_id = project_id.trim().to_string();
    let binding_id = binding_id.trim().to_string();
    if !safe_preview_id(&project_id) || !safe_preview_id(&binding_id) {
        return Err("Project ID hoặc Binding ID không hợp lệ".to_string());
    }

    let (workspace_root, blender_path) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        ensure_project_exists(&connection, &project_id)?;
        let workspace_root = fs::canonicalize(project_workspace_root(&connection, &project_id)?)
            .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?;
        let blender_path = resolve_configured_tool(&connection, "blender")?;
        (workspace_root, blender_path)
    };

    let run_relative = format!(".auto3dvideo/runs/{binding_id}");
    let run_root = workspace_root.join(&run_relative);
    let run_root_canonical = fs::canonicalize(&run_root)
        .map_err(|error| format!("Không tìm thấy binding run đã chuẩn bị: {error}"))?;
    if !run_root_canonical.starts_with(&workspace_root) || !run_root_canonical.is_dir() {
        return Err("Binding run không nằm trong project workspace".to_string());
    }
    let binding_relative = format!("{run_relative}/asset-pack-blender-binding.json");
    let job_relative = format!("{run_relative}/blender-job.json");
    let worker_relative = format!("{run_relative}/blender_asset_binding_worker.py");
    let binding_path = workspace_root.join(&binding_relative);
    let job_path = workspace_root.join(&job_relative);
    let worker_path = workspace_root.join(&worker_relative);
    let binding = read_asset_pack_json(&binding_path, "asset-pack-blender-binding.json")?;
    let job = read_asset_pack_json(&job_path, "blender-job.json")?;
    if json_string(&binding, "schemaVersion") != "1.0.0"
        || json_string(&binding, "bindingId") != binding_id
        || json_string(&binding, "projectId") != project_id
        || json_string(&binding, "status") != "ready_for_blender_review"
        || binding.get("humanReviewRequired") != Some(&Value::Bool(true))
        || binding.get("blenderExecutionStarted") != Some(&Value::Bool(false))
    {
        return Err(
            "Binding không còn ở trạng thái ready_for_blender_review an toàn để chạy".to_string(),
        );
    }
    let asset_bindings = binding
        .get("assetBindings")
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty())
        .ok_or_else(|| "Binding thiếu assetBindings".to_string())?;

    let job_type = json_string(&job, "jobType");
    let execution_mode = json_string(&job, "executionMode");
    let script_relative = validate_attempt_output_path(&json_string(&job, "scriptPath"))?;
    let scene_relative = validate_attempt_output_path(&json_string(&job, "scenePath"))?;
    let output_relative = validate_attempt_output_path(&json_string(&job, "outputDirectory"))?;
    let timeout_seconds = job
        .get("timeoutSeconds")
        .and_then(Value::as_u64)
        .ok_or_else(|| "Blender job thiếu timeoutSeconds hợp lệ".to_string())?;
    if job_type != "scene.build"
        || execution_mode != "preview"
        || job.get("allowNetwork") != Some(&Value::Bool(false))
        || json_string(&job, "expectedOutputKind") != "image_sequence"
        || !(1..=3600).contains(&timeout_seconds)
    {
        return Err("Blender job không đúng policy preview local (scene.build, preview, no-network, timeout tối đa 1 giờ)".to_string());
    }
    let expected_worker_prefix = format!("{run_relative}/");
    if script_relative != worker_relative || !script_relative.starts_with(&expected_worker_prefix) {
        return Err(
            "Blender script không phải worker đã được app version hóa trong binding run"
                .to_string(),
        );
    }
    let canonical_worker = fs::canonicalize(&worker_path)
        .map_err(|error| format!("Không xác nhận được Blender worker: {error}"))?;
    if !canonical_worker.starts_with(&run_root_canonical) || !canonical_worker.is_file() {
        return Err("Blender worker không nằm trong binding run hoặc không phải file".to_string());
    }
    if scene_relative != format!("outputs/blender/{binding_id}/scene.blend")
        || output_relative != format!("outputs/blender/{binding_id}/render")
    {
        return Err("Blender output không khớp thư mục output versioned của binding".to_string());
    }
    let output_root = workspace_root.join(&output_relative);
    if output_root.exists() {
        return Err(
            "Binding này đã có output; tạo binding mới trước khi chạy lại để tránh ghi đè"
                .to_string(),
        );
    }
    let report_relative = Path::new(&output_relative)
        .parent()
        .ok_or_else(|| "Output directory Blender không có parent hợp lệ".to_string())?
        .join("binding-preview-report.json")
        .to_string_lossy()
        .replace('\\', "/");
    let report_path = workspace_root.join(&report_relative);
    let mut shot_ids = Vec::new();
    let mut expected_outputs = vec![scene_relative.clone(), report_relative.clone()];
    for item in asset_bindings {
        let item_object = item
            .as_object()
            .ok_or_else(|| "assetBindings phải là object".to_string())?;
        if item_object.get("reviewState") != Some(&Value::String("approved".to_string()))
            || item_object.get("locked") != Some(&Value::Bool(true))
        {
            return Err("Binding chứa asset chưa approved/locked".to_string());
        }
        let shot_id = item_object
            .get("shotId")
            .and_then(Value::as_str)
            .ok_or_else(|| "Binding item thiếu shotId".to_string())?;
        if !validate_asset_pack_blender_shot_id(shot_id) {
            return Err(format!("Shot ID không hợp lệ trong binding: {shot_id}"));
        }
        let source_path = validate_attempt_output_path(
            item_object
                .get("sourcePath")
                .and_then(Value::as_str)
                .ok_or_else(|| format!("Binding item {shot_id} thiếu sourcePath"))?,
        )?;
        let source_file = workspace_root.join(&source_path);
        let source_canonical = fs::canonicalize(&source_file)
            .map_err(|error| format!("Không xác nhận source asset {source_path}: {error}"))?;
        if !source_canonical.starts_with(&workspace_root)
            || !source_canonical.is_file()
            || fs::metadata(&source_canonical)
                .map_err(|error| format!("Không đọc được source asset {source_path}: {error}"))?
                .len()
                == 0
        {
            return Err(format!(
                "Source asset không nằm trong workspace hoặc rỗng: {source_path}"
            ));
        }
        if !shot_ids.iter().any(|existing| existing == shot_id) {
            shot_ids.push(shot_id.to_string());
            expected_outputs.push(format!("{output_relative}/{shot_id}/frame-0001.png"));
        }
    }
    if shot_ids.is_empty() {
        return Err("Binding không có shot để render preview".to_string());
    }
    if binding_path.parent() != Some(run_root.as_path())
        || job_path.parent() != Some(run_root.as_path())
    {
        return Err("Binding/job path không nằm đúng binding run".to_string());
    }

    let binding_argument = binding_relative.clone();
    let process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "blender".to_string(),
            args: vec![
                "--background".to_string(),
                "--factory-startup".to_string(),
                "--python".to_string(),
                script_relative,
                "--".to_string(),
                "--workspace".to_string(),
                workspace_root.to_string_lossy().to_string(),
                "--binding".to_string(),
                binding_argument,
                "--output-dir".to_string(),
                output_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: Default::default(),
            timeout_seconds,
            expected_outputs,
        },
        executable_path: blender_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    if !process.succeeded {
        let detail = if process.stderr.trim().is_empty() {
            process.stdout.trim()
        } else {
            process.stderr.trim()
        };
        return Err(format!(
            "Blender preview thất bại (exit {:?}, timeout={}): {}",
            process.exit_code,
            process.timed_out,
            detail.chars().take(600).collect::<String>()
        ));
    }
    let preview_report = read_asset_pack_json(&report_path, "binding-preview-report.json")?;
    if json_string(&preview_report, "bindingId") != binding_id
        || json_string(&preview_report, "status") != "succeeded_needs_review"
        || preview_report.get("reviewState") != Some(&Value::String("needs_review".to_string()))
        || preview_report.get("referenceOnly") != Some(&Value::Bool(true))
    {
        return Err(
            "Blender worker trả report không đúng trạng thái reference-only cần review".to_string(),
        );
    }
    let preview_outputs = json_string_vec(&preview_report, "previewOutputs");
    if preview_outputs.is_empty() {
        return Err("Blender worker không trả preview output".to_string());
    }
    for preview_output in &preview_outputs {
        let preview_output = validate_attempt_output_path(preview_output)?;
        if !preview_output.starts_with(&format!("{output_relative}/")) {
            return Err(format!(
                "Preview output vượt output directory: {preview_output}"
            ));
        }
        let preview_path = workspace_root.join(&preview_output);
        let metadata = fs::metadata(&preview_path)
            .map_err(|error| format!("Không đọc được preview output {preview_output}: {error}"))?;
        if !metadata.is_file() || metadata.len() == 0 {
            return Err(format!(
                "Preview output rỗng hoặc không phải file: {preview_output}"
            ));
        }
    }
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database sau khi chạy Blender".to_string())?;
    audit_event(
        &connection,
        Some(project_id.as_str()),
        "asset_pack.blender_binding_preview_succeeded",
        "asset_pack_blender_binding",
        &binding_id,
    )?;
    Ok(AssetPackBlenderBindingRunReport {
        binding_id,
        status: "succeeded_needs_review".to_string(),
        scene_path: scene_relative,
        preview_outputs,
        report_path: report_relative,
        process,
        message: "Đã chạy Blender reference preview; output chỉ để review binding, chưa phải video final.".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::validate_asset_pack_review_checks;
    use serde_json::json;

    #[test]
    fn acceptance_check_limit_allows_64_and_rejects_65() {
        let valid_check = json!({"checkId": "check-001", "status": "pending"});
        assert!(validate_asset_pack_review_checks(&vec![valid_check.clone(); 64]).is_ok());
        assert!(validate_asset_pack_review_checks(&vec![valid_check; 65]).is_err());
    }
}
