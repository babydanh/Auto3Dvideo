use super::*;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

const LOCAL_SCRIPT_WORKER_SCRIPT: &str = include_str!("../../../scripts/local_script_worker.py");
const LOCAL_SCENE_WORKER_SCRIPT: &str = include_str!("../../../scripts/local_scene_worker.py");
const LOCAL_SPACE_25D_WORKER_SCRIPT: &str =
    include_str!("../../../scripts/local_space_25d_worker.py");
const LOCAL_LICENSED_FOOTAGE_WORKER_SCRIPT: &str =
    include_str!("../../../scripts/local_licensed_footage_worker.py");

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalVideoPipelineReport {
    pub status: String,
    pub run_id: String,
    pub job_id: String,
    pub attempt_id: String,
    pub script_path: String,
    pub scene_manifest_path: String,
    pub audio_path: String,
    pub captions_path: String,
    pub video_path: String,
    pub duration_seconds: Option<f64>,
    pub network_calls_made: bool,
    pub cost_status: String,
    pub human_review_required: bool,
    pub message: String,
}

fn ensure_worker(workspace: &Path, name: &str, source: &str) -> Result<String, String> {
    let path = workspace.join(".auto3dvideo").join("tools").join(name);
    fs::create_dir_all(
        path.parent()
            .ok_or_else(|| "Không xác định được thư mục worker".to_string())?,
    )
    .map_err(|error| format!("Không tạo được thư mục worker: {error}"))?;
    fs::write(&path, source).map_err(|error| format!("Không ghi được worker {name}: {error}"))?;
    path.strip_prefix(workspace)
        .map_err(|_| format!("Worker {name} vượt workspace"))
        .map(|value| value.to_string_lossy().replace('\\', "/"))
}

fn safe_rel(value: &str) -> Result<String, String> {
    let normalized = value.trim().replace('\\', "/");
    if normalized.is_empty()
        || normalized.starts_with('/')
        || normalized.starts_with("//")
        || normalized.contains("://")
        || normalized.as_bytes().get(1) == Some(&b':')
        || normalized
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("Đường dẫn pipeline không an toàn".to_string());
    }
    Ok(normalized)
}

fn format_srt_time(seconds: f64) -> String {
    let total_ms = (seconds.max(0.0) * 1000.0).round() as u64;
    let hours = total_ms / 3_600_000;
    let minutes = (total_ms % 3_600_000) / 60_000;
    let secs = (total_ms % 60_000) / 1000;
    let millis = total_ms % 1000;
    format!("{hours:02}:{minutes:02}:{secs:02},{millis:03}")
}

fn build_captions(script: &Value, timing_scale: f64) -> Result<String, String> {
    let segments = script
        .get("segments")
        .and_then(Value::as_array)
        .ok_or_else(|| "Script thiếu segments".to_string())?;
    let mut output = String::new();
    let mut cursor = 0.0_f64;
    for (index, segment) in segments.iter().enumerate() {
        let narration = segment
            .get("narration")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("Script segment {} thiếu narration", index + 1))?;
        let duration = segment
            .get("durationSeconds")
            .and_then(Value::as_f64)
            .ok_or_else(|| format!("Script segment {} thiếu duration", index + 1))?
            * timing_scale;
        if !(1.0..=30.0).contains(&duration) {
            return Err(format!(
                "Script segment {} có duration ngoài giới hạn",
                index + 1
            ));
        }
        output.push_str(&format!(
            "{}\n{} --> {}\n{}\n\n",
            index + 1,
            format_srt_time(cursor),
            format_srt_time(cursor + duration),
            narration.replace('\n', " ")
        ));
        cursor += duration;
    }
    Ok(output)
}

