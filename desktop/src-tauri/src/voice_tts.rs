use super::tool_readiness::resolve_configured_tool;
use super::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct VieneuReadinessReport {
    status: String,
    package_installed: bool,
    package_version: Option<String>,
    model_id: String,
    backend: String,
    model_cache_path: String,
    model_cache_present: bool,
    model_download_requested: bool,
    network_calls_made: bool,
    process_started: bool,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct VieneuTtsReport {
    output_path: String,
    size_bytes: u64,
    model_id: String,
    voice: String,
    backend: String,
    precision: String,
    temperature: f64,
    reference_audio_used: bool,
    clone_consent: bool,
    model_download_requested: bool,
    network_calls_made: bool,
    human_review_required: bool,
    output_validated: bool,
    message: String,
    process: ExternalProcessResult,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct VoiceProfileView {
    voice_profile_id: String,
    project_id: String,
    name: String,
    mode: String,
    model_id: String,
    language: String,
    instruct: Option<String>,
    reference_audio_path: Option<String>,
    reference_audio_sha256: Option<String>,
    reference_audio_duration_seconds: Option<f64>,
    reference_audio_sample_rate: Option<i64>,
    reference_transcript: Option<String>,
    rights_status: String,
    commercial_use: String,
    clone_consent: bool,
    status: String,
    last_preview_path: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct VoiceSampleView {
    relative_path: String,
    file_name: String,
    source_kind: String,
    size_bytes: u64,
    duration_seconds: Option<f64>,
    sample_rate: Option<u32>,
    modified_unix_seconds: u64,
    transcript: Option<String>,
    license: Option<String>,
    source_dataset: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct OmniVoiceReadinessReport {
    status: String,
    package_installed: bool,
    torch_installed: bool,
    model_id: String,
    audio_tokenizer_id: String,
    model_cache_path: String,
    model_cache_present: bool,
    device: String,
    model_download_requested: bool,
    network_calls_made: bool,
    process_started: bool,
    message: String,
    process: ExternalProcessResult,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct OmniVoiceTtsReport {
    status: String,
    output_path: String,
    size_bytes: u64,
    model_id: String,
    voice_profile_id: String,
    mode: String,
    language: String,
    duration_seconds: Option<f64>,
    sample_rate: Option<u32>,
    device: String,
    model_download_requested: bool,
    network_calls_made: bool,
    human_review_required: bool,
    output_validated: bool,
    message: String,
    process: ExternalProcessResult,
}

fn validate_vieneu_text(text: &str) -> Result<String, String> {
    valid_text(text, "Văn bản TTS")?;
    let trimmed = text.trim();
    if trimmed.chars().count() > 100_000 {
        return Err("Văn bản TTS vượt quá 100.000 ký tự".to_string());
    }
    Ok(trimmed.to_string())
}

fn validate_vieneu_voice(voice: &str) -> Result<String, String> {
    valid_text(voice, "VieNeu voice")?;
    let trimmed = voice.trim();
    if trimmed.chars().count() > 128 || trimmed.contains(['\r', '\n', '\0']) {
        return Err("VieNeu voice không hợp lệ".to_string());
    }
    Ok(trimmed.to_string())
}

fn vieneu_cache_root() -> PathBuf {
    PathBuf::from(r"D:\Auto3DvideoTools\vieneu\cache")
}

fn vieneu_worker_environment() -> Result<BTreeMap<String, String>, String> {
    let cache_root = fs::canonicalize(vieneu_cache_root()).unwrap_or_else(|_| vieneu_cache_root());
    let value = cache_root.to_string_lossy().to_string();
    if value.len() > 4096 || value.contains(['\r', '\n', '\0']) {
        return Err("VieNeu cache path không hợp lệ".to_string());
    }
    Ok(BTreeMap::from([(
        "AUTO3DVIDEO_VIENEUTTS_CACHE".to_string(),
        value,
    )]))
}

fn ensure_vieneu_worker_script(workspace_root: &Path) -> Result<(PathBuf, String), String> {
    let script_path = workspace_root
        .join(".auto3dvideo")
        .join("tools")
        .join("vieneu_tts_worker.py");
    fs::create_dir_all(
        script_path
            .parent()
            .ok_or_else(|| "Không xác định được thư mục VieNeu worker".to_string())?,
    )
    .map_err(|error| format!("Không tạo được thư mục VieNeu worker: {error}"))?;
    fs::write(&script_path, VIENEU_TTS_WORKER_SCRIPT)
        .map_err(|error| format!("Không ghi được VieNeu worker: {error}"))?;
    let relative = script_path
        .strip_prefix(workspace_root)
        .map_err(|_| "VieNeu worker vượt project workspace".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    Ok((script_path, relative))
}

pub(super) fn parse_vieneu_worker_output(result: &ExternalProcessResult) -> Option<Value> {
    result
        .stdout
        .lines()
        .rev()
        .find_map(|line| serde_json::from_str::<Value>(line).ok())
}

fn validate_vieneu_wav(path: &Path) -> Result<u64, String> {
    let bytes =
        fs::read(path).map_err(|error| format!("Không đọc được VieNeu WAV output: {error}"))?;
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("VieNeu output không có header WAV hợp lệ".to_string());
    }
    Ok(bytes.len() as u64)
}

fn omnivoice_cache_root() -> PathBuf {
    std::env::var_os("AUTO3DVIDEO_OMNIVOICE_CACHE")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"D:\Auto3DvideoTools\omnivoice\cache"))
}

pub(super) fn omnivoice_worker_environment() -> Result<BTreeMap<String, String>, String> {
    let cache_root =
        fs::canonicalize(omnivoice_cache_root()).unwrap_or_else(|_| omnivoice_cache_root());
    let value = cache_root.to_string_lossy().to_string();
    if value.len() > 4096 || value.contains(['\r', '\n', '\0']) {
        return Err("OmniVoice cache path không hợp lệ".to_string());
    }
    Ok(BTreeMap::from([(
        "AUTO3DVIDEO_OMNIVOICE_CACHE".to_string(),
        value,
    )]))
}

pub(super) fn ensure_omnivoice_worker_script(
    workspace_root: &Path,
) -> Result<(PathBuf, String), String> {
    let script_path = workspace_root
        .join(".auto3dvideo")
        .join("tools")
        .join("omnivoice_tts_worker.py");
    fs::create_dir_all(
        script_path
            .parent()
            .ok_or_else(|| "Không xác định được thư mục OmniVoice worker".to_string())?,
    )
    .map_err(|error| format!("Không tạo được thư mục OmniVoice worker: {error}"))?;
    fs::write(&script_path, OMNIVOICE_TTS_WORKER_SCRIPT)
        .map_err(|error| format!("Không ghi được OmniVoice worker: {error}"))?;
    let relative = script_path
        .strip_prefix(workspace_root)
        .map_err(|_| "OmniVoice worker vượt project workspace".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    Ok((script_path, relative))
}

fn parse_omnivoice_worker_output(result: &ExternalProcessResult) -> Option<Value> {
    result
        .stdout
        .lines()
        .rev()
        .find_map(|line| serde_json::from_str::<Value>(line).ok())
}

pub(super) fn validate_omnivoice_wav(path: &Path) -> Result<u64, String> {
    let bytes =
        fs::read(path).map_err(|error| format!("Không đọc được OmniVoice WAV output: {error}"))?;
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("OmniVoice output không có header WAV hợp lệ".to_string());
    }
    Ok(bytes.len() as u64)
}

fn validate_voice_profile_id(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.len() < 3
        || trimmed.len() > 96
        || !trimmed.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
    {
        return Err("Voice profile ID không hợp lệ".to_string());
    }
    Ok(trimmed.to_string())
}

fn validate_voice_profile_name(value: &str) -> Result<String, String> {
    valid_text(value, "Tên voice profile")?;
    let trimmed = value.trim();
    if trimmed.chars().count() < 2 || trimmed.chars().count() > 160 {
        return Err("Tên voice profile phải dài từ 2 đến 160 ký tự".to_string());
    }
    Ok(trimmed.to_string())
}

fn validate_omnivoice_language(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    let valid = (2..=3).contains(&trimmed.len())
        && trimmed
            .chars()
            .all(|character| character.is_ascii_lowercase())
        || (trimmed.len() == 5
            && trimmed.as_bytes()[2] == b'-'
            && trimmed[..2]
                .chars()
                .all(|character| character.is_ascii_lowercase())
            && trimmed[3..]
                .chars()
                .all(|character| character.is_ascii_uppercase()));
    if !valid {
        return Err("Mã ngôn ngữ phải dạng en, vi hoặc en-US".to_string());
    }
    Ok(trimmed.to_string())
}

fn validate_omnivoice_instruct(value: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = value else { return Ok(None) };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > 1000 || trimmed.contains(['\r', '\n', '\0']) {
        return Err("Voice style prompt không hợp lệ hoặc quá dài".to_string());
    }
    Ok(Some(trimmed.to_string()))
}

const OMNIVOICE_EMOTION_CODES: [&str; 22] = [
    "neutral",
    "calm",
    "warm",
    "friendly",
    "happy",
    "excited",
    "joyful",
    "triumphant",
    "sad",
    "melancholic",
    "tender",
    "concerned",
    "fearful",
    "angry",
    "shouting",
    "urgent",
    "serious",
    "surprised",
    "mysterious",
    "curious",
    "sarcastic",
    "whisper",
];

fn validate_omnivoice_emotion(value: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = value else { return Ok(None) };
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Ok(None);
    }
    if !OMNIVOICE_EMOTION_CODES.contains(&normalized.as_str()) {
        return Err(format!(
            "Mã cảm xúc không hợp lệ; dùng một trong: {}",
            OMNIVOICE_EMOTION_CODES.join(", ")
        ));
    }
    Ok(Some(normalized))
}

fn validate_reference_transcript(value: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = value else { return Ok(None) };
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 2000 || trimmed.contains(['\r', '\n', '\0'])
    {
        return Err(
            "Transcript mẫu phải dài 1–2.000 ký tự và không chứa ký tự xuống dòng".to_string(),
        );
    }
    Ok(Some(trimmed.to_string()))
}

fn voice_profile_workspace_path(workspace_root: &Path, profile_id: &str) -> PathBuf {
    workspace_root
        .join(".auto3dvideo")
        .join("voices")
        .join(profile_id)
}

fn voice_profile_json_path(workspace_root: &Path, profile_id: &str) -> PathBuf {
    voice_profile_workspace_path(workspace_root, profile_id).join("profile.json")
}

fn validate_source_audio(path: &Path) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path)
        .map_err(|error| format!("Không đọc được file audio mẫu: {error}"))?;
    let suffix = canonical
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(suffix.as_str(), "wav" | "mp3" | "flac" | "m4a" | "ogg") {
        return Err("Audio mẫu phải là WAV, MP3, FLAC, M4A hoặc OGG".to_string());
    }
    let size = fs::metadata(&canonical)
        .map_err(|error| format!("Không đọc được kích thước audio mẫu: {error}"))?
        .len();
    if size == 0 || size > 50 * 1024 * 1024 {
        return Err("Audio mẫu phải lớn hơn 0 và không vượt 50MB".to_string());
    }
    Ok(canonical)
}

