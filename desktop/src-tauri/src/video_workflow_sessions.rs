use super::*;

#[tauri::command]
pub(super) fn list_video_workflow_sessions(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<VideoWorkflowSessionView>, String> {
    valid_text(&project_id, "Project ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    ensure_project_exists(&connection, project_id.trim())?;
    let path = video_workflow_sessions_path(&connection, project_id.trim())?;
    let mut sessions = read_video_workflow_sessions(&path)?;
    for session in &mut sessions {
        if session.session_directory.trim().is_empty() {
            session.session_directory = format!("outputs/sessions/{}", session.session_id);
        }
    }
    sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(sessions)
}

#[tauri::command]
pub(super) fn save_video_workflow_session(
    input: SaveVideoWorkflowSessionInput,
    state: State<'_, AppState>,
) -> Result<VideoWorkflowSessionView, String> {
    save_video_workflow_session_inner(input, &state.database)
}

fn save_video_workflow_session_inner(
    input: SaveVideoWorkflowSessionInput,
    database: &Mutex<Connection>,
) -> Result<VideoWorkflowSessionView, String> {
    validate_video_workflow_session_input(&input)?;
    let connection = database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    ensure_project_exists(&connection, input.project_id.trim())?;
    validate_video_workflow_session_references(&connection, &input)?;
    let path = video_workflow_sessions_path(&connection, input.project_id.trim())?;
    let workspace_root = project_workspace_root(&connection, input.project_id.trim())?;
    let mut sessions = read_video_workflow_sessions(&path)?;
    let session_id = input
        .session_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(str::trim)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| now_id("video-session"));
    if !safe_preview_id(&session_id) {
        return Err("Session ID không hợp lệ".to_string());
    }
    let session_directory = video_workflow_session_directory(&workspace_root, &session_id)?;
    let session = VideoWorkflowSessionView {
        schema_version: "1.0.0".to_string(),
        session_id: session_id.clone(),
        project_id: input.project_id.trim().to_string(),
        session_directory,
        name: input.name.trim().to_string(),
        topic: input.topic.trim().to_string(),
        title: input.title.trim().to_string(),
        duration_seconds: input.duration_seconds,
        status: input.status.trim().to_string(),
        last_step: input.last_step.trim().to_string(),
        updated_at: now_string(),
        script: input.script,
        reference_asset_paths: input.reference_asset_paths,
        gemini_asset_paths: input.gemini_asset_paths,
        comfyui_asset_paths: input.comfyui_asset_paths,
        blender_preview: input.blender_preview,
        canvas_graph: input.canvas_graph,
        shot_reference_bindings: input.shot_reference_bindings,
    };
    if let Some(existing) = sessions
        .iter_mut()
        .find(|item| item.session_id == session_id)
    {
        *existing = session.clone();
    } else {
        sessions.push(session.clone());
    }
    sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    sessions.truncate(32);
    write_video_workflow_session_manifest(&workspace_root, &session)?;
    write_video_workflow_sessions(&path, &sessions)?;
    audit_event(
        &connection,
        Some(input.project_id.trim()),
        "video_workflow_session.saved",
        "video_workflow_session",
        &session_id,
    )?;
    Ok(session)
}

#[tauri::command]
pub(super) fn delete_video_workflow_session(
    project_id: String,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    valid_text(&project_id, "Project ID")?;
    valid_text(&session_id, "Session ID")?;
    if !safe_preview_id(session_id.trim()) {
        return Err("Session ID không hợp lệ".to_string());
    }
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    ensure_project_exists(&connection, project_id.trim())?;
    let path = video_workflow_sessions_path(&connection, project_id.trim())?;
    let mut sessions = read_video_workflow_sessions(&path)?;
    let original_len = sessions.len();
    sessions.retain(|item| item.session_id != session_id.trim());
    if sessions.len() == original_len {
        return Err("Không tìm thấy phiên video để xóa".to_string());
    }
    write_video_workflow_sessions(&path, &sessions)?;
    audit_event(
        &connection,
        Some(project_id.trim()),
        "video_workflow_session.deleted",
        "video_workflow_session",
        session_id.trim(),
    )?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct VideoWorkflowSessionView {
    pub(super) schema_version: String,
    pub(super) session_id: String,
    pub(super) project_id: String,
    #[serde(default)]
    pub(super) session_directory: String,
    pub(super) name: String,
    pub(super) topic: String,
    pub(super) title: String,
    pub(super) duration_seconds: Option<f64>,
    pub(super) status: String,
    pub(super) last_step: String,
    pub(super) updated_at: String,
    pub(super) script: Option<Value>,
    pub(super) reference_asset_paths: Vec<String>,
    pub(super) gemini_asset_paths: Vec<String>,
    #[serde(default)]
    pub(super) comfyui_asset_paths: Vec<String>,
    pub(super) blender_preview: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) canvas_graph: Option<CanvasGraph>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) shot_reference_bindings: Option<Vec<ShotReferenceBinding>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SaveVideoWorkflowSessionInput {
    project_id: String,
    #[serde(default)]
    session_id: Option<String>,
    name: String,
    topic: String,
    #[serde(default)]
    title: String,
    duration_seconds: Option<f64>,
    status: String,
    last_step: String,
    script: Option<Value>,
    #[serde(default)]
    reference_asset_paths: Vec<String>,
    #[serde(default)]
    gemini_asset_paths: Vec<String>,
    #[serde(default)]
    comfyui_asset_paths: Vec<String>,
    blender_preview: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    canvas_graph: Option<CanvasGraph>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    shot_reference_bindings: Option<Vec<ShotReferenceBinding>>,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CanvasGraph {
    pub(super) version: u8,
    pub(super) session_id: String,
    pub(super) nodes: Vec<CanvasGraphNode>,
    pub(super) edges: Vec<CanvasGraphEdge>,
    pub(super) viewport: CanvasGraphViewport,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CanvasGraphNode {
    pub(super) id: String,
    pub(super) kind: CanvasGraphNodeKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) segment_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) asset_id: Option<String>,
    pub(super) x: f64,
    pub(super) y: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum CanvasGraphNodeKind {
    Shot,
    Asset,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CanvasGraphEdge {
    pub(super) id: String,
    pub(super) from: String,
    pub(super) to: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub(super) struct CanvasGraphViewport {
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) zoom: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ShotReferenceBinding {
    pub(super) segment_id: String,
    pub(super) reference_set_id: String,
    pub(super) assignment_id: String,
    pub(super) asset_id: String,
    pub(super) asset_sha256: String,
    pub(super) role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) flow_project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) flow_media_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) confirmed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) confirmation_kind: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct VideoWorkflowSessionFile {
    pub(super) schema_version: String,
    pub(super) sessions: Vec<VideoWorkflowSessionView>,
}

fn video_workflow_sessions_path(
    connection: &Connection,
    project_id: &str,
) -> Result<PathBuf, String> {
    let workspace_root = project_workspace_root(connection, project_id)?;
    let cache_root = workspace_root.join(".auto3dvideo");
    fs::create_dir_all(&cache_root)
        .map_err(|error| format!("Không tạo được thư mục cache phiên video: {error}"))?;
    Ok(cache_root.join("video-workflow-sessions.json"))
}

pub(super) fn video_workflow_session_directory(
    workspace_root: &Path,
    session_id: &str,
) -> Result<String, String> {
    if !safe_preview_id(session_id) {
        return Err("Session ID không hợp lệ".to_string());
    }
    let relative = format!("outputs/sessions/{session_id}");
    let directory = workspace_root
        .join("outputs")
        .join("sessions")
        .join(session_id);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Không tạo được thư mục phiên video: {error}"))?;
    for child in ["inputs", "storyboard", "gemini", "blender", "video", "logs"] {
        fs::create_dir_all(directory.join(child))
            .map_err(|error| format!("Không tạo được thư mục phiên {child}: {error}"))?;
    }
    let canonical = fs::canonicalize(&directory)
        .map_err(|error| format!("Không xác nhận được thư mục phiên video: {error}"))?;
    let workspace_canonical = fs::canonicalize(workspace_root)
        .map_err(|error| format!("Không xác nhận được workspace phiên video: {error}"))?;
    if !canonical.starts_with(&workspace_canonical) {
        return Err("Thư mục phiên video vượt workspace project".to_string());
    }
    Ok(relative)
}

fn write_video_workflow_session_manifest(
    workspace_root: &Path,
    session: &VideoWorkflowSessionView,
) -> Result<(), String> {
    let directory = workspace_root.join(&session.session_directory);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Không tạo được thư mục manifest phiên video: {error}"))?;
    let path = directory.join("session.json");
    let encoded = serde_json::to_vec_pretty(session)
        .map_err(|error| format!("Không mã hóa được manifest phiên video: {error}"))?;
    fs::write(path, encoded)
        .map_err(|error| format!("Không ghi được manifest phiên video: {error}"))
}

fn video_workflow_session_recovery_prefix(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("video-workflow-sessions")
        .to_string()
        + ".recovery-"
}

pub(super) fn video_workflow_session_recovery_path(path: &Path) -> PathBuf {
    let prefix = video_workflow_session_recovery_prefix(path);
    path.with_file_name(format!("{prefix}{}.json", now_id("cache")))
}

fn video_workflow_session_recovery_files(path: &Path) -> Vec<PathBuf> {
    let Some(parent) = path.parent() else {
        return Vec::new();
    };
    let prefix = video_workflow_session_recovery_prefix(path);
    let mut files = fs::read_dir(parent)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|candidate| {
            candidate.is_file()
                && candidate
                    .file_name()
                    .and_then(|value| value.to_str())
                    .is_some_and(|name| name.starts_with(&prefix) && name.ends_with(".json"))
        })
        .collect::<Vec<_>>();
    files.sort_by(|left, right| {
        let left_modified = fs::metadata(left)
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH);
        let right_modified = fs::metadata(right)
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH);
        right_modified
            .cmp(&left_modified)
            .then_with(|| right.cmp(left))
    });
    files
}