fn scene_concat_file(
    workspace: &Path,
    scene_manifest: &Value,
    output: &Path,
    timing_scale: f64,
) -> Result<(), String> {
    let scenes = scene_manifest
        .get("scenes")
        .and_then(Value::as_array)
        .ok_or_else(|| "Scene manifest thiếu scenes".to_string())?;
    if scenes.is_empty() || scenes.len() > 12 {
        return Err("Scene manifest có số scene không hợp lệ".to_string());
    }
    let mut content = String::new();
    let mut last_escaped_path: Option<String> = None;
    for scene in scenes {
        let relative = scene
            .get("relativePath")
            .and_then(Value::as_str)
            .ok_or_else(|| "Scene manifest thiếu relativePath".to_string())?;
        let relative = safe_rel(relative)?;
        let duration = scene
            .get("durationSeconds")
            .and_then(Value::as_f64)
            .ok_or_else(|| "Scene manifest thiếu durationSeconds".to_string())?
            * timing_scale;
        let absolute = workspace.join(&relative);
        if !absolute.is_file() {
            return Err(format!("Không tìm thấy scene {relative}"));
        }
        let mut escaped = absolute.to_string_lossy().replace('\\', "/");
        if let Some(stripped) = escaped.strip_prefix("//?/") {
            escaped = stripped.to_string();
        }
        escaped = escaped.replace('\'', "'\\\\''");
        content.push_str(&format!("file '{escaped}'\nduration {duration:.3}\n"));
        last_escaped_path = Some(escaped);
    }
    if let Some(last_escaped_path) = last_escaped_path {
        content.push_str(&format!("file '{last_escaped_path}'\n"));
    }
    fs::write(output, content).map_err(|error| format!("Không ghi được concat input: {error}"))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path)
        .map_err(|error| format!("Không mở được file để tính SHA-256: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = std::io::Read::read(&mut file, &mut buffer)
            .map_err(|error| format!("Không đọc được file để tính SHA-256: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn omnivoice_profile_for_render(
    workspace: &Path,
    voice_settings: Option<&Value>,
    fallback_voice: Option<&str>,
    language: &str,
) -> Result<Value, String> {
    if let Some(profile_id) = voice_settings
        .and_then(|value| value.get("voiceProfileId"))
        .and_then(Value::as_str)
    {
        if profile_id.trim().is_empty()
            || !profile_id.chars().all(|character| {
                character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
            })
        {
            return Err("voiceSettings.voiceProfileId không hợp lệ".to_string());
        }
        let path = workspace
            .join(".auto3dvideo")
            .join("voices")
            .join(profile_id)
            .join("profile.json");
        let profile: Value = serde_json::from_slice(
            &fs::read(&path)
                .map_err(|error| format!("Không đọc được OmniVoice profile: {error}"))?,
        )
        .map_err(|error| format!("OmniVoice profile JSON không hợp lệ: {error}"))?;
        if profile.get("status").and_then(Value::as_str) != Some("ready") {
            return Err(
                "OmniVoice profile chưa ready; hãy lưu profile và xác nhận quyền trước khi render"
                    .to_string(),
            );
        }
        return Ok(profile);
    }
    let clone_enabled = voice_settings
        .and_then(|value| value.get("cloneEnabled"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let clone_consent = voice_settings
        .and_then(|value| value.get("cloneConsent"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let reference_audio_path = voice_settings
        .and_then(|value| value.get("referenceAudioPath"))
        .and_then(Value::as_str);
    let reference_transcript = voice_settings
        .and_then(|value| value.get("referenceTranscript"))
        .and_then(Value::as_str);
    if clone_enabled
        && (!clone_consent || reference_audio_path.is_none() || reference_transcript.is_none())
    {
        return Err(
            "Voice clone cần profile mới hoặc đầy đủ quyền, audio và transcript".to_string(),
        );
    }
    let instruct = fallback_voice
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(
            "Natural documentary narrator, clear diction, measured pace, confident and cinematic.",
        );
    Ok(serde_json::json!({
        "voiceProfileId": "legacy-migrated-voice",
        "mode": if clone_enabled { "clone" } else { "design" },
        "modelId": "k2-fsa/OmniVoice",
        "language": language,
        "instruct": instruct,
        "referenceAudioPath": reference_audio_path,
        "referenceTranscript": reference_transcript,
        "cloneConsent": clone_consent,
        "status": "ready"
    }))
}

fn validate_local_video_probe(probe: &Value, expected_duration: f64) -> Result<f64, String> {
    let streams = probe
        .get("streams")
        .and_then(Value::as_array)
        .ok_or_else(|| "FFprobe thiếu danh sách stream".to_string())?;
    let video_streams = streams
        .iter()
        .filter(|stream| stream.get("codec_type").and_then(Value::as_str) == Some("video"))
        .collect::<Vec<_>>();
    let audio_streams = streams
        .iter()
        .filter(|stream| stream.get("codec_type").and_then(Value::as_str) == Some("audio"))
        .collect::<Vec<_>>();
    if video_streams.len() != 1 || audio_streams.len() != 1 {
        return Err("MP4 phải có đúng một video stream và một audio stream".to_string());
    }
    let video = video_streams[0];
    if video.get("codec_name").and_then(Value::as_str) != Some("h264")
        || video.get("width").and_then(Value::as_u64) != Some(720)
        || video.get("height").and_then(Value::as_u64) != Some(1280)
    {
        return Err("MP4 không đúng H.264 720x1280".to_string());
    }
    let audio = audio_streams[0];
    let sample_rate = audio
        .get("sample_rate")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<u64>().ok())
        .or_else(|| audio.get("sample_rate").and_then(Value::as_u64));
    if audio.get("codec_name").and_then(Value::as_str) != Some("aac")
        || sample_rate != Some(48_000)
        || audio.get("channels").and_then(Value::as_u64) != Some(1)
    {
        return Err("MP4 không đúng AAC 48 kHz mono".to_string());
    }
    let duration = probe
        .get("format")
        .and_then(|value| value.get("duration"))
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)
        .ok_or_else(|| "FFprobe thiếu duration hợp lệ".to_string())?;
    if (duration - expected_duration).abs() > 0.25 {
        return Err(format!(
            "Duration MP4 lệch quá 0.25 giây: video={duration:.3}, mong đợi={expected_duration:.3}"
        ));
    }
    Ok(duration)
}

fn video_concat_file(workspace: &Path, clips: &[String], output: &Path) -> Result<(), String> {
    if clips.is_empty() || clips.len() > 12 {
        return Err("Số clip video để concat không hợp lệ".to_string());
    }
    let mut content = String::new();
    for relative in clips {
        let relative = safe_rel(relative)?;
        let absolute = workspace.join(&relative);
        if !absolute.is_file() {
            return Err(format!("Không tìm thấy clip video {relative}"));
        }
        let mut escaped = absolute.to_string_lossy().replace('\\', "/");
        if let Some(stripped) = escaped.strip_prefix("//?/") {
            escaped = stripped.to_string();
        }
        escaped = escaped.replace('\'', "'\\\\''");
        content.push_str(&format!("file '{escaped}'\n"));
    }
    fs::write(output, content)
        .map_err(|error| format!("Không ghi được video concat input: {error}"))
}

fn media_duration(result: &ExternalProcessResult, label: &str) -> Result<f64, String> {
    if !result.succeeded {
        return Err(format!("{label} không đọc được thời lượng"));
    }
    let payload: Value = serde_json::from_str(&result.stdout)
        .map_err(|error| format!("{label} trả JSON không hợp lệ: {error}"))?;
    let duration = payload
        .get("format")
        .and_then(|value| value.get("duration"))
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| (0.1..=600.0).contains(value))
        .ok_or_else(|| format!("{label} không có duration hợp lệ"))?;
    Ok(duration)
}

fn worker_payload(result: &ExternalProcessResult) -> Option<Value> {
    result
        .stdout
        .lines()
        .rev()
        .find_map(|line| serde_json::from_str::<Value>(line).ok())
}

fn worker_status_is_success(status: Option<&str>) -> bool {
    matches!(status, Some("succeeded" | "succeeded_local_fallback"))
}

fn require_success(result: &ExternalProcessResult, label: &str) -> Result<Value, String> {
    let payload = worker_payload(result);
    let worker_status = payload
        .as_ref()
        .map(|value| worker_string(value, "status", "unknown"));
    if !result.succeeded || !worker_status_is_success(worker_status.as_deref()) {
        let detail = payload
            .as_ref()
            .map(|value| worker_string(value, "message", "worker không có chi tiết"))
            .unwrap_or_else(|| format!("mã thoát {:?}", result.exit_code));
        return Err(format!("{label} chưa thành công: {detail}"));
    }
    Ok(payload.unwrap_or_else(|| serde_json::json!({"status": "succeeded"})))
}

// Deprecated compatibility code kept temporarily for source migration; it is
// intentionally not registered in the Tauri invoke handler.
#[allow(dead_code)]
async fn run_local_video_mvp(
    project_id: String,
    topic: String,
    objective: String,
    voice: Option<String>,
    approved: bool,
    state: State<'_, AppState>,
) -> Result<LocalVideoPipelineReport, String> {
    valid_text(&project_id, "Project ID")?;
    valid_text(&topic, "Chủ đề")?;
    valid_text(&objective, "Mục tiêu nội dung")?;
    if topic.chars().count() > 4000 || objective.chars().count() > 2000 {
        return Err("Chủ đề hoặc mục tiêu vượt giới hạn".to_string());
    }
    if !approved {
        return Err("Bạn phải duyệt brief trước khi tạo video".to_string());
    }
    let (workspace_root, python_path, ffmpeg_path, ffprobe_path) = {
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
        (
            PathBuf::from(workspace),
            resolve_configured_tool(&connection, "python")?,
            resolve_configured_tool(&connection, "ffmpeg")?,
            resolve_configured_tool(&connection, "ffprobe")?,
        )
    };
    let workspace_root = fs::canonicalize(&workspace_root)
        .map_err(|error| format!("Không canonicalize được workspace: {error}"))?;
    let run_id = now_id("local-video");
    let run_prefix = safe_rel(&format!(".auto3dvideo/pipeline/{run_id}"))?;
    let run_dir = workspace_root.join(&run_prefix);
    fs::create_dir_all(&run_dir)
        .map_err(|error| format!("Không tạo được pipeline workspace: {error}"))?;
    let script_relative = format!("{run_prefix}/script.json");
    let scene_relative = format!("{run_prefix}/scenes");
    let scene_manifest_relative = format!("{scene_relative}/scene-manifest.json");
    let audio_relative = format!("{run_prefix}/narration.wav");
    let captions_relative = format!("{run_prefix}/captions.srt");
    let concat_relative = format!("{run_prefix}/concat.txt");
    let video_relative = format!("{run_prefix}/master.mp4");
    let request_relative = format!(".auto3dvideo/requests/{run_id}.json");
    let request_path = workspace_root.join(&request_relative);
    fs::create_dir_all(
        request_path
            .parent()
            .ok_or_else(|| "Không xác định request directory".to_string())?,
    )
    .map_err(|error| format!("Không tạo được request directory: {error}"))?;
    let brief_id = format!("brief-{}", run_id.replace('_', "-"));
    let script_request = serde_json::json!({
        "requestId": run_id,
        "projectId": project_id.trim(),
        "briefId": brief_id,
        "profileId": "science-explainer",
        "promptTemplateId": "brief-to-script-v1",
        "topic": topic.trim(),
        "objective": objective.trim(),
        "audience": "Người xem phổ thông trên video dọc",
        "language": "vi-VN",
        "durationSeconds": 30,
        "aspectRatio": "9:16",
        "width": 720,
        "height": 1280,
        "frameRate": 30,
        "outputPath": script_relative,
        "approvalStatus": "approved"
    });
    fs::write(
        &request_path,
        serde_json::to_vec(&script_request)
            .map_err(|error| format!("Không serialize script request: {error}"))?,
    )
    .map_err(|error| format!("Không ghi script request: {error}"))?;
    if let Ok(connection) = state.database.lock() {
        let _ = audit_event(
            &connection,
            Some(project_id.trim()),
            "local_video.pipeline_requested",
            "pipeline",
            &run_id,
        );
    }
    let script_worker = ensure_worker(
        &workspace_root,
        "local_script_worker.py",
        LOCAL_SCRIPT_WORKER_SCRIPT,
    )?;
    let script_process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "python".to_string(),
            args: vec![
                script_worker,
                "--request".to_string(),
                request_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: commandcode_worker_environment()?,
            timeout_seconds: 600,
            expected_outputs: vec![script_relative.clone()],
        },
        executable_path: python_path.clone(),
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await;
    let _ = fs::remove_file(&request_path);
    let script_process = script_process?;
    require_success(&script_process, "Tạo script")?;
    let script_path = workspace_root.join(&script_relative);
    let script: Value = serde_json::from_slice(
        &fs::read(&script_path).map_err(|error| format!("Không đọc được script: {error}"))?,
    )
    .map_err(|error| format!("Script worker tạo JSON không hợp lệ: {error}"))?;
    let visual_mode = script.get("visualMode").and_then(Value::as_str);
    let space_25d = visual_mode == Some("space-25d");
    let licensed_footage = visual_mode == Some("licensed-footage-space");
    let scene_worker = if licensed_footage {
        ensure_worker(
            &workspace_root,
            "local_licensed_footage_worker.py",
            LOCAL_LICENSED_FOOTAGE_WORKER_SCRIPT,
        )?
    } else if space_25d {
        ensure_worker(
            &workspace_root,
            "local_space_25d_worker.py",
            LOCAL_SPACE_25D_WORKER_SCRIPT,
        )?
    } else {
        ensure_worker(
            &workspace_root,
            "local_scene_worker.py",
            LOCAL_SCENE_WORKER_SCRIPT,
        )?
    };
    let scene_process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "python".to_string(),
            args: vec![
                scene_worker,
                "--script".to_string(),
                script_relative.clone(),
                "--output-dir".to_string(),
                scene_relative.clone(),
                "--width".to_string(),
                "720".to_string(),
                "--height".to_string(),
                "1280".to_string(),
            ],
            working_directory: ".".to_string(),
            environment: BTreeMap::new(),
            timeout_seconds: 180,
            expected_outputs: vec![scene_manifest_relative.clone()],
        },
        executable_path: python_path.clone(),
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    require_success(&scene_process, "Tạo scene")?;
    let scene_manifest: Value = serde_json::from_slice(
        &fs::read(workspace_root.join(&scene_manifest_relative))
            .map_err(|error| format!("Không đọc được scene manifest: {error}"))?,
    )
    .map_err(|error| format!("Scene manifest không hợp lệ: {error}"))?;
    let voice_settings = script.get("voiceSettings");
    let cue_by_segment = voice_settings
        .and_then(|value| value.get("voiceCueBySegment"))
        .and_then(Value::as_object);
    let emotion_by_segment = voice_settings
        .and_then(|value| value.get("emotionCodeBySegment"))
        .and_then(Value::as_object);
    let narration = script
        .get("segments")
        .and_then(Value::as_array)
        .ok_or_else(|| "Script thiếu segments".to_string())?
        .iter()
        .filter_map(|segment| {
            let text = segment.get("narration").and_then(Value::as_str)?;
            let cue = segment.get("voiceCue").or_else(|| {
                segment
                    .get("segmentId")
                    .and_then(Value::as_str)
                    .and_then(|id| cue_by_segment.and_then(|map| map.get(id)))
            });
            let emotion = segment.get("emotionCode").or_else(|| {
                segment
                    .get("segmentId")
                    .and_then(Value::as_str)
                    .and_then(|id| emotion_by_segment.and_then(|map| map.get(id)))
            });
            Some(match voice_emotion_tag(emotion) {
                Some(tag) => format!("{}{}", tag, text),
                None => format!("{}{}", voice_cue_prefix(cue), text),
            })
        })
        .collect::<Vec<_>>()
        .join(" ");
    let tts_request_relative = format!(".auto3dvideo/requests/{run_id}-tts.json");
    let tts_request_path = workspace_root.join(&tts_request_relative);
    fs::create_dir_all(
        tts_request_path
            .parent()
            .ok_or_else(|| "Không xác định thư mục TTS request".to_string())?,
    )
    .map_err(|error| format!("Không tạo được thư mục TTS request: {error}"))?;
    let profile = omnivoice_profile_for_render(
        &workspace_root,
        voice_settings,
        voice.as_deref(),
        script
            .get("language")
            .and_then(Value::as_str)
            .unwrap_or("en"),
    )?;
    let profile_id = profile
        .get("voiceProfileId")
        .and_then(Value::as_str)
        .unwrap_or("voice-profile")
        .to_string();
    let profile_mode = profile
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("design");
    let profile_language = profile
        .get("language")
        .and_then(Value::as_str)
        .unwrap_or("en");
    let clone_consent = profile
        .get("cloneConsent")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if profile_mode == "clone" {
        let reference = profile
            .get("referenceAudioPath")
            .and_then(Value::as_str)
            .ok_or_else(|| "Voice clone profile thiếu reference audio".to_string())?;
        resolve_workspace_file(
            &workspace_root,
            reference,
            "Reference audio",
            50 * 1024 * 1024,
        )?;
        if !clone_consent {
            return Err("Voice clone cần cloneConsent=true".to_string());
        }
    }
    let tts_request = serde_json::json!({
        "schemaVersion": "1.0.0",
        "requestId": run_id,
        "projectId": project_id,
        "voiceProfileId": profile_id,
        "modelId": "k2-fsa/OmniVoice",
        "mode": profile_mode,
        "text": narration,
        "language": profile_language,
        "instruct": profile.get("instruct"),
        "referenceAudioPath": profile.get("referenceAudioPath"),
        "referenceTranscript": profile.get("referenceTranscript"),
        "outputPath": audio_relative,
        "speed": profile.get("speed").and_then(Value::as_f64).unwrap_or(1.0),
        "qualityPreset": "balanced",
        "classTemperature": 0.0,
        "positionTemperature": 5.0,
        "normalizeText": false,
        "postprocessOutput": true,
        "cloneConsent": clone_consent,
        "networkCallsAllowed": false,
        "idempotencyKey": run_id
    });
    fs::write(
        &tts_request_path,
        serde_json::to_vec(&tts_request)
            .map_err(|error| format!("Không serialize TTS request: {error}"))?,
    )
    .map_err(|error| format!("Không ghi TTS request: {error}"))?;
    let (_tts_script, tts_worker) = ensure_omnivoice_worker_script(&workspace_root)?;
    let tts_process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "python".to_string(),
            args: vec![
                tts_worker,
                "--synthesize".to_string(),
                "--request".to_string(),
                tts_request_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: omnivoice_worker_environment()?,
            timeout_seconds: 1800,
            expected_outputs: vec![audio_relative.clone()],
        },
        executable_path: python_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await;
    let _ = fs::remove_file(&tts_request_path);
    let tts_process = tts_process?;
    require_success(&tts_process, "Tạo giọng OmniVoice")?;
    validate_omnivoice_wav(&workspace_root.join(&audio_relative))?;
    let audio_probe = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "ffprobe".to_string(),
            args: vec![
                "-v".to_string(),
                "error".to_string(),
                "-show_entries".to_string(),
                "format=duration".to_string(),
                "-of".to_string(),
                "json".to_string(),
                audio_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: BTreeMap::new(),
            timeout_seconds: 120,
            expected_outputs: Vec::new(),
        },
        executable_path: ffprobe_path.clone(),
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    let audio_duration = media_duration(&audio_probe, "FFprobe audio")?;
    let script_duration = script
        .get("totalDurationSeconds")
        .and_then(Value::as_f64)
        .or_else(|| {
            script
                .get("segments")
                .and_then(Value::as_array)
                .map(|segments| {
                    segments
                        .iter()
                        .filter_map(|segment| {
                            segment.get("durationSeconds").and_then(Value::as_f64)
                        })
                        .sum()
                })
        })
        .filter(|value| (1.0..=600.0).contains(value))
        .ok_or_else(|| "Script thiếu totalDurationSeconds hợp lệ".to_string())?;
    let timing_scale = (audio_duration / script_duration).clamp(0.05, 20.0);
    let target_duration = script_duration * timing_scale;
    let captions = build_captions(&script, timing_scale)?;
    fs::write(workspace_root.join(&captions_relative), captions)
        .map_err(|error| format!("Không ghi được phụ đề: {error}"))?;
    let scene_items = scene_manifest
        .get("scenes")
        .and_then(Value::as_array)
        .ok_or_else(|| "Scene manifest thiếu scenes".to_string())?;
    fs::create_dir_all(workspace_root.join(&scene_relative).join("clips"))
        .map_err(|error| format!("Không tạo được thư mục scene clips: {error}"))?;
    let mut scene_clips = Vec::with_capacity(scene_items.len());
    for (index, scene) in scene_items.iter().enumerate() {
        let relative = scene
            .get("relativePath")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("Scene manifest thiếu relativePath ở scene {index}"))?;
        let relative = safe_rel(relative)?;
        let source = workspace_root.join(&relative);
        if !source.is_file() {
            return Err(format!("Không tìm thấy scene {relative}"));
        }
        let clip_relative = format!("{scene_relative}/clips/scene-{index:02}.mp4");
        let scene_duration = scene
            .get("durationSeconds")
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && *value > 0.0)
            .ok_or_else(|| format!("Scene {index} thiếu duration hợp lệ"))?
            * timing_scale;
        let frame_pattern = scene
            .get("framePattern")
            .and_then(Value::as_str)
            .map(|value| safe_rel(value))
            .transpose()?;
        let is_frame_sequence = frame_pattern.is_some();
        let licensed_footage = scene_manifest.get("visualMode").and_then(Value::as_str)
            == Some("licensed-footage-space");
        let mut clip_args = vec!["-y".to_string()];
        if let Some(frame_pattern) = frame_pattern {
            clip_args.extend([
                "-framerate".to_string(),
                "30".to_string(),
                "-i".to_string(),
                frame_pattern,
            ]);
        } else if licensed_footage {
            clip_args.extend([
                "-stream_loop".to_string(),
                "-1".to_string(),
                "-i".to_string(),
                relative.clone(),
                "-map".to_string(),
                "0:v:0".to_string(),
                "-an".to_string(),
            ]);
        } else {
            clip_args.extend([
                "-loop".to_string(),
                "1".to_string(),
                "-framerate".to_string(),
                "30".to_string(),
                "-i".to_string(),
                relative,
            ]);
        }
        clip_args.extend([
            "-t".to_string(),
            format!("{scene_duration:.3}"),
            "-c:v".to_string(),
            "libx264".to_string(),
        ]);
        if licensed_footage {
            clip_args.extend([
                "-vf".to_string(),
                "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30"
                    .to_string(),
            ]);
        } else if !is_frame_sequence {
            clip_args.extend([
                "-vf".to_string(),
                "zoompan=z='min(zoom+0.0015,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=720x1280:fps=30".to_string(),
            ]);
        }
        clip_args.extend([
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
            "-r".to_string(),
            "30".to_string(),
            "-movflags".to_string(),
            "+faststart".to_string(),
            clip_relative.clone(),
        ]);
        let clip_process = run_external_process(ExternalProcessRequest {
            spec: ProcessSpec {
                executable_id: "ffmpeg".to_string(),
                args: clip_args,
                working_directory: ".".to_string(),
                environment: BTreeMap::new(),
                timeout_seconds: 180,
                expected_outputs: vec![clip_relative.clone()],
            },
            executable_path: ffmpeg_path.clone(),
            absolute_working_directory: workspace_root.clone(),
            output_root: workspace_root.clone(),
            cancellation: Arc::new(AtomicBool::new(false)),
        })
        .await?;
        if !clip_process.succeeded {
            return Err(format!(
                "Tạo clip scene {} chưa thành công: mã thoát {:?}",
                index + 1,
                clip_process.exit_code
            ));
        }
        scene_clips.push(clip_relative);
    }
    video_concat_file(
        &workspace_root,
        &scene_clips,
        &workspace_root.join(&concat_relative),
    )?;
    let ffmpeg_process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "ffmpeg".to_string(),
            args: vec![
                "-y".to_string(),
                "-f".to_string(),
                "concat".to_string(),
                "-safe".to_string(),
                "0".to_string(),
                "-i".to_string(),
                concat_relative.clone(),
                "-i".to_string(),
                audio_relative.clone(),
                "-map".to_string(),
                "0:v:0".to_string(),
                "-map".to_string(),
                "1:a:0".to_string(),
                "-c:v".to_string(),
                "libx264".to_string(),
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
                "-r".to_string(),
                "30".to_string(),
                "-c:a".to_string(),
                "aac".to_string(),
                "-shortest".to_string(),
                "-t".to_string(),
                format!("{target_duration:.3}"),
                "-movflags".to_string(),
                "+faststart".to_string(),
                video_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: BTreeMap::new(),
            timeout_seconds: 1800,
            expected_outputs: vec![video_relative.clone()],
        },
        executable_path: ffmpeg_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    if !ffmpeg_process.succeeded {
        return Err(format!(
            "FFmpeg chưa tạo video: {}",
            ffmpeg_process.stderr.chars().take(480).collect::<String>()
        ));
    }
    let ffprobe_process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "ffprobe".to_string(),
            args: vec![
                "-v".to_string(),
                "error".to_string(),
                "-show_entries".to_string(),
                "format=duration:stream=codec_type".to_string(),
                "-of".to_string(),
                "json".to_string(),
                video_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: BTreeMap::new(),
            timeout_seconds: 120,
            expected_outputs: Vec::new(),
        },
        executable_path: ffprobe_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    if !ffprobe_process.succeeded {
        return Err("FFprobe không đọc được MP4 đầu ra".to_string());
    }
    let probe: Value = serde_json::from_str(&ffprobe_process.stdout)
        .map_err(|error| format!("FFprobe trả JSON không hợp lệ: {error}"))?;
    let duration = probe
        .get("format")
        .and_then(|value| value.get("duration"))
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<f64>().ok());
    let video_path_absolute = workspace_root.join(&video_relative);
    let video_size_bytes = fs::metadata(&video_path_absolute)
        .map_err(|error| format!("Không đọc được kích thước MP4 legacy: {error}"))?
        .len();
    let video_sha256 = sha256_file(&video_path_absolute)?;
    let network_calls_made = script
        .get("networkCallsMade")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let cost_status = script
        .get("costStatus")
        .and_then(Value::as_str)
        .unwrap_or("local_gateway_unreported");
    let manifest = serde_json::json!({
        "schemaVersion": "1.0.0",
        "runId": run_id,
        "projectId": project_id.trim(),
        "scriptPath": script_relative,
        "sceneManifestPath": scene_manifest_relative,
        "audioPath": audio_relative,
        "captionsPath": captions_relative,
        "videoPath": video_relative,
        "animationMode": scene_manifest
            .get("animationMode")
            .cloned()
            .unwrap_or_else(|| Value::String("static-card".to_string())),
        "durationSeconds": duration,
        "videoSizeBytes": video_size_bytes,
        "videoSha256": video_sha256,
        "networkCallsMade": network_calls_made,
        "costStatus": cost_status,
        "externalAssetsUsed": scene_manifest
            .get("externalAssetsUsed")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        "humanReviewRequired": true,
        "rightsStatus": if scene_manifest
            .get("externalAssetsUsed")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            "needs_review"
        } else {
            "generated-local"
        },
        "reviewState": "needs_review"
    });
    let manifest_relative = format!("{run_prefix}/manifest.json");
    fs::write(
        workspace_root.join(&manifest_relative),
        serde_json::to_vec_pretty(&manifest)
            .map_err(|error| format!("Không serialize manifest: {error}"))?,
    )
    .map_err(|error| format!("Không ghi manifest: {error}"))?;
    if let Ok(connection) = state.database.lock() {
        let _ = audit_event(
            &connection,
            Some(project_id.trim()),
            "local_video.pipeline_succeeded",
            "pipeline",
            &run_id,
        );
    }
    Ok(LocalVideoPipelineReport {
        status: "succeeded".to_string(),
        run_id,
        job_id: String::new(),
        attempt_id: String::new(),
        script_path: script_relative,
        scene_manifest_path: scene_manifest_relative,
        audio_path: audio_relative,
        captions_path: captions_relative,
        video_path: video_relative,
        duration_seconds: duration,
        network_calls_made,
        cost_status: cost_status.to_string(),
        human_review_required: true,
        message: format!("Đã tạo MP4 cục bộ và bằng chứng; cần nghe, xem, kiểm tra claim rồi mới bàn giao. Manifest: {manifest_relative}"),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalScriptReviewReport {
    pub status: String,
    pub run_id: String,
    pub script_path: String,
    pub script: Value,
    pub network_calls_made: bool,
    pub cost_status: String,
    pub human_review_required: bool,
    pub message: String,
}

fn load_pipeline_context(
    state: &AppState,
    project_id: &str,
) -> Result<(PathBuf, PathBuf, PathBuf, PathBuf), String> {
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
    Ok((
        PathBuf::from(workspace),
        resolve_configured_tool(&connection, "python")?,
        resolve_configured_tool(&connection, "ffmpeg")?,
        resolve_configured_tool(&connection, "ffprobe")?,
    ))
}

fn validate_voice_settings(value: &Value) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| "script.voiceSettings phải là JSON object".to_string())?;
    const ALLOWED: [&str; 13] = [
        "presetVoice",
        "temperature",
        "voiceCueBySegment",
        "emotionCodeBySegment",
        "cloneEnabled",
        "cloneConsent",
        "referenceAudioPath",
        "voiceProfileId",
        "mode",
        "language",
        "instruct",
        "speed",
        "qualityPreset",
    ];
    if let Some(unknown) = object.keys().find(|key| !ALLOWED.contains(&key.as_str())) {
        return Err(format!("script.voiceSettings.{unknown} không được phép"));
    }
    if let Some(preset) = object.get("presetVoice") {
        let preset = preset
            .as_str()
            .filter(|value| !value.trim().is_empty() && value.chars().count() <= 128)
            .ok_or_else(|| "script.voiceSettings.presetVoice không hợp lệ".to_string())?;
        if preset.contains(['\r', '\n', '\0']) {
            return Err("script.voiceSettings.presetVoice không hợp lệ".to_string());
        }
    }
    if let Some(temperature) = object.get("temperature") {
        temperature
            .as_f64()
            .filter(|value| value.is_finite() && (0.6..=1.2).contains(value))
            .ok_or_else(|| {
                "script.voiceSettings.temperature phải trong khoảng 0.6 đến 1.2".to_string()
            })?;
    }
    if let Some(profile_id) = object.get("voiceProfileId") {
        let profile_id = profile_id
            .as_str()
            .filter(|value| !value.trim().is_empty() && value.chars().count() <= 96)
            .ok_or_else(|| "script.voiceSettings.voiceProfileId không hợp lệ".to_string())?;
        if !profile_id
            .chars()
            .all(|value| value.is_ascii_lowercase() || value.is_ascii_digit() || value == '-')
        {
            return Err("script.voiceSettings.voiceProfileId không hợp lệ".to_string());
        }
    }
    if let Some(mode) = object.get("mode") {
        if !matches!(mode.as_str(), Some("clone" | "design")) {
            return Err("script.voiceSettings.mode chỉ nhận clone hoặc design".to_string());
        }
    }
    if let Some(language) = object.get("language") {
        let language = language
            .as_str()
            .filter(|value| !value.trim().is_empty() && value.chars().count() <= 16)
            .ok_or_else(|| "script.voiceSettings.language không hợp lệ".to_string())?;
        if !language
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '-')
        {
            return Err("script.voiceSettings.language không hợp lệ".to_string());
        }
    }
    if let Some(instruct) = object.get("instruct") {
        let instruct = instruct
            .as_str()
            .filter(|value| value.chars().count() <= 1000)
            .ok_or_else(|| "script.voiceSettings.instruct không hợp lệ".to_string())?;
        if instruct.contains(['\r', '\n', '\0']) {
            return Err("script.voiceSettings.instruct không hợp lệ".to_string());
        }
    }
    if let Some(speed) = object.get("speed") {
        speed
            .as_f64()
            .filter(|value| value.is_finite() && (0.5..=2.0).contains(value))
            .ok_or_else(|| {
                "script.voiceSettings.speed phải trong khoảng 0.5 đến 2.0".to_string()
            })?;
    }
    if let Some(quality) = object.get("qualityPreset") {
        if !matches!(quality.as_str(), Some("preview" | "balanced" | "quality")) {
            return Err("script.voiceSettings.qualityPreset không hợp lệ".to_string());
        }
    }
    if object
        .get("cloneEnabled")
        .is_some_and(|value| !value.is_boolean())
        || object
            .get("cloneConsent")
            .is_some_and(|value| !value.is_boolean())
    {
        return Err("script.voiceSettings clone flags phải là boolean".to_string());
    }
    let clone_enabled = object
        .get("cloneEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let clone_consent = object
        .get("cloneConsent")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if clone_enabled && !clone_consent {
        return Err("Bật voice clone cần cloneConsent=true".to_string());
    }
    if let Some(reference) = object.get("referenceAudioPath") {
        let reference = reference
            .as_str()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "script.voiceSettings.referenceAudioPath không hợp lệ".to_string())?;
        validate_attempt_output_path(reference)?;
        let suffix = Path::new(reference)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !matches!(suffix.as_str(), "wav" | "mp3" | "flac" | "m4a" | "ogg") {
            return Err(
                "script.voiceSettings.referenceAudioPath phải là audio được hỗ trợ".to_string(),
            );
        }
        if !clone_enabled || !clone_consent {
            return Err(
                "referenceAudioPath cần cloneEnabled=true và cloneConsent=true".to_string(),
            );
        }
    }
    if clone_enabled && object.get("referenceAudioPath").is_none() {
        return Err("Bật voice clone cần referenceAudioPath".to_string());
    }
    if let Some(cues) = object.get("voiceCueBySegment") {
        let cues = cues
            .as_object()
            .ok_or_else(|| "script.voiceSettings.voiceCueBySegment phải là object".to_string())?;
        if cues.len() > 12 {
            return Err("script.voiceSettings.voiceCueBySegment vượt quá 12 đoạn".to_string());
        }
        for (segment_id, cue) in cues {
            if segment_id.len() > 96
                || !segment_id
                    .chars()
                    .all(|value| value.is_ascii_alphanumeric() || value == '-')
            {
                return Err(
                    "script.voiceSettings.voiceCueBySegment có segmentId không hợp lệ".to_string(),
                );
            }
            if !matches!(
                cue.as_str(),
                Some("none" | "laugh" | "sigh" | "clear_throat")
            ) {
                return Err(
                    "script.voiceSettings.voiceCueBySegment có cue không hợp lệ".to_string()
                );
            }
        }
    }
    if let Some(emotions) = object.get("emotionCodeBySegment") {
        let emotions = emotions.as_object().ok_or_else(|| {
            "script.voiceSettings.emotionCodeBySegment phải là object".to_string()
        })?;
        if emotions.len() > 12 {
            return Err("script.voiceSettings.emotionCodeBySegment vượt quá 12 đoạn".to_string());
        }
        for (segment_id, emotion) in emotions {
            if segment_id.len() > 96
                || !segment_id
                    .chars()
                    .all(|value| value.is_ascii_alphanumeric() || value == '-')
            {
                return Err(
                    "script.voiceSettings.emotionCodeBySegment có segmentId không hợp lệ"
                        .to_string(),
                );
            }
            if !matches!(emotion.as_str(), Some(code) if VOICE_EMOTION_CODES.contains(&code)) {
                return Err(
                    "script.voiceSettings.emotionCodeBySegment có emotionCode không hợp lệ"
                        .to_string(),
                );
            }
        }
    }
    Ok(())
}

