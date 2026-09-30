use super::tool_readiness::resolve_configured_tool;
use super::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LocalBlenderFixtureReport {
    output_path: String,
    size_bytes: u64,
    process: ExternalProcessResult,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct True3dFixtureRequest {
    project_id: String,
    #[serde(default)]
    render_video: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct True3dFixtureReport {
    run_id: String,
    scene_path: String,
    manifest_path: String,
    quality_path: String,
    preview_paths: Vec<String>,
    video_path: Option<String>,
    frame_range: [i64; 2],
    fps: u32,
    object_count: usize,
    status: String,
    process: ExternalProcessResult,
    ffmpeg_process: Option<ExternalProcessResult>,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct True3dMultishotFixtureRequest {
    project_id: String,
    #[serde(default)]
    render_video: bool,
    #[serde(default)]
    rerun_shot_id: Option<String>,
    #[serde(default)]
    baseline_asset_library_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct True3dMultishotFixtureReport {
    run_id: String,
    scene_path: String,
    scene_manifest_path: String,
    asset_library_path: String,
    asset_bindings_path: String,
    continuity_report_path: String,
    quality_path: String,
    shot_count: usize,
    rendered_shot_ids: Vec<String>,
    asset_hashes_unchanged: bool,
    rerun_shot_id: Option<String>,
    status: String,
    process: ExternalProcessResult,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AssetPipelineCheckRequest {
    project_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AssetPipelineCheckReport {
    run_id: String,
    report_path: String,
    bindings_path: String,
    quarantine_path: String,
    quality_path: Option<String>,
    asset_count: usize,
    ready_count: usize,
    quarantined_count: usize,
    status: String,
    process: ExternalProcessResult,
    quality_process: Option<ExternalProcessResult>,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BlenderShotPreviewRequest {
    project_id: String,
    script: Value,
    #[serde(default)]
    render_video: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BlenderShotPreviewReport {
    scene_path: String,
    manifest_path: String,
    preview_path: String,
    shot_preview_paths: Vec<String>,
    edit_plan_path: String,
    video_path: Option<String>,
    shot_count: usize,
    frame_range: [i64; 2],
    process: ExternalProcessResult,
    status: String,
    message: String,
    storyboard_mode: String,
    omni_instruction: String,
    hero_binding: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct NarrativeEntityPreview {
    pub(super) entity_id: String,
    pub(super) name: String,
    pub(super) continuity_mode: String,
    pub(super) identity_anchors: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct NarrativeVisualBeatPreview {
    pub(super) beat_id: String,
    pub(super) sequence: i64,
    pub(super) narration_text: String,
    pub(super) start_frame: i64,
    pub(super) end_frame: i64,
    pub(super) duration_frames: i64,
    pub(super) narrative_claim: String,
    pub(super) visual_intent: String,
    pub(super) setting: String,
    pub(super) entities: Vec<NarrativeEntityPreview>,
    pub(super) required_visual_elements: Vec<String>,
    pub(super) positive_prompt: String,
    pub(super) negative_prompt: String,
    pub(super) expected_asset_path: String,
    pub(super) candidate_state: String,
    pub(super) review_decision: String,
    pub(super) semantic_state: String,
    pub(super) continuity_state: String,
    pub(super) rights_state: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct NarrativeVisualPlanPreview {
    pub(super) plan_id: String,
    pub(super) project_id: String,
    pub(super) episode_id: String,
    pub(super) language: String,
    pub(super) aspect_ratio: String,
    pub(super) frame_rate: f64,
    pub(super) total_duration_frames: i64,
    pub(super) beats: Vec<NarrativeVisualBeatPreview>,
    pub(super) generation_started: bool,
    pub(super) network_calls_made: bool,
    pub(super) external_publish: bool,
    pub(super) paid_generation: bool,
    pub(super) human_review_required: bool,
    pub(super) message: String,
}

pub(super) fn compile_narrative_visual_plan(
    document: &Value,
) -> Result<NarrativeVisualPlanPreview, String> {
    let object = document
        .as_object()
        .ok_or_else(|| "NarrativeVisualPlan phải là JSON object".to_string())?;
    const KNOWN_TOP_LEVEL: [&str; 18] = [
        "schemaVersion",
        "planId",
        "projectId",
        "episodeId",
        "language",
        "aspectRatio",
        "width",
        "height",
        "frameRate",
        "scriptUnitCount",
        "sourceScriptRef",
        "styleBibleRef",
        "continuityPolicy",
        "policy",
        "beats",
        "totalDurationFrames",
        "createdAt",
        "updatedAt",
    ];
    if let Some(unknown) = object
        .keys()
        .find(|key| !KNOWN_TOP_LEVEL.contains(&key.as_str()))
    {
        return Err(format!("plan.{unknown} không được phép"));
    }
    if let Some(found) = forbidden_preview_key(document, "plan") {
        return Err(found);
    }
    if object.get("schemaVersion").and_then(Value::as_str) != Some("1.0.0") {
        return Err("schemaVersion phải là 1.0.0".to_string());
    }
    let plan_id = preview_string(object, "planId", "plan")?;
    let project_id = preview_string(object, "projectId", "plan")?;
    let episode_id = preview_string(object, "episodeId", "plan")?;
    for (key, value) in [
        ("planId", &plan_id),
        ("projectId", &project_id),
        ("episodeId", &episode_id),
    ] {
        if !safe_preview_id(value) {
            return Err(format!("plan.{key} không phải safe id"));
        }
    }
    let language = preview_string(object, "language", "plan")?;
    if !language.contains('-') && language.len() < 2 {
        return Err("plan.language không hợp lệ".to_string());
    }
    let aspect_ratio = preview_string(object, "aspectRatio", "plan")?;
    for key in ["sourceScriptRef", "styleBibleRef"] {
        let reference = preview_string(object, key, "plan")?;
        if !safe_preview_relative_path(&reference) {
            return Err(format!("plan.{key} phải là project-relative path"));
        }
    }
    if !matches!(
        aspect_ratio.as_str(),
        "16:9" | "9:16" | "1:1" | "4:5" | "custom"
    ) {
        return Err("plan.aspectRatio không được hỗ trợ".to_string());
    }
    let frame_rate = object
        .get("frameRate")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0 && *value <= 240.0)
        .ok_or_else(|| "plan.frameRate phải trong khoảng 0..240".to_string())?;
    let script_unit_count = object
        .get("scriptUnitCount")
        .and_then(Value::as_i64)
        .filter(|value| (1..=10_000).contains(value))
        .ok_or_else(|| "plan.scriptUnitCount không hợp lệ".to_string())?;
    let continuity = object
        .get("continuityPolicy")
        .and_then(Value::as_object)
        .ok_or_else(|| "plan.continuityPolicy phải là object".to_string())?;
    for key in [
        "entityIdentityRequired",
        "visualEvidenceRequired",
        "promptGroundingRequired",
        "repeatedEntityAnchorsImmutable",
    ] {
        if continuity.get(key).and_then(Value::as_bool) != Some(true) {
            return Err(format!("plan.continuityPolicy.{key} phải là true"));
        }
    }
    preview_required_policy(
        object
            .get("policy")
            .and_then(Value::as_object)
            .ok_or_else(|| "plan.policy phải là object".to_string())?,
        "plan.policy",
    )?;
    let beats = object
        .get("beats")
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty())
        .ok_or_else(|| "plan.beats phải là array không rỗng".to_string())?;
    let total_duration_frames = preview_i64(object, "totalDurationFrames", "plan")?;
    let mut previews = Vec::with_capacity(beats.len());
    let mut previous_end_frame = 0_i64;
    let mut previous_end_unit = 0_i64;
    let mut accumulated_frames = 0_i64;
    let mut persistent_anchors: HashMap<String, Vec<String>> = HashMap::new();

    for (index, beat_value) in beats.iter().enumerate() {
        let context = format!("beats[{index}]");
        let beat = beat_value
            .as_object()
            .ok_or_else(|| format!("{context} phải là object"))?;
        const KNOWN_BEAT_FIELDS: [&str; 16] = [
            "beatId",
            "sequence",
            "narration",
            "timing",
            "narrativeClaim",
            "visualIntent",
            "setting",
            "entities",
            "visualEvidence",
            "prompt",
            "referenceAssetIds",
            "expectedAsset",
            "candidate",
            "review",
            "risk",
            "policy",
        ];
        if let Some(unknown) = beat
            .keys()
            .find(|key| !KNOWN_BEAT_FIELDS.contains(&key.as_str()))
        {
            return Err(format!("{context}.{unknown} không được phép"));
        }
        let expected_sequence = index as i64 + 1;
        if preview_i64(beat, "sequence", &context)? != expected_sequence {
            return Err(format!("{context}.sequence phải liên tục bắt đầu từ 1"));
        }
        let beat_id = preview_string(beat, "beatId", &context)?;
        if beat_id != format!("beat-{expected_sequence:03}") {
            return Err(format!("{context}.beatId không khớp sequence"));
        }
        let narration = beat
            .get("narration")
            .and_then(Value::as_object)
            .ok_or_else(|| format!("{context}.narration phải là object"))?;
        let narration_text = preview_string(narration, "text", &format!("{context}.narration"))?;
        let start_unit = preview_i64(narration, "startUnit", &format!("{context}.narration"))?;
        let end_unit = preview_i64(narration, "endUnit", &format!("{context}.narration"))?;
        if start_unit != previous_end_unit
            || !(0..=script_unit_count).contains(&start_unit)
            || !(1..=script_unit_count).contains(&end_unit)
            || start_unit >= end_unit
        {
            return Err(format!(
                "{context}.narration span bị hở, chồng lấn hoặc vượt script"
            ));
        }
        previous_end_unit = end_unit;

        let timing = beat
            .get("timing")
            .and_then(Value::as_object)
            .ok_or_else(|| format!("{context}.timing phải là object"))?;
        let start_frame = preview_i64(timing, "startFrame", &format!("{context}.timing"))?;
        let end_frame = preview_i64(timing, "endFrame", &format!("{context}.timing"))?;
        let duration_frames = preview_i64(timing, "durationFrames", &format!("{context}.timing"))?;
        if start_frame != previous_end_frame
            || end_frame <= start_frame
            || duration_frames != end_frame - start_frame
        {
            return Err(format!(
                "{context}.timing phải contiguous và durationFrames=endFrame-startFrame"
            ));
        }
        previous_end_frame = end_frame;
        accumulated_frames += duration_frames;

        let narrative_claim = preview_string(beat, "narrativeClaim", &context)?;
        let visual_intent = preview_string(beat, "visualIntent", &context)?;
        let setting = preview_string(beat, "setting", &context)?;
        let entities_value = beat
            .get("entities")
            .and_then(Value::as_array)
            .filter(|items| !items.is_empty())
            .ok_or_else(|| format!("{context}.entities phải có ít nhất một entity"))?;
        let mut entities = Vec::with_capacity(entities_value.len());
        for (entity_index, entity_value) in entities_value.iter().enumerate() {
            let entity_context = format!("{context}.entities[{entity_index}]");
            let entity = entity_value
                .as_object()
                .ok_or_else(|| format!("{entity_context} phải là object"))?;
            let entity_id = preview_string(entity, "entityId", &entity_context)?;
            if !safe_preview_id(&entity_id) {
                return Err(format!("{entity_context}.entityId không hợp lệ"));
            }
            let name = preview_string(entity, "name", &entity_context)?;
            let continuity_mode = preview_string(entity, "continuityMode", &entity_context)?;
            if !matches!(
                continuity_mode.as_str(),
                "new" | "persistent" | "background"
            ) {
                return Err(format!("{entity_context}.continuityMode không hợp lệ"));
            }
            let identity_anchors =
                preview_string_array(entity, "identityAnchors", &entity_context, true)?;
            let _ = preview_string_array(entity, "referenceAssetIds", &entity_context, false)?;
            if continuity_mode == "persistent" {
                if let Some(previous) = persistent_anchors.get(&entity_id) {
                    if previous != &identity_anchors {
                        return Err(format!("persistent entity {entity_id} đổi identityAnchors"));
                    }
                } else {
                    persistent_anchors.insert(entity_id.clone(), identity_anchors.clone());
                }
            }
            entities.push(NarrativeEntityPreview {
                entity_id,
                name,
                continuity_mode,
                identity_anchors,
            });
        }

        let visual_evidence = beat
            .get("visualEvidence")
            .and_then(Value::as_object)
            .ok_or_else(|| format!("{context}.visualEvidence phải là object"))?;
        let required_visual_elements = preview_string_array(
            visual_evidence,
            "requiredElements",
            &format!("{context}.visualEvidence"),
            true,
        )?;
        let prompt = beat
            .get("prompt")
            .and_then(Value::as_object)
            .ok_or_else(|| format!("{context}.prompt phải là object"))?;
        let positive_prompt = preview_string(prompt, "positive", &format!("{context}.prompt"))?;
        let negative_prompt = preview_string(prompt, "negative", &format!("{context}.prompt"))?;
        let grounding_tokens = preview_string_array(
            prompt,
            "groundingTokens",
            &format!("{context}.prompt"),
            true,
        )?;
        for token in grounding_tokens
            .iter()
            .chain(required_visual_elements.iter())
        {
            if !preview_contains_tokens(&positive_prompt, token) {
                return Err(format!(
                    "{context} prompt thiếu grounding token/visual element: {token}"
                ));
            }
        }

        let expected_asset = beat
            .get("expectedAsset")
            .and_then(Value::as_object)
            .ok_or_else(|| format!("{context}.expectedAsset phải là object"))?;
        let expected_asset_path = preview_string(
            expected_asset,
            "relativePath",
            &format!("{context}.expectedAsset"),
        )?;
        if !safe_preview_relative_path(&expected_asset_path)
            || !expected_asset_path
                .replace('\\', "/")
                .starts_with("outputs/visual-plan/")
        {
            return Err(format!(
                "{context}.expectedAsset.relativePath phải ở outputs/visual-plan"
            ));
        }
        if expected_asset.get("mustBeNew").and_then(Value::as_bool) != Some(true) {
            return Err(format!("{context}.expectedAsset.mustBeNew phải là true"));
        }
        let candidate = beat
            .get("candidate")
            .and_then(Value::as_object)
            .ok_or_else(|| format!("{context}.candidate phải là object"))?;
        let candidate_state =
            preview_string(candidate, "selectionState", &format!("{context}.candidate"))?;
        if !matches!(
            candidate_state.as_str(),
            "not_generated" | "candidate" | "accepted" | "rejected"
        ) {
            return Err(format!("{context}.candidate.selectionState không hợp lệ"));
        }
        if candidate_state == "not_generated" && !candidate.get("score").is_some_and(Value::is_null)
        {
            return Err(format!(
                "{context}.candidate.score phải null trước generation"
            ));
        }
        for key in ["providerProfileRef", "modelProfileRef"] {
            if let Some(value) = candidate.get(key).and_then(Value::as_str) {
                if !safe_preview_id(value) || preview_secret_like(value) {
                    return Err(format!(
                        "{context}.candidate.{key} phải là safe non-secret profile id"
                    ));
                }
            }
        }
        let review = beat
            .get("review")
            .and_then(Value::as_object)
            .ok_or_else(|| format!("{context}.review phải là object"))?;
        let review_decision = preview_string(review, "decision", &format!("{context}.review"))?;
        let semantic_state = preview_string(review, "semanticState", &format!("{context}.review"))?;
        let continuity_state =
            preview_string(review, "continuityState", &format!("{context}.review"))?;
        let rights_state = preview_string(review, "rightsState", &format!("{context}.review"))?;
        if !matches!(
            review_decision.as_str(),
            "not_started" | "needs_review" | "approved" | "rejected"
        ) || !matches!(semantic_state.as_str(), "not_checked" | "pass" | "fail")
            || !matches!(continuity_state.as_str(), "not_checked" | "pass" | "fail")
            || !matches!(rights_state.as_str(), "pending" | "pass" | "fail")
        {
            return Err(format!("{context}.review state không hợp lệ"));
        }
        preview_required_policy(
            beat.get("policy")
                .and_then(Value::as_object)
                .ok_or_else(|| format!("{context}.policy phải là object"))?,
            &format!("{context}.policy"),
        )?;
        let _ = preview_string_array(
            beat.get("risk")
                .and_then(Value::as_object)
                .ok_or_else(|| format!("{context}.risk phải là object"))?,
            "issues",
            &format!("{context}.risk"),
            false,
        )?;
        if beat
            .get("risk")
            .and_then(Value::as_object)
            .and_then(|risk| risk.get("needsHumanReview"))
            .and_then(Value::as_bool)
            != Some(true)
        {
            return Err(format!("{context}.risk.needsHumanReview phải là true"));
        }
        previews.push(NarrativeVisualBeatPreview {
            beat_id,
            sequence: expected_sequence,
            narration_text,
            start_frame,
            end_frame,
            duration_frames,
            narrative_claim,
            visual_intent,
            setting,
            entities,
            required_visual_elements,
            positive_prompt,
            negative_prompt,
            expected_asset_path,
            candidate_state,
            review_decision,
            semantic_state,
            continuity_state,
            rights_state,
        });
    }
    if previous_end_unit != script_unit_count {
        return Err("narration spans không bao phủ toàn bộ script".to_string());
    }
    if accumulated_frames != total_duration_frames || previous_end_frame != total_duration_frames {
        return Err("totalDurationFrames không khớp timing contiguous".to_string());
    }
    Ok(NarrativeVisualPlanPreview {
        plan_id,
        project_id,
        episode_id,
        language,
        aspect_ratio,
        frame_rate,
        total_duration_frames,
        beats: previews,
        generation_started: false,
        network_calls_made: false,
        external_publish: false,
        paid_generation: false,
        human_review_required: true,
        message: "Preview deterministic; chưa gọi model/provider và chưa tạo media.".to_string(),
    })
}

#[tauri::command]
pub(super) fn preview_narrative_visual_plan(
    plan_json: String,
) -> Result<NarrativeVisualPlanPreview, String> {
    valid_text(&plan_json, "NarrativeVisualPlan JSON")?;
    let document: Value = serde_json::from_str(&plan_json)
        .map_err(|error| format!("NarrativeVisualPlan JSON không hợp lệ: {error}"))?;
    compile_narrative_visual_plan(&document)
}

#[tauri::command]
pub(super) fn preview_narrative_visual_plan_fixture() -> Result<NarrativeVisualPlanPreview, String>
{
    let document: Value = serde_json::from_str(NARRATIVE_VISUAL_PLAN_FIXTURE)
        .map_err(|error| format!("Fixture NarrativeVisualPlan không hợp lệ: {error}"))?;
    compile_narrative_visual_plan(&document)
}

const BLENDER_FIXTURE_SCRIPT: &str = r#"import bpy
import os
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add(location=(0, 0, 0))
cube = bpy.context.object
cube.name = "Auto3DvideoSyntheticCube"
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.getcwd(), "synthetic-cube.blend"))
"#;

#[tauri::command]
pub(super) async fn run_blender_fixture(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<LocalBlenderFixtureReport, String> {
    valid_text(&project_id, "Project ID")?;
    let (workspace_root, blender_path) = {
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
        let blender_path = resolve_configured_tool(&connection, "blender")?;
        (PathBuf::from(workspace_root), blender_path)
    };
    let workspace_root = fs::canonicalize(&workspace_root)
        .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?;
    let fixture_directory = workspace_root
        .join(".auto3dvideo")
        .join("fixtures")
        .join("blender");
    fs::create_dir_all(&fixture_directory)
        .map_err(|error| format!("Không tạo được Blender fixture directory: {error}"))?;
    let script_path = fixture_directory.join("synthetic-cube.py");
    let output_path = fixture_directory.join("synthetic-cube.blend");
    fs::write(&script_path, BLENDER_FIXTURE_SCRIPT)
        .map_err(|error| format!("Không ghi được Blender fixture script: {error}"))?;
    let relative_output = output_path
        .strip_prefix(&workspace_root)
        .map_err(|_| "Blender fixture output vượt project workspace".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let script_relative = script_path
        .strip_prefix(&workspace_root)
        .map_err(|_| "Blender fixture script vượt project workspace".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let result = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "blender".to_string(),
            args: vec![
                "--background".to_string(),
                "--factory-startup".to_string(),
                "--python".to_string(),
                script_relative,
            ],
            working_directory: ".".to_string(),
            environment: Default::default(),
            timeout_seconds: 120,
            expected_outputs: vec![relative_output.clone()],
        },
        executable_path: blender_path,
        absolute_working_directory: fixture_directory,
        output_root: workspace_root,
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    if !result.succeeded {
        return Err("Blender fixture không tạo được file .blend hợp lệ".to_string());
    }
    let size_bytes = fs::metadata(&output_path)
        .map_err(|error| format!("Không đọc được Blender fixture output: {error}"))?
        .len();
    Ok(LocalBlenderFixtureReport {
        output_path: relative_output,
        size_bytes,
        process: result,
    })
}

#[tauri::command]
pub(super) async fn run_true3d_fixture(
    request: True3dFixtureRequest,
    state: State<'_, AppState>,
) -> Result<True3dFixtureReport, String> {
    valid_text(&request.project_id, "Project ID")?;
    let (workspace_root, blender_path, ffmpeg_path) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        let workspace_root: String = connection
            .query_row(
                "SELECT workspace_root FROM projects WHERE project_id = ?1",
                params![request.project_id.trim()],
                |row| row.get(0),
            )
            .map_err(|error| format!("Không đọc được project workspace: {error}"))?;
        (
            PathBuf::from(workspace_root),
            resolve_configured_tool(&connection, "blender")?,
            if request.render_video {
                Some(resolve_configured_tool(&connection, "ffmpeg")?)
            } else {
                None
            },
        )
    };
    let workspace_root = fs::canonicalize(&workspace_root)
        .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?;
    let run_id = now_id("true3d");
    let output_dir = workspace_root
        .join(".auto3dvideo")
        .join("runs")
        .join(&run_id);
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Không tạo được true 3D run directory: {error}"))?;
    let spec_path = output_dir.join("scene-spec.json");
    let script_path = output_dir.join("true3d_scene_worker.py");
    let spec = serde_json::json!({
        "schemaVersion": "1.0.0",
        "jobType": "scene.build",
        "projectId": request.project_id.trim(),
        "runId": run_id,
        "shotId": "SHOT-001",
        "profile": "cinematic-3d",
        "fps": 30,
        "width": 512,
        "height": 288,
        "engine": "BLENDER_EEVEE_NEXT",
        "renderVideo": request.render_video,
        "worldBible": {
            "era": "prehistoric Cretaceous forest",
            "scaleSystem": "meters",
            "environment": "misty fern valley with volcanic rocks",
            "palette": ["deep jungle green", "orange tiger", "red-brown trex", "blue rim light"]
        },
        "characterBibles": [
            {"characterId": "tiger-giant", "heightMeters": 8.0},
            {"characterId": "trex", "heightMeters": 12.0}
        ]
    });
    fs::write(
        &spec_path,
        serde_json::to_vec_pretty(&spec).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Không ghi được true 3D scene spec: {error}"))?;
    fs::write(&script_path, TRUE3D_SCENE_WORKER_SCRIPT)
        .map_err(|error| format!("Không ghi được true 3D Blender worker: {error}"))?;
    let relative = |path: &Path| -> Result<String, String> {
        path.strip_prefix(&workspace_root)
            .map_err(|_| "True 3D output vượt project workspace".to_string())
            .map(|value| value.to_string_lossy().replace('\\', "/"))
    };
    let working_directory = relative(&output_dir)?;
    let spec_relative = relative(&spec_path)?;
    let script_relative = relative(&script_path)?;
    let scene_relative = relative(&output_dir.join("scene.blend"))?;
    let manifest_relative = relative(&output_dir.join("scene-manifest.json"))?;
    let quality_relative = relative(&output_dir.join("quality-report.json"))?;
    let preview_relatives = [1_i64, 60, 120]
        .iter()
        .map(|frame| {
            relative(
                &output_dir
                    .join("preview")
                    .join(format!("frame-{frame:04}.png")),
            )
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut expected_outputs = vec![
        scene_relative.clone(),
        manifest_relative.clone(),
        quality_relative.clone(),
    ];
    expected_outputs.extend(preview_relatives.clone());
    if request.render_video {
        expected_outputs.push(relative(&output_dir.join("frames").join("frame_0001.png"))?);
    }
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
                "--spec".to_string(),
                spec_relative,
                "--output-dir".to_string(),
                working_directory.clone(),
                "--render-video".to_string(),
                request.render_video.to_string(),
            ],
            working_directory: ".".to_string(),
            environment: Default::default(),
            timeout_seconds: if request.render_video { 1800 } else { 600 },
            expected_outputs,
        },
        executable_path: blender_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    if !process.succeeded {
        let detail = process.stderr.chars().take(900).collect::<String>();
        return Err(format!(
            "True 3D Blender worker thất bại (exit={:?}, timeout={}): {}",
            process.exit_code,
            process.timed_out,
            if detail.trim().is_empty() {
                "không có stderr"
            } else {
                detail.trim()
            }
        ));
    }
    let manifest_path = workspace_root.join(&manifest_relative);
    let manifest: Value = serde_json::from_str(
        &fs::read_to_string(&manifest_path)
            .map_err(|error| format!("Không đọc được true 3D scene manifest: {error}"))?,
    )
    .map_err(|error| format!("True 3D scene manifest không phải JSON hợp lệ: {error}"))?;
    let assertions = manifest
        .get("assertions")
        .and_then(Value::as_array)
        .ok_or_else(|| "True 3D scene manifest thiếu assertions".to_string())?;
    if assertions.is_empty()
        || assertions
            .iter()
            .any(|assertion| assertion.get("passed") != Some(&Value::Bool(true)))
    {
        return Err("True 3D deterministic scene assertions chưa đạt".to_string());
    }
    let ffmpeg_process = if request.render_video {
        let ffmpeg_path =
            ffmpeg_path.ok_or_else(|| "Thiếu FFmpeg cho true 3D video preview".to_string())?;
        let video_relative = relative(&output_dir.join("true3d-preview.mp4"))?;
        let ffmpeg = run_external_process(ExternalProcessRequest {
            spec: ProcessSpec {
                executable_id: "ffmpeg".to_string(),
                args: vec![
                    "-y".to_string(),
                    "-framerate".to_string(),
                    "30".to_string(),
                    "-i".to_string(),
                    format!("{working_directory}/frames/frame_%04d.png"),
                    "-c:v".to_string(),
                    "libx264".to_string(),
                    "-pix_fmt".to_string(),
                    "yuv420p".to_string(),
                    video_relative.clone(),
                ],
                working_directory: ".".to_string(),
                environment: Default::default(),
                timeout_seconds: 1800,
                expected_outputs: vec![video_relative],
            },
            executable_path: ffmpeg_path,
            absolute_working_directory: workspace_root.clone(),
            output_root: workspace_root.clone(),
            cancellation: Arc::new(AtomicBool::new(false)),
        })
        .await?;
        if !ffmpeg.succeeded {
            return Err("FFmpeg không đóng gói được true 3D preview video".to_string());
        }
        Some(ffmpeg)
    } else {
        None
    };
    let video_path = if request.render_video {
        Some(relative(&output_dir.join("true3d-preview.mp4"))?)
    } else {
        None
    };
    let object_count = manifest
        .get("objectInventory")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    let frame_start = manifest
        .get("frameStart")
        .and_then(Value::as_i64)
        .unwrap_or(1);
    let frame_end = manifest
        .get("frameEnd")
        .and_then(Value::as_i64)
        .unwrap_or(120);
    let report = True3dFixtureReport {
        run_id: run_id.clone(),
        scene_path: scene_relative,
        manifest_path: manifest_relative,
        quality_path: quality_relative,
        preview_paths: preview_relatives,
        video_path,
        frame_range: [frame_start, frame_end],
        fps: 30,
        object_count,
        status: "succeeded_needs_review".to_string(),
        process,
        ffmpeg_process,
        message:
            "Đã dựng một shot true 3D bằng Blender; output cần human review trước final delivery."
                .to_string(),
    };
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database để ghi audit".to_string())?;
    audit_event(
        &connection,
        Some(request.project_id.trim()),
        "true3d.fixture_succeeded",
        "true3d_run",
        &run_id,
    )?;
    Ok(report)
}

#[tauri::command]
pub(super) async fn run_true3d_multishot_fixture(
    request: True3dMultishotFixtureRequest,
    state: State<'_, AppState>,
) -> Result<True3dMultishotFixtureReport, String> {
    valid_text(&request.project_id, "Project ID")?;
    let project_id = request.project_id.trim().to_string();
    let rerun_shot_id = request
        .rerun_shot_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let baseline_asset_library_path = request
        .baseline_asset_library_path
        .as_deref()
        .map(validate_attempt_output_path)
        .transpose()?;
    let (workspace_root, blender_path) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        let workspace_root: String = connection
            .query_row(
                "SELECT workspace_root FROM projects WHERE project_id = ?1",
                params![project_id.as_str()],
                |row| row.get(0),
            )
            .map_err(|error| format!("Không đọc được project workspace: {error}"))?;
        (
            PathBuf::from(workspace_root),
            resolve_configured_tool(&connection, "blender")?,
        )
    };
    let workspace_root = fs::canonicalize(&workspace_root)
        .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?;
    let run_id = now_id("true3d-multishot");
    let output_dir = workspace_root
        .join(".auto3dvideo")
        .join("runs")
        .join(&run_id);
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Không tạo được multi-shot run directory: {error}"))?;
    let spec_path = output_dir.join("multishot-spec.json");
    let worker_path = output_dir.join("true3d_multishot_worker.py");
    let primitive_worker_path = output_dir.join("true3d_scene_worker.py");
    let mut spec: Value = serde_json::from_str(PLAN023_MULTISHOT_SPEC)
        .map_err(|error| format!("Không đọc được multi-shot fixture spec: {error}"))?;
    let spec_object = spec
        .as_object_mut()
        .ok_or_else(|| "Multi-shot fixture spec không phải JSON object".to_string())?;
    spec_object.insert("projectId".to_string(), Value::String(project_id.clone()));
    spec_object.insert("runId".to_string(), Value::String(run_id.clone()));
    spec_object.insert("renderVideo".to_string(), Value::Bool(request.render_video));
    let shot_ids = spec
        .get("shots")
        .and_then(Value::as_array)
        .ok_or_else(|| "Multi-shot fixture thiếu shots".to_string())?
        .iter()
        .map(|shot| {
            shot.get("shotId")
                .and_then(Value::as_str)
                .map(str::to_string)
                .ok_or_else(|| "Multi-shot fixture có shotId không hợp lệ".to_string())
        })
        .collect::<Result<Vec<_>, String>>()?;
    if let Some(rerun) = rerun_shot_id.as_ref() {
        if !shot_ids.iter().any(|shot_id| shot_id == rerun) {
            return Err(format!("Không thể rerun shot không tồn tại: {rerun}"));
        }
    }
    let rendered_shot_ids = rerun_shot_id
        .as_ref()
        .map(|shot_id| vec![shot_id.clone()])
        .unwrap_or_else(|| shot_ids.clone());
    fs::write(
        &spec_path,
        serde_json::to_vec_pretty(&spec).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Không ghi được multi-shot scene spec: {error}"))?;
    fs::write(&worker_path, TRUE3D_MULTISHOT_WORKER_SCRIPT)
        .map_err(|error| format!("Không ghi được multi-shot Blender worker: {error}"))?;
    fs::write(&primitive_worker_path, TRUE3D_SCENE_WORKER_SCRIPT)
        .map_err(|error| format!("Không ghi được shared Blender primitive worker: {error}"))?;
    let relative = |path: &Path| -> Result<String, String> {
        path.strip_prefix(&workspace_root)
            .map_err(|_| "Multi-shot output vượt project workspace".to_string())
            .map(|value| value.to_string_lossy().replace('\\', "/"))
    };
    let working_directory = relative(&output_dir)?;
    let spec_relative = relative(&spec_path)?;
    let worker_relative = relative(&worker_path)?;
    let scene_relative = relative(&output_dir.join("scene.blend"))?;
    let scene_manifest_relative = relative(&output_dir.join("scene-manifest.json"))?;
    let asset_library_relative = relative(&output_dir.join("asset-library.json"))?;
    let asset_bindings_relative = relative(&output_dir.join("asset-bindings.json"))?;
    let continuity_relative = relative(&output_dir.join("continuity-report.json"))?;
    let quality_relative = relative(&output_dir.join("quality-report.json"))?;
    let mut expected_outputs = vec![
        scene_relative.clone(),
        scene_manifest_relative.clone(),
        asset_library_relative.clone(),
        asset_bindings_relative.clone(),
        continuity_relative.clone(),
        quality_relative.clone(),
    ];
    for shot_id in &rendered_shot_ids {
        expected_outputs.push(relative(
            &output_dir.join("shots").join(shot_id).join("scene.blend"),
        )?);
        expected_outputs.push(relative(
            &output_dir
                .join("shots")
                .join(shot_id)
                .join("shot-manifest.json"),
        )?);
        for frame in [1_i64, 15, 30] {
            expected_outputs.push(relative(
                &output_dir
                    .join("shots")
                    .join(shot_id)
                    .join("preview")
                    .join(format!("frame-{frame:04}.png")),
            )?);
        }
        if request.render_video {
            expected_outputs.push(relative(
                &output_dir
                    .join("shots")
                    .join(shot_id)
                    .join("frames")
                    .join("frame_0001.png"),
            )?);
        }
    }
    let mut args = vec![
        "--background".to_string(),
        "--factory-startup".to_string(),
        "--python".to_string(),
        worker_relative,
        "--".to_string(),
        "--workspace".to_string(),
        workspace_root.to_string_lossy().to_string(),
        "--spec".to_string(),
        spec_relative,
        "--output-dir".to_string(),
        working_directory,
        "--render-video".to_string(),
        request.render_video.to_string(),
    ];
    if let Some(rerun) = rerun_shot_id.as_ref() {
        args.push("--rerun-shot".to_string());
        args.push(rerun.clone());
    }
    if let Some(baseline) = baseline_asset_library_path.as_ref() {
        args.push("--baseline-asset-library".to_string());
        args.push(baseline.clone());
    }
    let process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "blender".to_string(),
            args,
            working_directory: ".".to_string(),
            environment: Default::default(),
            timeout_seconds: if request.render_video { 1800 } else { 900 },
            expected_outputs,
        },
        executable_path: blender_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    if !process.succeeded {
        let detail = process.stderr.chars().take(900).collect::<String>();
        return Err(format!(
            "Multi-shot Blender worker thất bại (exit={:?}, timeout={}): {}",
            process.exit_code,
            process.timed_out,
            if detail.trim().is_empty() {
                "không có stderr"
            } else {
                detail.trim()
            }
        ));
    }
    let continuity: Value = serde_json::from_str(
        &fs::read_to_string(workspace_root.join(&continuity_relative))
            .map_err(|error| format!("Không đọc được continuity report: {error}"))?,
    )
    .map_err(|error| format!("Continuity report không phải JSON hợp lệ: {error}"))?;
    let report_shot_ids = continuity
        .get("shotIds")
        .and_then(Value::as_array)
        .ok_or_else(|| "Continuity report thiếu shotIds".to_string())?;
    if report_shot_ids.len() != shot_ids.len() {
        return Err("Continuity report không đủ 8 shot của fixture".to_string());
    }
    let drift_findings = continuity
        .get("driftFindings")
        .and_then(Value::as_array)
        .ok_or_else(|| "Continuity report thiếu driftFindings".to_string())?;
    if !drift_findings.is_empty() {
        return Err("Multi-shot continuity phát hiện drift; không đánh dấu thành công".to_string());
    }
    let asset_hashes_unchanged = continuity
        .get("assetHashesUnchanged")
        .and_then(Value::as_bool)
        .ok_or_else(|| "Continuity report thiếu assetHashesUnchanged".to_string())?;
    if !asset_hashes_unchanged {
        return Err(
            "Asset hash thay đổi khi chạy multi-shot; cần review trước khi tiếp tục".to_string(),
        );
    }
    let status = if rerun_shot_id.is_some() {
        "succeeded_needs_review_rerun"
    } else {
        "succeeded_needs_review"
    };
    let report = True3dMultishotFixtureReport {
        run_id: run_id.clone(),
        scene_path: scene_relative,
        scene_manifest_path: scene_manifest_relative,
        asset_library_path: asset_library_relative,
        asset_bindings_path: asset_bindings_relative,
        continuity_report_path: continuity_relative,
        quality_path: quality_relative,
        shot_count: shot_ids.len(),
        rendered_shot_ids,
        asset_hashes_unchanged,
        rerun_shot_id,
        status: status.to_string(),
        process,
        message: "Đã dựng multi-shot true 3D với world/character/asset hashes dùng chung; output cần human review.".to_string(),
    };
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database để ghi audit".to_string())?;
    audit_event(
        &connection,
        Some(project_id.as_str()),
        "true3d.multishot_fixture_succeeded",
        "true3d_multishot_run",
        &run_id,
    )?;
    Ok(report)
}

#[tauri::command]
pub(super) async fn run_asset_pipeline_check(
    request: AssetPipelineCheckRequest,
    state: State<'_, AppState>,
) -> Result<AssetPipelineCheckReport, String> {
    valid_text(&request.project_id, "Project ID")?;
    let project_id = request.project_id.trim().to_string();
    let (workspace_root, python_path, blender_path, spec_assets) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        ensure_project_exists(&connection, project_id.as_str())?;
        let workspace_root = project_workspace_root(&connection, project_id.as_str())?;
        let python_path = resolve_configured_tool(&connection, "python")?;
        let blender_path = resolve_configured_tool(&connection, "blender").ok();
        let mut assignment_roles: HashMap<String, (String, Vec<String>)> = HashMap::new();
        let mut assignment_statement = connection
            .prepare("SELECT asset_id, role, shot_id FROM reference_set_assignments WHERE project_id = ?1 ORDER BY priority DESC, created_at ASC")
            .map_err(|error| format!("Không đọc được gán reference asset: {error}"))?;
        let assignment_rows = assignment_statement
            .query_map(params![project_id.as_str()], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        for row in assignment_rows {
            let (asset_id, raw_role, shot_id) = row.map_err(|error| error.to_string())?;
            let role = match raw_role.as_str() {
                "identity" | "composition" | "pose" | "camera" | "style" | "start_frame"
                | "end_frame" => raw_role,
                "negative" => "style".to_string(),
                _ => "identity".to_string(),
            };
            let entry = assignment_roles
                .entry(asset_id)
                .or_insert_with(|| (role.clone(), Vec::new()));
            if entry.1.is_empty() {
                entry.0 = role;
            }
            if let Some(shot_id) = shot_id.filter(|value| !value.trim().is_empty()) {
                if !entry.1.iter().any(|existing| existing == &shot_id) {
                    entry.1.push(shot_id);
                }
            }
        }
        let mut statement = connection
            .prepare("SELECT asset_id, title, relative_path, media_kind, rights_status FROM asset_library WHERE project_id = ?1 AND status != 'archived' ORDER BY updated_at DESC")
            .map_err(|error| format!("Không đọc được Asset Library: {error}"))?;
        let rows = statement
            .query_map(params![project_id.as_str()], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        let mut values = Vec::new();
        for row in rows {
            let (asset_id, title, relative_path, media_kind, rights_status) =
                row.map_err(|error| error.to_string())?;
            if !safe_preview_relative_path(&relative_path) {
                return Err(format!("Asset {asset_id} có relative path không an toàn"));
            }
            let declared_kind = match media_kind.trim().to_ascii_lowercase().as_str() {
                "texture" => "texture",
                "model3d" | "scene" => "model3d",
                "render" | "image_sequence" | "thumbnail" => "render",
                _ => "reference_image",
            };
            let role = assignment_roles
                .get(&asset_id)
                .map(|value| value.0.clone())
                .unwrap_or_else(|| match declared_kind {
                    "model3d" => "model3d".to_string(),
                    "texture" => "texture".to_string(),
                    "render" => "composition".to_string(),
                    _ => "identity".to_string(),
                });
            let shot_ids = assignment_roles
                .get(&asset_id)
                .map(|value| value.1.clone())
                .unwrap_or_default();
            values.push(serde_json::json!({
                "assetId": asset_id,
                "title": title,
                "sourcePath": relative_path,
                "declaredKind": declared_kind,
                "role": role,
                "rightsStatus": rights_status,
                "reviewState": "needs_review",
                "shotIds": shot_ids,
                "provenance": "Asset Library local ingest; source/hash được ghi bởi app"
            }));
        }
        if values.is_empty() {
            return Err(
                "Asset Library đang trống; hãy nhập asset local trước khi chạy pipeline check."
                    .to_string(),
            );
        }
        (workspace_root, python_path, blender_path, values)
    };
    let workspace_root = fs::canonicalize(&workspace_root)
        .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?;
    let run_id = now_id("asset-pipeline");
    let output_dir = workspace_root
        .join(".auto3dvideo")
        .join("runs")
        .join(&run_id)
        .join("asset-pipeline");
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Không tạo được asset pipeline directory: {error}"))?;
    let spec_path = output_dir.join("asset-ingest-spec.json");
    let worker_path = output_dir.join("asset_pipeline_worker.py");
    let spec = serde_json::json!({
        "schemaVersion": "1.0.0",
        "jobType": "asset.ingest",
        "projectId": project_id,
        "runId": run_id,
        "assets": spec_assets,
    });
    fs::write(
        &spec_path,
        serde_json::to_vec_pretty(&spec).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Không ghi được asset ingest spec: {error}"))?;
    fs::write(&worker_path, ASSET_PIPELINE_WORKER_SCRIPT)
        .map_err(|error| format!("Không ghi được asset pipeline worker: {error}"))?;
    let relative = |path: &Path| -> Result<String, String> {
        path.strip_prefix(&workspace_root)
            .map_err(|_| "Asset pipeline output vượt project workspace".to_string())
            .map(|value| value.to_string_lossy().replace('\\', "/"))
    };
    let output_relative = relative(&output_dir)?;
    let spec_relative = relative(&spec_path)?;
    let worker_relative = relative(&worker_path)?;
    let report_relative = relative(&output_dir.join("asset-pipeline-report.json"))?;
    let bindings_relative = relative(&output_dir.join("asset-bindings.json"))?;
    let quarantine_relative = relative(&output_dir.join("quarantine.json"))?;
    let process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "python".to_string(),
            args: vec![
                worker_relative.clone(),
                "--workspace".to_string(),
                workspace_root.to_string_lossy().to_string(),
                "--spec".to_string(),
                spec_relative,
                "--output-dir".to_string(),
                output_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: Default::default(),
            timeout_seconds: 180,
            expected_outputs: vec![
                report_relative.clone(),
                bindings_relative.clone(),
                quarantine_relative.clone(),
            ],
        },
        executable_path: python_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    if !process.succeeded {
        return Err(format!(
            "Asset pipeline ingest thất bại (exit={:?}, timeout={}): {}",
            process.exit_code,
            process.timed_out,
            process.stderr.chars().take(700).collect::<String>()
        ));
    }
    let initial_report_path = workspace_root.join(&report_relative);
    let initial_report: Value = serde_json::from_str(
        &fs::read_to_string(&initial_report_path)
            .map_err(|error| format!("Không đọc được asset pipeline report: {error}"))?,
    )
    .map_err(|error| format!("Asset pipeline report không phải JSON hợp lệ: {error}"))?;
    let model_assets = initial_report
        .get("assets")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|asset| {
            asset.get("declaredKind").and_then(Value::as_str) == Some("model3d")
                && asset.get("status").and_then(Value::as_str) == Some("ready")
        })
        .map(|asset| {
            serde_json::json!({
                "assetId": asset.get("assetId").and_then(Value::as_str).unwrap_or("asset"),
                "relativePath": asset.get("relativePath").and_then(Value::as_str).unwrap_or("")
            })
        })
        .collect::<Vec<_>>();
    let quality_relative = relative(&output_dir.join("quality").join("asset-quality-report.json"))?;
    let quality_process = if model_assets.is_empty() {
        None
    } else {
        let quality_root = output_dir.join("quality");
        fs::create_dir_all(&quality_root)
            .map_err(|error| format!("Không tạo được asset quality directory: {error}"))?;
        let quality_spec_path = output_dir.join("blender-quality-spec.json");
        let quality_worker_path = output_dir.join("blender_asset_quality_worker.py");
        let toolkit_path = output_dir.join("blender_quality_toolkit.py");
        fs::write(
            &quality_spec_path,
            serde_json::to_vec_pretty(&serde_json::json!({"assets": model_assets}))
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("Không ghi được Blender asset quality spec: {error}"))?;
        fs::write(&quality_worker_path, BLENDER_ASSET_QUALITY_WORKER_SCRIPT)
            .map_err(|error| format!("Không ghi được Blender asset quality worker: {error}"))?;
        fs::write(&toolkit_path, BLENDER_QUALITY_TOOLKIT_SCRIPT)
            .map_err(|error| format!("Không ghi được Blender quality toolkit: {error}"))?;
        let quality_spec_relative = relative(&quality_spec_path)?;
        let quality_worker_relative = relative(&quality_worker_path)?;
        let quality_output_relative = relative(&quality_root)?;
        if blender_path.is_none() {
            let fallback = serde_json::json!({
                "schemaVersion": "1.0.0",
                "toolVersion": "blender-asset-quality-worker-not-configured",
                "qualityChecks": model_assets.iter().map(|asset| serde_json::json!({
                    "assetId": asset.get("assetId").and_then(Value::as_str).unwrap_or("asset"),
                    "qualityState": "needs_review",
                    "normalizationState": "needs_review",
                    "reportPath": Value::Null,
                    "normalizedRelativePath": Value::Null,
                    "issues": ["blender_not_configured"]
                })).collect::<Vec<_>>()
            });
            fs::write(
                workspace_root.join(&quality_relative),
                serde_json::to_vec_pretty(&fallback).map_err(|error| error.to_string())?,
            )
            .map_err(|error| format!("Không ghi được Blender fallback quality report: {error}"))?;
            None
        } else {
            let blender_path = blender_path.expect("blender path checked above");
            Some(
                run_external_process(ExternalProcessRequest {
                    spec: ProcessSpec {
                        executable_id: "blender".to_string(),
                        args: vec![
                            "--background".to_string(),
                            "--factory-startup".to_string(),
                            "--python".to_string(),
                            quality_worker_relative,
                            "--".to_string(),
                            "--workspace".to_string(),
                            workspace_root.to_string_lossy().to_string(),
                            "--spec".to_string(),
                            quality_spec_relative,
                            "--output-dir".to_string(),
                            quality_output_relative,
                        ],
                        working_directory: ".".to_string(),
                        environment: Default::default(),
                        timeout_seconds: 900,
                        expected_outputs: vec![quality_relative.clone()],
                    },
                    executable_path: blender_path,
                    absolute_working_directory: workspace_root.clone(),
                    output_root: workspace_root.clone(),
                    cancellation: Arc::new(AtomicBool::new(false)),
                })
                .await?,
            )
        }
    };
    if let Some(quality_process) = &quality_process {
        if !quality_process.succeeded {
            return Err(
                "Blender asset quality worker thất bại; asset pipeline bị dừng, không tạo binding final"
                    .to_string(),
            );
        }
    }
    let merge_quality_path = if !model_assets.is_empty() {
        Some(workspace_root.join(&quality_relative))
    } else {
        None
    };
    if let Some(quality_path) = merge_quality_path {
        let merge_process = run_external_process(ExternalProcessRequest {
            spec: ProcessSpec {
                executable_id: "python".to_string(),
                args: vec![
                    worker_relative,
                    "--workspace".to_string(),
                    workspace_root.to_string_lossy().to_string(),
                    "--output-dir".to_string(),
                    output_relative,
                    "--report".to_string(),
                    report_relative.clone(),
                    "--merge-quality".to_string(),
                    relative(&quality_path)?,
                ],
                working_directory: ".".to_string(),
                environment: Default::default(),
                timeout_seconds: 180,
                expected_outputs: vec![
                    report_relative.clone(),
                    bindings_relative.clone(),
                    quarantine_relative.clone(),
                ],
            },
            executable_path: {
                let connection = state
                    .database
                    .lock()
                    .map_err(|_| "Không thể khóa database".to_string())?;
                resolve_configured_tool(&connection, "python")?
            },
            absolute_working_directory: workspace_root.clone(),
            output_root: workspace_root.clone(),
            cancellation: Arc::new(AtomicBool::new(false)),
        })
        .await?;
        if !merge_process.succeeded {
            return Err(
                "Không thể hợp nhất kết quả Blender quality vào Asset Pipeline report".to_string(),
            );
        }
    }
    let final_report: Value = serde_json::from_str(
        &fs::read_to_string(&initial_report_path)
            .map_err(|error| format!("Không đọc được final asset pipeline report: {error}"))?,
    )
    .map_err(|error| format!("Final asset pipeline report không hợp lệ: {error}"))?;
    let counts = final_report
        .get("assetCounts")
        .and_then(Value::as_object)
        .ok_or_else(|| "Asset pipeline report thiếu assetCounts".to_string())?;
    let quality_process_started = quality_process.is_some();
    let report = AssetPipelineCheckReport {
        run_id: run_id.clone(),
        report_path: report_relative,
        bindings_path: bindings_relative,
        quarantine_path: quarantine_relative,
        quality_path: if model_assets.is_empty() {
            None
        } else {
            Some(quality_relative)
        },
        asset_count: counts.get("total").and_then(Value::as_u64).unwrap_or(0) as usize,
        ready_count: counts.get("ready").and_then(Value::as_u64).unwrap_or(0) as usize,
        quarantined_count: counts
            .get("quarantined")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize,
        status: final_report
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("blocked")
            .to_string(),
        process,
        quality_process,
        message: if model_assets.is_empty() {
            "Đã phân loại/hash và kiểm quyền asset; model 3D không có hoặc chưa cần Blender quality. Kết quả vẫn cần review.".to_string()
        } else if !quality_process_started {
            "Đã ingest asset nhưng Blender chưa cấu hình; model 3D đang giữ needs_review, chưa được binding final.".to_string()
        } else {
            "Đã ingest, quarantine, chạy Blender quality/lookdev và tạo shot binding; vẫn cần human review trước render final.".to_string()
        },
    };
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database để ghi audit".to_string())?;
    audit_event(
        &connection,
        Some(project_id.as_str()),
        "asset.pipeline_checked",
        "asset_pipeline_run",
        &run_id,
    )?;
    Ok(report)
}

#[tauri::command]
pub(super) async fn build_blender_shot_preview(
    request: BlenderShotPreviewRequest,
    state: State<'_, AppState>,
) -> Result<BlenderShotPreviewReport, String> {
    valid_text(&request.project_id, "Project ID")?;
    let (workspace_root, blender_path, ffmpeg_path) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        let workspace_root: String = connection
            .query_row(
                "SELECT workspace_root FROM projects WHERE project_id = ?1",
                params![request.project_id.trim()],
                |row| row.get(0),
            )
            .map_err(|error| format!("Không đọc được project workspace: {error}"))?;
        (
            PathBuf::from(workspace_root),
            resolve_configured_tool(&connection, "blender")?,
            resolve_configured_tool(&connection, "ffmpeg")?,
        )
    };
    let workspace_root = fs::canonicalize(&workspace_root)
        .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?;
    let segments = request
        .script
        .get("segments")
        .and_then(Value::as_array)
        .ok_or_else(|| "Script thiếu segments để tạo Blender shot preview".to_string())?;
    if segments.is_empty() || segments.len() > 24 {
        return Err("Số shot phải từ 1 đến 24".to_string());
    }
    let output_dir = workspace_root
        .join("outputs")
        .join("blender")
        .join("shot-composer-preview");
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Không tạo được output preview: {error}"))?;
    let spec_path = output_dir.join("shot-plan.json");
    // Do not trust the first segment's sceneMode as the project mode. A
    // previously saved segment may carry stale metadata (for example
    // biomedical_macro) while the current prompt is about dinosaurs. The
    // versioned Blender builder performs subject/topic inference from the
    // actual shot text and only falls back to this metadata when no strong
    // subject signal exists.
    let scene_mode = "generic_cinematic";
    let mut frame = 1i64;
    let mut shots = Vec::with_capacity(segments.len());
    for (index, segment) in segments.iter().enumerate() {
        let duration = segment
            .get("durationSeconds")
            .and_then(Value::as_f64)
            .unwrap_or(5.0)
            .clamp(1.0, 30.0);
        let end = frame + (duration * 30.0).round() as i64 - 1;
        let prompt = segment
            .get("visualPrompt")
            .and_then(Value::as_str)
            .unwrap_or("");
        let camera_intent = segment
            .get("cameraIntent")
            .and_then(Value::as_str)
            .unwrap_or("");
        let camera_blob = format!("{camera_intent} {prompt}").to_ascii_lowercase();
        let camera_intent_lower = camera_intent.to_ascii_lowercase();
        let motion = if camera_blob.contains("orbit") {
            "orbit"
        } else if camera_blob.contains("zoom") || camera_blob.contains("push") {
            "push_in"
        } else {
            "locked"
        };
        shots.push(serde_json::json!({
            "shotId": format!("SHOT-{:03}", index + 1), "startFrame": frame, "endFrame": end,
            "event": segment.get("narration").and_then(Value::as_str).unwrap_or(""),
            "camera": { "type": if camera_intent_lower.contains("macro") { "macro" } else if camera_intent_lower.contains("wide") || camera_intent_lower.contains("establishing") { "wide" } else { "medium" }, "motion": motion, "lens": if camera_intent_lower.contains("macro") { 85 } else if camera_intent_lower.contains("wide") || camera_intent_lower.contains("establishing") { 28 } else { 50 } },
            "marker": [0.0, 0.0, 1.0], "continuityAssetIds": [], "visualGrammar": {
                "prompt": prompt,
                "subject": segment.get("subject").and_then(Value::as_str).unwrap_or(""),
                "action": segment.get("action").and_then(Value::as_str).unwrap_or(""),
                "cameraIntent": camera_intent,
                "lightingIntent": segment.get("lightingIntent").and_then(Value::as_str).unwrap_or(""),
                "continuityNotes": segment.get("continuityNotes").and_then(Value::as_str).unwrap_or(""),
                "negativePrompt": segment.get("negativePrompt").and_then(Value::as_str).unwrap_or(""),
                "sceneMode": segment.get("sceneMode").and_then(Value::as_str).unwrap_or(scene_mode)
            },
            "beats": segment.get("beats").cloned().unwrap_or_else(|| serde_json::json!([]))
        }));
        frame = end + 1;
    }
    let reference_assets = request
        .script
        .get("referenceAssetPaths")
        .cloned()
        .unwrap_or_else(|| serde_json::json!([]));
    let project_title = request
        .script
        .get("title")
        .cloned()
        .unwrap_or_else(|| serde_json::json!(""));
    let project_hook = request
        .script
        .get("hook")
        .cloned()
        .unwrap_or_else(|| serde_json::json!(""));
    let project_prompt = request
        .script
        .get("sourcePrompt")
        .cloned()
        .or_else(|| request.script.get("prompt").cloned())
        .unwrap_or_else(|| serde_json::json!(""));
    let prompt_grounding = request
        .script
        .get("promptGrounding")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let spec = serde_json::json!({
        "schemaVersion": "1.1.0",
        "projectId": request.project_id,
        "title": project_title,
        "hook": project_hook,
        "prompt": project_prompt,
        "fps": 30,
        "focus": [0.0, 0.0, 1.0],
        "sceneMode": scene_mode,
        "storyboardMode": "prompt_grounded_previs",
        "promptGrounding": prompt_grounding,
        "referenceAssets": reference_assets,
        "shots": shots
    });
    fs::write(
        &spec_path,
        serde_json::to_vec_pretty(&spec).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Không ghi được shot plan: {error}"))?;
    let script_path = output_dir.join("multishot_scene_builder.py");
    fs::write(&script_path, MULTISHOT_SCENE_BUILDER_SCRIPT)
        .map_err(|error| format!("Không ghi được Blender builder: {error}"))?;
    let relative = |path: &Path| -> Result<String, String> {
        path.strip_prefix(&workspace_root)
            .map_err(|_| "Output vượt project workspace".to_string())
            .map(|value| value.to_string_lossy().replace('\\', "/"))
    };
    let working_directory = relative(&output_dir)?;
    let spec_relative = relative(&spec_path)?;
    let script_relative = relative(&script_path)?;
    let blend_relative = relative(&output_dir.join("multishot-previs.blend"))?;
    let manifest_relative = relative(&output_dir.join("shot-manifest.json"))?;
    let preview_relative = relative(&output_dir.join("preview.png"))?;
    let edit_plan_relative = relative(&output_dir.join("edit-plan.json"))?;
    let shot_preview_relatives = (0..segments.len())
        .map(|index| {
            relative(
                &output_dir
                    .join("shots")
                    .join(format!("SHOT-{:03}.png", index + 1)),
            )
        })
        .collect::<Result<Vec<_>, String>>()?;
    let video_relative = relative(&output_dir.join("blender-render.mp4"))?;
    let mut expected_outputs = vec![
        blend_relative.clone(),
        manifest_relative.clone(),
        preview_relative.clone(),
        edit_plan_relative.clone(),
    ];
    expected_outputs.extend(shot_preview_relatives.clone());
    if request.render_video {
        expected_outputs.push(video_relative.clone());
    }
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
                "--spec".to_string(),
                spec_relative,
                "--output-dir".to_string(),
                working_directory.clone(),
                "--render-video".to_string(),
                request.render_video.to_string(),
            ],
            working_directory: ".".to_string(),
            environment: Default::default(),
            timeout_seconds: 600,
            expected_outputs,
        },
        executable_path: blender_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    if !process.succeeded {
        let detail = process.stderr.chars().take(900).collect::<String>();
        return Err(format!(
            "Blender shot preview thất bại (exit={:?}, timeout={}): {}",
            process.exit_code,
            process.timed_out,
            if detail.trim().is_empty() {
                "không có stderr"
            } else {
                detail.trim()
            }
        ));
    }
    if request.render_video {
        let ffmpeg_process = run_external_process(ExternalProcessRequest {
            spec: ProcessSpec {
                executable_id: "ffmpeg".to_string(),
                args: vec![
                    "-y".to_string(),
                    "-framerate".to_string(),
                    "30".to_string(),
                    "-i".to_string(),
                    format!("{}/frames/frame_%04d.png", working_directory),
                    "-c:v".to_string(),
                    "libx264".to_string(),
                    "-pix_fmt".to_string(),
                    "yuv420p".to_string(),
                    format!("{}/blender-render.mp4", working_directory),
                ],
                working_directory: ".".to_string(),
                environment: Default::default(),
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
            return Err(
                "FFmpeg đóng gói video Blender thất bại; kiểm tra log và cấu hình FFmpeg"
                    .to_string(),
            );
        }
    }
    let manifest_value = fs::read_to_string(workspace_root.join(&manifest_relative))
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
    let hero_binding = manifest_value
        .as_ref()
        .and_then(|manifest| manifest.get("heroBinding").cloned())
        .unwrap_or_else(|| serde_json::json!({"assetKind": "unknown", "status": "needs_review"}));
    let omni_instruction = manifest_value.as_ref()
        .and_then(|manifest| manifest.get("omniInstruction").and_then(Value::as_str))
        .unwrap_or("Replace the semantic proxy with the explicitly requested subject; do not substitute an unrelated vehicle or prop.")
        .to_string();
    Ok(BlenderShotPreviewReport { scene_path: blend_relative, manifest_path: manifest_relative, preview_path: preview_relative, shot_preview_paths: shot_preview_relatives, edit_plan_path: edit_plan_relative, video_path: request.render_video.then_some(video_relative), shot_count: segments.len(), frame_range: [1, frame - 1], process, status: if request.render_video { "prompt_grounded_video_needs_review" } else { "prompt_grounded_previs_needs_review" }.to_string(), message: if request.render_video { "Đã dựng procedural 3D theo prompt và render video Blender; cần review model, animation, continuity và chất lượng trước bàn giao." } else { "Đã dựng preview 3D bám prompt: world/character bible, scale, vết rách thời gian, action, camera và lighting theo từng shot. Đây vẫn là procedural preview, cần model production và human review để làm final." }.to_string(), storyboard_mode: "prompt_grounded_previs".to_string(), omni_instruction, hero_binding })
}

#[tauri::command]
pub(super) fn list_shot_approvals(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    valid_text(&project_id, "Project ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let mut statement = connection.prepare("SELECT subject_id FROM approvals WHERE project_id = ?1 AND subject_type = 'shot' AND decision = 'approved' ORDER BY created_at").map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![project_id.trim()], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn set_shot_approval(
    project_id: String,
    shot_id: String,
    approved: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    valid_text(&project_id, "Project ID")?;
    valid_text(&shot_id, "Shot ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    if approved {
        connection.execute("DELETE FROM approvals WHERE project_id = ?1 AND subject_type = 'shot' AND subject_id = ?2", params![project_id.trim(), shot_id.trim()]).map_err(|error| error.to_string())?;
        connection.execute("INSERT INTO approvals(approval_id, project_id, subject_type, subject_id, decision, reason, reviewer, created_at) VALUES (?1, ?2, 'shot', ?3, 'approved', 'Shot Composer review', 'user', ?4)", params![now_id("approval"), project_id.trim(), shot_id.trim(), now_string()]).map_err(|error| error.to_string())?;
    } else {
        connection.execute("DELETE FROM approvals WHERE project_id = ?1 AND subject_type = 'shot' AND subject_id = ?2", params![project_id.trim(), shot_id.trim()]).map_err(|error| error.to_string())?;
    }
    audit_event(
        &connection,
        Some(project_id.trim()),
        if approved {
            "shot.approved"
        } else {
            "shot.unapproved"
        },
        "shot",
        shot_id.trim(),
    )?;
    Ok(())
}