fn is_windows_user_mapped_file_error(error: &std::io::Error) -> bool {
    error.raw_os_error() == Some(WINDOWS_USER_MAPPED_FILE_ERROR)
}

fn cleanup_video_workflow_session_recovery_files(path: &Path) {
    for recovery in video_workflow_session_recovery_files(path) {
        let _ = fs::remove_file(recovery);
    }
}

fn parse_video_workflow_session_cache(
    path: &Path,
    raw: &str,
) -> Result<Vec<VideoWorkflowSessionView>, String> {
    let document = serde_json::from_str::<VideoWorkflowSessionFile>(raw).map_err(|error| {
        format!(
            "Cache phiên video không hợp lệ tại {}: {error}",
            path.display()
        )
    })?;
    if document.schema_version != "1.0.0" {
        return Err(format!(
            "Cache phiên video không tương thích tại {}: {}",
            path.display(),
            document.schema_version
        ));
    }
    Ok(document.sessions)
}

pub(super) fn read_video_workflow_sessions(
    path: &Path,
) -> Result<Vec<VideoWorkflowSessionView>, String> {
    let mut candidates = Vec::new();
    if path.is_file() {
        candidates.push(path.to_path_buf());
    }
    candidates.extend(video_workflow_session_recovery_files(path));
    if candidates.is_empty() {
        return Ok(Vec::new());
    }
    candidates.sort_by(|left, right| {
        let left_modified = fs::metadata(left)
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH);
        let right_modified = fs::metadata(right)
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH);
        right_modified
            .cmp(&left_modified)
            .then_with(|| right.cmp(left))
    });
    let mut errors = Vec::new();
    for candidate in candidates {
        match fs::read_to_string(&candidate) {
            Ok(raw) => match parse_video_workflow_session_cache(&candidate, &raw) {
                Ok(sessions) => return Ok(sessions),
                Err(error) => errors.push(error),
            },
            Err(error) if is_windows_user_mapped_file_error(&error) => {
                errors.push(format!(
                    "Cache phiên video đang bị Windows memory-mapped: {}",
                    candidate.display()
                ));
            }
            Err(error) => errors.push(format!(
                "Không đọc được cache phiên video tại {}: {error}",
                candidate.display()
            )),
        }
    }
    Err(errors
        .into_iter()
        .next()
        .unwrap_or_else(|| "Không đọc được cache phiên video".to_string()))
}