fn validate_segment_keys(
    segment: &serde_json::Map<String, Value>,
    index: usize,
) -> Result<(), String> {
    const ALLOWED: [&str; 18] = [
        "segmentId",
        "assetId",
        "narration",
        "onScreenText",
        "durationSeconds",
        "claimStatus",
        "sourceNote",
        "voiceCue",
        "emotionCode",
        "visualPrompt",
        "subject",
        "action",
        "cameraIntent",
        "lightingIntent",
        "continuityNotes",
        "negativePrompt",
        "sceneMode",
        "beats",
    ];
    if let Some(unknown) = segment.keys().find(|key| !ALLOWED.contains(&key.as_str())) {
        return Err(format!(
            "script.segments[{index}].{unknown} không được phép"
        ));
    }
    Ok(())
}

fn validate_segment_beats(beats: &Value, index: usize) -> Result<(), String> {
    let beats = beats
        .as_array()
        .filter(|items| (2..=6).contains(&items.len()))
        .ok_or_else(|| format!("script.segments[{index}].beats phải có từ 2 đến 6 beat"))?;
    const ALLOWED: [&str; 7] = [
        "beatId",
        "timeFraction",
        "purpose",
        "action",
        "cameraPrompt",
        "imageRole",
        "prompt",
    ];
    for (beat_index, beat) in beats.iter().enumerate() {
        let context = format!("script.segments[{index}].beats[{beat_index}]");
        let beat = beat
            .as_object()
            .ok_or_else(|| format!("{context} phải là object"))?;
        if let Some(unknown) = beat.keys().find(|key| !ALLOWED.contains(&key.as_str())) {
            return Err(format!("{context}.{unknown} không được phép"));
        }
        let beat_id = beat
            .get("beatId")
            .and_then(Value::as_str)
            .filter(|value| {
                (3..=64).contains(&value.len())
                    && value.chars().next().is_some_and(|character| {
                        character.is_ascii_lowercase() || character.is_ascii_digit()
                    })
                    && value.chars().all(|character| {
                        character.is_ascii_lowercase()
                            || character.is_ascii_digit()
                            || character == '-'
                    })
            })
            .ok_or_else(|| format!("{context}.beatId không hợp lệ"))?;
        let _ = beat_id;
        let time_fraction = beat
            .get("timeFraction")
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && (0.0..=1.0).contains(value))
            .ok_or_else(|| format!("{context}.timeFraction phải trong khoảng 0..1"))?;
        let _ = time_fraction;
        for (key, max_length) in [
            ("purpose", 500_usize),
            ("action", 1000_usize),
            ("cameraPrompt", 1000_usize),
            ("prompt", 3000_usize),
        ] {
            let value = beat
                .get(key)
                .and_then(Value::as_str)
                .filter(|value| {
                    let length = value.chars().count();
                    (3..=max_length).contains(&length) && !value.trim().is_empty()
                })
                .ok_or_else(|| format!("{context}.{key} không hợp lệ"))?;
            let _ = value;
        }
        if !matches!(
            beat.get("imageRole").and_then(Value::as_str),
            Some("establish" | "action" | "reveal" | "resolve")
        ) {
            return Err(format!("{context}.imageRole không hợp lệ"));
        }
    }
    Ok(())
}

fn voice_cue_prefix(value: Option<&Value>) -> &'static str {
    match value.and_then(Value::as_str) {
        Some("laugh") => "[cười] ",
        Some("sigh") => "[thở dài] ",
        Some("clear_throat") => "[hắng giọng] ",
        _ => "",
    }
}

