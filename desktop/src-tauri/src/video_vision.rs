use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
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

const VIDEO_VISION_WORKER_SCRIPT: &str =
    include_str!("../../../scripts/video_vision_evidence_worker.py");
const MAX_VIDEO_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_EVIDENCE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_FRAMES: u32 = 240;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeVideoEvidenceRequest {
    pub project_id: String,
    pub video_path: String,
    pub output_path: Option<String>,
    pub sample_fps: Option<f64>,
    pub max_frames: Option<u32>,
    pub frame_width: Option<u32>,
    pub frame_height: Option<u32>,
    pub extract_audio: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoVisionEvidenceReport {
    pub status: String,
    pub evidence_id: String,
    pub source_video_path: String,
    pub output_path: String,
    pub frame_dir: String,
    pub audio_path: Option<String>,
    pub source_sha256: String,
    pub duration_seconds: f64,
    pub width: u64,
    pub height: u64,
    pub frame_count: u64,
    pub shot_count: u64,
    pub semantic_vlm: bool,
    pub transcript_available: bool,
    pub ocr_available: bool,
    pub network_calls_made: bool,
    pub cost_status: String,
    pub human_review_required: bool,
    pub message: String,
    pub ffprobe: ExternalProcessResult,
    pub frame_extract: ExternalProcessResult,
    pub audio_extract: Option<ExternalProcessResult>,
    pub worker: ExternalProcessResult,
}

fn safe_relative(value: &str, field: &str) -> Result<String, String> {
    let normalized = value.trim().replace('\\', "/");
    if normalized.is_empty()
        || normalized.starts_with('/')
        || normalized.starts_with("//")
        || normalized.contains("://")
        || normalized.as_bytes().get(1) == Some(&b':')
        || normalized.contains(['\0', '\r', '\n', '\'', '"'])
    {
        return Err(format!("{field} không phải đường dẫn workspace an toàn"));
    }
    if normalized
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(format!("{field} không được chứa path traversal"));
    }
    Ok(normalized)
}

fn safe_numeric_fps(value: Option<f64>) -> Result<f64, String> {
    let fps = value.unwrap_or(1.0);
    if !fps.is_finite() || !(0.1..=2.0).contains(&fps) {
        return Err("sampleFps phải nằm trong khoảng 0.1 đến 2.0".to_string());
    }
    Ok(fps)
}

fn safe_dimension(value: Option<u32>, fallback: u32, field: &str) -> Result<u32, String> {
    let dimension = value.unwrap_or(fallback);
    if !(16..=2048).contains(&dimension) {
        return Err(format!("{field} phải nằm trong khoảng 16..2048"));
    }
    Ok(dimension)
}

fn safe_max_frames(value: Option<u32>) -> Result<u32, String> {
    let max_frames = value.unwrap_or(120);
    if !(1..=MAX_FRAMES).contains(&max_frames) {
        return Err(format!("maxFrames phải nằm trong khoảng 1..={MAX_FRAMES}"));
    }
    Ok(max_frames)
}