fn write_video_workflow_sessions(
    path: &Path,
    sessions: &[VideoWorkflowSessionView],
) -> Result<(), String> {
    let document = VideoWorkflowSessionFile {
        schema_version: "1.0.0".to_string(),
        sessions: sessions.to_vec(),
    };
    let encoded = serde_json::to_vec_pretty(&document)
        .map_err(|error| format!("Không mã hóa được cache phiên video: {error}"))?;
    // Windows refuses to truncate a file while another component holds a
    // memory-mapped section for it (ERROR_USER_MAPPED_FILE / 1224). Always
    // keep a unique recovery snapshot first; if the stable index is mapped,
    // the next read will select this newer snapshot instead of losing the
    // session save.
    let recovery_path = video_workflow_session_recovery_path(path);
    fs::write(&recovery_path, &encoded).map_err(|error| {
        format!(
            "Không ghi được recovery cache phiên video {}: {error}",
            recovery_path.display()
        )
    })?;
    match fs::write(path, encoded) {
        Ok(()) => {
            cleanup_video_workflow_session_recovery_files(path);
            Ok(())
        }
        Err(error) if is_windows_user_mapped_file_error(&error) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&recovery_path);
            Err(format!("Không lưu được cache phiên video: {error}"))
        }
    }
}

fn validate_video_workflow_session_input(
    input: &SaveVideoWorkflowSessionInput,
) -> Result<(), String> {
    valid_text(&input.project_id, "Project ID")?;
    valid_text(&input.name, "Tên phiên video")?;
    valid_text(&input.topic, "Prompt/chủ đề")?;
    valid_text(&input.status, "Trạng thái phiên")?;
    valid_text(&input.last_step, "Bước cuối")?;
    if input.name.trim().chars().count() > 160 {
        return Err("Tên phiên video quá dài".to_string());
    }
    if input.topic.trim().chars().count() > 4000 {
        return Err("Prompt/chủ đề vượt quá 4.000 ký tự".to_string());
    }
    if input.title.chars().count() > 240 {
        return Err("Tiêu đề video quá dài".to_string());
    }
    if !matches!(
        input.status.trim(),
        "draft"
            | "storyboard_ready"
            | "preview_ready"
            | "gemini_ready"
            | "comfyui_ready"
            | "handoff_ready"
    ) {
        return Err("Trạng thái phiên video không được hỗ trợ".to_string());
    }
    if input.last_step.trim().chars().count() > 80 {
        return Err("Tên bước cuối quá dài".to_string());
    }
    if let Some(duration) = input.duration_seconds {
        if !duration.is_finite() || !(0.0..=86_400.0).contains(&duration) {
            return Err("Thời lượng phiên video không hợp lệ".to_string());
        }
    }
    for (label, paths, max_items) in [
        (
            "reference_asset_paths",
            &input.reference_asset_paths,
            8usize,
        ),
        ("gemini_asset_paths", &input.gemini_asset_paths, 8usize),
        // Flow keeps one reference binding per shot; the old generic cap
        // silently dropped shots 9-12 during session resume.
        ("comfyui_asset_paths", &input.comfyui_asset_paths, 32usize),
    ] {
        if paths.len() > max_items {
            return Err(format!("{label} không được vượt quá {max_items} file"));
        }
        for path in paths {
            if !safe_preview_relative_path(path) {
                return Err(format!("Đường dẫn asset trong {label} không an toàn"));
            }
        }
    }
    if input
        .script
        .as_ref()
        .is_some_and(|value| !value.is_object())
    {
        return Err("Script phiên video phải là JSON object".to_string());
    }
    if input
        .blender_preview
        .as_ref()
        .is_some_and(|value| !value.is_object())
    {
        return Err("Blender preview của phiên video phải là JSON object".to_string());
    }
    if let Some(graph) = input.canvas_graph.as_ref() {
        validate_canvas_graph(input, graph)?;
    }
    if let Some(bindings) = input.shot_reference_bindings.as_ref() {
        validate_shot_reference_bindings(input, bindings)?;
    }
    let payload_size = serde_json::to_vec(input)
        .map_err(|error| format!("Không kiểm tra được kích thước phiên video: {error}"))?
        .len();
    if payload_size > 1_500_000 {
        return Err("Dữ liệu phiên video vượt quá giới hạn cache local".to_string());
    }
    Ok(())
}