const VOICE_EMOTION_CODES: [&str; 22] = [
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

fn voice_emotion_tag(value: Option<&Value>) -> Option<String> {
    let code = value.and_then(Value::as_str)?;
    VOICE_EMOTION_CODES
        .contains(&code)
        .then(|| format!("[{}] ", code.to_ascii_uppercase()))
}

fn validate_local_script(script: &Value, require_approved: bool) -> Result<Value, String> {
    let object = script
        .as_object()
        .ok_or_else(|| "Script phải là JSON object".to_string())?;
    const ALLOWED: [&str; 22] = [
        "schemaVersion",
        "scriptId",
        "briefId",
        "language",
        "title",
        "hook",
        "segments",
        "totalDurationSeconds",
        "promptVersion",
        "approvalStatus",
        "generatedAt",
        "networkCallsMade",
        "costStatus",
        "visualMode",
        "footageManifestPath",
        "voiceSettings",
        "sceneMode",
        "requestedShotCount",
        "requestedDurationSeconds",
        "sourcePromptHash",
        "sourcePrompt",
        "promptGrounding",
    ];
    if let Some(unknown) = object.keys().find(|key| !ALLOWED.contains(&key.as_str())) {
        return Err(format!("script.{unknown} không được phép"));
    }
    if object.get("schemaVersion").and_then(Value::as_str) != Some("1.0.0") {
        return Err("script.schemaVersion phải là 1.0.0".to_string());
    }
    let visual_mode = object.get("visualMode").and_then(Value::as_str);
    if let Some(value) = visual_mode {
        if !matches!(
            value,
            "space-25d" | "licensed-footage-space" | "cinematic-3d"
        ) {
            return Err("script.visualMode không hợp lệ".to_string());
        }
    }
    if let Some(voice_settings) = object.get("voiceSettings") {
        validate_voice_settings(voice_settings)?;
    }
    if visual_mode == Some("licensed-footage-space") {
        let manifest_path = object
            .get("footageManifestPath")
            .and_then(Value::as_str)
            .ok_or_else(|| "licensed-footage-space cần script.footageManifestPath".to_string())?;
        safe_rel(manifest_path)?;
        if !manifest_path.ends_with(".json") {
            return Err("script.footageManifestPath phải là JSON tương đối".to_string());
        }
    }
    for key in ["scriptId", "briefId", "language", "title", "hook"] {
        let value = object
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| format!("script.{key} phải là chuỗi không rỗng"))?;
        if value.len()
            > match key {
                "title" => 160,
                "hook" => 500,
                _ => 160,
            }
        {
            return Err(format!("script.{key} vượt giới hạn"));
        }
    }
    if let Some(source_prompt) = object.get("sourcePrompt") {
        let source_prompt = source_prompt
            .as_str()
            .ok_or_else(|| "script.sourcePrompt phải là chuỗi".to_string())?;
        if source_prompt.len() > 4000 {
            return Err("script.sourcePrompt vượt giới hạn 4000 ký tự".to_string());
        }
    }
    if let Some(prompt_grounding) = object.get("promptGrounding") {
        let grounding = prompt_grounding
            .as_object()
            .ok_or_else(|| "script.promptGrounding phải là object".to_string())?;
        if grounding
            .get("schemaVersion")
            .and_then(Value::as_str)
            .is_some_and(|value| value != "1.0.0")
        {
            return Err("script.promptGrounding.schemaVersion không hợp lệ".to_string());
        }
        if grounding
            .get("characterBibles")
            .and_then(Value::as_array)
            .is_some_and(|items| items.len() > 16)
        {
            return Err("script.promptGrounding.characterBibles vượt quá 16 nhân vật".to_string());
        }
    }
    let approval = object
        .get("approvalStatus")
        .and_then(Value::as_str)
        .ok_or_else(|| "script.approvalStatus bị thiếu".to_string())?;
    if !matches!(approval, "pending" | "approved" | "rejected") {
        return Err("script.approvalStatus không hợp lệ".to_string());
    }
    if require_approved && approval != "approved" {
        return Err("Script chưa được người dùng duyệt; không chạy TTS hoặc FFmpeg".to_string());
    }
    let segments = object
        .get("segments")
        .and_then(Value::as_array)
        .filter(|items| (2..=12).contains(&items.len()))
        .ok_or_else(|| "script.segments phải có từ 2 đến 12 đoạn".to_string())?;
    let mut total = 0.0_f64;
    for (index, segment) in segments.iter().enumerate() {
        let segment = segment
            .as_object()
            .ok_or_else(|| format!("script.segments[{index}] phải là object"))?;
        validate_segment_keys(segment, index)?;
        if let Some(beats) = segment.get("beats") {
            validate_segment_beats(beats, index)?;
        }
        if let Some(voice_cue) = segment.get("voiceCue") {
            if !matches!(
                voice_cue.as_str(),
                Some("none" | "laugh" | "sigh" | "clear_throat")
            ) {
                return Err(format!("script.segments[{index}].voiceCue không hợp lệ"));
            }
        }
        if let Some(emotion_code) = segment.get("emotionCode") {
            if !matches!(emotion_code.as_str(), Some(code) if VOICE_EMOTION_CODES.contains(&code)) {
                return Err(format!("script.segments[{index}].emotionCode không hợp lệ"));
            }
        }
        for key in ["segmentId", "narration", "onScreenText", "claimStatus"] {
            if !segment.contains_key(key) {
                return Err(format!("script.segments[{index}].{key} bị thiếu"));
            }
        }
        if visual_mode == Some("licensed-footage-space") {
            let asset_id = segment
                .get("assetId")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    format!("script.segments[{index}].assetId bị thiếu cho licensed footage")
                })?;
            if asset_id.len() > 96
                || !asset_id
                    .chars()
                    .all(|value| value.is_ascii_alphanumeric() || value == '-')
            {
                return Err(format!("script.segments[{index}].assetId không hợp lệ"));
            }
        }
        let narration = segment
            .get("narration")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| format!("script.segments[{index}].narration không hợp lệ"))?;
        if narration.chars().count() > 1200 {
            return Err(format!("script.segments[{index}].narration vượt giới hạn"));
        }
        let on_screen = segment
            .get("onScreenText")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("script.segments[{index}].onScreenText phải là chuỗi"))?;
        if on_screen.chars().count() > 180 {
            return Err(format!(
                "script.segments[{index}].onScreenText vượt giới hạn"
            ));
        }
        let claim_status = segment
            .get("claimStatus")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("script.segments[{index}].claimStatus bị thiếu"))?;
        if !matches!(
            claim_status,
            "needs_review" | "verified" | "user_provided" | "not_applicable"
        ) {
            return Err(format!("script.segments[{index}].claimStatus không hợp lệ"));
        }
        if require_approved && claim_status == "needs_review" {
            return Err(format!(
                "script.segments[{index}] còn claim chưa được kiểm tra"
            ));
        }
        if require_approved && claim_status == "verified" {
            let has_source = segment
                .get("sourceNote")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty());
            if !has_source {
                return Err(format!(
                    "script.segments[{index}] đã đánh dấu verified nhưng thiếu nguồn/ghi chú"
                ));
            }
        }
        let duration = segment
            .get("durationSeconds")
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && (1.0..=30.0).contains(value))
            .ok_or_else(|| format!("script.segments[{index}].durationSeconds không hợp lệ"))?;
        total += duration;
        if let Some(source_note) = segment.get("sourceNote") {
            if !source_note.is_null() && source_note.as_str().is_none() {
                return Err(format!(
                    "script.segments[{index}].sourceNote phải là chuỗi hoặc null"
                ));
            }
        }
    }
    let declared_total = object
        .get("totalDurationSeconds")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && (2.0..=180.0).contains(value))
        .ok_or_else(|| "script.totalDurationSeconds không hợp lệ".to_string())?;
    if (declared_total - total).abs() > 0.25 {
        return Err(
            "script.totalDurationSeconds không khớp tổng duration của segments".to_string(),
        );
    }
    if let Some(requested_shots) = object.get("requestedShotCount") {
        let requested_shots = requested_shots
            .as_u64()
            .filter(|value| (2..=12).contains(value))
            .ok_or_else(|| "script.requestedShotCount không hợp lệ".to_string())?;
        if requested_shots as usize != segments.len() {
            return Err("script.requestedShotCount không khớp số segments".to_string());
        }
    }
    if let Some(requested_duration) = object.get("requestedDurationSeconds") {
        let requested_duration = requested_duration
            .as_f64()
            .filter(|value| value.is_finite() && (2.0..=180.0).contains(value))
            .ok_or_else(|| "script.requestedDurationSeconds không hợp lệ".to_string())?;
        if (requested_duration - declared_total).abs() > 0.25 {
            return Err("script.requestedDurationSeconds không khớp tổng duration".to_string());
        }
    }
    if let Some(source_hash) = object.get("sourcePromptHash") {
        let source_hash = source_hash
            .as_str()
            .filter(|value| {
                value.len() == 64 && value.chars().all(|character| character.is_ascii_hexdigit())
            })
            .ok_or_else(|| "script.sourcePromptHash không hợp lệ".to_string())?;
        if source_hash.is_empty() {
            return Err("script.sourcePromptHash không được rỗng".to_string());
        }
    }
    let mut normalized = script.clone();
    if require_approved {
        normalized["approvalStatus"] = Value::String("approved".to_string());
    }
    Ok(normalized)
}

struct LocalVideoLifecycle {
    job_id: String,
    attempt_id: String,
    cancellation: Arc<AtomicBool>,
    output_paths: Vec<(String, String)>,
}

fn begin_local_video_lifecycle(
    state: &AppState,
    project_id: &str,
    run_id: &str,
    output_paths: Vec<(String, String)>,
) -> Result<LocalVideoLifecycle, String> {
    let job_id = now_id("job");
    let attempt_id = now_id("attempt");
    let timestamp = now_string();
    let mut connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Không mở được transaction local video: {error}"))?;
    let project_exists: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE project_id = ?1",
            params![project_id.trim()],
            |row| row.get(0),
        )
        .map_err(|error| format!("Không kiểm tra được project local video: {error}"))?;
    if project_exists == 0 {
        return Err("Project không tồn tại".to_string());
    }
    transaction
        .execute(
            "INSERT INTO jobs(job_id, project_id, kind, state, progress, attempt_count, created_at, started_at) VALUES (?1, ?2, 'local_topic_video', 'running', 0.0, 1, ?3, ?3)",
            params![job_id, project_id.trim(), timestamp],
        )
        .map_err(|error| format!("Không tạo được local video job: {error}"))?;
    transaction
        .execute(
            "INSERT INTO job_attempts(attempt_id, job_id, attempt_number, state, worker_id, executable_id, lease_owner, timeout_seconds, max_log_bytes, process_started, external_side_effect_unknown, retryable, created_at, updated_at, execution_mode) VALUES (?1, ?2, 1, 'running', 'local-topic-video-mvp', 'pipeline', 'local-app', 3600, 1048576, 1, 0, 1, ?3, ?3, 'external_process')",
            params![attempt_id, job_id, timestamp],
        )
        .map_err(|error| format!("Không tạo được local video attempt: {error}"))?;
    for (relative_path, media_kind) in &output_paths {
        transaction
            .execute(
                "INSERT INTO job_outputs(output_id, attempt_id, relative_path, media_kind, validation_state, created_at) VALUES (?1, ?2, ?3, ?4, 'pending', ?5)",
                params![now_id("output"), attempt_id, relative_path, media_kind, timestamp],
            )
            .map_err(|error| format!("Không tạo được local video output evidence: {error}"))?;
    }
    audit_event(
        &transaction,
        Some(project_id.trim()),
        "local_video.job_started",
        "job",
        &job_id,
    )?;
    audit_event(
        &transaction,
        Some(project_id.trim()),
        "local_video.run_started",
        "pipeline",
        run_id,
    )?;
    transaction
        .commit()
        .map_err(|error| format!("Không commit được local video lifecycle: {error}"))?;
    let cancellation = Arc::new(AtomicBool::new(false));
    state
        .cancellation_tokens
        .lock()
        .map_err(|_| "Không thể khóa cancellation registry".to_string())?
        .insert(attempt_id.clone(), Arc::clone(&cancellation));
    Ok(LocalVideoLifecycle {
        job_id,
        attempt_id,
        cancellation,
        output_paths,
    })
}

fn finish_local_video_lifecycle(
    state: &AppState,
    lifecycle: &LocalVideoLifecycle,
    project_id: &str,
    workspace_root: &Path,
    result: Result<&LocalVideoPipelineReport, &String>,
) -> Result<(), String> {
    let succeeded = result.is_ok();
    let timestamp = now_string();
    let mut connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Không mở được finish transaction local video: {error}"))?;
    for (relative_path, _) in &lifecycle.output_paths {
        let candidate = workspace_root.join(relative_path);
        let (validation_state, size_bytes, content_hash, validation_message) =
            if candidate.is_file() {
                let size = fs::metadata(&candidate)
                    .map(|metadata| metadata.len())
                    .unwrap_or(0);
                let hash = sha256_file(&candidate).ok();
                if size > 0 {
                    ("valid", Some(size), hash, None)
                } else {
                    (
                        "invalid",
                        Some(0),
                        hash,
                        Some("Output file rỗng".to_string()),
                    )
                }
            } else {
                (
                    "missing",
                    None,
                    None,
                    Some("Output file không tồn tại".to_string()),
                )
            };
        transaction
            .execute(
                "UPDATE job_outputs SET content_hash=?1, size_bytes=?2, validation_state=?3, validation_message=?4 WHERE attempt_id=?5 AND relative_path=?6",
                params![content_hash, size_bytes, validation_state, validation_message, lifecycle.attempt_id, relative_path],
            )
            .map_err(|error| format!("Không cập nhật local video output evidence: {error}"))?;
    }
    if succeeded {
        transaction
            .execute(
                "UPDATE jobs SET state='succeeded_needs_review', progress=1.0, finished_at=?1, error_code=NULL, error_message=NULL WHERE job_id=?2",
                params![timestamp, lifecycle.job_id],
            )
            .map_err(|error| format!("Không cập nhật local video job thành công: {error}"))?;
        transaction
            .execute(
                "UPDATE job_attempts SET state='succeeded', finished_at=?1, updated_at=?1, process_started=1, retryable=0, redacted_message=?2 WHERE attempt_id=?3",
                params![timestamp, "MP4 đã tạo; chờ người dùng duyệt bàn giao", lifecycle.attempt_id],
            )
            .map_err(|error| format!("Không cập nhật local video attempt thành công: {error}"))?;
        audit_event(
            &transaction,
            Some(project_id.trim()),
            "local_video.job_succeeded_needs_review",
            "job",
            &lifecycle.job_id,
        )?;
    } else {
        let error_message = result
            .err()
            .map(|error| error.chars().take(480).collect::<String>())
            .unwrap_or_else(|| "Local video thất bại không rõ nguyên nhân".to_string());
        transaction
            .execute(
                "UPDATE jobs SET state='failed', finished_at=?1, error_code='local_video_failed', error_message=?2 WHERE job_id=?3",
                params![timestamp, error_message, lifecycle.job_id],
            )
            .map_err(|error| format!("Không cập nhật local video job thất bại: {error}"))?;
        transaction
            .execute(
                "UPDATE job_attempts SET state='failed', finished_at=?1, updated_at=?1, error_code='local_video_failed', redacted_message=?2, retryable=1 WHERE attempt_id=?3",
                params![timestamp, error_message, lifecycle.attempt_id],
            )
            .map_err(|error| format!("Không cập nhật local video attempt thất bại: {error}"))?;
        audit_event(
            &transaction,
            Some(project_id.trim()),
            "local_video.job_failed",
            "job",
            &lifecycle.job_id,
        )?;
    }
    transaction
        .commit()
        .map_err(|error| format!("Không commit được local video final state: {error}"))?;
    state
        .cancellation_tokens
        .lock()
        .map_err(|_| "Không thể khóa cancellation registry".to_string())?
        .remove(&lifecycle.attempt_id);
    Ok(())
}