fn wav_metadata(path: &Path) -> (Option<f64>, Option<u32>) {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(_) => return (None, None),
    };
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return (None, None);
    }
    let mut cursor = 12usize;
    let mut sample_rate = None;
    let mut channels = None;
    let mut bits_per_sample = None;
    let mut data_bytes = None;
    while cursor + 8 <= bytes.len() {
        let chunk_id = &bytes[cursor..cursor + 4];
        let chunk_size = u32::from_le_bytes([
            bytes[cursor + 4],
            bytes[cursor + 5],
            bytes[cursor + 6],
            bytes[cursor + 7],
        ]) as usize;
        let chunk_start = cursor + 8;
        let chunk_end = chunk_start.saturating_add(chunk_size).min(bytes.len());
        if chunk_id == b"fmt " && chunk_size >= 16 && chunk_start + 16 <= bytes.len() {
            channels = Some(u16::from_le_bytes([
                bytes[chunk_start + 2],
                bytes[chunk_start + 3],
            ]));
            sample_rate = Some(u32::from_le_bytes([
                bytes[chunk_start + 4],
                bytes[chunk_start + 5],
                bytes[chunk_start + 6],
                bytes[chunk_start + 7],
            ]));
            bits_per_sample = Some(u16::from_le_bytes([
                bytes[chunk_start + 14],
                bytes[chunk_start + 15],
            ]));
        } else if chunk_id == b"data" {
            data_bytes = Some(chunk_size.min(bytes.len().saturating_sub(chunk_start)) as u64);
        }
        cursor = chunk_end.saturating_add(chunk_size % 2);
    }
    let rate = match sample_rate.filter(|value| *value > 0) {
        Some(value) => value,
        None => return (None, None),
    };
    let channel_count = match channels.filter(|value| *value > 0) {
        Some(value) => value,
        None => return (None, Some(rate)),
    };
    let bits = match bits_per_sample.filter(|value| *value > 0) {
        Some(value) => value,
        None => return (None, Some(rate)),
    };
    let payload_bytes = match data_bytes {
        Some(value) => value,
        None => return (None, Some(rate)),
    };
    let duration = payload_bytes as f64 / (rate as f64 * channel_count as f64 * bits as f64 / 8.0);
    if duration.is_finite() && duration > 0.0 {
        (Some(duration), Some(rate))
    } else {
        (None, Some(rate))
    }
}

#[tauri::command]
pub(super) async fn check_vieneu_local(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<VieneuReadinessReport, String> {
    valid_text(&project_id, "Project ID")?;
    let (workspace_root, python_path) = {
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
        let python_path = resolve_configured_tool(&connection, "python")?;
        (PathBuf::from(workspace_root), python_path)
    };
    let workspace_root = fs::canonicalize(&workspace_root)
        .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?;
    let (_script_path, script_relative) = ensure_vieneu_worker_script(&workspace_root)?;
    let result = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "python".to_string(),
            args: vec![script_relative, "--check".to_string()],
            working_directory: ".".to_string(),
            environment: vieneu_worker_environment()?,
            timeout_seconds: 60,
            expected_outputs: Vec::new(),
        },
        executable_path: python_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root,
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    let payload = parse_vieneu_worker_output(&result)
        .ok_or_else(|| "VieNeu check không trả về JSON trạng thái hợp lệ".to_string())?;
    Ok(VieneuReadinessReport {
        status: worker_string(&payload, "status", "unknown"),
        package_installed: worker_bool(&payload, "packageInstalled"),
        package_version: payload
            .get("packageVersion")
            .and_then(Value::as_str)
            .map(|value| value.chars().take(128).collect()),
        model_id: worker_string(&payload, "modelId", "pnnbao-ump/VieNeu-TTS-v3-Turbo"),
        backend: worker_string(&payload, "backend", "onnx"),
        model_cache_path: worker_string(
            &payload,
            "modelCachePath",
            ".auto3dvideo/cache/huggingface",
        ),
        model_cache_present: worker_bool(&payload, "modelCachePresent"),
        model_download_requested: worker_bool(&payload, "modelDownloadRequested"),
        network_calls_made: worker_bool(&payload, "networkCallsMade"),
        process_started: true,
        message: worker_string(&payload, "message", "VieNeu check hoàn tất."),
    })
}