fn safe_canvas_graph_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'.' | b'_' | b'-'))
}

fn script_contains_segment(script: Option<&Value>, segment_id: &str) -> bool {
    script
        .and_then(|value| value.get("segments"))
        .and_then(Value::as_array)
        .is_some_and(|segments| {
            segments
                .iter()
                .any(|segment| segment.get("segmentId").and_then(Value::as_str) == Some(segment_id))
        })
}

fn validate_canvas_graph(
    input: &SaveVideoWorkflowSessionInput,
    graph: &CanvasGraph,
) -> Result<(), String> {
    if graph.version != 1
        || !safe_canvas_graph_id(&graph.session_id)
        || input.session_id.as_deref().map(str::trim) != Some(graph.session_id.as_str())
    {
        return Err("Canvas graph session identity is invalid".to_string());
    }
    if graph.nodes.len() > 128 || graph.edges.len() > 256 {
        return Err("Canvas graph exceeds the node or edge limit".to_string());
    }
    if !graph.viewport.x.is_finite()
        || !graph.viewport.y.is_finite()
        || !graph.viewport.zoom.is_finite()
        || graph.viewport.x.abs() > 10_000.0
        || graph.viewport.y.abs() > 10_000.0
        || !(0.25..=4.0).contains(&graph.viewport.zoom)
    {
        return Err("Canvas graph viewport is outside the allowed bounds".to_string());
    }

    let mut node_ids = HashSet::new();
    let mut shot_segments = HashSet::new();
    let mut asset_ids = HashSet::new();
    for node in &graph.nodes {
        if !safe_canvas_graph_id(&node.id)
            || !node_ids.insert(node.id.as_str())
            || !node.x.is_finite()
            || !node.y.is_finite()
            || node.x.abs() > 10_000.0
            || node.y.abs() > 10_000.0
        {
            return Err("Canvas graph node identity or position is invalid".to_string());
        }
        match node.kind {
            CanvasGraphNodeKind::Shot => {
                let segment_id = node
                    .segment_id
                    .as_deref()
                    .filter(|value| safe_canvas_graph_id(value));
                if node.asset_id.is_some()
                    || segment_id
                        .is_none_or(|value| !script_contains_segment(input.script.as_ref(), value))
                    || !shot_segments.insert(node.segment_id.as_deref().unwrap_or_default())
                {
                    return Err(
                        "Canvas shot node does not resolve to a unique script segment".to_string(),
                    );
                }
            }
            CanvasGraphNodeKind::Asset => {
                let asset_id = node
                    .asset_id
                    .as_deref()
                    .filter(|value| safe_canvas_graph_id(value));
                if node.segment_id.is_some()
                    || asset_id.is_none()
                    || !asset_ids.insert(node.asset_id.as_deref().unwrap_or_default())
                {
                    return Err("Canvas asset node identity is invalid".to_string());
                }
            }
        }
    }

    let mut edge_ids = HashSet::new();
    let mut edge_pairs = HashSet::new();
    for edge in &graph.edges {
        if !safe_canvas_graph_id(&edge.id)
            || !safe_canvas_graph_id(&edge.from)
            || !safe_canvas_graph_id(&edge.to)
            || !edge_ids.insert(edge.id.as_str())
            || edge.from == edge.to
            || !node_ids.contains(edge.from.as_str())
            || !node_ids.contains(edge.to.as_str())
            || !edge_pairs.insert((edge.from.as_str(), edge.to.as_str()))
        {
            return Err("Canvas graph edge identity or endpoint is invalid".to_string());
        }
    }
    Ok(())
}

