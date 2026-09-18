use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Arc},
};
use tauri::State;

use super::{
    external_worker::{run_external_process, ExternalProcessRequest, ExternalProcessResult},
    process_executor::ProcessSpec,
    resolve_workspace_file, valid_text, AppState,
};

const SUBTITLE_WORKER_SCRIPT: &str = include_str!("../../../scripts/subtitle_worker.py");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadSubtitleRequest {
    pub project_id: String,
    pub input_path: String,
    pub source_video_path: String,
    pub source_language: String,
    pub target_language: String,
    pub duration_seconds: f64,
    pub format: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSubtitleRequest {
    pub project_id: String,
    pub document: Value,
    pub output_path: String,
    pub format: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeSubtitleVideoRequest {
    pub project_id: String,
    pub video_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BurnInSubtitleRequest {
    pub project_id: String,
    pub video_path: String,
    pub subtitle_path: String,
    pub output_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleDocumentReport {
    pub status: String,
    pub document: Option<Value>,
    pub output_path: Option<String>,
    pub output_size_bytes: Option<u64>,
    pub output_sha256: Option<String>,
    pub format: Option<String>,
    pub network_calls_made: bool,
    pub cost_status: String,
    pub human_review_required: bool,
    pub message: String,
    pub process: Option<ExternalProcessResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleVideoProbeReport {
    pub status: String,
    pub video_path: String,
    pub duration_seconds: Option<f64>,
    pub width: Option<u64>,
    pub height: Option<u64>,
    pub video_codec: Option<String>,
    pub audio_present: bool,
    pub network_calls_made: bool,
    pub cost_status: String,
    pub message: String,
    pub process: ExternalProcessResult,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleBurnInReport {
    pub status: String,
    pub video_path: String,
    pub subtitle_path: String,
    pub output_path: String,
    pub output_size_bytes: u64,
    pub output_sha256: String,
    pub duration_seconds: Option<f64>,
    pub network_calls_made: bool,
    pub cost_status: String,
    pub human_review_required: bool,
    pub message: String,
    pub ffmpeg: ExternalProcessResult,
    pub ffprobe: ExternalProcessResult,
}

fn safe_format(value: Option<String>, fallback: &str) -> Result<String, String> {
    let format = value
        .unwrap_or_else(|| fallback.to_string())
        .trim()
        .to_ascii_lowercase();
    if !matches!(format.as_str(), "srt" | "vtt") {
        return Err("Subtitle format chỉ nhận srt hoặc vtt".to_string());
    }
    Ok(format)
}

fn safe_relative(value: &str, field: &str) -> Result<String, String> {
    let normalized = value.trim().replace('\\', "/");
    if normalized.is_empty()
        || normalized.starts_with('/')
        || normalized.starts_with("//")
        || normalized.contains("://")
        || normalized.as_bytes().get(1) == Some(&b':')
        || normalized
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || normalized.contains(['\0', '\r', '\n', '\'', '"'])
    {
        return Err(format!("{field} không phải đường dẫn workspace an toàn"));
    }
    Ok(normalized)
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file =
        fs::File::open(path).map_err(|error| format!("Không mở được file hash: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Không đọc được file hash: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn workspace_for_project(state: &State<'_, AppState>, project_id: &str) -> Result<PathBuf, String> {
    valid_text(project_id, "Project ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let root: String = connection
        .query_row(
            "SELECT workspace_root FROM projects WHERE project_id = ?1",
            rusqlite::params![project_id.trim()],
            |row| row.get(0),
        )
        .map_err(|error| format!("Không đọc được project workspace: {error}"))?;
    fs::canonicalize(PathBuf::from(root))
        .map_err(|error| format!("Không canonicalize được project workspace: {error}"))
}

fn ensure_worker(workspace: &Path) -> Result<String, String> {
    let path = workspace
        .join(".auto3dvideo")
        .join("tools")
        .join("subtitle_worker.py");
    fs::create_dir_all(
        path.parent()
            .ok_or_else(|| "Không xác định được thư mục subtitle worker".to_string())?,
    )
    .map_err(|error| format!("Không tạo được thư mục subtitle worker: {error}"))?;
    fs::write(&path, SUBTITLE_WORKER_SCRIPT)
        .map_err(|error| format!("Không ghi được subtitle worker: {error}"))?;
    path.strip_prefix(workspace)
        .map_err(|_| "Subtitle worker vượt project workspace".to_string())
        .map(|value| value.to_string_lossy().replace('\\', "/"))
}

fn parse_worker_json(process: &ExternalProcessResult) -> Result<Value, String> {
    serde_json::from_str(process.stdout.trim()).map_err(|error| {
        let detail = process.stderr.trim().chars().take(400).collect::<String>();
        if detail.is_empty() {
            format!("Subtitle worker không trả JSON hợp lệ: {error}")
        } else {
            format!("Subtitle worker không trả JSON hợp lệ: {error}; {detail}")
        }
    })
}

fn write_request(workspace: &Path, request: &Value) -> Result<(PathBuf, String), String> {
    let request_id = format!("subtitle-{}", super::now_id("request"));
    let relative = format!(".auto3dvideo/requests/{request_id}.json");
    let path = workspace.join(&relative);
    fs::create_dir_all(
        path.parent()
            .ok_or_else(|| "Không xác định được request directory".to_string())?,
    )
    .map_err(|error| format!("Không tạo được subtitle request directory: {error}"))?;
    let bytes = serde_json::to_vec(request)
        .map_err(|error| format!("Không serialize subtitle request: {error}"))?;
    if bytes.len() > 512 * 1024 {
        return Err("Subtitle request vượt quá 512 KiB".to_string());
    }
    fs::File::create(&path)
        .and_then(|mut file| file.write_all(&bytes))
        .map_err(|error| format!("Không ghi được subtitle request: {error}"))?;
    Ok((path, relative))
}

async fn run_worker(
    workspace: &Path,
    python_path: PathBuf,
    request: Value,
    expected_outputs: Vec<String>,
) -> Result<(Value, ExternalProcessResult), String> {
    let script_relative = ensure_worker(workspace)?;
    let (request_path, request_relative) = write_request(workspace, &request)?;
    let result = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "python".to_string(),
            args: vec![script_relative, "--request".to_string(), request_relative],
            working_directory: ".".to_string(),
            environment: std::collections::BTreeMap::new(),
            timeout_seconds: 600,
            expected_outputs,
        },
        executable_path: python_path,
        absolute_working_directory: workspace.to_path_buf(),
        output_root: workspace.to_path_buf(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    let _ = fs::remove_file(request_path);
    let payload = parse_worker_json(&result)?;
    if !result.succeeded || payload.get("status").and_then(Value::as_str) != Some("succeeded") {
        return Err(payload
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Subtitle worker thất bại")
            .to_string());
    }
    Ok((payload, result))
}

fn configured_tools(
    state: &State<'_, AppState>,
    project_id: &str,
) -> Result<(PathBuf, PathBuf, PathBuf, PathBuf), String> {
    let workspace = workspace_for_project(state, project_id)?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    Ok((
        workspace,
        super::resolve_configured_tool(&connection, "python")?,
        super::resolve_configured_tool(&connection, "ffmpeg")?,
        super::resolve_configured_tool(&connection, "ffprobe")?,
    ))
}

#[tauri::command]
pub async fn load_subtitle_document(
    request: LoadSubtitleRequest,
    state: State<'_, AppState>,
) -> Result<SubtitleDocumentReport, String> {
    let format = safe_format(request.format.clone(), "srt")?;
    let input_relative = safe_relative(&request.input_path, "inputPath")?;
    let source_video_relative = safe_relative(&request.source_video_path, "sourceVideoPath")?;
    if !(0.0..=604800.0).contains(&request.duration_seconds) || request.duration_seconds <= 0.0 {
        return Err("durationSeconds không hợp lệ".to_string());
    }
    let (workspace, python, _, _) = configured_tools(&state, &request.project_id)?;
    resolve_workspace_file(
        &workspace,
        &input_relative,
        "Subtitle input",
        50 * 1024 * 1024,
    )?;
    resolve_workspace_file(
        &workspace,
        &source_video_relative,
        "Source video",
        4 * 1024 * 1024 * 1024,
    )?;
    let document_id = format!("subtitle-{}", super::now_id("document"));
    let payload = serde_json::json!({
        "operation": "load",
        "inputPath": input_relative,
        "sourceVideoPath": source_video_relative,
        "sourceLanguage": request.source_language.trim(),
        "targetLanguage": request.target_language.trim(),
        "durationSeconds": request.duration_seconds,
        "documentId": document_id,
        "format": format,
    });
    let (worker_payload, process) = run_worker(&workspace, python, payload, Vec::new())
        .await
        .map_err(|error| format!("Không đọc được subtitle: {error}"))?;
    Ok(SubtitleDocumentReport {
        status: "needs_review".to_string(),
        document: worker_payload.get("document").cloned(),
        output_path: None,
        output_size_bytes: None,
        output_sha256: None,
        format: Some(format),
        network_calls_made: false,
        cost_status: "local_only".to_string(),
        human_review_required: true,
        message: "Đã đọc subtitle local; hãy sửa và validate trước khi xuất.".to_string(),
        process: Some(process),
    })
}

#[tauri::command]
pub async fn save_subtitle_document(
    request: SaveSubtitleRequest,
    state: State<'_, AppState>,
) -> Result<SubtitleDocumentReport, String> {
    let format = safe_format(request.format.clone(), "srt")?;
    let output_relative = safe_relative(&request.output_path, "outputPath")?;
    let (workspace, python, _, _) = configured_tools(&state, &request.project_id)?;
    if workspace.join(&output_relative).exists() {
        return Err("Subtitle output đã tồn tại; chọn tên file mới để tránh ghi đè".to_string());
    }
    let payload = serde_json::json!({
        "operation": "save",
        "document": request.document,
        "outputPath": output_relative,
        "format": format,
    });
    let (worker_payload, process) =
        run_worker(&workspace, python, payload, vec![output_relative.clone()])
            .await
            .map_err(|error| format!("Không xuất được subtitle: {error}"))?;
    let output_absolute = workspace.join(&output_relative);
    let size_bytes = fs::metadata(&output_absolute)
        .map_err(|error| format!("Không đọc được subtitle output: {error}"))?
        .len();
    let hash = sha256_file(&output_absolute)?;
    Ok(SubtitleDocumentReport {
        status: "needs_review".to_string(),
        document: None,
        output_path: Some(output_relative),
        output_size_bytes: Some(size_bytes),
        output_sha256: Some(hash),
        format: Some(format),
        network_calls_made: false,
        cost_status: "local_only".to_string(),
        human_review_required: true,
        message: worker_payload
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("Đã xuất subtitle local; cần review")
            .to_string(),
        process: Some(process),
    })
}

#[tauri::command]
pub async fn probe_subtitle_video(
    request: ProbeSubtitleVideoRequest,
    state: State<'_, AppState>,
) -> Result<SubtitleVideoProbeReport, String> {
    let video_relative = safe_relative(&request.video_path, "videoPath")?;
    let (workspace, _, _, ffprobe) = configured_tools(&state, &request.project_id)?;
    resolve_workspace_file(
        &workspace,
        &video_relative,
        "Video input",
        4 * 1024 * 1024 * 1024,
    )?;
    let process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "ffprobe".to_string(),
            args: vec![
                "-v".to_string(),
                "error".to_string(),
                "-show_entries".to_string(),
                "format=duration:stream=codec_type,codec_name,width,height".to_string(),
                "-of".to_string(),
                "json".to_string(),
                video_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: std::collections::BTreeMap::new(),
            timeout_seconds: 60,
            expected_outputs: Vec::new(),
        },
        executable_path: ffprobe,
        absolute_working_directory: workspace.clone(),
        output_root: workspace,
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    if !process.succeeded {
        return Err("FFprobe không đọc được video input".to_string());
    }
    let parsed: Value = serde_json::from_str(process.stdout.trim())
        .map_err(|error| format!("FFprobe trả JSON không hợp lệ: {error}"))?;
    let streams = parsed
        .get("streams")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let video = streams
        .iter()
        .find(|stream| stream.get("codec_type").and_then(Value::as_str) == Some("video"));
    let duration = parsed
        .get("format")
        .and_then(|format| format.get("duration"))
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<f64>().ok());
    Ok(SubtitleVideoProbeReport {
        status: if duration.is_some() {
            "ready"
        } else {
            "needs_review"
        }
        .to_string(),
        video_path: video_relative,
        duration_seconds: duration,
        width: video
            .and_then(|value| value.get("width"))
            .and_then(Value::as_u64),
        height: video
            .and_then(|value| value.get("height"))
            .and_then(Value::as_u64),
        video_codec: video
            .and_then(|value| value.get("codec_name"))
            .and_then(Value::as_str)
            .map(str::to_string),
        audio_present: streams
            .iter()
            .any(|stream| stream.get("codec_type").and_then(Value::as_str) == Some("audio")),
        network_calls_made: false,
        cost_status: "local_only".to_string(),
        message: "Đã probe video local; chưa tải lên và chưa thay đổi file gốc.".to_string(),
        process,
    })
}

fn filter_path(relative: &str) -> String {
    relative
        .replace('\\', "/")
        .replace(':', "\\:")
        .replace('\'', "\\'")
}

#[tauri::command]
pub async fn burn_in_subtitles(
    request: BurnInSubtitleRequest,
    state: State<'_, AppState>,
) -> Result<SubtitleBurnInReport, String> {
    let video_relative = safe_relative(&request.video_path, "videoPath")?;
    let subtitle_relative = safe_relative(&request.subtitle_path, "subtitlePath")?;
    let output_relative = safe_relative(&request.output_path, "outputPath")?;
    if !output_relative.to_ascii_lowercase().ends_with(".mp4") {
        return Err("Burn-in output phải là file .mp4".to_string());
    }
    let (workspace, _, ffmpeg, ffprobe) = configured_tools(&state, &request.project_id)?;
    resolve_workspace_file(
        &workspace,
        &video_relative,
        "Video input",
        4 * 1024 * 1024 * 1024,
    )?;
    resolve_workspace_file(
        &workspace,
        &subtitle_relative,
        "Subtitle input",
        50 * 1024 * 1024,
    )?;
    if workspace.join(&output_relative).exists() {
        return Err("Burn-in output đã tồn tại; chọn tên file mới để tránh ghi đè".to_string());
    }
    let ffmpeg_result = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "ffmpeg".to_string(),
            args: vec![
                "-hide_banner".to_string(),
                "-y".to_string(),
                "-i".to_string(),
                video_relative.clone(),
                "-vf".to_string(),
                format!(
                    "subtitles={}:charenc=UTF-8",
                    filter_path(&subtitle_relative)
                ),
                "-map".to_string(),
                "0:v:0".to_string(),
                "-map".to_string(),
                "0:a?".to_string(),
                "-c:v".to_string(),
                "libx264".to_string(),
                "-preset".to_string(),
                "medium".to_string(),
                "-crf".to_string(),
                "18".to_string(),
                "-c:a".to_string(),
                "aac".to_string(),
                "-b:a".to_string(),
                "160k".to_string(),
                "-ar".to_string(),
                "48000".to_string(),
                "-ac".to_string(),
                "1".to_string(),
                "-movflags".to_string(),
                "+faststart".to_string(),
                output_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: std::collections::BTreeMap::new(),
            timeout_seconds: 1800,
            expected_outputs: vec![output_relative.clone()],
        },
        executable_path: ffmpeg,
        absolute_working_directory: workspace.clone(),
        output_root: workspace.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    if !ffmpeg_result.succeeded {
        return Err("FFmpeg burn-in thất bại; video gốc không bị thay đổi".to_string());
    }
    let output_absolute = workspace.join(&output_relative);
    let size_bytes = fs::metadata(&output_absolute)
        .map_err(|error| format!("Không đọc được burn-in output: {error}"))?
        .len();
    if size_bytes == 0 {
        return Err("Burn-in output rỗng".to_string());
    }
    let ffprobe_result = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "ffprobe".to_string(),
            args: vec![
                "-v".to_string(),
                "error".to_string(),
                "-show_entries".to_string(),
                "format=duration:stream=codec_type,codec_name".to_string(),
                "-of".to_string(),
                "json".to_string(),
                output_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: std::collections::BTreeMap::new(),
            timeout_seconds: 60,
            expected_outputs: Vec::new(),
        },
        executable_path: ffprobe,
        absolute_working_directory: workspace.clone(),
        output_root: workspace,
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    if !ffprobe_result.succeeded {
        return Err("Burn-in tạo file nhưng FFprobe không đọc được output".to_string());
    }
    let probe: Value = serde_json::from_str(ffprobe_result.stdout.trim())
        .map_err(|error| format!("FFprobe burn-in JSON lỗi: {error}"))?;
    let duration = probe
        .get("format")
        .and_then(|value| value.get("duration"))
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<f64>().ok());
    Ok(SubtitleBurnInReport {
        status: "needs_review".to_string(),
        video_path: video_relative,
        subtitle_path: subtitle_relative,
        output_path: output_relative,
        output_size_bytes: size_bytes,
        output_sha256: sha256_file(&output_absolute)?,
        duration_seconds: duration,
        network_calls_made: false,
        cost_status: "local_only".to_string(),
        human_review_required: true,
        message:
            "Đã burn-in subtitle vào bản sao MP4; video gốc giữ nguyên, cần xem lại trước delivery."
                .to_string(),
        ffmpeg: ffmpeg_result,
        ffprobe: ffprobe_result,
    })
}