#[tauri::command]
pub async fn generate_local_video_script(
    project_id: String,
    topic: String,
    objective: String,
    additional_prompt: String,
    reference_context: Option<String>,
    source_prompt_hash: Option<String>,
    requested_shot_count: Option<usize>,
    requested_duration_seconds: Option<f64>,
    approved: bool,
    state: State<'_, AppState>,
) -> Result<LocalScriptReviewReport, String> {
    generate_local_video_script_inner(
        project_id,
        topic,
        objective,
        additional_prompt,
        reference_context,
        source_prompt_hash,
        requested_shot_count,
        requested_duration_seconds,
        approved,
        &state,
    )
    .await
}

async fn generate_local_video_script_inner(
    project_id: String,
    topic: String,
    objective: String,
    additional_prompt: String,
    reference_context: Option<String>,
    source_prompt_hash: Option<String>,
    requested_shot_count: Option<usize>,
    requested_duration_seconds: Option<f64>,
    approved: bool,
    state: &AppState,
) -> Result<LocalScriptReviewReport, String> {
    valid_text(&project_id, "Project ID")?;
    valid_text(&topic, "Chủ đề")?;
    valid_text(&objective, "Mục tiêu nội dung")?;
    if topic.chars().count() > 4000 || objective.chars().count() > 2000 {
        return Err("Chủ đề hoặc mục tiêu vượt giới hạn".to_string());
    }
    if additional_prompt.chars().count() > 2000 {
        return Err("Prompt bổ sung vượt giới hạn".to_string());
    }
    if let Some(value) = &source_prompt_hash {
        if value.len() != 64 || !value.chars().all(|character| character.is_ascii_hexdigit()) {
            return Err("sourcePromptHash không hợp lệ".to_string());
        }
    }
    if let Some(value) = requested_shot_count {
        if !(2..=12).contains(&value) {
            return Err("requestedShotCount phải trong khoảng 2..12".to_string());
        }
    }
    if let Some(value) = requested_duration_seconds {
        if !value.is_finite() || !(2.0..=180.0).contains(&value) {
            return Err("requestedDurationSeconds phải trong khoảng 2..180".to_string());
        }
    }
    let objective = if additional_prompt.trim().is_empty() {
        objective
    } else {
        format!(
            "{}\nPrompt bổ sung của người dùng: {}",
            objective.trim(),
            additional_prompt.trim()
        )
    };
    let reference_context = reference_context.unwrap_or_default();
    if reference_context.chars().count() > 2000 {
        return Err("Thông tin ảnh tham chiếu vượt giới hạn".to_string());
    }
    if !approved {
        return Err("Bạn phải duyệt brief trước khi sinh script".to_string());
    }
    let (workspace_root, python_path, _ffmpeg_path, _ffprobe_path) =
        load_pipeline_context(state, project_id.trim())?;
    let workspace_root = fs::canonicalize(&workspace_root)
        .map_err(|error| format!("Không canonicalize được workspace: {error}"))?;
    let run_id = now_id("local-script");
    let run_prefix = safe_rel(&format!(".auto3dvideo/pipeline/{run_id}"))?;
    let run_dir = workspace_root.join(&run_prefix);
    fs::create_dir_all(&run_dir)
        .map_err(|error| format!("Không tạo được pipeline workspace: {error}"))?;
    let script_relative = format!("{run_prefix}/script.json");
    let brief_relative = format!("{run_prefix}/brief.json");
    let request_relative = format!(".auto3dvideo/requests/{run_id}.json");
    let request_path = workspace_root.join(&request_relative);
    fs::create_dir_all(
        request_path
            .parent()
            .ok_or_else(|| "Không xác định request directory".to_string())?,
    )
    .map_err(|error| format!("Không tạo được request directory: {error}"))?;
    let brief_id = format!("brief-{}", run_id.replace('_', "-"));
    let brief = serde_json::json!({
        "schemaVersion": "1.0.0",
        "briefId": brief_id,
        "projectId": project_id.trim(),
        "topic": topic.trim(),
        "objective": objective.trim(),
        "referenceContext": reference_context.trim(),
        "language": "vi-VN",
        "durationSeconds": requested_duration_seconds.unwrap_or(30.0),
        "aspectRatio": "9:16",
        "width": 720,
        "height": 1280,
        "frameRate": 30,
        "profileId": "science-explainer",
        "promptTemplateId": "brief-to-script-v1",
        "approvalStatus": "approved",
        "humanReviewRequired": true
    });
    fs::write(
        workspace_root.join(&brief_relative),
        serde_json::to_vec_pretty(&brief)
            .map_err(|error| format!("Không serialize brief: {error}"))?,
    )
    .map_err(|error| format!("Không ghi brief: {error}"))?;
    let script_request = serde_json::json!({
        "requestId": run_id,
        "projectId": project_id.trim(),
        "briefId": brief_id,
        "profileId": "science-explainer",
        "promptTemplateId": "brief-to-script-v1",
        "topic": topic.trim(),
        "objective": objective.trim(),
        "referenceContext": reference_context.trim(),
        "audience": "Người xem phổ thông trên video dọc",
        "language": "vi-VN",
        "durationSeconds": requested_duration_seconds.unwrap_or(30.0),
        "sourcePromptHash": source_prompt_hash,
        "requestedShotCount": requested_shot_count,
        "requestedDurationSeconds": requested_duration_seconds,
        "aspectRatio": "9:16",
        "width": 720,
        "height": 1280,
        "frameRate": 30,
        "outputPath": script_relative,
        "approvalStatus": "approved"
    });
    fs::write(
        &request_path,
        serde_json::to_vec(&script_request)
            .map_err(|error| format!("Không serialize script request: {error}"))?,
    )
    .map_err(|error| format!("Không ghi script request: {error}"))?;
    if let Ok(connection) = state.database.lock() {
        let _ = audit_event(
            &connection,
            Some(project_id.trim()),
            "local_video.script_requested",
            "script",
            &run_id,
        );
    }
    let script_worker = ensure_worker(
        &workspace_root,
        "local_script_worker.py",
        LOCAL_SCRIPT_WORKER_SCRIPT,
    )?;
    let script_process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "python".to_string(),
            args: vec![
                script_worker,
                "--request".to_string(),
                request_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: commandcode_worker_environment()?,
            timeout_seconds: 600,
            expected_outputs: vec![script_relative.clone()],
        },
        executable_path: python_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await;
    let _ = fs::remove_file(&request_path);
    let script_process = script_process?;
    let script_worker_report = require_success(&script_process, "Sinh script")?;
    let script_path = workspace_root.join(&script_relative);
    let script: Value = serde_json::from_slice(
        &fs::read(&script_path).map_err(|error| format!("Không đọc được script: {error}"))?,
    )
    .map_err(|error| format!("Script worker tạo JSON không hợp lệ: {error}"))?;
    let script = validate_local_script(&script, false)?;
    if let Ok(connection) = state.database.lock() {
        let _ = audit_event(
            &connection,
            Some(project_id.trim()),
            "local_video.script_ready_for_review",
            "script",
            &run_id,
        );
    }
    Ok(LocalScriptReviewReport {
        status: "script_ready".to_string(),
        run_id,
        script_path: script_relative,
        script,
        network_calls_made: script_worker_report
            .get("networkCallsMade")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        cost_status: script_worker_report
            .get("costStatus")
            .and_then(Value::as_str)
            .unwrap_or("not_called")
            .to_string(),
        human_review_required: true,
        message: if script_worker_report.get("status").and_then(Value::as_str)
            == Some("succeeded_local_fallback")
        {
            "Đã dựng workflow local từ prompt; gateway không khả dụng. Hãy kiểm tra các shot rồi duyệt script trước khi render.".to_string()
        } else {
            "Đã sinh script. Hãy sửa nếu cần, kiểm tra từng claim và chỉ bấm duyệt script sau khi xem nội dung.".to_string()
        },
    })
}

#[tauri::command]
pub async fn render_approved_local_video(
    project_id: String,
    script_path: String,
    script: Value,
    voice: Option<String>,
    approved: bool,
    state: State<'_, AppState>,
) -> Result<LocalVideoPipelineReport, String> {
    render_approved_local_video_with_state(
        project_id,
        script_path,
        script,
        voice,
        approved,
        state.inner(),
    )
    .await
}

async fn render_approved_local_video_with_state(
    project_id: String,
    script_path: String,
    script: Value,
    voice: Option<String>,
    approved: bool,
    state: &AppState,
) -> Result<LocalVideoPipelineReport, String> {
    valid_text(&project_id, "Project ID")?;
    if !approved {
        return Err("Bạn phải duyệt script trước khi tạo giọng và video".to_string());
    }
    let script_relative = safe_rel(&script_path)?;
    if !script_relative.ends_with("/script.json") {
        return Err("Script path phải trỏ tới script.json trong workspace".to_string());
    }
    let (workspace_root, _python_path, _ffmpeg_path, _ffprobe_path) =
        load_pipeline_context(state, project_id.trim())?;
    let workspace_root = fs::canonicalize(&workspace_root)
        .map_err(|error| format!("Không canonicalize được workspace: {error}"))?;
    let run_id = now_id("local-video");
    let run_prefix = safe_rel(&format!(".auto3dvideo/pipeline/{run_id}"))?;
    let lifecycle = begin_local_video_lifecycle(
        state,
        project_id.trim(),
        &run_id,
        vec![
            (script_relative.clone(), "metadata".to_string()),
            (
                format!("{run_prefix}/scenes/scene-manifest.json"),
                "metadata".to_string(),
            ),
            (format!("{run_prefix}/narration.wav"), "audio".to_string()),
            (format!("{run_prefix}/captions.srt"), "subtitle".to_string()),
            (format!("{run_prefix}/master.mp4"), "video".to_string()),
        ],
    )?;
    let mut result = render_approved_local_video_inner(
        project_id.clone(),
        script_path,
        script,
        voice,
        approved,
        state,
        run_id,
        Arc::clone(&lifecycle.cancellation),
    )
    .await;
    if let Ok(report) = &mut result {
        report.job_id = lifecycle.job_id.clone();
        report.attempt_id = lifecycle.attempt_id.clone();
    }
    finish_local_video_lifecycle(
        state,
        &lifecycle,
        project_id.trim(),
        &workspace_root,
        result.as_ref(),
    )?;
    result
}