fn safe_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn safe_flow_project_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn safe_flow_media_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b':'))
}

fn safe_confirmation_time(value: &str) -> bool {
    let bytes = value.as_bytes();
    if !(20..=35).contains(&bytes.len())
        || !bytes[..4].iter().all(u8::is_ascii_digit)
        || bytes.get(4) != Some(&b'-')
        || !bytes[5..7].iter().all(u8::is_ascii_digit)
        || bytes.get(7) != Some(&b'-')
        || !bytes[8..10].iter().all(u8::is_ascii_digit)
        || bytes.get(10) != Some(&b'T')
        || !bytes[11..13].iter().all(u8::is_ascii_digit)
        || bytes.get(13) != Some(&b':')
        || !bytes[14..16].iter().all(u8::is_ascii_digit)
        || bytes.get(16) != Some(&b':')
        || !bytes[17..19].iter().all(u8::is_ascii_digit)
    {
        return false;
    }
    let zone_start = if bytes.last() == Some(&b'Z') {
        bytes.len() - 1
    } else {
        if bytes.len() < 25 {
            return false;
        }
        let start = bytes.len() - 6;
        if !matches!(bytes[start], b'+' | b'-')
            || bytes[start + 3] != b':'
            || !bytes[start + 1..start + 3].iter().all(u8::is_ascii_digit)
            || !bytes[start + 4..].iter().all(u8::is_ascii_digit)
        {
            return false;
        }
        start
    };
    if bytes[19] == b'.' {
        let fraction = &bytes[20..zone_start];
        if fraction.is_empty() || fraction.len() > 9 || !fraction.iter().all(u8::is_ascii_digit) {
            return false;
        }
    } else if zone_start != 19 {
        return false;
    }
    true
}

fn validate_shot_reference_bindings(
    input: &SaveVideoWorkflowSessionInput,
    bindings: &[ShotReferenceBinding],
) -> Result<(), String> {
    if bindings.len() > 64 {
        return Err("Shot reference bindings exceed the limit".to_string());
    }
    let mut segments = HashSet::new();
    for binding in bindings {
        if !safe_canvas_graph_id(&binding.segment_id)
            || !safe_canvas_graph_id(&binding.reference_set_id)
            || !safe_canvas_graph_id(&binding.assignment_id)
            || !safe_canvas_graph_id(&binding.asset_id)
            || !safe_sha256(&binding.asset_sha256)
            || !matches!(
                binding.role.as_str(),
                "identity"
                    | "composition"
                    | "pose"
                    | "camera"
                    | "style"
                    | "start_frame"
                    | "end_frame"
                    | "negative"
            )
            || !script_contains_segment(input.script.as_ref(), &binding.segment_id)
            || !segments.insert(binding.segment_id.as_str())
        {
            return Err("Shot reference binding identity is invalid".to_string());
        }
        match (
            binding.flow_project_id.as_deref(),
            binding.flow_media_id.as_deref(),
            binding.confirmed_at.as_deref(),
            binding.confirmation_kind.as_deref(),
        ) {
            (None, None, None, None) => {}
            (Some(project_id), Some(media_id), Some(confirmed_at), Some("manual_visual"))
                if safe_flow_project_id(project_id)
                    && safe_flow_media_id(media_id)
                    && safe_confirmation_time(confirmed_at) => {}
            _ => {
                return Err("Manual Flow binding confirmation is incomplete or invalid".to_string())
            }
        }
    }
    Ok(())
}