#[tauri::command]
pub(super) async fn run_vieneu_tts(
    project_id: String,
    text: String,
    voice: String,
    output_path: String,
    reference_audio_path: Option<String>,
    precision: Option<String>,
    temperature: Option<f64>,
    clone_consent: Option<bool>,
    state: State<'_, AppState>,
) -> Result<VieneuTtsReport, String> {
    valid_text(&project_id, "Project ID")?;
    let text = validate_vieneu_text(&text)?;
    let voice = validate_vieneu_voice(&voice)?;
    let output_relative = validate_attempt_output_path(&output_path)?;
    if !output_relative.to_ascii_lowercase().ends_with(".wav") {
        return Err("VieNeu output phải là file .wav".to_string());
    }
    let precision = precision.unwrap_or_else(|| "int8".to_string());
    if !matches!(precision.as_str(), "int8" | "fp32") {
        return Err("VieNeu precision chỉ nhận int8 hoặc fp32".to_string());
    }
    let temperature = temperature.unwrap_or(0.8);
    if !temperature.is_finite() || !(0.6..=1.2).contains(&temperature) {
        return Err("VieNeu temperature phải trong khoảng 0.6 đến 1.2".to_string());
    }
    let clone_consent = clone_consent.unwrap_or(false);
    let reference_relative = if let Some(reference) = reference_audio_path {
        let normalized = validate_attempt_output_path(&reference)?;
        let suffix = Path::new(&normalized)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !matches!(suffix.as_str(), "wav" | "mp3" | "flac" | "m4a" | "ogg") {
            return Err("File reference VieNeu phải là wav, mp3, flac, m4a hoặc ogg".to_string());
        }
        Some(normalized)
    } else {
        None
    };
    if reference_relative.is_some() && !clone_consent {
        return Err("Muốn dùng audio mẫu để clone phải xác nhận cloneConsent".to_string());
    }
    let (workspace_root, python_path) = {
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
            .unwrap_or_else(|_| "D:\\Duancanhan\\Auto3Dvideo".to_string());
        let python_path = resolve_configured_tool(&connection, "python")?;
        (PathBuf::from(workspace_root), python_path)
    };
    let workspace_root = fs::canonicalize(&workspace_root)
        .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?;
    if workspace_root.join(&output_relative).exists() {
        return Err("Output đã tồn tại; để tránh ghi đè, hãy chọn đường dẫn mới".to_string());
    }
    if let Some(reference) = reference_relative.as_deref() {
        resolve_workspace_file(
            &workspace_root,
            reference,
            "Reference audio",
            50 * 1024 * 1024,
        )?;
    }
    let (_script_path, script_relative) = ensure_vieneu_worker_script(&workspace_root)?;
    let request_id = now_id("vieneu");
    let request_relative = format!(".auto3dvideo/requests/{request_id}.json");
    let request_path = workspace_root.join(&request_relative);
    if let Some(parent) = request_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Không tạo được thư mục VieNeu request: {error}"))?;
    }
    let request = serde_json::json!({
        "text": text,
        "voice": voice,
        "outputPath": output_relative,
        "referenceAudioPath": reference_relative,
        "backend": "onnx",
        "precision": precision,
        "temperature": temperature,
        "cloneConsent": clone_consent,
    });
    let request_bytes = serde_json::to_vec(&request)
        .map_err(|error| format!("Không serialize được VieNeu request: {error}"))?;
    if request_bytes.len() > 256 * 1024 {
        return Err("VieNeu request vượt quá giới hạn kích thước".to_string());
    }
    fs::write(&request_path, request_bytes)
        .map_err(|error| format!("Không ghi được VieNeu request: {error}"))?;
    {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        audit_event(
            &connection,
            Some(project_id.trim()),
            "tts.vieneu_requested",
            "tts",
            &request_id,
        )?;
    }
    let process_result = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "python".to_string(),
            args: vec![
                script_relative,
                "--synthesize".to_string(),
                "--request".to_string(),
                request_relative,
            ],
            working_directory: ".".to_string(),
            environment: vieneu_worker_environment()?,
            timeout_seconds: 1800,
            expected_outputs: vec![output_relative.clone()],
        },
        executable_path: python_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await;
    let _ = fs::remove_file(&request_path);
    let process = process_result?;
    let payload = parse_vieneu_worker_output(&process);
    if !process.succeeded {
        let message = payload
            .as_ref()
            .map(|value| worker_string(value, "message", "VieNeu process không tạo output hợp lệ"))
            .unwrap_or_else(|| "VieNeu process không tạo output hợp lệ".to_string());
        if let Ok(connection) = state.database.lock() {
            let _ = audit_event(
                &connection,
                Some(project_id.trim()),
                "tts.vieneu_failed",
                "tts",
                &request_id,
            );
        }
        return Err(format!("VieNeu chưa chạy thành công: {message}"));
    }
    if payload
        .as_ref()
        .map(|value| worker_string(value, "outputPath", ""))
        .as_deref()
        != Some(output_relative.as_str())
    {
        return Err("VieNeu worker trả output path không khớp request".to_string());
    }
    let output_absolute = workspace_root.join(&output_relative);
    let size_bytes = validate_vieneu_wav(&output_absolute)?;
    {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        audit_event(
            &connection,
            Some(project_id.trim()),
            "tts.vieneu_succeeded",
            "tts",
            &request_id,
        )?;
    }
    Ok(VieneuTtsReport {
        output_path: output_relative,
        size_bytes,
        model_id: "pnnbao-ump/VieNeu-TTS-v3-Turbo".to_string(),
        voice,
        backend: "onnx".to_string(),
        precision,
        temperature,
        reference_audio_used: reference_relative.is_some(),
        clone_consent,
        model_download_requested: false,
        network_calls_made: false,
        human_review_required: true,
        output_validated: true,
        message: "Đã tạo WAV cục bộ; cần nghe và duyệt giọng trước khi dùng trong delivery."
            .to_string(),
        process,
    })
}

pub(super) fn project_workspace_and_python(
    connection: &Connection,
    project_id: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let workspace_root: String = connection
        .query_row(
            "SELECT workspace_root FROM projects WHERE project_id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Không đọc được project workspace: {error}"))?;
    let python_path = resolve_configured_tool(connection, "python")?;
    let workspace_root = fs::canonicalize(workspace_root)
        .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?;
    Ok((workspace_root, python_path))
}

fn voice_profile_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<VoiceProfileView> {
    Ok(VoiceProfileView {
        voice_profile_id: row.get(0)?,
        project_id: row.get(1)?,
        name: row.get(2)?,
        mode: row.get(3)?,
        model_id: row.get(4)?,
        language: row.get(5)?,
        instruct: row.get(6)?,
        reference_audio_path: row.get(7)?,
        reference_audio_sha256: row.get(8)?,
        reference_audio_duration_seconds: row.get(9)?,
        reference_audio_sample_rate: row.get(10)?,
        reference_transcript: row.get(11)?,
        rights_status: row.get(12)?,
        commercial_use: row.get(13)?,
        clone_consent: row.get::<_, i64>(14)? == 1,
        status: row.get(15)?,
        last_preview_path: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
    })
}

struct BuiltinVoiceProfileSpec {
    voice_profile_id: &'static str,
    name: &'static str,
    language: &'static str,
    instruct: &'static str,
}

struct DatasetVoiceProfileSpec {
    voice_profile_id: &'static str,
    name: &'static str,
    slug: &'static str,
    reference_audio: &'static str,
    reference_transcript: &'static str,
}

const BUILTIN_VOICE_PROFILE_SPECS: [BuiltinVoiceProfileSpec; 4] = [
    BuiltinVoiceProfileSpec {
        voice_profile_id: "voice-en-documentary",
        name: "English Documentary",
        language: "en",
        instruct: "male, middle-aged, low pitch, british accent",
    },
    BuiltinVoiceProfileSpec {
        voice_profile_id: "voice-en-cinematic-female",
        name: "English Cinematic Female",
        language: "en",
        instruct: "female, young adult, moderate pitch, american accent",
    },
    BuiltinVoiceProfileSpec {
        voice_profile_id: "voice-vi-documentary",
        name: "Vietnamese Documentary",
        language: "vi",
        instruct: "male, middle-aged, low pitch",
    },
    BuiltinVoiceProfileSpec {
        voice_profile_id: "voice-vi-warm-female",
        name: "Vietnamese Warm Female",
        language: "vi",
        instruct: "female, young adult, moderate pitch",
    },
];

