use super::*;

#[tauri::command]
pub(super) async fn save_recorded_audio(
    relative_path: String,
    data_bytes: Vec<u8>,
) -> Result<String, String> {
    if data_bytes.is_empty() {
        return Err("Dữ liệu âm thanh trống".to_string());
    }
    if data_bytes.len() > 10 * 1024 * 1024 {
        return Err("Dữ liệu âm thanh vượt quá 10MB".to_string());
    }
    let normalized = validate_attempt_output_path(&relative_path)?;
    let target_path = PathBuf::from(&normalized);
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Không thể tạo thư mục lưu audio: {e}"))?;
    }
    fs::write(&target_path, data_bytes).map_err(|e| format!("Không thể ghi file âm thanh: {e}"))?;
    Ok(normalized)
}

#[tauri::command]
pub(super) async fn save_recorded_audio_for_project(
    project_id: String,
    relative_path: String,
    data_bytes: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    valid_text(&project_id, "Project ID")?;
    if data_bytes.is_empty() {
        return Err("Dữ liệu thu âm trống".to_string());
    }
    if data_bytes.len() > 10 * 1024 * 1024 {
        return Err("Bản ghi vượt quá 10MB; hãy thu ngắn hơn".to_string());
    }
    if data_bytes.len() < 44 || &data_bytes[0..4] != b"RIFF" || &data_bytes[8..12] != b"WAVE" {
        return Err("Bản ghi chưa được mã hóa thành WAV hợp lệ".to_string());
    }
    let normalized = validate_attempt_output_path(&relative_path)?;
    if !normalized.starts_with(".auto3dvideo/voice-recordings/")
        || !normalized.to_ascii_lowercase().ends_with(".wav")
    {
        return Err(
            "Bản ghi chỉ được lưu trong .auto3dvideo/voice-recordings dưới dạng WAV".to_string(),
        );
    }
    let workspace_root = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        let workspace: String = connection
            .query_row(
                "SELECT workspace_root FROM projects WHERE project_id = ?1",
                params![project_id.trim()],
                |row| row.get(0),
            )
            .map_err(|error| format!("Không đọc được project workspace: {error}"))?;
        fs::canonicalize(workspace)
            .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?
    };
    let target_path = workspace_root.join(&normalized);
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Không tạo được thư mục thu âm: {error}"))?;
    }
    fs::write(&target_path, data_bytes)
        .map_err(|error| format!("Không lưu được bản ghi vào workspace: {error}"))?;
    Ok(normalized)
}