fn validate_video_workflow_session_references(
    connection: &Connection,
    input: &SaveVideoWorkflowSessionInput,
) -> Result<(), String> {
    let project_id = input.project_id.trim();
    if let Some(graph) = input.canvas_graph.as_ref() {
        for node in graph
            .nodes
            .iter()
            .filter(|node| node.kind == CanvasGraphNodeKind::Asset)
        {
            let asset_id = node.asset_id.as_deref().unwrap_or_default();
            let owner: String = connection
                .query_row(
                    "SELECT project_id FROM asset_library WHERE asset_id=?1",
                    params![asset_id],
                    |row| row.get(0),
                )
                .map_err(|_| "Canvas asset was not found in the local project".to_string())?;
            if owner != project_id {
                return Err("Canvas asset belongs to another project".to_string());
            }
        }
    }
    if let Some(bindings) = input.shot_reference_bindings.as_ref() {
        for binding in bindings {
            let (set_project, scope, status): (String, String, String) = connection
                .query_row(
                    "SELECT project_id, scope, status FROM reference_sets WHERE reference_set_id=?1",
                    params![binding.reference_set_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .map_err(|_| "Shot reference set was not found".to_string())?;
            if set_project != project_id || scope != "shot" || status != "active" {
                return Err("Shot reference set is not active in this project".to_string());
            }
            let (assignment_project, set_id, asset_id, role, shot_id, assignment_hash): (
                String,
                String,
                String,
                String,
                Option<String>,
                String,
            ) = connection
                .query_row(
                    "SELECT project_id, reference_set_id, asset_id, role, shot_id, asset_sha256
                         FROM reference_set_assignments WHERE assignment_id=?1",
                    params![binding.assignment_id],
                    |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                            row.get(5)?,
                        ))
                    },
                )
                .map_err(|_| "Shot reference assignment was not found".to_string())?;
            if assignment_project != project_id
                || set_id != binding.reference_set_id
                || asset_id != binding.asset_id
                || role != binding.role
                || shot_id.as_deref() != Some(binding.segment_id.as_str())
                || assignment_hash != binding.asset_sha256
            {
                return Err(
                    "Shot reference assignment identity does not match the session".to_string(),
                );
            }
            let (asset_project, asset_hash): (String, String) = connection
                .query_row(
                    "SELECT project_id, sha256 FROM asset_library WHERE asset_id=?1",
                    params![binding.asset_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .map_err(|_| "Shot reference asset was not found".to_string())?;
            if asset_project != project_id || asset_hash != binding.asset_sha256 {
                return Err(
                    "Shot reference asset is not owned by this project or its hash changed"
                        .to_string(),
                );
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn legacy_session() -> Value {
        json!({
            "schemaVersion": "1.0.0",
            "sessionId": "video-session-test",
            "projectId": "project-test",
            "name": "Legacy session",
            "topic": "A simple shot",
            "title": "Legacy",
            "status": "draft",
            "lastStep": "topic",
            "updatedAt": "2026-09-28T00:00:00Z",
            "script": { "segments": [{ "segmentId": "segment-001" }] },
            "referenceAssetPaths": ["outputs/sessions/video-session-test/reference.png"],
            "geminiAssetPaths": [],
            "comfyuiAssetPaths": ["outputs/sessions/video-session-test/shot.png"],
            "blenderPreview": null
        })
    }

    #[test]
    fn legacy_session_keeps_script_and_asset_paths_without_canvas_fields() {
        let session: VideoWorkflowSessionView =
            serde_json::from_value(legacy_session()).expect("legacy session loads");
        let restored = serde_json::to_value(session).expect("legacy session round-trips");

        assert_eq!(
            restored["script"]["segments"][0]["segmentId"],
            "segment-001"
        );
        assert_eq!(
            restored["referenceAssetPaths"],
            json!(["outputs/sessions/video-session-test/reference.png"])
        );
        assert_eq!(restored["geminiAssetPaths"], json!([]));
        assert_eq!(
            restored["comfyuiAssetPaths"],
            json!(["outputs/sessions/video-session-test/shot.png"])
        );
        assert!(restored.get("canvasGraph").is_none());
        assert!(restored.get("shotReferenceBindings").is_none());
    }

    #[test]
    fn malformed_canvas_edge_is_rejected_by_session_validation() {
        let mut input = legacy_session();
        input["canvasGraph"] = json!({
            "version": 1,
            "sessionId": "video-session-test",
            "nodes": [{
                "id": "shot-segment-001",
                "kind": "shot",
                "segmentId": "segment-001",
                "x": 0,
                "y": 0
            }],
            "edges": [{
                "id": "edge-missing-target",
                "from": "shot-segment-001",
                "to": "missing-node"
            }],
            "viewport": { "x": 0, "y": 0, "zoom": 1 }
        });
        let input: SaveVideoWorkflowSessionInput =
            serde_json::from_value(input).expect("well-shaped save envelope");

        assert!(
            validate_video_workflow_session_input(&input).is_err(),
            "an edge to a missing node must block the session save"
        );
    }

    fn reference_database() -> (Connection, String) {
        let connection = Connection::open_in_memory().expect("in-memory database");
        connection
            .execute_batch(
                "CREATE TABLE reference_sets (
                    reference_set_id TEXT, project_id TEXT, scope TEXT, status TEXT
                 );
                 CREATE TABLE reference_set_assignments (
                    assignment_id TEXT, project_id TEXT, reference_set_id TEXT,
                    asset_id TEXT, role TEXT, shot_id TEXT, asset_sha256 TEXT
                 );
                 CREATE TABLE asset_library (asset_id TEXT, project_id TEXT, sha256 TEXT);",
            )
            .expect("create reference tables");
        let hash = "a".repeat(64);
        connection
            .execute(
                "INSERT INTO reference_sets VALUES ('set-target', 'project-test', 'shot', 'active')",
                [],
            )
            .expect("insert reference set");
        connection
            .execute(
                "INSERT INTO reference_set_assignments
                 VALUES ('assignment-target', 'project-test', 'set-target', 'asset-test', 'start_frame', 'segment-001', ?1)",
                params![&hash],
            )
            .expect("insert reference assignment");
        connection
            .execute(
                "INSERT INTO asset_library VALUES ('asset-test', 'project-test', ?1)",
                params![&hash],
            )
            .expect("insert local asset");
        (connection, hash)
    }

    fn reference_input(
        hash: &str,
        segment_id: &str,
        assignment_id: &str,
        asset_id: &str,
    ) -> SaveVideoWorkflowSessionInput {
        let mut input = legacy_session();
        input["shotReferenceBindings"] = json!([{
            "segmentId": segment_id,
            "referenceSetId": "set-target",
            "assignmentId": assignment_id,
            "assetId": asset_id,
            "assetSha256": hash,
            "role": "start_frame"
        }]);
        serde_json::from_value(input).expect("well-shaped reference session")
    }

    #[test]
    fn shot_reference_binding_must_resolve_script_segment() {
        let (_, hash) = reference_database();
        let input = reference_input(&hash, "segment-missing", "assignment-target", "asset-test");

        assert!(validate_video_workflow_session_input(&input).is_err());
    }

    #[test]
    fn shot_reference_binding_must_match_assignment_asset_and_hash() {
        let (connection, hash) = reference_database();
        let valid_input = reference_input(&hash, "segment-001", "assignment-target", "asset-test");
        assert!(validate_video_workflow_session_references(&connection, &valid_input).is_ok());

        let mismatched_asset =
            reference_input(&hash, "segment-001", "assignment-target", "asset-other");
        assert!(
            validate_video_workflow_session_references(&connection, &mismatched_asset).is_err()
        );

        connection
            .execute(
                "UPDATE asset_library SET sha256=?1 WHERE asset_id='asset-test'",
                params!["b".repeat(64)],
            )
            .expect("change current asset hash");
        assert!(validate_video_workflow_session_references(&connection, &valid_input).is_err());
    }

    #[test]
    fn shot_reference_binding_must_resolve_current_assignment_and_project() {
        let (connection, hash) = reference_database();
        let missing_assignment =
            reference_input(&hash, "segment-001", "assignment-missing", "asset-test");
        assert!(
            validate_video_workflow_session_references(&connection, &missing_assignment).is_err()
        );

        let valid_input = reference_input(&hash, "segment-001", "assignment-target", "asset-test");
        connection
            .execute(
                "UPDATE reference_sets SET project_id='project-other' WHERE reference_set_id='set-target'",
                [],
            )
            .expect("move set to another project");
        assert!(validate_video_workflow_session_references(&connection, &valid_input).is_err());

        connection
            .execute(
                "UPDATE reference_sets SET project_id='project-test' WHERE reference_set_id='set-target'",
                [],
            )
            .expect("restore set project");
        connection
            .execute(
                "UPDATE reference_set_assignments SET project_id='project-other' WHERE assignment_id='assignment-target'",
                [],
            )
            .expect("move assignment to another project");
        assert!(validate_video_workflow_session_references(&connection, &valid_input).is_err());
    }

    #[test]
    fn canvas_asset_node_must_belong_to_session_project() {
        let (connection, _) = reference_database();
        connection
            .execute(
                "UPDATE asset_library SET project_id='project-other' WHERE asset_id='asset-test'",
                [],
            )
            .expect("move asset to another project");

        let mut session = legacy_session();
        session["canvasGraph"] = json!({
            "version": 1,
            "sessionId": "video-session-test",
            "nodes": [{
                "id": "asset-node-001",
                "kind": "asset",
                "assetId": "asset-test",
                "x": 0,
                "y": 0
            }],
            "edges": [],
            "viewport": { "x": 0, "y": 0, "zoom": 1 }
        });
        let input: SaveVideoWorkflowSessionInput =
            serde_json::from_value(session).expect("well-shaped graph session");

        assert!(validate_video_workflow_session_input(&input).is_ok());
        assert!(validate_video_workflow_session_references(&connection, &input).is_err());
    }
    #[test]
    fn flow_binding_requires_complete_manual_ids_without_urls_or_paths() {
        let hash = "a".repeat(64);
        let make_binding_input =
            |flow_project: Option<&str>, flow_media: Option<&str>, confirmation: bool| {
                let mut input = legacy_session();
                let mut binding = json!({
                    "segmentId": "segment-001",
                    "referenceSetId": "set-target",
                    "assignmentId": "assignment-target",
                    "assetId": "asset-test",
                    "assetSha256": hash,
                    "role": "start_frame"
                });
                if let Some(flow_project) = flow_project {
                    binding["flowProjectId"] = json!(flow_project);
                }
                if let Some(flow_media) = flow_media {
                    binding["flowMediaId"] = json!(flow_media);
                }
                if confirmation {
                    binding["confirmedAt"] = json!("2026-09-28T00:00:00Z");
                    binding["confirmationKind"] = json!("manual_visual");
                }
                input["shotReferenceBindings"] = json!([binding]);
                serde_json::from_value::<SaveVideoWorkflowSessionInput>(input)
                    .expect("well-shaped Flow binding")
            };

        let complete = make_binding_input(Some("flow-project"), Some("media-001"), true);
        assert!(validate_video_workflow_session_input(&complete).is_ok());

        let local_only = make_binding_input(None, None, false);
        assert!(validate_video_workflow_session_input(&local_only).is_ok());

        let incomplete = make_binding_input(Some("flow-project"), None, false);
        assert!(validate_video_workflow_session_input(&incomplete).is_err());

        let url_project =
            make_binding_input(Some("https://flow.google.com"), Some("media-001"), true);
        assert!(validate_video_workflow_session_input(&url_project).is_err());

        let path_media =
            make_binding_input(Some("flow-project"), Some("C:\\images\\frame.png"), true);
        assert!(validate_video_workflow_session_input(&path_media).is_err());
    }
    #[test]
    fn reference_binding_from_another_project_is_rejected() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        connection
            .execute_batch(
                "CREATE TABLE reference_sets (
                    reference_set_id TEXT, project_id TEXT, scope TEXT, status TEXT
                 );
                 CREATE TABLE reference_set_assignments (
                    assignment_id TEXT, project_id TEXT, reference_set_id TEXT,
                    asset_id TEXT, role TEXT, shot_id TEXT, asset_sha256 TEXT
                 );
                 CREATE TABLE asset_library (asset_id TEXT, project_id TEXT, sha256 TEXT);",
            )
            .expect("create minimal reference tables");
        let hash = "a".repeat(64);
        connection
            .execute(
                "INSERT INTO reference_sets VALUES (?1, ?2, 'shot', 'active')",
                params!["set-target", "project-test"],
            )
            .expect("insert target project set");
        connection
            .execute(
                "INSERT INTO reference_set_assignments VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    "assignment-other",
                    "project-other",
                    "set-target",
                    "asset-test",
                    "start_frame",
                    "segment-001",
                    &hash
                ],
            )
            .expect("insert cross-project assignment");
        connection
            .execute(
                "INSERT INTO asset_library VALUES (?1, ?2, ?3)",
                params!["asset-test", "project-test", &hash],
            )
            .expect("insert target project asset");

        let mut input = legacy_session();
        input["shotReferenceBindings"] = json!([{
            "segmentId": "segment-001",
            "referenceSetId": "set-target",
            "assignmentId": "assignment-other",
            "assetId": "asset-test",
            "assetSha256": hash,
            "role": "start_frame"
        }]);
        let input: SaveVideoWorkflowSessionInput =
            serde_json::from_value(input).expect("well-shaped save envelope");

        assert!(validate_video_workflow_session_references(&connection, &input).is_err());
    }

    #[test]
    fn invalid_graph_save_does_not_overwrite_existing_session() {
        let root = std::env::temp_dir().join(now_id("video-session-invalid-save"));
        let cache_dir = root.join(".auto3dvideo");
        fs::create_dir_all(&cache_dir).expect("create session cache");
        let mut existing: VideoWorkflowSessionView =
            serde_json::from_value(legacy_session()).expect("legacy session");
        existing.session_directory =
            video_workflow_session_directory(&root, &existing.session_id).expect("session tree");
        let cache_path = cache_dir.join("video-workflow-sessions.json");
        write_video_workflow_sessions(&cache_path, &[existing.clone()])
            .expect("write saved session");
        write_video_workflow_session_manifest(&root, &existing).expect("write session manifest");
        let previous_cache = fs::read(&cache_path).expect("read saved cache");
        let manifest_path = root.join(&existing.session_directory).join("session.json");
        let previous_manifest = fs::read(&manifest_path).expect("read saved manifest");

        let connection = Connection::open_in_memory().expect("in-memory database");
        connection
            .execute_batch(
                "CREATE TABLE projects (project_id TEXT PRIMARY KEY, workspace_root TEXT NOT NULL);",
            )
            .expect("create projects table");
        connection
            .execute(
                "INSERT INTO projects(project_id, workspace_root) VALUES (?1, ?2)",
                params!["project-test", root.to_string_lossy().as_ref()],
            )
            .expect("insert project");
        let database = Mutex::new(connection);

        let mut input = legacy_session();
        input["canvasGraph"] = json!({
            "version": 1,
            "sessionId": "video-session-test",
            "nodes": [{
                "id": "shot-segment-001",
                "kind": "shot",
                "segmentId": "segment-001",
                "x": 0,
                "y": 0
            }],
            "edges": [{
                "id": "edge-missing-target",
                "from": "shot-segment-001",
                "to": "missing-node"
            }],
            "viewport": { "x": 0, "y": 0, "zoom": 1 }
        });
        let input: SaveVideoWorkflowSessionInput =
            serde_json::from_value(input).expect("well-shaped save envelope");

        assert!(save_video_workflow_session_inner(input, &database).is_err());
        assert_eq!(
            fs::read(cache_path).expect("read saved cache"),
            previous_cache
        );
        assert_eq!(
            fs::read(manifest_path).expect("read saved manifest"),
            previous_manifest
        );

        drop(database);
        fs::remove_dir_all(root).expect("clean session fixture");
    }
}