const OMNIVOICE_VI_DATASET_ROOT_DEFAULT: &str = r"D:\Auto3DvideoTools\omnivoice-vi";

const OMNIVOICE_VI_DATASET_PROFILE_SPECS: [DatasetVoiceProfileSpec; 7] = [
    DatasetVoiceProfileSpec {
        voice_profile_id: "omnivoice-vi-ban-mai",
        name: "Ban Mai — OmniVoice VI",
        slug: "ban_mai",
        reference_audio: "ref.mp3",
        reference_transcript: "ref_text.txt",
    },
    DatasetVoiceProfileSpec {
        voice_profile_id: "omnivoice-vi-injoyreel",
        name: "InjoyReel — OmniVoice VI",
        slug: "injoyreel",
        reference_audio: "ref.wav",
        reference_transcript: "ref_text.txt",
    },
    DatasetVoiceProfileSpec {
        voice_profile_id: "omnivoice-vi-lan-trinh",
        name: "Lan Trinh — OmniVoice VI",
        slug: "lan_trinh",
        reference_audio: "ref.wav",
        reference_transcript: "ref_text.txt",
    },
    DatasetVoiceProfileSpec {
        voice_profile_id: "omnivoice-vi-ngan-ha",
        name: "Ngan Ha — OmniVoice VI",
        slug: "ngan_ha",
        reference_audio: "ref.wav",
        reference_transcript: "ref_text.txt",
    },
    DatasetVoiceProfileSpec {
        voice_profile_id: "omnivoice-vi-ngoc-huyen",
        name: "Ngoc Huyen — OmniVoice VI",
        slug: "ngoc_huyen",
        reference_audio: "ref.mp3",
        reference_transcript: "ref_text.txt",
    },
    DatasetVoiceProfileSpec {
        voice_profile_id: "omnivoice-vi-thao-trinh",
        name: "Thao Trinh — OmniVoice VI",
        slug: "thao_trinh",
        reference_audio: "ref.wav",
        reference_transcript: "ref_text.txt",
    },
    DatasetVoiceProfileSpec {
        voice_profile_id: "omnivoice-vi-tuong-vy",
        name: "Tuong Vy — OmniVoice VI",
        slug: "tuong_vy",
        reference_audio: "ref.wav",
        reference_transcript: "ref_text.txt",
    },
];

fn configured_omnivoice_vi_dataset_root() -> Option<PathBuf> {
    let configured = std::env::var_os("AUTO3DVIDEO_OMNIVOICE_VI_DATASET")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(OMNIVOICE_VI_DATASET_ROOT_DEFAULT));
    let root = fs::canonicalize(configured).ok()?;
    root.join("voices").is_dir().then_some(root)
}

fn ensure_dataset_voice_profiles(
    connection: &Connection,
    workspace_root: &Path,
    project_id: &str,
) -> Result<(), String> {
    let Some(dataset_root) = configured_omnivoice_vi_dataset_root() else {
        return Ok(());
    };

    for spec in OMNIVOICE_VI_DATASET_PROFILE_SPECS {
        let exists: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM voice_profiles WHERE voice_profile_id = ?1 AND project_id = ?2",
                params![spec.voice_profile_id, project_id],
                |row| row.get(0),
            )
            .map_err(|error| format!("Không kiểm tra được voice dataset preset: {error}"))?;
        if exists > 0 {
            continue;
        }

        let source_dir = dataset_root.join("voices").join(spec.slug);
        let source_audio = source_dir.join(spec.reference_audio);
        let source_transcript = source_dir.join(spec.reference_transcript);
        let source_audio = match validate_source_audio(&source_audio) {
            Ok(path) => path,
            Err(_) => continue,
        };
        let transcript = match fs::read_to_string(source_transcript) {
            Ok(value) => value.split_whitespace().collect::<Vec<_>>().join(" "),
            Err(_) => continue,
        };
        let transcript = validate_reference_transcript(Some(transcript))?
            .ok_or_else(|| "Transcript dataset rỗng".to_string())?;

        let profile_dir = voice_profile_workspace_path(workspace_root, spec.voice_profile_id);
        fs::create_dir_all(&profile_dir)
            .map_err(|error| format!("Không tạo được thư mục voice dataset preset: {error}"))?;
        let extension = source_audio
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("wav")
            .to_ascii_lowercase();
        let target_audio = profile_dir.join(format!("reference.{extension}"));
        if target_audio.exists() {
            if sha256_file(&target_audio)? != sha256_file(&source_audio)? {
                return Err(format!(
                    "Voice dataset preset {} đã có audio khác; không ghi đè",
                    spec.voice_profile_id
                ));
            }
        } else {
            fs::copy(&source_audio, &target_audio)
                .map_err(|error| format!("Không chép được voice dataset audio: {error}"))?;
        }
        let reference_audio_path = target_audio
            .strip_prefix(workspace_root)
            .map_err(|_| "Voice dataset audio vượt workspace".to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let reference_audio_sha256 = sha256_file(&target_audio)?;
        let (duration_seconds, sample_rate) = wav_metadata(&target_audio);
        let timestamp = now_string();
        let profile = VoiceProfileView {
            voice_profile_id: spec.voice_profile_id.to_string(),
            project_id: project_id.to_string(),
            name: spec.name.to_string(),
            mode: "clone".to_string(),
            model_id: "k2-fsa/OmniVoice".to_string(),
            language: "vi".to_string(),
            instruct: None,
            reference_audio_path: Some(reference_audio_path),
            reference_audio_sha256: Some(reference_audio_sha256),
            reference_audio_duration_seconds: duration_seconds,
            reference_audio_sample_rate: sample_rate.map(i64::from),
            reference_transcript: Some(transcript),
            rights_status: "pending".to_string(),
            commercial_use: "restricted".to_string(),
            clone_consent: false,
            status: "needs_consent".to_string(),
            last_preview_path: None,
            created_at: timestamp.clone(),
            updated_at: timestamp,
        };
        read_voice_profile_json(workspace_root, &profile)?;
        let metadata = serde_json::json!({
            "builtin": true,
            "source": "STBack23/omnivoice-vi",
            "sourceDataset": "https://huggingface.co/datasets/STBack23/omnivoice-vi",
            "datasetLicense": "apache-2.0",
            "voiceSlug": spec.slug,
            "requiresConsent": true,
        })
        .to_string();
        connection
            .execute(
                "INSERT INTO voice_profiles(voice_profile_id, project_id, name, mode, model_id, language, instruct, reference_audio_path, reference_audio_sha256, reference_audio_duration_seconds, reference_audio_sample_rate, reference_transcript, rights_status, commercial_use, clone_consent, status, last_preview_path, metadata_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 0, ?15, NULL, ?16, ?17, ?18)",
                params![
                    profile.voice_profile_id,
                    profile.project_id,
                    profile.name,
                    profile.mode,
                    profile.model_id,
                    profile.language,
                    profile.instruct,
                    profile.reference_audio_path,
                    profile.reference_audio_sha256,
                    profile.reference_audio_duration_seconds,
                    profile.reference_audio_sample_rate,
                    profile.reference_transcript,
                    profile.rights_status,
                    profile.commercial_use,
                    profile.status,
                    metadata,
                    profile.created_at,
                    profile.updated_at,
                ],
            )
            .map_err(|error| format!("Không lưu được voice dataset preset: {error}"))?;
        audit_event(
            connection,
            Some(project_id),
            "voice.profile_seeded_dataset",
            "voice_profile",
            &profile.voice_profile_id,
        )?;
    }
    Ok(())
}