fn source_hash(path: &Path) -> Result<String, String> {
    let mut file =
        fs::File::open(path).map_err(|error| format!("Không mở được video để hash: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Không đọc được video để hash: {error}"))?;
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

fn ensure_worker(workspace: &Path) -> Result<String, String> {
    let path = workspace
        .join(".auto3dvideo")
        .join("tools")
        .join("video_vision_evidence_worker.py");
    fs::create_dir_all(
        path.parent()
            .ok_or_else(|| "Không xác định được thư mục video vision worker".to_string())?,
    )
    .map_err(|error| format!("Không tạo được thư mục video vision worker: {error}"))?;
    fs::write(&path, VIDEO_VISION_WORKER_SCRIPT)
        .map_err(|error| format!("Không ghi được video vision worker: {error}"))?;
    path.strip_prefix(workspace)
        .map_err(|_| "Video vision worker vượt project workspace".to_string())
        .map(|value| value.to_string_lossy().replace('\\', "/"))
}

fn ensure_relative_parent(workspace: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = workspace.join(relative);
    let parent = path
        .parent()
        .ok_or_else(|| "Không xác định được output parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("Không tạo được output parent: {error}"))?;
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|error| format!("Không canonicalize được output parent: {error}"))?;
    if !canonical_parent.starts_with(workspace) {
        return Err("Output parent vượt project workspace".to_string());
    }
    Ok(path)
}

fn write_request(
    workspace: &Path,
    evidence_id: &str,
    request: &Value,
) -> Result<(PathBuf, String), String> {
    let relative = format!(".auto3dvideo/requests/{evidence_id}.json");
    let path = ensure_relative_parent(workspace, &relative)?;
    let bytes = serde_json::to_vec(request)
        .map_err(|error| format!("Không serialize được video vision request: {error}"))?;
    if bytes.len() > 512 * 1024 {
        return Err("Video vision request vượt quá 512 KiB".to_string());
    }
    fs::File::create(&path)
        .and_then(|mut file| file.write_all(&bytes))
        .map_err(|error| format!("Không ghi được video vision request: {error}"))?;
    Ok((path, relative))
}

fn parse_process_json(process: &ExternalProcessResult, label: &str) -> Result<Value, String> {
    serde_json::from_str(process.stdout.trim()).map_err(|error| {
        let detail = process.stderr.trim().chars().take(400).collect::<String>();
        if detail.is_empty() {
            format!("{label} không trả JSON hợp lệ: {error}")
        } else {
            format!("{label} không trả JSON hợp lệ: {error}; {detail}")
        }
    })
}

fn parse_fps(value: Option<&Value>) -> f64 {
    value
        .and_then(Value::as_str)
        .and_then(|text| {
            text.split_once('/').and_then(|(numerator, denominator)| {
                let numerator = numerator.parse::<f64>().ok()?;
                let denominator = denominator.parse::<f64>().ok()?;
                if denominator > 0.0 {
                    Some(numerator / denominator)
                } else {
                    None
                }
            })
        })
        .filter(|fps| fps.is_finite() && *fps > 0.0 && *fps <= 240.0)
        .unwrap_or(30.0)
}

fn parse_probe(
    process: &ExternalProcessResult,
) -> Result<(f64, u64, u64, f64, String, bool), String> {
    let payload = parse_process_json(process, "FFprobe")?;
    let streams = payload
        .get("streams")
        .and_then(Value::as_array)
        .ok_or_else(|| "FFprobe thiếu streams".to_string())?;
    let video = streams
        .iter()
        .find(|stream| stream.get("codec_type").and_then(Value::as_str) == Some("video"))
        .ok_or_else(|| "Video input không có video stream".to_string())?;
    let duration = payload
        .get("format")
        .and_then(|format| format.get("duration"))
        .and_then(Value::as_str)
        .and_then(|text| text.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0 && *value <= 604800.0)
        .ok_or_else(|| "FFprobe thiếu duration hợp lệ".to_string())?;
    let width = video
        .get("width")
        .and_then(Value::as_u64)
        .filter(|value| (16..=16384).contains(value))
        .ok_or_else(|| "FFprobe thiếu width hợp lệ".to_string())?;
    let height = video
        .get("height")
        .and_then(Value::as_u64)
        .filter(|value| (16..=16384).contains(value))
        .ok_or_else(|| "FFprobe thiếu height hợp lệ".to_string())?;
    let codec = video
        .get("codec_name")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 64)
        .unwrap_or("unknown")
        .to_string();
    let fps = parse_fps(
        video
            .get("avg_frame_rate")
            .or_else(|| video.get("r_frame_rate")),
    );
    let audio_present = streams
        .iter()
        .any(|stream| stream.get("codec_type").and_then(Value::as_str) == Some("audio"));
    Ok((duration, width, height, fps, codec, audio_present))
}