async fn render_approved_local_video_inner(
    project_id: String,
    script_path: String,
    script: Value,
    voice: Option<String>,
    approved: bool,
    state: &AppState,
    run_id: String,
    cancellation: Arc<AtomicBool>,
) -> Result<LocalVideoPipelineReport, String> {
    valid_text(&project_id, "Project ID")?;
    if cancellation.load(Ordering::SeqCst) {
        return Err("Tác vụ đã được yêu cầu hủy trước khi render".to_string());
    }
    if !approved {
        return Err("Bạn phải duyệt script trước khi tạo giọng và video".to_string());
    }
    let script_relative = safe_rel(&script_path)?;
    if !script_relative.ends_with("/script.json") {
        return Err("Script path phải trỏ tới script.json trong workspace".to_string());
    }
    let script = validate_local_script(&script, true)?;
    let (workspace_root, python_path, ffmpeg_path, ffprobe_path) =
        load_pipeline_context(state, project_id.trim())?;
    let workspace_root = fs::canonicalize(&workspace_root)
        .map_err(|error| format!("Không canonicalize được workspace: {error}"))?;
    let script_path_absolute = fs::canonicalize(workspace_root.join(&script_relative))
        .map_err(|error| format!("Không đọc được script đã sinh: {error}"))?;
    if !script_path_absolute.starts_with(&workspace_root) {
        return Err("Script path vượt workspace".to_string());
    }
    fs::write(
        &script_path_absolute,
        serde_json::to_vec_pretty(&script)
            .map_err(|error| format!("Không serialize script đã duyệt: {error}"))?,
    )
    .map_err(|error| format!("Không ghi script đã duyệt: {error}"))?;
    let run_prefix = safe_rel(&format!(".auto3dvideo/pipeline/{run_id}"))?;
    let run_dir = workspace_root.join(&run_prefix);
    fs::create_dir_all(&run_dir)
        .map_err(|error| format!("Không tạo được pipeline workspace: {error}"))?;
    let scene_relative = format!("{run_prefix}/scenes");
    let scene_manifest_relative = format!("{scene_relative}/scene-manifest.json");
    let audio_relative = format!("{run_prefix}/narration.wav");
    let captions_relative = format!("{run_prefix}/captions.srt");
    let concat_relative = format!("{run_prefix}/concat.txt");
    let video_relative = format!("{run_prefix}/master.mp4");
    if let Ok(connection) = state.database.lock() {
        let _ = audit_event(
            &connection,
            Some(project_id.trim()),
            "local_video.script_approved",
            "script",
            &run_id,
        );
        let _ = audit_event(
            &connection,
            Some(project_id.trim()),
            "local_video.render_requested",
            "pipeline",
            &run_id,
        );
    }
    let visual_mode = script.get("visualMode").and_then(Value::as_str);
    let space_25d = visual_mode == Some("space-25d");
    let licensed_footage = visual_mode == Some("licensed-footage-space");
    let scene_worker = if licensed_footage {
        ensure_worker(
            &workspace_root,
            "local_licensed_footage_worker.py",
            LOCAL_LICENSED_FOOTAGE_WORKER_SCRIPT,
        )?
    } else if space_25d {
        ensure_worker(
            &workspace_root,
            "local_space_25d_worker.py",
            LOCAL_SPACE_25D_WORKER_SCRIPT,
        )?
    } else {
        ensure_worker(
            &workspace_root,
            "local_scene_worker.py",
            LOCAL_SCENE_WORKER_SCRIPT,
        )?
    };
    let scene_process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "python".to_string(),
            args: vec![
                scene_worker,
                "--script".to_string(),
                script_relative.clone(),
                "--output-dir".to_string(),
                scene_relative.clone(),
                "--width".to_string(),
                "720".to_string(),
                "--height".to_string(),
                "1280".to_string(),
            ],
            working_directory: ".".to_string(),
            environment: BTreeMap::new(),
            timeout_seconds: 180,
            expected_outputs: vec![scene_manifest_relative.clone()],
        },
        executable_path: python_path.clone(),
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    require_success(&scene_process, "Tạo scene")?;
    let scene_manifest: Value = serde_json::from_slice(
        &fs::read(workspace_root.join(&scene_manifest_relative))
            .map_err(|error| format!("Không đọc được scene manifest: {error}"))?,
    )
    .map_err(|error| format!("Scene manifest không hợp lệ: {error}"))?;
    let voice_settings = script.get("voiceSettings");
    let cue_by_segment = voice_settings
        .and_then(|value| value.get("voiceCueBySegment"))
        .and_then(Value::as_object);
    let emotion_by_segment = voice_settings
        .and_then(|value| value.get("emotionCodeBySegment"))
        .and_then(Value::as_object);
    let narration = script
        .get("segments")
        .and_then(Value::as_array)
        .ok_or_else(|| "Script thiếu segments".to_string())?
        .iter()
        .filter_map(|segment| {
            let text = segment.get("narration").and_then(Value::as_str)?;
            let cue = segment.get("voiceCue").or_else(|| {
                segment
                    .get("segmentId")
                    .and_then(Value::as_str)
                    .and_then(|id| cue_by_segment.and_then(|map| map.get(id)))
            });
            let emotion = segment.get("emotionCode").or_else(|| {
                segment
                    .get("segmentId")
                    .and_then(Value::as_str)
                    .and_then(|id| emotion_by_segment.and_then(|map| map.get(id)))
            });
            Some(match voice_emotion_tag(emotion) {
                Some(tag) => format!("{}{}", tag, text),
                None => format!("{}{}", voice_cue_prefix(cue), text),
            })
        })
        .collect::<Vec<_>>()
        .join(" ");
    let tts_request_relative = format!(".auto3dvideo/requests/{run_id}-tts.json");
    let tts_request_path = workspace_root.join(&tts_request_relative);
    fs::create_dir_all(
        tts_request_path
            .parent()
            .ok_or_else(|| "Không xác định thư mục TTS request".to_string())?,
    )
    .map_err(|error| format!("Không tạo được thư mục TTS request: {error}"))?;
    let profile = omnivoice_profile_for_render(
        &workspace_root,
        voice_settings,
        voice.as_deref(),
        script
            .get("language")
            .and_then(Value::as_str)
            .unwrap_or("en"),
    )?;
    let profile_id = profile
        .get("voiceProfileId")
        .and_then(Value::as_str)
        .unwrap_or("voice-profile")
        .to_string();
    let profile_mode = profile
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("design");
    let profile_language = profile
        .get("language")
        .and_then(Value::as_str)
        .unwrap_or("en");
    let clone_consent = profile
        .get("cloneConsent")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if profile_mode == "clone" {
        let reference = profile
            .get("referenceAudioPath")
            .and_then(Value::as_str)
            .ok_or_else(|| "Voice clone profile thiếu reference audio".to_string())?;
        resolve_workspace_file(
            &workspace_root,
            reference,
            "Reference audio",
            50 * 1024 * 1024,
        )?;
        if !clone_consent {
            return Err("Voice clone cần cloneConsent=true".to_string());
        }
    }
    let tts_request = serde_json::json!({
        "schemaVersion": "1.0.0",
        "requestId": run_id,
        "projectId": project_id,
        "voiceProfileId": profile_id,
        "modelId": "k2-fsa/OmniVoice",
        "mode": profile_mode,
        "text": narration,
        "language": profile_language,
        "instruct": profile.get("instruct"),
        "referenceAudioPath": profile.get("referenceAudioPath"),
        "referenceTranscript": profile.get("referenceTranscript"),
        "outputPath": audio_relative,
        "speed": profile.get("speed").and_then(Value::as_f64).unwrap_or(1.0),
        "qualityPreset": "balanced",
        "classTemperature": 0.0,
        "positionTemperature": 5.0,
        "normalizeText": false,
        "postprocessOutput": true,
        "cloneConsent": clone_consent,
        "networkCallsAllowed": false,
        "idempotencyKey": run_id
    });
    fs::write(
        &tts_request_path,
        serde_json::to_vec(&tts_request)
            .map_err(|error| format!("Không serialize TTS request: {error}"))?,
    )
    .map_err(|error| format!("Không ghi TTS request: {error}"))?;
    let (_tts_script, tts_worker) = ensure_omnivoice_worker_script(&workspace_root)?;
    let tts_process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "python".to_string(),
            args: vec![
                tts_worker,
                "--synthesize".to_string(),
                "--request".to_string(),
                tts_request_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: omnivoice_worker_environment()?,
            timeout_seconds: 1800,
            expected_outputs: vec![audio_relative.clone()],
        },
        executable_path: python_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await;
    let _ = fs::remove_file(&tts_request_path);
    let tts_process = tts_process?;
    require_success(&tts_process, "Tạo giọng OmniVoice")?;
    validate_omnivoice_wav(&workspace_root.join(&audio_relative))?;
    let audio_probe = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "ffprobe".to_string(),
            args: vec![
                "-v".to_string(),
                "error".to_string(),
                "-show_entries".to_string(),
                "format=duration".to_string(),
                "-of".to_string(),
                "json".to_string(),
                audio_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: BTreeMap::new(),
            timeout_seconds: 120,
            expected_outputs: Vec::new(),
        },
        executable_path: ffprobe_path.clone(),
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    let audio_duration = media_duration(&audio_probe, "FFprobe audio")?;
    let script_duration = script
        .get("totalDurationSeconds")
        .and_then(Value::as_f64)
        .or_else(|| {
            script
                .get("segments")
                .and_then(Value::as_array)
                .map(|segments| {
                    segments
                        .iter()
                        .filter_map(|segment| {
                            segment.get("durationSeconds").and_then(Value::as_f64)
                        })
                        .sum()
                })
        })
        .filter(|value| (1.0..=600.0).contains(value))
        .ok_or_else(|| "Script thiếu totalDurationSeconds hợp lệ".to_string())?;
    let timing_scale = (audio_duration / script_duration).clamp(0.05, 20.0);
    let target_duration = script_duration * timing_scale;
    let captions = build_captions(&script, timing_scale)?;
    fs::write(workspace_root.join(&captions_relative), captions)
        .map_err(|error| format!("Không ghi được phụ đề: {error}"))?;
    let scene_items = scene_manifest
        .get("scenes")
        .and_then(Value::as_array)
        .ok_or_else(|| "Scene manifest thiếu scenes".to_string())?;
    fs::create_dir_all(workspace_root.join(&scene_relative).join("clips"))
        .map_err(|error| format!("Không tạo được thư mục scene clips: {error}"))?;
    let mut scene_clips = Vec::with_capacity(scene_items.len());
    for (index, scene) in scene_items.iter().enumerate() {
        let relative = scene
            .get("relativePath")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("Scene manifest thiếu relativePath ở scene {index}"))?;
        let relative = safe_rel(relative)?;
        let source = workspace_root.join(&relative);
        if !source.is_file() {
            return Err(format!("Không tìm thấy scene {relative}"));
        }
        let clip_relative = format!("{scene_relative}/clips/scene-{index:02}.mp4");
        let scene_duration = scene
            .get("durationSeconds")
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && *value > 0.0)
            .ok_or_else(|| format!("Scene {index} thiếu duration hợp lệ"))?
            * timing_scale;
        let frame_pattern = scene
            .get("framePattern")
            .and_then(Value::as_str)
            .map(|value| safe_rel(value))
            .transpose()?;
        let is_frame_sequence = frame_pattern.is_some();
        let licensed_footage = scene_manifest.get("visualMode").and_then(Value::as_str)
            == Some("licensed-footage-space");
        let mut clip_args = vec!["-y".to_string()];
        if let Some(frame_pattern) = frame_pattern {
            clip_args.extend([
                "-framerate".to_string(),
                "30".to_string(),
                "-i".to_string(),
                frame_pattern,
            ]);
        } else if licensed_footage {
            clip_args.extend([
                "-stream_loop".to_string(),
                "-1".to_string(),
                "-i".to_string(),
                relative.clone(),
                "-map".to_string(),
                "0:v:0".to_string(),
                "-an".to_string(),
            ]);
        } else {
            clip_args.extend([
                "-loop".to_string(),
                "1".to_string(),
                "-framerate".to_string(),
                "30".to_string(),
                "-i".to_string(),
                relative,
            ]);
        }
        clip_args.extend([
            "-t".to_string(),
            format!("{scene_duration:.3}"),
            "-c:v".to_string(),
            "libx264".to_string(),
        ]);
        if licensed_footage {
            clip_args.extend([
                "-vf".to_string(),
                "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30"
                    .to_string(),
            ]);
        } else if !is_frame_sequence {
            clip_args.extend([
                "-vf".to_string(),
                "zoompan=z='min(zoom+0.0015,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=720x1280:fps=30".to_string(),
            ]);
        }
        clip_args.extend([
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
            "-r".to_string(),
            "30".to_string(),
            "-movflags".to_string(),
            "+faststart".to_string(),
            clip_relative.clone(),
        ]);
        let clip_process = run_external_process(ExternalProcessRequest {
            spec: ProcessSpec {
                executable_id: "ffmpeg".to_string(),
                args: clip_args,
                working_directory: ".".to_string(),
                environment: BTreeMap::new(),
                timeout_seconds: 180,
                expected_outputs: vec![clip_relative.clone()],
            },
            executable_path: ffmpeg_path.clone(),
            absolute_working_directory: workspace_root.clone(),
            output_root: workspace_root.clone(),
            cancellation: Arc::new(AtomicBool::new(false)),
        })
        .await?;
        if !clip_process.succeeded {
            return Err(format!(
                "Tạo clip scene {} chưa thành công: mã thoát {:?}",
                index + 1,
                clip_process.exit_code
            ));
        }
        scene_clips.push(clip_relative);
    }
    video_concat_file(
        &workspace_root,
        &scene_clips,
        &workspace_root.join(&concat_relative),
    )?;
    let ffmpeg_process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "ffmpeg".to_string(),
            args: vec![
                "-y".to_string(),
                "-f".to_string(),
                "concat".to_string(),
                "-safe".to_string(),
                "0".to_string(),
                "-i".to_string(),
                concat_relative.clone(),
                "-i".to_string(),
                audio_relative.clone(),
                "-map".to_string(),
                "0:v:0".to_string(),
                "-map".to_string(),
                "1:a:0".to_string(),
                "-c:v".to_string(),
                "libx264".to_string(),
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
                "-r".to_string(),
                "30".to_string(),
                "-c:a".to_string(),
                "aac".to_string(),
                "-shortest".to_string(),
                "-t".to_string(),
                format!("{target_duration:.3}"),
                "-movflags".to_string(),
                "+faststart".to_string(),
                video_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: BTreeMap::new(),
            timeout_seconds: 1800,
            expected_outputs: vec![video_relative.clone()],
        },
        executable_path: ffmpeg_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    if !ffmpeg_process.succeeded {
        return Err(format!(
            "FFmpeg chưa tạo video: {}",
            ffmpeg_process.stderr.chars().take(480).collect::<String>()
        ));
    }
    let ffprobe_process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "ffprobe".to_string(),
            args: vec![
                "-v".to_string(),
                "error".to_string(),
                "-show_entries".to_string(),
                "format=duration:stream=codec_type,width,height,codec_name,sample_rate,channels"
                    .to_string(),
                "-of".to_string(),
                "json".to_string(),
                video_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: BTreeMap::new(),
            timeout_seconds: 120,
            expected_outputs: Vec::new(),
        },
        executable_path: ffprobe_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    if !ffprobe_process.succeeded {
        return Err("FFprobe không đọc được MP4 đầu ra".to_string());
    }
    let probe: Value = serde_json::from_str(&ffprobe_process.stdout)
        .map_err(|error| format!("FFprobe trả JSON không hợp lệ: {error}"))?;
    let duration = validate_local_video_probe(&probe, target_duration)?;
    let video_path_absolute = workspace_root.join(&video_relative);
    let video_size_bytes = fs::metadata(&video_path_absolute)
        .map_err(|error| format!("Không đọc được kích thước MP4: {error}"))?
        .len();
    if video_size_bytes == 0 {
        return Err("MP4 đầu ra rỗng".to_string());
    }
    let video_sha256 = sha256_file(&video_path_absolute)?;
    let network_calls_made = script
        .get("networkCallsMade")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let cost_status = script
        .get("costStatus")
        .and_then(Value::as_str)
        .unwrap_or("local_gateway_unreported");
    let manifest_relative = format!("{run_prefix}/manifest.json");
    let manifest = serde_json::json!({
        "schemaVersion": "1.0.0",
        "runId": run_id,
        "projectId": project_id.trim(),
        "scriptPath": script_relative,
        "sceneManifestPath": scene_manifest_relative,
        "audioPath": audio_relative,
        "captionsPath": captions_relative,
        "videoPath": video_relative,
        "animationMode": scene_manifest
            .get("animationMode")
            .cloned()
            .unwrap_or_else(|| Value::String("static-card".to_string())),
        "durationSeconds": duration,
        "videoSizeBytes": video_size_bytes,
        "videoSha256": video_sha256,
        "networkCallsMade": network_calls_made,
        "costStatus": cost_status,
        "externalAssetsUsed": scene_manifest
            .get("externalAssetsUsed")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        "humanReviewRequired": true,
        "rightsStatus": if scene_manifest
            .get("externalAssetsUsed")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            "needs_review"
        } else {
            "generated-local"
        },
        "reviewState": "needs_review",
        "scriptApprovalStatus": "approved",
        "audioDurationSeconds": audio_duration,
        "targetDurationSeconds": target_duration,
        "ffprobe": probe
    });
    fs::write(
        workspace_root.join(&manifest_relative),
        serde_json::to_vec_pretty(&manifest)
            .map_err(|error| format!("Không serialize manifest: {error}"))?,
    )
    .map_err(|error| format!("Không ghi manifest: {error}"))?;
    if let Ok(connection) = state.database.lock() {
        let _ = audit_event(
            &connection,
            Some(project_id.trim()),
            "local_video.render_succeeded_needs_review",
            "pipeline",
            &run_id,
        );
    }
    Ok(LocalVideoPipelineReport {
        status: "succeeded_needs_review".to_string(),
        run_id,
        job_id: String::new(),
        attempt_id: String::new(),
        script_path: script_relative,
        scene_manifest_path: scene_manifest_relative,
        audio_path: audio_relative,
        captions_path: captions_relative,
        video_path: video_relative,
        duration_seconds: Some(duration),
        network_calls_made,
        cost_status: cost_status.to_string(),
        human_review_required: true,
        message: format!("Đã tạo MP4 sau khi script được duyệt; cần xem, nghe, kiểm tra claim, phụ đề và quyền trước khi bàn giao. Manifest: {manifest_relative}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn review_script(claim_status: &str, source_note: Option<&str>) -> Value {
        serde_json::json!({
            "schemaVersion": "1.0.0",
            "scriptId": "script-test-001",
            "briefId": "brief-test-001",
            "language": "vi-VN",
            "title": "Chủ đề kiểm thử",
            "hook": "Đây là câu mở đầu kiểm thử.",
            "segments": [
                {
                    "segmentId": "segment-01",
                    "narration": "Nội dung kiểm thử thứ nhất.",
                    "onScreenText": "Đoạn một",
                    "durationSeconds": 5.0,
                    "claimStatus": claim_status,
                    "sourceNote": source_note
                },
                {
                    "segmentId": "segment-02",
                    "narration": "Nội dung kiểm thử thứ hai.",
                    "onScreenText": "Đoạn hai",
                    "durationSeconds": 5.0,
                    "claimStatus": claim_status,
                    "sourceNote": source_note
                }
            ],
            "totalDurationSeconds": 10.0,
            "promptVersion": "test-v1",
            "approvalStatus": "pending",
            "generatedAt": "2026-08-24T00:00:00Z"
        })
    }

    #[test]
    fn pending_script_is_valid_but_not_renderable() {
        let script = review_script("needs_review", None);
        assert!(validate_local_script(&script, false).is_ok());
        assert!(validate_local_script(&script, true).is_err());
    }

    #[test]
    fn semantic_storyboard_fields_are_accepted_by_script_validator() {
        let mut script = review_script("not_applicable", None);
        script["sceneMode"] = Value::String("ocean_submersible".to_string());
        script["visualMode"] = Value::String("cinematic-3d".to_string());
        script["segments"][0]["sceneMode"] = Value::String("ocean_submersible".to_string());
        script["segments"][0]["beats"] = serde_json::json!([
            {
                "beatId": "beat-01",
                "timeFraction": 0.0,
                "purpose": "Establish the environment and scale.",
                "action": "The subject enters the environment.",
                "cameraPrompt": "Wide establishing composition with readable depth.",
                "imageRole": "establish",
                "prompt": "Storyboard anchor for the opening composition."
            },
            {
                "beatId": "beat-02",
                "timeFraction": 1.0,
                "purpose": "Resolve the visual beat.",
                "action": "The subject settles into the final position.",
                "cameraPrompt": "Controlled hold with clear silhouette.",
                "imageRole": "resolve",
                "prompt": "Storyboard anchor for the closing composition."
            }
        ]);
        assert!(validate_local_script(&script, false).is_ok());
    }

    #[test]
    fn approved_verified_script_requires_source_note() {
        let mut missing_source = review_script("verified", None);
        missing_source["approvalStatus"] = Value::String("approved".to_string());
        assert!(validate_local_script(&missing_source, true).is_err());

        let mut with_source =
            review_script("verified", Some("Người dùng đã đối chiếu tài liệu nội bộ"));
        with_source["approvalStatus"] = Value::String("approved".to_string());
        assert!(validate_local_script(&with_source, true).is_ok());
    }

    #[test]
    fn approved_non_factual_script_can_render_after_explicit_review() {
        let mut script = review_script("not_applicable", None);
        script["approvalStatus"] = Value::String("approved".to_string());
        assert!(validate_local_script(&script, true).is_ok());
    }

    #[test]
    fn voice_settings_accept_cues_and_reject_unsafe_clone() {
        let mut valid = review_script("not_applicable", None);
        valid["approvalStatus"] = Value::String("approved".to_string());
        valid["voiceSettings"] = serde_json::json!({
            "presetVoice": "Phạm Tuyên",
            "temperature": 0.85,
            "voiceCueBySegment": {"segment-01": "laugh", "segment-02": "sigh"},
            "emotionCodeBySegment": {"segment-01": "excited", "segment-02": "melancholic"},
            "cloneEnabled": false,
            "cloneConsent": false
        });
        assert!(validate_local_script(&valid, true).is_ok());

        let mut invalid_temperature = valid.clone();
        invalid_temperature["voiceSettings"]["temperature"] = serde_json::json!(1.5);
        assert!(validate_local_script(&invalid_temperature, true).is_err());

        let mut invalid_clone = valid.clone();
        invalid_clone["voiceSettings"]["cloneEnabled"] = Value::Bool(true);
        invalid_clone["voiceSettings"]["cloneConsent"] = Value::Bool(false);
        assert!(validate_local_script(&invalid_clone, true).is_err());

        let mut invalid_reference = valid.clone();
        invalid_reference["voiceSettings"] = serde_json::json!({
            "presetVoice": "Phạm Tuyên",
            "temperature": 0.8,
            "cloneEnabled": true,
            "cloneConsent": true,
            "referenceAudioPath": "../private/voice.wav"
        });
        assert!(validate_local_script(&invalid_reference, true).is_err());

        let mut invalid_emotion = valid;
        invalid_emotion["segments"][0]["emotionCode"] = Value::String("made_up".to_string());
        assert!(validate_local_script(&invalid_emotion, true).is_err());
    }

    #[test]
    fn local_paths_reject_absolute_and_parent_segments() {
        assert!(safe_rel("C:/outside/script.json").is_err());
        assert!(safe_rel(".auto3dvideo/pipeline/../script.json").is_err());
        assert!(safe_rel(".auto3dvideo/pipeline/script.json").is_ok());
    }

    #[test]
    fn local_fallback_worker_result_is_accepted_as_success() {
        assert!(worker_status_is_success(Some("succeeded")));
        assert!(worker_status_is_success(Some("succeeded_local_fallback")));
        assert!(!worker_status_is_success(Some("failed")));
        assert!(!worker_status_is_success(None));
    }
}

#[cfg(test)]
mod native_e2e_tests {
    use super::*;

    #[tokio::test]
    #[ignore = "opt-in: requires AUTO3DVIDEO_RUN_LOCAL_PIPELINE_E2E=1, local gateway credential, VieNeu cache and local FFmpeg tools"]
    async fn local_topic_to_video_native_e2e_on_windows() {
        if std::env::var("AUTO3DVIDEO_RUN_LOCAL_PIPELINE_E2E").as_deref() != Ok("1") {
            panic!("Set AUTO3DVIDEO_RUN_LOCAL_PIPELINE_E2E=1 to run this opt-in test");
        }
        let python_path = std::env::var("AUTO3DVIDEO_TEST_PYTHON").unwrap_or_else(|_| {
            "D:\\Auto3DvideoTools\\vieneu\\.venv\\Scripts\\python.exe".to_string()
        });
        let ffmpeg_path = std::env::var("AUTO3DVIDEO_TEST_FFMPEG").unwrap_or_else(|_| {
            "D:\\MediaTools\\ffmpeg\\package\\ffmpeg-9.0.1-essentials_build\\bin\\ffmpeg.exe"
                .to_string()
        });
        let ffprobe_path = std::env::var("AUTO3DVIDEO_TEST_FFPROBE").unwrap_or_else(|_| {
            "D:\\MediaTools\\ffmpeg\\package\\ffmpeg-9.0.1-essentials_build\\bin\\ffprobe.exe"
                .to_string()
        });
        let run_id = now_id("run");
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("outputs")
            .join("native-local-video-e2e-artifacts")
            .join(&run_id);
        fs::create_dir_all(&root).expect("evidence workspace");
        let connection = Connection::open_in_memory().expect("in-memory database");
        apply_migrations(&connection).expect("migrations");
        let project_id = "project-native-e2e";
        let timestamp = now_string();
        connection
            .execute(
                "INSERT INTO projects(project_id, name, locale, workspace_root, policy_profile, created_at, updated_at) VALUES (?1, 'Native E2E', 'vi-VN', ?2, 'safe-local', ?3, ?3)",
                params![project_id, root.to_string_lossy().to_string(), timestamp],
            )
            .expect("project seed");
        for (tool_id, executable_ref) in [
            ("python", python_path.as_str()),
            ("ffmpeg", ffmpeg_path.as_str()),
            ("ffprobe", ffprobe_path.as_str()),
        ] {
            connection
                .execute(
                    "INSERT INTO tool_configs(tool_id, executable_ref, required, created_at, updated_at) VALUES (?1, ?2, 1, ?3, ?3)",
                    params![tool_id, executable_ref, timestamp],
                )
                .expect("tool seed");
        }
        let state = AppState {
            database: Mutex::new(connection),
            cancellation_tokens: Mutex::new(HashMap::new()),
            cloud_generation_enabled: AtomicBool::new(false),
        };
        let review = generate_local_video_script_inner(
            project_id.to_string(),
            "Vũ trụ 2D animation dọc kiểu TikTok: hành tinh xanh, quỹ đạo sáng và chuyến du hành tí hon".to_string(),
            "Tạo video dọc 18 giây bằng tiếng Việt, nhịp nhanh như TikTok, hình ảnh 2D chuyển động; đây là câu chuyện hư cấu giàu hình ảnh, không dùng claim thiên văn thực tế".to_string(),
            String::new(),
            None,
            None,
            None,
            None,
            true,
            &state,
        )
        .await
        .expect("script generation");
        let mut approved_script = review.script;
        approved_script["title"] = Value::String("Vũ trụ tí hon".to_string());
        approved_script["hook"] = Value::String(
            "Nếu vũ trụ thu nhỏ vừa đủ một màn hình, bạn sẽ bay đến đâu?".to_string(),
        );
        approved_script["totalDurationSeconds"] = Value::from(18.0);
        approved_script["visualMode"] = Value::String("space-25d".to_string());
        approved_script["approvalStatus"] = Value::String("approved".to_string());
        if let Some(segments) = approved_script
            .get_mut("segments")
            .and_then(Value::as_array_mut)
        {
            let sample_segments = [
                (
                    "Động cơ bật sáng. Một phi hành gia tí hon rời khỏi trạm bay, lướt qua những vì sao và tiến về hành tinh xanh đang phát sáng.",
                    "Bật động cơ • Bay qua ngân hà",
                ),
                (
                    "Từ xa, hành tinh chỉ còn là một chấm xanh giữa khoảng không. Chuyến đi kết thúc, nhưng trí tưởng tượng vừa mở ra cả vũ trụ.",
                    "Một chấm xanh • Cả vũ trụ",
                ),
            ];
            for (segment, (narration, on_screen_text)) in segments.iter_mut().zip(sample_segments) {
                segment["narration"] = Value::String(narration.to_string());
                segment["onScreenText"] = Value::String(on_screen_text.to_string());
                segment["durationSeconds"] = Value::from(9.0);
                segment["claimStatus"] = Value::String("not_applicable".to_string());
                segment["sourceNote"] = Value::Null;
            }
        }
        let report = render_approved_local_video_with_state(
            project_id.to_string(),
            review.script_path,
            approved_script,
            Some("Phạm Tuyên".to_string()),
            true,
            &state,
        )
        .await
        .expect("approved native render");
        let output_path = root.join(&report.video_path);
        let manifest_path = root.join(&report.video_path.replace("master.mp4", "manifest.json"));
        let output_size = fs::metadata(&output_path).expect("MP4 exists").len();
        assert!(output_size > 0, "MP4 must be non-empty");
        assert!(report.duration_seconds.is_some_and(|value| value > 0.1));
        assert!(!report.job_id.is_empty(), "job ID must be returned");
        assert!(!report.attempt_id.is_empty(), "attempt ID must be returned");
        let connection = state.database.lock().expect("database lock");
        let lifecycle_states: (String, String, String) = connection
            .query_row(
                "SELECT j.state, a.state, (SELECT validation_state FROM job_outputs WHERE attempt_id=a.attempt_id AND media_kind='video') FROM jobs j JOIN job_attempts a ON a.job_id=j.job_id WHERE j.job_id=?1 AND a.attempt_id=?2",
                params![report.job_id, report.attempt_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("durable lifecycle states");
        assert_eq!(lifecycle_states.0, "succeeded_needs_review");
        assert_eq!(lifecycle_states.1, "succeeded");
        assert_eq!(lifecycle_states.2, "valid");
        drop(connection);
        let evidence = serde_json::json!({
            "status": report.status,
            "projectId": project_id,
            "jobId": report.job_id,
            "attemptId": report.attempt_id,
            "videoPath": report.video_path,
            "audioPath": report.audio_path,
            "captionsPath": report.captions_path,
            "durationSeconds": report.duration_seconds,
            "sizeBytes": output_size,
            "artifactRoot": root.to_string_lossy().to_string(),
            "manifestPath": report.video_path.replace("master.mp4", "manifest.json"),
            "reviewRequired": report.human_review_required,
            "costStatus": report.cost_status,
            "networkCallsMade": report.network_calls_made
        });
        let evidence_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("outputs")
            .join("native-local-video-e2e-report.json");
        fs::create_dir_all(evidence_path.parent().expect("evidence parent")).expect("evidence dir");
        fs::write(
            &evidence_path,
            serde_json::to_vec_pretty(&evidence).expect("evidence JSON"),
        )
        .expect("evidence file");
        assert!(manifest_path.is_file(), "manifest exists");
        // Preserve the generated MP4/WAV/SRT/manifest for human review; the
        // project outputs directory is ignored by source validation.
    }

    #[tokio::test]
    #[ignore = "opt-in: requires AUTO3DVIDEO_RUN_LOCAL_PIPELINE_E2E=1, VieNeu cache and local FFmpeg tools"]
    async fn space_25d_approved_render_native_e2e_on_windows() {
        if std::env::var("AUTO3DVIDEO_RUN_LOCAL_PIPELINE_E2E").as_deref() != Ok("1") {
            panic!("Set AUTO3DVIDEO_RUN_LOCAL_PIPELINE_E2E=1 to run this opt-in test");
        }
        let python_path = std::env::var("AUTO3DVIDEO_TEST_PYTHON").unwrap_or_else(|_| {
            "D:\\Auto3DvideoTools\\vieneu\\.venv\\Scripts\\python.exe".to_string()
        });
        let ffmpeg_path = std::env::var("AUTO3DVIDEO_TEST_FFMPEG").unwrap_or_else(|_| {
            "D:\\MediaTools\\ffmpeg\\package\\ffmpeg-9.0.1-essentials_build\\bin\\ffmpeg.exe"
                .to_string()
        });
        let ffprobe_path = std::env::var("AUTO3DVIDEO_TEST_FFPROBE").unwrap_or_else(|_| {
            "D:\\MediaTools\\ffmpeg\\package\\ffmpeg-9.0.1-essentials_build\\bin\\ffprobe.exe"
                .to_string()
        });
        let run_id = now_id("run");
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("outputs")
            .join("native-space-25d-e2e-artifacts")
            .join(&run_id);
        fs::create_dir_all(root.join("approved")).expect("approved script directory");
        let connection = Connection::open_in_memory().expect("in-memory database");
        apply_migrations(&connection).expect("migrations");
        let project_id = "project-space-25d-e2e";
        let timestamp = now_string();
        connection
            .execute(
                "INSERT INTO projects(project_id, name, locale, workspace_root, policy_profile, created_at, updated_at) VALUES (?1, 'Space 2.5D E2E', 'vi-VN', ?2, 'safe-local', ?3, ?3)",
                params![project_id, root.to_string_lossy().to_string(), timestamp],
            )
            .expect("project seed");
        for (tool_id, executable_ref) in [
            ("python", python_path.as_str()),
            ("ffmpeg", ffmpeg_path.as_str()),
            ("ffprobe", ffprobe_path.as_str()),
        ] {
            connection
                .execute(
                    "INSERT INTO tool_configs(tool_id, executable_ref, required, created_at, updated_at) VALUES (?1, ?2, 1, ?3, ?3)",
                    params![tool_id, executable_ref, timestamp],
                )
                .expect("tool seed");
        }
        let state = AppState {
            database: Mutex::new(connection),
            cancellation_tokens: Mutex::new(HashMap::new()),
            cloud_generation_enabled: AtomicBool::new(false),
        };
        let script_path = "approved/script.json";
        let script = serde_json::json!({
            "schemaVersion": "1.0.0",
            "scriptId": "script-space-25d-e2e",
            "briefId": "brief-space-25d-e2e",
            "language": "vi-VN",
            "title": "Vũ trụ 2.5D",
            "hook": "Một chuyến bay tí hon mở ra cả khung hình vũ trụ.",
            "segments": [
                {
                    "segmentId": "segment-space-01",
                    "narration": "Động cơ bật sáng. Con tàu tí hon lướt qua những vì sao và vòng quỹ đạo rực màu.",
                    "onScreenText": "Bật động cơ • Bay qua quỹ đạo",
                    "durationSeconds": 9.0,
                    "claimStatus": "not_applicable",
                    "sourceNote": null
                },
                {
                    "segmentId": "segment-space-02",
                    "narration": "Hành tinh xanh dần thành một chấm sáng. Chuyến đi kết thúc, còn trí tưởng tượng tiếp tục bay.",
                    "onScreenText": "Một chấm xanh • Cả vũ trụ",
                    "durationSeconds": 9.0,
                    "claimStatus": "not_applicable",
                    "sourceNote": null
                }
            ],
            "totalDurationSeconds": 18.0,
            "approvalStatus": "approved",
            "visualMode": "space-25d",
            "networkCallsMade": false,
            "costStatus": "not_called"
        });
        fs::write(
            root.join(script_path),
            serde_json::to_vec_pretty(&script).expect("approved script JSON"),
        )
        .expect("approved script fixture");
        let report = render_approved_local_video_with_state(
            project_id.to_string(),
            script_path.to_string(),
            script,
            Some("Phạm Tuyên".to_string()),
            true,
            &state,
        )
        .await
        .unwrap_or_else(|error| panic!("approved native 2.5D render failed: {error}"));
        let output_path = root.join(&report.video_path);
        let manifest_path = root.join(&report.video_path.replace("master.mp4", "manifest.json"));
        assert!(fs::metadata(&output_path).expect("MP4 exists").len() > 0);
        assert!(report.duration_seconds.is_some_and(|value| value > 0.1));
        let manifest: Value =
            serde_json::from_slice(&fs::read(&manifest_path).expect("manifest exists"))
                .expect("manifest JSON");
        assert_eq!(manifest["animationMode"], "procedural-2.5d-space");
        assert_eq!(manifest["externalAssetsUsed"], false);
        let connection = state.database.lock().expect("database lock");
        let lifecycle_states: (String, String, String) = connection
            .query_row(
                "SELECT j.state, a.state, (SELECT validation_state FROM job_outputs WHERE attempt_id=a.attempt_id AND media_kind='video') FROM jobs j JOIN job_attempts a ON a.job_id=j.job_id WHERE j.job_id=?1 AND a.attempt_id=?2",
                params![report.job_id, report.attempt_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("durable 2.5D lifecycle states");
        assert_eq!(lifecycle_states.0, "succeeded_needs_review");
        assert_eq!(lifecycle_states.1, "succeeded");
        assert_eq!(lifecycle_states.2, "valid");
        let evidence = serde_json::json!({
            "status": report.status,
            "projectId": project_id,
            "jobId": report.job_id,
            "attemptId": report.attempt_id,
            "videoPath": report.video_path,
            "audioPath": report.audio_path,
            "captionsPath": report.captions_path,
            "durationSeconds": report.duration_seconds,
            "sizeBytes": fs::metadata(&output_path).expect("MP4 metadata").len(),
            "artifactRoot": root.to_string_lossy().to_string(),
            "manifestPath": report.video_path.replace("master.mp4", "manifest.json"),
            "animationMode": manifest["animationMode"],
            "reviewRequired": report.human_review_required,
            "costStatus": report.cost_status,
            "networkCallsMade": report.network_calls_made
        });
        let evidence_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("outputs")
            .join("native-space-25d-e2e-report.json");
        fs::write(
            &evidence_path,
            serde_json::to_vec_pretty(&evidence).expect("evidence JSON"),
        )
        .expect("2.5D evidence file");
    }

    #[tokio::test]
    #[ignore = "opt-in: requires AUTO3DVIDEO_RUN_LICENSED_FOOTAGE_E2E=1, downloaded source manifest, VieNeu cache and local FFmpeg tools"]
    async fn licensed_footage_approved_render_native_e2e_on_windows() {
        if std::env::var("AUTO3DVIDEO_RUN_LICENSED_FOOTAGE_E2E").as_deref() != Ok("1") {
            panic!("Set AUTO3DVIDEO_RUN_LICENSED_FOOTAGE_E2E=1 to run this opt-in test");
        }
        let python_path = std::env::var("AUTO3DVIDEO_TEST_PYTHON").unwrap_or_else(|_| {
            "D:\\Auto3DvideoTools\\vieneu\\.venv\\Scripts\\python.exe".to_string()
        });
        let ffmpeg_path = std::env::var("AUTO3DVIDEO_TEST_FFMPEG").unwrap_or_else(|_| {
            "D:\\MediaTools\\ffmpeg\\package\\ffmpeg-9.0.1-essentials_build\\bin\\ffmpeg.exe"
                .to_string()
        });
        let ffprobe_path = std::env::var("AUTO3DVIDEO_TEST_FFPROBE").unwrap_or_else(|_| {
            "D:\\MediaTools\\ffmpeg\\package\\ffmpeg-9.0.1-essentials_build\\bin\\ffprobe.exe"
                .to_string()
        });
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..");
        let script_path = "outputs/licensed-space-footage-2026-08-25/script.json";
        let script: Value = serde_json::from_slice(
            &fs::read(root.join(script_path)).expect("licensed approved script"),
        )
        .expect("licensed approved script JSON");
        let connection = Connection::open_in_memory().expect("in-memory database");
        apply_migrations(&connection).expect("migrations");
        let project_id = "project-licensed-footage-e2e";
        let timestamp = now_string();
        connection
            .execute(
                "INSERT INTO projects(project_id, name, locale, workspace_root, policy_profile, created_at, updated_at) VALUES (?1, 'Licensed Footage E2E', 'vi-VN', ?2, 'safe-local', ?3, ?3)",
                params![project_id, root.to_string_lossy().to_string(), timestamp],
            )
            .expect("project seed");
        for (tool_id, executable_ref) in [
            ("python", python_path.as_str()),
            ("ffmpeg", ffmpeg_path.as_str()),
            ("ffprobe", ffprobe_path.as_str()),
        ] {
            connection
                .execute(
                    "INSERT INTO tool_configs(tool_id, executable_ref, required, created_at, updated_at) VALUES (?1, ?2, 1, ?3, ?3)",
                    params![tool_id, executable_ref, timestamp],
                )
                .expect("tool seed");
        }
        let state = AppState {
            database: Mutex::new(connection),
            cancellation_tokens: Mutex::new(HashMap::new()),
            cloud_generation_enabled: AtomicBool::new(false),
        };
        let report = render_approved_local_video_with_state(
            project_id.to_string(),
            script_path.to_string(),
            script,
            Some("Phạm Tuyên".to_string()),
            true,
            &state,
        )
        .await
        .unwrap_or_else(|error| panic!("approved native licensed footage render failed: {error}"));
        let output_path = root.join(&report.video_path);
        let manifest_path = root.join(&report.video_path.replace("master.mp4", "manifest.json"));
        assert!(fs::metadata(&output_path).expect("MP4 exists").len() > 0);
        assert!(report.duration_seconds.is_some_and(|value| value > 0.1));
        let manifest: Value =
            serde_json::from_slice(&fs::read(&manifest_path).expect("manifest exists"))
                .expect("manifest JSON");
        assert_eq!(manifest["animationMode"], "licensed-footage-edit");
        assert_eq!(manifest["externalAssetsUsed"], true);
        assert_eq!(manifest["rightsStatus"], "needs_review");
        assert_eq!(manifest["reviewState"], "needs_review");
        let evidence = serde_json::json!({
            "status": report.status,
            "projectId": project_id,
            "jobId": report.job_id,
            "attemptId": report.attempt_id,
            "videoPath": report.video_path,
            "audioPath": report.audio_path,
            "captionsPath": report.captions_path,
            "durationSeconds": report.duration_seconds,
            "sizeBytes": fs::metadata(&output_path).expect("MP4 metadata").len(),
            "artifactRoot": root.to_string_lossy().to_string(),
            "manifestPath": report.video_path.replace("master.mp4", "manifest.json"),
            "animationMode": manifest["animationMode"],
            "externalAssetsUsed": manifest["externalAssetsUsed"],
            "rightsStatus": manifest["rightsStatus"],
            "reviewRequired": report.human_review_required,
            "costStatus": report.cost_status,
            "networkCallsMade": report.network_calls_made
        });
        let evidence_path = root.join("outputs/native-licensed-footage-e2e-report.json");
        fs::write(
            &evidence_path,
            serde_json::to_vec_pretty(&evidence).expect("evidence JSON"),
        )
        .expect("licensed footage evidence file");
    }
}

#[cfg(test)]
mod concat_tests {
    use super::*;

    #[test]
    fn concat_preserves_order_and_repeats_only_the_last_scene() {
        let root = std::env::temp_dir().join(format!("auto3dvideo-concat-test-{}", now_id("run")));
        let scene_dir = root.join(".auto3dvideo/pipeline/scenes/assets");
        fs::create_dir_all(&scene_dir).expect("scene directory");
        fs::write(scene_dir.join("scene-01.png"), b"one").expect("scene one");
        fs::write(scene_dir.join("scene-02.png"), b"two").expect("scene two");
        let manifest = serde_json::json!({
            "scenes": [
                {"relativePath": ".auto3dvideo/pipeline/scenes/assets/scene-01.png", "durationSeconds": 5.0},
                {"relativePath": ".auto3dvideo/pipeline/scenes/assets/scene-02.png", "durationSeconds": 5.0}
            ]
        });
        let output = root.join("concat.txt");
        scene_concat_file(&root, &manifest, &output, 1.0).expect("concat file");
        let content = fs::read_to_string(&output).expect("concat text");
        let first = content.find("scene-01.png").expect("first scene present");
        let second = content.find("scene-02.png").expect("second scene present");
        assert!(first < second, "scene order must be stable");
        assert_eq!(content.matches("scene-01.png").count(), 1);
        assert_eq!(content.matches("scene-02.png").count(), 2);
        fs::remove_dir_all(root).expect("concat test cleanup");
    }
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;

    #[test]
    fn durable_lifecycle_persists_success_and_output_evidence() {
        let root =
            std::env::temp_dir().join(format!("auto3dvideo-lifecycle-test-{}", now_id("run")));
        fs::create_dir_all(root.join("render")).expect("lifecycle workspace");
        let connection = Connection::open_in_memory().expect("in-memory database");
        apply_migrations(&connection).expect("migrations");
        connection
            .execute(
                "INSERT INTO projects(project_id, name, locale, workspace_root, policy_profile, created_at, updated_at) VALUES (?1, 'Lifecycle test', 'vi-VN', ?2, 'safe-local', ?3, ?3)",
                params!["project-lifecycle-test", root.to_string_lossy(), now_string()],
            )
            .expect("test project");
        let state = AppState {
            database: Mutex::new(connection),
            cancellation_tokens: Mutex::new(HashMap::new()),
            cloud_generation_enabled: AtomicBool::new(false),
        };
        let lifecycle = begin_local_video_lifecycle(
            &state,
            "project-lifecycle-test",
            "run-lifecycle-test",
            vec![("render/master.mp4".to_string(), "video".to_string())],
        )
        .expect("begin lifecycle");
        fs::write(root.join("render/master.mp4"), b"valid test output").expect("output");
        let report = LocalVideoPipelineReport {
            status: "succeeded_needs_review".to_string(),
            run_id: "run-lifecycle-test".to_string(),
            job_id: lifecycle.job_id.clone(),
            attempt_id: lifecycle.attempt_id.clone(),
            script_path: "script.json".to_string(),
            scene_manifest_path: "scenes/scene-manifest.json".to_string(),
            audio_path: "narration.wav".to_string(),
            captions_path: "captions.srt".to_string(),
            video_path: "render/master.mp4".to_string(),
            duration_seconds: Some(1.0),
            network_calls_made: false,
            cost_status: "not_called".to_string(),
            human_review_required: true,
            message: "test".to_string(),
        };
        finish_local_video_lifecycle(
            &state,
            &lifecycle,
            "project-lifecycle-test",
            &root,
            Ok(&report),
        )
        .expect("finish lifecycle");
        let connection = state.database.lock().expect("database lock");
        let job_state: String = connection
            .query_row(
                "SELECT state FROM jobs WHERE job_id=?1",
                params![lifecycle.job_id],
                |row| row.get(0),
            )
            .expect("job state");
        assert_eq!(job_state, "succeeded_needs_review");
        let attempt_state: String = connection
            .query_row(
                "SELECT state FROM job_attempts WHERE attempt_id=?1",
                params![lifecycle.attempt_id],
                |row| row.get(0),
            )
            .expect("attempt state");
        assert_eq!(attempt_state, "succeeded");
        let (validation_state, size_bytes): (String, i64) = connection
            .query_row(
                "SELECT validation_state, size_bytes FROM job_outputs WHERE relative_path='render/master.mp4'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("output evidence");
        assert_eq!(validation_state, "valid");
        assert!(size_bytes > 0);
        drop(connection);
        assert!(state
            .cancellation_tokens
            .lock()
            .expect("token lock")
            .is_empty());
        fs::remove_dir_all(root).expect("lifecycle cleanup");
    }
}