#[tauri::command]
pub(super) async fn read_workspace_audio_base64(relative_path: String) -> Result<String, String> {
    let normalized = validate_attempt_output_path(&relative_path)?;
    let target_path = PathBuf::from(&normalized);
    if !target_path.is_file() {
        return Err(format!("File audio không tồn tại: {normalized}"));
    }
    let bytes = fs::read(&target_path).map_err(|e| format!("Không đọc được file audio: {e}"))?;
    if bytes.len() > 25 * 1024 * 1024 {
        return Err("File audio quá lớn để preview (>25MB)".to_string());
    }

    // Simple base64 encode without extra crate
    const CHARS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = if chunk.len() > 1 { chunk[1] } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] } else { 0 };

        encoded.push(CHARS[(b0 >> 2) as usize] as char);
        encoded.push(CHARS[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            encoded.push(CHARS[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            encoded.push('=');
        }
        if chunk.len() > 2 {
            encoded.push(CHARS[(b2 & 0x3f) as usize] as char);
        } else {
            encoded.push('=');
        }
    }
    Ok(encoded)
}

#[tauri::command]
pub(super) async fn read_project_audio_base64(
    project_id: String,
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    valid_text(&project_id, "Project ID")?;
    let workspace_root = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        let workspace: String = connection
            .query_row(
                "SELECT workspace_root FROM projects WHERE project_id = ?1",
                params![project_id.trim()],
                |row| row.get(0),
            )
            .map_err(|error| format!("Không đọc được project workspace: {error}"))?;
        fs::canonicalize(workspace)
            .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?
    };
    let normalized = validate_attempt_output_path(&relative_path)?;
    let target_path = workspace_root.join(&normalized);
    let canonical = fs::canonicalize(&target_path)
        .map_err(|error| format!("Không đọc được file audio preview: {error}"))?;
    if !canonical.starts_with(&workspace_root) {
        return Err("Audio preview vượt workspace".to_string());
    }
    let bytes =
        fs::read(canonical).map_err(|error| format!("Không đọc được file audio: {error}"))?;
    if bytes.len() > 25 * 1024 * 1024 {
        return Err("File audio quá lớn để preview (>25MB)".to_string());
    }
    const CHARS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = if chunk.len() > 1 { chunk[1] } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] } else { 0 };
        encoded.push(CHARS[(b0 >> 2) as usize] as char);
        encoded.push(CHARS[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        encoded.push(if chunk.len() > 1 {
            CHARS[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char
        } else {
            '='
        });
        encoded.push(if chunk.len() > 2 {
            CHARS[(b2 & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    Ok(encoded)
}

fn encode_base64_bytes(bytes: &[u8]) -> String {
    const CHARS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = if chunk.len() > 1 { chunk[1] } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] } else { 0 };
        encoded.push(CHARS[(b0 >> 2) as usize] as char);
        encoded.push(CHARS[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        encoded.push(if chunk.len() > 1 {
            CHARS[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char
        } else {
            '='
        });
        encoded.push(if chunk.len() > 2 {
            CHARS[(b2 & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    encoded
}

pub(super) fn workspace_media_mime_type(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "bmp" => Some("image/bmp"),
        "mp4" => Some("video/mp4"),
        "webm" => Some("video/webm"),
        "mov" => Some("video/quicktime"),
        "m4v" => Some("video/x-m4v"),
        _ => None,
    }
}

fn decode_workspace_media_query(value: &str, field: &str) -> Result<String, String> {
    percent_decode_str(value)
        .decode_utf8()
        .map(|decoded| decoded.into_owned())
        .map_err(|_| format!("{field} chứa mã URL không hợp lệ"))
}

fn workspace_media_error(status: http::StatusCode, message: &str) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(status)
        .header(http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(message.as_bytes().to_vec())
        .unwrap_or_else(|_| http::Response::new(Vec::new()))
}

pub(super) fn workspace_media_protocol_response(
    app: &AppHandle,
    request: http::Request<Vec<u8>>,
) -> http::Response<Vec<u8>> {
    let mut project_id = None;
    let mut relative_path = None;
    for pair in request.uri().query().unwrap_or_default().split('&') {
        if pair.is_empty() {
            continue;
        }
        let (raw_key, raw_value) = pair.split_once('=').unwrap_or((pair, ""));
        let key = match decode_workspace_media_query(raw_key, "Tên tham số") {
            Ok(value) => value,
            Err(error) => return workspace_media_error(http::StatusCode::BAD_REQUEST, &error),
        };
        let value = match decode_workspace_media_query(raw_value, &key) {
            Ok(value) => value,
            Err(error) => return workspace_media_error(http::StatusCode::BAD_REQUEST, &error),
        };
        match key.as_str() {
            "projectId" => project_id = Some(value),
            "path" => relative_path = Some(value),
            _ => {}
        }
    }
    let project_id = match project_id.filter(|value| !value.trim().is_empty()) {
        Some(value) => value,
        None => return workspace_media_error(http::StatusCode::BAD_REQUEST, "Thiếu projectId"),
    };
    let relative_path = match relative_path.filter(|value| !value.trim().is_empty()) {
        Some(value) => value,
        None => return workspace_media_error(http::StatusCode::BAD_REQUEST, "Thiếu path"),
    };
    if let Err(error) = valid_text(&project_id, "Project ID") {
        return workspace_media_error(http::StatusCode::BAD_REQUEST, &error);
    }

    let state = app.state::<AppState>();
    let workspace_root = match state.database.lock() {
        Ok(connection) => match project_workspace_root(&connection, project_id.trim()) {
            Ok(root) => root,
            Err(error) => return workspace_media_error(http::StatusCode::NOT_FOUND, &error),
        },
        Err(_) => {
            return workspace_media_error(
                http::StatusCode::INTERNAL_SERVER_ERROR,
                "Không thể khóa database để đọc preview",
            )
        }
    };
    let canonical = match resolve_workspace_file(
        &workspace_root,
        &relative_path,
        "Media preview",
        512 * 1024 * 1024,
    ) {
        Ok(path) => path,
        Err(error) => return workspace_media_error(http::StatusCode::NOT_FOUND, &error),
    };
    let mime_type = match workspace_media_mime_type(&canonical) {
        Some(mime) => mime,
        None => {
            return workspace_media_error(
                http::StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "Định dạng media preview không được cho phép",
            )
        }
    };
    let total_size = match fs::metadata(&canonical) {
        Ok(metadata) => metadata.len(),
        Err(error) => {
            return workspace_media_error(
                http::StatusCode::NOT_FOUND,
                &format!("Không đọc được kích thước preview: {error}"),
            )
        }
    };
    let range = request
        .headers()
        .get(http::header::RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("bytes="))
        .and_then(|value| value.split(',').next())
        .and_then(|value| {
            let (start, end) = value.split_once('-')?;
            let start = start.parse::<u64>().ok()?;
            let end = if end.is_empty() {
                total_size.saturating_sub(1)
            } else {
                end.parse::<u64>().ok()?.min(total_size.saturating_sub(1))
            };
            (start <= end && start < total_size).then_some((start, end))
        });
    let (start, end, status) = match range {
        Some((start, end)) => (start, end, http::StatusCode::PARTIAL_CONTENT),
        None => (0, total_size.saturating_sub(1), http::StatusCode::OK),
    };
    if total_size == 0 || start >= total_size || end < start {
        return workspace_media_error(
            http::StatusCode::RANGE_NOT_SATISFIABLE,
            "Range preview không hợp lệ",
        );
    }
    let mut file = match fs::File::open(&canonical) {
        Ok(file) => file,
        Err(error) => {
            return workspace_media_error(
                http::StatusCode::NOT_FOUND,
                &format!("Không mở được preview: {error}"),
            )
        }
    };
    if let Err(error) = file.seek(SeekFrom::Start(start)) {
        return workspace_media_error(
            http::StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Không seek được preview: {error}"),
        );
    }
    let body_len = end - start + 1;
    let mut body = Vec::with_capacity(body_len.min(8 * 1024 * 1024) as usize);
    if let Err(error) = file.take(body_len).read_to_end(&mut body) {
        return workspace_media_error(
            http::StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Không đọc được preview: {error}"),
        );
    }
    let mut response = http::Response::builder()
        .status(status)
        .header(http::header::CONTENT_TYPE, mime_type)
        .header(http::header::CONTENT_LENGTH, body.len().to_string())
        .header(http::header::ACCEPT_RANGES, "bytes")
        .header(http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    if status == http::StatusCode::PARTIAL_CONTENT {
        response = response.header(
            http::header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{total_size}"),
        );
    }
    response
        .body(body)
        .unwrap_or_else(|_| http::Response::new(Vec::new()))
}

#[tauri::command]
pub(super) async fn read_project_asset_preview(
    project_id: String,
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<AssetPreviewView, String> {
    valid_text(&project_id, "Project ID")?;
    let workspace_root = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        project_workspace_root(&connection, project_id.trim())?
    };
    let normalized = validate_attempt_output_path(&relative_path)?;
    let target_path = workspace_root.join(normalized.replace('/', "\\"));
    let canonical = fs::canonicalize(&target_path)
        .map_err(|error| format!("Không đọc được asset preview: {error}"))?;
    if !canonical.starts_with(&workspace_root) || !canonical.is_file() {
        return Err("Asset preview vượt workspace hoặc không phải file".to_string());
    }
    let extension = canonical
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mime_type = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        _ => return Err("Chỉ preview ảnh PNG/JPEG/WebP/GIF/BMP trong Asset Pack".to_string()),
    };
    let bytes =
        fs::read(&canonical).map_err(|error| format!("Không đọc được asset preview: {error}"))?;
    if bytes.is_empty() || bytes.len() > 18 * 1024 * 1024 {
        return Err("Ảnh preview phải lớn hơn 0 và không vượt quá 18 MB".to_string());
    }
    Ok(AssetPreviewView {
        relative_path: normalized,
        mime_type: mime_type.to_string(),
        base64_data: encode_base64_bytes(&bytes),
    })
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct AssetPreviewView {
    relative_path: String,
    mime_type: String,
    base64_data: String,
}