fn worker_report(
    payload: &Value,
    evidence_id: &str,
    source_video_path: &str,
    output_path: &str,
    frame_dir: &str,
    audio_path: Option<String>,
    ffprobe: ExternalProcessResult,
    frame_extract: ExternalProcessResult,
    audio_extract: Option<ExternalProcessResult>,
    worker: ExternalProcessResult,
) -> Result<VideoVisionEvidenceReport, String> {
    let evidence = payload
        .get("evidence")
        .ok_or_else(|| "Video vision worker thiếu evidence object".to_string())?;
    let source_sha256 = evidence
        .get("sourceSha256")
        .and_then(Value::as_str)
        .filter(|value| value.len() == 64)
        .ok_or_else(|| "Video evidence thiếu sourceSha256".to_string())?;
    let duration_seconds = evidence
        .get("durationSeconds")
        .and_then(Value::as_f64)
        .ok_or_else(|| "Video evidence thiếu durationSeconds".to_string())?;
    let width = evidence
        .get("width")
        .and_then(Value::as_u64)
        .ok_or_else(|| "Video evidence thiếu width".to_string())?;
    let height = evidence
        .get("height")
        .and_then(Value::as_u64)
        .ok_or_else(|| "Video evidence thiếu height".to_string())?;
    let frame_count = evidence
        .get("sampling")
        .and_then(|sampling| sampling.get("framesExtracted"))
        .and_then(Value::as_u64)
        .ok_or_else(|| "Video evidence thiếu framesExtracted".to_string())?;
    let shot_count = evidence
        .get("shots")
        .and_then(Value::as_array)
        .map(|shots| shots.len() as u64)
        .filter(|count| *count > 0)
        .ok_or_else(|| "Video evidence thiếu shots".to_string())?;
    Ok(VideoVisionEvidenceReport {
        status: "needs_review".to_string(),
        evidence_id: evidence_id.to_string(),
        source_video_path: source_video_path.to_string(),
        output_path: output_path.to_string(),
        frame_dir: frame_dir.to_string(),
        audio_path,
        source_sha256: source_sha256.to_string(),
        duration_seconds,
        width,
        height,
        frame_count,
        shot_count,
        semantic_vlm: evidence
            .get("capabilities")
            .and_then(|capabilities| capabilities.get("semanticVlm"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        transcript_available: evidence
            .get("capabilities")
            .and_then(|capabilities| capabilities.get("transcript"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        ocr_available: evidence
            .get("capabilities")
            .and_then(|capabilities| capabilities.get("ocr"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        network_calls_made: false,
        cost_status: "local_only".to_string(),
        human_review_required: true,
        message: payload
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Đã tạo video evidence local; semantic VLM/OCR/STT chưa chạy.")
            .to_string(),
        ffprobe,
        frame_extract,
        audio_extract,
        worker,
    })
}

#[tauri::command]
pub async fn analyze_video_evidence(
    request: AnalyzeVideoEvidenceRequest,
    state: State<'_, AppState>,
) -> Result<VideoVisionEvidenceReport, String> {
    valid_text(&request.project_id, "Project ID")?;
    let source_video_path = safe_relative(&request.video_path, "videoPath")?;
    let sample_fps = safe_numeric_fps(request.sample_fps)?;
    let max_frames = safe_max_frames(request.max_frames)?;
    let frame_width = safe_dimension(request.frame_width, 320, "frameWidth")?;
    let frame_height = safe_dimension(request.frame_height, 180, "frameHeight")?;
    let extract_audio = request.extract_audio.unwrap_or(true);
    let evidence_id = super::now_id("vision");
    let output_path = safe_relative(
        request
            .output_path
            .as_deref()
            .unwrap_or("outputs/video-evidence/evidence.json"),
        "outputPath",
    )?;
    if !output_path.to_ascii_lowercase().ends_with(".json") {
        return Err("outputPath của video evidence phải là .json".to_string());
    }

    let (workspace, python, ffmpeg, ffprobe) = configured_tools(&state, &request.project_id)?;
    let _source_absolute = resolve_workspace_file(
        &workspace,
        &source_video_path,
        "Video input",
        MAX_VIDEO_BYTES,
    )?;
    if fs::metadata(&workspace.join(&output_path))
        .map(|metadata| metadata.len() > MAX_EVIDENCE_BYTES)
        .unwrap_or(false)
    {
        return Err("Evidence output hiện có vượt giới hạn; chọn file mới".to_string());
    }
    let output_absolute = ensure_relative_parent(&workspace, &output_path)?;
    if output_absolute.exists() {
        return Err("Evidence output đã tồn tại; chọn tên file mới để tránh ghi đè".to_string());
    }
    let frame_dir = format!(".auto3dvideo/vision/{evidence_id}/frames");
    let frame_absolute = ensure_relative_parent(&workspace, &format!("{frame_dir}/placeholder"))?;
    fs::create_dir_all(&frame_absolute)
        .map_err(|error| format!("Không tạo được frame directory: {error}"))?;
    let frame_pattern = format!("{frame_dir}/frame-%04d.jpg");
    let ffprobe_result = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "ffprobe".to_string(),
            args: vec![
                "-v".to_string(),
                "error".to_string(),
                "-print_format".to_string(),
                "json".to_string(),
                "-show_streams".to_string(),
                "-show_format".to_string(),
                source_video_path.clone(),
            ],
            working_directory: ".".to_string(),
            environment: BTreeMap::new(),
            timeout_seconds: 90,
            expected_outputs: Vec::new(),
        },
        executable_path: ffprobe,
        absolute_working_directory: workspace.clone(),
        output_root: workspace.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    if !ffprobe_result.succeeded {
        return Err(
            "FFprobe không đọc được video input; chưa chạy bước phân tích tiếp theo".to_string(),
        );
    }
    let (duration, width, height, fps, codec, audio_present) = parse_probe(&ffprobe_result)?;

    let frame_extract = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "ffmpeg".to_string(),
            args: vec![
                "-hide_banner".to_string(),
                "-loglevel".to_string(),
                "error".to_string(),
                "-i".to_string(),
                source_video_path.clone(),
                "-map".to_string(),
                "0:v:0".to_string(),
                "-vf".to_string(),
                format!(
                    "fps={sample_fps:.6},scale={frame_width}:{frame_height}:force_original_aspect_ratio=decrease,pad={frame_width}:{frame_height}:(ow-iw)/2:(oh-ih)/2"
                ),
                "-frames:v".to_string(),
                max_frames.to_string(),
                "-q:v".to_string(),
                "2".to_string(),
                "-y".to_string(),
                frame_pattern.clone(),
            ],
            working_directory: ".".to_string(),
            environment: BTreeMap::new(),
            timeout_seconds: 900,
            expected_outputs: Vec::new(),
        },
        executable_path: ffmpeg.clone(),
        absolute_working_directory: workspace.clone(),
        output_root: workspace.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    if !frame_extract.succeeded {
        return Err("FFmpeg không trích được frame; video gốc không bị thay đổi".to_string());
    }
    let frame_count = fs::read_dir(&frame_absolute)
        .map_err(|error| format!("Không đọc được frame directory: {error}"))?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_type()
                .map(|kind| kind.is_file())
                .unwrap_or(false)
                && entry
                    .path()
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .map(|extension| extension.eq_ignore_ascii_case("jpg"))
                    .unwrap_or(false)
        })
        .count();
    if frame_count == 0 {
        return Err("FFmpeg không tạo được frame nào".to_string());
    }

    let audio_relative = if audio_present && extract_audio {
        Some(format!(".auto3dvideo/vision/{evidence_id}/audio.wav"))
    } else {
        None
    };
    let audio_extract = if let Some(audio_relative) = audio_relative.as_deref() {
        let audio_absolute = ensure_relative_parent(&workspace, audio_relative)?;
        let result = run_external_process(ExternalProcessRequest {
            spec: ProcessSpec {
                executable_id: "ffmpeg".to_string(),
                args: vec![
                    "-hide_banner".to_string(),
                    "-loglevel".to_string(),
                    "error".to_string(),
                    "-i".to_string(),
                    source_video_path.clone(),
                    "-map".to_string(),
                    "0:a:0".to_string(),
                    "-vn".to_string(),
                    "-ac".to_string(),
                    "1".to_string(),
                    "-ar".to_string(),
                    "16000".to_string(),
                    "-c:a".to_string(),
                    "pcm_s16le".to_string(),
                    "-y".to_string(),
                    audio_relative.to_string(),
                ],
                working_directory: ".".to_string(),
                environment: BTreeMap::new(),
                timeout_seconds: 900,
                expected_outputs: vec![audio_relative.to_string()],
            },
            executable_path: ffmpeg,
            absolute_working_directory: workspace.clone(),
            output_root: workspace.clone(),
            cancellation: Arc::new(AtomicBool::new(false)),
        })
        .await?;
        if !result.succeeded || !audio_absolute.exists() {
            return Err("FFmpeg không trích được audio; frame evidence chưa được nâng thành semantic transcript".to_string());
        }
        Some(result)
    } else {
        None
    };

    let worker_relative = ensure_worker(&workspace)?;
    let request_payload = serde_json::json!({
        "operation": "analyze_frames",
        "evidenceId": evidence_id,
        "sourceVideoPath": source_video_path,
        "frameDir": frame_dir,
        "outputPath": output_path,
        "requestedFps": sample_fps,
        "maxFrames": max_frames,
        "frameWidth": frame_width,
        "frameHeight": frame_height,
        "audioPath": audio_relative,
        "probe": {
            "durationSeconds": duration,
            "width": width,
            "height": height,
            "fps": fps,
            "videoCodec": codec,
            "audioPresent": audio_present && audio_relative.is_some(),
        },
    });
    let (request_path, request_relative) =
        write_request(&workspace, &evidence_id, &request_payload)?;
    let worker = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "python".to_string(),
            args: vec![worker_relative, "--request".to_string(), request_relative],
            working_directory: ".".to_string(),
            environment: BTreeMap::new(),
            timeout_seconds: 900,
            expected_outputs: vec![output_path.clone()],
        },
        executable_path: python,
        absolute_working_directory: workspace.clone(),
        output_root: workspace.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await;
    let _ = fs::remove_file(request_path);
    let worker = worker?;
    if !worker.succeeded {
        return Err("Video vision worker thất bại; không ghi nhận evidence thành công".to_string());
    }
    let payload = parse_process_json(&worker, "Video vision worker")?;
    if payload.get("status").and_then(Value::as_str) != Some("succeeded") {
        return Err(payload
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Video vision worker trả trạng thái thất bại")
            .to_string());
    }
    let output_size = fs::metadata(&output_absolute)
        .map_err(|error| format!("Không đọc được evidence output: {error}"))?
        .len();
    if output_size == 0 || output_size > MAX_EVIDENCE_BYTES {
        return Err("Evidence output rỗng hoặc vượt giới hạn".to_string());
    }
    let evidence_sha256 = source_hash(&output_absolute)?;
    let mut report = worker_report(
        &payload,
        &evidence_id,
        &request.video_path,
        &output_path,
        &frame_dir,
        audio_relative,
        ffprobe_result,
        frame_extract,
        audio_extract,
        worker,
    )?;
    report.message = format!(
        "{} SHA evidence {}.",
        report.message,
        &evidence_sha256[..16]
    );
    if let Ok(connection) = state.database.lock() {
        let _ = super::audit_event(
            &connection,
            Some(request.project_id.trim()),
            "video_vision.evidence_created",
            "video_evidence",
            &report.evidence_id,
        );
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::{parse_fps, safe_dimension, safe_max_frames, safe_numeric_fps, safe_relative};
    use serde_json::json;

    #[test]
    fn safe_paths_reject_external_or_traversal_paths() {
        assert!(safe_relative("assets/video.mp4", "video").is_ok());
        assert!(safe_relative("../video.mp4", "video").is_err());
        assert!(safe_relative("C:/video.mp4", "video").is_err());
        assert!(safe_relative("https://example.com/video.mp4", "video").is_err());
    }

    #[test]
    fn sampling_bounds_are_explicit() {
        assert_eq!(safe_numeric_fps(None).expect("default fps"), 1.0);
        assert!(safe_numeric_fps(Some(0.09)).is_err());
        assert_eq!(safe_max_frames(Some(120)).expect("frames"), 120);
        assert!(safe_max_frames(Some(241)).is_err());
        assert_eq!(safe_dimension(None, 320, "width").expect("width"), 320);
        assert!(safe_dimension(Some(8), 320, "width").is_err());
    }

    #[test]
    fn ffprobe_rate_parsing_is_bounded() {
        assert_eq!(parse_fps(Some(&json!("30000/1001"))), 30000.0 / 1001.0);
        assert_eq!(parse_fps(Some(&json!("0/0"))), 30.0);
        assert_eq!(parse_fps(None), 30.0);
    }
}