fn ensure_builtin_voice_profiles(
    connection: &Connection,
    workspace_root: &Path,
    project_id: &str,
) -> Result<(), String> {
    for spec in BUILTIN_VOICE_PROFILE_SPECS {
        let exists: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM voice_profiles WHERE voice_profile_id = ?1 AND project_id = ?2",
                params![spec.voice_profile_id, project_id],
                |row| row.get(0),
            )
            .map_err(|error| format!("Không kiểm tra được voice preset mặc định: {error}"))?;
        if exists > 0 {
            // Built-in profiles are seeded once, so older workspaces can retain a
            // preset from before OmniVoice token validation was strict. Repair only
            // these reserved IDs; user-created profiles are never rewritten.
            let mut profile = connection
                .query_row(
                    "SELECT voice_profile_id, project_id, name, mode, model_id, language, instruct, reference_audio_path, reference_audio_sha256, reference_audio_duration_seconds, reference_audio_sample_rate, reference_transcript, rights_status, commercial_use, clone_consent, status, last_preview_path, created_at, updated_at FROM voice_profiles WHERE voice_profile_id = ?1 AND project_id = ?2",
                    params![spec.voice_profile_id, project_id],
                    voice_profile_from_row,
                )
                .map_err(|error| format!("Không đọc được voice preset mặc định cũ: {error}"))?;
            profile.instruct = Some(spec.instruct.to_string());
            profile.updated_at = now_string();
            read_voice_profile_json(workspace_root, &profile)?;
            connection
                .execute(
                    "UPDATE voice_profiles SET instruct = ?1, updated_at = ?2 WHERE voice_profile_id = ?3 AND project_id = ?4",
                    params![profile.instruct, profile.updated_at, spec.voice_profile_id, project_id],
                )
                .map_err(|error| format!("Không sửa được voice preset mặc định cũ: {error}"))?;
            continue;
        }

        let timestamp = now_string();
        let profile = VoiceProfileView {
            voice_profile_id: spec.voice_profile_id.to_string(),
            project_id: project_id.to_string(),
            name: spec.name.to_string(),
            mode: "design".to_string(),
            model_id: "k2-fsa/OmniVoice".to_string(),
            language: spec.language.to_string(),
            instruct: Some(spec.instruct.to_string()),
            reference_audio_path: None,
            reference_audio_sha256: None,
            reference_audio_duration_seconds: None,
            reference_audio_sample_rate: None,
            reference_transcript: None,
            rights_status: "restricted".to_string(),
            commercial_use: "restricted".to_string(),
            clone_consent: false,
            status: "ready".to_string(),
            last_preview_path: None,
            created_at: timestamp.clone(),
            updated_at: timestamp,
        };
        let profile_dir = voice_profile_workspace_path(workspace_root, &profile.voice_profile_id);
        fs::create_dir_all(&profile_dir)
            .map_err(|error| format!("Không tạo được thư mục voice preset mặc định: {error}"))?;
        read_voice_profile_json(workspace_root, &profile)?;
        connection
            .execute(
                "INSERT INTO voice_profiles(voice_profile_id, project_id, name, mode, model_id, language, instruct, reference_audio_path, reference_audio_sha256, reference_audio_duration_seconds, reference_audio_sample_rate, reference_transcript, rights_status, commercial_use, clone_consent, status, last_preview_path, metadata_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, NULL, NULL, NULL, ?8, ?9, 0, ?10, NULL, ?11, ?12, ?13)",
                params![
                    profile.voice_profile_id,
                    profile.project_id,
                    profile.name,
                    profile.mode,
                    profile.model_id,
                    profile.language,
                    profile.instruct,
                    profile.rights_status,
                    profile.commercial_use,
                    profile.status,
                    r#"{"builtin":true,"source":"Auto3Dvideo default design preset"}"#,
                    profile.created_at,
                    profile.updated_at,
                ],
            )
            .map_err(|error| format!("Không lưu được voice preset mặc định: {error}"))?;
        audit_event(
            connection,
            Some(project_id),
            "voice.profile_seeded",
            "voice_profile",
            &profile.voice_profile_id,
        )?;
    }
    ensure_dataset_voice_profiles(connection, workspace_root, project_id)?;
    Ok(())
}

fn read_voice_profile_json(
    workspace_root: &Path,
    profile: &VoiceProfileView,
) -> Result<(), String> {
    let path = voice_profile_json_path(workspace_root, &profile.voice_profile_id);
    let bytes = serde_json::to_vec_pretty(profile)
        .map_err(|error| format!("Không serialize được voice profile: {error}"))?;
    fs::write(path, bytes).map_err(|error| format!("Không ghi được voice profile: {error}"))
}

#[tauri::command]
pub(super) async fn check_omnivoice_local(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<OmniVoiceReadinessReport, String> {
    valid_text(&project_id, "Project ID")?;
    let (workspace_root, python_path) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        project_workspace_and_python(&connection, project_id.trim())?
    };
    let (_script_path, script_relative) = ensure_omnivoice_worker_script(&workspace_root)?;
    let result = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "python".to_string(),
            args: vec![script_relative, "--check".to_string()],
            working_directory: ".".to_string(),
            environment: omnivoice_worker_environment()?,
            timeout_seconds: 120,
            expected_outputs: Vec::new(),
        },
        executable_path: python_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root,
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    let payload = parse_omnivoice_worker_output(&result).ok_or_else(|| {
        format!(
            "OmniVoice check không trả JSON trạng thái hợp lệ: {}",
            result.stderr.chars().take(500).collect::<String>()
        )
    })?;
    Ok(OmniVoiceReadinessReport {
        status: worker_string(&payload, "status", "unknown"),
        package_installed: worker_bool(&payload, "packageInstalled"),
        torch_installed: worker_bool(&payload, "torchInstalled"),
        model_id: worker_string(&payload, "modelId", "k2-fsa/OmniVoice"),
        audio_tokenizer_id: worker_string(
            &payload,
            "audioTokenizerId",
            "eustlb/higgs-audio-v2-tokenizer",
        ),
        model_cache_path: worker_string(&payload, "modelCachePath", ""),
        model_cache_present: worker_bool(&payload, "modelCachePresent"),
        device: worker_string(&payload, "device", "unavailable"),
        model_download_requested: worker_bool(&payload, "modelDownloadRequested"),
        network_calls_made: worker_bool(&payload, "networkCallsMade"),
        process_started: true,
        message: worker_string(&payload, "message", "OmniVoice check hoàn tất."),
        process: result,
    })
}

#[tauri::command]
pub(super) async fn prepare_omnivoice_model(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<OmniVoiceReadinessReport, String> {
    valid_text(&project_id, "Project ID")?;
    let (workspace_root, python_path) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        project_workspace_and_python(&connection, project_id.trim())?
    };
    let (_script_path, script_relative) = ensure_omnivoice_worker_script(&workspace_root)?;
    let result = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "python".to_string(),
            args: vec![script_relative, "--prepare-model".to_string()],
            working_directory: ".".to_string(),
            environment: omnivoice_worker_environment()?,
            timeout_seconds: 7200,
            expected_outputs: Vec::new(),
        },
        executable_path: python_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root,
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    let payload = parse_omnivoice_worker_output(&result).ok_or_else(|| {
        format!(
            "OmniVoice cài model không trả JSON trạng thái hợp lệ: {}",
            result.stderr.chars().take(500).collect::<String>()
        )
    })?;
    let report = OmniVoiceReadinessReport {
        status: worker_string(&payload, "status", "unknown"),
        package_installed: worker_bool(&payload, "packageInstalled"),
        torch_installed: worker_bool(&payload, "torchInstalled"),
        model_id: worker_string(&payload, "modelId", "k2-fsa/OmniVoice"),
        audio_tokenizer_id: worker_string(
            &payload,
            "audioTokenizerId",
            "eustlb/higgs-audio-v2-tokenizer",
        ),
        model_cache_path: worker_string(&payload, "modelCachePath", ""),
        model_cache_present: worker_bool(&payload, "modelCachePresent"),
        device: worker_string(&payload, "device", "unknown"),
        model_download_requested: worker_bool(&payload, "modelDownloadRequested"),
        network_calls_made: worker_bool(&payload, "networkCallsMade"),
        process_started: true,
        message: worker_string(&payload, "message", "OmniVoice model preparation hoàn tất."),
        process: result,
    };
    if let Ok(connection) = state.database.lock() {
        let _ = audit_event(
            &connection,
            Some(project_id.trim()),
            if report.status == "ready" {
                "voice.omnivoice_model_ready"
            } else {
                "voice.omnivoice_model_failed"
            },
            "voice_model",
            "k2-fsa/OmniVoice",
        );
    }
    Ok(report)
}

