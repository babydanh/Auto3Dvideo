use super::tool_readiness::resolve_configured_tool;
use super::*;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct AssetView {
    pub(super) schema_version: String,
    pub(super) asset_id: String,
    pub(super) project_id: String,
    pub(super) title: String,
    pub(super) relative_path: String,
    pub(super) sha256: String,
    pub(super) kind: String,
    pub(super) mime_type: String,
    pub(super) size_bytes: i64,
    pub(super) width: Option<i64>,
    pub(super) height: Option<i64>,
    pub(super) duration_seconds: Option<f64>,
    pub(super) status: String,
    pub(super) rights_status: String,
    pub(super) source_uri: Option<String>,
    pub(super) tags: Vec<String>,
    pub(super) note: String,
    pub(super) created_at: String,
    pub(super) updated_at: String,
    pub(super) archived_at: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct AssetImportInput {
    pub(super) project_id: String,
    pub(super) source_path: String,
    pub(super) title: String,
    pub(super) media_kind: String,
    pub(super) source_uri: Option<String>,
    pub(super) tags: Vec<String>,
    pub(super) note: String,
    pub(super) rights_status: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReferenceVideoDownloadRequest {
    project_id: String,
    source_url: String,
    #[serde(default)]
    download_url: Option<String>,
    title: String,
    rights_status: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReferenceVideoDownloadReport {
    download_id: String,
    status: String,
    project_id: String,
    source_url: String,
    source_host: String,
    relative_path: Option<String>,
    asset: Option<AssetView>,
    size_bytes: Option<u64>,
    sha256: Option<String>,
    rights_status: String,
    watermark_status: String,
    network_calls_made: bool,
    cost_status: String,
    human_review_required: bool,
    message: String,
    process: Option<ExternalProcessResult>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct AssetMetadataInput {
    project_id: String,
    asset_id: String,
    title: String,
    source_uri: Option<String>,
    tags: Vec<String>,
    note: String,
    rights_status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReferenceAssignmentView {
    pub(super) assignment_id: String,
    pub(super) project_id: String,
    pub(super) reference_set_id: String,
    pub(super) asset_id: String,
    pub(super) role: String,
    pub(super) strength: f64,
    pub(super) priority: i64,
    pub(super) shot_id: Option<String>,
    pub(super) shot_range_start: Option<i64>,
    pub(super) shot_range_end: Option<i64>,
    pub(super) crop: Option<String>,
    pub(super) notes: String,
    pub(super) approved: bool,
    pub(super) asset_sha256: String,
    pub(super) created_at: String,
    pub(super) updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReferenceSetView {
    pub(super) schema_version: String,
    pub(super) reference_set_id: String,
    pub(super) project_id: String,
    pub(super) name: String,
    pub(super) scope: String,
    pub(super) status: String,
    pub(super) continuity_note: String,
    pub(super) assignments: Vec<ReferenceAssignmentView>,
    pub(super) created_at: String,
    pub(super) updated_at: String,
    pub(super) archived_at: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReferenceSetInput {
    pub(super) project_id: String,
    pub(super) name: String,
    pub(super) scope: String,
    pub(super) continuity_note: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReferenceAssignmentInput {
    pub(super) project_id: String,
    pub(super) reference_set_id: String,
    pub(super) asset_id: String,
    pub(super) role: String,
    pub(super) strength: f64,
    pub(super) priority: i64,
    pub(super) shot_id: Option<String>,
    pub(super) shot_range_start: Option<i64>,
    pub(super) shot_range_end: Option<i64>,
    pub(super) crop: Option<String>,
    pub(super) notes: String,
    pub(super) approved: bool,
}

pub(super) fn validate_asset_kind(value: &str) -> Result<(), String> {
    if !matches!(
        value,
        "image"
            | "video"
            | "audio"
            | "model3d"
            | "scene"
            | "texture"
            | "sketch"
            | "render"
            | "subtitle"
            | "proxy"
            | "document"
    ) {
        return Err("Asset kind không được hỗ trợ".to_string());
    }
    Ok(())
}

pub(super) fn validate_asset_rights(value: &str) -> Result<(), String> {
    if !matches!(
        value,
        "unknown"
            | "pending"
            | "personal"
            | "owned"
            | "licensed"
            | "public_domain"
            | "restricted"
            | "rejected"
    ) {
        return Err("Trạng thái quyền asset không hợp lệ".to_string());
    }
    Ok(())
}

pub(super) fn validate_reference_role(value: &str) -> Result<(), String> {
    if !matches!(
        value,
        "identity"
            | "composition"
            | "pose"
            | "camera"
            | "style"
            | "start_frame"
            | "end_frame"
            | "negative"
    ) {
        return Err("Vai trò reference không hợp lệ".to_string());
    }
    Ok(())
}

pub(super) fn validate_reference_scope(value: &str) -> Result<(), String> {
    if !matches!(
        value,
        "sequence" | "character" | "object" | "world" | "shot"
    ) {
        return Err("Phạm vi reference set không hợp lệ".to_string());
    }
    Ok(())
}

fn validate_asset_tags(tags: &[String]) -> Result<(), String> {
    if tags.len() > 24 {
        return Err("Asset chỉ được có tối đa 24 tag".to_string());
    }
    for tag in tags {
        valid_text(tag, "Asset tag")?;
        if tag.chars().count() > 64 || preview_secret_like(tag) {
            return Err("Asset tag không hợp lệ hoặc có dấu hiệu secret".to_string());
        }
    }
    Ok(())
}

pub(super) fn validate_asset_text(value: &str, field: &str, max_len: usize) -> Result<(), String> {
    valid_text(value, field)?;
    if value.chars().count() > max_len || value.contains(['\r', '\n']) || preview_secret_like(value)
    {
        return Err(format!("{field} không hợp lệ hoặc có dấu hiệu secret"));
    }
    Ok(())
}

pub(super) fn mime_for_asset_path(path: &Path, media_kind: &str) -> Result<String, String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mime = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "ogg" => "audio/ogg",
        "glb" => "model/gltf-binary",
        "gltf" => "model/gltf+json",
        "obj" => "model/obj",
        "fbx" => "application/octet-stream",
        "blend" => "application/x-blender",
        "srt" => "application/x-subrip",
        "vtt" => "text/vtt",
        "ass" => "text/x-ass",
        "pdf" => "application/pdf",
        "txt" => "text/plain",
        "md" => "text/markdown",
        "json" => "application/json",
        _ => return Err("File asset phải có phần mở rộng được hỗ trợ".to_string()),
    };
    let compatible = match media_kind {
        "image" | "texture" | "sketch" => mime.starts_with("image/"),
        "video" | "proxy" => mime.starts_with("video/"),
        "audio" => mime.starts_with("audio/"),
        "model3d" | "scene" => {
            mime.starts_with("model/")
                || mime == "application/octet-stream"
                || mime == "application/x-blender"
        }
        "render" => mime.starts_with("image/") || mime.starts_with("video/"),
        "subtitle" => mime.starts_with("text/") || mime == "application/x-subrip",
        "document" => {
            mime == "application/pdf" || mime.starts_with("text/") || mime == "application/json"
        }
        _ => false,
    };
    if !compatible {
        return Err(format!("File không khớp loại asset {media_kind}"));
    }
    Ok(mime.to_string())
}

pub(super) fn asset_status_for_rights(rights_status: &str) -> &'static str {
    match rights_status {
        "personal" | "owned" | "licensed" | "public_domain" => "ready",
        _ => "quarantined",
    }
}

fn asset_select_sql() -> &'static str {
    "SELECT asset_id, project_id, title, relative_path, sha256, media_kind, mime_type, size_bytes, width, height, duration_seconds, status, rights_status, source_uri, tags_json, note, created_at, updated_at, archived_at FROM asset_library"
}

struct AssetDbRow {
    asset_id: String,
    project_id: String,
    title: String,
    relative_path: String,
    sha256: String,
    media_kind: String,
    mime_type: String,
    size_bytes: i64,
    width: Option<i64>,
    height: Option<i64>,
    duration_seconds: Option<f64>,
    status: String,
    rights_status: String,
    source_uri: Option<String>,
    tags_json: String,
    note: String,
    created_at: String,
    updated_at: String,
    archived_at: Option<String>,
}

fn asset_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AssetDbRow> {
    Ok(AssetDbRow {
        asset_id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        relative_path: row.get(3)?,
        sha256: row.get(4)?,
        media_kind: row.get(5)?,
        mime_type: row.get(6)?,
        size_bytes: row.get(7)?,
        width: row.get(8)?,
        height: row.get(9)?,
        duration_seconds: row.get(10)?,
        status: row.get(11)?,
        rights_status: row.get(12)?,
        source_uri: row.get(13)?,
        tags_json: row.get(14)?,
        note: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
        archived_at: row.get(18)?,
    })
}

fn decode_asset(row: AssetDbRow) -> Result<AssetView, String> {
    let tags = serde_json::from_str::<Vec<String>>(&row.tags_json)
        .map_err(|error| format!("Asset có tags hỏng: {error}"))?;
    Ok(AssetView {
        schema_version: "1.0.0".to_string(),
        asset_id: row.asset_id,
        project_id: row.project_id,
        title: row.title,
        relative_path: row.relative_path,
        sha256: row.sha256,
        kind: row.media_kind,
        mime_type: row.mime_type,
        size_bytes: row.size_bytes,
        width: row.width,
        height: row.height,
        duration_seconds: row.duration_seconds,
        status: row.status,
        rights_status: row.rights_status,
        source_uri: row.source_uri,
        tags,
        note: row.note,
        created_at: row.created_at,
        updated_at: row.updated_at,
        archived_at: row.archived_at,
    })
}

pub(super) fn fetch_asset(connection: &Connection, asset_id: &str) -> Result<AssetView, String> {
    let sql = format!("{} WHERE asset_id = ?1", asset_select_sql());
    let row = connection
        .query_row(&sql, params![asset_id], asset_row)
        .map_err(|error| format!("Không đọc được asset: {error}"))?;
    decode_asset(row)
}

fn reference_assignment_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReferenceAssignmentView> {
    Ok(ReferenceAssignmentView {
        assignment_id: row.get(0)?,
        project_id: row.get(1)?,
        reference_set_id: row.get(2)?,
        asset_id: row.get(3)?,
        role: row.get(4)?,
        strength: row.get(5)?,
        priority: row.get(6)?,
        shot_id: row.get(7)?,
        shot_range_start: row.get(8)?,
        shot_range_end: row.get(9)?,
        crop: row.get(10)?,
        notes: row.get(11)?,
        approved: row.get::<_, i64>(12)? == 1,
        asset_sha256: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

fn reference_assignments(
    connection: &Connection,
    reference_set_id: &str,
) -> Result<Vec<ReferenceAssignmentView>, String> {
    let mut statement = connection
        .prepare("SELECT assignment_id, project_id, reference_set_id, asset_id, role, strength, priority, shot_id, shot_range_start, shot_range_end, crop, notes, approved, asset_sha256, created_at, updated_at FROM reference_set_assignments WHERE reference_set_id = ?1 ORDER BY priority DESC, created_at ASC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![reference_set_id], reference_assignment_row)
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub(super) fn fetch_reference_set(
    connection: &Connection,
    reference_set_id: &str,
) -> Result<ReferenceSetView, String> {
    let base = connection
        .query_row(
            "SELECT reference_set_id, project_id, name, scope, status, continuity_note, created_at, updated_at, archived_at FROM reference_sets WHERE reference_set_id = ?1",
            params![reference_set_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, Option<String>>(8)?,
                ))
            },
        )
        .map_err(|error| format!("Không đọc được reference set: {error}"))?;
    Ok(ReferenceSetView {
        schema_version: "1.0.0".to_string(),
        reference_set_id: base.0.clone(),
        project_id: base.1,
        name: base.2,
        scope: base.3,
        status: base.4,
        continuity_note: base.5,
        assignments: reference_assignments(connection, &base.0)?,
        created_at: base.6,
        updated_at: base.7,
        archived_at: base.8,
    })
}

fn validate_asset_import(input: &AssetImportInput) -> Result<(), String> {
    valid_text(&input.project_id, "Project ID")?;
    valid_text(&input.source_path, "Đường dẫn asset")?;
    validate_asset_kind(input.media_kind.trim())?;
    validate_asset_rights(input.rights_status.trim())?;
    validate_asset_tags(&input.tags)?;
    if input.note.chars().count() > 4000 || preview_secret_like(&input.note) {
        return Err("Ghi chú asset không hợp lệ".to_string());
    }
    if let Some(source_uri) = &input.source_uri {
        if source_uri.chars().count() > 2000
            || source_uri.contains(['\r', '\n'])
            || preview_secret_like(source_uri)
        {
            return Err("Source URI asset không hợp lệ".to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub(super) fn list_assets(
    project_id: String,
    include_archived: bool,
    state: State<'_, AppState>,
) -> Result<Vec<AssetView>, String> {
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
    let sql = format!(
        "{} WHERE project_id = ?1{} ORDER BY updated_at DESC",
        asset_select_sql(),
        suffix
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![project_id.trim()], asset_row)
        .map_err(|error| error.to_string())?;
    rows.map(|row| {
        row.map_err(|error| error.to_string())
            .and_then(decode_asset)
    })
    .collect()
}

pub(super) fn import_asset_with_state(
    input: AssetImportInput,
    state: &AppState,
) -> Result<AssetView, String> {
    validate_asset_import(&input)?;
    let project_id = input.project_id.trim();
    let source = fs::canonicalize(Path::new(input.source_path.trim()))
        .map_err(|error| format!("Không đọc được file asset: {error}"))?;
    if !source.is_file() {
        return Err("Asset phải là file, không phải thư mục".to_string());
    }
    let metadata =
        fs::metadata(&source).map_err(|error| format!("Không đọc được metadata asset: {error}"))?;
    if metadata.len() == 0 || metadata.len() > 2_u64 * 1024 * 1024 * 1024 {
        return Err("Asset phải lớn hơn 0 và không vượt quá 2 GB".to_string());
    }
    let mime_type = mime_for_asset_path(&source, input.media_kind.trim())?;
    let sha256 = sha256_file(&source)?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    ensure_project_exists(&connection, project_id)?;
    if let Some(existing_id) = connection
        .query_row(
            "SELECT asset_id FROM asset_library WHERE project_id = ?1 AND sha256 = ?2 ORDER BY updated_at DESC LIMIT 1",
            params![project_id, sha256],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
    {
        audit_event(&connection, Some(project_id), "asset.import_deduplicated", "asset", &existing_id)?;
        return fetch_asset(&connection, &existing_id);
    }
    let workspace_root = project_workspace_root(&connection, project_id)?;
    let asset_id = now_id("asset");
    let canonical_workspace =
        fs::canonicalize(&workspace_root).map_err(|error| error.to_string())?;
    let (target, relative_path) = if source.starts_with(&canonical_workspace) {
        let relative = source
            .strip_prefix(&canonical_workspace)
            .map_err(|_| "Không xác định được đường dẫn asset trong workspace".to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        (source.clone(), relative)
    } else {
        let extension = source
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("bin")
            .to_ascii_lowercase();
        let relative = format!("assets/references/{asset_id}.{extension}");
        let target = workspace_root.join(relative.replace('/', "\\"));
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Không tạo được thư mục asset: {error}"))?;
        }
        fs::copy(&source, &target)
            .map_err(|error| format!("Không chép được asset vào workspace: {error}"))?;
        (target, relative)
    };
    let final_metadata = fs::metadata(&target)
        .map_err(|error| format!("Không đọc được asset sau import: {error}"))?;
    let title = if input.title.trim().is_empty() {
        source
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("Asset")
            .to_string()
    } else {
        input.title.trim().to_string()
    };
    validate_asset_text(&title, "Tên asset", 160)?;
    let tags_json = serde_json::to_string(&input.tags).map_err(|error| error.to_string())?;
    let timestamp = now_string();
    let status = asset_status_for_rights(input.rights_status.trim());
    connection
        .execute(
            "INSERT INTO asset_library(asset_id, project_id, title, relative_path, sha256, media_kind, mime_type, size_bytes, width, height, duration_seconds, status, rights_status, source_uri, tags_json, note, created_at, updated_at, archived_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL, NULL, ?9, ?10, ?11, ?12, ?13, ?14, ?14, NULL)",
            params![asset_id, project_id, title, relative_path, sha256, input.media_kind.trim(), mime_type, final_metadata.len() as i64, status, input.rights_status.trim(), input.source_uri.as_deref().map(str::trim).filter(|value| !value.is_empty()), tags_json, input.note.trim(), timestamp],
        )
        .map_err(|error| format!("Không lưu được asset: {error}"))?;
    audit_event(
        &connection,
        Some(project_id),
        "asset.imported",
        "asset",
        &asset_id,
    )?;
    fetch_asset(&connection, &asset_id)
}

#[tauri::command]
pub(super) fn import_asset(
    input: AssetImportInput,
    state: State<'_, AppState>,
) -> Result<AssetView, String> {
    import_asset_with_state(input, &state)
}

pub(super) fn validate_reference_video_source_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.len() > 2000
        || trimmed.contains(['\r', '\n', '\0'])
        || !trimmed.starts_with("https://")
        || preview_secret_like(trimmed)
    {
        return Err(
            "URL video phải là HTTPS công khai và không chứa credential hoặc query bí mật"
                .to_string(),
        );
    }
    let authority = trimmed["https://".len()..]
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default();
    if authority.is_empty() || authority.contains('@') {
        return Err("URL video không có host hợp lệ hoặc chứa userinfo".to_string());
    }
    let host = authority
        .split(':')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
    const ALLOWED_HOSTS: [&str; 13] = [
        "tiktok.com",
        "douyin.com",
        "iesdouyin.com",
        "kuaishou.com",
        "xiaohongshu.com",
        "bilibili.com",
        "ixigua.com",
        "xigua.com",
        "huoshan.com",
        "weishi.qq.com",
        "haokan.baidu.com",
        "commons.wikimedia.org",
        "upload.wikimedia.org",
    ];
    if !ALLOWED_HOSTS
        .iter()
        .any(|allowed| host == *allowed || host.ends_with(&format!(".{allowed}")))
    {
        return Err(format!("Host video chưa được allowlist: {host}"));
    }
    Ok(host)
}

fn reference_video_download_report(
    download_id: &str,
    status: &str,
    project_id: &str,
    source_url: &str,
    source_host: &str,
    rights_status: &str,
    message: String,
    process: Option<ExternalProcessResult>,
    relative_path: Option<String>,
    asset: Option<AssetView>,
    size_bytes: Option<u64>,
    sha256: Option<String>,
    network_calls_made: bool,
) -> ReferenceVideoDownloadReport {
    ReferenceVideoDownloadReport {
        download_id: download_id.to_string(),
        status: status.to_string(),
        project_id: project_id.to_string(),
        source_url: source_url.to_string(),
        source_host: source_host.to_string(),
        relative_path,
        asset,
        size_bytes,
        sha256,
        rights_status: rights_status.to_string(),
        watermark_status: "needs_review".to_string(),
        network_calls_made,
        cost_status: "0; local worker".to_string(),
        human_review_required: true,
        message,
        process,
    }
}

#[tauri::command]
pub(super) async fn download_reference_video(
    request: ReferenceVideoDownloadRequest,
    state: State<'_, AppState>,
) -> Result<ReferenceVideoDownloadReport, String> {
    valid_text(&request.project_id, "Project ID")?;
    let project_id = request.project_id.trim();
    let rights_status = request.rights_status.trim();
    validate_asset_rights(rights_status)?;
    if !matches!(
        rights_status,
        "personal" | "owned" | "licensed" | "public_domain"
    ) {
        return Err(
            "Chỉ được tải khi quyền là personal, owned, licensed hoặc public_domain".to_string(),
        );
    }
    let source_url = request.source_url.trim().to_string();
    let source_host = validate_reference_video_source_url(&source_url)?;
    let download_url = request
        .download_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&source_url)
        .to_string();
    validate_reference_video_source_url(&download_url)?;
    let title = if request.title.trim().is_empty() {
        "Video tham khảo".to_string()
    } else {
        request.title.trim().to_string()
    };
    validate_asset_text(&title, "Tên video tham khảo", 160)?;
    let download_id = now_id("reference-video");

    let (workspace_root, ytdlp_path, ffmpeg_location) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        ensure_project_exists(&connection, project_id)?;
        let workspace_root = project_workspace_root(&connection, project_id)?;
        let ytdlp_path = match resolve_configured_tool(&connection, "yt-dlp") {
            Ok(path) => path,
            Err(error) => {
                return Ok(reference_video_download_report(
                    &download_id,
                    "blocked",
                    project_id,
                    &source_url,
                    &source_host,
                    rights_status,
                    format!(
                        "Chưa sẵn sàng tải video: {error}. Hãy cấu hình yt-dlp.exe trong Cài đặt."
                    ),
                    None,
                    None,
                    None,
                    None,
                    None,
                    false,
                ));
            }
        };
        let ffmpeg_location = match resolve_configured_tool(&connection, "ffmpeg") {
            Ok(path) => path
                .parent()
                .map(Path::to_path_buf)
                .ok_or_else(|| "FFmpeg không có thư mục executable hợp lệ".to_string()),
            Err(error) => Err(format!(
                "Chưa sẵn sàng chuẩn hóa MP4: {error}. Hãy cấu hình ffmpeg.exe trong Cài đặt."
            )),
        };
        let ffmpeg_location = match ffmpeg_location {
            Ok(path) => path,
            Err(error) => {
                return Ok(reference_video_download_report(
                    &download_id,
                    "blocked",
                    project_id,
                    &source_url,
                    &source_host,
                    rights_status,
                    error,
                    None,
                    None,
                    None,
                    None,
                    None,
                    false,
                ));
            }
        };
        (workspace_root, ytdlp_path, ffmpeg_location)
    };

    let relative_directory = "assets/reference-videos";
    let download_directory = workspace_root.join(relative_directory.replace('/', "\\"));
    fs::create_dir_all(&download_directory)
        .map_err(|error| format!("Không tạo được thư mục video tham khảo: {error}"))?;
    let download_directory = fs::canonicalize(&download_directory)
        .map_err(|error| format!("Không canonicalize được thư mục video tham khảo: {error}"))?;
    let file_name = format!("{download_id}.mp4");
    let relative_path = format!("{relative_directory}/{file_name}");
    let mut args = vec![
        "--no-playlist".to_string(),
        "--no-part".to_string(),
        "--no-overwrites".to_string(),
        "--no-warnings".to_string(),
        "--socket-timeout".to_string(),
        "20".to_string(),
        "--retries".to_string(),
        "2".to_string(),
        "--fragment-retries".to_string(),
        "2".to_string(),
        "--max-filesize".to_string(),
        "512M".to_string(),
        "--format".to_string(),
        "best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best".to_string(),
        "--merge-output-format".to_string(),
        "mp4".to_string(),
        "--recode-video".to_string(),
        "mp4".to_string(),
    ];
    args.extend([
        "--ffmpeg-location".to_string(),
        ffmpeg_location.to_string_lossy().to_string(),
    ]);
    args.extend(["--output".to_string(), file_name, download_url.clone()]);

    let process = match run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "yt-dlp".to_string(),
            args,
            working_directory: relative_directory.to_string(),
            environment: Default::default(),
            timeout_seconds: 300,
            expected_outputs: vec![relative_path.clone()],
        },
        executable_path: ytdlp_path,
        absolute_working_directory: download_directory,
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await
    {
        Ok(process) => process,
        Err(error) => {
            return Ok(reference_video_download_report(
                &download_id,
                "failed",
                project_id,
                &source_url,
                &source_host,
                rights_status,
                format!(
                    "Worker tải video không khởi chạy được: {}",
                    bounded_failure_message(&error)
                ),
                None,
                Some(relative_path),
                None,
                None,
                None,
                false,
            ));
        }
    };
    if !process.succeeded {
        let detail = if process.stderr.trim().is_empty() {
            process.stdout.trim()
        } else {
            process.stderr.trim()
        };
        return Ok(reference_video_download_report(
            &download_id,
            "failed",
            project_id,
            &source_url,
            &source_host,
            rights_status,
            format!(
                "Tải video thất bại (exit {:?}, timeout={}): {}",
                process.exit_code,
                process.timed_out,
                bounded_failure_message(detail)
            ),
            Some(process),
            Some(relative_path),
            None,
            None,
            None,
            true,
        ));
    }

    let output_path = workspace_root.join(relative_path.replace('/', "\\"));
    let metadata = fs::metadata(&output_path)
        .map_err(|error| format!("Worker báo xong nhưng không thấy file MP4: {error}"))?;
    if metadata.len() == 0 || metadata.len() > 2_u64 * 1024 * 1024 * 1024 {
        return Ok(reference_video_download_report(
            &download_id,
            "failed",
            project_id,
            &source_url,
            &source_host,
            rights_status,
            "File tải về rỗng hoặc vượt giới hạn 2 GB; chưa nhập vào Asset Library.".to_string(),
            Some(process),
            Some(relative_path),
            None,
            Some(metadata.len()),
            None,
            true,
        ));
    }
    let sha256 = sha256_file(&output_path)?;
    let asset = import_asset_with_state(
        AssetImportInput {
            project_id: project_id.to_string(),
            source_path: output_path.to_string_lossy().to_string(),
            title,
            media_kind: "video".to_string(),
            source_uri: Some(source_url.clone()),
            tags: vec!["reference-video".to_string(), source_host.clone()],
            note: format!(
                "Tải bằng worker yt-dlp allowlist từ {} ; watermark và quyền tái sử dụng vẫn cần người duyệt.",
                source_url
            ),
            rights_status: rights_status.to_string(),
        },
        &state,
    )?;
    {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database sau khi tải video".to_string())?;
        audit_event(
            &connection,
            Some(project_id),
            "reference_video.downloaded",
            "asset",
            &asset.asset_id,
        )?;
    }
    Ok(reference_video_download_report(
        &download_id,
        "succeeded",
        project_id,
        &source_url,
        &source_host,
        rights_status,
        format!(
            "Đã tải và nhập video vào Asset Library: {}. Cần review watermark, quyền và nội dung trước khi làm voice/phụ đề.",
            asset.relative_path
        ),
        Some(process),
        Some(asset.relative_path.clone()),
        Some(asset.clone()),
        Some(metadata.len()),
        Some(sha256),
        true,
    ))
}

#[tauri::command]
pub(super) fn update_asset_metadata(
    input: AssetMetadataInput,
    state: State<'_, AppState>,
) -> Result<AssetView, String> {
    valid_text(&input.project_id, "Project ID")?;
    valid_text(&input.asset_id, "Asset ID")?;
    validate_asset_text(&input.title, "Tên asset", 160)?;
    validate_asset_rights(input.rights_status.trim())?;
    validate_asset_tags(&input.tags)?;
    if input.note.chars().count() > 4000 || preview_secret_like(&input.note) {
        return Err("Ghi chú asset không hợp lệ".to_string());
    }
    if let Some(source_uri) = &input.source_uri {
        if source_uri.chars().count() > 2000
            || source_uri.contains(['\r', '\n'])
            || preview_secret_like(source_uri)
        {
            return Err("Source URI asset không hợp lệ".to_string());
        }
    }
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let current = fetch_asset(&connection, input.asset_id.trim())?;
    if current.project_id != input.project_id.trim() {
        return Err("Không thể sửa asset khác project".to_string());
    }
    if current.status == "archived" {
        return Err("Không thể sửa asset đã lưu trữ; hãy khôi phục trước".to_string());
    }
    let tags_json = serde_json::to_string(&input.tags).map_err(|error| error.to_string())?;
    let status = asset_status_for_rights(input.rights_status.trim());
    connection.execute("UPDATE asset_library SET title=?1, rights_status=?2, status=?3, source_uri=?4, tags_json=?5, note=?6, updated_at=?7 WHERE asset_id=?8 AND project_id=?9", params![input.title.trim(), input.rights_status.trim(), status, input.source_uri.as_deref().map(str::trim).filter(|value| !value.is_empty()), tags_json, input.note.trim(), now_string(), input.asset_id.trim(), input.project_id.trim()]).map_err(|error| error.to_string())?;
    audit_event(
        &connection,
        Some(input.project_id.trim()),
        "asset.metadata_updated",
        "asset",
        input.asset_id.trim(),
    )?;
    fetch_asset(&connection, input.asset_id.trim())
}

#[tauri::command]
pub(super) fn archive_asset(
    project_id: String,
    asset_id: String,
    state: State<'_, AppState>,
) -> Result<AssetView, String> {
    valid_text(&project_id, "Project ID")?;
    valid_text(&asset_id, "Asset ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let current = fetch_asset(&connection, asset_id.trim())?;
    if current.project_id != project_id.trim() {
        return Err("Không thể lưu trữ asset khác project".to_string());
    }
    let timestamp = now_string();
    connection.execute("UPDATE asset_library SET status='archived', archived_at=?1, updated_at=?1 WHERE asset_id=?2", params![timestamp, asset_id.trim()]).map_err(|error| error.to_string())?;
    audit_event(
        &connection,
        Some(project_id.trim()),
        "asset.archived",
        "asset",
        asset_id.trim(),
    )?;
    fetch_asset(&connection, asset_id.trim())
}

#[tauri::command]
pub(super) fn restore_asset(
    project_id: String,
    asset_id: String,
    state: State<'_, AppState>,
) -> Result<AssetView, String> {
    valid_text(&project_id, "Project ID")?;
    valid_text(&asset_id, "Asset ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let current = fetch_asset(&connection, asset_id.trim())?;
    if current.project_id != project_id.trim() {
        return Err("Không thể khôi phục asset khác project".to_string());
    }
    let timestamp = now_string();
    connection
        .execute(
            "UPDATE asset_library SET status=?1, archived_at=NULL, updated_at=?2 WHERE asset_id=?3",
            params![
                asset_status_for_rights(&current.rights_status),
                timestamp,
                asset_id.trim()
            ],
        )
        .map_err(|error| error.to_string())?;
    audit_event(
        &connection,
        Some(project_id.trim()),
        "asset.restored",
        "asset",
        asset_id.trim(),
    )?;
    fetch_asset(&connection, asset_id.trim())
}