#[tauri::command]
pub(super) async fn list_voice_profiles(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<VoiceProfileView>, String> {
    valid_text(&project_id, "Project ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let workspace_root = connection
        .query_row(
            "SELECT workspace_root FROM projects WHERE project_id = ?1",
            params![project_id.trim()],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| format!("Không đọc được project workspace: {error}"))?;
    let workspace_root = fs::canonicalize(workspace_root)
        .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?;
    ensure_builtin_voice_profiles(&connection, &workspace_root, project_id.trim())?;
    let mut statement = connection
        .prepare(
            "SELECT voice_profile_id, project_id, name, mode, model_id, language, instruct, reference_audio_path, reference_audio_sha256, reference_audio_duration_seconds, reference_audio_sample_rate, reference_transcript, rights_status, commercial_use, clone_consent, status, last_preview_path, created_at, updated_at FROM voice_profiles WHERE project_id = ?1 AND status <> 'deleted' ORDER BY updated_at DESC",
        )
        .map_err(|error| format!("Không đọc được voice profiles: {error}"))?;
    let rows = statement
        .query_map(params![project_id.trim()], voice_profile_from_row)
        .map_err(|error| format!("Không truy vấn được voice profiles: {error}"))?;
    rows.map(|row| row.map_err(|error| format!("Voice profile không hợp lệ: {error}")))
        .collect()
}

#[tauri::command]
pub(super) async fn list_project_voice_samples(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<VoiceSampleView>, String> {
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
    let roots = [
        (".auto3dvideo/voice-samples", "sample"),
        (".auto3dvideo/voice-recordings", "recording"),
    ];
    let manifest = workspace_root
        .join(".auto3dvideo")
        .join("voice-samples")
        .join("vivos-voice-samples-manifest.json");
    let manifest_value = fs::read_to_string(&manifest)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok());
    let mut samples = Vec::new();
    for (relative_root, source_kind) in roots {
        let root = workspace_root.join(relative_root.replace('/', "\\"));
        let entries = match fs::read_dir(&root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("Không đọc được thư mục voice local: {error}")),
        };
        for entry in entries {
            let entry =
                entry.map_err(|error| format!("Không đọc được file voice local: {error}"))?;
            let path = entry.path();
            if !entry
                .file_type()
                .map_err(|error| format!("Không đọc được loại file voice: {error}"))?
                .is_file()
            {
                continue;
            }
            let source = match validate_source_audio(&path) {
                Ok(source) => source,
                Err(_) => continue,
            };
            if !source.starts_with(&workspace_root) {
                continue;
            }
            let metadata = fs::metadata(&source)
                .map_err(|error| format!("Không đọc được metadata file voice: {error}"))?;
            let relative_path = source
                .strip_prefix(&workspace_root)
                .map_err(|_| "File voice vượt workspace".to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            let (duration_seconds, sample_rate) = wav_metadata(&source);
            let modified_unix_seconds = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs())
                .unwrap_or_default();
            let manifest_sample = manifest_value
                .as_ref()
                .and_then(|value| value.get("samples"))
                .and_then(Value::as_array)
                .and_then(|items| {
                    items.iter().find(|item| {
                        item.get("fileName")
                            .and_then(Value::as_str)
                            .map(|file_name| file_name == entry.file_name().to_string_lossy())
                            .unwrap_or(false)
                    })
                });
            samples.push(VoiceSampleView {
                relative_path,
                file_name: entry.file_name().to_string_lossy().to_string(),
                source_kind: source_kind.to_string(),
                size_bytes: metadata.len(),
                duration_seconds,
                sample_rate,
                modified_unix_seconds,
                transcript: manifest_sample
                    .and_then(|item| item.get("transcript"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                license: manifest_value
                    .as_ref()
                    .and_then(|value| value.get("license"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                source_dataset: manifest_value
                    .as_ref()
                    .and_then(|value| value.get("sourceDataset"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
            });
        }
    }
    samples.sort_by(|left, right| {
        right
            .modified_unix_seconds
            .cmp(&left.modified_unix_seconds)
            .then_with(|| left.file_name.cmp(&right.file_name))
    });
    Ok(samples)
}

#[tauri::command]
pub(super) async fn create_voice_profile(
    project_id: String,
    name: String,
    mode: String,
    language: String,
    instruct: Option<String>,
    source_audio_path: Option<String>,
    reference_transcript: Option<String>,
    clone_consent: bool,
    state: State<'_, AppState>,
) -> Result<VoiceProfileView, String> {
    valid_text(&project_id, "Project ID")?;
    let name = validate_voice_profile_name(&name)?;
    if !matches!(mode.as_str(), "clone" | "design") {
        return Err("Voice profile mode chỉ nhận clone hoặc design".to_string());
    }
    let language = validate_omnivoice_language(&language)?;
    let instruct = validate_omnivoice_instruct(instruct)?;
    let reference_transcript = validate_reference_transcript(reference_transcript)?;
    if mode == "design" && instruct.is_none() {
        return Err(
            "Voice design cần mô tả giọng, nhịp, cảm xúc và phong cách bằng instruct".to_string(),
        );
    }
    if mode == "clone" && (source_audio_path.is_none() || reference_transcript.is_none()) {
        return Err(
            "Voice clone cần file audio mẫu và transcript chính xác của file đó".to_string(),
        );
    }
    let (workspace_root, _python_path) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        project_workspace_and_python(&connection, project_id.trim())?
    };
    let profile_id = now_id("voice");
    let profile_dir = voice_profile_workspace_path(&workspace_root, &profile_id);
    fs::create_dir_all(&profile_dir)
        .map_err(|error| format!("Không tạo được thư mục voice profile: {error}"))?;
    let (reference_audio_path, reference_audio_sha256) = if let Some(source) = source_audio_path {
        let source_text = source.trim();
        let source_path = Path::new(source_text);
        let source_path = if source_path.is_absolute() {
            source_path.to_path_buf()
        } else {
            let normalized = validate_attempt_output_path(source_text)?;
            workspace_root.join(normalized)
        };
        let source = validate_source_audio(&source_path)?;
        if !source.starts_with(&workspace_root) && !Path::new(source_text).is_absolute() {
            return Err("Audio thu trong workspace không hợp lệ".to_string());
        }
        let suffix = source
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("wav")
            .to_ascii_lowercase();
        let target = profile_dir.join(format!("reference.{suffix}"));
        fs::copy(&source, &target)
            .map_err(|error| format!("Không chép được audio mẫu vào data workspace: {error}"))?;
        let relative = target
            .strip_prefix(&workspace_root)
            .map_err(|_| "Audio mẫu vượt workspace".to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        (Some(relative), Some(sha256_file(&target)?))
    } else {
        (None, None)
    };
    let timestamp = now_string();
    let status = if mode == "clone" && !clone_consent {
        "needs_consent"
    } else {
        "ready"
    };
    let rights_status = if mode == "clone" && clone_consent {
        "personal"
    } else if mode == "clone" {
        "pending"
    } else {
        "restricted"
    };
    let profile = VoiceProfileView {
        voice_profile_id: profile_id.clone(),
        project_id: project_id.trim().to_string(),
        name,
        mode,
        model_id: "k2-fsa/OmniVoice".to_string(),
        language,
        instruct,
        reference_audio_path,
        reference_audio_sha256,
        reference_audio_duration_seconds: None,
        reference_audio_sample_rate: None,
        reference_transcript,
        rights_status: rights_status.to_string(),
        commercial_use: "restricted".to_string(),
        clone_consent,
        status: status.to_string(),
        last_preview_path: None,
        created_at: timestamp.clone(),
        updated_at: timestamp,
    };
    read_voice_profile_json(&workspace_root, &profile)?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    connection
        .execute(
            "INSERT INTO voice_profiles(voice_profile_id, project_id, name, mode, model_id, language, instruct, reference_audio_path, reference_audio_sha256, reference_audio_duration_seconds, reference_audio_sample_rate, reference_transcript, rights_status, commercial_use, clone_consent, status, last_preview_path, metadata_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, '{}', ?18, ?19)",
            params![
                profile.voice_profile_id,
                profile.project_id,
                profile.name,
                profile.mode,
                profile.model_id,
                profile.language,
                profile.instruct,
                profile.reference_audio_path,
                profile.reference_audio_sha256,
                profile.reference_audio_duration_seconds,
                profile.reference_audio_sample_rate,
                profile.reference_transcript,
                profile.rights_status,
                profile.commercial_use,
                i64::from(profile.clone_consent),
                profile.status,
                profile.last_preview_path,
                profile.created_at,
                profile.updated_at,
            ],
        )
        .map_err(|error| format!("Không lưu được voice profile: {error}"))?;
    audit_event(
        &connection,
        Some(project_id.trim()),
        "voice.profile_created",
        "voice_profile",
        &profile.voice_profile_id,
    )?;
    Ok(profile)
}

#[tauri::command]
pub(super) async fn update_voice_profile(
    project_id: String,
    voice_profile_id: String,
    name: String,
    language: String,
    instruct: Option<String>,
    reference_transcript: Option<String>,
    clone_consent: bool,
    state: State<'_, AppState>,
) -> Result<VoiceProfileView, String> {
    valid_text(&project_id, "Project ID")?;
    let voice_profile_id = validate_voice_profile_id(&voice_profile_id)?;
    let name = validate_voice_profile_name(&name)?;
    let language = validate_omnivoice_language(&language)?;
    let instruct = validate_omnivoice_instruct(instruct)?;
    let reference_transcript = validate_reference_transcript(reference_transcript)?;
    let (workspace_root, profile) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        let profile = connection
            .query_row(
                "SELECT voice_profile_id, project_id, name, mode, model_id, language, instruct, reference_audio_path, reference_audio_sha256, reference_audio_duration_seconds, reference_audio_sample_rate, reference_transcript, rights_status, commercial_use, clone_consent, status, last_preview_path, created_at, updated_at FROM voice_profiles WHERE voice_profile_id = ?1 AND project_id = ?2 AND status <> 'deleted'",
                params![voice_profile_id, project_id.trim()],
                voice_profile_from_row,
            )
            .map_err(|error| format!("Không tìm thấy voice profile: {error}"))?;
        let workspace_root = PathBuf::from(
            connection
                .query_row(
                    "SELECT workspace_root FROM projects WHERE project_id = ?1",
                    params![project_id.trim()],
                    |row| row.get::<_, String>(0),
                )
                .map_err(|error| format!("Không đọc được workspace: {error}"))?,
        );
        (
            fs::canonicalize(workspace_root).map_err(|error| error.to_string())?,
            profile,
        )
    };
    if profile.mode == "design" && instruct.is_none() {
        return Err("Voice design cần instruct".to_string());
    }
    if profile.mode == "clone"
        && (profile.reference_audio_path.is_none() || reference_transcript.is_none())
    {
        return Err("Voice clone cần transcript trước khi lưu".to_string());
    }
    let status = if profile.mode == "clone" && !clone_consent {
        "needs_consent"
    } else {
        "ready"
    };
    let rights_status = if profile.mode == "clone" && clone_consent {
        "personal"
    } else if profile.mode == "clone" {
        "pending"
    } else {
        "restricted"
    };
    let updated = VoiceProfileView {
        name,
        language,
        instruct,
        reference_transcript,
        clone_consent,
        status: status.to_string(),
        rights_status: rights_status.to_string(),
        updated_at: now_string(),
        ..profile
    };
    read_voice_profile_json(&workspace_root, &updated)?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    connection
        .execute(
            "UPDATE voice_profiles SET name=?1, language=?2, instruct=?3, reference_transcript=?4, rights_status=?5, clone_consent=?6, status=?7, updated_at=?8 WHERE voice_profile_id=?9 AND project_id=?10",
            params![
                updated.name,
                updated.language,
                updated.instruct,
                updated.reference_transcript,
                updated.rights_status,
                i64::from(updated.clone_consent),
                updated.status,
                updated.updated_at,
                updated.voice_profile_id,
                updated.project_id,
            ],
        )
        .map_err(|error| format!("Không cập nhật được voice profile: {error}"))?;
    audit_event(
        &connection,
        Some(project_id.trim()),
        "voice.profile_updated",
        "voice_profile",
        &updated.voice_profile_id,
    )?;
    Ok(updated)
}

#[tauri::command]
pub(super) async fn delete_voice_profile(
    project_id: String,
    voice_profile_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    valid_text(&project_id, "Project ID")?;
    let voice_profile_id = validate_voice_profile_id(&voice_profile_id)?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let active_jobs: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM voice_synthesis_jobs WHERE voice_profile_id=?1 AND state IN ('queued','validating','running')",
            params![voice_profile_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Không kiểm tra được voice jobs: {error}"))?;
    if active_jobs > 0 {
        return Err("Voice profile đang có job chạy; chờ hoàn tất trước khi xoá".to_string());
    }
    let changed = connection
        .execute(
            "UPDATE voice_profiles SET status='deleted', deleted_at=?1, updated_at=?1 WHERE voice_profile_id=?2 AND project_id=?3 AND status <> 'deleted'",
            params![now_string(), voice_profile_id, project_id.trim()],
        )
        .map_err(|error| format!("Không xoá được voice profile: {error}"))?;
    if changed == 0 {
        return Err("Không tìm thấy voice profile hoặc profile đã xoá".to_string());
    }
    audit_event(
        &connection,
        Some(project_id.trim()),
        "voice.profile_deleted",
        "voice_profile",
        &voice_profile_id,
    )?;
    Ok(())
}

#[tauri::command]
pub(super) async fn run_omnivoice_tts(
    project_id: String,
    voice_profile_id: String,
    text: String,
    emotion_code: Option<String>,
    language: Option<String>,
    output_path: String,
    speed: Option<f64>,
    duration_seconds: Option<f64>,
    quality_preset: Option<String>,
    class_temperature: Option<f64>,
    position_temperature: Option<f64>,
    normalize_text: Option<bool>,
    state: State<'_, AppState>,
) -> Result<OmniVoiceTtsReport, String> {
    valid_text(&project_id, "Project ID")?;
    let voice_profile_id = validate_voice_profile_id(&voice_profile_id)?;
    let text = validate_vieneu_text(&text)?;
    let emotion_code = validate_omnivoice_emotion(emotion_code)?;
    let speed = speed.unwrap_or(1.0);
    if !speed.is_finite() || !(0.5..=2.0).contains(&speed) {
        return Err("Tốc độ giọng phải trong khoảng 0.5 đến 2.0".to_string());
    }
    let duration_seconds = duration_seconds.filter(|value| value.is_finite());
    if duration_seconds.is_some_and(|value| !(0.5..=600.0).contains(&value)) {
        return Err("Thời lượng ép phải trong khoảng 0.5 đến 600 giây".to_string());
    }
    let quality_preset = quality_preset.unwrap_or_else(|| "preview".to_string());
    if !matches!(quality_preset.as_str(), "preview" | "balanced" | "quality") {
        return Err("Chất lượng chỉ nhận preview, balanced hoặc quality".to_string());
    }
    let class_temperature = class_temperature.unwrap_or(0.0);
    let position_temperature = position_temperature.unwrap_or(5.0);
    if !class_temperature.is_finite()
        || !(0.0..=2.0).contains(&class_temperature)
        || !position_temperature.is_finite()
        || !(0.0..=10.0).contains(&position_temperature)
    {
        return Err("Thông số nhiệt độ OmniVoice không hợp lệ".to_string());
    }
    let output_relative = validate_attempt_output_path(&output_path)?;
    if !output_relative.to_ascii_lowercase().ends_with(".wav") {
        return Err("OmniVoice output phải là file .wav".to_string());
    }
    let (workspace_root, python_path, profile) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        let profile = connection
            .query_row(
                "SELECT voice_profile_id, project_id, name, mode, model_id, language, instruct, reference_audio_path, reference_audio_sha256, reference_audio_duration_seconds, reference_audio_sample_rate, reference_transcript, rights_status, commercial_use, clone_consent, status, last_preview_path, created_at, updated_at FROM voice_profiles WHERE voice_profile_id=?1 AND project_id=?2 AND status <> 'deleted'",
                params![voice_profile_id, project_id.trim()],
                voice_profile_from_row,
            )
            .map_err(|error| format!("Không tìm thấy voice profile: {error}"))?;
        let (workspace_root, python_path) =
            project_workspace_and_python(&connection, project_id.trim())?;
        (workspace_root, python_path, profile)
    };
    if profile.model_id != "k2-fsa/OmniVoice" {
        return Err("Voice profile không dùng model OmniVoice".to_string());
    }
    if profile.status != "ready" {
        return Err("Voice profile chưa ở trạng thái ready; hãy lưu quyền clone trước".to_string());
    }
    if profile.mode == "clone"
        && (!profile.clone_consent
            || profile.reference_audio_path.is_none()
            || profile.reference_transcript.is_none())
    {
        return Err("Voice clone cần audio mẫu, transcript và xác nhận quyền sử dụng".to_string());
    }
    if profile.mode == "design" && profile.instruct.is_none() {
        return Err("Voice design chưa có mô tả giọng".to_string());
    }
    if workspace_root.join(&output_relative).exists() {
        return Err(
            "Output đã tồn tại; để tránh ghi đè, hãy thử lại với tên preview mới".to_string(),
        );
    }
    let (_script_path, script_relative) = ensure_omnivoice_worker_script(&workspace_root)?;
    let request_id = now_id("omnivoice");
    let request_relative = format!(".auto3dvideo/requests/{request_id}.json");
    let request_path = workspace_root.join(&request_relative);
    fs::create_dir_all(
        request_path
            .parent()
            .ok_or_else(|| "Không tạo được request directory".to_string())?,
    )
    .map_err(|error| format!("Không tạo được OmniVoice request directory: {error}"))?;
    let request = serde_json::json!({
        "schemaVersion": "1.0.0",
        "requestId": request_id,
        "projectId": project_id.trim(),
        "voiceProfileId": profile.voice_profile_id,
        "modelId": "k2-fsa/OmniVoice",
        "mode": profile.mode,
        "text": text,
        "emotionCode": emotion_code,
        "language": language.clone().map(|value| validate_omnivoice_language(&value)).transpose()?.unwrap_or(profile.language.clone()),
        "instruct": profile.instruct,
        "referenceAudioPath": profile.reference_audio_path,
        "referenceTranscript": profile.reference_transcript,
        "outputPath": output_relative,
        "speed": speed,
        "durationSeconds": duration_seconds,
        "qualityPreset": quality_preset,
        "classTemperature": class_temperature,
        "positionTemperature": position_temperature,
        "normalizeText": normalize_text.unwrap_or(false),
        "postprocessOutput": true,
        "cloneConsent": profile.clone_consent,
        "networkCallsAllowed": false,
        "idempotencyKey": request_id,
    });
    fs::write(
        &request_path,
        serde_json::to_vec(&request)
            .map_err(|error| format!("Không serialize OmniVoice request: {error}"))?,
    )
    .map_err(|error| format!("Không ghi được OmniVoice request: {error}"))?;
    {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        connection
            .execute(
                "INSERT INTO voice_synthesis_jobs(synthesis_id, project_id, voice_profile_id, state, request_path, output_path, created_at, updated_at) VALUES (?1, ?2, ?3, 'running', ?4, ?5, ?6, ?6)",
                params![request_id, project_id.trim(), profile.voice_profile_id, request_relative, output_relative, now_string()],
            )
            .map_err(|error| format!("Không ghi được voice synthesis job: {error}"))?;
        audit_event(
            &connection,
            Some(project_id.trim()),
            "voice.synthesis_started",
            "voice_synthesis",
            &request_id,
        )?;
    }
    let process_result = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "python".to_string(),
            args: vec![
                script_relative,
                "--synthesize".to_string(),
                "--request".to_string(),
                request_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: omnivoice_worker_environment()?,
            timeout_seconds: 1800,
            expected_outputs: vec![output_relative.clone()],
        },
        executable_path: python_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await;
    let _ = fs::remove_file(&request_path);
    let process = match process_result {
        Ok(process) => process,
        Err(error) => {
            if let Ok(connection) = state.database.lock() {
                let _ = connection.execute("UPDATE voice_synthesis_jobs SET state='failed', error_message=?1, updated_at=?2 WHERE synthesis_id=?3", params![error, now_string(), request_id]);
                let _ = audit_event(
                    &connection,
                    Some(project_id.trim()),
                    "voice.synthesis_failed",
                    "voice_synthesis",
                    &request_id,
                );
            }
            return Err("OmniVoice process không khởi động được".to_string());
        }
    };
    let payload = parse_omnivoice_worker_output(&process);
    if !process.succeeded {
        let message = payload
            .as_ref()
            .map(|value| worker_string(value, "message", "OmniVoice không tạo output hợp lệ"))
            .unwrap_or_else(|| "OmniVoice không tạo output hợp lệ".to_string());
        if let Ok(connection) = state.database.lock() {
            let _ = connection.execute("UPDATE voice_synthesis_jobs SET state='failed', error_message=?1, updated_at=?2 WHERE synthesis_id=?3", params![message, now_string(), request_id]);
            let _ = audit_event(
                &connection,
                Some(project_id.trim()),
                "voice.synthesis_failed",
                "voice_synthesis",
                &request_id,
            );
        }
        return Err(format!("OmniVoice chưa chạy thành công: {message}"));
    }
    if payload
        .as_ref()
        .map(|value| worker_string(value, "outputPath", ""))
        .as_deref()
        != Some(output_relative.as_str())
    {
        return Err("OmniVoice worker trả output path không khớp request".to_string());
    }
    let output_absolute = workspace_root.join(&output_relative);
    let size_bytes = validate_omnivoice_wav(&output_absolute)?;
    let duration_report = payload
        .as_ref()
        .and_then(|value| value.get("durationSeconds"))
        .and_then(Value::as_f64);
    let sample_rate = payload
        .as_ref()
        .and_then(|value| value.get("sampleRate"))
        .and_then(Value::as_u64)
        .map(|value| value as u32);
    {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        connection.execute("UPDATE voice_synthesis_jobs SET state='succeeded', updated_at=?1 WHERE synthesis_id=?2", params![now_string(), request_id]).map_err(|error| error.to_string())?;
        connection.execute("UPDATE voice_profiles SET last_preview_path=?1, updated_at=?2 WHERE voice_profile_id=?3 AND project_id=?4", params![output_relative, now_string(), profile.voice_profile_id, project_id.trim()]).map_err(|error| error.to_string())?;
        audit_event(
            &connection,
            Some(project_id.trim()),
            "voice.synthesis_succeeded",
            "voice_synthesis",
            &request_id,
        )?;
    }
    Ok(OmniVoiceTtsReport {
        status: "succeeded".to_string(),
        output_path: output_relative,
        size_bytes,
        model_id: "k2-fsa/OmniVoice".to_string(),
        voice_profile_id: profile.voice_profile_id,
        mode: profile.mode,
        language: language.unwrap_or(profile.language),
        duration_seconds: duration_report,
        sample_rate,
        device: worker_string(
            payload.as_ref().unwrap_or(&Value::Null),
            "device",
            "unknown",
        ),
        model_download_requested: false,
        network_calls_made: false,
        human_review_required: true,
        output_validated: true,
        message: "Đã tạo WAV OmniVoice local; hãy nghe và duyệt trước khi đưa vào video."
            .to_string(),
        process,
    })
}
