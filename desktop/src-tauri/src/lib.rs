use percent_encoding::percent_decode_str;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::{Read, Seek, SeekFrom, Write},
    net::{SocketAddr, TcpStream, ToSocketAddrs},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};

const WORKSPACE_MEDIA_SCHEME: &str = "auto3d-media";

mod browser_handoff;
mod external_worker;
mod local_video;
mod process_executor;
mod provider_config;
mod subtitle;
mod video_vision;
use external_worker::{
    run_external_process, ExternalProcessRequest, ExternalProcessResult, OutputEvidence,
};
use process_executor::{plan_process_dry_run, ProcessDryRunPlan, ProcessSpec};

const INITIAL_MIGRATION: &str = include_str!("../migrations/0001_initial.sql");
const EXECUTION_ATTEMPTS_MIGRATION: &str =
    include_str!("../migrations/0002_execution_attempts.sql");
const TOOL_CONFIGS_MIGRATION: &str = include_str!("../migrations/0003_tool_configs.sql");
const ATTEMPT_EXECUTION_MODE_MIGRATION: &str =
    include_str!("../migrations/0004_attempt_execution_mode.sql");
const VOICE_PROFILES_MIGRATION: &str = include_str!("../migrations/0005_voice_profiles.sql");
const PROMPT_PRESETS_MIGRATION: &str = include_str!("../migrations/0006_prompt_presets.sql");
const ASSET_REFERENCE_MIGRATION: &str =
    include_str!("../migrations/0007_asset_reference_workflow.sql");
const ASSET_PACK_REVIEWS_MIGRATION: &str =
    include_str!("../migrations/0008_asset_pack_reviews.sql");
const PROJECT_ID_NORMALIZATION_VERSION: &str = "0009_project_id_normalization";
const NARRATIVE_VISUAL_PLAN_FIXTURE: &str =
    include_str!("../../../examples/minimal-3d-video/narrative-visual-plan.json");
const VIENEU_TTS_WORKER_SCRIPT: &str = include_str!("../../../scripts/vieneu_tts_worker.py");
const OMNIVOICE_TTS_WORKER_SCRIPT: &str = include_str!("../../../scripts/omnivoice_tts_worker.py");
const COMMANDCODE_LLM_WORKER_SCRIPT: &str =
    include_str!("../../../scripts/commandcode_llm_worker.py");
const MULTISHOT_SCENE_BUILDER_SCRIPT: &str =
    include_str!("../../../scripts/multishot_scene_builder.py");
const TRUE3D_SCENE_WORKER_SCRIPT: &str = include_str!("../../../scripts/true3d_scene_worker.py");
const TRUE3D_MULTISHOT_WORKER_SCRIPT: &str =
    include_str!("../../../scripts/true3d_multishot_worker.py");
const ASSET_PIPELINE_WORKER_SCRIPT: &str =
    include_str!("../../../scripts/asset_pipeline_worker.py");
const COMFYUI_IMAGE_WORKER_SCRIPT: &str = include_str!("../../../scripts/comfyui_image_worker.py");
const NANOBANANA_MCP_WORKER_SCRIPT: &str =
    include_str!("../../../scripts/nanobanana_mcp_worker.py");
const GOOGLE_FLOW_DOM_WORKER_SCRIPT: &str =
    include_str!("../../../scripts/google_flow_dom_worker.mjs");
const PLAYWRIGHT_FLOW_WORKER_SCRIPT: &str =
    include_str!("../../../scripts/playwright_flow_worker.mjs");
const BROWSEROS_FLOW_WORKER_SCRIPT: &str =
    include_str!("../../../scripts/browseros_flow_worker.mjs");
const BROWSEROS_PREVIEW_SCAN_WORKER_SCRIPT: &str =
    include_str!("../../../scripts/browseros_preview_scan_worker.mjs");
const PUBLIC_PREVIEW_CATALOG_WORKER_SCRIPT: &str =
    include_str!("../../../scripts/public_preview_catalog_worker.mjs");
const LICENSED_FOOTAGE_PREVIEW_WORKER_SCRIPT: &str =
    include_str!("../../../scripts/licensed_footage_preview_worker.py");
const BLENDER_ASSET_BINDING_WORKER_SCRIPT: &str =
    include_str!("../../../scripts/blender_asset_binding_worker.py");
const BLENDER_ASSET_QUALITY_WORKER_SCRIPT: &str =
    include_str!("../../../scripts/blender_asset_quality_worker.py");
const BLENDER_QUALITY_TOOLKIT_SCRIPT: &str =
    include_str!("../../../scripts/blender_quality_toolkit.py");
const PLAN023_MULTISHOT_SPEC: &str =
    include_str!("../../../examples/plan023-true3d/multishot-spec.json");
const TOPIC_PROFILE_REGISTRY: &str = include_str!("../../../configs/topic-profiles.example.json");
const PROMPT_TEMPLATE_REGISTRY: &str =
    include_str!("../../../configs/prompt-templates.example.json");
const CHROME_FLOW_CONTROLLER_MANIFEST: &str =
    include_str!("../../browser-flow-controller/manifest.json");
const CHROME_FLOW_CONTROLLER_SERVICE_WORKER: &str =
    include_str!("../../browser-flow-controller/service_worker.js");
const MOCK_WORKER_STEPS: u64 = 6;
const MOCK_WORKER_STEP_MILLIS: u64 = 350;

struct AppState {
    database: Mutex<Connection>,
    cancellation_tokens: Mutex<HashMap<String, Arc<AtomicBool>>>,
    cloud_generation_enabled: AtomicBool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSnapshot {
    app_version: String,
    locale: String,
    project_count: i64,
    job_count: i64,
    publish_enabled: bool,
    paid_generation_enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthStatus {
    database: String,
    external_tools: String,
    publish_policy: String,
    locale: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolReadinessView {
    tool_id: String,
    executable_ref: String,
    required: bool,
    configured: bool,
    available: bool,
    status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolReadinessReport {
    status: String,
    required_missing: Vec<String>,
    tools: Vec<ToolReadinessView>,
    external_processes_started: bool,
    network_probe_performed: bool,
    allow_shell_wrapper: bool,
    reject_paths_outside_project: bool,
    worker_execution_enabled: bool,
    worker_gate: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerPreflightReport {
    ready_to_start: bool,
    blockers: Vec<String>,
    checks: Vec<String>,
    external_processes_started: bool,
    network_probe_performed: bool,
    publish_enabled: bool,
    paid_generation_enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalToolProbeReport {
    tool_id: String,
    executable_path: String,
    status: String,
    exit_code: Option<i32>,
    version: String,
    stdout_bytes: usize,
    stderr_bytes: usize,
    process_started: bool,
    external_side_effect_unknown: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ComfyUiHealthReport {
    endpoint: String,
    status: String,
    http_status: Option<u16>,
    message: String,
    network_probe_performed: bool,
    side_effects_started: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalBlenderFixtureReport {
    output_path: String,
    size_bytes: u64,
    process: ExternalProcessResult,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct True3dFixtureRequest {
    project_id: String,
    #[serde(default)]
    render_video: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct True3dFixtureReport {
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
struct True3dMultishotFixtureRequest {
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
struct True3dMultishotFixtureReport {
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
struct AssetPipelineCheckRequest {
    project_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComfyUiImageTask {
    asset_id: String,
    shot_id: String,
    title: String,
    prompt: String,
    #[serde(default)]
    negative_prompt: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    seed: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    width: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    height: Option<i64>,
    role: String,
    rights_status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComfyUiImageGenerationRequest {
    project_id: String,
    #[serde(default)]
    endpoint: Option<String>,
    #[serde(default)]
    workflow_path: Option<String>,
    #[serde(default)]
    bindings: BTreeMap<String, String>,
    #[serde(default)]
    timeout_seconds: Option<u64>,
    #[serde(default)]
    tasks: Vec<ComfyUiImageTask>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ComfyUiImageGenerationReport {
    run_id: String,
    status: String,
    report_path: String,
    output_directory: String,
    generated_assets: Vec<AssetView>,
    task_count: usize,
    ready_count: usize,
    failed_count: usize,
    process: ExternalProcessResult,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NanoBananaImageTask {
    asset_id: String,
    shot_id: String,
    title: String,
    prompt: String,
    #[serde(default)]
    negative_prompt: String,
    #[serde(default)]
    width: Option<i64>,
    #[serde(default)]
    height: Option<i64>,
    role: String,
    rights_status: String,
    #[serde(default)]
    reference_images: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NanoBananaImageGenerationRequest {
    project_id: String,
    #[serde(default)]
    run_id: Option<String>,
    #[serde(default)]
    server_entry: Option<String>,
    #[serde(default)]
    flow_cdp_url: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    tool_name: Option<String>,
    #[serde(default)]
    timeout_seconds: Option<u64>,
    #[serde(default)]
    tasks: Vec<NanoBananaImageTask>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NanoBananaProgressRequest {
    project_id: String,
    run_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NanoBananaProgressReport {
    run_id: String,
    exists: bool,
    progress_path: String,
    events: Vec<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NanoBananaImageGenerationReport {
    run_id: String,
    status: String,
    report_path: String,
    output_directory: String,
    generated_assets: Vec<AssetView>,
    task_count: usize,
    ready_count: usize,
    failed_count: usize,
    process: ExternalProcessResult,
    message: String,
    failure_code: Option<String>,
    failure_detail: Option<String>,
    cdp_preflight: Option<NanoBananaCdpPreflightReport>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NanoBananaCdpPreflightReport {
    endpoint: String,
    status: String,
    http_status: Option<u16>,
    message: String,
    network_probe_performed: bool,
    side_effects_started: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChromeCdpLaunchReport {
    endpoint: String,
    status: String,
    browser_path: Option<String>,
    profile_directory: String,
    launched: bool,
    needs_login: bool,
    flow_group_name: String,
    flow_group_controller_loaded: bool,
    flow_target_count: usize,
    selected_flow_url: Option<String>,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleFlowDomPromptRequest {
    project_url: String,
    prompt: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleFlowDomOutputRequest {
    project_url: String,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    shot_id: Option<String>,
    #[serde(default)]
    revision_id: Option<String>,
    #[serde(default)]
    run_id: Option<String>,
    #[serde(default)]
    model: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleFlowDomPromptReport {
    status: String,
    project_url: String,
    target_url: Option<String>,
    report_path: String,
    editor_found: bool,
    prompt_accepted: bool,
    generate_clicked: bool,
    message: String,
    process: ExternalProcessResult,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleFlowDomOutputReport {
    status: String,
    project_url: String,
    target_url: Option<String>,
    report_path: String,
    media_count: usize,
    media_ids: Vec<String>,
    historical_shot_media_ids: Vec<String>,
    historical_shot_media_count: usize,
    matching_batch_count: usize,
    matching_batch_media_count: usize,
    matching_batch_media_ids: Vec<String>,
    shot_revision_batch_count: usize,
    shot_revision_batch_media_count: usize,
    shot_revision_batch_media_ids: Vec<String>,
    assistant_claims_generated: bool,
    generated_message_count: usize,
    generation_active: bool,
    download_control_found: bool,
    download_clicked: bool,
    selected_model: String,
    model_selected: bool,
    saved: bool,
    composer_found: bool,
    prompt_editor_found: bool,
    image_mode_found: bool,
    message: String,
    process: ExternalProcessResult,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleFlowPlaywrightRequest {
    project_url: String,
    mode: String,
    #[serde(default)]
    prompt: Option<String>,
    #[serde(default)]
    shot_id: Option<String>,
    #[serde(default)]
    revision_id: Option<String>,
    #[serde(default)]
    run_id: Option<String>,
    #[serde(default)]
    media_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewDiscoveryScanRequest {
    project_id: String,
    platforms: Vec<String>,
    max_results: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewCreatorScanRequest {
    project_id: String,
    platform: String,
    source_url: String,
    max_results: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LicensedFootageScanRequest {
    project_id: String,
    max_results: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleFlowPlaywrightReport {
    status: String,
    project_url: String,
    target_url: Option<String>,
    mode: String,
    report_path: String,
    screenshot_path: Option<String>,
    editor_found: bool,
    prompt_accepted: bool,
    generate_clicked: bool,
    reference_attached: bool,
    source_media_id: Option<String>,
    download_started: bool,
    download_name: Option<String>,
    download_size_bytes: Option<u64>,
    observed: Option<Value>,
    message: String,
    process: ExternalProcessResult,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetPipelineCheckReport {
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
struct BlenderShotPreviewRequest {
    project_id: String,
    script: Value,
    #[serde(default)]
    render_video: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BlenderShotPreviewReport {
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
struct VieneuReadinessReport {
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
struct VieneuTtsReport {
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
struct VoiceProfileView {
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
struct VoiceSampleView {
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
struct OmniVoiceReadinessReport {
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
struct OmniVoiceTtsReport {
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandCodeProbeReport {
    status: String,
    http_status: Option<u16>,
    model: String,
    response_text: Option<String>,
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    total_tokens: Option<u64>,
    network_calls_made: bool,
    cost_status: String,
    process_started: bool,
    external_side_effect_unknown: bool,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalFixtureAttemptReport {
    job: JobView,
    attempt: AttemptView,
    output_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NarrativeEntityPreview {
    entity_id: String,
    name: String,
    continuity_mode: String,
    identity_anchors: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NarrativeVisualBeatPreview {
    beat_id: String,
    sequence: i64,
    narration_text: String,
    start_frame: i64,
    end_frame: i64,
    duration_frames: i64,
    narrative_claim: String,
    visual_intent: String,
    setting: String,
    entities: Vec<NarrativeEntityPreview>,
    required_visual_elements: Vec<String>,
    positive_prompt: String,
    negative_prompt: String,
    expected_asset_path: String,
    candidate_state: String,
    review_decision: String,
    semantic_state: String,
    continuity_state: String,
    rights_state: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NarrativeVisualPlanPreview {
    plan_id: String,
    project_id: String,
    episode_id: String,
    language: String,
    aspect_ratio: String,
    frame_rate: f64,
    total_duration_frames: i64,
    beats: Vec<NarrativeVisualBeatPreview>,
    generation_started: bool,
    network_calls_made: bool,
    external_publish: bool,
    paid_generation: bool,
    human_review_required: bool,
    message: String,
}

#[derive(Debug)]
struct FixtureFailure {
    output_path: String,
    error_code: String,
    message: String,
    external_side_effect_unknown: bool,
    termination_mode: String,
    stdout_bytes: i64,
    stderr_bytes: i64,
    output_evidence: Vec<OutputEvidence>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalMediaFixtureReport {
    output_path: String,
    size_bytes: u64,
    duration_seconds: f64,
    stream_count: usize,
    ffmpeg: ExternalProcessResult,
    ffprobe: ExternalProcessResult,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerLaunchPlan {
    attempt_id: String,
    job_id: String,
    attempt_number: i64,
    state: String,
    executable_id: Option<String>,
    timeout_seconds: i64,
    expected_output_count: i64,
    can_start: bool,
    blockers: Vec<String>,
    process_started: bool,
    external_side_effect_unknown: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectView {
    project_id: String,
    name: String,
    locale: String,
    workspace_root: String,
    policy_profile: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VideoWorkflowSessionView {
    schema_version: String,
    session_id: String,
    project_id: String,
    #[serde(default)]
    session_directory: String,
    name: String,
    topic: String,
    title: String,
    duration_seconds: Option<f64>,
    status: String,
    last_step: String,
    updated_at: String,
    script: Option<Value>,
    reference_asset_paths: Vec<String>,
    gemini_asset_paths: Vec<String>,
    #[serde(default)]
    comfyui_asset_paths: Vec<String>,
    blender_preview: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveVideoWorkflowSessionInput {
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
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoWorkflowSessionFile {
    schema_version: String,
    sessions: Vec<VideoWorkflowSessionView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JobView {
    job_id: String,
    project_id: String,
    kind: String,
    state: String,
    progress: f64,
    attempt_count: i64,
    created_at: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AttemptView {
    attempt_id: String,
    job_id: String,
    attempt_number: i64,
    state: String,
    executable_id: Option<String>,
    execution_mode: String,
    timeout_seconds: i64,
    process_started: bool,
    external_side_effect_unknown: bool,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuditEventView {
    event_id: String,
    project_id: Option<String>,
    event_type: String,
    subject_type: Option<String>,
    subject_id: Option<String>,
    created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttemptOutputView {
    output_id: String,
    attempt_id: String,
    relative_path: String,
    media_kind: String,
    validation_state: String,
    validation_message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingOutputSpec {
    relative_path: String,
    media_kind: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecipeCatalogItem {
    recipe_kind: String,
    name: String,
    worker: String,
    local_first: bool,
    requires_approval: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderProfileView {
    profile_id: String,
    capability: String,
    provider: String,
    model: String,
    endpoint_ref: String,
    enabled: bool,
    configured: bool,
    credential_ref: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TopicAssetPolicyView {
    requires_provenance: bool,
    reject_irrelevant_candidates: bool,
    requires_human_review: bool,
    allowed_sources: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TopicProfileView {
    profile_id: String,
    name: String,
    description: String,
    default_recipe_kind: String,
    visual_mode: String,
    default_audience: String,
    shot_strategy: String,
    asset_policy: TopicAssetPolicyView,
    qa_checklist: Vec<String>,
    prompt_template_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TopicProfileRegistry {
    schema_version: String,
    profiles: Vec<TopicProfileView>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PromptTemplateView {
    template_id: String,
    version: String,
    name: String,
    purpose: String,
    locale: String,
    body: String,
    input_keys: Vec<String>,
    output_contract: Vec<String>,
    guardrails: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PromptPresetView {
    schema_version: String,
    preset_id: String,
    project_id: String,
    name: String,
    description: String,
    scope: String,
    status: String,
    version: String,
    template: String,
    variable_keys: Vec<String>,
    negative_template: String,
    provider_targets: Vec<String>,
    style_bible_id: Option<String>,
    rights_license_note: String,
    parent_preset_id: Option<String>,
    created_at: String,
    updated_at: String,
    archived_at: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PromptPresetInput {
    project_id: String,
    name: String,
    description: String,
    scope: String,
    status: String,
    version: String,
    template: String,
    variable_keys: Vec<String>,
    negative_template: String,
    provider_targets: Vec<String>,
    style_bible_id: Option<String>,
    rights_license_note: String,
    parent_preset_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromptTemplateRegistry {
    schema_version: String,
    templates: Vec<PromptTemplateView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TopicPromptPreview {
    profile_id: String,
    profile_name: String,
    template_id: String,
    template_version: String,
    rendered_prompt: String,
    selected_recipe_kind: String,
    visual_mode: String,
    required_human_review: bool,
    network_calls_made: bool,
    paid_generation: bool,
    external_publish: bool,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TopicPromptPreviewRequest {
    profile_id: String,
    template_id: String,
    topic: String,
    audience: String,
    content_goal: String,
    additional_prompt: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MockRecipePreview {
    recipe_kind: String,
    stages: Vec<String>,
    paid_generation_blocked: bool,
    external_publish_blocked: bool,
    external_processes_not_started: bool,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecipeDocument {
    #[serde(alias = "schema_version")]
    schema_version: String,
    #[serde(alias = "recipe_id")]
    recipe_id: String,
    kind: String,
    fps: u32,
    width: u32,
    height: u32,
    #[serde(alias = "duration_seconds")]
    duration_seconds: f64,
    #[serde(default)]
    policy: RecipePolicy,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecipePolicy {
    #[serde(default, alias = "rights_required")]
    rights_required: bool,
    #[serde(default, alias = "human_review_required")]
    human_review_required: bool,
    #[serde(default, alias = "external_publish")]
    external_publish: bool,
    #[serde(default, alias = "paid_generation")]
    paid_generation: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecipeValidationResult {
    valid: bool,
    recipe_id: String,
    recipe_kind: String,
    errors: Vec<String>,
    warnings: Vec<String>,
    external_side_effects_blocked: bool,
}

fn now_id(prefix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{prefix}-{nanos}")
}

fn now_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

fn lease_expiry_string(seconds: u64) -> String {
    SystemTime::now()
        .checked_add(Duration::from_secs(seconds))
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(now_string)
}

fn app_database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&app_data).map_err(|error| error.to_string())?;
    Ok(app_data.join("auto3dvideo.sqlite3"))
}

fn is_safe_project_id(value: &str) -> bool {
    let value = value.trim();
    (3..=64).contains(&value.len())
        && value.chars().enumerate().all(|(index, character)| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || (index > 0 && character == '-')
        })
}

fn project_id_ascii_char(character: char) -> Option<char> {
    Some(match character {
        'a' | 'à' | 'á' | 'ả' | 'ã' | 'ạ' | 'â' | 'ầ' | 'ấ' | 'ẩ' | 'ẫ' | 'ậ' | 'ă'
        | 'ằ' | 'ắ' | 'ẳ' | 'ẵ' | 'ặ' | 'À' | 'Á' | 'Ả' | 'Ã' | 'Ạ' | 'Â' | 'Ầ' | 'Ấ'
        | 'Ẩ' | 'Ẫ' | 'Ậ' | 'Ă' | 'Ằ' | 'Ắ' | 'Ẳ' | 'Ẵ' | 'Ặ' => 'a',
        'd' | 'đ' | 'D' | 'Đ' => 'd',
        'e' | 'è' | 'é' | 'ẻ' | 'ẽ' | 'ẹ' | 'ê' | 'ề' | 'ế' | 'ể' | 'ễ' | 'ệ' | 'È'
        | 'É' | 'Ẻ' | 'Ẽ' | 'Ẹ' | 'Ê' | 'Ề' | 'Ế' | 'Ể' | 'Ễ' | 'Ệ' => 'e',
        'i' | 'ì' | 'í' | 'ỉ' | 'ĩ' | 'ị' | 'Ì' | 'Í' | 'Ỉ' | 'Ĩ' | 'Ị' => 'i',
        'o' | 'ò' | 'ó' | 'ỏ' | 'õ' | 'ọ' | 'ô' | 'ồ' | 'ố' | 'ổ' | 'ỗ' | 'ộ' | 'ơ'
        | 'ờ' | 'ớ' | 'ở' | 'ỡ' | 'ợ' | 'Ò' | 'Ó' | 'Ỏ' | 'Õ' | 'Ọ' | 'Ô' | 'Ồ' | 'Ố'
        | 'Ổ' | 'Ỗ' | 'Ộ' | 'Ơ' | 'Ờ' | 'Ớ' | 'Ở' | 'Ỡ' | 'Ợ' => 'o',
        'u' | 'ù' | 'ú' | 'ủ' | 'ũ' | 'ụ' | 'ư' | 'ừ' | 'ứ' | 'ử' | 'ữ' | 'ự' | 'Ù'
        | 'Ú' | 'Ủ' | 'Ũ' | 'Ụ' | 'Ư' | 'Ừ' | 'Ứ' | 'Ử' | 'Ữ' | 'Ự' => 'u',
        'y' | 'ỳ' | 'ý' | 'ỷ' | 'ỹ' | 'ỵ' | 'Ỳ' | 'Ý' | 'Ỷ' | 'Ỹ' | 'Ỵ' => 'y',
        other if other.is_ascii_alphanumeric() => other.to_ascii_lowercase(),
        _ => return None,
    })
}

fn normalize_project_id(value: &str) -> String {
    let mut normalized = String::new();
    let mut separator_pending = false;
    for character in value.trim().chars() {
        if let Some(ascii) = project_id_ascii_char(character) {
            normalized.push(ascii);
            separator_pending = false;
        } else if !normalized.is_empty() && !separator_pending {
            normalized.push('-');
            separator_pending = true;
        }
    }
    while normalized.ends_with('-') {
        normalized.pop();
    }
    if normalized.is_empty() {
        return "project-id".to_string();
    }
    if normalized.len() < 3 {
        normalized = format!("project-{normalized}");
    }
    normalized.truncate(64);
    while normalized.ends_with('-') {
        normalized.pop();
    }
    if normalized.len() < 3 {
        "project-id".to_string()
    } else {
        normalized
    }
}

fn unique_project_id(base: &str, original: &str, used_ids: &HashSet<String>) -> String {
    if !used_ids.contains(base) {
        return base.to_string();
    }
    let digest = format!("{:x}", Sha256::digest(original.as_bytes()));
    let suffix = &digest[..8];
    let prefix_len = 64usize.saturating_sub(suffix.len() + 1);
    let mut prefix = base.chars().take(prefix_len).collect::<String>();
    while prefix.ends_with('-') {
        prefix.pop();
    }
    let candidate = format!("{prefix}-{suffix}");
    if !used_ids.contains(&candidate) {
        return candidate;
    }
    for index in 2..=999 {
        let suffix = format!("-{index}");
        let prefix_len = 64usize.saturating_sub(suffix.len());
        let mut prefix = base.chars().take(prefix_len).collect::<String>();
        while prefix.ends_with('-') {
            prefix.pop();
        }
        let candidate = format!("{prefix}{suffix}");
        if !used_ids.contains(&candidate) {
            return candidate;
        }
    }
    format!("project-{}", &digest[..16])
}

fn normalize_project_ids(connection: &mut Connection) -> Result<(), String> {
    let already_applied: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = ?1",
            params![PROJECT_ID_NORMALIZATION_VERSION],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if already_applied > 0 {
        return Ok(());
    }

    let project_ids: Vec<String> = {
        let mut statement = connection
            .prepare("SELECT project_id FROM projects ORDER BY project_id")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
    };
    let mut used_ids: HashSet<String> = project_ids
        .iter()
        .filter(|project_id| is_safe_project_id(project_id))
        .cloned()
        .collect();
    let mut mappings = Vec::new();
    for project_id in project_ids {
        if is_safe_project_id(&project_id) {
            continue;
        }
        let base = normalize_project_id(&project_id);
        let normalized = unique_project_id(&base, &project_id, &used_ids);
        used_ids.insert(normalized.clone());
        mappings.push((project_id, normalized));
    }

    let transaction = connection
        .transaction()
        .map_err(|error| format!("Không mở được project ID migration: {error}"))?;
    transaction
        .execute_batch("PRAGMA defer_foreign_keys = ON;")
        .map_err(|error| format!("Không bật được deferred project foreign keys: {error}"))?;
    const PROJECT_ID_TABLES: [&str; 14] = [
        "recipes",
        "provider_profiles",
        "jobs",
        "assets",
        "approvals",
        "audit_events",
        "voice_profiles",
        "voice_synthesis_jobs",
        "prompt_presets",
        "asset_library",
        "reference_sets",
        "reference_set_assignments",
        "asset_pack_sources",
        "asset_pack_item_reviews",
    ];
    for (old_id, new_id) in mappings {
        transaction
            .execute(
                "UPDATE projects SET project_id = ?1 WHERE project_id = ?2",
                params![new_id, old_id],
            )
            .map_err(|error| format!("Không chuẩn hóa project ID: {error}"))?;
        for table in PROJECT_ID_TABLES {
            let statement = format!("UPDATE {table} SET project_id = ?1 WHERE project_id = ?2");
            transaction
                .execute(&statement, params![new_id, old_id])
                .map_err(|error| format!("Không cập nhật project ID trong {table}: {error}"))?;
        }
    }
    transaction
        .execute(
            "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
            params![PROJECT_ID_NORMALIZATION_VERSION, now_string()],
        )
        .map_err(|error| format!("Không ghi project ID migration: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Không commit được project ID migration: {error}"))
}

fn apply_migrations(connection: &mut Connection) -> Result<(), String> {
    connection
        .execute_batch(INITIAL_MIGRATION)
        .map_err(|error| error.to_string())?;
    let applied: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = '0001_initial'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if applied == 0 {
        connection
            .execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                params!["0001_initial", now_string()],
            )
            .map_err(|error| error.to_string())?;
    }

    connection
        .execute_batch(EXECUTION_ATTEMPTS_MIGRATION)
        .map_err(|error| error.to_string())?;
    let attempts_applied: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = '0002_execution_attempts'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if attempts_applied == 0 {
        connection
            .execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                params!["0002_execution_attempts", now_string()],
            )
            .map_err(|error| error.to_string())?;
    }

    connection
        .execute_batch(TOOL_CONFIGS_MIGRATION)
        .map_err(|error| error.to_string())?;
    let tool_configs_applied: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = '0003_tool_configs'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if tool_configs_applied == 0 {
        connection
            .execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                params!["0003_tool_configs", now_string()],
            )
            .map_err(|error| error.to_string())?;
    }

    let execution_mode_applied: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = '0004_attempt_execution_mode'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let execution_mode_column_exists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('job_attempts') WHERE name = 'execution_mode'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if execution_mode_applied == 0 {
        if execution_mode_column_exists == 0 {
            connection
                .execute_batch(ATTEMPT_EXECUTION_MODE_MIGRATION)
                .map_err(|error| error.to_string())?;
        }
        connection
            .execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                params!["0004_attempt_execution_mode", now_string()],
            )
            .map_err(|error| error.to_string())?;
    }
    let voice_profiles_applied: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = '0005_voice_profiles'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if voice_profiles_applied == 0 {
        connection
            .execute_batch(VOICE_PROFILES_MIGRATION)
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                params!["0005_voice_profiles", now_string()],
            )
            .map_err(|error| error.to_string())?;
    }
    let prompt_presets_applied: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = '0006_prompt_presets'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if prompt_presets_applied == 0 {
        connection
            .execute_batch(PROMPT_PRESETS_MIGRATION)
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                params!["0006_prompt_presets", now_string()],
            )
            .map_err(|error| error.to_string())?;
    }
    let asset_reference_applied: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = '0007_asset_reference_workflow'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if asset_reference_applied == 0 {
        connection
            .execute_batch(ASSET_REFERENCE_MIGRATION)
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                params!["0007_asset_reference_workflow", now_string()],
            )
            .map_err(|error| error.to_string())?;
    }
    let asset_pack_reviews_applied: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = '0008_asset_pack_reviews'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if asset_pack_reviews_applied == 0 {
        connection
            .execute_batch(ASSET_PACK_REVIEWS_MIGRATION)
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                params!["0008_asset_pack_reviews", now_string()],
            )
            .map_err(|error| error.to_string())?;
    }
    normalize_project_ids(connection)?;
    Ok(())
}

fn initialize_database(app: &AppHandle) -> Result<Connection, String> {
    let path = app_database_path(app)?;
    let mut connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| error.to_string())?;
    apply_migrations(&mut connection)?;
    reconcile_active_external_attempts(&connection)?;
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
        .unwrap_or(0);
    if count == 0 {
        let _ = connection.execute(
            "INSERT INTO projects(project_id, name, locale, workspace_root, policy_profile, created_at, updated_at) VALUES ('project-default', 'Dự án Mặc định', 'vi-VN', 'D:\\\\Duancanhan\\\\Auto3Dvideo', 'safe-local', datetime('now'), datetime('now'))",
            [],
        );
    }
    Ok(connection)
}

fn valid_text(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{field} không được để trống"));
    }
    if value.contains('\0') {
        return Err(format!("{field} chứa ký tự không hợp lệ"));
    }
    Ok(())
}

fn validate_google_flow_batch_identity(value: &str, field: &str) -> Result<String, String> {
    let value = value.trim();
    if !(3..=96).contains(&value.len())
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
    {
        return Err(format!("{field} chứa identity không hợp lệ"));
    }
    Ok(value.to_string())
}

fn preview_string(
    object: &serde_json::Map<String, Value>,
    key: &str,
    context: &str,
) -> Result<String, String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(|value| value.to_string())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{context}.{key} phải là chuỗi không rỗng"))
}

fn preview_i64(
    object: &serde_json::Map<String, Value>,
    key: &str,
    context: &str,
) -> Result<i64, String> {
    object
        .get(key)
        .and_then(Value::as_i64)
        .ok_or_else(|| format!("{context}.{key} phải là integer"))
}

fn preview_string_array(
    object: &serde_json::Map<String, Value>,
    key: &str,
    context: &str,
    required: bool,
) -> Result<Vec<String>, String> {
    let Some(value) = object.get(key) else {
        return if required {
            Err(format!("{context}.{key} phải là string array"))
        } else {
            Ok(Vec::new())
        };
    };
    let values = value
        .as_array()
        .ok_or_else(|| format!("{context}.{key} phải là array"))?;
    let mut output = Vec::with_capacity(values.len());
    for item in values {
        let text = item
            .as_str()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| format!("{context}.{key} chỉ nhận string không rỗng"))?;
        if output.iter().any(|existing| existing == text) {
            return Err(format!("{context}.{key} không được trùng phần tử"));
        }
        output.push(text.to_string());
    }
    if required && output.is_empty() {
        return Err(format!("{context}.{key} không được rỗng"));
    }
    Ok(output)
}

fn safe_preview_id(value: &str) -> bool {
    (3..=64).contains(&value.len())
        && value.chars().enumerate().all(|(index, character)| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || (index > 0 && character == '-')
        })
        && value
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
}

fn safe_preview_relative_path(value: &str) -> bool {
    let normalized = value.trim().replace('\\', "/");
    !normalized.is_empty()
        && !normalized.starts_with('/')
        && !normalized.starts_with("//")
        && !normalized.contains("://")
        && !normalized
            .as_bytes()
            .get(1)
            .is_some_and(|byte| *byte == b':')
        && normalized
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn preview_secret_like(value: &str) -> bool {
    let normalized = value.to_ascii_lowercase();
    [
        "api_key", "apikey", "secret", "token", "password", "sk-", "bearer ",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}

fn preview_contains_tokens(text: &str, phrase: &str) -> bool {
    let text_tokens: Vec<String> = text
        .to_ascii_lowercase()
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(str::to_string)
        .collect();
    let phrase_tokens: Vec<String> = phrase
        .to_ascii_lowercase()
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(str::to_string)
        .collect();
    !phrase_tokens.is_empty()
        && phrase_tokens
            .iter()
            .all(|token| text_tokens.contains(token))
}

fn forbidden_preview_key(value: &Value, path: &str) -> Option<String> {
    const FORBIDDEN: [&str; 11] = [
        "command",
        "rawcommand",
        "shell",
        "rawargs",
        "executable",
        "upload",
        "publish",
        "credential",
        "apikey",
        "token",
        "secret",
    ];
    match value {
        Value::Object(object) => {
            for (key, child) in object {
                let normalized: String = key
                    .chars()
                    .filter(|character| character.is_ascii_alphanumeric())
                    .flat_map(char::to_lowercase)
                    .collect();
                if FORBIDDEN.iter().any(|candidate| *candidate == normalized) {
                    return Some(format!(
                        "{path}.{key} không được phép trong no-spawn visual plan"
                    ));
                }
                if let Some(found) = forbidden_preview_key(child, &format!("{path}.{key}")) {
                    return Some(found);
                }
            }
        }
        Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                if let Some(found) = forbidden_preview_key(child, &format!("{path}[{index}]")) {
                    return Some(found);
                }
            }
        }
        _ => {}
    }
    None
}

fn preview_required_policy(
    object: &serde_json::Map<String, Value>,
    context: &str,
) -> Result<(), String> {
    let expected = [
        ("rightsRequired", true),
        ("humanReviewRequired", true),
        ("paidGeneration", false),
        ("externalPublish", false),
        ("allowNetwork", false),
    ];
    for (key, expected_value) in expected {
        let actual = object
            .get(key)
            .and_then(Value::as_bool)
            .ok_or_else(|| format!("{context}.{key} phải là boolean"))?;
        if actual != expected_value {
            return Err(format!("{context}.{key} phải là {expected_value}"));
        }
    }
    Ok(())
}

fn compile_narrative_visual_plan(document: &Value) -> Result<NarrativeVisualPlanPreview, String> {
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
fn preview_narrative_visual_plan(plan_json: String) -> Result<NarrativeVisualPlanPreview, String> {
    valid_text(&plan_json, "NarrativeVisualPlan JSON")?;
    let document: Value = serde_json::from_str(&plan_json)
        .map_err(|error| format!("NarrativeVisualPlan JSON không hợp lệ: {error}"))?;
    compile_narrative_visual_plan(&document)
}

#[tauri::command]
fn preview_narrative_visual_plan_fixture() -> Result<NarrativeVisualPlanPreview, String> {
    let document: Value = serde_json::from_str(NARRATIVE_VISUAL_PLAN_FIXTURE)
        .map_err(|error| format!("Fixture NarrativeVisualPlan không hợp lệ: {error}"))?;
    compile_narrative_visual_plan(&document)
}

const TOOL_DEFAULTS: [(&str, bool); 9] = [
    ("blender", false),
    ("ffmpeg", true),
    ("ffprobe", true),
    ("python", true),
    ("node", false),
    ("kdenlive", false),
    ("davinci_resolve", false),
    ("yt-dlp", false),
    ("obscura", false),
];

fn validate_tool_id(tool_id: &str) -> Result<(), String> {
    valid_text(tool_id, "Tool ID")?;
    if TOOL_DEFAULTS
        .iter()
        .any(|(allowed, _)| *allowed == tool_id.trim())
    {
        Ok(())
    } else {
        Err(format!(
            "Tool không nằm trong allowlist: {}",
            tool_id.trim()
        ))
    }
}

fn validate_executable_ref(executable_ref: &str) -> Result<String, String> {
    valid_text(executable_ref, "Executable reference")?;
    let trimmed = executable_ref.trim();
    if trimmed.len() > 1024
        || trimmed
            .chars()
            .any(|character| matches!(character, '\r' | '\n' | '\0'))
        || ['&', '|', ';', '<', '>']
            .iter()
            .any(|character| trimmed.contains(*character))
    {
        return Err(
            "Executable reference chỉ được là path hoặc tên binary, không phải command string"
                .to_string(),
        );
    }
    let path = Path::new(trimmed);
    if !path.is_absolute() && path.components().count() != 1 {
        return Err("Executable reference tương đối chỉ được là tên binary trong PATH".to_string());
    }
    Ok(trimmed.to_string())
}

fn expected_binary_name(tool_id: &str) -> Option<&'static str> {
    match tool_id {
        "blender" => Some("blender.exe"),
        "ffmpeg" => Some("ffmpeg.exe"),
        "ffprobe" => Some("ffprobe.exe"),
        "python" => Some("python.exe"),
        "yt-dlp" => Some("yt-dlp.exe"),
        "obscura" => Some("obscura.exe"),
        "kdenlive" => Some("kdenlive.exe"),
        "davinci_resolve" => Some("Resolve.exe"),
        _ => None,
    }
}

fn executable_ref_available(tool_id: &str, executable_ref: &str) -> bool {
    let path = Path::new(executable_ref);
    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        match std::env::var_os("PATH") {
            Some(paths) => std::env::split_paths(&paths)
                .map(|directory| directory.join(executable_ref))
                .find(|candidate| candidate.is_file())
                .unwrap_or_default(),
            None => return false,
        }
    };
    candidate.is_file()
        && expected_binary_name(tool_id).is_none_or(|expected| {
            candidate
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|actual| actual.eq_ignore_ascii_case(expected))
        })
}

fn app_managed_tool_default(tool_id: &str) -> Option<PathBuf> {
    if tool_id == "blender" {
        return [
            PathBuf::from(r"D:\Auto3DvideoTools\blender-5.2.1-windows-x64\blender.exe"),
            PathBuf::from(r"D:\Auto3DvideoTools\blender\blender.exe"),
        ]
        .into_iter()
        .find(|candidate| candidate.is_file());
    }
    if tool_id == "python" {
        let candidate = PathBuf::from(r"D:\Auto3DvideoTools\vieneu\.venv\Scripts\python.exe");
        return candidate.is_file().then_some(candidate);
    }
    if tool_id == "node" {
        return [
            PathBuf::from(r"C:\Program Files\nodejs\node.exe"),
            PathBuf::from(r"C:\Program Files (x86)\nodejs\node.exe"),
        ]
        .into_iter()
        .find(|candidate| candidate.is_file());
    }
    if tool_id == "obscura" {
        return [
            PathBuf::from(r"D:\Auto3DvideoTools\obscura-source\target\release\obscura.exe"),
            PathBuf::from(r"D:\Auto3DvideoTools\obscura\obscura.exe"),
            PathBuf::from(r"D:\Auto3DvideoTools\obscura-source\target\debug\obscura.exe"),
        ]
        .into_iter()
        .find(|candidate| candidate.is_file());
    }
    if tool_id == "yt-dlp" {
        return [
            PathBuf::from(r"D:\Auto3DvideoTools\media2md-source\.venv\Scripts\yt-dlp.exe"),
            PathBuf::from(r"D:\Auto3DvideoTools\yt-dlp\yt-dlp.exe"),
        ]
        .into_iter()
        .find(|candidate| candidate.is_file());
    }
    None
}

fn resolve_configured_tool(connection: &Connection, tool_id: &str) -> Result<PathBuf, String> {
    validate_tool_id(tool_id)?;
    let stored_reference: Option<String> = connection
        .query_row(
            "SELECT executable_ref FROM tool_configs WHERE tool_id = ?1",
            params![tool_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Không đọc được tool config {tool_id}: {error}"))?;
    let executable_ref = stored_reference.or_else(|| {
        app_managed_tool_default(tool_id).map(|path| path.to_string_lossy().to_string())
    });
    let reference = executable_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Chưa cấu hình tool {tool_id}"))?;
    if reference.is_empty() {
        return Err(format!("Tool {tool_id} chưa có executable reference"));
    }
    let candidate = Path::new(reference);
    let resolved = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        std::env::var_os("PATH")
            .into_iter()
            .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
            .map(|directory| directory.join(reference))
            .find(|path| path.is_file())
            .ok_or_else(|| format!("Không resolve được tool {tool_id} trong PATH"))?
    };
    if !resolved.is_file() {
        return Err(format!("Tool {tool_id} không tồn tại: {reference}"));
    }
    let canonical = fs::canonicalize(&resolved)
        .map_err(|error| format!("Không canonicalize được tool {tool_id}: {error}"))?;
    if expected_binary_name(tool_id).is_some_and(|expected| {
        canonical
            .file_name()
            .and_then(|name| name.to_str())
            .map(|actual| !actual.eq_ignore_ascii_case(expected))
            .unwrap_or(true)
    }) {
        return Err(format!(
            "Tool {tool_id} không khớp binary allowlist: cần {}",
            expected_binary_name(tool_id).unwrap_or("binary hợp lệ")
        ));
    }
    Ok(canonical)
}

fn tool_readiness_report(connection: &Connection) -> Result<ToolReadinessReport, String> {
    let mut tools = Vec::with_capacity(TOOL_DEFAULTS.len());
    let mut required_missing = Vec::new();
    for (tool_id, default_required) in TOOL_DEFAULTS {
        let stored: Option<(String, i64)> = connection
            .query_row(
                "SELECT executable_ref, required FROM tool_configs WHERE tool_id = ?1",
                params![tool_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let executable_ref = stored
            .as_ref()
            .map(|(reference, _)| reference.clone())
            .or_else(|| {
                app_managed_tool_default(tool_id).map(|path| path.to_string_lossy().to_string())
            })
            .unwrap_or_default();
        let required = stored
            .as_ref()
            .map(|(_, required)| *required != 0)
            .unwrap_or(default_required);
        let configured = !executable_ref.trim().is_empty();
        let available = configured && executable_ref_available(tool_id, &executable_ref);
        let status = if available {
            "ready"
        } else if required {
            required_missing.push(tool_id.to_string());
            "missing_required"
        } else {
            "optional_missing"
        };
        tools.push(ToolReadinessView {
            tool_id: tool_id.to_string(),
            executable_ref,
            required,
            configured,
            available,
            status: status.to_string(),
        });
    }
    Ok(ToolReadinessReport {
        status: if required_missing.is_empty() {
            "ready".to_string()
        } else {
            "blocked".to_string()
        },
        required_missing,
        tools,
        external_processes_started: false,
        network_probe_performed: false,
        allow_shell_wrapper: false,
        reject_paths_outside_project: true,
        worker_execution_enabled: false,
        worker_gate: "native_build_and_supervision_required".to_string(),
    })
}

fn validate_attempt_output_path(raw: &str) -> Result<String, String> {
    valid_text(raw, "Output path")?;
    let trimmed = raw.trim();
    let normalized = trimmed.replace('\\', "/");
    if normalized.starts_with('/')
        || normalized.starts_with("//")
        || normalized.as_bytes().get(1) == Some(&b':')
        || normalized.ends_with('/')
    {
        return Err("Output path phải là file tương đối trong workspace".to_string());
    }
    if Path::new(trimmed)
        .components()
        .any(|component| component == Component::ParentDir)
        || normalized.split('/').any(|part| part == "..")
    {
        return Err("Output path không được vượt ra ngoài workspace".to_string());
    }
    if trimmed.len() > 1024 {
        return Err("Output path quá dài".to_string());
    }
    Ok(normalized)
}

fn validate_attempt_media_kind(value: &str) -> Result<(), String> {
    if matches!(
        value,
        "video" | "audio" | "image" | "subtitle" | "thumbnail" | "metadata" | "image_sequence"
    ) {
        Ok(())
    } else {
        Err(format!("Media kind không được hỗ trợ: {value}"))
    }
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

fn resolve_workspace_file(
    workspace_root: &Path,
    relative: &str,
    field: &str,
    max_bytes: u64,
) -> Result<PathBuf, String> {
    let normalized = validate_attempt_output_path(relative)?;
    let candidate = workspace_root.join(&normalized);
    if !candidate.is_file() {
        return Err(format!("{field} không tồn tại trong workspace"));
    }
    let canonical_root = fs::canonicalize(workspace_root)
        .map_err(|error| format!("Không canonicalize workspace cho {field}: {error}"))?;
    let canonical = fs::canonicalize(&candidate)
        .map_err(|error| format!("Không canonicalize {field}: {error}"))?;
    if !canonical.starts_with(&canonical_root) {
        return Err(format!("{field} vượt ra ngoài workspace"));
    }
    let size = fs::metadata(&canonical)
        .map_err(|error| format!("Không đọc được kích thước {field}: {error}"))?
        .len();
    if size == 0 || size > max_bytes {
        return Err(format!(
            "{field} phải lớn hơn 0 và không vượt quá {max_bytes} bytes"
        ));
    }
    Ok(canonical)
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

fn ensure_commandcode_worker_script(workspace_root: &Path) -> Result<String, String> {
    let script_path = workspace_root
        .join(".auto3dvideo")
        .join("tools")
        .join("commandcode_llm_worker.py");
    fs::create_dir_all(
        script_path
            .parent()
            .ok_or_else(|| "Không xác định được thư mục Command Code worker".to_string())?,
    )
    .map_err(|error| format!("Không tạo được thư mục Command Code worker: {error}"))?;
    fs::write(&script_path, COMMANDCODE_LLM_WORKER_SCRIPT)
        .map_err(|error| format!("Không ghi được Command Code worker: {error}"))?;
    script_path
        .strip_prefix(workspace_root)
        .map_err(|_| "Command Code worker vượt app-data workspace".to_string())
        .map(|path| path.to_string_lossy().replace('\\', "/"))
}

fn commandcode_worker_environment() -> Result<BTreeMap<String, String>, String> {
    let dotenv = provider_config::find_dotenv_path()
        .ok_or_else(|| "Không tìm thấy .env local để lấy credential Command Code".to_string())?;
    let canonical = fs::canonicalize(dotenv)
        .map_err(|error| format!("Không canonicalize được .env local: {error}"))?;
    let value = canonical.to_string_lossy().to_string();
    if value.len() > 4096 || value.contains(['\r', '\n', '\0']) {
        return Err("Đường dẫn .env local không hợp lệ".to_string());
    }
    Ok(BTreeMap::from([(
        "AUTO3DVIDEO_DOTENV_PATH".to_string(),
        value,
    )]))
}

fn parse_vieneu_worker_output(result: &ExternalProcessResult) -> Option<Value> {
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

fn omnivoice_worker_environment() -> Result<BTreeMap<String, String>, String> {
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

fn ensure_omnivoice_worker_script(workspace_root: &Path) -> Result<(PathBuf, String), String> {
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

fn validate_omnivoice_wav(path: &Path) -> Result<u64, String> {
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

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| format!("Không mở được file: {error}"))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Không đọc được file: {error}"))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
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

fn worker_string(payload: &Value, key: &str, fallback: &str) -> String {
    payload
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or(fallback)
        .chars()
        .take(4096)
        .collect()
}

fn worker_bool(payload: &Value, key: &str) -> bool {
    payload.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn prepare_workspace_root(raw: &str) -> Result<String, String> {
    valid_text(raw, "Workspace")?;
    let candidate = PathBuf::from(raw.trim());
    if !candidate.is_absolute() {
        return Err("Workspace phải là đường dẫn tuyệt đối trên Windows".to_string());
    }
    if raw.contains("..") {
        return Err("Workspace không được chứa segment '..'".to_string());
    }
    if candidate.components().count() < 2 {
        return Err("Không được chọn root của ổ đĩa làm workspace".to_string());
    }
    let lower = candidate.to_string_lossy().to_ascii_lowercase();
    for protected in ["\\windows", "\\program files", "\\programdata"] {
        if lower.contains(protected) {
            return Err("Không được dùng thư mục hệ thống làm workspace".to_string());
        }
    }
    fs::create_dir_all(&candidate).map_err(|error| format!("Không tạo được workspace: {error}"))?;
    let canonical = fs::canonicalize(&candidate)
        .map_err(|error| format!("Không chuẩn hóa được workspace: {error}"))?;
    Ok(canonical.to_string_lossy().to_string())
}

fn validate_credential_ref(reference: &str) -> Result<String, String> {
    valid_text(reference, "Credential reference")?;
    let trimmed = reference.trim();
    if trimmed == "none" {
        return Ok(trimmed.to_string());
    }
    let (kind, name) = trimmed.split_once(':').ok_or_else(|| {
        "Credential reference phải có dạng env:TEN_VAR, os:handle hoặc none".to_string()
    })?;
    if !matches!(kind, "env" | "os") {
        return Err("Credential reference chỉ cho phép env: hoặc os:".to_string());
    }
    if name.is_empty() || name.len() > 128 {
        return Err("Tên credential handle không hợp lệ".to_string());
    }
    if kind == "env" {
        let mut characters = name.chars();
        if !matches!(characters.next(), Some(character) if character.is_ascii_uppercase())
            || !characters.all(|character| {
                character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_'
            })
        {
            return Err("Tên env credential phải là biến ASCII hoa dạng TEN_VAR".to_string());
        }
    } else if !name.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.' | '/')
    }) {
        return Err("OS credential handle chứa ký tự không được phép".to_string());
    }
    Ok(trimmed.to_string())
}

fn safe_credential_ref(reference: Option<String>) -> String {
    let reference = reference.unwrap_or_else(|| "none".to_string());
    validate_credential_ref(&reference).unwrap_or_else(|_| "invalid-ref-blocked".to_string())
}

fn credential_ref_configured(reference: &str) -> bool {
    provider_config::credential_reference_state(reference) == "configured"
}

fn can_transition_job(from: &str, to: &str) -> bool {
    matches!(
        (from, to),
        ("draft", "queued")
            | ("queued", "running")
            | ("queued", "cancelled")
            | ("running", "succeeded")
            | ("running", "failed")
            | ("running", "cancel_requested")
            | ("cancel_requested", "cancelled")
            | ("failed", "queued")
    )
}

fn audit_event(
    connection: &Connection,
    project_id: Option<&str>,
    event_type: &str,
    subject_type: &str,
    subject_id: &str,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO audit_events(event_id, project_id, event_type, subject_type, subject_id, payload_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, '{}', ?6)",
            params![now_id("event"), project_id, event_type, subject_type, subject_id, now_string()],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn fetch_job(connection: &Connection, job_id: &str) -> Result<JobView, String> {
    connection
        .query_row(
            "SELECT job_id, project_id, kind, state, progress, attempt_count, created_at FROM jobs WHERE job_id = ?1",
            params![job_id],
            |row| {
                Ok(JobView {
                    job_id: row.get(0)?,
                    project_id: row.get(1)?,
                    kind: row.get(2)?,
                    state: row.get(3)?,
                    progress: row.get(4)?,
                    attempt_count: row.get(5)?,
                    created_at: row.get(6)?,
                })
            },
        )
        .map_err(|error| format!("Không đọc được job: {error}"))
}

fn fetch_attempt(connection: &Connection, attempt_id: &str) -> Result<AttemptView, String> {
    connection
        .query_row(
            "SELECT attempt_id, job_id, attempt_number, state, executable_id, execution_mode, timeout_seconds, process_started, external_side_effect_unknown, created_at, updated_at FROM job_attempts WHERE attempt_id = ?1",
            params![attempt_id],
            |row| {
                Ok(AttemptView {
                    attempt_id: row.get(0)?,
                    job_id: row.get(1)?,
                    attempt_number: row.get(2)?,
                    state: row.get(3)?,
                    executable_id: row.get(4)?,
                    execution_mode: row.get(5)?,
                    timeout_seconds: row.get(6)?,
                    process_started: row.get::<_, i64>(7)? == 1,
                    external_side_effect_unknown: row.get::<_, i64>(8)? == 1,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            },
        )
        .map_err(|error| format!("Không đọc được execution attempt: {error}"))
}

fn transition_job_locked(
    connection: &Connection,
    job_id: &str,
    next_state: &str,
    error_message: Option<&str>,
) -> Result<JobView, String> {
    let (project_id, current_state): (String, String) = connection
        .query_row(
            "SELECT project_id, state FROM jobs WHERE job_id = ?1",
            params![job_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| format!("Không đọc được job: {error}"))?;
    if !can_transition_job(&current_state, next_state) {
        return Err(format!(
            "Không thể chuyển job từ {current_state} sang {next_state}"
        ));
    }

    let timestamp = now_string();
    let changed = match next_state {
        "running" => connection.execute(
            "UPDATE jobs SET state='running', progress=0.0, attempt_count=attempt_count+1, started_at=?1, error_code=NULL, error_message=NULL WHERE job_id=?2",
            params![timestamp, job_id],
        ),
        "queued" => connection.execute(
            "UPDATE jobs SET state='queued', progress=0.0, error_code=NULL, error_message=NULL, finished_at=NULL WHERE job_id=?1",
            params![job_id],
        ),
        "succeeded" => connection.execute(
            "UPDATE jobs SET state='succeeded', progress=1.0, finished_at=?1 WHERE job_id=?2",
            params![timestamp, job_id],
        ),
        "failed" => connection.execute(
            "UPDATE jobs SET state='failed', error_code='MOCK_FAILURE', error_message=?1, finished_at=?2 WHERE job_id=?3",
            params![error_message.unwrap_or("Mock failure"), timestamp, job_id],
        ),
        "cancel_requested" => connection.execute(
            "UPDATE jobs SET state='cancel_requested' WHERE job_id=?1",
            params![job_id],
        ),
        "cancelled" => connection.execute(
            "UPDATE jobs SET state='cancelled', finished_at=?1 WHERE job_id=?2",
            params![timestamp, job_id],
        ),
        _ => return Err(format!("State không hợp lệ: {next_state}")),
    }
    .map_err(|error| error.to_string())?;
    if changed != 1 {
        return Err("Không cập nhật được job".to_string());
    }
    audit_event(
        connection,
        Some(&project_id),
        "job.transition",
        "job",
        job_id,
    )?;
    fetch_job(connection, job_id)
}

fn claim_mock_attempt(
    state: &AppState,
    attempt_id: &str,
) -> Result<(AttemptView, Arc<AtomicBool>), String> {
    let cancellation = Arc::new(AtomicBool::new(false));
    {
        let mut cancellations = state
            .cancellation_tokens
            .lock()
            .map_err(|_| "Không thể khóa mock worker registry".to_string())?;
        if cancellations.contains_key(attempt_id) {
            return Err("Attempt đang được mock worker xử lý".to_string());
        }
        cancellations.insert(attempt_id.to_string(), cancellation.clone());
    }

    let result = (|| {
        let mut connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Không mở được transaction: {error}"))?;
        let (job_id, project_id, attempt_state, job_state, timeout_seconds):
            (String, String, String, String, i64) = transaction
            .query_row(
                "SELECT a.job_id, j.project_id, a.state, j.state, a.timeout_seconds FROM job_attempts a JOIN jobs j ON j.job_id = a.job_id WHERE a.attempt_id = ?1",
                params![attempt_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .map_err(|error| format!("Không đọc được attempt: {error}"))?;
        if attempt_state != "pending" {
            return Err(format!(
                "Chỉ có thể claim mock worker cho attempt pending; hiện tại là {attempt_state}"
            ));
        }
        if job_state != "queued" {
            return Err(format!(
                "Job phải ở queued trước khi claim mock worker; hiện tại là {job_state}"
            ));
        }

        let timestamp = now_string();
        let lease_owner = format!("mock-worker:{attempt_id}");
        let changed = transaction
            .execute(
                "UPDATE job_attempts SET state='running', execution_mode='in_process_mock', worker_id='mock-worker', lease_owner=?1, lease_expires_at=?2, heartbeat_at=?3, started_at=?3, process_started=0, updated_at=?3 WHERE attempt_id=?4 AND state='pending'",
                params![lease_owner, lease_expiry_string(timeout_seconds as u64), timestamp, attempt_id],
            )
            .map_err(|error| format!("Không claim được attempt: {error}"))?;
        if changed != 1 {
            return Err("Attempt đã thay đổi trước khi claim".to_string());
        }
        let changed = transaction
            .execute(
                "UPDATE jobs SET state='running', progress=0.0, started_at=?1, error_code=NULL, error_message=NULL WHERE job_id=?2 AND state='queued'",
                params![timestamp, job_id],
            )
            .map_err(|error| format!("Không chuyển job sang running: {error}"))?;
        if changed != 1 {
            return Err("Job đã thay đổi trước khi claim mock worker".to_string());
        }
        audit_event(
            &transaction,
            Some(&project_id),
            "job.transition",
            "job",
            &job_id,
        )?;
        audit_event(
            &transaction,
            Some(&project_id),
            "attempt.claimed",
            "attempt",
            attempt_id,
        )?;
        transaction
            .commit()
            .map_err(|error| format!("Không commit được mock claim: {error}"))?;
        fetch_attempt(&connection, attempt_id)
    })();

    if result.is_err() {
        if let Ok(mut cancellations) = state.cancellation_tokens.lock() {
            cancellations.remove(attempt_id);
        }
    }
    result.map(|attempt| (attempt, cancellation))
}

fn update_mock_heartbeat_for_state(
    state: &AppState,
    attempt_id: &str,
    progress: f64,
    timeout_seconds: u64,
) -> Result<bool, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let timestamp = now_string();
    let changed = connection
        .execute(
            "UPDATE job_attempts SET heartbeat_at=?1, lease_expires_at=?2, updated_at=?1 WHERE attempt_id=?3 AND state='running' AND lease_owner=?4",
            params![timestamp, lease_expiry_string(timeout_seconds), attempt_id, format!("mock-worker:{attempt_id}")],
        )
        .map_err(|error| format!("Không ghi được heartbeat: {error}"))?;
    if changed == 1 {
        connection
            .execute(
                "UPDATE jobs SET progress=?1 WHERE job_id=(SELECT job_id FROM job_attempts WHERE attempt_id=?2) AND state='running'",
                params![progress.clamp(0.0, 1.0), attempt_id],
            )
            .map_err(|error| format!("Không cập nhật được progress mock worker: {error}"))?;
    }
    Ok(changed == 1)
}

fn update_mock_heartbeat(
    app: &AppHandle,
    attempt_id: &str,
    progress: f64,
    timeout_seconds: u64,
) -> Result<bool, String> {
    let state = app.state::<AppState>();
    update_mock_heartbeat_for_state(&state, attempt_id, progress, timeout_seconds)
}

fn request_attempt_cancel(state: &AppState, job_id: &str) -> Result<bool, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let attempt: Option<(String, String)> = connection
        .query_row(
            "SELECT a.attempt_id, j.project_id FROM job_attempts a JOIN jobs j ON j.job_id = a.job_id WHERE a.job_id = ?1 AND a.state IN ('running', 'cancel_requested') ORDER BY a.attempt_number DESC LIMIT 1",
            params![job_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| format!("Không đọc được attempt external/in-process đang chạy: {error}"))?;
    let Some((attempt_id, project_id)) = attempt else {
        return Ok(false);
    };
    let timestamp = now_string();
    let changed = connection
        .execute(
            "UPDATE job_attempts SET state='cancel_requested', cancellation_requested_at=?1, updated_at=?1 WHERE attempt_id=?2 AND state='running'",
            params![timestamp, attempt_id],
        )
        .map_err(|error| format!("Không ghi được yêu cầu hủy attempt: {error}"))?;
    if changed == 1 {
        audit_event(
            &connection,
            Some(&project_id),
            "attempt.cancel_requested",
            "attempt",
            &attempt_id,
        )?;
    }
    if let Ok(cancellations) = state.cancellation_tokens.lock() {
        if let Some(flag) = cancellations.get(&attempt_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }
    Ok(true)
}

fn finish_mock_attempt_for_state(
    state: &AppState,
    attempt_id: &str,
    cancellation_requested: bool,
) -> Result<(), String> {
    let mut connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Không mở được finish transaction: {error}"))?;
    let row: Option<(String, String, String, String)> = transaction
        .query_row(
            "SELECT a.job_id, j.project_id, a.state, j.state FROM job_attempts a JOIN jobs j ON j.job_id = a.job_id WHERE a.attempt_id = ?1",
            params![attempt_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(|error| format!("Không đọc được attempt khi finish: {error}"))?;
    let Some((job_id, project_id, attempt_state, job_state)) = row else {
        return Ok(());
    };
    let cancelled = cancellation_requested
        || attempt_state == "cancel_requested"
        || job_state == "cancel_requested";
    if cancelled {
        if !matches!(attempt_state.as_str(), "running" | "cancel_requested") {
            return Ok(());
        }
        let timestamp = now_string();
        let changed = transaction
            .execute(
                "UPDATE job_attempts SET state='cancelled', finished_at=?1, termination_mode='cooperative', lease_expires_at=NULL, updated_at=?1, retryable=1 WHERE attempt_id=?2 AND state IN ('running', 'cancel_requested')",
                params![timestamp, attempt_id],
            )
            .map_err(|error| format!("Không hoàn tất cancellation attempt: {error}"))?;
        if changed != 1 {
            return Ok(());
        }
        transaction
            .execute(
                "UPDATE job_outputs SET validation_state='missing', validation_message='Mock worker dừng trước khi tạo output' WHERE attempt_id=?1",
                params![attempt_id],
            )
            .map_err(|error| format!("Không ghi evidence cancellation: {error}"))?;
        transaction
            .execute(
                "UPDATE jobs SET state='cancelled', finished_at=?1 WHERE job_id=?2 AND state IN ('running', 'cancel_requested')",
                params![timestamp, job_id],
            )
            .map_err(|error| format!("Không chuyển job sang cancelled: {error}"))?;
        audit_event(
            &transaction,
            Some(&project_id),
            "attempt.cancelled",
            "attempt",
            attempt_id,
        )?;
        audit_event(
            &transaction,
            Some(&project_id),
            "job.transition",
            "job",
            &job_id,
        )?;
    } else {
        if attempt_state != "running" {
            return Ok(());
        }
        let timestamp = now_string();
        transaction
            .execute(
                "UPDATE job_outputs SET validation_state='not_checked', validation_message='Deterministic mock không tạo binary output; chỉ hoàn tất lifecycle' WHERE attempt_id=?1",
                params![attempt_id],
            )
            .map_err(|error| format!("Không ghi mock output evidence: {error}"))?;
        let changed = transaction
            .execute(
                "UPDATE job_attempts SET state='succeeded', finished_at=?1, lease_owner=NULL, lease_expires_at=NULL, heartbeat_at=?1, updated_at=?1, retryable=0 WHERE attempt_id=?2 AND state='running'",
                params![timestamp, attempt_id],
            )
            .map_err(|error| format!("Không hoàn tất mock attempt: {error}"))?;
        if changed != 1 {
            return Ok(());
        }
        transaction
            .execute(
                "UPDATE jobs SET state='succeeded', progress=1.0, finished_at=?1 WHERE job_id=?2 AND state='running'",
                params![timestamp, job_id],
            )
            .map_err(|error| format!("Không chuyển job sang succeeded: {error}"))?;
        audit_event(
            &transaction,
            Some(&project_id),
            "attempt.succeeded",
            "attempt",
            attempt_id,
        )?;
        audit_event(
            &transaction,
            Some(&project_id),
            "job.transition",
            "job",
            &job_id,
        )?;
    }
    transaction
        .commit()
        .map_err(|error| format!("Không commit được mock finish: {error}"))?;
    Ok(())
}

fn finish_mock_attempt(
    app: &AppHandle,
    attempt_id: &str,
    cancellation_requested: bool,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    finish_mock_attempt_for_state(&state, attempt_id, cancellation_requested)
}

fn spawn_mock_worker(app: AppHandle, attempt: AttemptView, cancellation: Arc<AtomicBool>) {
    tauri::async_runtime::spawn(async move {
        for step in 1..=MOCK_WORKER_STEPS {
            tokio::time::sleep(Duration::from_millis(MOCK_WORKER_STEP_MILLIS)).await;
            if cancellation.load(Ordering::SeqCst) {
                let _ = finish_mock_attempt(&app, &attempt.attempt_id, true);
                break;
            }
            let progress = step as f64 / MOCK_WORKER_STEPS as f64;
            if !update_mock_heartbeat(
                &app,
                &attempt.attempt_id,
                progress,
                attempt.timeout_seconds as u64,
            )
            .unwrap_or(false)
            {
                let _ = finish_mock_attempt(&app, &attempt.attempt_id, true);
                break;
            }
            if step == MOCK_WORKER_STEPS {
                let _ = finish_mock_attempt(&app, &attempt.attempt_id, false);
            }
        }
        if let Some(state) = app.try_state::<AppState>() {
            if let Ok(mut cancellations) = state.cancellation_tokens.lock() {
                cancellations.remove(&attempt.attempt_id);
            }
        }
    });
}

#[tauri::command]
fn start_mock_attempt(
    attempt_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AttemptView, String> {
    valid_text(&attempt_id, "Attempt ID")?;
    let (attempt, cancellation) = claim_mock_attempt(&state, attempt_id.trim())?;
    spawn_mock_worker(app, attempt.clone(), cancellation);
    Ok(attempt)
}

#[tauri::command]
async fn run_ffmpeg_fixture(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<LocalMediaFixtureReport, String> {
    valid_text(&project_id, "Project ID")?;
    let (workspace_root, ffmpeg_path, ffprobe_path) = {
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
        let ffmpeg_path = resolve_configured_tool(&connection, "ffmpeg")?;
        let ffprobe_path = resolve_configured_tool(&connection, "ffprobe")?;
        (PathBuf::from(workspace_root), ffmpeg_path, ffprobe_path)
    };
    let workspace_root = fs::canonicalize(&workspace_root)
        .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?;
    let fixture_directory = workspace_root
        .join(".auto3dvideo")
        .join("fixtures")
        .join("ffmpeg");
    fs::create_dir_all(&fixture_directory)
        .map_err(|error| format!("Không tạo được fixture directory: {error}"))?;
    let fixture_name = format!("synthetic-1s-{}.mp4", now_id("fixture"));
    let output_path = fixture_directory.join(&fixture_name);
    let relative_output = output_path
        .strip_prefix(&workspace_root)
        .map_err(|_| "Fixture output vượt project workspace".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let working_directory = fixture_directory
        .strip_prefix(&workspace_root)
        .map_err(|_| "Fixture working directory vượt project workspace".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let cancellation = Arc::new(AtomicBool::new(false));
    let ffmpeg_spec = ProcessSpec {
        executable_id: "ffmpeg".to_string(),
        args: vec![
            "-hide_banner".to_string(),
            "-loglevel".to_string(),
            "error".to_string(),
            "-f".to_string(),
            "lavfi".to_string(),
            "-i".to_string(),
            "color=c=black:s=320x180:r=30".to_string(),
            "-f".to_string(),
            "lavfi".to_string(),
            "-i".to_string(),
            "anullsrc=channel_layout=stereo:sample_rate=48000".to_string(),
            "-t".to_string(),
            "1".to_string(),
            "-c:v".to_string(),
            "libx264".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
            "-c:a".to_string(),
            "aac".to_string(),
            "-shortest".to_string(),
            "-y".to_string(),
            fixture_name.clone(),
        ],
        working_directory: working_directory.clone(),
        environment: Default::default(),
        timeout_seconds: 60,
        expected_outputs: vec![relative_output.clone()],
    };
    let ffmpeg = run_external_process(ExternalProcessRequest {
        spec: ffmpeg_spec,
        executable_path: ffmpeg_path,
        absolute_working_directory: fixture_directory.clone(),
        output_root: workspace_root.clone(),
        cancellation: cancellation.clone(),
    })
    .await?;
    if !ffmpeg.succeeded {
        return Err("FFmpeg fixture không tạo output hợp lệ".to_string());
    }
    let ffprobe_spec = ProcessSpec {
        executable_id: "ffprobe".to_string(),
        args: vec![
            "-v".to_string(),
            "error".to_string(),
            "-print_format".to_string(),
            "json".to_string(),
            "-show_streams".to_string(),
            "-show_format".to_string(),
            fixture_name,
        ],
        working_directory,
        environment: Default::default(),
        timeout_seconds: 60,
        expected_outputs: Vec::new(),
    };
    let ffprobe = run_external_process(ExternalProcessRequest {
        spec: ffprobe_spec,
        executable_path: ffprobe_path,
        absolute_working_directory: fixture_directory,
        output_root: workspace_root,
        cancellation,
    })
    .await?;
    if !ffprobe.succeeded {
        return Err("FFprobe fixture không đọc được output".to_string());
    }
    let metadata: Value = serde_json::from_str(&ffprobe.stdout)
        .map_err(|error| format!("FFprobe trả JSON không hợp lệ: {error}"))?;
    let streams = metadata
        .get("streams")
        .and_then(Value::as_array)
        .ok_or_else(|| "FFprobe thiếu streams".to_string())?;
    let duration_seconds = metadata
        .get("format")
        .and_then(|format| format.get("duration"))
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<f64>().ok())
        .ok_or_else(|| "FFprobe thiếu duration hợp lệ".to_string())?;
    let size_bytes = fs::metadata(&output_path)
        .map_err(|error| format!("Không đọc được fixture output: {error}"))?
        .len();
    if streams.len() < 2 || duration_seconds <= 0.0 || size_bytes == 0 {
        return Err("Fixture output không đạt stream/duration/size check".to_string());
    }
    Ok(LocalMediaFixtureReport {
        output_path: relative_output,
        size_bytes,
        duration_seconds,
        stream_count: streams.len(),
        ffmpeg,
        ffprobe,
    })
}

fn claim_external_attempt(
    state: &AppState,
    attempt_id: &str,
    expected_executable: &str,
) -> Result<(AttemptView, Arc<AtomicBool>), String> {
    let cancellation = Arc::new(AtomicBool::new(false));
    {
        let mut cancellations = state
            .cancellation_tokens
            .lock()
            .map_err(|_| "Không thể khóa external worker registry".to_string())?;
        if cancellations.contains_key(attempt_id) {
            return Err("Attempt đang được external worker xử lý".to_string());
        }
        cancellations.insert(attempt_id.to_string(), cancellation.clone());
    }

    let result = (|| {
        let mut connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Không mở được transaction: {error}"))?;
        let (job_id, project_id, attempt_state, job_state, timeout_seconds, executable_id):
            (String, String, String, String, i64, Option<String>) = transaction
            .query_row(
                "SELECT a.job_id, j.project_id, a.state, j.state, a.timeout_seconds, a.executable_id FROM job_attempts a JOIN jobs j ON j.job_id = a.job_id WHERE a.attempt_id = ?1",
                params![attempt_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
            )
            .map_err(|error| format!("Không đọc được external attempt: {error}"))?;
        if attempt_state != "pending" {
            return Err(format!(
                "Chỉ có thể claim external worker cho attempt pending; hiện tại là {attempt_state}"
            ));
        }
        if job_state != "queued" {
            return Err(format!(
                "Job phải ở queued trước khi claim external worker; hiện tại là {job_state}"
            ));
        }
        if executable_id.as_deref() != Some(expected_executable) {
            return Err(format!(
                "External attempt phải dùng executable {expected_executable}"
            ));
        }

        let timestamp = now_string();
        let lease_owner = format!("external-worker:{attempt_id}");
        let changed = transaction
            .execute(
                "UPDATE job_attempts SET state='running', execution_mode='external_process', worker_id='native-external', lease_owner=?1, lease_expires_at=?2, heartbeat_at=?3, started_at=?3, process_started=1, external_side_effect_unknown=0, updated_at=?3 WHERE attempt_id=?4 AND state='pending'",
                params![lease_owner, lease_expiry_string(timeout_seconds as u64), timestamp, attempt_id],
            )
            .map_err(|error| format!("Không claim được external attempt: {error}"))?;
        if changed != 1 {
            return Err("Attempt đã thay đổi trước khi claim external worker".to_string());
        }
        let changed = transaction
            .execute(
                "UPDATE jobs SET state='running', progress=0.0, started_at=?1, error_code=NULL, error_message=NULL WHERE job_id=?2 AND state='queued'",
                params![timestamp, job_id],
            )
            .map_err(|error| format!("Không chuyển job sang running: {error}"))?;
        if changed != 1 {
            return Err("Job đã thay đổi trước khi claim external worker".to_string());
        }
        audit_event(
            &transaction,
            Some(&project_id),
            "attempt.external_claimed",
            "attempt",
            attempt_id,
        )?;
        transaction
            .commit()
            .map_err(|error| format!("Không commit được external claim: {error}"))?;
        fetch_attempt(&connection, attempt_id)
    })();

    if result.is_err() {
        if let Ok(mut cancellations) = state.cancellation_tokens.lock() {
            cancellations.remove(attempt_id);
        }
    }
    result.map(|attempt| (attempt, cancellation))
}

fn reconcile_active_external_attempts(connection: &Connection) -> Result<usize, String> {
    let active: Vec<(String, String, String)> = {
        let mut statement = connection
            .prepare("SELECT a.attempt_id, a.job_id, j.project_id FROM job_attempts a JOIN jobs j ON j.job_id = a.job_id WHERE a.execution_mode='external_process' AND a.state IN ('running', 'cancel_requested')")
            .map_err(|error| format!("Không đọc được external attempts cần reconcile: {error}"))?;
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
    };
    if active.is_empty() {
        return Ok(0);
    }
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("Không mở được reconciliation transaction: {error}"))?;
    let timestamp = now_string();
    for (attempt_id, job_id, project_id) in &active {
        transaction
            .execute(
                "UPDATE job_attempts SET state='reconciliation_required', finished_at=?1, lease_owner=NULL, lease_expires_at=NULL, heartbeat_at=?1, external_side_effect_unknown=1, retryable=0, error_code='RESTART_RECONCILIATION_REQUIRED', redacted_message='App restart khi external process state chưa xác định', termination_mode='tree_force', updated_at=?1 WHERE attempt_id=?2 AND state IN ('running', 'cancel_requested')",
                params![timestamp, attempt_id],
            )
            .map_err(|error| format!("Không reconcile được attempt: {error}"))?;
        transaction
            .execute(
                "UPDATE job_outputs SET validation_state='not_checked', validation_message='App restart khi external process state chưa xác định' WHERE attempt_id=?1 AND validation_state='pending'",
                params![attempt_id],
            )
            .map_err(|error| format!("Không reconcile được output evidence: {error}"))?;
        transaction
            .execute(
                "UPDATE jobs SET state='reconciliation_required', finished_at=?1, error_code='RESTART_RECONCILIATION_REQUIRED', error_message='App restart khi external process state chưa xác định' WHERE job_id=?2 AND state IN ('running', 'cancel_requested')",
                params![timestamp, job_id],
            )
            .map_err(|error| format!("Không reconcile được job: {error}"))?;
        audit_event(
            &transaction,
            Some(project_id),
            "attempt.restart_reconciliation_required",
            "attempt",
            attempt_id,
        )?;
    }
    transaction
        .commit()
        .map_err(|error| format!("Không commit được reconciliation: {error}"))?;
    Ok(active.len())
}

fn bounded_failure_message(message: &str) -> String {
    message.chars().take(4096).collect()
}

fn failure_from_process_error(output_path: &str, message: String) -> FixtureFailure {
    FixtureFailure {
        output_path: output_path.to_string(),
        error_code: "EXTERNAL_WORKER_ERROR".to_string(),
        message: bounded_failure_message(&message),
        external_side_effect_unknown: true,
        termination_mode: "tree_force".to_string(),
        stdout_bytes: 0,
        stderr_bytes: 0,
        output_evidence: Vec::new(),
    }
}

async fn execute_ffmpeg_fixture_for_attempt(
    workspace_root: PathBuf,
    fixture_directory: PathBuf,
    fixture_name: String,
    relative_output: String,
    ffmpeg_path: PathBuf,
    ffprobe_path: PathBuf,
    cancellation: Arc<AtomicBool>,
) -> Result<LocalMediaFixtureReport, FixtureFailure> {
    let working_directory = fixture_directory
        .strip_prefix(&workspace_root)
        .map_err(|_| {
            failure_from_process_error(
                &relative_output,
                "Fixture working directory vượt project workspace".to_string(),
            )
        })?
        .to_string_lossy()
        .replace('\\', "/");
    let ffmpeg_spec = ProcessSpec {
        executable_id: "ffmpeg".to_string(),
        args: vec![
            "-hide_banner".to_string(),
            "-loglevel".to_string(),
            "error".to_string(),
            "-f".to_string(),
            "lavfi".to_string(),
            "-i".to_string(),
            "color=c=black:s=320x180:r=30".to_string(),
            "-f".to_string(),
            "lavfi".to_string(),
            "-i".to_string(),
            "anullsrc=channel_layout=stereo:sample_rate=48000".to_string(),
            "-t".to_string(),
            "1".to_string(),
            "-c:v".to_string(),
            "libx264".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
            "-c:a".to_string(),
            "aac".to_string(),
            "-shortest".to_string(),
            "-y".to_string(),
            fixture_name.clone(),
        ],
        working_directory: working_directory.clone(),
        environment: Default::default(),
        timeout_seconds: 60,
        expected_outputs: vec![relative_output.clone()],
    };
    let ffmpeg = run_external_process(ExternalProcessRequest {
        spec: ffmpeg_spec,
        executable_path: ffmpeg_path,
        absolute_working_directory: fixture_directory.clone(),
        output_root: workspace_root.clone(),
        cancellation: cancellation.clone(),
    })
    .await
    .map_err(|error| failure_from_process_error(&relative_output, error))?;
    if !ffmpeg.succeeded {
        return Err(FixtureFailure {
            output_path: relative_output.clone(),
            error_code: if ffmpeg.timed_out {
                "FFMPEG_TIMEOUT".to_string()
            } else if ffmpeg.cancelled {
                "FFMPEG_CANCELLED".to_string()
            } else {
                "FFMPEG_FAILED".to_string()
            },
            message: "FFmpeg fixture process không tạo output hợp lệ".to_string(),
            external_side_effect_unknown: ffmpeg.external_side_effect_unknown,
            termination_mode: ffmpeg.termination_mode.clone(),
            stdout_bytes: ffmpeg.stdout_bytes as i64,
            stderr_bytes: ffmpeg.stderr_bytes as i64,
            output_evidence: ffmpeg.output_evidence.clone(),
        });
    }

    let ffprobe_spec = ProcessSpec {
        executable_id: "ffprobe".to_string(),
        args: vec![
            "-v".to_string(),
            "error".to_string(),
            "-print_format".to_string(),
            "json".to_string(),
            "-show_streams".to_string(),
            "-show_format".to_string(),
            fixture_name,
        ],
        working_directory,
        environment: Default::default(),
        timeout_seconds: 60,
        expected_outputs: Vec::new(),
    };
    let ffprobe = run_external_process(ExternalProcessRequest {
        spec: ffprobe_spec,
        executable_path: ffprobe_path,
        absolute_working_directory: fixture_directory,
        output_root: workspace_root.clone(),
        cancellation,
    })
    .await
    .map_err(|error| failure_from_process_error(&relative_output, error))?;
    if !ffprobe.succeeded {
        return Err(FixtureFailure {
            output_path: relative_output.clone(),
            error_code: if ffprobe.timed_out {
                "FFPROBE_TIMEOUT".to_string()
            } else if ffprobe.cancelled {
                "FFPROBE_CANCELLED".to_string()
            } else {
                "FFPROBE_FAILED".to_string()
            },
            message: "FFprobe fixture không đọc được output".to_string(),
            external_side_effect_unknown: ffprobe.external_side_effect_unknown,
            termination_mode: ffprobe.termination_mode.clone(),
            stdout_bytes: (ffmpeg.stdout_bytes + ffprobe.stdout_bytes) as i64,
            stderr_bytes: (ffmpeg.stderr_bytes + ffprobe.stderr_bytes) as i64,
            output_evidence: ffmpeg.output_evidence.clone(),
        });
    }
    let metadata: Value =
        serde_json::from_str(&ffprobe.stdout).map_err(|error| FixtureFailure {
            output_path: relative_output.clone(),
            error_code: "FFPROBE_INVALID_JSON".to_string(),
            message: bounded_failure_message(&format!("FFprobe trả JSON không hợp lệ: {error}")),
            external_side_effect_unknown: false,
            termination_mode: "none".to_string(),
            stdout_bytes: (ffmpeg.stdout_bytes + ffprobe.stdout_bytes) as i64,
            stderr_bytes: (ffmpeg.stderr_bytes + ffprobe.stderr_bytes) as i64,
            output_evidence: ffmpeg.output_evidence.clone(),
        })?;
    let streams = metadata
        .get("streams")
        .and_then(Value::as_array)
        .ok_or_else(|| FixtureFailure {
            output_path: relative_output.clone(),
            error_code: "FFPROBE_MISSING_STREAMS".to_string(),
            message: "FFprobe thiếu streams".to_string(),
            external_side_effect_unknown: false,
            termination_mode: "none".to_string(),
            stdout_bytes: (ffmpeg.stdout_bytes + ffprobe.stdout_bytes) as i64,
            stderr_bytes: (ffmpeg.stderr_bytes + ffprobe.stderr_bytes) as i64,
            output_evidence: ffmpeg.output_evidence.clone(),
        })?;
    let duration_seconds = metadata
        .get("format")
        .and_then(|format| format.get("duration"))
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<f64>().ok())
        .ok_or_else(|| FixtureFailure {
            output_path: relative_output.clone(),
            error_code: "FFPROBE_MISSING_DURATION".to_string(),
            message: "FFprobe thiếu duration hợp lệ".to_string(),
            external_side_effect_unknown: false,
            termination_mode: "none".to_string(),
            stdout_bytes: (ffmpeg.stdout_bytes + ffprobe.stdout_bytes) as i64,
            stderr_bytes: (ffmpeg.stderr_bytes + ffprobe.stderr_bytes) as i64,
            output_evidence: ffmpeg.output_evidence.clone(),
        })?;
    let output_path = workspace_root.join(&relative_output);
    let size_bytes = fs::metadata(&output_path)
        .map_err(|error| FixtureFailure {
            output_path: relative_output.clone(),
            error_code: "OUTPUT_MISSING".to_string(),
            message: bounded_failure_message(&format!("Không đọc được fixture output: {error}")),
            external_side_effect_unknown: false,
            termination_mode: "none".to_string(),
            stdout_bytes: (ffmpeg.stdout_bytes + ffprobe.stdout_bytes) as i64,
            stderr_bytes: (ffmpeg.stderr_bytes + ffprobe.stderr_bytes) as i64,
            output_evidence: ffmpeg.output_evidence.clone(),
        })?
        .len();
    if streams.len() < 2 || duration_seconds <= 0.0 || size_bytes == 0 {
        return Err(FixtureFailure {
            output_path: relative_output.clone(),
            error_code: "OUTPUT_INVALID".to_string(),
            message: "Fixture output không đạt stream/duration/size check".to_string(),
            external_side_effect_unknown: false,
            termination_mode: "none".to_string(),
            stdout_bytes: (ffmpeg.stdout_bytes + ffprobe.stdout_bytes) as i64,
            stderr_bytes: (ffmpeg.stderr_bytes + ffprobe.stderr_bytes) as i64,
            output_evidence: ffmpeg.output_evidence.clone(),
        });
    }
    Ok(LocalMediaFixtureReport {
        output_path: relative_output,
        size_bytes,
        duration_seconds,
        stream_count: streams.len(),
        ffmpeg,
        ffprobe,
    })
}

fn persist_output_evidence(
    transaction: &rusqlite::Transaction<'_>,
    attempt_id: &str,
    evidence: &[OutputEvidence],
    default_state: &str,
    default_message: &str,
) -> Result<(), String> {
    let outputs: Vec<String> = transaction
        .prepare("SELECT relative_path FROM job_outputs WHERE attempt_id = ?1")
        .map_err(|error| error.to_string())?
        .query_map(params![attempt_id], |row| row.get(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    for relative_path in outputs {
        let found = evidence
            .iter()
            .find(|item| item.relative_path == relative_path);
        let (validation_state, validation_message) = found
            .map(|item| {
                (
                    item.validation_state.as_str(),
                    item.validation_message
                        .as_deref()
                        .unwrap_or(default_message),
                )
            })
            .unwrap_or((default_state, default_message));
        transaction
            .execute(
                "UPDATE job_outputs SET validation_state=?1, validation_message=?2 WHERE attempt_id=?3 AND relative_path=?4",
                params![validation_state, validation_message, attempt_id, relative_path],
            )
            .map_err(|error| format!("Không ghi được output evidence: {error}"))?;
    }
    Ok(())
}

fn persist_external_fixture_success(
    state: &AppState,
    attempt_id: &str,
    report: &LocalMediaFixtureReport,
) -> Result<ExternalFixtureAttemptReport, String> {
    let mut connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Không mở được success transaction: {error}"))?;
    let (job_id, project_id): (String, String) = transaction
        .query_row(
            "SELECT a.job_id, j.project_id FROM job_attempts a JOIN jobs j ON j.job_id = a.job_id WHERE a.attempt_id = ?1",
            params![attempt_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| format!("Không đọc được success attempt: {error}"))?;
    let timestamp = now_string();
    let stdout_bytes = (report.ffmpeg.stdout_bytes + report.ffprobe.stdout_bytes) as i64;
    let stderr_bytes = (report.ffmpeg.stderr_bytes + report.ffprobe.stderr_bytes) as i64;
    let changed = transaction
        .execute(
            "UPDATE job_attempts SET state='succeeded', finished_at=?1, lease_owner=NULL, lease_expires_at=NULL, heartbeat_at=?1, process_started=1, external_side_effect_unknown=0, retryable=0, error_code=NULL, redacted_message=NULL, stdout_bytes=?2, stderr_bytes=?3, termination_mode='none', updated_at=?1 WHERE attempt_id=?4 AND state IN ('running', 'cancel_requested')",
            params![timestamp, stdout_bytes, stderr_bytes, attempt_id],
        )
        .map_err(|error| format!("Không hoàn tất external attempt: {error}"))?;
    if changed != 1 {
        return Err("External attempt không còn ở running khi persist success".to_string());
    }
    persist_output_evidence(
        &transaction,
        attempt_id,
        &report.ffmpeg.output_evidence,
        "missing",
        "FFmpeg fixture không có output evidence",
    )?;
    transaction
        .execute(
            "UPDATE jobs SET state='succeeded', progress=1.0, finished_at=?1, error_code=NULL, error_message=NULL WHERE job_id=?2 AND state IN ('running', 'cancel_requested')",
            params![timestamp, job_id],
        )
        .map_err(|error| format!("Không hoàn tất external job: {error}"))?;
    audit_event(
        &transaction,
        Some(&project_id),
        "attempt.external_succeeded",
        "attempt",
        attempt_id,
    )?;
    audit_event(
        &transaction,
        Some(&project_id),
        "job.external_succeeded",
        "job",
        &job_id,
    )?;
    transaction
        .commit()
        .map_err(|error| format!("Không commit được external success: {error}"))?;
    Ok(ExternalFixtureAttemptReport {
        job: fetch_job(&connection, &job_id)?,
        attempt: fetch_attempt(&connection, attempt_id)?,
        output_path: report.output_path.clone(),
    })
}

fn persist_external_fixture_failure(
    state: &AppState,
    attempt_id: &str,
    failure: FixtureFailure,
) -> Result<AttemptView, String> {
    let mut connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Không mở được failure transaction: {error}"))?;
    let (job_id, project_id): (String, String) = transaction
        .query_row(
            "SELECT a.job_id, j.project_id FROM job_attempts a JOIN jobs j ON j.job_id = a.job_id WHERE a.attempt_id = ?1",
            params![attempt_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| format!("Không đọc được failure attempt: {error}"))?;
    let timestamp = now_string();
    let state_name = if failure.external_side_effect_unknown {
        "reconciliation_required"
    } else {
        "failed"
    };
    let retryable = failure.external_side_effect_unknown || failure.error_code.ends_with("TIMEOUT");
    transaction
        .execute(
            "UPDATE job_attempts SET state=?1, finished_at=?2, lease_owner=NULL, lease_expires_at=NULL, heartbeat_at=?2, external_side_effect_unknown=?3, retryable=?4, error_code=?5, redacted_message=?6, stdout_bytes=?7, stderr_bytes=?8, termination_mode=?9, updated_at=?2 WHERE attempt_id=?10 AND state IN ('running', 'cancel_requested')",
            params![state_name, timestamp, failure.external_side_effect_unknown as i64, retryable as i64, failure.error_code, bounded_failure_message(&failure.message), failure.stdout_bytes, failure.stderr_bytes, failure.termination_mode, attempt_id],
        )
        .map_err(|error| format!("Không persist được external failure: {error}"))?;
    persist_output_evidence(
        &transaction,
        attempt_id,
        &failure.output_evidence,
        "missing",
        "External worker không tạo output evidence",
    )?;
    let job_error = bounded_failure_message(&format!(
        "{} (output: {})",
        failure.message, failure.output_path
    ));
    transaction
        .execute(
            "UPDATE jobs SET state=?1, finished_at=?2, error_code=?3, error_message=?4 WHERE job_id=?5 AND state IN ('running', 'cancel_requested')",
            params![state_name, timestamp, failure.error_code, job_error, job_id],
        )
        .map_err(|error| format!("Không persist được external job failure: {error}"))?;
    audit_event(
        &transaction,
        Some(&project_id),
        if failure.external_side_effect_unknown {
            "attempt.reconciliation_required"
        } else {
            "attempt.external_failed"
        },
        "attempt",
        attempt_id,
    )?;
    transaction
        .commit()
        .map_err(|error| format!("Không commit được external failure: {error}"))?;
    fetch_attempt(&connection, attempt_id)
}

fn spawn_external_fixture_worker(
    app: AppHandle,
    attempt_id: String,
    cancellation: Arc<AtomicBool>,
    workspace_root: PathBuf,
    fixture_directory: PathBuf,
    fixture_name: String,
    relative_output: String,
    ffmpeg_path: PathBuf,
    ffprobe_path: PathBuf,
) {
    tauri::async_runtime::spawn(async move {
        let result = execute_ffmpeg_fixture_for_attempt(
            workspace_root,
            fixture_directory,
            fixture_name,
            relative_output,
            ffmpeg_path,
            ffprobe_path,
            cancellation,
        )
        .await;
        if let Some(state) = app.try_state::<AppState>() {
            match result {
                Ok(report) => {
                    let _ = persist_external_fixture_success(&state, &attempt_id, &report);
                }
                Err(failure) => {
                    let _ = persist_external_fixture_failure(&state, &attempt_id, failure);
                }
            }
            if let Ok(mut cancellations) = state.cancellation_tokens.lock() {
                cancellations.remove(&attempt_id);
            }
        }
    });
}

#[tauri::command]
async fn run_ffmpeg_fixture_attempt(
    project_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ExternalFixtureAttemptReport, String> {
    valid_text(&project_id, "Project ID")?;
    let (workspace_root, ffmpeg_path, ffprobe_path) = {
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
        let ffmpeg_path = resolve_configured_tool(&connection, "ffmpeg")?;
        let ffprobe_path = resolve_configured_tool(&connection, "ffprobe")?;
        (PathBuf::from(workspace_root), ffmpeg_path, ffprobe_path)
    };
    let workspace_root = fs::canonicalize(&workspace_root)
        .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?;
    let job_id = now_id("job");
    let attempt_id = now_id("attempt");
    let fixture_directory = workspace_root
        .join(".auto3dvideo")
        .join("fixtures")
        .join("attempts")
        .join(&attempt_id);
    fs::create_dir_all(&fixture_directory)
        .map_err(|error| format!("Không tạo được external fixture directory: {error}"))?;
    let fixture_name = "synthetic-1s.mp4".to_string();
    let relative_output = fixture_directory
        .join(&fixture_name)
        .strip_prefix(&workspace_root)
        .map_err(|_| "External fixture output vượt project workspace".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let timestamp = now_string();
    {
        let mut connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Không mở được external fixture transaction: {error}"))?;
        let project_exists: i64 = transaction
            .query_row(
                "SELECT COUNT(*) FROM projects WHERE project_id = ?1",
                params![project_id.trim()],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if project_exists == 0 {
            return Err("Project không tồn tại".to_string());
        }
        transaction
            .execute(
                "INSERT INTO jobs(job_id, project_id, kind, state, progress, attempt_count, created_at) VALUES (?1, ?2, 'ffmpeg_fixture', 'queued', 0.0, 1, ?3)",
                params![job_id, project_id.trim(), timestamp],
            )
            .map_err(|error| format!("Không tạo được external fixture job: {error}"))?;
        transaction
            .execute(
                "INSERT INTO job_attempts(attempt_id, job_id, attempt_number, state, executable_id, execution_mode, timeout_seconds, max_log_bytes, process_started, external_side_effect_unknown, retryable, created_at, updated_at) VALUES (?1, ?2, 1, 'pending', 'ffmpeg', 'external_process', 120, 1048576, 0, 0, 0, ?3, ?3)",
                params![attempt_id, job_id, timestamp],
            )
            .map_err(|error| format!("Không tạo được external fixture attempt: {error}"))?;
        transaction
            .execute(
                "INSERT INTO job_outputs(output_id, attempt_id, relative_path, media_kind, validation_state, created_at) VALUES (?1, ?2, ?3, 'video', 'pending', ?4)",
                params![now_id("output"), attempt_id, relative_output, timestamp],
            )
            .map_err(|error| format!("Không tạo được external fixture output: {error}"))?;
        audit_event(
            &transaction,
            Some(project_id.trim()),
            "job.external_fixture_created",
            "job",
            &job_id,
        )?;
        transaction
            .commit()
            .map_err(|error| format!("Không commit được external fixture job: {error}"))?;
    }
    let (attempt, cancellation) = claim_external_attempt(&state, &attempt_id, "ffmpeg")?;
    let job = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        fetch_job(&connection, &job_id)?
    };
    spawn_external_fixture_worker(
        app,
        attempt_id,
        cancellation,
        workspace_root,
        fixture_directory,
        fixture_name,
        relative_output.clone(),
        ffmpeg_path,
        ffprobe_path,
    );
    Ok(ExternalFixtureAttemptReport {
        job,
        attempt,
        output_path: relative_output,
    })
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
async fn check_vieneu_local(
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
async fn run_vieneu_tts(
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

fn project_workspace_and_python(
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
async fn check_omnivoice_local(
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
async fn prepare_omnivoice_model(
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
async fn list_voice_profiles(
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
async fn list_project_voice_samples(
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
async fn create_voice_profile(
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
async fn update_voice_profile(
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
async fn delete_voice_profile(
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
async fn run_omnivoice_tts(
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

#[tauri::command]
async fn save_recorded_audio(relative_path: String, data_bytes: Vec<u8>) -> Result<String, String> {
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
async fn save_recorded_audio_for_project(
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
async fn read_workspace_audio_base64(relative_path: String) -> Result<String, String> {
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
async fn read_project_audio_base64(
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

fn workspace_media_mime_type(path: &Path) -> Option<&'static str> {
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

fn workspace_media_protocol_response(
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
async fn read_project_asset_preview(
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

#[tauri::command]
async fn test_commandcode_chat(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CommandCodeProbeReport, String> {
    let (python_path, probe_root) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        let python_path = resolve_configured_tool(&connection, "python")?;
        let probe_root = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Không xác định được app data directory: {error}"))?;
        (python_path, probe_root)
    };
    let probe_root = fs::canonicalize(&probe_root).unwrap_or(probe_root);
    fs::create_dir_all(&probe_root)
        .map_err(|error| format!("Không tạo được Command Code probe workspace: {error}"))?;
    let script_relative = ensure_commandcode_worker_script(&probe_root)?;
    let request_id = now_id("commandcode");
    let request_relative = format!(".auto3dvideo/requests/{request_id}.json");
    let request_path = probe_root.join(&request_relative);
    if let Some(parent) = request_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Không tạo được Command Code request directory: {error}"))?;
    }
    let request = serde_json::json!({
        "model": "ag/gemini-3.8-flash-medium",
        "messages": [{
            "role": "user",
            "content": "Trả lời đúng một câu ngắn bằng tiếng Việt: Auto3Dvideo đã kết nối Command Code thành công."
        }],
        "maxTokens": 32,
        "zeroDataRetention": true,
    });
    let request_bytes = serde_json::to_vec(&request)
        .map_err(|error| format!("Không serialize được Command Code request: {error}"))?;
    if request_bytes.len() > 256 * 1024 {
        return Err("Command Code request vượt quá giới hạn kích thước".to_string());
    }
    fs::write(&request_path, request_bytes)
        .map_err(|error| format!("Không ghi được Command Code request: {error}"))?;
    let process_result = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "python".to_string(),
            args: vec![script_relative, "--request".to_string(), request_relative],
            working_directory: ".".to_string(),
            environment: commandcode_worker_environment()?,
            timeout_seconds: 90,
            expected_outputs: Vec::new(),
        },
        executable_path: python_path,
        absolute_working_directory: probe_root.clone(),
        output_root: probe_root,
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await;
    let _ = fs::remove_file(&request_path);
    let process = process_result?;
    let payload = parse_vieneu_worker_output(&process);
    let succeeded = payload
        .as_ref()
        .map(|value| worker_string(value, "status", "") == "succeeded")
        .unwrap_or(false)
        && process.succeeded;
    let status = payload
        .as_ref()
        .map(|value| worker_string(value, "status", "worker_failed"))
        .unwrap_or_else(|| "worker_failed".to_string());
    let message = payload
        .as_ref()
        .map(|value| {
            worker_string(
                value,
                "message",
                "Command Code worker không trả JSON hợp lệ",
            )
        })
        .unwrap_or_else(|| {
            let stderr = process.stderr.trim();
            if stderr.is_empty() {
                format!(
                    "Worker không trả JSON hợp lệ; mã thoát: {}.",
                    process
                        .exit_code
                        .map(|code| code.to_string())
                        .unwrap_or_else(|| "không rõ".to_string())
                )
            } else {
                format!(
                    "Worker không trả JSON hợp lệ: {}",
                    stderr.chars().take(480).collect::<String>()
                )
            }
        });
    if let Ok(connection) = state.database.lock() {
        let _ = audit_event(
            &connection,
            None,
            if succeeded {
                "llm.commandcode_probe_succeeded"
            } else {
                "llm.commandcode_probe_failed"
            },
            "llm",
            &request_id,
        );
    }
    Ok(CommandCodeProbeReport {
        status,
        http_status: payload
            .as_ref()
            .and_then(|value| value.get("httpStatus"))
            .and_then(Value::as_u64)
            .and_then(|value| u16::try_from(value).ok()),
        model: payload
            .as_ref()
            .map(|value| worker_string(value, "model", "ag/gemini-3.8-flash-medium"))
            .unwrap_or_else(|| "ag/gemini-3.8-flash-medium".to_string()),
        response_text: payload
            .as_ref()
            .and_then(|value| value.get("responseText"))
            .and_then(Value::as_str)
            .map(|value| value.chars().take(16_000).collect()),
        prompt_tokens: payload
            .as_ref()
            .and_then(|value| value.get("promptTokens"))
            .and_then(Value::as_u64),
        completion_tokens: payload
            .as_ref()
            .and_then(|value| value.get("completionTokens"))
            .and_then(Value::as_u64),
        total_tokens: payload
            .as_ref()
            .and_then(|value| value.get("totalTokens"))
            .and_then(Value::as_u64),
        network_calls_made: payload
            .as_ref()
            .map(|value| worker_bool(value, "networkCallsMade"))
            .unwrap_or(false),
        cost_status: payload
            .as_ref()
            .map(|value| worker_string(value, "costStatus", "unknown"))
            .unwrap_or_else(|| "unknown".to_string()),
        process_started: true,
        external_side_effect_unknown: process.external_side_effect_unknown,
        message,
    })
}

#[tauri::command]
async fn run_blender_fixture(
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
    let working_directory = fixture_directory
        .strip_prefix(&workspace_root)
        .map_err(|_| "Blender fixture working directory vượt project workspace".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
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
async fn run_true3d_fixture(
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
async fn run_true3d_multishot_fixture(
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
async fn run_asset_pipeline_check(
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
async fn run_comfyui_image_generation(
    request: ComfyUiImageGenerationRequest,
    state: State<'_, AppState>,
) -> Result<ComfyUiImageGenerationReport, String> {
    valid_text(&request.project_id, "Project ID")?;
    if request.tasks.is_empty() || request.tasks.len() > 32 {
        return Err("ComfyUI image job cần từ 1 đến 32 task theo shot".to_string());
    }
    for task in &request.tasks {
        if !safe_preview_id(&task.asset_id) {
            return Err(format!("Asset ID ComfyUI không hợp lệ: {}", task.asset_id));
        }
        if !task.shot_id.chars().all(|character| {
            character.is_ascii_uppercase()
                || character.is_ascii_digit()
                || matches!(character, '-' | '_')
        }) || task.shot_id.trim().is_empty()
        {
            return Err(format!("Shot ID ComfyUI không hợp lệ: {}", task.shot_id));
        }
        validate_asset_rights(task.rights_status.trim())?;
        if !matches!(
            task.role.trim(),
            "identity" | "composition" | "pose" | "camera" | "style" | "environment" | "prop"
        ) {
            return Err(format!("Vai trò ảnh ComfyUI không hợp lệ: {}", task.role));
        }
        validate_asset_text(&task.title, "Tên ảnh ComfyUI", 160)?;
        valid_text(&task.prompt, "Prompt ảnh ComfyUI")?;
        if task.prompt.chars().count() > 12_000
            || task.negative_prompt.chars().count() > 8_000
            || preview_secret_like(&task.prompt)
            || preview_secret_like(&task.negative_prompt)
        {
            return Err("Prompt ComfyUI vượt giới hạn hoặc có dấu hiệu secret".to_string());
        }
        for dimension in [task.width, task.height].into_iter().flatten() {
            if !(64..=4096).contains(&dimension) {
                return Err("Kích thước ảnh ComfyUI phải nằm trong 64..4096".to_string());
            }
        }
    }
    for (key, path) in &request.bindings {
        if !matches!(
            key.as_str(),
            "positivePrompt" | "negativePrompt" | "seed" | "width" | "height"
        ) || !safe_preview_relative_path(path)
        {
            return Err(format!("Binding ComfyUI không được allowlist: {key}"));
        }
    }
    let (workspace_root, python_path, endpoint, workflow_path) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        ensure_project_exists(&connection, request.project_id.trim())?;
        let workspace_root = project_workspace_root(&connection, request.project_id.trim())?;
        let endpoint = request
            .endpoint
            .clone()
            .unwrap_or_else(provider_config::image_endpoint);
        let (endpoint, _) = parse_loopback_endpoint(&endpoint)?;
        let workflow_path = request
            .workflow_path
            .clone()
            .unwrap_or_else(provider_config::image_workflow_path);
        if !safe_preview_relative_path(&workflow_path) {
            return Err("ComfyUI workflow path phải là đường dẫn tương đối an toàn".to_string());
        }
        let workflow = fs::canonicalize(workspace_root.join(workflow_path.replace('/', "\\")))
            .map_err(|error| format!("Không đọc được ComfyUI workflow: {error}"))?;
        if !workflow.starts_with(&workspace_root) || !workflow.is_file() {
            return Err("ComfyUI workflow phải nằm trong project workspace và là file".to_string());
        }
        let python_path = resolve_configured_tool(&connection, "python")?;
        (workspace_root, python_path, endpoint, workflow)
    };
    let run_id = now_id("comfyui-image");
    let output_dir = workspace_root
        .join(".auto3dvideo")
        .join("runs")
        .join(&run_id)
        .join("comfyui-images");
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Không tạo được ComfyUI image output directory: {error}"))?;
    let spec_path = output_dir.join("comfyui-image-job.json");
    let worker_path = output_dir.join("comfyui_image_worker.py");
    let relative = |path: &Path| -> Result<String, String> {
        path.strip_prefix(&workspace_root)
            .map_err(|_| "ComfyUI output vượt project workspace".to_string())
            .map(|value| value.to_string_lossy().replace('\\', "/"))
    };
    let workflow_relative = relative(&workflow_path)?;
    let output_relative = relative(&output_dir)?;
    let spec_relative = relative(&spec_path)?;
    let worker_relative = relative(&worker_path)?;
    let report_relative = relative(&output_dir.join("comfyui-image-report.json"))?;
    let spec = serde_json::json!({
        "schemaVersion": "1.0.0",
        "jobType": "image.generate",
        "projectId": request.project_id.trim(),
        "runId": run_id,
        "endpoint": endpoint,
        "workflowPath": workflow_relative,
        "bindings": request.bindings,
        "timeoutSeconds": request.timeout_seconds.unwrap_or(600).clamp(1, 3600),
        "pollIntervalSeconds": 1.0,
        "tasks": request.tasks.clone(),
    });
    fs::write(
        &spec_path,
        serde_json::to_vec_pretty(&spec).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Không ghi được ComfyUI image job spec: {error}"))?;
    fs::write(&worker_path, COMFYUI_IMAGE_WORKER_SCRIPT)
        .map_err(|error| format!("Không ghi được ComfyUI image worker: {error}"))?;
    let process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "python".to_string(),
            args: vec![
                worker_relative,
                "--workspace".to_string(),
                workspace_root.to_string_lossy().to_string(),
                "--spec".to_string(),
                spec_relative,
                "--output-dir".to_string(),
                output_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: Default::default(),
            timeout_seconds: request.timeout_seconds.unwrap_or(600).clamp(1, 3600),
            expected_outputs: vec![report_relative.clone()],
        },
        executable_path: python_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    if !process.succeeded {
        return Err(format!(
            "ComfyUI image worker thất bại (exit={:?}, timeout={}): {}",
            process.exit_code,
            process.timed_out,
            process.stderr.chars().take(700).collect::<String>()
        ));
    }
    let report_path = workspace_root.join(&report_relative);
    let raw_report: Value = serde_json::from_str(
        &fs::read_to_string(&report_path)
            .map_err(|error| format!("Không đọc được ComfyUI image report: {error}"))?,
    )
    .map_err(|error| format!("ComfyUI image report không hợp lệ: {error}"))?;
    let task_lookup = request
        .tasks
        .iter()
        .map(|task| {
            (
                task.asset_id.clone(),
                (
                    task.shot_id.clone(),
                    task.role.clone(),
                    task.rights_status.clone(),
                ),
            )
        })
        .collect::<HashMap<_, _>>();
    let mut generated_assets = Vec::new();
    let outputs = raw_report
        .get("outputs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for output in outputs {
        if output.get("status").and_then(Value::as_str) != Some("ready") {
            continue;
        }
        let asset_id = output
            .get("assetId")
            .and_then(Value::as_str)
            .ok_or_else(|| "ComfyUI output thiếu assetId".to_string())?;
        let relative_path = output
            .get("relativePath")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("ComfyUI output {asset_id} thiếu relativePath"))?;
        if !safe_preview_relative_path(relative_path) {
            return Err(format!(
                "ComfyUI output path không an toàn: {relative_path}"
            ));
        }
        let source = fs::canonicalize(workspace_root.join(relative_path.replace('/', "\\")))
            .map_err(|error| format!("Không đọc được ảnh ComfyUI {asset_id}: {error}"))?;
        if !source.starts_with(&workspace_root) || !source.is_file() {
            return Err(format!(
                "Ảnh ComfyUI {asset_id} vượt workspace hoặc không tồn tại"
            ));
        }
        let (shot_id, role, rights_status) = task_lookup
            .get(asset_id)
            .cloned()
            .ok_or_else(|| format!("ComfyUI output không khớp task: {asset_id}"))?;
        let imported = import_asset_with_state(
            AssetImportInput {
                project_id: request.project_id.trim().to_string(),
                source_path: source.to_string_lossy().to_string(),
                title: output
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or(asset_id)
                    .to_string(),
                media_kind: "image".to_string(),
                source_uri: Some(format!("local://comfyui/{run_id}/{asset_id}")),
                tags: vec![
                    "comfyui-generated".to_string(),
                    format!("shot-{}", shot_id.to_ascii_lowercase()),
                    format!("role-{role}"),
                ],
                note: "Ảnh reference do ComfyUI local tạo; rights và chất lượng cần human review trước khi bind/render final.".to_string(),
                rights_status,
            },
            &state,
        )?;
        generated_assets.push(imported);
    }
    let task_count = request.tasks.len();
    let ready_count = generated_assets.len();
    let failed_count = task_count.saturating_sub(ready_count);
    let status = raw_report
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or(if failed_count == 0 {
            "succeeded_needs_review"
        } else {
            "blocked"
        })
        .to_string();
    let report = ComfyUiImageGenerationReport {
        run_id: run_id.clone(),
        status: status.clone(),
        report_path: report_relative,
        output_directory: output_relative,
        generated_assets,
        task_count,
        ready_count,
        failed_count,
        process,
        message: if failed_count == 0 {
            "Đã tạo và nhập ảnh reference từ ComfyUI; asset đang giữ rights pending, cần review trước binding final.".to_string()
        } else {
            "ComfyUI chỉ hoàn thành một phần task; shot lỗi bị giữ blocked và không coi là video đã sẵn sàng.".to_string()
        },
    };
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database để ghi audit".to_string())?;
    audit_event(
        &connection,
        Some(request.project_id.trim()),
        "comfyui.image_generation.completed",
        "comfyui_image_run",
        &run_id,
    )?;
    Ok(report)
}

#[tauri::command]
async fn run_nanobanana_image_generation(
    request: NanoBananaImageGenerationRequest,
    state: State<'_, AppState>,
) -> Result<NanoBananaImageGenerationReport, String> {
    if !state.cloud_generation_enabled.load(Ordering::Acquire) {
        return Err(
            "Cloud/API đang tắt. Hãy bấm ‘Bật Cloud/API’ trước khi gọi Nano Banana MCP; app chưa tiêu credit."
                .to_string(),
        );
    }
    valid_text(&request.project_id, "Project ID")?;
    if request.tasks.is_empty() || request.tasks.len() > 32 {
        return Err("Nano Banana image job cần từ 1 đến 32 task theo shot".to_string());
    }
    let tool_name = request
        .tool_name
        .clone()
        .unwrap_or_else(provider_config::nanobanana_tool_name);
    if tool_name != "generate_image" {
        return Err("Nano Banana MCP hiện chỉ allowlist tool generate_image".to_string());
    }
    let model = request
        .model
        .clone()
        .unwrap_or_else(provider_config::nanobanana_model);
    valid_text(&model, "Nano Banana model")?;
    if model.chars().count() > 120 || preview_secret_like(&model) {
        return Err("Nano Banana model không hợp lệ hoặc có dấu hiệu secret".to_string());
    }
    for task in &request.tasks {
        if !safe_preview_id(&task.asset_id) {
            return Err(format!(
                "Asset ID Nano Banana không hợp lệ: {}",
                task.asset_id
            ));
        }
        if !task.shot_id.chars().all(|character| {
            character.is_ascii_uppercase()
                || character.is_ascii_digit()
                || matches!(character, '-' | '_')
        }) || task.shot_id.trim().is_empty()
        {
            return Err(format!(
                "Shot ID Nano Banana không hợp lệ: {}",
                task.shot_id
            ));
        }
        validate_asset_rights(task.rights_status.trim())?;
        if !matches!(
            task.role.trim(),
            "identity" | "composition" | "pose" | "camera" | "style" | "environment" | "prop"
        ) {
            return Err(format!(
                "Vai trò ảnh Nano Banana không hợp lệ: {}",
                task.role
            ));
        }
        validate_asset_text(&task.title, "Tên ảnh Nano Banana", 160)?;
        valid_text(&task.prompt, "Prompt ảnh Nano Banana")?;
        if task.prompt.chars().count() > 12_000
            || task.negative_prompt.chars().count() > 8_000
            || preview_secret_like(&task.prompt)
            || preview_secret_like(&task.negative_prompt)
        {
            return Err("Prompt Nano Banana vượt giới hạn hoặc có dấu hiệu secret".to_string());
        }
        for dimension in [task.width, task.height].into_iter().flatten() {
            if !(64..=4096).contains(&dimension) {
                return Err("Kích thước ảnh Nano Banana phải nằm trong 64..4096".to_string());
            }
        }
        if task.reference_images.len() > 4
            || task
                .reference_images
                .iter()
                .any(|path| !safe_preview_relative_path(path))
        {
            return Err(format!(
                "Reference image của task {} phải là đường dẫn tương đối an toàn, tối đa 4 file",
                task.asset_id
            ));
        }
    }
    if browser_handoff::browseros_backend_enabled() {
        return Err(
            "Backend BrowserOS neo đang bật: legacy Nano Banana MCP batch/Chrome CDP đã bị khóa. Hãy dùng workflow Google Flow theo từng shot để nhập prompt, chờ output và tải từng asset; app không tự rơi về Chrome."
                .to_string(),
        );
    }
    let flow_cdp_url = request
        .flow_cdp_url
        .clone()
        .unwrap_or_else(provider_config::nanobanana_flow_cdp_url);
    let cdp_preflight = nanobanana_cdp_preflight(&flow_cdp_url);
    if cdp_preflight.status != "ready" {
        return Err(cdp_preflight.message.clone());
    }
    let (workspace_root, python_path, node_path, server_entry) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        ensure_project_exists(&connection, request.project_id.trim())?;
        let workspace_root = fs::canonicalize(project_workspace_root(
            &connection,
            request.project_id.trim(),
        )?)
        .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?;
        let python_path = resolve_configured_tool(&connection, "python")?;
        let node_path = resolve_configured_tool(&connection, "node")?;
        let configured_entry = request
            .server_entry
            .clone()
            .unwrap_or_else(provider_config::nanobanana_server_entry);
        let candidate = PathBuf::from(configured_entry.trim());
        if !candidate.is_absolute() {
            return Err("Nano Banana MCP server entry phải là đường dẫn tuyệt đối".to_string());
        }
        let server_entry = fs::canonicalize(&candidate)
            .map_err(|error| format!("Không tìm thấy Nano Banana MCP server entry: {error}"))?;
        if !server_entry.is_file()
            || !matches!(
                server_entry.extension().and_then(|value| value.to_str()),
                Some("js" | "mjs" | "cjs")
            )
        {
            return Err("Nano Banana MCP server entry phải là file .js/.mjs/.cjs".to_string());
        }
        (workspace_root, python_path, node_path, server_entry)
    };
    let run_id = if let Some(requested_run_id) = request.run_id.as_deref() {
        if !safe_preview_id(requested_run_id) {
            return Err("Nano Banana run ID không hợp lệ".to_string());
        }
        requested_run_id.to_string()
    } else {
        now_id("nanobanana-image")
    };
    let output_dir = workspace_root
        .join(".auto3dvideo")
        .join("runs")
        .join(&run_id)
        .join("nanobanana-images");
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Không tạo được Nano Banana image output directory: {error}"))?;
    let spec_path = output_dir.join("nanobanana-image-job.json");
    let worker_path = output_dir.join("nanobanana_mcp_worker.py");
    let relative = |path: &Path| -> Result<String, String> {
        path.strip_prefix(&workspace_root)
            .map_err(|_| "Nano Banana output vượt project workspace".to_string())
            .map(|value| value.to_string_lossy().replace('\\', "/"))
    };
    let output_relative = relative(&output_dir)?;
    let spec_relative = relative(&spec_path)?;
    let worker_relative = relative(&worker_path)?;
    let report_relative = relative(&output_dir.join("nanobanana-image-report.json"))?;
    let spec = serde_json::json!({
        "schemaVersion": "1.0.0",
        "jobType": "image.generate",
        "provider": "nano_banana_mcp",
        "mode": "flow_browser",
        "projectId": request.project_id.trim(),
        "runId": run_id,
        "serverEntry": server_entry.to_string_lossy().to_string(),
        "flowCdpUrl": flow_cdp_url,
        "toolName": tool_name,
        "model": model,
        "outputDirectory": output_relative,
        "timeoutSeconds": request.timeout_seconds.unwrap_or(900).clamp(30, 3600),
        "tasks": request.tasks.clone(),
    });
    fs::write(
        &spec_path,
        serde_json::to_vec_pretty(&spec).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Không ghi được Nano Banana image job spec: {error}"))?;
    fs::write(&worker_path, NANOBANANA_MCP_WORKER_SCRIPT)
        .map_err(|error| format!("Không ghi được Nano Banana MCP worker: {error}"))?;
    let process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "python".to_string(),
            args: vec![
                worker_relative,
                "--workspace".to_string(),
                workspace_root.to_string_lossy().to_string(),
                "--spec".to_string(),
                spec_relative,
                "--output-dir".to_string(),
                output_relative.clone(),
                "--node".to_string(),
                node_path.to_string_lossy().to_string(),
            ],
            working_directory: ".".to_string(),
            environment: Default::default(),
            timeout_seconds: request.timeout_seconds.unwrap_or(900).clamp(30, 3600),
            expected_outputs: vec![report_relative.clone()],
        },
        executable_path: python_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    if !process.succeeded {
        return Err(format!(
            "Nano Banana MCP worker thất bại (exit={:?}, timeout={}): {}",
            process.exit_code,
            process.timed_out,
            process.stderr.chars().take(900).collect::<String>()
        ));
    }
    let report_path = workspace_root.join(&report_relative);
    let raw_report: Value = serde_json::from_str(
        &fs::read_to_string(&report_path)
            .map_err(|error| format!("Không đọc được Nano Banana image report: {error}"))?,
    )
    .map_err(|error| format!("Nano Banana image report không hợp lệ: {error}"))?;
    let task_lookup = request
        .tasks
        .iter()
        .map(|task| {
            (
                task.asset_id.clone(),
                (
                    task.shot_id.clone(),
                    task.role.clone(),
                    task.rights_status.clone(),
                ),
            )
        })
        .collect::<HashMap<_, _>>();
    let mut generated_assets = Vec::new();
    let outputs = raw_report
        .get("outputs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for output in outputs {
        if output.get("status").and_then(Value::as_str) != Some("ready") {
            continue;
        }
        let asset_id = output
            .get("assetId")
            .and_then(Value::as_str)
            .ok_or_else(|| "Nano Banana output thiếu assetId".to_string())?;
        let relative_path = output
            .get("relativePath")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("Nano Banana output {asset_id} thiếu relativePath"))?;
        if !safe_preview_relative_path(relative_path) {
            return Err(format!(
                "Nano Banana output path không an toàn: {relative_path}"
            ));
        }
        let source = fs::canonicalize(workspace_root.join(relative_path.replace('/', "\\")))
            .map_err(|error| format!("Không đọc được ảnh Nano Banana {asset_id}: {error}"))?;
        if !source.starts_with(&workspace_root) || !source.is_file() {
            return Err(format!(
                "Ảnh Nano Banana {asset_id} vượt workspace hoặc không tồn tại"
            ));
        }
        let (shot_id, role, rights_status) = task_lookup
            .get(asset_id)
            .cloned()
            .ok_or_else(|| format!("Nano Banana output không khớp task: {asset_id}"))?;
        let imported = import_asset_with_state(
            AssetImportInput {
                project_id: request.project_id.trim().to_string(),
                source_path: source.to_string_lossy().to_string(),
                title: output
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or(asset_id)
                    .to_string(),
                media_kind: "image".to_string(),
                source_uri: Some(format!("local://nano-banana-mcp/{run_id}/{asset_id}")),
                tags: vec![
                    "nano-banana-generated".to_string(),
                    format!("shot-{}", shot_id.to_ascii_lowercase()),
                    format!("role-{role}"),
                ],
                note: "Ảnh reference do Nano Banana MCP tạo qua Google Flow; rights và chất lượng cần human review trước khi bind/render final.".to_string(),
                rights_status,
            },
            &state,
        )?;
        generated_assets.push(imported);
    }
    let task_count = request.tasks.len();
    let ready_count = generated_assets.len();
    let failed_count = task_count.saturating_sub(ready_count);
    let status = raw_report
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or(if failed_count == 0 {
            "succeeded_needs_review"
        } else {
            "blocked"
        })
        .to_string();
    let (failure_code, failure_detail) = classify_nanobanana_report(&raw_report);
    let message = match failure_code.as_deref() {
        Some("MCP_INITIALIZE_TIMEOUT") => format!(
            "Nano Banana MCP initialize timeout: {}. Chrome CDP 9222 đã qua preflight nhưng MCP không hoàn tất initialize; BrowserMCP 9009 không thay thế được CDP này.",
            failure_detail
                .as_deref()
                .unwrap_or("worker không trả chi tiết")
        ),
        Some(code) => format!(
            "Nano Banana MCP thất bại ({code}): {}",
            failure_detail
                .as_deref()
                .unwrap_or("worker không trả chi tiết")
        ),
        None if failed_count == 0 => {
            "Đã tạo và nhập ảnh reference từ Nano Banana MCP qua Google Flow; asset đang giữ rights pending, cần review trước binding final.".to_string()
        }
        None => {
            "Nano Banana MCP chỉ hoàn thành một phần task; shot lỗi bị giữ blocked và không coi là video đã sẵn sàng.".to_string()
        }
    };
    let report = NanoBananaImageGenerationReport {
        run_id: run_id.clone(),
        status: status.clone(),
        report_path: report_relative,
        output_directory: output_relative,
        generated_assets,
        task_count,
        ready_count,
        failed_count,
        process,
        message,
        failure_code,
        failure_detail,
        cdp_preflight: Some(cdp_preflight),
    };
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database để ghi audit".to_string())?;
    audit_event(
        &connection,
        Some(request.project_id.trim()),
        "nano_banana.image_generation.completed",
        "nano_banana_image_run",
        &run_id,
    )?;
    Ok(report)
}

#[tauri::command]
fn read_nanobanana_image_progress(
    request: NanoBananaProgressRequest,
    state: State<'_, AppState>,
) -> Result<NanoBananaProgressReport, String> {
    valid_text(&request.project_id, "Project ID")?;
    if !safe_preview_id(&request.run_id) {
        return Err("Nano Banana run ID không hợp lệ".to_string());
    }
    let workspace_root = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        ensure_project_exists(&connection, request.project_id.trim())?;
        project_workspace_root(&connection, request.project_id.trim())?
    };
    let relative_path = format!(
        ".auto3dvideo/runs/{}/nanobanana-images/nanobanana-progress.jsonl",
        request.run_id
    );
    let progress_path = workspace_root.join(relative_path.replace('/', "\\"));
    if !progress_path.is_file() {
        return Ok(NanoBananaProgressReport {
            run_id: request.run_id,
            exists: false,
            progress_path: relative_path,
            events: Vec::new(),
        });
    }
    let raw = fs::read_to_string(&progress_path)
        .map_err(|error| format!("Không đọc được Nano Banana progress log: {error}"))?;
    let mut events = raw
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect::<Vec<_>>();
    if events.len() > 160 {
        events.drain(0..events.len() - 160);
    }
    Ok(NanoBananaProgressReport {
        run_id: request.run_id,
        exists: true,
        progress_path: relative_path,
        events,
    })
}

#[tauri::command]
async fn build_blender_shot_preview(
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
fn list_shot_approvals(
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
fn set_shot_approval(
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

fn local_tool_probe_args(tool_id: &str) -> Result<Vec<String>, String> {
    match tool_id {
        "ffmpeg" | "ffprobe" | "blender" | "python" | "yt-dlp" | "obscura" => {
            Ok(vec!["--version".to_string()])
        }
        _ => Err(format!("Tool {tool_id} chưa có probe adapter an toàn")),
    }
}

#[tauri::command]
async fn probe_local_tool(
    project_id: String,
    tool_id: String,
    state: State<'_, AppState>,
) -> Result<LocalToolProbeReport, String> {
    valid_text(&project_id, "Project ID")?;
    validate_tool_id(&tool_id)?;
    let (workspace_root, executable_path) = {
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
        let executable_path = resolve_configured_tool(&connection, tool_id.trim())?;
        (PathBuf::from(workspace_root), executable_path)
    };
    let workspace_root = fs::canonicalize(&workspace_root)
        .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?;
    let spec = ProcessSpec {
        executable_id: tool_id.trim().to_string(),
        args: local_tool_probe_args(tool_id.trim())?,
        working_directory: ".".to_string(),
        environment: Default::default(),
        timeout_seconds: 20,
        expected_outputs: Vec::new(),
    };
    let result = run_external_process(ExternalProcessRequest {
        spec,
        executable_path: executable_path.clone(),
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root,
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    let version = bounded_failure_message(&format!("{}{}", result.stdout, result.stderr));
    Ok(LocalToolProbeReport {
        tool_id: tool_id.trim().to_string(),
        executable_path: executable_path.to_string_lossy().to_string(),
        status: if result.succeeded {
            "ready".to_string()
        } else if result.timed_out {
            "timeout".to_string()
        } else {
            "failed".to_string()
        },
        exit_code: result.exit_code,
        version,
        stdout_bytes: result.stdout_bytes,
        stderr_bytes: result.stderr_bytes,
        process_started: true,
        external_side_effect_unknown: result.external_side_effect_unknown,
    })
}

fn parse_loopback_endpoint(endpoint: &str) -> Result<(String, SocketAddr), String> {
    let without_scheme = endpoint
        .trim()
        .strip_prefix("http://")
        .ok_or_else(|| "ComfyUI endpoint chỉ cho phép http:// loopback".to_string())?;
    let authority = without_scheme.trim_end_matches('/');
    if authority.contains('/')
        || authority.contains('@')
        || authority.contains('?')
        || authority.contains('#')
    {
        return Err("ComfyUI endpoint không được có path, auth hoặc query".to_string());
    }
    let (host, port_text) = authority
        .rsplit_once(':')
        .ok_or_else(|| "ComfyUI endpoint phải có host:port".to_string())?;
    if !matches!(host, "127.0.0.1" | "localhost" | "::1") {
        return Err("ComfyUI chỉ cho phép loopback 127.0.0.1, localhost hoặc ::1".to_string());
    }
    let port = port_text
        .parse::<u16>()
        .map_err(|_| "ComfyUI port không hợp lệ".to_string())?;
    if port == 0 {
        return Err("ComfyUI port không được là 0".to_string());
    }
    let address = (host, port)
        .to_socket_addrs()
        .map_err(|_| "Không resolve được ComfyUI loopback".to_string())?
        .find(|candidate| candidate.ip().is_loopback())
        .ok_or_else(|| "ComfyUI endpoint không resolve thành loopback".to_string())?;
    Ok((format!("http://{host}:{port}"), address))
}

fn parse_nanobanana_cdp_endpoint(endpoint: &str) -> Result<(String, SocketAddr), String> {
    let trimmed = endpoint.trim();
    let without_scheme = trimmed
        .strip_prefix("http://")
        .ok_or_else(|| "Nano Banana Flow CDP chỉ cho phép http:// loopback".to_string())?;
    let authority = without_scheme.trim_end_matches('/');
    if authority.contains('/')
        || authority.contains('@')
        || authority.contains('?')
        || authority.contains('#')
    {
        return Err("Nano Banana Flow CDP không được có path, auth hoặc query".to_string());
    }
    let (host, port_text) = authority
        .rsplit_once(':')
        .ok_or_else(|| "Nano Banana Flow CDP phải có host:port".to_string())?;
    if !matches!(host, "127.0.0.1" | "localhost") {
        return Err("Nano Banana Flow CDP chỉ cho phép 127.0.0.1 hoặc localhost".to_string());
    }
    let port = port_text
        .parse::<u16>()
        .map_err(|_| "Nano Banana Flow CDP port không hợp lệ".to_string())?;
    if port == 0 {
        return Err("Nano Banana Flow CDP port không được là 0".to_string());
    }
    let address = (host, port)
        .to_socket_addrs()
        .map_err(|_| "Không resolve được Nano Banana Flow CDP loopback".to_string())?
        .find(|candidate| candidate.ip().is_loopback())
        .ok_or_else(|| "Nano Banana Flow CDP không resolve thành loopback".to_string())?;
    Ok((format!("http://{host}:{port}"), address))
}

fn validate_nanobanana_cdp_url(endpoint: &str) -> Result<(), String> {
    parse_nanobanana_cdp_endpoint(endpoint).map(|_| ())
}

fn resolve_chrome_executable() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    // Chrome branded builds stopped honoring --load-extension. Prefer the
    // portable Chrome for Testing binary when the app has provisioned it;
    // it supports the local Flow group controller without touching the
    // user's normal Chrome profile.
    candidates.push(PathBuf::from(
        r"D:\Auto3DvideoTools\chrome-for-testing\chrome-win64\chrome.exe",
    ));
    candidates.push(PathBuf::from(
        r"D:\Auto3DvideoTools\chrome-for-testing\chrome.exe",
    ));
    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        candidates.push(PathBuf::from(program_files).join(r"Google\Chrome\Application\chrome.exe"));
    }
    if let Some(program_files_x86) = std::env::var_os("ProgramFiles(x86)") {
        candidates
            .push(PathBuf::from(program_files_x86).join(r"Google\Chrome\Application\chrome.exe"));
    }
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        candidates
            .push(PathBuf::from(local_app_data).join(r"Google\Chrome\Application\chrome.exe"));
    }
    candidates.into_iter().find_map(|candidate| {
        if !candidate.is_file() {
            return None;
        }
        fs::canonicalize(candidate).ok()
    })
}

fn chrome_cdp_profile_directory() -> Result<PathBuf, String> {
    let portable_root = PathBuf::from(r"D:\Auto3DvideoTools");
    let profile = if portable_root.is_dir() {
        // Keep Chrome's unpacked extension files on a normal local directory.
        // Some Windows profiles mark AppData descendants as EFS-encrypted, and
        // Chrome then fails to unpack Web Store extensions into its temp dir.
        portable_root.join("chrome-flow-cdp-profile")
    } else {
        let local_app_data = std::env::var_os("LOCALAPPDATA").ok_or_else(|| {
            "Windows chưa có LOCALAPPDATA để tạo Chrome profile riêng".to_string()
        })?;
        PathBuf::from(local_app_data)
            .join("Auto3Dvideo")
            .join("chrome-flow-cdp-profile")
    };
    fs::create_dir_all(&profile)
        .map_err(|error| format!("Không tạo được Chrome profile riêng: {error}"))?;
    Ok(profile)
}

const CHROME_FLOW_GROUP_NAME: &str = "Auto3Dvideo · GOOGLE FLOW · AUTO";

fn chrome_flow_controller_directory(profile_directory: &Path) -> Result<PathBuf, String> {
    let directory = profile_directory
        .parent()
        .unwrap_or(profile_directory)
        .join("Auto3DvideoFlowController");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Không tạo được Chrome Flow group controller: {error}"))?;
    fs::write(
        directory.join("manifest.json"),
        CHROME_FLOW_CONTROLLER_MANIFEST.as_bytes(),
    )
    .map_err(|error| format!("Không ghi được manifest Chrome Flow group controller: {error}"))?;
    fs::write(
        directory.join("service_worker.js"),
        CHROME_FLOW_CONTROLLER_SERVICE_WORKER.as_bytes(),
    )
    .map_err(|error| {
        format!("Không ghi được service worker Chrome Flow group controller: {error}")
    })?;
    Ok(directory)
}

fn browser_mcp_extension_directory() -> Option<PathBuf> {
    let directory = PathBuf::from(r"D:\Auto3DvideoTools\browser-mcp-extension\unpacked");
    directory
        .join("manifest.json")
        .is_file()
        .then_some(directory)
}

fn spawn_chrome_cdp(
    chrome_path: &Path,
    profile_directory: &Path,
    controller_directory: &Path,
    port: u16,
) -> Result<(), String> {
    let mut command = Command::new(chrome_path);
    let mut extension_directories = vec![controller_directory.to_string_lossy().to_string()];
    if let Some(browser_mcp_directory) = browser_mcp_extension_directory() {
        extension_directories.push(browser_mcp_directory.to_string_lossy().to_string());
    }
    command
        .args([
            "--new-window",
            "--no-first-run",
            "--no-default-browser-check",
            "--remote-debugging-address=127.0.0.1",
        ])
        .arg(format!("--remote-debugging-port={port}"))
        .arg(format!(
            "--user-data-dir={}",
            profile_directory.to_string_lossy()
        ))
        .arg(format!(
            "--load-extension={}",
            extension_directories.join(",")
        ))
        .arg("https://flow.google.com/")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Không mở được Chrome Flow với CDP {port}: {error}"))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChromeCdpTarget {
    id: String,
    #[serde(rename = "type")]
    target_type: String,
    url: String,
    #[allow(dead_code)]
    title: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChromeFlowTargetSelection {
    target_count: usize,
    selected_url: Option<String>,
}

fn chrome_cdp_http_json(endpoint: &str, path: &str) -> Result<Value, String> {
    if !path.starts_with('/') || path.contains('\r') || path.contains('\n') {
        return Err("Chrome CDP path không hợp lệ".to_string());
    }
    let (_, address) = parse_nanobanana_cdp_endpoint(endpoint)?;
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(1500))
        .map_err(|error| format!("Không kết nối được Chrome CDP: {error}"))?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(1500)));
    let request = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("Không gửi được Chrome CDP request: {error}"))?;
    let mut response = Vec::with_capacity(16 * 1024);
    let mut buffer = [0_u8; 4096];
    while response.len() < 256 * 1024 {
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => response.extend_from_slice(&buffer[..read]),
            Err(_) => break,
        }
    }
    let response_text = String::from_utf8_lossy(&response);
    let (headers, body) = response_text
        .split_once("\r\n\r\n")
        .ok_or_else(|| "Chrome CDP trả response không hợp lệ".to_string())?;
    let status = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse::<u16>().ok());
    if status != Some(200) {
        return Err(format!(
            "Chrome CDP trả HTTP {} cho {path}",
            status
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unknown".to_string())
        ));
    }
    serde_json::from_str(body.trim())
        .map_err(|error| format!("Chrome CDP JSON không hợp lệ: {error}"))
}

fn chrome_flow_target_is_allowed(url: &str) -> bool {
    let Some(authority) = url
        .strip_prefix("https://")
        .and_then(|value| value.split('/').next())
    else {
        return false;
    };
    matches!(authority, "flow.google.com" | "labs.google")
}

fn select_chrome_flow_target(endpoint: &str) -> Result<ChromeFlowTargetSelection, String> {
    let raw = chrome_cdp_http_json(endpoint, "/json/list")?;
    let targets: Vec<ChromeCdpTarget> = serde_json::from_value(raw)
        .map_err(|error| format!("Chrome CDP target list không hợp lệ: {error}"))?;
    let mut flow_targets = targets
        .into_iter()
        .filter(|target| target.target_type == "page" && chrome_flow_target_is_allowed(&target.url))
        .collect::<Vec<_>>();
    flow_targets.sort_by_key(|target| {
        if target.url.contains("/project/") {
            0_u8
        } else {
            1_u8
        }
    });
    let selected = flow_targets.first();
    let selected_url = selected.map(|target| target.url.clone());
    if let Some(target) = selected {
        if target
            .id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        {
            let _ = chrome_cdp_http_json(endpoint, &format!("/json/activate/{}", target.id));
        }
    }
    Ok(ChromeFlowTargetSelection {
        target_count: flow_targets.len(),
        selected_url,
    })
}

fn chrome_flow_controller_is_loaded(endpoint: &str) -> bool {
    let Ok(raw) = chrome_cdp_http_json(endpoint, "/json/list") else {
        return false;
    };
    let Ok(targets) = serde_json::from_value::<Vec<ChromeCdpTarget>>(raw) else {
        return false;
    };
    targets.iter().any(|target| {
        target.target_type == "service_worker" && target.url.ends_with("/service_worker.js")
    })
}

fn chrome_flow_controller_message(
    controller_loaded: bool,
    browser_path: Option<&Path>,
    profile_directory: &Path,
) -> String {
    if controller_loaded {
        return "Chrome Flow CDP đã sẵn sàng; controller đã chạy và group Auto3Dvideo đã được giữ."
            .to_string();
    }
    let using_chrome_for_testing = browser_path
        .map(|path| {
            path.to_string_lossy()
                .to_ascii_lowercase()
                .contains("chrome-for-testing")
        })
        .unwrap_or(false);
    if !using_chrome_for_testing {
        return format!(
            "Chrome CDP đã sẵn sàng nhưng Chrome branded không nạp controller local qua --load-extension; chưa tạo group. Đóng cửa sổ Auto rồi mở lại bằng Chrome for Testing, hoặc nạp thư mục controller một lần tại chrome://extensions. Profile: {}",
            profile_directory.display()
        );
    }
    "Chrome for Testing đã mở nhưng controller chưa đăng ký service worker; chưa tạo group. Đóng cửa sổ Auto, kiểm tra thư mục controller rồi mở lại; app chưa gọi Generate và chưa tiêu credit.".to_string()
}

#[tauri::command]
async fn ensure_chrome_cdp_session() -> Result<ChromeCdpLaunchReport, String> {
    let endpoint = provider_config::nanobanana_flow_cdp_url();
    let (_, address) = parse_nanobanana_cdp_endpoint(&endpoint)?;
    let normalized_endpoint = format!("http://127.0.0.1:{}", address.port());
    let profile_directory = chrome_cdp_profile_directory()?;
    let controller_directory = chrome_flow_controller_directory(&profile_directory)?;
    let controller_marker = controller_directory.join("loaded.marker");
    let profile_was_initialized = profile_directory
        .join("Default")
        .join("Preferences")
        .is_file();
    let existing = nanobanana_cdp_preflight(&normalized_endpoint);
    if existing.status == "ready" {
        let selection =
            select_chrome_flow_target(&normalized_endpoint).unwrap_or(ChromeFlowTargetSelection {
                target_count: 0,
                selected_url: None,
            });
        // A MV3 service worker can be dormant and therefore absent from
        // /json/list even while the already-verified unpacked controller is
        // installed and its group is still present.
        let controller_loaded =
            controller_marker.is_file() || chrome_flow_controller_is_loaded(&normalized_endpoint);
        return Ok(ChromeCdpLaunchReport {
            endpoint: normalized_endpoint,
            status: "ready".to_string(),
            browser_path: None,
            profile_directory: profile_directory.to_string_lossy().to_string(),
            launched: false,
            needs_login: false,
            flow_group_name: CHROME_FLOW_GROUP_NAME.to_string(),
            flow_group_controller_loaded: controller_loaded,
            flow_target_count: selection.target_count,
            selected_flow_url: selection.selected_url,
            message: chrome_flow_controller_message(controller_loaded, None, &profile_directory),
        });
    }
    let chrome_path = resolve_chrome_executable().ok_or_else(|| {
        "Không tìm thấy Google Chrome. Cài Chrome rồi bấm Tự làm toàn bộ lại; app chưa gọi Nano Banana và chưa tiêu credit.".to_string()
    })?;
    spawn_chrome_cdp(
        &chrome_path,
        &profile_directory,
        &controller_directory,
        address.port(),
    )?;
    for _ in 0..20 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let current = nanobanana_cdp_preflight(&normalized_endpoint);
        if current.status == "ready" {
            let selection = select_chrome_flow_target(&normalized_endpoint).unwrap_or(
                ChromeFlowTargetSelection {
                    target_count: 0,
                    selected_url: None,
                },
            );
            let controller_loaded = chrome_flow_controller_is_loaded(&normalized_endpoint);
            if controller_loaded {
                fs::write(&controller_marker, b"loaded\n").map_err(|error| {
                    format!("Không ghi được trạng thái group controller: {error}")
                })?;
            } else {
                let _ = fs::remove_file(&controller_marker);
            }
            return Ok(ChromeCdpLaunchReport {
                endpoint: normalized_endpoint,
                status: "ready_needs_login_check".to_string(),
                browser_path: Some(chrome_path.to_string_lossy().to_string()),
                profile_directory: profile_directory.to_string_lossy().to_string(),
                launched: true,
                needs_login: !profile_was_initialized,
                flow_group_name: CHROME_FLOW_GROUP_NAME.to_string(),
                flow_group_controller_loaded: controller_loaded,
                flow_target_count: selection.target_count,
                selected_flow_url: selection.selected_url,
                message: if controller_loaded {
                    if profile_was_initialized {
                        "Đã tự mở Chrome Flow bằng profile Auto3Dvideo; controller đã chạy, group đã được tạo và tab Flow đã được focus.".to_string()
                    } else {
                        "Đã tự mở Chrome Flow bằng profile Auto3Dvideo và tạo group tự động. Profile mới cần đăng nhập Google Flow một lần; app không đọc cookie/token và chưa tự tiêu credit.".to_string()
                    }
                } else {
                    chrome_flow_controller_message(false, Some(&chrome_path), &profile_directory)
                },
            });
        }
    }
    Err(format!(
        "Đã mở Chrome nhưng CDP chưa phản hồi tại {normalized_endpoint}. Có thể Chrome đang chạy profile khác hoặc bị firewall chặn; chưa spawn Nano Banana worker và chưa tiêu credit."
    ))
}

fn validate_google_flow_project_url_for_dom(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 500
        || value.contains(['\0', '\r', '\n', '\t', ' ', '@', '?', '#'])
        || !value.starts_with("https://flow.google.com/project/")
    {
        return Err("Google Flow project URL không hợp lệ".to_string());
    }
    let project_part = value
        .strip_prefix("https://flow.google.com/project/")
        .and_then(|rest| rest.split('/').next())
        .filter(|project| !project.is_empty())
        .ok_or_else(|| "Google Flow project URL thiếu project id".to_string())?;
    if !project_part
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("Google Flow project id trong URL không hợp lệ".to_string());
    }
    Ok(format!("https://flow.google.com/project/{project_part}"))
}

fn validate_google_flow_dom_prompt(value: &str) -> Result<String, String> {
    let normalized = value.replace("\r\n", "\n").replace('\r', "\n");
    let prompt = normalized.trim();
    if prompt.is_empty() || prompt.chars().count() > 12_000 || prompt.contains('\0') {
        return Err("Prompt Google Flow không hợp lệ".to_string());
    }
    let lower = prompt.to_ascii_lowercase();
    for marker in [
        "api_key=",
        "apikey=",
        "access_token=",
        "authorization=",
        "bearer ",
        "client_secret=",
        "password=",
        "secret=",
        "token=",
    ] {
        if lower.contains(marker) {
            return Err("Prompt Google Flow có dấu hiệu credential".to_string());
        }
    }
    Ok(prompt.to_string())
}

struct BrowserOsFlowExecution {
    raw_report: Value,
    report_relative: String,
    process: ExternalProcessResult,
}

fn browseros_flow_operation_for_dom_mode(mode: &str) -> Result<&'static str, String> {
    match mode {
        "inspect_composer" => Ok("flow_inspect_composer"),
        "inspect_output" => Ok("flow_inspect_output"),
        "select_image_model" => Ok("flow_select_model"),
        "click_image_batch" => Ok("flow_download_image"),
        other => Err(format!("BrowserOS Flow DOM mode không được phép: {other}")),
    }
}

fn browseros_flow_operation_for_action(mode: &str) -> Result<&'static str, String> {
    match mode {
        "observe" => Ok("flow_observe"),
        "type_prompt" => Ok("flow_type_prompt"),
        "click_generate" => Ok("flow_click_generate"),
        "download_image" => Ok("flow_download_image"),
        "animate_image" => Ok("flow_animate_image"),
        other => Err(format!("BrowserOS Flow action không được phép: {other}")),
    }
}

fn browseros_download_filename(shot_id: &str, revision_id: Option<&str>, extension: &str) -> String {
    let clean = |value: &str| {
        value
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                    character
                } else {
                    '_'
                }
            })
            .take(72)
            .collect::<String>()
    };
    let revision = revision_id.map(clean).unwrap_or_else(|| "rev-001".to_string());
    format!("flow-{}-{}{}", clean(shot_id), revision, extension)
}

fn copy_browseros_flow_download(
    workspace: &Path,
    raw_report: &Value,
    shot_id: &str,
    revision_id: Option<&str>,
) -> Result<Value, String> {
    let source_value = raw_report
        .get("downloadPath")
        .and_then(Value::as_str)
        .ok_or_else(|| "BrowserOS báo download nhưng thiếu downloadPath".to_string())?;
    let source = fs::canonicalize(source_value)
        .map_err(|error| format!("Không mở được BrowserOS download: {error}"))?;
    if !source.starts_with(workspace) || !source.is_file() {
        return Err("BrowserOS download vượt project workspace hoặc không phải file".to_string());
    }
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .filter(|value| matches!(value.to_ascii_lowercase().as_str(), ".png" | ".jpg" | ".jpeg" | ".webp"))
        .ok_or_else(|| "BrowserOS download không phải PNG/JPEG/WebP".to_string())?;
    let downloads = browser_handoff::browser_downloads_directory()?;
    let mut destination = downloads.join(browseros_download_filename(shot_id, revision_id, &extension));
    for index in 1..100_u32 {
        if !destination.exists() {
            break;
        }
        destination = downloads.join(format!(
            "{}-{index}{extension}",
            browseros_download_filename(shot_id, revision_id, "")
        ));
    }
    if source != destination {
        fs::copy(&source, &destination)
            .map_err(|error| format!("Không copy được BrowserOS download vào Downloads: {error}"))?;
    }
    let size = fs::metadata(&destination)
        .map_err(|error| format!("Không đọc được BrowserOS download sau khi copy: {error}"))?
        .len();
    if size == 0 {
        return Err("BrowserOS download sau khi copy bị rỗng".to_string());
    }
    let mut updated = raw_report.clone();
    let object = updated
        .as_object_mut()
        .ok_or_else(|| "BrowserOS Flow report phải là object".to_string())?;
    object.insert(
        "downloadName".to_string(),
        Value::String(
            destination
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("flow-image.png")
                .to_string(),
        ),
    );
    object.insert("downloadSizeBytes".to_string(), Value::from(size));
    object.insert(
        "downloadRelativePath".to_string(),
        Value::String(
            destination
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("flow-image.png")
                .to_string(),
        ),
    );
    Ok(updated)
}

async fn run_browseros_flow_operation(
    project_id: &str,
    operation: &str,
    project_url: &str,
    prompt: Option<&str>,
    shot_id: Option<&str>,
    revision_id: Option<&str>,
    run_id: Option<&str>,
    media_id: Option<&str>,
    state: State<'_, AppState>,
) -> Result<BrowserOsFlowExecution, String> {
    if !browser_handoff::browseros_backend_enabled() {
        return Err("BrowserOS Flow operation được gọi khi backend BrowserOS đang tắt".to_string());
    }
    let execution_run_id = run_id
        .map(|value| validate_google_flow_batch_identity(value, "runId"))
        .transpose()?
        .unwrap_or_else(|| now_id("flow-browseros"));
    let (workspace_root, node_path) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        ensure_project_exists(&connection, project_id)?;
        (
            fs::canonicalize(project_workspace_root(&connection, project_id)?)
                .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?,
            resolve_configured_tool(&connection, "node")?,
        )
    };
    let output_dir = workspace_root
        .join(".auto3dvideo")
        .join("runs")
        .join(&execution_run_id)
        .join("browseros-flow")
        .join("downloads");
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Không tạo được BrowserOS Flow output directory: {error}"))?;
    let worker_path = workspace_root
        .join(".auto3dvideo")
        .join("tools")
        .join("browseros_flow_worker.mjs");
    browser_handoff::sync_embedded_worker(
        &worker_path,
        BROWSEROS_FLOW_WORKER_SCRIPT,
        "BrowserOS Flow worker",
    )?;
    let relative = |path: &Path| -> Result<String, String> {
        path.strip_prefix(&workspace_root)
            .map_err(|_| "BrowserOS Flow output vượt project workspace".to_string())
            .map(|value| value.to_string_lossy().replace('\\', "/"))
    };
    let operation_safe = if !operation.is_empty()
        && operation.len() <= 64
        && operation.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '-' | '_')
        })
    {
        operation
    } else {
        return Err("BrowserOS Flow operation không hợp lệ".to_string());
    };
    let report_path = workspace_root
        .join(".auto3dvideo")
        .join("runs")
        .join(&execution_run_id)
        .join("browseros-flow")
        .join(format!("{}-{}.json", operation_safe, now_id("report")));
    let worker_relative = relative(&worker_path)?;
    let report_relative = relative(&report_path)?;
    let output_relative = relative(&output_dir)?;
    let prompt_relative = if let Some(prompt) = prompt {
        let prompt_path = output_dir.join("flow-prompt.txt");
        fs::write(&prompt_path, prompt.as_bytes())
            .map_err(|error| format!("Không ghi được prompt Google Flow: {error}"))?;
        Some(relative(&prompt_path)?)
    } else {
        None
    };
    let mut args = vec![
        worker_relative,
        "--operation".to_string(),
        operation.to_string(),
        "--project-url".to_string(),
        project_url.to_string(),
        "--output".to_string(),
        report_relative.clone(),
        "--output-dir".to_string(),
        output_relative,
        "--run-id".to_string(),
        execution_run_id.clone(),
    ];
    if let Some(prompt_file) = prompt_relative.as_deref() {
        args.push("--prompt-file".to_string());
        args.push(prompt_file.to_string());
    }
    for (flag, value) in [
        ("--shot-id", shot_id),
        ("--revision-id", revision_id),
        ("--media-id", media_id),
    ] {
        if let Some(value) = value {
            args.push(flag.to_string());
            args.push(value.to_string());
        }
    }
    let process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "node".to_string(),
            args,
            working_directory: ".".to_string(),
            environment: Default::default(),
            timeout_seconds: if operation_safe == "flow_download_image" { 120 } else { 90 },
            expected_outputs: vec![report_relative.clone()],
        },
        executable_path: node_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    let report_value = fs::read_to_string(&report_path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or_else(|| serde_json::json!({
            "status": "failed",
            "message": process.stderr.chars().take(900).collect::<String>(),
        }));
    let report_value = if operation_safe == "flow_download_image"
        && report_value.get("status").and_then(Value::as_str) == Some("ready")
    {
        copy_browseros_flow_download(
            &workspace_root,
            &report_value,
            shot_id.unwrap_or("shot"),
            revision_id,
        )?
    } else {
        report_value
    };
    fs::write(
        &report_path,
        serde_json::to_vec_pretty(&report_value)
            .map_err(|error| format!("Không serialize được BrowserOS Flow report: {error}"))?,
    )
    .map_err(|error| format!("Không cập nhật được BrowserOS Flow report: {error}"))?;
    Ok(BrowserOsFlowExecution {
        raw_report: report_value,
        report_relative,
        process,
    })
}

const PREVIEW_DISCOVERY_PLATFORMS: [&str; 9] = [
    "tiktok",
    "douyin",
    "kuaishou",
    "xiaohongshu",
    "bilibili",
    "xigua",
    "huoshan",
    "weishi",
    "haokan",
];

const OBSCURA_PREVIEW_EVAL: &str = r###"(()=>{const c=(v,n=240)=>String(v??"").replace(/\s+/g," ").trim().slice(0,n);const h=location.hostname.toLowerCase().replace(/^www\./,"");const p=location.pathname.toLowerCase();const video=p.includes("/video/")||p.includes("/item/")||p.includes("/note/")||p.includes("/watch/")||p.includes("/play/")||p.includes("/short-video/")||p.includes("/photo/")||/^\/(?:av|bv)[a-z0-9]/.test(p)||/^\/explore\/[^/]+/.test(p)||/^\/detail\/[^/]+/.test(p)||/^\/[^/]*\d{6,}[^/]*$/.test(p);const text=(e)=>c(e?.innerText||e?.textContent||"",900);const cards=[...document.querySelectorAll("a[href]")].map(a=>{let u;try{u=new URL(a.href,location.href)}catch{return null}const same=u.protocol==="https:"&&u.hostname.toLowerCase().replace(/^www\./,"")===h;if(!same)return null;const root=a.closest("article,li,[class*='card'],[class*='item']")||a.parentElement||a;const body=text(root);const lower=body.toLowerCase();const title=c(a.getAttribute("aria-label")||a.title||root.querySelector("h1,h2,h3,h4,[class*='title']")?.textContent||body,240);const img=root.querySelector("img");const thumb=c(img?.currentSrc||img?.src||img?.getAttribute("data-src")||"",2000);const author=c(root.querySelector("[class*='author'],[class*='user'],[class*='name']")?.textContent||"",120);const observedSignals=[];if(/hot|trending|popular|featured|nổi bật|thịnh hành|热门|爆款|推荐/.test(lower))observedSignals.push("hot");if(/rising|tăng nhanh|đang tăng|上升|热度/.test(lower))observedSignals.push("rising");const freshSignal=/just now|\b\d+\s*(?:m|min|h|hr|hour|d|day)s?\b|vừa đăng|hôm nay|mới đăng|刚刚|今天|分钟|小时/.test(lower);const observedMetrics={};if(/like|thích|喜欢|comment|bình luận|评论|share|chia sẻ|分享|view|lượt xem|播放/.test(lower)&&/\d/.test(lower))observedMetrics.engagement=true;return {shareUrl:u.href,title,author,thumbnailUrl:thumb,timeText:c(body.match(/(?:just now|\d+\s*(?:m|min|h|hr|hour|d|day)s?|vừa đăng|hôm nay|mới đăng|刚刚|今天|分钟|小时)/i)?.[0]||"",80),observedSignals,freshSignal,observedMetrics}}).filter(x=>x&&x.shareUrl);return JSON.stringify({sourceUrl:location.href,pageTitle:c(document.title,160),pageRoute:video,cards})})()"###;

fn preview_discovery_url(platform: &str) -> Option<&'static str> {
    match platform {
        "tiktok" => Some("https://www.tiktok.com/explore"),
        "douyin" => Some("https://www.douyin.com/discover"),
        "kuaishou" => Some("https://www.kuaishou.com/hot"),
        "xiaohongshu" => Some("https://www.xiaohongshu.com/explore"),
        "bilibili" => Some("https://www.bilibili.com/v/popular/all"),
        "xigua" => Some("https://www.ixigua.com/channel/"),
        "huoshan" => Some("https://www.huoshan.com/"),
        "weishi" => Some("https://weishi.qq.com/"),
        "haokan" => Some("https://haokan.baidu.com/"),
        _ => None,
    }
}

fn preview_host_matches_platform(host: &str, platform: &str) -> bool {
    let host = host.strip_prefix("www.").unwrap_or(host);
    match platform {
        "tiktok" => host == "tiktok.com" || host.ends_with(".tiktok.com"),
        "douyin" => {
            host == "douyin.com"
                || host.ends_with(".douyin.com")
                || host == "iesdouyin.com"
                || host.ends_with(".iesdouyin.com")
        }
        "kuaishou" => host == "kuaishou.com" || host.ends_with(".kuaishou.com"),
        "xiaohongshu" => host == "xiaohongshu.com" || host.ends_with(".xiaohongshu.com"),
        "bilibili" => host == "bilibili.com" || host.ends_with(".bilibili.com"),
        "xigua" => {
            host == "ixigua.com"
                || host.ends_with(".ixigua.com")
                || host == "xigua.com"
                || host.ends_with(".xigua.com")
        }
        "huoshan" => host == "huoshan.com" || host.ends_with(".huoshan.com"),
        "weishi" => host == "weishi.qq.com" || host.ends_with(".weishi.qq.com"),
        "haokan" => host == "haokan.baidu.com" || host.ends_with(".haokan.baidu.com"),
        _ => false,
    }
}

fn preview_path_looks_like_video(value: &str, platform: &str) -> bool {
    let path = value
        .strip_prefix("https://")
        .and_then(|rest| rest.split_once('/').map(|(_, path)| path))
        .unwrap_or_default()
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let path = format!("/{path}");
    match platform {
        "tiktok" => {
            path.split('/').any(|part| part.len() >= 6 && part.chars().all(|c| c.is_ascii_digit()))
                && (path.contains("/@") && path.contains("/video/") || path.starts_with("/video/"))
        }
        "douyin" => path.split('/').any(|part| {
            part.len() >= 6 && part.chars().all(|c| c.is_ascii_digit())
        }) && (path.starts_with("/video/") || path.starts_with("/note/")),
        "kuaishou" => ["/short-video/", "/photo/"]
            .iter()
            .any(|prefix| {
                path.strip_prefix(prefix).is_some_and(|rest| {
                    rest.len() >= 6 && rest.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
                })
            }),
        "xiaohongshu" => ["/explore/", "/discovery/item/"]
            .iter()
            .any(|prefix| {
                path.strip_prefix(prefix).is_some_and(|rest| {
                    rest.len() >= 12 && rest.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
                })
            }),
        "bilibili" => path
            .strip_prefix("/video/")
            .is_some_and(|rest| {
                (rest.starts_with("bv") && rest.len() >= 8)
                    || (rest.starts_with("av") && rest[2..].chars().take_while(|c| c.is_ascii_digit()).count() >= 6)
            })
            || path.split('/').any(|part| {
                (part.starts_with("bv") && part.len() >= 8)
                    || (part.starts_with("av") && part[2..].chars().take_while(|c| c.is_ascii_digit()).count() >= 6)
            }),
        "xigua" => path.starts_with("/video/") && path
            .strip_prefix("/video/")
            .is_some_and(|rest| rest.len() >= 6 && rest.chars().all(|c| c.is_ascii_digit()))
            || path.strip_prefix("/i").is_some_and(|rest| {
                rest.len() >= 6 && rest.chars().all(|c| c.is_ascii_digit())
            }),
        "huoshan" => path.starts_with("/video/") && path
            .strip_prefix("/video/")
            .is_some_and(|rest| rest.len() >= 6 && rest.chars().all(|c| c.is_ascii_digit())),
        "weishi" => ["/video/", "/detail/"]
            .iter()
            .any(|prefix| path.strip_prefix(prefix).is_some_and(|rest| rest.len() >= 8)),
        "haokan" => ["/v/", "/video/"]
            .iter()
            .any(|prefix| path.strip_prefix(prefix).is_some_and(|rest| rest.len() >= 8)),
        _ => false,
    }
}

fn obscura_canonical_video_url(value: &str, platform: &str) -> Option<String> {
    let candidate = value
        .trim()
        .split(['?', '#'])
        .next()
        .unwrap_or_default();
    if !preview_path_looks_like_video(candidate, platform) {
        return None;
    }
    let host = validate_reference_video_source_url(candidate).ok()?;
    if !preview_host_matches_platform(&host, platform) {
        return None;
    }
    Some(candidate.to_string())
}

fn obscura_safe_thumbnail_url(value: &str) -> Option<String> {
    let candidate = value.trim().split(['?', '#']).next().unwrap_or_default();
    if candidate.len() > 2000 || !candidate.starts_with("https://") || preview_secret_like(candidate) {
        return None;
    }
    let authority = candidate["https://".len()..]
        .split('/')
        .next()
        .unwrap_or_default();
    if authority.is_empty() || authority.contains('@') {
        return None;
    }
    Some(candidate.to_string())
}

fn obscura_string_field(object: &serde_json::Map<String, Value>, keys: &[&str], limit: usize) -> String {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str))
        .map(|value| {
            value
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(limit)
                .collect()
        })
        .unwrap_or_default()
}

fn obscura_string_array(object: &serde_json::Map<String, Value>, keys: &[&str]) -> Vec<String> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_array))
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(|value| value.chars().take(80).collect::<String>())
                .filter(|value| !value.trim().is_empty())
                .take(12)
                .collect()
        })
        .unwrap_or_default()
}

fn obscura_source_url(object: &serde_json::Map<String, Value>) -> Option<String> {
    ["sourceUrl", "pageUrl", "requestUrl", "location", "url"]
        .iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| value.starts_with("https://"))
        .map(str::to_string)
}

fn collect_obscura_records(
    value: &Value,
    inherited_source_url: Option<&str>,
    records: &mut Vec<(Option<String>, Value)>,
    depth: usize,
) {
    if depth > 6 || records.len() >= 4_000 {
        return;
    }
    match value {
        Value::String(text) if text.trim_start().starts_with(['{', '[']) => {
            if let Ok(parsed) = serde_json::from_str::<Value>(text) {
                collect_obscura_records(&parsed, inherited_source_url, records, depth + 1);
            }
        }
        Value::Array(values) => {
            for child in values {
                collect_obscura_records(child, inherited_source_url, records, depth + 1);
            }
        }
        Value::Object(object) => {
            let source_url = obscura_source_url(object).or_else(|| inherited_source_url.map(str::to_string));
            if let Some(cards) = object.get("cards").and_then(Value::as_array) {
                for card in cards {
                    if card.is_object() {
                        records.push((source_url.clone(), card.clone()));
                    }
                }
                for (key, child) in object {
                    if key != "cards" {
                        collect_obscura_records(child, source_url.as_deref(), records, depth + 1);
                    }
                }
                return;
            }
            let looks_like_card = object.contains_key("shareUrl")
                || object.contains_key("videoUrl")
                || (object.contains_key("href") && object.contains_key("title"));
            if looks_like_card {
                records.push((source_url.clone(), value.clone()));
            }
            for child in object.values() {
                collect_obscura_records(child, source_url.as_deref(), records, depth + 1);
            }
        }
        _ => {}
    }
}

fn parse_obscura_documents(stdout: &str) -> Vec<Value> {
    let mut documents = Vec::new();
    for line in stdout.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if let Ok(value) = serde_json::from_str::<Value>(line) {
            documents.push(value);
        }
    }
    if documents.is_empty() {
        if let Ok(value) = serde_json::from_str::<Value>(stdout.trim()) {
            documents.push(value);
        }
    }
    documents
}

#[derive(Debug, Clone)]
struct ObscuraPreviewCandidate {
    platform: String,
    title: String,
    author: String,
    share_url: String,
    thumbnail_url: Option<String>,
    fresh_signal: bool,
    observed_signals: Vec<String>,
    has_engagement_metadata: bool,
}

fn obscura_fresh_signal(candidate: &serde_json::Map<String, Value>) -> bool {
    if candidate
        .get("freshSignal")
        .or_else(|| candidate.get("fresh"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return true;
    }
    let time_text = obscura_string_field(candidate, &["timeText", "publishedAt", "date"], 80)
        .to_ascii_lowercase();
    [
        "just now",
        "vừa đăng",
        "hôm nay",
        "mới đăng",
        "刚刚",
        "今天",
        "分钟",
        "小时",
    ]
    .iter()
    .any(|signal| time_text.contains(signal))
        || time_text.split_whitespace().any(|token| {
            let number = token.chars().take_while(|character| character.is_ascii_digit()).count();
            number > 0 && token[number..].starts_with(['m', 'h', 'd'])
        })
}

fn obscura_normalize_key(value: &str) -> String {
    value.to_ascii_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn obscura_has_signal(signals: &[String], expected: &[&str]) -> bool {
    signals.iter().any(|signal| {
        let lower = signal.to_ascii_lowercase();
        expected.iter().any(|needle| lower.contains(needle))
    })
}

fn preview_topic_for_text(title: &str, author: &str) -> (&'static str, &'static str) {
    let text = format!("{title} {author}").to_ascii_lowercase();
    if ["how", "why", "science", "history", "fact", "knowledge", "giải thích", "kiến thức", "lịch sử", "vì sao", "bí mật"]
        .iter()
        .any(|needle| text.contains(needle))
    {
        return ("knowledge", "Có tín hiệu giải thích/kiến thức trong title hoặc author");
    }
    if ["story", "storytime", "documentary", "document", "câu chuyện", "tư liệu", "hành trình", "sự thật"]
        .iter()
        .any(|needle| text.contains(needle))
    {
        return ("story", "Có tín hiệu kể chuyện/tư liệu trong title hoặc author");
    }
    if ["nature", "ocean", "forest", "animal", "space", "earth", "thiên nhiên", "biển", "rừng", "động vật", "vũ trụ"]
        .iter()
        .any(|needle| text.contains(needle))
    {
        return ("nature", "Có tín hiệu thiên nhiên trong title hoặc author");
    }
    if ["tech", "robot", "machine", "ai", "computer", "công nghệ", "máy móc", "kỹ thuật"]
        .iter()
        .any(|needle| text.contains(needle))
    {
        return ("technology", "Có tín hiệu công nghệ trong title hoặc author");
    }
    if ["food", "travel", "home", "fashion", "beauty", "đời sống", "ẩm thực", "du lịch", "nhà cửa", "làm đẹp"]
        .iter()
        .any(|needle| text.contains(needle))
    {
        return ("lifestyle", "Có tín hiệu đời sống trong title hoặc author");
    }
    if ["music", "dance", "comedy", "funny", "movie", "game", "giải trí", "nhạc", "nhảy", "hài"]
        .iter()
        .any(|needle| text.contains(needle))
    {
        return ("entertainment", "Có tín hiệu giải trí trong title hoặc author");
    }
    if ["sport", "football", "soccer", "basketball", "thể thao", "bóng đá", "bóng rổ"]
        .iter()
        .any(|needle| text.contains(needle))
    {
        return ("sports", "Có tín hiệu thể thao trong title hoặc author");
    }
    ("other", "Chưa đủ tín hiệu title để phân loại chủ đề")
}

fn preview_social_potential_score(
    hot_new: bool,
    rising: bool,
    fresh: bool,
    low_clone: bool,
    has_engagement_metadata: bool,
) -> u32 {
    let mut score = 35;
    if hot_new {
        score += 20;
    }
    if rising {
        score += 20;
    }
    if fresh {
        score += 10;
    }
    if low_clone {
        score += 10;
    }
    if has_engagement_metadata {
        score += 5;
    }
    score.min(100)
}

fn obscura_tiktok_embed_url(share_url: &str, platform: &str) -> Option<String> {
    if platform != "tiktok" {
        return None;
    }
    let id = share_url
        .split("/video/")
        .nth(1)
        .and_then(|value| value.split('/').next())
        .filter(|value| !value.is_empty() && value.chars().all(|character| character.is_ascii_digit()))?;
    Some(format!("https://www.tiktok.com/player/v1/{id}"))
}

fn build_obscura_preview_report(
    stdout: &str,
    platforms: &[String],
    max_results: u32,
) -> Value {
    let documents = parse_obscura_documents(stdout);
    let mut records = Vec::new();
    for document in &documents {
        collect_obscura_records(document, None, &mut records, 0);
    }

    let mut candidates = Vec::new();
    let mut seen_urls = std::collections::HashSet::new();
    for (source_url, raw) in records {
        let Some(object) = raw.as_object() else { continue };
        let share_raw = obscura_string_field(object, &["shareUrl", "videoUrl", "href", "url"], 2000);
        let platform = platforms
            .iter()
            .find(|platform| {
                source_url
                    .as_deref()
                    .and_then(|value| validate_reference_video_source_url(value).ok())
                    .is_some_and(|host| preview_host_matches_platform(&host, platform))
                    || obscura_canonical_video_url(&share_raw, platform).is_some()
            })
            .cloned();
        let Some(platform) = platform else { continue };
        let Some(share_url) = obscura_canonical_video_url(&share_raw, &platform) else { continue };
        if !seen_urls.insert(share_url.clone()) {
            continue;
        }
        let title = obscura_string_field(object, &["title", "name", "description", "text"], 240);
        let author = obscura_string_field(object, &["author", "creator", "username", "user"], 120);
        let thumbnail_url = obscura_string_field(
            object,
            &["thumbnailUrl", "thumbnail", "imageUrl", "image", "cover", "poster"],
            2000,
        );
        let mut observed_signals = obscura_string_array(object, &["observedSignals", "signals"]);
        if observed_signals.is_empty() {
            observed_signals = obscura_string_array(object, &["rankingSignals"]);
        }
        let has_engagement_metadata = object
            .get("observedMetrics")
            .and_then(Value::as_object)
            .is_some_and(|metrics| !metrics.is_empty())
            || object.get("engagement").and_then(Value::as_bool).unwrap_or(false);
        candidates.push(ObscuraPreviewCandidate {
            platform,
            title: if title.is_empty() { "Video preview".to_string() } else { title },
            author: if author.is_empty() { "Không rõ tác giả".to_string() } else { author },
            share_url,
            thumbnail_url: obscura_safe_thumbnail_url(&thumbnail_url),
            fresh_signal: obscura_fresh_signal(object),
            observed_signals,
            has_engagement_metadata,
        });
    }

    let scanned_at = now_string();
    let mut cards = Vec::new();
    let mut platform_results = Vec::new();
    for platform in platforms {
        let mut platform_cards = candidates
            .iter()
            .filter(|candidate| &candidate.platform == platform)
            .take(max_results as usize)
            .cloned()
            .collect::<Vec<_>>();
        if platform_cards.is_empty() {
            platform_results.push(serde_json::json!({
                "platform": platform,
                "status": "blocked",
                "scannedCount": 0,
                "discoveryUrl": preview_discovery_url(platform).unwrap_or_default(),
                "message": "Obscura đã mở route public nhưng không đọc được card video hợp lệ; cần fixture/adapter mới hoặc người dùng kiểm tra trang này."
            }));
            continue;
        }
        let mut title_counts = HashMap::new();
        let mut thumbnail_counts = HashMap::new();
        for candidate in &platform_cards {
            *title_counts.entry(obscura_normalize_key(&candidate.title)).or_insert(0_u32) += 1;
            if let Some(thumbnail) = &candidate.thumbnail_url {
                *thumbnail_counts.entry(thumbnail.clone()).or_insert(0_u32) += 1;
            }
        }
        for candidate in platform_cards.drain(..) {
            let hot_new = obscura_has_signal(&candidate.observed_signals, &["hot", "trend", "popular", "featured", "nổi", "热门", "爆款", "推荐"]);
            let rising = obscura_has_signal(&candidate.observed_signals, &["rising", "tăng", "上升", "热度"])
                || (candidate.fresh_signal && candidate.has_engagement_metadata);
            let fresh = candidate.fresh_signal;
            let low_clone = title_counts.get(&obscura_normalize_key(&candidate.title)).copied().unwrap_or(2) == 1
                && candidate.thumbnail_url.as_ref().is_none_or(|thumbnail| thumbnail_counts.get(thumbnail).copied().unwrap_or(2) == 1);
            let mut buckets = Vec::new();
            let mut evidence = Vec::new();
            if hot_new {
                buckets.push("hot_new");
                evidence.push("DOM có tín hiệu hot/nổi bật được quan sát");
            }
            if rising {
                buckets.push("rising");
                evidence.push("DOM có tín hiệu tăng hoặc metadata tương tác đi cùng card mới");
            }
            if low_clone {
                buckets.push("low_clone");
                evidence.push("title/thumbnail không trùng trong lượt quét này; chỉ là heuristic");
            }
            if fresh {
                buckets.push("fresh");
                evidence.push("DOM có tín hiệu thời gian mới đăng");
            }
            if buckets.is_empty() {
                buckets.push("unranked");
                evidence.push("Chưa có metadata đủ tin cậy để xếp nhóm");
            }
            let (topic, topic_evidence) =
                preview_topic_for_text(&candidate.title, &candidate.author);
            let potential_score = preview_social_potential_score(
                hot_new,
                rising,
                fresh,
                low_clone,
                candidate.has_engagement_metadata,
            );
            if potential_score >= 60 {
                buckets.insert(0, "potential");
                evidence.insert(0, "điểm biên tập đủ cao để ưu tiên xem trước");
            }
            cards.push(serde_json::json!({
                "previewId": format!("preview-{}-{}", candidate.platform, preview_id_digest(&candidate.share_url)),
                "platform": candidate.platform,
                "title": candidate.title,
                "author": candidate.author,
                "shareUrl": candidate.share_url,
                "embedUrl": obscura_tiktok_embed_url(&candidate.share_url, platform),
                "thumbnailUrl": candidate.thumbnail_url,
                "scannedAt": scanned_at,
                "addedToPlan": false,
                "radarBuckets": buckets,
                "rankingEvidence": evidence.join("; "),
                "topic": topic,
                "topicEvidence": topic_evidence,
                "potentialScore": potential_score,
                "potentialEvidence": format!("{}; điểm dựa trên tín hiệu public trong lượt quét, không phải quyền sử dụng", evidence.join("; ")),
                "reuseStatus": "permission_required",
                "reuseEvidence": "URL public không chứng minh quyền sao chép hoặc đăng lại; cần giấy phép hoặc quyền sở hữu.",
                "reviewStatus": "unreviewed"
            }));
        }
        platform_results.push(serde_json::json!({
            "platform": platform,
            "status": "success",
            "scannedCount": cards.iter().filter(|card| card.get("platform").and_then(Value::as_str) == Some(platform)).count(),
            "discoveryUrl": preview_discovery_url(platform).unwrap_or_default(),
            "message": "Obscura đã trả card metadata từ route public; chưa tải video."
        }));
    }
    let successful_platforms = platform_results
        .iter()
        .filter(|result| result.get("status").and_then(Value::as_str) == Some("success"))
        .count();
    let status = if cards.is_empty() {
        "blocked"
    } else if successful_platforms == platforms.len() {
        "success"
    } else {
        "partial"
    };
    serde_json::json!({
        "status": status,
        "worker": "Obscura · public scrape · concurrency 3",
        "engine": "obscura_public_scrape",
        "scanMode": "discovery_all",
        "previewOnly": true,
        "platforms": platforms,
        "maxResults": max_results,
        "platformResults": platform_results,
        "cards": cards,
        "browserSessionAttached": false,
        "networkCallsMade": true,
        "message": if cards.is_empty() { "Obscura không trả card video hợp lệ; không ghi kết quả giả." } else { "Đã quét public bằng Obscura; hãy review card và quyền sử dụng trước khi tải." }
    })
}

fn parse_ytdlp_catalog_document(stdout: &str) -> Option<Value> {
    let trimmed = stdout.trim();
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        return Some(value);
    }
    stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .find_map(|line| serde_json::from_str::<Value>(line).ok())
}

fn ytdlp_entry_url(object: &serde_json::Map<String, Value>) -> Option<String> {
    ["webpage_url", "webpageUrl", "original_url", "originalUrl", "url"]
        .iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| value.starts_with("https://"))
        .map(str::to_string)
}

fn ytdlp_fresh_signal(object: &serde_json::Map<String, Value>) -> bool {
    let timestamp = object
        .get("timestamp")
        .and_then(Value::as_i64)
        .or_else(|| {
            object
                .get("release_timestamp")
                .and_then(Value::as_i64)
        });
    let Some(timestamp) = timestamp else { return false };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    timestamp >= now.saturating_sub(14 * 24 * 60 * 60) && timestamp <= now.saturating_add(300)
}

fn validate_preview_creator_source_url(value: &str, platform: &str) -> Result<String, String> {
    let source_url = value.trim();
    let host = validate_reference_video_source_url(source_url)?;
    if !preview_host_matches_platform(&host, platform) {
        return Err(format!(
            "URL nguồn không thuộc nền tảng đã chọn: {}",
            preview_platform_label(platform)
        ));
    }
    Ok(source_url.to_string())
}

fn preview_platform_label(platform: &str) -> &'static str {
    match platform {
        "tiktok" => "TikTok",
        "douyin" => "Douyin",
        "kuaishou" => "Kuaishou",
        "xiaohongshu" => "Xiaohongshu",
        "bilibili" => "Bilibili",
        "xigua" => "Xigua / 西瓜视频",
        "huoshan" => "Huoshan / 火山版",
        "weishi" => "Weishi / 微视",
        "haokan" => "Haokan / 好看视频",
        _ => "nền tảng đã chọn",
    }
}

fn build_ytdlp_creator_preview_report(
    stdout: &str,
    platform: &str,
    source_url: &str,
    max_results: u32,
) -> Value {
    let document = parse_ytdlp_catalog_document(stdout);
    let entry_values = document
        .as_ref()
        .and_then(|value| value.get("entries").and_then(Value::as_array))
        .or_else(|| document.as_ref().and_then(Value::as_array))
        .map(|entries| entries.iter().collect::<Vec<_>>())
        .unwrap_or_default();
    let scanned_at = now_string();
    let mut cards = Vec::new();
    let mut seen_urls = std::collections::HashSet::new();
    for entry in entry_values.into_iter().take(max_results as usize) {
        let Some(object) = entry.as_object() else { continue };
        let Some(raw_url) = ytdlp_entry_url(object) else { continue };
        let Some(share_url) = obscura_canonical_video_url(&raw_url, platform) else { continue };
        if !seen_urls.insert(share_url.clone()) {
            continue;
        }
        let title = obscura_string_field(
            object,
            &["title", "fulltitle", "description", "name"],
            240,
        );
        let author = obscura_string_field(
            object,
            &["uploader", "channel", "creator", "username", "uploader_id"],
            120,
        );
        let thumbnail_url = obscura_string_field(
            object,
            &["thumbnail", "thumbnail_url", "thumbnailUrl", "cover", "poster"],
            2000,
        );
        let fresh = ytdlp_fresh_signal(object);
        let (topic, topic_evidence) = preview_topic_for_text(
            if title.is_empty() { "Video preview" } else { title.as_str() },
            if author.is_empty() { "Không rõ tác giả" } else { author.as_str() },
        );
        let potential_score = preview_social_potential_score(false, false, fresh, false, false);
        let (radar_buckets, ranking_evidence) = if fresh {
            (
                vec!["fresh"],
                "Catalog có timestamp trong 14 ngày gần đây; chưa có dữ liệu view/like để xếp hot hoặc rising.",
            )
        } else {
            (
                vec!["unranked"],
                "yt-dlp catalog chỉ trả metadata URL; chưa có dữ liệu view/like và không suy diễn hot/rising.",
            )
        };
        cards.push(serde_json::json!({
            "previewId": format!("preview-{}-{}", platform, preview_id_digest(&share_url)),
            "platform": platform,
            "title": if title.is_empty() { "Video preview" } else { title.as_str() },
            "author": if author.is_empty() { "Không rõ tác giả" } else { author.as_str() },
            "shareUrl": share_url,
            "embedUrl": obscura_tiktok_embed_url(&raw_url, platform),
            "thumbnailUrl": obscura_safe_thumbnail_url(&thumbnail_url),
            "scannedAt": scanned_at.clone(),
            "addedToPlan": false,
            "radarBuckets": radar_buckets,
            "rankingEvidence": ranking_evidence,
            "topic": topic,
            "topicEvidence": topic_evidence,
            "potentialScore": potential_score,
            "potentialEvidence": "Chỉ có metadata catalog; chưa có dữ liệu tương tác để xác nhận độ hot hoặc tăng trưởng.",
            "reuseStatus": "permission_required",
            "reuseEvidence": "URL public không chứng minh quyền sao chép hoặc đăng lại; cần giấy phép hoặc quyền sở hữu.",
            "reviewStatus": "unreviewed"
        }));
    }
    let scanned_count = cards.len();
    let status = if scanned_count > 0 { "success" } else { "blocked" };
    serde_json::json!({
        "status": status,
        "worker": "yt-dlp · creator/playlist catalog",
        "engine": "yt_dlp_creator_catalog",
        "scanMode": "creator_catalog",
        "previewOnly": true,
        "platforms": [platform],
        "maxResults": max_results,
        "sourceUrl": source_url,
        "platformResults": [{
            "platform": platform,
            "status": status,
            "scannedCount": scanned_count,
            "discoveryUrl": source_url,
            "message": if scanned_count > 0 {
                "yt-dlp đã đọc catalog public của nguồn; chưa tải video và chưa có số liệu tương tác."
            } else {
                "Nguồn đã mở nhưng không trả URL video hợp lệ; có thể là trang yêu cầu đăng nhập, CAPTCHA hoặc extractor đã đổi."
            }
        }],
        "cards": cards,
        "browserSessionAttached": false,
        "networkCallsMade": true,
        "message": if scanned_count > 0 {
            format!("Đã nhận {scanned_count} card từ catalog public của nguồn; hãy review trước khi tải.")
        } else {
            "yt-dlp không trả card video hợp lệ; không ghi kết quả giả.".to_string()
        }
    })
}

fn preview_id_digest(value: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(value.as_bytes());
    let encoded = format!("{:x}", digest.finalize());
    encoded.chars().take(16).collect()
}

async fn run_obscura_preview_scan(
    platforms: &[String],
    max_results: u32,
    run_id: &str,
    workspace_root: &Path,
    obscura_path: PathBuf,
    report_path: &Path,
    report_relative: &str,
) -> Result<Value, String> {
    let mut args = vec!["scrape".to_string()];
    args.extend(
        platforms
            .iter()
            .filter_map(|platform| preview_discovery_url(platform))
            .map(str::to_string),
    );
    args.extend([
        "--concurrency".to_string(),
        "3".to_string(),
        "--eval".to_string(),
        OBSCURA_PREVIEW_EVAL.to_string(),
        "--format".to_string(),
        "json".to_string(),
        "--quiet".to_string(),
    ]);
    let process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "obscura".to_string(),
            args,
            working_directory: ".".to_string(),
            environment: Default::default(),
            timeout_seconds: 240,
            expected_outputs: Vec::new(),
        },
        executable_path: obscura_path,
        absolute_working_directory: workspace_root.to_path_buf(),
        output_root: workspace_root.to_path_buf(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    let mut report = build_obscura_preview_report(&process.stdout, platforms, max_results);
    let raw_status = report
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("blocked")
        .to_string();
    let status = if process.timed_out || process.cancelled || !process.succeeded {
        "failed"
    } else {
        raw_status.as_str()
    };
    let message = if process.timed_out {
        "Obscura hết thời gian 240 giây; process đã bị dừng, không coi là quét xong.".to_string()
    } else if process.cancelled {
        "Obscura đã bị hủy trước khi hoàn tất.".to_string()
    } else if !process.succeeded {
        "Obscura kết thúc không thành công; không coi là quét xong.".to_string()
    } else {
        report
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Obscura chưa trả thông báo kết quả hợp lệ.")
            .to_string()
    };
    let object = report
        .as_object_mut()
        .ok_or_else(|| "Obscura preview report phải là JSON object".to_string())?;
    object.insert("status".to_string(), Value::String(status.to_string()));
    object.insert("runId".to_string(), Value::String(run_id.to_string()));
    object.insert("reportPath".to_string(), Value::String(report_relative.to_string()));
    object.insert("obscuraOutputBytes".to_string(), Value::from(process.stdout_bytes));
    object.insert("message".to_string(), Value::String(message));
    let mut process_evidence = process.clone();
    process_evidence.stdout = format!(
        "Obscura stdout đã parse: {} byte; raw page output không ghi vào report.",
        process.stdout_bytes
    );
    object.insert(
        "process".to_string(),
        serde_json::to_value(process_evidence)
            .map_err(|error| format!("Không serialize được Obscura process evidence: {error}"))?,
    );
    let bytes = serde_json::to_vec_pretty(&report)
        .map_err(|error| format!("Không serialize được Obscura preview report: {error}"))?;
    if bytes.is_empty() {
        return Err("Obscura preview report rỗng".to_string());
    }
    fs::write(report_path, bytes)
        .map_err(|error| format!("Không ghi được Obscura preview report: {error}"))?;
    let report_size = fs::metadata(report_path)
        .map_err(|error| format!("Không xác nhận được Obscura preview report: {error}"))?
        .len();
    if report_size == 0 {
        return Err("Obscura preview report ghi ra nhưng có kích thước 0".to_string());
    }
    Ok(report)
}

fn preview_report_has_cards_for_platform(report: &Value, platform: &str) -> bool {
    report
        .get("cards")
        .and_then(Value::as_array)
        .is_some_and(|cards| {
            cards.iter().any(|card| {
                card.get("platform").and_then(Value::as_str) == Some(platform)
                    && card
                        .get("shareUrl")
                        .and_then(Value::as_str)
                        .is_some_and(|url| obscura_canonical_video_url(url, platform).is_some())
            })
        })
}

fn preview_report_card_count_for_platform(report: &Value, platform: &str) -> usize {
    report
        .get("cards")
        .and_then(Value::as_array)
        .map(|cards| {
            cards
                .iter()
                .filter(|card| {
                    card.get("platform").and_then(Value::as_str) == Some(platform)
                        && card
                            .get("shareUrl")
                            .and_then(Value::as_str)
                            .is_some_and(|url| obscura_canonical_video_url(url, platform).is_some())
                })
                .count()
        })
        .unwrap_or_default()
}

fn preview_report_refresh_status(report: &mut Value, platforms: &[String]) -> Result<(), String> {
    let card_count = platforms
        .iter()
        .map(|platform| preview_report_card_count_for_platform(report, platform))
        .sum::<usize>();
    let success_count = report
        .get("platformResults")
        .and_then(Value::as_array)
        .map(|results| {
            platforms
                .iter()
                .filter(|platform| {
                    results.iter().any(|result| {
                        result.get("platform").and_then(Value::as_str) == Some(platform.as_str())
                            && result.get("status").and_then(Value::as_str) == Some("success")
                    })
                })
                .count()
        })
        .unwrap_or_default();
    let object = report
        .as_object_mut()
        .ok_or_else(|| "Preview report phải là JSON object".to_string())?;
    let status = if card_count == 0 {
        "blocked"
    } else if success_count == platforms.len() {
        "success"
    } else {
        "partial"
    };
    object.insert("status".to_string(), Value::String(status.to_string()));
    Ok(())
}

fn merge_preview_platform_fallback(
    mut report: Value,
    fallback: &Value,
    fallback_platforms: &[String],
    browser_process: &ExternalProcessResult,
) -> Result<Value, String> {
    let all_platforms = report
        .get("platforms")
        .and_then(Value::as_array)
        .map(|platforms| {
            platforms
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| fallback_platforms.to_vec());
    {
        let object = report
            .as_object_mut()
            .ok_or_else(|| "Preview report phải là JSON object".to_string())?;
        let fallback_cards = fallback
            .get("cards")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let cards = object
            .entry("cards".to_string())
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .ok_or_else(|| "Preview report cards không phải array".to_string())?;
        let mut seen = cards
            .iter()
            .filter_map(|card| card.get("shareUrl").and_then(Value::as_str))
            .map(str::to_string)
            .collect::<std::collections::HashSet<_>>();
        for card in fallback_cards {
            let Some(platform) = card.get("platform").and_then(Value::as_str) else { continue };
            if !fallback_platforms.iter().any(|item| item == platform) {
                continue;
            }
            let Some(url) = card.get("shareUrl").and_then(Value::as_str) else { continue };
            if obscura_canonical_video_url(url, platform).is_some() && seen.insert(url.to_string()) {
                cards.push(card);
            }
        }
        let fallback_results = fallback
            .get("platformResults")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let results = object
            .entry("platformResults".to_string())
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .ok_or_else(|| "Preview report platformResults không phải array".to_string())?;
        for platform in fallback_platforms {
            let Some(fallback_result) = fallback_results.iter().find(|result| {
                result.get("platform").and_then(Value::as_str) == Some(platform.as_str())
            }) else { continue };
            if let Some(existing) = results.iter_mut().find(|result| {
                result.get("platform").and_then(Value::as_str) == Some(platform.as_str())
            }) {
                *existing = fallback_result.clone();
            } else {
                results.push(fallback_result.clone());
            }
        }
        let previous_reason = object
            .get("fallbackReason")
            .and_then(Value::as_str)
            .unwrap_or("Obscura không trả đủ card hợp lệ")
            .to_string();
        object.insert(
            "worker".to_string(),
            Value::String("Obscura + BrowserOS neo fallback theo nền tảng".to_string()),
        );
        object.insert(
            "engine".to_string(),
            Value::String("obscura_public_scrape+browseros_preview_scan".to_string()),
        );
        object.insert(
            "fallbackReason".to_string(),
            Value::String(format!(
                "{previous_reason}. BrowserOS neo đã được dùng 1 tab tuần tự cho nền tảng còn thiếu; không dùng stealth/proxy."
            )),
        );
        object.insert("browserSessionAttached".to_string(), Value::Bool(true));
        let mut process_evidence = browser_process.clone();
        process_evidence.stdout = format!(
            "BrowserOS stdout đã parse: {} byte; raw page output không ghi vào report.",
            browser_process.stdout_bytes
        );
        object.insert(
            "browserProcess".to_string(),
            serde_json::to_value(process_evidence)
                .map_err(|error| format!("Không serialize được BrowserOS process evidence: {error}"))?,
        );
    }
    preview_report_refresh_status(&mut report, &all_platforms)?;
    Ok(report)
}

fn preview_report_attach_public_catalog_attempt(
    report: &mut Value,
    status: &str,
    message: String,
    process: Option<&ExternalProcessResult>,
    output_path: Option<String>,
) {
    let Some(object) = report.as_object_mut() else { return };
    let mut attempt = serde_json::Map::new();
    attempt.insert("platform".to_string(), Value::String("bilibili".to_string()));
    attempt.insert("engine".to_string(), Value::String("bilibili_public_catalog".to_string()));
    attempt.insert("status".to_string(), Value::String(status.to_string()));
    attempt.insert("message".to_string(), Value::String(message.clone()));
    if let Some(path) = output_path {
        attempt.insert("reportPath".to_string(), Value::String(path));
    }
    if let Some(process) = process {
        let mut evidence = process.clone();
        evidence.stdout = format!(
            "Bilibili public catalog stdout đã parse: {} byte; raw response không ghi vào report.",
            process.stdout_bytes
        );
        if let Ok(value) = serde_json::to_value(evidence) {
            attempt.insert("process".to_string(), value);
        }
    }
    object.insert("publicCatalogAttempt".to_string(), Value::Object(attempt));
    if status != "success" {
        if let Some(results) = object.get_mut("platformResults").and_then(Value::as_array_mut) {
            if let Some(result) = results.iter_mut().find(|result| {
                result.get("platform").and_then(Value::as_str) == Some("bilibili")
            }) {
                let previous = result
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                result["message"] = Value::String(format!(
                    "{} Fallback catalog public: {}",
                    previous, message
                ));
            }
        }
    }
}

fn merge_bilibili_public_catalog(report: &mut Value, catalog: &Value) -> Result<usize, String> {
    let catalog_cards = catalog
        .get("cards")
        .and_then(Value::as_array)
        .ok_or_else(|| "Bilibili catalog report thiếu cards".to_string())?;
    let object = report
        .as_object_mut()
        .ok_or_else(|| "Preview report phải là JSON object".to_string())?;
    let (added, card_count) = {
        let cards = object
            .entry("cards".to_string())
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .ok_or_else(|| "Preview report cards không phải array".to_string())?;
        let mut seen = cards
            .iter()
            .filter_map(|card| card.get("shareUrl").and_then(Value::as_str))
            .map(str::to_string)
            .collect::<std::collections::HashSet<_>>();
        let mut added = 0_usize;
        for card in catalog_cards {
            let Some(url) = card.get("shareUrl").and_then(Value::as_str) else { continue };
            if card.get("platform").and_then(Value::as_str) != Some("bilibili")
                || obscura_canonical_video_url(url, "bilibili").is_none()
            {
                continue;
            }
            if seen.insert(url.to_string()) {
                cards.push(card.clone());
                added += 1;
            }
        }
        (added, cards.len())
    };
    let catalog_result = catalog
        .get("platformResults")
        .and_then(Value::as_array)
        .and_then(|results| results.first())
        .cloned();
    if let Some(catalog_result) = catalog_result {
        let results = object
            .entry("platformResults".to_string())
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .ok_or_else(|| "Preview report platformResults không phải array".to_string())?;
        if let Some(index) = results.iter().position(|result| {
            result.get("platform").and_then(Value::as_str) == Some("bilibili")
        }) {
            results[index] = catalog_result;
        } else {
            results.push(catalog_result);
        }
    }
    let platform_results = object
        .get("platformResults")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let success_count = platform_results
        .iter()
        .filter(|result| result.get("status").and_then(Value::as_str) == Some("success"))
        .count();
    let status = if card_count == 0 {
        "blocked"
    } else if success_count == platform_results.len() && !platform_results.is_empty() {
        "success"
    } else {
        "partial"
    };
    object.insert("status".to_string(), Value::String(status.to_string()));
    if added > 0 {
        let previous = object
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or_default();
        object.insert(
            "message".to_string(),
            Value::String(format!(
                "{} Đã bổ sung {} card từ Bilibili public catalog; hãy xem preview và review quyền trước khi tải.",
                previous.trim(),
                added
            )),
        );
        let worker = object
            .get("worker")
            .and_then(Value::as_str)
            .unwrap_or("Preview Radar");
        object.insert(
            "worker".to_string(),
            Value::String(format!("{} + Bilibili public catalog", worker)),
        );
        object.insert(
            "engine".to_string(),
            Value::String("preview_discovery+bilibili_public_catalog".to_string()),
        );
    }
    Ok(added)
}

async fn run_bilibili_public_catalog_fallback(
    mut report: Value,
    platforms: &[String],
    max_results: u32,
    run_id: &str,
    workspace_root: &Path,
    node_path: Option<&PathBuf>,
    worker_path: &Path,
    output_dir: &Path,
    final_report_path: &Path,
) -> Result<Value, String> {
    if !platforms.iter().any(|platform| platform == "bilibili")
        || preview_report_has_cards_for_platform(&report, "bilibili")
    {
        return Ok(report);
    }
    let Some(node_path) = node_path else {
        preview_report_attach_public_catalog_attempt(
            &mut report,
            "blocked",
            "Node chưa sẵn sàng để chạy Bilibili public catalog fallback.".to_string(),
            None,
            None,
        );
        return Ok(report);
    };
    let catalog_report_path = output_dir.join("bilibili-public-catalog-report.json");
    let catalog_worker_relative = worker_path
        .strip_prefix(workspace_root)
        .map_err(|_| "Bilibili catalog worker vượt project workspace".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let catalog_report_relative = catalog_report_path
        .strip_prefix(workspace_root)
        .map_err(|_| "Bilibili catalog report vượt project workspace".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "node".to_string(),
            args: vec![
                catalog_worker_relative,
                "--max-results".to_string(),
                max_results.to_string(),
                "--run-id".to_string(),
                run_id.to_string(),
                "--output".to_string(),
                catalog_report_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: Default::default(),
            timeout_seconds: 90,
            expected_outputs: vec![catalog_report_relative.clone()],
        },
        executable_path: node_path.clone(),
        absolute_working_directory: workspace_root.to_path_buf(),
        output_root: workspace_root.to_path_buf(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await;
    let process = match process {
        Ok(process) => process,
        Err(error) => {
            preview_report_attach_public_catalog_attempt(
                &mut report,
                "failed",
                format!("Không chạy được Bilibili public catalog: {}", error),
                None,
                Some(catalog_report_relative),
            );
            return Ok(report);
        }
    };
    let catalog = fs::read_to_string(&catalog_report_path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok());
    let Some(catalog) = catalog else {
        preview_report_attach_public_catalog_attempt(
            &mut report,
            "failed",
            "Bilibili public catalog không ghi được report hợp lệ.".to_string(),
            Some(&process),
            Some(catalog_report_relative),
        );
        return Ok(report);
    };
    let catalog_status = catalog
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("blocked");
    if catalog_status != "success" || !process.succeeded || process.timed_out || process.cancelled {
        let message = catalog
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Bilibili public catalog bị chặn hoặc không trả card.")
            .to_string();
        preview_report_attach_public_catalog_attempt(
            &mut report,
            if process.timed_out || process.cancelled || !process.succeeded {
                "failed"
            } else {
                "blocked"
            },
            message,
            Some(&process),
            Some(catalog_report_relative),
        );
        return Ok(report);
    }
    let added = merge_bilibili_public_catalog(&mut report, &catalog)?;
    let mut process_evidence = process.clone();
    process_evidence.stdout = format!(
        "Bilibili public catalog stdout đã parse: {} byte; raw response không ghi vào report.",
        process.stdout_bytes
    );
    preview_report_attach_public_catalog_attempt(
        &mut report,
        "success",
        format!("Bilibili public catalog bổ sung {} card hợp lệ.", added),
        Some(&process_evidence),
        Some(catalog_report_relative),
    );
    if let Some(object) = report.as_object_mut() {
        object.insert(
            "reportPath".to_string(),
            Value::String(
                final_report_path
                    .strip_prefix(workspace_root)
                    .map_err(|_| "Preview report vượt project workspace".to_string())?
                    .to_string_lossy()
                    .replace('\\', "/"),
            ),
        );
    }
    Ok(report)
}

#[tauri::command]
async fn scan_preview_discovery(
    request: PreviewDiscoveryScanRequest,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    valid_text(&request.project_id, "Project ID")?;
    if request.platforms.is_empty() || request.platforms.len() > PREVIEW_DISCOVERY_PLATFORMS.len() {
        return Err("Phải chọn từ 1 đến 9 nền tảng preview".to_string());
    }
    if !(1..=200).contains(&request.max_results) {
        return Err("Số video mỗi nền tảng phải nằm trong khoảng 1..200".to_string());
    }
    let project_id = request.project_id.trim().to_string();
    let mut platforms = Vec::with_capacity(request.platforms.len());
    let mut seen = std::collections::HashSet::new();
    for platform in &request.platforms {
        let normalized = platform.trim().to_ascii_lowercase();
        if !PREVIEW_DISCOVERY_PLATFORMS.contains(&normalized.as_str()) {
            return Err(format!("Nền tảng preview chưa được allowlist: {normalized}"));
        }
        if !seen.insert(normalized.clone()) {
            return Err(format!("Nền tảng preview bị lặp: {normalized}"));
        }
        platforms.push(normalized);
    }

    let (workspace_root, obscura_path, obscura_error, node_path) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        ensure_project_exists(&connection, &project_id)?;
        let workspace_root = fs::canonicalize(project_workspace_root(&connection, &project_id)?)
            .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?;
        let configured_obscura: Option<String> = connection
            .query_row(
                "SELECT executable_ref FROM tool_configs WHERE tool_id = 'obscura'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("Không đọc được Obscura config: {error}"))?;
        let obscura_resolution = resolve_configured_tool(&connection, "obscura");
        let obscura_is_configured = configured_obscura
            .as_deref()
            .is_some_and(|reference| !reference.trim().is_empty())
            || obscura_resolution.is_ok();
        let (obscura_path, obscura_error) = if obscura_is_configured {
            match obscura_resolution {
                Ok(path) => (Some(path), None),
                Err(error) => (None, Some(error)),
            }
        } else {
            (None, None)
        };
        let node_path = resolve_configured_tool(&connection, "node").ok();
        (workspace_root, obscura_path, obscura_error, node_path)
    };

    let run_id = now_id("preview-scan");
    let output_dir = workspace_root
        .join(".auto3dvideo")
        .join("runs")
        .join(&run_id)
        .join("preview-scan");
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Không tạo được thư mục preview scan: {error}"))?;
    let worker_path = workspace_root
        .join(".auto3dvideo")
        .join("tools")
        .join("browseros_preview_scan_worker.mjs");
    browser_handoff::sync_embedded_worker(
        &worker_path,
        BROWSEROS_PREVIEW_SCAN_WORKER_SCRIPT,
        "BrowserOS preview scan worker",
    )?;
    let public_catalog_worker_path = workspace_root
        .join(".auto3dvideo")
        .join("tools")
        .join("public_preview_catalog_worker.mjs");
    browser_handoff::sync_embedded_worker(
        &public_catalog_worker_path,
        PUBLIC_PREVIEW_CATALOG_WORKER_SCRIPT,
        "Public preview catalog worker",
    )?;
    let report_path = output_dir.join("preview-scan-report.json");
    let relative = |path: &Path| -> Result<String, String> {
        path.strip_prefix(&workspace_root)
            .map_err(|_| "Preview scan output vượt project workspace".to_string())
            .map(|value| value.to_string_lossy().replace('\\', "/"))
    };
    let worker_relative = relative(&worker_path)?;
    let report_relative = relative(&report_path)?;
    let browser_report_path = output_dir.join("browseros-preview-scan-report.json");
    let browser_report_relative = relative(&browser_report_path)?;
    if let Some(error) = obscura_error {
        return Ok(serde_json::json!({
            "status": "blocked",
            "worker": "Obscura · cấu hình lỗi",
            "engine": "obscura_public_scrape",
            "scanMode": "discovery_all",
            "previewOnly": true,
            "platforms": platforms,
            "maxResults": request.max_results,
            "platformResults": [],
            "cards": [],
            "browserSessionAttached": false,
            "networkCallsMade": false,
            "message": format!("Obscura đã được cấu hình nhưng không resolve được: {error}. Không tự rơi về engine khác để tránh báo sai.")
        }));
    }
    let mut obscura_attempt: Option<Value> = None;
    let mut base_report: Option<Value> = None;
    let mut browser_platforms = platforms.clone();
    if let Some(obscura_path) = obscura_path {
        let obscura_report = run_obscura_preview_scan(
            &platforms,
            request.max_results,
            &run_id,
            &workspace_root,
            obscura_path,
            &report_path,
            &report_relative,
        )
        .await;
        let obscura_report = obscura_report?;
        let report = run_bilibili_public_catalog_fallback(
            obscura_report,
            &platforms,
            request.max_results,
            &run_id,
            &workspace_root,
            node_path.as_ref(),
            &public_catalog_worker_path,
            &output_dir,
            &report_path,
        )
        .await?;
        browser_platforms = platforms
            .iter()
            .filter(|platform| !preview_report_has_cards_for_platform(&report, platform))
            .cloned()
            .collect();
        // Obscura may succeed for one platform while returning a shell or
        // navigation links for another. Keep the valid cards and hand only
        // the missing platforms to the user's one-tab BrowserOS session.
        if browser_platforms.is_empty()
            || !browser_handoff::browseros_backend_enabled()
            || node_path.is_none()
        {
            fs::write(
                &report_path,
                serde_json::to_vec_pretty(&report)
                    .map_err(|error| format!("Không serialize được preview scan report: {error}"))?,
            )
            .map_err(|error| format!("Không cập nhật được preview scan report: {error}"))?;
            return Ok(report);
        }
        obscura_attempt = Some(serde_json::json!({
            "status": report.get("status").and_then(Value::as_str).unwrap_or("blocked"),
            "worker": report.get("worker").and_then(Value::as_str).unwrap_or("Obscura · public scrape · concurrency 3"),
            "message": format!("Obscura chưa trả card hợp lệ cho: {}", browser_platforms.join(", ")),
            "cardCount": report.get("cards").and_then(Value::as_array).map(Vec::len).unwrap_or(0),
            "outputBytes": report.get("obscuraOutputBytes").and_then(Value::as_u64).unwrap_or(0),
        }));
        base_report = Some(report);
    }
    if !browser_handoff::browseros_backend_enabled() {
        let report = serde_json::json!({
            "status": "blocked",
            "worker": "Chưa có Obscura · BrowserOS đang tắt",
            "engine": "none",
            "scanMode": "discovery_all",
            "previewOnly": true,
            "platforms": platforms,
            "maxResults": request.max_results,
            "cards": [],
            "platformResults": [],
            "browserSessionAttached": false,
            "networkCallsMade": false,
            "runId": run_id,
            "reportPath": report_relative,
            "message": "Chưa cấu hình obscura.exe và BrowserOS backend đang tắt; chỉ thử public catalog adapter nào có sẵn, không tạo kết quả giả."
        });
        let report = run_bilibili_public_catalog_fallback(
            report,
            &platforms,
            request.max_results,
            &run_id,
            &workspace_root,
            node_path.as_ref(),
            &public_catalog_worker_path,
            &output_dir,
            &report_path,
        )
        .await?;
        fs::write(
            &report_path,
            serde_json::to_vec_pretty(&report)
                .map_err(|error| format!("Không serialize được preview scan report: {error}"))?,
        )
        .map_err(|error| format!("Không cập nhật được preview scan report: {error}"))?;
        return Ok(report);
    }
    let node_path = node_path.ok_or_else(|| {
        "Obscura chưa cấu hình và Node cũng chưa sẵn sàng cho BrowserOS fallback; hãy cấu hình obscura.exe hoặc node.exe trong Cài đặt.".to_string()
    })?;
    let platforms_json = serde_json::to_string(&browser_platforms)
        .map_err(|error| format!("Không serialize được danh sách nền tảng: {error}"))?;
    let process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "node".to_string(),
            args: vec![
                worker_relative,
                "--platforms-json".to_string(),
                platforms_json,
                "--max-results".to_string(),
                request.max_results.to_string(),
                "--run-id".to_string(),
                run_id.clone(),
                "--output".to_string(),
                browser_report_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: Default::default(),
            timeout_seconds: 360,
            expected_outputs: vec![browser_report_relative.clone()],
        },
        executable_path: node_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;

    let mut browser_report = fs::read_to_string(&browser_report_path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or_else(|| serde_json::json!({
            "status": "failed",
            "cards": [],
            "platformResults": [],
            "message": "Worker không ghi được report preview scan."
        }));
    let raw_status = browser_report
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("blocked")
        .to_string();
    let status = if process.timed_out || process.cancelled {
        "failed".to_string()
    } else if !process.succeeded && matches!(raw_status.as_str(), "success" | "partial") {
        "failed".to_string()
    } else if matches!(raw_status.as_str(), "success" | "partial" | "blocked") {
        raw_status
    } else {
        "blocked".to_string()
    };
    let fallback_message = if process.timed_out {
        "Preview scan hết thời gian 360 giây; worker đã bị dừng."
    } else if process.cancelled {
        "Preview scan đã bị hủy trước khi hoàn tất."
    } else if !process.succeeded {
        "Preview scan worker kết thúc không thành công; không coi là đã quét xong."
    } else {
        "Worker chưa trả thông báo kết quả hợp lệ."
    };
    let message = browser_report
        .get("message")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(fallback_message)
        .to_string();
    {
        let object = browser_report
            .as_object_mut()
            .ok_or_else(|| "Preview scan report phải là JSON object".to_string())?;
        object.insert("status".to_string(), Value::String(status));
        object.insert("projectId".to_string(), Value::String(project_id.clone()));
        object.insert("runId".to_string(), Value::String(run_id.clone()));
        object.insert("reportPath".to_string(), Value::String(browser_report_relative.clone()));
        object.insert("message".to_string(), Value::String(message));
        object.insert(
            "process".to_string(),
            serde_json::to_value(&process)
                .map_err(|error| format!("Không serialize được process evidence: {error}"))?,
        );
    }
    let report = if let Some(mut base_report) = base_report {
        if let Some(attempt) = obscura_attempt {
            if let Some(object) = base_report.as_object_mut() {
                object.insert("obscuraAttempt".to_string(), attempt);
            }
        }
        merge_preview_platform_fallback(base_report, &browser_report, &browser_platforms, &process)?
    } else {
        let mut report = browser_report;
        let report_object = report
            .as_object_mut()
            .ok_or_else(|| "Preview scan report phải là JSON object".to_string())?;
        report_object.insert("reportPath".to_string(), Value::String(report_relative.clone()));
        report_object.insert("projectId".to_string(), Value::String(project_id));
        report_object.insert("runId".to_string(), Value::String(run_id));
        report_object.insert("worker".to_string(), Value::String("BrowserOS neo · 1 tab tuần tự".to_string()));
        report_object.insert("engine".to_string(), Value::String("browseros_preview_scan".to_string()));
        report
    };
    fs::write(
        &report_path,
        serde_json::to_vec_pretty(&report)
            .map_err(|error| format!("Không serialize được preview scan report: {error}"))?,
    )
    .map_err(|error| format!("Không cập nhật được preview scan report: {error}"))?;
    Ok(report)
}

#[tauri::command]
async fn scan_preview_creator_catalog(
    request: PreviewCreatorScanRequest,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    valid_text(&request.project_id, "Project ID")?;
    valid_text(&request.platform, "Nền tảng")?;
    valid_text(&request.source_url, "URL creator/playlist")?;
    if !(1..=200).contains(&request.max_results) {
        return Err("Số video phải nằm trong khoảng 1..200".to_string());
    }
    let project_id = request.project_id.trim().to_string();
    let platform = request.platform.trim().to_ascii_lowercase();
    if !PREVIEW_DISCOVERY_PLATFORMS.contains(&platform.as_str()) {
        return Err(format!("Nền tảng preview chưa được allowlist: {platform}"));
    }
    let source_url = validate_preview_creator_source_url(&request.source_url, &platform)?;

    let (workspace_root, ytdlp_path, ytdlp_error) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        ensure_project_exists(&connection, &project_id)?;
        let workspace_root = fs::canonicalize(project_workspace_root(&connection, &project_id)?)
            .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?;
        match resolve_configured_tool(&connection, "yt-dlp") {
            Ok(path) => (workspace_root, Some(path), None),
            Err(error) => (workspace_root, None, Some(error)),
        }
    };

    let run_id = now_id("preview-creator-scan");
    let output_dir = workspace_root
        .join(".auto3dvideo")
        .join("runs")
        .join(&run_id)
        .join("preview-creator-scan");
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Không tạo được thư mục creator scan: {error}"))?;
    let report_path = output_dir.join("preview-creator-scan-report.json");
    let report_relative = report_path
        .strip_prefix(&workspace_root)
        .map_err(|_| "Creator scan report vượt project workspace".to_string())?
        .to_string_lossy()
        .replace('\\', "/");

    if let Some(error) = ytdlp_error {
        let report = serde_json::json!({
            "status": "blocked",
            "worker": "yt-dlp · creator/playlist catalog",
            "engine": "yt_dlp_creator_catalog",
            "scanMode": "creator_catalog",
            "previewOnly": true,
            "platforms": [platform],
            "maxResults": request.max_results,
            "sourceUrl": source_url,
            "platformResults": [{
                "platform": platform,
                "status": "blocked",
                "scannedCount": 0,
                "discoveryUrl": source_url,
                "message": format!("Chưa sẵn sàng quét catalog: {error}. Hãy cấu hình yt-dlp.exe trong Cài đặt.")
            }],
            "cards": [],
            "browserSessionAttached": false,
            "networkCallsMade": false,
            "runId": run_id,
            "reportPath": report_relative,
            "message": format!("Chưa chạy creator scan: {error}. Không gọi web và không tạo kết quả giả.")
        });
        let bytes = serde_json::to_vec_pretty(&report)
            .map_err(|serialize_error| format!("Không serialize được creator scan report: {serialize_error}"))?;
        fs::write(&report_path, bytes)
            .map_err(|write_error| format!("Không ghi được creator scan report: {write_error}"))?;
        return Ok(report);
    }

    let ytdlp_path = ytdlp_path.ok_or_else(|| "Không resolve được yt-dlp.exe".to_string())?;
    let process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "yt-dlp".to_string(),
            args: vec![
                "--ignore-config".to_string(),
                "--flat-playlist".to_string(),
                "--skip-download".to_string(),
                "--ignore-errors".to_string(),
                "--no-warnings".to_string(),
                "--dump-single-json".to_string(),
                "--playlist-end".to_string(),
                request.max_results.to_string(),
                "--socket-timeout".to_string(),
                "20".to_string(),
                "--retries".to_string(),
                "2".to_string(),
                source_url.clone(),
            ],
            working_directory: ".".to_string(),
            environment: Default::default(),
            timeout_seconds: 180,
            expected_outputs: Vec::new(),
        },
        executable_path: ytdlp_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;

    let mut report = build_ytdlp_creator_preview_report(
        &process.stdout,
        &platform,
        &source_url,
        request.max_results,
    );
    let raw_status = report
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("blocked")
        .to_string();
    let status = if process.timed_out || process.cancelled || !process.succeeded {
        "failed"
    } else {
        raw_status.as_str()
    };
    let message = if process.timed_out {
        "Creator scan hết thời gian 180 giây; yt-dlp đã bị dừng, không coi là quét xong.".to_string()
    } else if process.cancelled {
        "Creator scan đã bị hủy trước khi hoàn tất.".to_string()
    } else if !process.succeeded {
        format!(
            "yt-dlp kết thúc không thành công; không coi là quét xong. {}",
            process
                .stderr
                .lines()
                .next()
                .unwrap_or("Kiểm tra extractor và quyền truy cập nguồn.")
        )
    } else {
        report
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("yt-dlp chưa trả thông báo kết quả hợp lệ.")
            .to_string()
    };
    let object = report
        .as_object_mut()
        .ok_or_else(|| "Creator scan report phải là JSON object".to_string())?;
    object.insert("status".to_string(), Value::String(status.to_string()));
    object.insert("projectId".to_string(), Value::String(project_id));
    object.insert("runId".to_string(), Value::String(run_id));
    object.insert("reportPath".to_string(), Value::String(report_relative));
    object.insert("message".to_string(), Value::String(message));
    let mut process_evidence = process.clone();
    process_evidence.stdout = format!(
        "yt-dlp stdout đã parse: {} byte; raw catalog không ghi vào report.",
        process.stdout_bytes
    );
    object.insert(
        "process".to_string(),
        serde_json::to_value(process_evidence)
            .map_err(|error| format!("Không serialize được yt-dlp process evidence: {error}"))?,
    );
    let bytes = serde_json::to_vec_pretty(&report)
        .map_err(|error| format!("Không serialize được creator scan report: {error}"))?;
    if bytes.is_empty() {
        return Err("Creator scan report rỗng".to_string());
    }
    fs::write(&report_path, bytes)
        .map_err(|error| format!("Không ghi được creator scan report: {error}"))?;
    let report_size = fs::metadata(&report_path)
        .map_err(|error| format!("Không xác nhận được creator scan report: {error}"))?
        .len();
    if report_size == 0 {
        return Err("Creator scan report ghi ra nhưng có kích thước 0".to_string());
    }
    Ok(report)
}

#[tauri::command]
async fn scan_licensed_footage_discovery(
    request: LicensedFootageScanRequest,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    valid_text(&request.project_id, "Project ID")?;
    if !(1..=200).contains(&request.max_results) {
        return Err("Số footage phải nằm trong khoảng 1..200".to_string());
    }
    let project_id = request.project_id.trim().to_string();
    let (workspace_root, python_path) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        ensure_project_exists(&connection, &project_id)?;
        project_workspace_and_python(&connection, &project_id)?
    };

    let run_id = now_id("licensed-footage-scan");
    let output_dir = workspace_root
        .join(".auto3dvideo")
        .join("runs")
        .join(&run_id)
        .join("licensed-footage-scan");
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Không tạo được thư mục licensed footage scan: {error}"))?;
    let worker_path = workspace_root
        .join(".auto3dvideo")
        .join("tools")
        .join("licensed_footage_preview_worker.py");
    browser_handoff::sync_embedded_worker(
        &worker_path,
        LICENSED_FOOTAGE_PREVIEW_WORKER_SCRIPT,
        "Licensed footage preview worker",
    )?;
    let report_path = output_dir.join("licensed-footage-scan-report.json");
    let relative = |path: &Path| -> Result<String, String> {
        path.strip_prefix(&workspace_root)
            .map_err(|_| "Licensed footage scan output vượt project workspace".to_string())
            .map(|value| value.to_string_lossy().replace('\\', "/"))
    };
    let worker_relative = relative(&worker_path)?;
    let report_relative = relative(&report_path)?;
    let process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "python".to_string(),
            args: vec![
                worker_relative,
                "--max-results".to_string(),
                request.max_results.to_string(),
                "--output".to_string(),
                report_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: Default::default(),
            timeout_seconds: 180,
            expected_outputs: vec![report_relative.clone()],
        },
        executable_path: python_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;

    let mut report = fs::read_to_string(&report_path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or_else(|| {
            serde_json::json!({
                "status": "failed",
                "cards": [],
                "platformResults": [],
                "message": "Worker licensed footage không ghi được report."
            })
        });
    let raw_status = report
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("blocked")
        .to_string();
    let status = if process.timed_out || process.cancelled || !process.succeeded {
        "failed"
    } else if matches!(raw_status.as_str(), "success" | "partial" | "blocked") {
        raw_status.as_str()
    } else {
        "blocked"
    };
    let message = if process.timed_out {
        "Quét footage hết thời gian 180 giây; worker đã bị dừng, không coi là quét xong.".to_string()
    } else if process.cancelled {
        "Quét footage đã bị hủy trước khi hoàn tất.".to_string()
    } else if !process.succeeded {
        format!(
            "Worker quét footage kết thúc không thành công; không coi là quét xong. {}",
            process
                .stderr
                .lines()
                .next()
                .unwrap_or("Kiểm tra Python và kết nối Wikimedia Commons.")
        )
    } else {
        report
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Worker chưa trả thông báo kết quả hợp lệ.")
            .to_string()
    };
    let object = report
        .as_object_mut()
        .ok_or_else(|| "Licensed footage report phải là JSON object".to_string())?;
    object.insert("status".to_string(), Value::String(status.to_string()));
    object.insert("projectId".to_string(), Value::String(project_id));
    object.insert("runId".to_string(), Value::String(run_id));
    object.insert("reportPath".to_string(), Value::String(report_relative));
    object.insert("message".to_string(), Value::String(message));
    let mut process_evidence = process.clone();
    process_evidence.stdout = format!(
        "Licensed footage worker stdout đã parse: {} byte; raw response không ghi vào report.",
        process.stdout_bytes
    );
    object.insert(
        "process".to_string(),
        serde_json::to_value(process_evidence)
            .map_err(|error| format!("Không serialize được licensed footage process evidence: {error}"))?,
    );
    let bytes = serde_json::to_vec_pretty(&report)
        .map_err(|error| format!("Không serialize được licensed footage report: {error}"))?;
    fs::write(&report_path, bytes)
        .map_err(|error| format!("Không cập nhật được licensed footage report: {error}"))?;
    if fs::metadata(&report_path)
        .map_err(|error| format!("Không xác nhận được licensed footage report: {error}"))?
        .len()
        == 0
    {
        return Err("Licensed footage report ghi ra nhưng có kích thước 0".to_string());
    }
    Ok(report)
}

#[tauri::command]
async fn type_google_flow_dom_prompt(
    project_id: String,
    request: GoogleFlowDomPromptRequest,
    state: State<'_, AppState>,
) -> Result<GoogleFlowDomPromptReport, String> {
    valid_text(&project_id, "Project ID")?;
    let project_id = project_id.trim().to_string();
    let project_url = validate_google_flow_project_url_for_dom(&request.project_url)?;
    let prompt = validate_google_flow_dom_prompt(&request.prompt)?;
    if browser_handoff::browseros_backend_enabled() {
        let execution = run_browseros_flow_operation(
            &project_id,
            "flow_type_prompt",
            &project_url,
            Some(&prompt),
            None,
            None,
            None,
            None,
            state,
        )
        .await?;
        let raw = &execution.raw_report;
        let status = raw
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("blocked")
            .to_string();
        let message = raw
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("BrowserOS chưa xác nhận prompt Google Flow")
            .to_string();
        return Ok(GoogleFlowDomPromptReport {
            status,
            project_url,
            target_url: raw
                .get("targetUrl")
                .and_then(Value::as_str)
                .map(str::to_string),
            report_path: execution.report_relative,
            editor_found: raw
                .get("editorFound")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            prompt_accepted: raw
                .get("promptAccepted")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            generate_clicked: raw
                .get("generateClicked")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            message,
            process: execution.process,
        });
    }
    let flow_cdp_url = provider_config::nanobanana_flow_cdp_url();
    let (normalized_cdp, _) = parse_nanobanana_cdp_endpoint(&flow_cdp_url)?;
    let cdp_preflight = nanobanana_cdp_preflight(&normalized_cdp);
    if cdp_preflight.status != "ready" {
        return Err(cdp_preflight.message);
    }
    let (workspace_root, node_path, server_entry) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        let workspace_root = fs::canonicalize(project_workspace_root(&connection, &project_id)?)
            .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?;
        let node_path = resolve_configured_tool(&connection, "node")?;
        let server_entry = browser_handoff::browsermcp_server_entry()?;
        (workspace_root, node_path, server_entry)
    };

    let run_id = now_id("flow-dom");
    let output_dir = workspace_root
        .join(".auto3dvideo")
        .join("runs")
        .join(&run_id)
        .join("google-flow-dom");
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Không tạo được thư mục Google Flow DOM: {error}"))?;
    let worker_path = workspace_root
        .join(".auto3dvideo")
        .join("tools")
        .join("google_flow_dom_worker.mjs");
    browser_handoff::sync_embedded_worker(
        &worker_path,
        GOOGLE_FLOW_DOM_WORKER_SCRIPT,
        "Google Flow DOM worker",
    )?;
    let spec_path = output_dir.join("google-flow-dom-spec.json");
    let report_path = output_dir.join("google-flow-dom-report.json");
    let relative = |path: &Path| -> Result<String, String> {
        path.strip_prefix(&workspace_root)
            .map_err(|_| "Google Flow DOM output vượt project workspace".to_string())
            .map(|value| value.to_string_lossy().replace('\\', "/"))
    };
    let worker_relative = relative(&worker_path)?;
    let spec_relative = relative(&spec_path)?;
    let report_relative = relative(&report_path)?;
    let spec = serde_json::json!({
        "projectUrl": project_url,
        "prompt": prompt,
        "flowCdpUrl": normalized_cdp,
        "serverEntry": server_entry.to_string_lossy().to_string(),
    });
    fs::write(
        &spec_path,
        serde_json::to_vec_pretty(&spec)
            .map_err(|error| format!("Không serialize được Google Flow DOM spec: {error}"))?,
    )
    .map_err(|error| format!("Không ghi được Google Flow DOM spec: {error}"))?;

    let process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "node".to_string(),
            args: vec![
                worker_relative,
                "--spec".to_string(),
                spec_relative,
                "--output".to_string(),
                report_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: Default::default(),
            timeout_seconds: 45,
            expected_outputs: vec![report_relative.clone()],
        },
        executable_path: node_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    let raw_report = fs::read_to_string(&report_path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    let status = raw_report
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or(if process.succeeded {
            "blocked"
        } else {
            "failed"
        })
        .to_string();
    let message = raw_report
        .get("message")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            if process.succeeded {
                "Google Flow không xác nhận prompt DOM".to_string()
            } else {
                format!(
                    "Google Flow DOM worker thất bại: {}",
                    process.stderr.chars().take(600).collect::<String>()
                )
            }
        });
    Ok(GoogleFlowDomPromptReport {
        status,
        project_url,
        target_url: raw_report
            .get("targetUrl")
            .and_then(Value::as_str)
            .map(str::to_string),
        report_path: report_relative,
        editor_found: raw_report
            .get("editorFound")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        prompt_accepted: raw_report
            .get("promptAccepted")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        generate_clicked: raw_report
            .get("generateClicked")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        message,
        process,
    })
}

#[tauri::command]
async fn inspect_google_flow_dom_output(
    project_id: String,
    request: GoogleFlowDomOutputRequest,
    state: State<'_, AppState>,
) -> Result<GoogleFlowDomOutputReport, String> {
    valid_text(&project_id, "Project ID")?;
    let project_id = project_id.trim().to_string();
    let project_url = validate_google_flow_project_url_for_dom(&request.project_url)?;
    let batch_identity = match (&request.shot_id, &request.revision_id) {
        (Some(shot_id), Some(revision_id)) => Some((
            validate_google_flow_batch_identity(shot_id, "shotId")?,
            validate_google_flow_batch_identity(revision_id, "revisionId")?,
        )),
        (None, None) => None,
        _ => return Err("shotId và revisionId phải đi cùng nhau".to_string()),
    };
    let requested_model = match request.model.as_deref() {
        Some(model) if model == "Nano Banana Pro" => Some(model.to_string()),
        Some(_) => {
            return Err("Chỉ cho phép chọn Nano Banana Pro trong Flow image composer".to_string())
        }
        None => None,
    };
    let requested_mode = request
        .mode
        .as_deref()
        .map(str::trim)
        .filter(|mode| !mode.is_empty());
    if let Some(mode) = requested_mode {
        if !matches!(
            mode,
            "inspect_composer" | "inspect_output" | "select_image_model" | "click_image_batch"
        ) {
            return Err("Google Flow DOM mode không hợp lệ".to_string());
        }
    }
    if requested_model.is_some() && batch_identity.is_some() {
        return Err(
            "Không thể vừa chọn model vừa click download batch trong cùng một request".to_string(),
        );
    }
    let (workspace_root, node_path, server_entry) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        let workspace_root = fs::canonicalize(project_workspace_root(&connection, &project_id)?)
            .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?;
        let node_path = resolve_configured_tool(&connection, "node")?;
        let server_entry = browser_handoff::browsermcp_server_entry()?;
        (workspace_root, node_path, server_entry)
    };

    let run_id = now_id("flow-output-dom");
    let output_dir = workspace_root
        .join(".auto3dvideo")
        .join("runs")
        .join(&run_id)
        .join("google-flow-dom-output");
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Không tạo được thư mục Google Flow output DOM: {error}"))?;
    let worker_path = workspace_root
        .join(".auto3dvideo")
        .join("tools")
        .join("google_flow_dom_worker.mjs");
    browser_handoff::sync_embedded_worker(
        &worker_path,
        GOOGLE_FLOW_DOM_WORKER_SCRIPT,
        "Google Flow DOM worker",
    )?;
    let spec_path = output_dir.join("google-flow-dom-output-spec.json");
    let report_path = output_dir.join("google-flow-dom-output-report.json");
    let relative = |path: &Path| -> Result<String, String> {
        path.strip_prefix(&workspace_root)
            .map_err(|_| "Google Flow output DOM vượt project workspace".to_string())
            .map(|value| value.to_string_lossy().replace('\\', "/"))
    };
    let worker_relative = relative(&worker_path)?;
    let spec_relative = relative(&spec_path)?;
    let report_relative = relative(&report_path)?;
    let mode = requested_mode.unwrap_or(if requested_model.is_some() {
        "select_image_model"
    } else if batch_identity.is_some() {
        "click_image_batch"
    } else {
        "inspect_output"
    });
    if mode == "select_image_model" && requested_model.is_none() {
        return Err("select_image_model cần model Nano Banana Pro".to_string());
    }
    if mode == "click_image_batch" && batch_identity.is_none() {
        return Err("click_image_batch cần shotId và revisionId".to_string());
    }
    let requested_run_id = request
        .run_id
        .as_deref()
        .map(|value| validate_google_flow_batch_identity(value, "runId"))
        .transpose()?;
    if mode == "click_image_batch" && requested_run_id.is_none() {
        return Err("click_image_batch cần runId của lượt chạy hiện tại".to_string());
    }
    if browser_handoff::browseros_backend_enabled() {
        let operation = browseros_flow_operation_for_dom_mode(&mode)?;
        let execution = run_browseros_flow_operation(
            &project_id,
            operation,
            &project_url,
            None,
            batch_identity.as_ref().map(|(shot_id, _)| shot_id.as_str()),
            batch_identity.as_ref().map(|(_, revision_id)| revision_id.as_str()),
            requested_run_id.as_deref(),
            None,
            state,
        )
        .await?;
        let raw = &execution.raw_report;
        let status = raw
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("blocked")
            .to_string();
        let message = raw
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("BrowserOS chưa xác nhận trạng thái Google Flow")
            .to_string();
        return Ok(GoogleFlowDomOutputReport {
            status,
            project_url,
            target_url: raw
                .get("targetUrl")
                .and_then(Value::as_str)
                .map(str::to_string),
            report_path: execution.report_relative,
            media_count: raw.get("mediaCount").and_then(Value::as_u64).unwrap_or(0) as usize,
            media_ids: raw
                .get("mediaIds")
                .and_then(Value::as_array)
                .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
                .unwrap_or_default(),
            historical_shot_media_ids: raw
                .get("historicalShotMediaIds")
                .and_then(Value::as_array)
                .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
                .unwrap_or_default(),
            historical_shot_media_count: raw
                .get("historicalShotMediaCount")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize,
            matching_batch_count: raw.get("matchingBatchCount").and_then(Value::as_u64).unwrap_or(0) as usize,
            matching_batch_media_count: raw.get("matchingBatchMediaCount").and_then(Value::as_u64).unwrap_or(0) as usize,
            matching_batch_media_ids: raw
                .get("matchingBatchMediaIds")
                .and_then(Value::as_array)
                .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
                .unwrap_or_default(),
            shot_revision_batch_count: raw.get("shotRevisionBatchCount").and_then(Value::as_u64).unwrap_or(0) as usize,
            shot_revision_batch_media_count: raw.get("shotRevisionBatchMediaCount").and_then(Value::as_u64).unwrap_or(0) as usize,
            shot_revision_batch_media_ids: raw
                .get("shotRevisionBatchMediaIds")
                .and_then(Value::as_array)
                .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
                .unwrap_or_default(),
            assistant_claims_generated: raw.get("assistantClaimsGenerated").and_then(Value::as_bool).unwrap_or(false),
            generated_message_count: raw.get("generatedMessageCount").and_then(Value::as_u64).unwrap_or(0) as usize,
            generation_active: raw.get("generationActive").and_then(Value::as_bool).unwrap_or(false),
            download_control_found: raw.get("downloadControlFound").and_then(Value::as_bool).unwrap_or(false),
            download_clicked: raw.get("downloadStarted").and_then(Value::as_bool).unwrap_or(false),
            selected_model: raw.get("selectedModel").and_then(Value::as_str).unwrap_or_default().to_string(),
            model_selected: raw.get("modelSelected").and_then(Value::as_bool).unwrap_or(false),
            saved: raw.get("saved").and_then(Value::as_bool).unwrap_or(false),
            composer_found: raw.get("composerFound").and_then(Value::as_bool).unwrap_or(false),
            prompt_editor_found: raw.get("promptEditorFound").and_then(Value::as_bool).unwrap_or(false),
            image_mode_found: raw.get("imageModeFound").and_then(Value::as_bool).unwrap_or(false),
            message,
            process: execution.process,
        });
    }
    // BrowserOS owns the live Flow tab and its DOM actions. It must not be
    // blocked by the legacy Chrome-for-Testing CDP 9222 preflight. Keep that
    // preflight only for the fallback worker below, which explicitly connects
    // to the legacy CDP endpoint.
    let flow_cdp_url = provider_config::nanobanana_flow_cdp_url();
    let (normalized_cdp, _) = parse_nanobanana_cdp_endpoint(&flow_cdp_url)?;
    let cdp_preflight = nanobanana_cdp_preflight(&normalized_cdp);
    if cdp_preflight.status != "ready" {
        return Err(cdp_preflight.message);
    }
    let spec = serde_json::json!({
        "mode": mode,
        "projectUrl": project_url,
        "flowCdpUrl": normalized_cdp,
        "serverEntry": server_entry.to_string_lossy().to_string(),
        "shotId": batch_identity.as_ref().map(|(shot_id, _)| shot_id),
        "revisionId": batch_identity.as_ref().map(|(_, revision_id)| revision_id),
        "runId": requested_run_id,
        "model": requested_model,
    });
    fs::write(
        &spec_path,
        serde_json::to_vec_pretty(&spec).map_err(|error| {
            format!("Không serialize được Google Flow output DOM spec: {error}")
        })?,
    )
    .map_err(|error| format!("Không ghi được Google Flow output DOM spec: {error}"))?;

    let process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "node".to_string(),
            args: vec![
                worker_relative,
                "--spec".to_string(),
                spec_relative,
                "--output".to_string(),
                report_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: Default::default(),
            timeout_seconds: 30,
            expected_outputs: vec![report_relative.clone()],
        },
        executable_path: node_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    let raw_report = fs::read_to_string(&report_path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    let status = raw_report
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or(if process.succeeded {
            "blocked"
        } else {
            "failed"
        })
        .to_string();
    let message = raw_report
        .get("message")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            if process.succeeded {
                "Google Flow chưa xác nhận media output trong DOM".to_string()
            } else {
                format!(
                    "Google Flow output DOM worker thất bại: {}",
                    process.stderr.chars().take(600).collect::<String>()
                )
            }
        });
    Ok(GoogleFlowDomOutputReport {
        status,
        project_url,
        target_url: raw_report
            .get("targetUrl")
            .and_then(Value::as_str)
            .map(str::to_string),
        report_path: report_relative,
        media_count: raw_report
            .get("mediaCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize,
        media_ids: raw_report
            .get("mediaIds")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        historical_shot_media_ids: raw_report
            .get("historicalShotMediaIds")
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
            .unwrap_or_default(),
        historical_shot_media_count: raw_report
            .get("historicalShotMediaCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize,
        matching_batch_count: raw_report
            .get("matchingBatchCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize,
        matching_batch_media_count: raw_report
            .get("matchingBatchMediaCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize,
        matching_batch_media_ids: raw_report
            .get("matchingBatchMediaIds")
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
            .unwrap_or_default(),
        shot_revision_batch_count: raw_report
            .get("shotRevisionBatchCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize,
        shot_revision_batch_media_count: raw_report
            .get("shotRevisionBatchMediaCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize,
        shot_revision_batch_media_ids: raw_report
            .get("shotRevisionBatchMediaIds")
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
            .unwrap_or_default(),
        assistant_claims_generated: raw_report
            .get("assistantClaimsGenerated")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        generated_message_count: raw_report
            .get("generatedMessageCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize,
        generation_active: raw_report
            .get("generationActive")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        download_control_found: raw_report
            .get("downloadControlFound")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        download_clicked: raw_report
            .get("downloadClicked")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        selected_model: raw_report
            .get("selectedModel")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        model_selected: raw_report
            .get("modelSelected")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        saved: raw_report
            .get("saved")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        composer_found: raw_report
            .get("composerFound")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        prompt_editor_found: raw_report
            .get("promptEditorFound")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        image_mode_found: raw_report
            .get("imageModeFound")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        message,
        process,
    })
}

#[tauri::command]
async fn run_google_flow_playwright_action(
    project_id: String,
    request: GoogleFlowPlaywrightRequest,
    state: State<'_, AppState>,
) -> Result<GoogleFlowPlaywrightReport, String> {
    valid_text(&project_id, "Project ID")?;
    let project_id = project_id.trim().to_string();
    let project_url = validate_google_flow_project_url_for_dom(&request.project_url)?;
    let mode = request.mode.trim().to_ascii_lowercase();
    if !matches!(
        mode.as_str(),
        "observe" | "type_prompt" | "click_generate" | "animate_image" | "download_image"
    ) {
        return Err(
            "Playwright Flow chỉ cho phép observe, type_prompt, click_generate, animate_image hoặc download_image"
                .to_string(),
        );
    }
    let prompt = request
        .prompt
        .as_deref()
        .map(validate_google_flow_dom_prompt)
        .transpose()?;
    if mode == "type_prompt" && prompt.is_none() {
        return Err("Playwright type_prompt cần prompt".to_string());
    }
    if mode != "type_prompt" && prompt.is_some() {
        return Err("Chỉ được gửi prompt khi mode là type_prompt".to_string());
    }
    let media_id = request
        .media_id
        .as_deref()
        .map(|value| validate_google_flow_batch_identity(value, "mediaId"))
        .transpose()?;
    if media_id.is_some() && mode != "download_image" {
        return Err("mediaId chỉ dùng để tải đúng media mới của mode download_image".to_string());
    }
    let batch_identity = match (&request.shot_id, &request.revision_id) {
        (Some(shot_id), Some(revision_id)) => Some((
            validate_google_flow_batch_identity(shot_id, "shotId")?,
            validate_google_flow_batch_identity(revision_id, "revisionId")?,
        )),
        (None, None) => None,
        _ => return Err("shotId và revisionId phải đi cùng nhau".to_string()),
    };
    if matches!(mode.as_str(), "animate_image" | "download_image") && batch_identity.is_none() {
        return Err(format!("Playwright {mode} cần shotId và revisionId"));
    }
    if !matches!(mode.as_str(), "animate_image" | "download_image") && batch_identity.is_some() {
        return Err(
            "shotId và revisionId chỉ dùng với animate_image hoặc download_image".to_string(),
        );
    }
    if mode != "observe" && request.run_id.is_none() {
        return Err("Playwright Flow action cần runId của lượt chạy hiện tại".to_string());
    }

    if browser_handoff::browseros_backend_enabled() {
        let operation = browseros_flow_operation_for_action(&mode)?;
        let execution = run_browseros_flow_operation(
            &project_id,
            operation,
            &project_url,
            prompt.as_deref(),
            batch_identity.as_ref().map(|(shot_id, _)| shot_id.as_str()),
            batch_identity.as_ref().map(|(_, revision_id)| revision_id.as_str()),
            request.run_id.as_deref(),
            media_id.as_deref(),
            state,
        )
        .await?;
        let raw = &execution.raw_report;
        let status = raw
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("blocked")
            .to_string();
        let message = raw
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("BrowserOS chưa xác nhận kết quả thao tác Google Flow")
            .to_string();
        return Ok(GoogleFlowPlaywrightReport {
            status,
            project_url,
            target_url: raw
                .get("targetUrl")
                .and_then(Value::as_str)
                .map(str::to_string),
            mode,
            report_path: execution.report_relative,
            screenshot_path: None,
            editor_found: raw.get("editorFound").and_then(Value::as_bool).unwrap_or(false),
            prompt_accepted: raw.get("promptAccepted").and_then(Value::as_bool).unwrap_or(false),
            generate_clicked: raw.get("generateClicked").and_then(Value::as_bool).unwrap_or(false),
            reference_attached: raw.get("referenceAttached").and_then(Value::as_bool).unwrap_or(false),
            source_media_id: raw.get("sourceMediaId").and_then(Value::as_str).map(str::to_string),
            download_started: raw.get("downloadStarted").and_then(Value::as_bool).unwrap_or(false),
            download_name: raw.get("downloadName").and_then(Value::as_str).map(str::to_string),
            download_size_bytes: raw.get("downloadSizeBytes").and_then(Value::as_u64),
            observed: raw.get("observed").cloned(),
            message,
            process: execution.process,
        });
    }

    let flow_cdp_url = provider_config::nanobanana_flow_cdp_url();
    let (normalized_cdp, _) = parse_nanobanana_cdp_endpoint(&flow_cdp_url)?;
    let cdp_preflight = nanobanana_cdp_preflight(&normalized_cdp);
    if cdp_preflight.status != "ready" {
        return Err(cdp_preflight.message);
    }

    let (workspace_root, node_path) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        let workspace_root = fs::canonicalize(project_workspace_root(&connection, &project_id)?)
            .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?;
        let node_path = resolve_configured_tool(&connection, "node")?;
        (workspace_root, node_path)
    };
    let playwright_module_root = resolve_playwright_module_root()?;
    let download_dir = browser_handoff::browser_downloads_directory()?;
    let download_profile = download_dir
        .parent()
        .ok_or_else(|| "Không xác định được profile user cho Downloads".to_string())?;
    let run_id = request
        .run_id
        .as_deref()
        .map(|value| validate_google_flow_batch_identity(value, "runId"))
        .transpose()?
        .unwrap_or_else(|| now_id("flow-playwright"));
    let output_dir = workspace_root
        .join(".auto3dvideo")
        .join("runs")
        .join(&run_id)
        .join("playwright-flow");
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Không tạo được thư mục Playwright Flow: {error}"))?;
    let worker_path = workspace_root
        .join(".auto3dvideo")
        .join("tools")
        .join("playwright_flow_worker.mjs");
    browser_handoff::sync_embedded_worker(
        &worker_path,
        PLAYWRIGHT_FLOW_WORKER_SCRIPT,
        "Playwright Google Flow worker",
    )?;
    let screenshot_path = output_dir.join(format!("flow-{mode}.png"));
    let relative = |path: &Path| -> Result<String, String> {
        path.strip_prefix(&workspace_root)
            .map_err(|_| "Playwright Flow output vượt project workspace".to_string())
            .map(|value| value.to_string_lossy().replace('\\', "/"))
    };
    let worker_relative = relative(&worker_path)?;
    let spec_path = output_dir.join("playwright-flow-spec.json");
    let report_path = output_dir.join("playwright-flow-report.json");
    let spec_relative = relative(&spec_path)?;
    let report_relative = relative(&report_path)?;
    let screenshot_relative = relative(&screenshot_path)?;
    let spec = serde_json::json!({
        "workspace": workspace_root.to_string_lossy().to_string(),
        "projectUrl": project_url,
        "flowCdpUrl": normalized_cdp,
        "playwrightModuleRoot": playwright_module_root.to_string_lossy().to_string(),
        "downloadDir": download_dir.to_string_lossy().to_string(),
        "downloadProfile": download_profile.to_string_lossy().to_string(),
        "mode": mode,
        "prompt": prompt,
        "shotId": batch_identity.as_ref().map(|(shot_id, _)| shot_id),
        "revisionId": batch_identity.as_ref().map(|(_, revision_id)| revision_id),
        "runId": run_id,
        "mediaId": media_id,
        "screenshotPath": screenshot_relative,
        "screenshotRelativePath": screenshot_relative,
    });
    fs::write(
        &spec_path,
        serde_json::to_vec_pretty(&spec)
            .map_err(|error| format!("Không serialize được Playwright Flow spec: {error}"))?,
    )
    .map_err(|error| format!("Không ghi được Playwright Flow spec: {error}"))?;

    let process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "node".to_string(),
            args: vec![
                worker_relative,
                "--spec".to_string(),
                spec_relative,
                "--output".to_string(),
                report_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: Default::default(),
            timeout_seconds: 60,
            expected_outputs: vec![report_relative.clone()],
        },
        executable_path: node_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    let raw_report = fs::read_to_string(&report_path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    let worker_status = raw_report
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("blocked");
    let status = if worker_status == "ready" && !process.succeeded {
        "failed"
    } else if matches!(worker_status, "ready" | "blocked" | "failed") {
        worker_status
    } else {
        "blocked"
    }
    .to_string();
    let message = raw_report
        .get("message")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            if process.succeeded {
                "Playwright Flow chưa xác nhận kết quả thao tác".to_string()
            } else {
                format!(
                    "Playwright Flow worker thất bại: {}",
                    process.stderr.chars().take(600).collect::<String>()
                )
            }
        });
    Ok(GoogleFlowPlaywrightReport {
        status,
        project_url,
        target_url: raw_report
            .get("targetUrl")
            .and_then(Value::as_str)
            .map(str::to_string),
        mode,
        report_path: report_relative,
        screenshot_path: raw_report
            .get("screenshotPath")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or(Some(screenshot_relative)),
        editor_found: raw_report
            .get("editorFound")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        prompt_accepted: raw_report
            .get("promptAccepted")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        generate_clicked: raw_report
            .get("generateClicked")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        reference_attached: raw_report
            .get("referenceAttached")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        source_media_id: raw_report
            .get("sourceMediaId")
            .and_then(Value::as_str)
            .map(str::to_string),
        download_started: raw_report
            .get("downloadStarted")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        download_name: raw_report
            .get("downloadName")
            .and_then(Value::as_str)
            .map(str::to_string),
        download_size_bytes: raw_report.get("downloadSizeBytes").and_then(Value::as_u64),
        observed: raw_report.get("observed").cloned(),
        message,
        process,
    })
}

fn nanobanana_cdp_preflight(endpoint: &str) -> NanoBananaCdpPreflightReport {
    let parsed = parse_nanobanana_cdp_endpoint(endpoint);
    let (normalized_endpoint, address) = match parsed {
        Ok(value) => value,
        Err(message) => {
            return NanoBananaCdpPreflightReport {
                endpoint: endpoint.trim().to_string(),
                status: "blocked".to_string(),
                http_status: None,
                message,
                network_probe_performed: false,
                side_effects_started: false,
            }
        }
    };
    let mut stream = match TcpStream::connect_timeout(&address, Duration::from_millis(1500)) {
        Ok(stream) => stream,
        Err(_) => {
            return NanoBananaCdpPreflightReport {
                endpoint: normalized_endpoint,
                status: "unavailable".to_string(),
                http_status: None,
                message: "Không kết nối được Chrome CDP 9222. BrowserMCP 9009 là extension bridge riêng, không thay thế CDP; hãy mở Chrome Flow với remote debugging/CDP 9222 rồi thử lại. Chưa spawn Nano Banana worker và chưa phát sinh job trả phí.".to_string(),
                network_probe_performed: true,
                side_effects_started: false,
            }
        }
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(1500)));
    let host_header = address.ip().to_string();
    let request =
        format!("GET /json/version HTTP/1.1\r\nHost: {host_header}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return NanoBananaCdpPreflightReport {
            endpoint: normalized_endpoint,
            status: "unavailable".to_string(),
            http_status: None,
            message: "Chrome CDP 9222 đã mở nhưng không nhận được /json/version. BrowserMCP 9009 vẫn không phải CDP; kiểm tra Chrome remote debugging rồi thử lại. Chưa spawn Nano Banana worker.".to_string(),
            network_probe_performed: true,
            side_effects_started: false,
        };
    }
    let mut response = Vec::with_capacity(4096);
    let mut buffer = [0_u8; 4096];
    while response.len() < 65_536 {
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => response.extend_from_slice(&buffer[..read]),
            Err(_) => break,
        }
    }
    let response_text = String::from_utf8_lossy(&response);
    let status_line = response_text.lines().next().unwrap_or_default();
    let http_status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u16>().ok());
    if http_status == Some(200) {
        NanoBananaCdpPreflightReport {
            endpoint: normalized_endpoint,
            status: "ready".to_string(),
            http_status,
            message: "Chrome CDP 9222 phản hồi /json/version; có thể khởi tạo Nano Banana MCP. BrowserMCP 9009 vẫn được giữ là bridge UI riêng.".to_string(),
            network_probe_performed: true,
            side_effects_started: false,
        }
    } else {
        NanoBananaCdpPreflightReport {
            endpoint: normalized_endpoint,
            status: "unhealthy".to_string(),
            http_status,
            message: "Chrome CDP 9222 đã phản hồi nhưng /json/version không trả HTTP 200. BrowserMCP 9009 không thể dùng thay thế; chưa spawn Nano Banana worker.".to_string(),
            network_probe_performed: true,
            side_effects_started: false,
        }
    }
}

fn classify_nanobanana_report(raw_report: &Value) -> (Option<String>, Option<String>) {
    let errors = raw_report
        .get("errors")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .take(4)
                .collect::<Vec<_>>()
                .join(" | ")
        })
        .unwrap_or_default();
    if errors.is_empty() {
        return (None, None);
    }
    let lower = errors.to_ascii_lowercase();
    let code = if lower.contains("initialize")
        && (lower.contains("timeout") || lower.contains("timed out"))
    {
        Some("MCP_INITIALIZE_TIMEOUT".to_string())
    } else if lower.contains("cdp") && (lower.contains("connect") || lower.contains("websocket")) {
        Some("CDP_CONNECTION_FAILED".to_string())
    } else if lower.contains("timeout") || lower.contains("timed out") {
        Some("MCP_TIMEOUT".to_string())
    } else {
        Some("MCP_WORKER_FAILED".to_string())
    };
    (code, Some(errors.chars().take(900).collect()))
}

fn comfy_ui_health_check(endpoint: &str) -> ComfyUiHealthReport {
    let parsed = parse_loopback_endpoint(endpoint);
    let (normalized_endpoint, address) = match parsed {
        Ok(value) => value,
        Err(message) => {
            return ComfyUiHealthReport {
                endpoint: endpoint.trim().to_string(),
                status: "blocked".to_string(),
                http_status: None,
                message,
                network_probe_performed: false,
                side_effects_started: false,
            }
        }
    };
    let mut stream = match TcpStream::connect_timeout(&address, Duration::from_millis(1500)) {
        Ok(stream) => stream,
        Err(_) => {
            return ComfyUiHealthReport {
                endpoint: normalized_endpoint,
                status: "unavailable".to_string(),
                http_status: None,
                message: "Không kết nối được ComfyUI loopback; hãy khởi động ComfyUI trước."
                    .to_string(),
                network_probe_performed: true,
                side_effects_started: false,
            }
        }
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(1500)));
    let host_header = address.ip().to_string();
    let request = format!(
        "GET /system_stats HTTP/1.1\\r\\nHost: {host_header}\\r\\nConnection: close\\r\\n\\r\\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return ComfyUiHealthReport {
            endpoint: normalized_endpoint,
            status: "unavailable".to_string(),
            http_status: None,
            message: "ComfyUI loopback không nhận được health request.".to_string(),
            network_probe_performed: true,
            side_effects_started: false,
        };
    }
    let mut response = Vec::with_capacity(4096);
    let mut buffer = [0_u8; 4096];
    while response.len() < 65_536 {
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => response.extend_from_slice(&buffer[..read]),
            Err(_) => break,
        }
    }
    let response_text = String::from_utf8_lossy(&response);
    let status_line = response_text.lines().next().unwrap_or_default();
    let http_status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u16>().ok());
    let healthy = http_status == Some(200);
    ComfyUiHealthReport {
        endpoint: normalized_endpoint,
        status: if healthy { "ready" } else { "unhealthy" }.to_string(),
        http_status,
        message: if healthy {
            "ComfyUI loopback health endpoint phản hồi.".to_string()
        } else {
            "ComfyUI loopback đã phản hồi nhưng health endpoint không trả HTTP 200.".to_string()
        },
        network_probe_performed: true,
        side_effects_started: false,
    }
}

#[tauri::command]
fn check_comfyui_health(endpoint: Option<String>) -> Result<ComfyUiHealthReport, String> {
    let endpoint = endpoint.unwrap_or_else(|| "http://127.0.0.1:8188".to_string());
    valid_text(&endpoint, "ComfyUI endpoint")?;
    Ok(comfy_ui_health_check(&endpoint))
}

#[tauri::command]
fn app_snapshot(state: State<'_, AppState>) -> Result<AppSnapshot, String> {
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
        paid_generation_enabled: state.cloud_generation_enabled.load(Ordering::Acquire),
    })
}

#[tauri::command]
fn set_cloud_generation_enabled(enabled: bool, state: State<'_, AppState>) -> Result<bool, String> {
    state
        .cloud_generation_enabled
        .store(enabled, Ordering::Release);
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database để ghi audit".to_string())?;
    audit_event(
        &connection,
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
    Ok(enabled)
}

#[tauri::command]
fn health_check(state: State<'_, AppState>) -> Result<HealthStatus, String> {
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

#[tauri::command]
fn list_tool_readiness(state: State<'_, AppState>) -> Result<ToolReadinessReport, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    tool_readiness_report(&connection)
}

#[tauri::command]
fn preview_worker_launch(
    attempt_id: String,
    state: State<'_, AppState>,
) -> Result<WorkerLaunchPlan, String> {
    valid_text(&attempt_id, "Attempt ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let (job_id, attempt_number, state_name, executable_id, timeout_seconds, process_started, side_effect_unknown): (String, i64, String, Option<String>, i64, i64, i64) = connection
        .query_row(
            "SELECT job_id, attempt_number, state, executable_id, timeout_seconds, process_started, external_side_effect_unknown FROM job_attempts WHERE attempt_id = ?1",
            params![attempt_id.trim()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?)),
        )
        .map_err(|error| format!("Không đọc được attempt: {error}"))?;
    let expected_output_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM job_outputs WHERE attempt_id = ?1",
            params![attempt_id.trim()],
            |row| row.get(0),
        )
        .map_err(|error| format!("Không đọc được expected outputs: {error}"))?;
    let readiness = tool_readiness_report(&connection)?;
    let mut blockers = Vec::new();
    if state_name != "pending" {
        blockers.push(format!("Attempt không ở trạng thái pending: {state_name}"));
    }
    match executable_id.as_deref() {
        Some(tool_id) => {
            if let Some(tool) = readiness.tools.iter().find(|tool| tool.tool_id == tool_id) {
                if !tool.available {
                    blockers.push(format!("Tool chưa available: {tool_id}"));
                }
            } else {
                blockers.push(format!("Tool không nằm trong readiness catalog: {tool_id}"));
            }
        }
        None => blockers.push("Attempt chưa có executable reference".to_string()),
    }
    blockers.push(
        "External worker gate đang khóa cho tới khi fixture và output-reconciliation verification pass"
            .to_string(),
    );
    Ok(WorkerLaunchPlan {
        attempt_id: attempt_id.trim().to_string(),
        job_id,
        attempt_number,
        state: state_name,
        executable_id,
        timeout_seconds,
        expected_output_count,
        can_start: false,
        blockers,
        process_started: process_started != 0,
        external_side_effect_unknown: side_effect_unknown != 0,
    })
}

#[tauri::command]
fn worker_preflight(state: State<'_, AppState>) -> Result<WorkerPreflightReport, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let readiness = tool_readiness_report(&connection)?;
    let mut blockers = readiness
        .required_missing
        .iter()
        .map(|tool| format!("Thiếu required tool: {tool}"))
        .collect::<Vec<_>>();
    blockers.push(
        "External worker gate chưa mở: cần fixture và output-reconciliation verification"
            .to_string(),
    );
    Ok(WorkerPreflightReport {
        ready_to_start: false,
        blockers,
        checks: vec![
            "Executable references được kiểm tra theo allowlist và file/PATH metadata".to_string(),
            "Không spawn external process trong preflight".to_string(),
            "Không probe network và không gọi provider".to_string(),
            "Publish và paid generation vẫn bị khóa".to_string(),
        ],
        external_processes_started: false,
        network_probe_performed: false,
        publish_enabled: false,
        paid_generation_enabled: state.cloud_generation_enabled.load(Ordering::Acquire),
    })
}

#[tauri::command]
fn save_tool_config(
    tool_id: String,
    executable_ref: String,
    required: bool,
    state: State<'_, AppState>,
) -> Result<ToolReadinessView, String> {
    validate_tool_id(&tool_id)?;
    let executable_ref = validate_executable_ref(&executable_ref)?;
    let timestamp = now_string();
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    connection
        .execute(
            "INSERT INTO tool_configs(tool_id, executable_ref, required, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4) ON CONFLICT(tool_id) DO UPDATE SET executable_ref = excluded.executable_ref, required = excluded.required, updated_at = excluded.updated_at",
            params![tool_id.trim(), executable_ref, required as i64, timestamp],
        )
        .map_err(|error| error.to_string())?;
    audit_event(
        &connection,
        None,
        "tool_config.updated",
        "tool",
        tool_id.trim(),
    )?;
    tool_readiness_report(&connection)?
        .tools
        .into_iter()
        .find(|tool| tool.tool_id == tool_id.trim())
        .ok_or_else(|| "Không đọc được tool config vừa lưu".to_string())
}

#[tauri::command]
fn list_projects(state: State<'_, AppState>) -> Result<Vec<ProjectView>, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let mut statement = connection
        .prepare("SELECT project_id, name, locale, workspace_root, policy_profile, updated_at FROM projects ORDER BY updated_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(ProjectView {
                project_id: row.get(0)?,
                name: row.get(1)?,
                locale: row.get(2)?,
                workspace_root: row.get(3)?,
                policy_profile: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn create_project(
    name: String,
    workspace_root: String,
    state: State<'_, AppState>,
) -> Result<ProjectView, String> {
    valid_text(&name, "Tên project")?;
    let workspace_root = prepare_workspace_root(&workspace_root)?;
    let project_id = now_id("project");
    let timestamp = now_string();
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    connection
        .execute(
            "INSERT INTO projects(project_id, name, locale, workspace_root, policy_profile, created_at, updated_at) VALUES (?1, ?2, 'vi-VN', ?3, 'safe-local', ?4, ?4)",
            params![project_id, name.trim(), workspace_root, timestamp],
        )
        .map_err(|error| error.to_string())?;

    Ok(ProjectView {
        project_id,
        name: name.trim().to_string(),
        locale: "vi-VN".to_string(),
        workspace_root,
        policy_profile: "safe-local".to_string(),
        updated_at: timestamp,
    })
}

#[tauri::command]
fn delete_project(project_id: String, state: State<'_, AppState>) -> Result<(), String> {
    valid_text(&project_id, "Project ID")?;
    if project_id.trim() == "project-default" {
        return Err("Không thể xoá project mặc định của ứng dụng".to_string());
    }
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let deleted = connection
        .execute(
            "DELETE FROM projects WHERE project_id = ?1",
            params![project_id.trim()],
        )
        .map_err(|error| error.to_string())?;
    if deleted == 0 {
        return Err("Project không tồn tại hoặc đã được xoá".to_string());
    }
    audit_event(
        &connection,
        None,
        "project.deleted",
        "project",
        project_id.trim(),
    )?;
    Ok(())
}

#[tauri::command]
fn list_jobs(state: State<'_, AppState>) -> Result<Vec<JobView>, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let mut statement = connection
        .prepare("SELECT job_id, project_id, kind, state, progress, attempt_count, created_at FROM jobs ORDER BY created_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(JobView {
                job_id: row.get(0)?,
                project_id: row.get(1)?,
                kind: row.get(2)?,
                state: row.get(3)?,
                progress: row.get(4)?,
                attempt_count: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn enqueue_mock_job(
    project_id: String,
    recipe_kind: String,
    state: State<'_, AppState>,
) -> Result<JobView, String> {
    valid_text(&project_id, "Project ID")?;
    valid_text(&recipe_kind, "Recipe")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let exists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE project_id = ?1",
            params![project_id.trim()],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if exists == 0 {
        return Err("Project không tồn tại".to_string());
    }

    let job_id = now_id("job");
    let timestamp = now_string();
    connection
        .execute(
            "INSERT INTO jobs(job_id, project_id, kind, state, progress, attempt_count, created_at) VALUES (?1, ?2, ?3, 'queued', 0.0, 0, ?4)",
            params![job_id, project_id.trim(), recipe_kind.trim(), timestamp],
        )
        .map_err(|error| error.to_string())?;
    audit_event(
        &connection,
        Some(project_id.trim()),
        "job.created",
        "job",
        &job_id,
    )?;
    let _running = transition_job_locked(&connection, &job_id, "running", None)?;
    let succeeded_job = transition_job_locked(&connection, &job_id, "succeeded", None)?;
    let attempt_id = now_id("attempt");
    let timestamp = now_string();
    connection
        .execute(
            "INSERT INTO job_attempts(attempt_id, job_id, attempt_number, state, executable_id, execution_mode, timeout_seconds, max_log_bytes, process_started, external_side_effect_unknown, retryable, finished_at, created_at, updated_at) VALUES (?1, ?2, 1, 'succeeded', 'mock', 'in_process_mock', 60, 1048576, 0, 0, 0, ?3, ?3, ?3)",
            params![attempt_id, job_id, timestamp],
        )
        .map_err(|error| format!("Không ghi được mock execution attempt: {error}"))?;
    audit_event(
        &connection,
        Some(project_id.trim()),
        "attempt.mock_succeeded",
        "attempt",
        &attempt_id,
    )?;
    Ok(succeeded_job)
}

#[tauri::command]
fn enqueue_pending_job(
    project_id: String,
    recipe_kind: String,
    state: State<'_, AppState>,
) -> Result<JobView, String> {
    valid_text(&project_id, "Project ID")?;
    valid_text(&recipe_kind, "Recipe")?;
    let _preview = preview_recipe(recipe_kind.clone())?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let exists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE project_id = ?1",
            params![project_id.trim()],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if exists == 0 {
        return Err("Project không tồn tại".to_string());
    }

    let job_id = now_id("job");
    let timestamp = now_string();
    connection
        .execute(
            "INSERT INTO jobs(job_id, project_id, kind, state, progress, attempt_count, created_at) VALUES (?1, ?2, ?3, 'queued', 0.0, 0, ?4)",
            params![job_id, project_id.trim(), recipe_kind.trim(), timestamp],
        )
        .map_err(|error| error.to_string())?;
    audit_event(
        &connection,
        Some(project_id.trim()),
        "job.pending_created",
        "job",
        &job_id,
    )?;
    fetch_job(&connection, &job_id)
}

#[tauri::command]
fn prepare_pending_attempt(
    job_id: String,
    executable_id: Option<String>,
    timeout_seconds: u64,
    outputs: Vec<PendingOutputSpec>,
    state: State<'_, AppState>,
) -> Result<AttemptView, String> {
    valid_text(&job_id, "Job ID")?;
    if timeout_seconds == 0 || timeout_seconds > 604_800 {
        return Err("Timeout phải nằm trong khoảng 1..604800 giây".to_string());
    }
    if outputs.len() > 256 {
        return Err("Không được có quá 256 expected outputs".to_string());
    }
    if let Some(executable) = executable_id.as_deref() {
        if !matches!(
            executable,
            "blender" | "ffmpeg" | "ffprobe" | "node" | "obs" | "python"
        ) {
            return Err(format!("Executable chưa được allowlist: {executable}"));
        }
    }
    let mut normalized_outputs: Vec<(String, String)> = Vec::with_capacity(outputs.len());
    for output in outputs {
        let relative_path = validate_attempt_output_path(&output.relative_path)?;
        validate_attempt_media_kind(output.media_kind.trim())?;
        if normalized_outputs
            .iter()
            .any(|existing| existing.0 == relative_path)
        {
            return Err(format!("Expected output bị trùng: {relative_path}"));
        }
        normalized_outputs.push((relative_path, output.media_kind.trim().to_string()));
    }

    let mut connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Không mở được transaction: {error}"))?;
    let (project_id, current_state, attempt_count): (String, String, i64) = transaction
        .query_row(
            "SELECT project_id, state, attempt_count FROM jobs WHERE job_id = ?1",
            params![job_id.trim()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| format!("Không đọc được job: {error}"))?;
    if current_state != "queued" {
        return Err(format!(
            "Chỉ có thể chuẩn bị attempt cho job queued; hiện tại là {current_state}"
        ));
    }
    let active_attempts: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM job_attempts WHERE job_id = ?1 AND state IN ('pending', 'running', 'cancel_requested')",
            params![job_id.trim()],
            |row| row.get(0),
        )
        .map_err(|error| format!("Không đọc được attempt đang hoạt động: {error}"))?;
    if active_attempts > 0 {
        return Err("Job đã có execution attempt đang hoạt động".to_string());
    }
    let attempt_number = attempt_count + 1;
    if !(1..=10).contains(&attempt_number) {
        return Err("Số attempt vượt quá giới hạn 10".to_string());
    }
    let attempt_id = now_id("attempt");
    let timestamp = now_string();
    transaction
        .execute(
            "INSERT INTO job_attempts(attempt_id, job_id, attempt_number, state, executable_id, timeout_seconds, max_log_bytes, process_started, external_side_effect_unknown, retryable, created_at, updated_at) VALUES (?1, ?2, ?3, 'pending', ?4, ?5, 1048576, 0, 0, 0, ?6, ?6)",
            params![
                attempt_id,
                job_id.trim(),
                attempt_number,
                executable_id,
                timeout_seconds as i64,
                timestamp
            ],
        )
        .map_err(|error| format!("Không tạo được execution attempt: {error}"))?;
    for (index, (relative_path, media_kind)) in normalized_outputs.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO job_outputs(output_id, attempt_id, relative_path, media_kind, validation_state, created_at) VALUES (?1, ?2, ?3, ?4, 'pending', ?5)",
                params![
                    format!("{}-{index}", now_id("output")),
                    attempt_id,
                    relative_path,
                    media_kind,
                    timestamp
                ],
            )
            .map_err(|error| format!("Không tạo được expected output: {error}"))?;
    }
    transaction
        .execute(
            "UPDATE jobs SET attempt_count = ?1 WHERE job_id = ?2 AND state = 'queued'",
            params![attempt_number, job_id.trim()],
        )
        .map_err(|error| format!("Không cập nhật được attempt count của job: {error}"))?;
    audit_event(
        &transaction,
        Some(&project_id),
        "job.attempt_prepared",
        "attempt",
        &attempt_id,
    )?;
    transaction
        .commit()
        .map_err(|error| format!("Không commit được execution attempt: {error}"))?;
    fetch_attempt(&connection, &attempt_id)
}

#[tauri::command]
fn list_job_attempts(
    job_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<AttemptView>, String> {
    valid_text(&job_id, "Job ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let mut statement = connection
        .prepare("SELECT attempt_id, job_id, attempt_number, state, executable_id, execution_mode, timeout_seconds, process_started, external_side_effect_unknown, created_at, updated_at FROM job_attempts WHERE job_id = ?1 ORDER BY attempt_number DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![job_id.trim()], |row| {
            Ok(AttemptView {
                attempt_id: row.get(0)?,
                job_id: row.get(1)?,
                attempt_number: row.get(2)?,
                state: row.get(3)?,
                executable_id: row.get(4)?,
                execution_mode: row.get(5)?,
                timeout_seconds: row.get(6)?,
                process_started: row.get::<_, i64>(7)? == 1,
                external_side_effect_unknown: row.get::<_, i64>(8)? == 1,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Không đọc được execution attempts: {error}"))
}

#[tauri::command]
fn list_audit_events(
    project_id: Option<String>,
    limit: u32,
    state: State<'_, AppState>,
) -> Result<Vec<AuditEventView>, String> {
    if limit == 0 || limit > 100 {
        return Err("Audit limit phải nằm trong khoảng 1..100".to_string());
    }
    if let Some(project) = project_id.as_deref() {
        valid_text(project, "Project ID")?;
    }
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let limit = limit as i64;
    let mut events = Vec::new();
    if let Some(project) = project_id.as_deref() {
        let mut statement = connection
            .prepare("SELECT event_id, project_id, event_type, subject_type, subject_id, created_at FROM audit_events WHERE project_id = ?1 ORDER BY created_at DESC, event_id DESC LIMIT ?2")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![project.trim(), limit], |row| {
                Ok(AuditEventView {
                    event_id: row.get(0)?,
                    project_id: row.get(1)?,
                    event_type: row.get(2)?,
                    subject_type: row.get(3)?,
                    subject_id: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })
            .map_err(|error| error.to_string())?;
        for row in rows {
            events.push(row.map_err(|error| error.to_string())?);
        }
    } else {
        let mut statement = connection
            .prepare("SELECT event_id, project_id, event_type, subject_type, subject_id, created_at FROM audit_events ORDER BY created_at DESC, event_id DESC LIMIT ?1")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![limit], |row| {
                Ok(AuditEventView {
                    event_id: row.get(0)?,
                    project_id: row.get(1)?,
                    event_type: row.get(2)?,
                    subject_type: row.get(3)?,
                    subject_id: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })
            .map_err(|error| error.to_string())?;
        for row in rows {
            events.push(row.map_err(|error| error.to_string())?);
        }
    }
    Ok(events)
}

#[tauri::command]
fn list_attempt_outputs(
    attempt_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<AttemptOutputView>, String> {
    valid_text(&attempt_id, "Attempt ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let mut statement = connection
        .prepare("SELECT output_id, attempt_id, relative_path, media_kind, validation_state, validation_message FROM job_outputs WHERE attempt_id = ?1 ORDER BY relative_path")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![attempt_id.trim()], |row| {
            Ok(AttemptOutputView {
                output_id: row.get(0)?,
                attempt_id: row.get(1)?,
                relative_path: row.get(2)?,
                media_kind: row.get(3)?,
                validation_state: row.get(4)?,
                validation_message: row.get(5)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Không đọc được output evidence: {error}"))
}

#[tauri::command]
fn preview_process(spec: ProcessSpec) -> Result<ProcessDryRunPlan, String> {
    plan_process_dry_run(spec)
}

#[tauri::command]
fn retry_job(job_id: String, state: State<'_, AppState>) -> Result<JobView, String> {
    valid_text(&job_id, "Job ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    transition_job_locked(&connection, job_id.trim(), "queued", None)
}

#[tauri::command]
fn cancel_job(job_id: String, state: State<'_, AppState>) -> Result<JobView, String> {
    valid_text(&job_id, "Job ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let current_state: String = connection
        .query_row(
            "SELECT state FROM jobs WHERE job_id = ?1",
            params![job_id.trim()],
            |row| row.get(0),
        )
        .map_err(|error| format!("Không đọc được job: {error}"))?;
    let next_state = match current_state.as_str() {
        "queued" => "cancelled",
        "running" => "cancel_requested",
        "cancel_requested" => "cancelled",
        _ => return Err(format!("Không thể hủy job đang ở state {current_state}")),
    };
    let job = transition_job_locked(&connection, job_id.trim(), next_state, None)?;
    drop(connection);
    if current_state == "running" {
        request_attempt_cancel(&state, job_id.trim())?;
    }
    Ok(job)
}

#[tauri::command]
fn list_recipe_catalog() -> Vec<RecipeCatalogItem> {
    vec![
        RecipeCatalogItem {
            recipe_kind: "image_slideshow".to_string(),
            name: "2D slideshow hình ảnh".to_string(),
            worker: "FFmpeg / Remotion".to_string(),
            local_first: true,
            requires_approval: true,
        },
        RecipeCatalogItem {
            recipe_kind: "html_to_video".to_string(),
            name: "HTML / React thành video".to_string(),
            worker: "Remotion".to_string(),
            local_first: true,
            requires_approval: true,
        },
        RecipeCatalogItem {
            recipe_kind: "voiceover_package".to_string(),
            name: "Lồng tiếng và phụ đề".to_string(),
            worker: "Piper / TTS adapter / Whisper".to_string(),
            local_first: true,
            requires_approval: true,
        },
        RecipeCatalogItem {
            recipe_kind: "screen_demo".to_string(),
            name: "Quay màn hình / demo".to_string(),
            worker: "OBS / FFmpeg".to_string(),
            local_first: true,
            requires_approval: true,
        },
        RecipeCatalogItem {
            recipe_kind: "hybrid_2d_3d".to_string(),
            name: "Hybrid 2D–3D".to_string(),
            worker: "Blender + Remotion + FFmpeg".to_string(),
            local_first: true,
            requires_approval: true,
        },
        RecipeCatalogItem {
            recipe_kind: "true_3d".to_string(),
            name: "True 3D Blender".to_string(),
            worker: "Blender CLI/Python".to_string(),
            local_first: true,
            requires_approval: true,
        },
        RecipeCatalogItem {
            recipe_kind: "ai_video_shot".to_string(),
            name: "AI video shot".to_string(),
            worker: "ComfyUI / cloud adapter".to_string(),
            local_first: false,
            requires_approval: true,
        },
    ]
}

#[tauri::command]
fn validate_recipe_json(recipe_json: String) -> Result<RecipeValidationResult, String> {
    valid_text(&recipe_json, "Recipe JSON")?;
    let document: RecipeDocument = serde_json::from_str(&recipe_json)
        .map_err(|error| format!("Recipe JSON không hợp lệ: {error}"))?;
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    if document.schema_version != "1.0.0" {
        errors.push("schemaVersion phải là 1.0.0 trong P0".to_string());
    }
    if document.recipe_id.trim().is_empty() {
        errors.push("recipeId không được để trống".to_string());
    }
    if document.kind.trim().is_empty() {
        errors.push("kind không được để trống".to_string());
    }
    if !(1..=240).contains(&document.fps) {
        errors.push("fps phải nằm trong khoảng 1..240".to_string());
    }
    if !(160..=7680).contains(&document.width) || !(160..=7680).contains(&document.height) {
        errors.push("width/height phải nằm trong khoảng 160..7680".to_string());
    }
    if !(0.1..=3600.0).contains(&document.duration_seconds) {
        errors.push("durationSeconds phải nằm trong khoảng 0.1..3600".to_string());
    }
    if document.policy.external_publish {
        errors.push("externalPublish bị khóa trong P0".to_string());
    }
    if document.policy.paid_generation {
        errors.push("paidGeneration cần approval flow và chưa được bật trong P0".to_string());
    }
    if !document.policy.rights_required {
        warnings.push(
            "Recipe chưa khai báo rightsRequired=true; delivery sẽ cần review bổ sung".to_string(),
        );
    }
    if !document.policy.human_review_required {
        warnings.push("Recipe chưa khai báo humanReviewRequired=true".to_string());
    }

    Ok(RecipeValidationResult {
        valid: errors.is_empty(),
        recipe_id: document.recipe_id,
        recipe_kind: document.kind,
        errors,
        warnings,
        external_side_effects_blocked: true,
    })
}

#[tauri::command]
fn preview_recipe(recipe_kind: String) -> Result<MockRecipePreview, String> {
    valid_text(&recipe_kind, "Recipe")?;
    let stages = match recipe_kind.trim() {
        "image_slideshow" => vec![
            "asset_preflight",
            "timeline_compile",
            "image_sequence",
            "audio_captions",
            "compose",
            "review",
        ],
        "html_to_video" => vec![
            "data_validate",
            "composition_compile",
            "html_render",
            "audio_captions",
            "compose",
            "review",
        ],
        "voiceover_package" => vec![
            "script_normalize",
            "voiceover",
            "transcribe",
            "caption_export",
            "mux",
            "review",
        ],
        "screen_demo" => vec![
            "capture_preflight",
            "privacy_gate",
            "screen_capture",
            "normalize",
            "review",
        ],
        "hybrid_2d_3d" => vec![
            "asset_preflight",
            "blender_preview",
            "overlay_render",
            "compose",
            "review",
        ],
        "true_3d" => vec![
            "asset_preflight",
            "scene_validate",
            "blender_render",
            "probe",
            "review",
        ],
        "ai_video_shot" => vec![
            "rights_preflight",
            "budget_gate",
            "provider_preview",
            "output_probe",
            "review",
        ],
        other => return Err(format!("Recipe chưa được hỗ trợ: {other}")),
    }
    .into_iter()
    .map(str::to_string)
    .collect::<Vec<_>>();

    Ok(MockRecipePreview {
        recipe_kind: recipe_kind.trim().to_string(),
        stages,
        paid_generation_blocked: true,
        external_publish_blocked: true,
        external_processes_not_started: true,
        message: "Mock preview hợp lệ; chưa gọi API và chưa chạy process ngoài.".to_string(),
    })
}

#[tauri::command]
fn get_provider_env_snapshot(state: State<'_, AppState>) -> provider_config::ProviderEnvSnapshot {
    let mut snapshot = provider_config::load_provider_env_snapshot();
    snapshot.cloud_requests_blocked = !state.cloud_generation_enabled.load(Ordering::Acquire);
    snapshot
}

#[tauri::command]
fn list_topic_profiles() -> Result<Vec<TopicProfileView>, String> {
    let registry: TopicProfileRegistry = serde_json::from_str(TOPIC_PROFILE_REGISTRY)
        .map_err(|error| format!("topic profile registry không hợp lệ: {error}"))?;
    if registry.schema_version != "1.0.0" {
        return Err("topic profile registry dùng schemaVersion không hỗ trợ".to_string());
    }
    Ok(registry.profiles)
}

#[tauri::command]
fn list_prompt_templates() -> Result<Vec<PromptTemplateView>, String> {
    let registry: PromptTemplateRegistry = serde_json::from_str(PROMPT_TEMPLATE_REGISTRY)
        .map_err(|error| format!("prompt template registry không hợp lệ: {error}"))?;
    if registry.schema_version != "1.0.0" {
        return Err("prompt template registry dùng schemaVersion không hỗ trợ".to_string());
    }
    Ok(registry.templates)
}

fn validate_prompt_preset_input(input: &PromptPresetInput) -> Result<(), String> {
    valid_text(&input.name, "Tên preset")?;
    valid_text(&input.template, "Prompt preset")?;
    if input.name.chars().count() > 120 {
        return Err("Tên preset vượt quá 120 ký tự".to_string());
    }
    for (value, field, max_len) in [
        (&input.description, "Mô tả preset", 500usize),
        (&input.template, "Prompt preset", 16_000usize),
        (&input.negative_template, "Negative prompt", 8_000usize),
        (&input.rights_license_note, "Ghi chú quyền", 1_000usize),
    ] {
        if value.chars().count() > max_len {
            return Err(format!("{field} vượt quá {max_len} ký tự"));
        }
        if value.contains('\0') || preview_secret_like(value) {
            return Err(format!("{field} chứa ký tự hoặc thông tin không hợp lệ"));
        }
    }
    if input.scope != "project" && input.scope != "user" {
        return Err("Scope preset chỉ nhận project hoặc user".to_string());
    }
    if input.status != "draft" && input.status != "active" {
        return Err("Preset mới chỉ nhận trạng thái draft hoặc active".to_string());
    }
    let version_parts = input
        .version
        .strip_prefix('v')
        .unwrap_or("")
        .split('.')
        .collect::<Vec<_>>();
    if version_parts.len() != 3
        || version_parts
            .iter()
            .any(|part| part.is_empty() || part.parse::<u64>().is_err())
    {
        return Err("Version preset phải có dạng v1.0.0".to_string());
    }
    if input.variable_keys.len() > 64 {
        return Err("Preset chỉ được có tối đa 64 biến".to_string());
    }
    let mut unique_keys = std::collections::HashSet::new();
    for key in &input.variable_keys {
        if key.is_empty()
            || key.len() > 80
            || !key
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        {
            return Err(format!("Tên biến không hợp lệ: {key}"));
        }
        if !unique_keys.insert(key) {
            return Err(format!("Biến bị lặp: {key}"));
        }
    }
    if input.provider_targets.len() > 32 {
        return Err("Preset chỉ được có tối đa 32 provider target".to_string());
    }
    let mut unique_targets = std::collections::HashSet::new();
    for target in &input.provider_targets {
        valid_text(target, "Provider target")?;
        if target.chars().count() > 120 || !unique_targets.insert(target) {
            return Err(format!(
                "Provider target không hợp lệ hoặc bị lặp: {target}"
            ));
        }
    }
    if input.project_id.trim().is_empty()
        || input.project_id.len() > 120
        || preview_secret_like(&input.project_id)
    {
        return Err("Project ID không hợp lệ".to_string());
    }
    if let Some(style_bible_id) = &input.style_bible_id {
        if style_bible_id.len() > 120 || style_bible_id.contains('\0') {
            return Err("Style bible ID không hợp lệ".to_string());
        }
    }
    if let Some(parent_preset_id) = &input.parent_preset_id {
        if parent_preset_id.len() > 120 || parent_preset_id.contains('\0') {
            return Err("Parent preset ID không hợp lệ".to_string());
        }
    }
    Ok(())
}

struct PromptPresetDbRow {
    preset_id: String,
    project_id: String,
    name: String,
    description: String,
    scope: String,
    status: String,
    version: String,
    template: String,
    variable_keys_json: String,
    negative_template: String,
    provider_targets_json: String,
    style_bible_id: Option<String>,
    rights_license_note: String,
    parent_preset_id: Option<String>,
    created_at: String,
    updated_at: String,
    archived_at: Option<String>,
}

fn decode_prompt_preset(row: PromptPresetDbRow) -> Result<PromptPresetView, String> {
    let variable_keys = serde_json::from_str::<Vec<String>>(&row.variable_keys_json)
        .map_err(|error| format!("Prompt preset có variableKeys hỏng: {error}"))?;
    let provider_targets = serde_json::from_str::<Vec<String>>(&row.provider_targets_json)
        .map_err(|error| format!("Prompt preset có providerTargets hỏng: {error}"))?;
    Ok(PromptPresetView {
        schema_version: "1.0.0".to_string(),
        preset_id: row.preset_id,
        project_id: row.project_id,
        name: row.name,
        description: row.description,
        scope: row.scope,
        status: row.status,
        version: row.version,
        template: row.template,
        variable_keys,
        negative_template: row.negative_template,
        provider_targets,
        style_bible_id: row.style_bible_id,
        rights_license_note: row.rights_license_note,
        parent_preset_id: row.parent_preset_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        archived_at: row.archived_at,
    })
}

fn bump_prompt_preset_version(version: &str) -> String {
    let parts = version
        .strip_prefix('v')
        .unwrap_or("1.0.0")
        .split('.')
        .map(|part| part.parse::<u64>().unwrap_or(0))
        .collect::<Vec<_>>();
    if parts.len() == 3 {
        format!("v{}.{}.{}", parts[0], parts[1], parts[2].saturating_add(1))
    } else {
        "v1.0.1".to_string()
    }
}

fn prompt_preset_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PromptPresetDbRow> {
    Ok(PromptPresetDbRow {
        preset_id: row.get(0)?,
        project_id: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        scope: row.get(4)?,
        status: row.get(5)?,
        version: row.get(6)?,
        template: row.get(7)?,
        variable_keys_json: row.get(8)?,
        negative_template: row.get(9)?,
        provider_targets_json: row.get(10)?,
        style_bible_id: row.get(11)?,
        rights_license_note: row.get(12)?,
        parent_preset_id: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
        archived_at: row.get(16)?,
    })
}

fn prompt_preset_select_sql() -> &'static str {
    "SELECT preset_id, project_id, name, description, scope, status, version, template, variable_keys_json, negative_template, provider_targets_json, style_bible_id, rights_license_note, parent_preset_id, created_at, updated_at, archived_at FROM prompt_presets"
}

fn fetch_prompt_preset(
    connection: &Connection,
    preset_id: &str,
) -> Result<PromptPresetView, String> {
    let sql = format!("{} WHERE preset_id = ?1", prompt_preset_select_sql());
    let row = connection
        .query_row(&sql, params![preset_id], prompt_preset_row)
        .map_err(|error| format!("Không đọc được prompt preset: {error}"))?;
    decode_prompt_preset(row)
}

fn ensure_project_exists(connection: &Connection, project_id: &str) -> Result<(), String> {
    let exists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE project_id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if exists == 0 {
        return Err("Project không tồn tại".to_string());
    }
    Ok(())
}

#[tauri::command]
fn list_prompt_presets(
    project_id: String,
    include_archived: bool,
    state: State<'_, AppState>,
) -> Result<Vec<PromptPresetView>, String> {
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
        prompt_preset_select_sql(),
        suffix
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![project_id.trim()], prompt_preset_row)
        .map_err(|error| error.to_string())?;
    let raw = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    raw.into_iter().map(decode_prompt_preset).collect()
}

fn insert_prompt_preset(
    connection: &Connection,
    preset_id: &str,
    input: &PromptPresetInput,
    parent_preset_id: Option<&str>,
) -> Result<PromptPresetView, String> {
    let timestamp = now_string();
    let variable_keys =
        serde_json::to_string(&input.variable_keys).map_err(|error| error.to_string())?;
    let provider_targets =
        serde_json::to_string(&input.provider_targets).map_err(|error| error.to_string())?;
    connection.execute(
        "INSERT INTO prompt_presets(preset_id, project_id, name, description, scope, status, version, template, variable_keys_json, negative_template, provider_targets_json, style_bible_id, rights_license_note, parent_preset_id, created_at, updated_at, archived_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15, NULL)",
        params![preset_id, input.project_id.trim(), input.name.trim(), input.description.trim(), input.scope.trim(), input.status.trim(), input.version.trim(), input.template.trim(), variable_keys, input.negative_template.trim(), provider_targets, input.style_bible_id.as_deref().map(str::trim).filter(|value| !value.is_empty()), input.rights_license_note.trim(), parent_preset_id, timestamp],
    ).map_err(|error| format!("Không lưu được prompt preset: {error}"))?;
    fetch_prompt_preset(connection, preset_id)
}

#[tauri::command]
fn create_prompt_preset(
    input: PromptPresetInput,
    state: State<'_, AppState>,
) -> Result<PromptPresetView, String> {
    validate_prompt_preset_input(&input)?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    ensure_project_exists(&connection, input.project_id.trim())?;
    if let Some(parent_id) = &input.parent_preset_id {
        let parent = fetch_prompt_preset(&connection, parent_id)?;
        if parent.project_id != input.project_id.trim() {
            return Err("Parent preset phải thuộc cùng project".to_string());
        }
    }
    let preset_id = now_id("prompt-preset");
    let preset = insert_prompt_preset(
        &connection,
        &preset_id,
        &input,
        input.parent_preset_id.as_deref(),
    )?;
    audit_event(
        &connection,
        Some(input.project_id.trim()),
        "prompt_preset.created",
        "prompt_preset",
        &preset_id,
    )?;
    Ok(preset)
}

#[tauri::command]
fn update_prompt_preset(
    preset_id: String,
    input: PromptPresetInput,
    state: State<'_, AppState>,
) -> Result<PromptPresetView, String> {
    valid_text(&preset_id, "Preset ID")?;
    validate_prompt_preset_input(&input)?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let current = fetch_prompt_preset(&connection, preset_id.trim())?;
    if current.project_id != input.project_id.trim() {
        return Err("Không thể sửa preset khác project".to_string());
    }
    if current.status == "archived" {
        return Err("Không thể sửa preset đã lưu trữ; hãy khôi phục trước".to_string());
    }
    let next_id = now_id("prompt-preset");
    let mut next_input = input.clone();
    if next_input.version == current.version {
        next_input.version = bump_prompt_preset_version(&current.version);
    }
    let preset = insert_prompt_preset(
        &connection,
        &next_id,
        &next_input,
        Some(current.preset_id.as_str()),
    )?;
    audit_event(
        &connection,
        Some(input.project_id.trim()),
        "prompt_preset.updated",
        "prompt_preset",
        &next_id,
    )?;
    Ok(preset)
}

#[tauri::command]
fn archive_prompt_preset(
    project_id: String,
    preset_id: String,
    state: State<'_, AppState>,
) -> Result<PromptPresetView, String> {
    valid_text(&project_id, "Project ID")?;
    valid_text(&preset_id, "Preset ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let current = fetch_prompt_preset(&connection, preset_id.trim())?;
    if current.project_id != project_id.trim() {
        return Err("Không thể lưu trữ preset khác project".to_string());
    }
    let archived_at = now_string();
    connection.execute("UPDATE prompt_presets SET status = 'archived', archived_at = ?1, updated_at = ?1 WHERE preset_id = ?2", params![archived_at, preset_id.trim()]).map_err(|error| error.to_string())?;
    audit_event(
        &connection,
        Some(project_id.trim()),
        "prompt_preset.archived",
        "prompt_preset",
        preset_id.trim(),
    )?;
    fetch_prompt_preset(&connection, preset_id.trim())
}

#[tauri::command]
fn restore_prompt_preset(
    project_id: String,
    preset_id: String,
    state: State<'_, AppState>,
) -> Result<PromptPresetView, String> {
    valid_text(&project_id, "Project ID")?;
    valid_text(&preset_id, "Preset ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let current = fetch_prompt_preset(&connection, preset_id.trim())?;
    if current.project_id != project_id.trim() {
        return Err("Không thể khôi phục preset khác project".to_string());
    }
    connection.execute("UPDATE prompt_presets SET status = 'active', archived_at = NULL, updated_at = ?1 WHERE preset_id = ?2", params![now_string(), preset_id.trim()]).map_err(|error| error.to_string())?;
    audit_event(
        &connection,
        Some(project_id.trim()),
        "prompt_preset.restored",
        "prompt_preset",
        preset_id.trim(),
    )?;
    fetch_prompt_preset(&connection, preset_id.trim())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AssetView {
    schema_version: String,
    asset_id: String,
    project_id: String,
    title: String,
    relative_path: String,
    sha256: String,
    kind: String,
    mime_type: String,
    size_bytes: i64,
    width: Option<i64>,
    height: Option<i64>,
    duration_seconds: Option<f64>,
    status: String,
    rights_status: String,
    source_uri: Option<String>,
    tags: Vec<String>,
    note: String,
    created_at: String,
    updated_at: String,
    archived_at: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AssetImportInput {
    project_id: String,
    source_path: String,
    title: String,
    media_kind: String,
    source_uri: Option<String>,
    tags: Vec<String>,
    note: String,
    rights_status: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ReferenceVideoDownloadRequest {
    project_id: String,
    source_url: String,
    #[serde(default)]
    download_url: Option<String>,
    title: String,
    rights_status: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ReferenceVideoDownloadReport {
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
struct AssetMetadataInput {
    project_id: String,
    asset_id: String,
    title: String,
    source_uri: Option<String>,
    tags: Vec<String>,
    note: String,
    rights_status: String,
}

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
struct AssetPackReviewView {
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
struct AssetPackBlenderBindingReport {
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
struct AssetPackBlenderBindingRunReport {
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
struct AssetPackSourceInput {
    project_id: String,
    pack_path: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AssetPackReviewUpdateInput {
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

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AssetPreviewView {
    relative_path: String,
    mime_type: String,
    base64_data: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ReferenceAssignmentView {
    assignment_id: String,
    project_id: String,
    reference_set_id: String,
    asset_id: String,
    role: String,
    strength: f64,
    priority: i64,
    shot_id: Option<String>,
    shot_range_start: Option<i64>,
    shot_range_end: Option<i64>,
    crop: Option<String>,
    notes: String,
    approved: bool,
    asset_sha256: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ReferenceSetView {
    schema_version: String,
    reference_set_id: String,
    project_id: String,
    name: String,
    scope: String,
    status: String,
    continuity_note: String,
    assignments: Vec<ReferenceAssignmentView>,
    created_at: String,
    updated_at: String,
    archived_at: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ReferenceSetInput {
    project_id: String,
    name: String,
    scope: String,
    continuity_note: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ReferenceAssignmentInput {
    project_id: String,
    reference_set_id: String,
    asset_id: String,
    role: String,
    strength: f64,
    priority: i64,
    shot_id: Option<String>,
    shot_range_start: Option<i64>,
    shot_range_end: Option<i64>,
    crop: Option<String>,
    notes: String,
    approved: bool,
}

fn validate_asset_kind(value: &str) -> Result<(), String> {
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

fn validate_asset_rights(value: &str) -> Result<(), String> {
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

fn validate_reference_role(value: &str) -> Result<(), String> {
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

fn validate_reference_scope(value: &str) -> Result<(), String> {
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

fn validate_asset_text(value: &str, field: &str, max_len: usize) -> Result<(), String> {
    valid_text(value, field)?;
    if value.chars().count() > max_len || value.contains(['\r', '\n']) || preview_secret_like(value)
    {
        return Err(format!("{field} không hợp lệ hoặc có dấu hiệu secret"));
    }
    Ok(())
}

fn mime_for_asset_path(path: &Path, media_kind: &str) -> Result<String, String> {
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

fn asset_status_for_rights(rights_status: &str) -> &'static str {
    match rights_status {
        "personal" | "owned" | "licensed" | "public_domain" => "ready",
        _ => "quarantined",
    }
}

fn resolve_playwright_module_root() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Some(configured) = std::env::var_os("AUTO3DVIDEO_PLAYWRIGHT_MODULE_ROOT") {
        let configured = PathBuf::from(configured);
        if !configured.as_os_str().is_empty() {
            candidates.push(configured);
        }
    }
    if let Ok(executable) = std::env::current_exe() {
        let mut desktop_root = executable;
        for _ in 0..4 {
            let Some(parent) = desktop_root.parent() else {
                break;
            };
            desktop_root = parent.to_path_buf();
        }
        candidates.push(desktop_root);
    }

    for candidate in candidates {
        let package = candidate
            .join("node_modules")
            .join("playwright-core")
            .join("package.json");
        if package.is_file() {
            return fs::canonicalize(&candidate).map_err(|error| {
                format!("Không canonicalize được Playwright module root: {error}")
            });
        }
    }
    Err("Chưa tìm thấy playwright-core. Cài dependency trong desktop hoặc đặt AUTO3DVIDEO_PLAYWRIGHT_MODULE_ROOT tới thư mục chứa node_modules.".to_string())
}

fn project_workspace_root(connection: &Connection, project_id: &str) -> Result<PathBuf, String> {
    let raw: String = connection
        .query_row(
            "SELECT workspace_root FROM projects WHERE project_id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Không đọc được workspace project: {error}"))?;
    fs::canonicalize(&raw).map_err(|error| format!("Workspace project không tồn tại: {error}"))
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
fn list_asset_pack_reviews(
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
fn register_asset_pack_source(
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
fn update_asset_pack_item_review(
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
fn prepare_asset_pack_blender_binding(
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
async fn run_asset_pack_blender_binding(
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

fn video_workflow_session_directory(
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

fn read_video_workflow_sessions(path: &Path) -> Result<Vec<VideoWorkflowSessionView>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Không đọc được cache phiên video: {error}"))?;
    let document = serde_json::from_str::<VideoWorkflowSessionFile>(&raw)
        .map_err(|error| format!("Cache phiên video không hợp lệ: {error}"))?;
    if document.schema_version != "1.0.0" {
        return Err(format!(
            "Cache phiên video không tương thích: {}",
            document.schema_version
        ));
    }
    Ok(document.sessions)
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
    fs::write(path, encoded).map_err(|error| format!("Không lưu được cache phiên video: {error}"))
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
    let payload_size = serde_json::to_vec(input)
        .map_err(|error| format!("Không kiểm tra được kích thước phiên video: {error}"))?
        .len();
    if payload_size > 1_500_000 {
        return Err("Dữ liệu phiên video vượt quá giới hạn cache local".to_string());
    }
    Ok(())
}

#[tauri::command]
fn list_video_workflow_sessions(
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
fn save_video_workflow_session(
    input: SaveVideoWorkflowSessionInput,
    state: State<'_, AppState>,
) -> Result<VideoWorkflowSessionView, String> {
    validate_video_workflow_session_input(&input)?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    ensure_project_exists(&connection, input.project_id.trim())?;
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
fn delete_video_workflow_session(
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

fn fetch_asset(connection: &Connection, asset_id: &str) -> Result<AssetView, String> {
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

fn fetch_reference_set(
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
fn list_assets(
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

fn import_asset_with_state(input: AssetImportInput, state: &AppState) -> Result<AssetView, String> {
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
fn import_asset(input: AssetImportInput, state: State<'_, AppState>) -> Result<AssetView, String> {
    import_asset_with_state(input, &state)
}

fn validate_reference_video_source_url(value: &str) -> Result<String, String> {
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
async fn download_reference_video(
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
fn update_asset_metadata(
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
fn archive_asset(
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
fn restore_asset(
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

fn validate_reference_set_input(input: &ReferenceSetInput) -> Result<(), String> {
    valid_text(&input.project_id, "Project ID")?;
    validate_asset_text(&input.name, "Tên reference set", 160)?;
    validate_reference_scope(input.scope.trim())?;
    if input.continuity_note.chars().count() > 4000 || preview_secret_like(&input.continuity_note) {
        return Err("Continuity note không hợp lệ".to_string());
    }
    Ok(())
}

#[tauri::command]
fn list_reference_sets(
    project_id: String,
    include_archived: bool,
    state: State<'_, AppState>,
) -> Result<Vec<ReferenceSetView>, String> {
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
    let sql = format!("SELECT reference_set_id FROM reference_sets WHERE project_id = ?1{} ORDER BY updated_at DESC", suffix);
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![project_id.trim()], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    let ids = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    ids.into_iter()
        .map(|id| fetch_reference_set(&connection, &id))
        .collect()
}

#[tauri::command]
fn create_reference_set(
    input: ReferenceSetInput,
    state: State<'_, AppState>,
) -> Result<ReferenceSetView, String> {
    validate_reference_set_input(&input)?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    ensure_project_exists(&connection, input.project_id.trim())?;
    let reference_set_id = now_id("reference-set");
    let timestamp = now_string();
    connection.execute("INSERT INTO reference_sets(reference_set_id, project_id, name, scope, status, continuity_note, created_at, updated_at, archived_at) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6, ?6, NULL)", params![reference_set_id, input.project_id.trim(), input.name.trim(), input.scope.trim(), input.continuity_note.trim(), timestamp]).map_err(|error| format!("Không lưu được reference set: {error}"))?;
    audit_event(
        &connection,
        Some(input.project_id.trim()),
        "reference_set.created",
        "reference_set",
        &reference_set_id,
    )?;
    fetch_reference_set(&connection, &reference_set_id)
}

#[tauri::command]
fn update_reference_set(
    reference_set_id: String,
    input: ReferenceSetInput,
    state: State<'_, AppState>,
) -> Result<ReferenceSetView, String> {
    valid_text(&reference_set_id, "Reference set ID")?;
    validate_reference_set_input(&input)?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let current = fetch_reference_set(&connection, reference_set_id.trim())?;
    if current.project_id != input.project_id.trim() {
        return Err("Không thể sửa reference set khác project".to_string());
    }
    if current.status == "archived" {
        return Err("Không thể sửa reference set đã lưu trữ; hãy khôi phục trước".to_string());
    }
    connection.execute("UPDATE reference_sets SET name=?1, scope=?2, continuity_note=?3, updated_at=?4 WHERE reference_set_id=?5 AND project_id=?6", params![input.name.trim(), input.scope.trim(), input.continuity_note.trim(), now_string(), reference_set_id.trim(), input.project_id.trim()]).map_err(|error| error.to_string())?;
    audit_event(
        &connection,
        Some(input.project_id.trim()),
        "reference_set.updated",
        "reference_set",
        reference_set_id.trim(),
    )?;
    fetch_reference_set(&connection, reference_set_id.trim())
}

#[tauri::command]
fn archive_reference_set(
    project_id: String,
    reference_set_id: String,
    state: State<'_, AppState>,
) -> Result<ReferenceSetView, String> {
    valid_text(&project_id, "Project ID")?;
    valid_text(&reference_set_id, "Reference set ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let current = fetch_reference_set(&connection, reference_set_id.trim())?;
    if current.project_id != project_id.trim() {
        return Err("Không thể lưu trữ reference set khác project".to_string());
    }
    let timestamp = now_string();
    connection.execute("UPDATE reference_sets SET status='archived', archived_at=?1, updated_at=?1 WHERE reference_set_id=?2", params![timestamp, reference_set_id.trim()]).map_err(|error| error.to_string())?;
    audit_event(
        &connection,
        Some(project_id.trim()),
        "reference_set.archived",
        "reference_set",
        reference_set_id.trim(),
    )?;
    fetch_reference_set(&connection, reference_set_id.trim())
}

#[tauri::command]
fn restore_reference_set(
    project_id: String,
    reference_set_id: String,
    state: State<'_, AppState>,
) -> Result<ReferenceSetView, String> {
    valid_text(&project_id, "Project ID")?;
    valid_text(&reference_set_id, "Reference set ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let current = fetch_reference_set(&connection, reference_set_id.trim())?;
    if current.project_id != project_id.trim() {
        return Err("Không thể khôi phục reference set khác project".to_string());
    }
    connection.execute("UPDATE reference_sets SET status='active', archived_at=NULL, updated_at=?1 WHERE reference_set_id=?2", params![now_string(), reference_set_id.trim()]).map_err(|error| error.to_string())?;
    audit_event(
        &connection,
        Some(project_id.trim()),
        "reference_set.restored",
        "reference_set",
        reference_set_id.trim(),
    )?;
    fetch_reference_set(&connection, reference_set_id.trim())
}

#[tauri::command]
fn assign_reference(
    input: ReferenceAssignmentInput,
    state: State<'_, AppState>,
) -> Result<ReferenceSetView, String> {
    valid_text(&input.project_id, "Project ID")?;
    valid_text(&input.reference_set_id, "Reference set ID")?;
    valid_text(&input.asset_id, "Asset ID")?;
    validate_reference_role(input.role.trim())?;
    if !(0.0..=1.0).contains(&input.strength) || !input.strength.is_finite() {
        return Err("Strength phải nằm trong khoảng 0–1".to_string());
    }
    if input.priority < 0 {
        return Err("Priority không được âm".to_string());
    }
    for (value, field, max_len) in [(&input.notes, "Reference notes", 2000usize)] {
        if value.chars().count() > max_len || preview_secret_like(value) {
            return Err(format!("{field} không hợp lệ"));
        }
    }
    if let Some(shot_id) = &input.shot_id {
        if shot_id.chars().count() > 120 || shot_id.contains(['\r', '\n', '\0']) {
            return Err("Shot ID không hợp lệ".to_string());
        }
    }
    if let (Some(start), Some(end)) = (input.shot_range_start, input.shot_range_end) {
        if start < 0 || end < start {
            return Err("Shot range không hợp lệ".to_string());
        }
    }
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let reference_set = fetch_reference_set(&connection, input.reference_set_id.trim())?;
    if reference_set.project_id != input.project_id.trim() || reference_set.status == "archived" {
        return Err("Reference set không thuộc project hoặc đang lưu trữ".to_string());
    }
    let asset = fetch_asset(&connection, input.asset_id.trim())?;
    if asset.project_id != input.project_id.trim()
        || asset.status == "archived"
        || asset.status == "missing"
    {
        return Err("Asset không thuộc project hoặc chưa sẵn sàng để gán".to_string());
    }
    let assignment_id = now_id("reference");
    let timestamp = now_string();
    connection.execute("INSERT INTO reference_set_assignments(assignment_id, project_id, reference_set_id, asset_id, role, strength, priority, shot_id, shot_range_start, shot_range_end, crop, notes, approved, asset_sha256, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)", params![assignment_id, input.project_id.trim(), input.reference_set_id.trim(), input.asset_id.trim(), input.role.trim(), input.strength, input.priority, input.shot_id.as_deref().map(str::trim).filter(|value| !value.is_empty()), input.shot_range_start, input.shot_range_end, input.crop.as_deref().map(str::trim).filter(|value| !value.is_empty()), input.notes.trim(), if input.approved { 1 } else { 0 }, asset.sha256, timestamp]).map_err(|error| format!("Không gán được reference: {error}"))?;
    connection
        .execute(
            "UPDATE reference_sets SET updated_at=?1 WHERE reference_set_id=?2",
            params![timestamp, input.reference_set_id.trim()],
        )
        .map_err(|error| error.to_string())?;
    audit_event(
        &connection,
        Some(input.project_id.trim()),
        "reference.assigned",
        "reference_set",
        input.reference_set_id.trim(),
    )?;
    fetch_reference_set(&connection, input.reference_set_id.trim())
}

#[tauri::command]
fn detach_reference(
    project_id: String,
    assignment_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    valid_text(&project_id, "Project ID")?;
    valid_text(&assignment_id, "Assignment ID")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let reference_set_id: String = connection.query_row("SELECT reference_set_id FROM reference_set_assignments WHERE assignment_id=?1 AND project_id=?2", params![assignment_id.trim(), project_id.trim()], |row| row.get(0)).map_err(|error| format!("Không đọc được assignment: {error}"))?;
    connection
        .execute(
            "DELETE FROM reference_set_assignments WHERE assignment_id=?1 AND project_id=?2",
            params![assignment_id.trim(), project_id.trim()],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "UPDATE reference_sets SET updated_at=?1 WHERE reference_set_id=?2",
            params![now_string(), reference_set_id],
        )
        .map_err(|error| error.to_string())?;
    audit_event(
        &connection,
        Some(project_id.trim()),
        "reference.detached",
        "reference",
        assignment_id.trim(),
    )?;
    Ok(())
}

#[tauri::command]
fn preview_topic_prompt(request: TopicPromptPreviewRequest) -> Result<TopicPromptPreview, String> {
    for (value, field, max_len) in [
        (&request.profile_id, "profileId", 64usize),
        (&request.template_id, "templateId", 64usize),
        (&request.topic, "topic", 500usize),
        (&request.audience, "audience", 200usize),
        (&request.content_goal, "contentGoal", 300usize),
        (&request.additional_prompt, "additionalPrompt", 4_000usize),
    ] {
        valid_text(value, field)?;
        if value.chars().count() > max_len {
            return Err(format!("{field} vượt quá {max_len} ký tự"));
        }
        if preview_secret_like(value) {
            return Err(format!(
                "{field} chứa dấu hiệu thông tin bí mật; không đưa key/token vào prompt"
            ));
        }
    }
    let profile_registry: TopicProfileRegistry = serde_json::from_str(TOPIC_PROFILE_REGISTRY)
        .map_err(|error| format!("topic profile registry không hợp lệ: {error}"))?;
    let prompt_registry: PromptTemplateRegistry = serde_json::from_str(PROMPT_TEMPLATE_REGISTRY)
        .map_err(|error| format!("prompt template registry không hợp lệ: {error}"))?;
    let profile = profile_registry
        .profiles
        .into_iter()
        .find(|profile| profile.profile_id == request.profile_id)
        .ok_or_else(|| "topic profile không tồn tại".to_string())?;
    let template = prompt_registry
        .templates
        .into_iter()
        .find(|template| template.template_id == request.template_id)
        .ok_or_else(|| "prompt template không tồn tại".to_string())?;
    if !profile
        .prompt_template_ids
        .iter()
        .any(|id| id == &template.template_id)
    {
        return Err("prompt template không được profile này cho phép".to_string());
    }
    let substitutions = [
        ("topic", request.topic.as_str()),
        ("topic_profile", profile.name.as_str()),
        ("audience", request.audience.as_str()),
        ("content_goal", request.content_goal.as_str()),
        ("brief", request.topic.as_str()),
        ("visual_mode", profile.visual_mode.as_str()),
        ("entity_bible", "chưa có; cần tạo sau bước brief"),
        ("script", "chưa có; cần tạo sau bước brief"),
        ("approved_claims", "chưa có; cần review claim"),
        ("duration_seconds", "chưa đặt"),
        ("product", request.topic.as_str()),
        ("source_material", "chưa có; cần người dùng cung cấp"),
    ];
    let mut rendered_prompt = template.body.clone();
    for (key, value) in substitutions {
        rendered_prompt = rendered_prompt.replace(&format!("{{{{{key}}}}}"), value);
    }
    if !request.additional_prompt.trim().is_empty() {
        rendered_prompt.push_str("\n\nYêu cầu bổ sung của người dùng (cần review):\n");
        rendered_prompt.push_str(request.additional_prompt.trim());
    }
    Ok(TopicPromptPreview {
        profile_id: profile.profile_id,
        profile_name: profile.name,
        template_id: template.template_id,
        template_version: template.version,
        rendered_prompt,
        selected_recipe_kind: profile.default_recipe_kind,
        visual_mode: profile.visual_mode,
        required_human_review: true,
        network_calls_made: false,
        paid_generation: false,
        external_publish: false,
        message: "Đây là bản xem trước prompt; chưa gọi model, chưa tạo media và chưa ghi project."
            .to_string(),
    })
}

#[tauri::command]
fn list_provider_catalog(state: State<'_, AppState>) -> Result<Vec<ProviderProfileView>, String> {
    let mut profiles = vec![
        ProviderProfileView {
            profile_id: "llm_local".to_string(),
            capability: "llm".to_string(),
            provider: "local".to_string(),
            model: "configured-local-llm".to_string(),
            endpoint_ref: "local://llm".to_string(),
            enabled: true,
            configured: true,
            credential_ref: "none".to_string(),
        },
        ProviderProfileView {
            profile_id: "media_local".to_string(),
            capability: "media".to_string(),
            provider: "ffmpeg".to_string(),
            model: "installed-binary".to_string(),
            endpoint_ref: "binary://ffmpeg".to_string(),
            enabled: true,
            configured: true,
            credential_ref: "none".to_string(),
        },
        ProviderProfileView {
            profile_id: "stt_local".to_string(),
            capability: "stt".to_string(),
            provider: "whisper".to_string(),
            model: "configured-whisper".to_string(),
            endpoint_ref: "local://whisper".to_string(),
            enabled: false,
            configured: true,
            credential_ref: "none".to_string(),
        },
        ProviderProfileView {
            profile_id: "voice_primary".to_string(),
            capability: "tts".to_string(),
            provider: "omnivoice".to_string(),
            model: "OmniVoice".to_string(),
            endpoint_ref: "local://python".to_string(),
            enabled: true,
            configured: false,
            credential_ref: "none".to_string(),
        },
        ProviderProfileView {
            profile_id: "video_primary".to_string(),
            capability: "video".to_string(),
            provider: "configured-by-user".to_string(),
            model: "configured-video-model".to_string(),
            endpoint_ref: "env:AUTO3DVIDEO_VIDEO_BASE_URL".to_string(),
            enabled: false,
            configured: false,
            credential_ref: "env-or-os-store".to_string(),
        },
    ];

    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    let mut statement = connection
        .prepare("SELECT profile_id, capability, provider_kind, model_id, endpoint_ref, enabled, credential_ref FROM provider_profiles ORDER BY created_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            let credential_ref = safe_credential_ref(row.get::<_, Option<String>>(6)?);
            Ok(ProviderProfileView {
                profile_id: row.get(0)?,
                capability: row.get(1)?,
                provider: row.get(2)?,
                model: row.get(3)?,
                endpoint_ref: row
                    .get::<_, Option<String>>(4)?
                    .unwrap_or_else(|| "none".to_string()),
                enabled: row.get::<_, i64>(5)? == 1,
                configured: credential_ref_configured(&credential_ref),
                credential_ref,
            })
        })
        .map_err(|error| error.to_string())?;
    for row in rows {
        profiles.push(row.map_err(|error| error.to_string())?);
    }
    Ok(profiles)
}

#[tauri::command]
fn create_provider_profile(
    capability: String,
    provider: String,
    model: String,
    endpoint_ref: String,
    credential_ref: String,
    state: State<'_, AppState>,
) -> Result<ProviderProfileView, String> {
    valid_text(&capability, "Capability")?;
    valid_text(&provider, "Provider")?;
    valid_text(&model, "Model")?;
    valid_text(&endpoint_ref, "Endpoint reference")?;
    let credential_ref = validate_credential_ref(&credential_ref)?;
    if endpoint_ref.contains('\n') || endpoint_ref.len() > 500 {
        return Err("Endpoint reference không hợp lệ".to_string());
    }

    let profile_id = now_id("profile");
    let timestamp = now_string();
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database".to_string())?;
    connection
        .execute(
            "INSERT INTO provider_profiles(profile_id, capability, provider_kind, model_id, endpoint_ref, credential_ref, enabled, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?7)",
            params![profile_id, capability.trim(), provider.trim(), model.trim(), endpoint_ref.trim(), credential_ref, timestamp],
        )
        .map_err(|error| error.to_string())?;

    Ok(ProviderProfileView {
        profile_id,
        capability: capability.trim().to_string(),
        provider: provider.trim().to_string(),
        model: model.trim().to_string(),
        endpoint_ref: endpoint_ref.trim().to_string(),
        enabled: false,
        configured: credential_ref_configured(&credential_ref),
        credential_ref,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .register_uri_scheme_protocol(WORKSPACE_MEDIA_SCHEME, |_ctx, request| {
            workspace_media_protocol_response(_ctx.app_handle(), request)
        })
        .setup(|app| {
            let connection = initialize_database(app.handle()).map_err(std::io::Error::other)?;
            app.manage(AppState {
                database: Mutex::new(connection),
                cancellation_tokens: Mutex::new(HashMap::new()),
                cloud_generation_enabled: AtomicBool::new(false),
            });
            if let Err(error) = browser_handoff::start_browsermcp_server(&app.state::<AppState>()) {
                eprintln!("BrowserMCP startup deferred: {error}");
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            app_snapshot,
            set_cloud_generation_enabled,
            health_check,
            list_projects,
            create_project,
            delete_project,
            list_jobs,
            enqueue_mock_job,
            enqueue_pending_job,
            list_recipe_catalog,
            list_topic_profiles,
            list_prompt_templates,
            list_prompt_presets,
            create_prompt_preset,
            update_prompt_preset,
            archive_prompt_preset,
            restore_prompt_preset,
            list_video_workflow_sessions,
            save_video_workflow_session,
            delete_video_workflow_session,
            list_assets,
            import_asset,
            download_reference_video,
            update_asset_metadata,
            archive_asset,
            restore_asset,
            list_asset_pack_reviews,
            register_asset_pack_source,
            update_asset_pack_item_review,
            prepare_asset_pack_blender_binding,
            run_asset_pack_blender_binding,
            list_reference_sets,
            create_reference_set,
            update_reference_set,
            archive_reference_set,
            restore_reference_set,
            assign_reference,
            detach_reference,
            preview_topic_prompt,
            validate_recipe_json,
            preview_recipe,
            preview_process,
            prepare_pending_attempt,
            start_mock_attempt,
            run_ffmpeg_fixture,
            run_ffmpeg_fixture_attempt,
            probe_local_tool,
            check_vieneu_local,
            run_vieneu_tts,
            check_omnivoice_local,
            prepare_omnivoice_model,
            list_voice_profiles,
            list_project_voice_samples,
            create_voice_profile,
            update_voice_profile,
            delete_voice_profile,
            run_omnivoice_tts,
            save_recorded_audio,
            save_recorded_audio_for_project,
            read_workspace_audio_base64,
            read_project_audio_base64,
            read_project_asset_preview,
            test_commandcode_chat,
            check_comfyui_health,
            run_comfyui_image_generation,
            ensure_chrome_cdp_session,
            scan_preview_discovery,
            scan_preview_creator_catalog,
            scan_licensed_footage_discovery,
            type_google_flow_dom_prompt,
            inspect_google_flow_dom_output,
            run_google_flow_playwright_action,
            run_nanobanana_image_generation,
            read_nanobanana_image_progress,
            run_blender_fixture,
            run_true3d_fixture,
            run_true3d_multishot_fixture,
            run_asset_pipeline_check,
            build_blender_shot_preview,
            list_shot_approvals,
            set_shot_approval,
            preview_narrative_visual_plan,
            preview_narrative_visual_plan_fixture,
            list_job_attempts,
            list_attempt_outputs,
            list_audit_events,
            list_tool_readiness,
            worker_preflight,
            preview_worker_launch,
            save_tool_config,
            retry_job,
            cancel_job,
            list_provider_catalog,
            get_provider_env_snapshot,
            create_provider_profile,
            local_video::generate_local_video_script,
            local_video::render_approved_local_video,
            subtitle::load_subtitle_document,
            subtitle::save_subtitle_document,
            subtitle::probe_subtitle_video,
            subtitle::burn_in_subtitles,
            video_vision::analyze_video_evidence,
            browser_handoff::prepare_browser_handoff,
            browser_handoff::probe_browsermcp_runtime,
            browser_handoff::open_browseros_flow,
            browser_handoff::check_browsermcp_session,
            browser_handoff::run_browsermcp_action,
            browser_handoff::start_browser_flow_discovery,
            browser_handoff::run_browser_flow_step,
            browser_handoff::browser_flow_agent_step,
            browser_handoff::evaluate_browser_flow_image,
            browser_handoff::get_browser_flow_workflow,
            browser_handoff::get_latest_browser_flow_workflow,
            browser_handoff::get_browser_handoff_state,
            browser_handoff::advance_browser_handoff,
            browser_handoff::list_browser_flow_downloads,
            browser_handoff::import_browser_flow_download,
            browser_handoff::compose_browser_flow_outputs,
            browser_handoff::import_browser_candidate
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seeded_state() -> AppState {
        let connection = Connection::open_in_memory().expect("in-memory database");
        connection
            .execute_batch(
                "\
                CREATE TABLE projects (project_id TEXT PRIMARY KEY, name TEXT NOT NULL, locale TEXT NOT NULL, workspace_root TEXT NOT NULL, policy_profile TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE jobs (job_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL, progress REAL NOT NULL, attempt_count INTEGER NOT NULL, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, error_code TEXT, error_message TEXT);
                CREATE TABLE job_attempts (attempt_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, attempt_number INTEGER NOT NULL, state TEXT NOT NULL, worker_id TEXT, executable_id TEXT, lease_owner TEXT, lease_expires_at TEXT, heartbeat_at TEXT, started_at TEXT, finished_at TEXT, cancellation_requested_at TEXT, termination_mode TEXT NOT NULL DEFAULT 'none', timeout_seconds INTEGER NOT NULL, max_log_bytes INTEGER NOT NULL, stdout_bytes INTEGER NOT NULL DEFAULT 0, stderr_bytes INTEGER NOT NULL DEFAULT 0, process_started INTEGER NOT NULL DEFAULT 0, external_side_effect_unknown INTEGER NOT NULL DEFAULT 0, retryable INTEGER NOT NULL DEFAULT 0, error_code TEXT, redacted_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, execution_mode TEXT NOT NULL DEFAULT 'external_process');
                CREATE TABLE job_outputs (output_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, relative_path TEXT NOT NULL, media_kind TEXT NOT NULL, validation_state TEXT NOT NULL, validation_message TEXT, created_at TEXT NOT NULL);
                CREATE TABLE audit_events (event_id TEXT PRIMARY KEY, project_id TEXT, event_type TEXT NOT NULL, subject_type TEXT, subject_id TEXT, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
                ",
            )
            .expect("test schema");
        connection
            .execute(
                "INSERT INTO projects(project_id, name, locale, workspace_root, policy_profile, created_at, updated_at) VALUES (?1, 'Test', 'vi-VN', 'D:/Auto3Dvideo/test', 'safe-local', '0', '0')",
                params!["project-test"],
            )
            .expect("project seed");
        connection
            .execute(
                "INSERT INTO jobs(job_id, project_id, kind, state, progress, attempt_count, created_at) VALUES ('job-test', 'project-test', 'true_3d', 'queued', 0.0, 1, '0')",
                [],
            )
            .expect("job seed");
        connection
            .execute(
                "INSERT INTO job_attempts(attempt_id, job_id, attempt_number, state, timeout_seconds, max_log_bytes, created_at, updated_at) VALUES ('attempt-test', 'job-test', 1, 'pending', 60, 1048576, '0', '0')",
                [],
            )
            .expect("attempt seed");
        AppState {
            database: Mutex::new(connection),
            cancellation_tokens: Mutex::new(HashMap::new()),
            cloud_generation_enabled: AtomicBool::new(false),
        }
    }

    #[test]
    fn invalid_legacy_credential_reference_is_masked_for_view() {
        assert_eq!(safe_credential_ref(None), "none");
        assert_eq!(
            safe_credential_ref(Some("sk-live-secret".to_string())),
            "invalid-ref-blocked"
        );
        assert!(!credential_ref_configured("invalid-ref-blocked"));
    }

    #[test]
    fn tool_readiness_rejects_wrong_binary_filename() {
        let root = std::env::temp_dir().join("auto3dvideo-readiness-name-test");
        let _ = fs::create_dir_all(&root);
        let correct = root.join("ffmpeg.exe");
        let wrong = root.join("not-ffmpeg.exe");
        fs::write(&correct, b"fixture").expect("correct filename fixture");
        fs::write(&wrong, b"fixture").expect("wrong filename fixture");
        assert!(executable_ref_available(
            "ffmpeg",
            &correct.to_string_lossy()
        ));
        assert!(!executable_ref_available(
            "ffmpeg",
            &wrong.to_string_lossy()
        ));
        let _ = fs::remove_file(correct);
        let _ = fs::remove_file(wrong);
        let _ = fs::remove_dir(root);
    }

    #[test]
    fn credential_reference_accepts_handles_only() {
        assert_eq!(
            validate_credential_ref("env:AUTO3DVIDEO_API_KEY").expect("env ref"),
            "env:AUTO3DVIDEO_API_KEY"
        );
        assert_eq!(
            validate_credential_ref("os:auto3dvideo/provider-key").expect("os ref"),
            "os:auto3dvideo/provider-key"
        );
        assert_eq!(validate_credential_ref("none").expect("none ref"), "none");
    }

    #[test]
    fn credential_reference_rejects_raw_or_malformed_values() {
        for value in [
            "sk-live-secret",
            "key_live_secret",
            "AUTO3DVIDEO_API_KEY",
            "env:auto3dvideo_key",
            "env:AUTO3DVIDEO_API_KEY=value",
            "file:C:/secret.txt",
            "os:credential\\\\name",
        ] {
            assert!(validate_credential_ref(value).is_err(), "accepted {value}");
        }
    }

    #[tokio::test]
    #[ignore = "requires explicit AUTO3DVIDEO_TEST_FFMPEG and AUTO3DVIDEO_TEST_FFPROBE paths"]
    async fn external_fixture_pipeline_runs_with_configured_binaries() {
        let ffmpeg_path = PathBuf::from(
            std::env::var("AUTO3DVIDEO_TEST_FFMPEG").expect("explicit test ffmpeg path"),
        );
        let ffprobe_path = PathBuf::from(
            std::env::var("AUTO3DVIDEO_TEST_FFPROBE").expect("explicit test ffprobe path"),
        );
        let root = std::env::temp_dir().join(format!("auto3dvideo-live-{}", now_id("test")));
        let fixture_directory = root.join("fixture");
        fs::create_dir_all(&fixture_directory).expect("fixture directory");
        let result = execute_ffmpeg_fixture_for_attempt(
            root.clone(),
            fixture_directory,
            "synthetic-1s.mp4".to_string(),
            "fixture/synthetic-1s.mp4".to_string(),
            ffmpeg_path,
            ffprobe_path,
            Arc::new(AtomicBool::new(false)),
        )
        .await
        .expect("live FFmpeg fixture");
        assert_eq!(result.stream_count, 2);
        assert!(result.duration_seconds > 0.0);
        assert!(result.size_bytes > 0);
        assert!(result.ffmpeg.succeeded);
        assert!(result.ffprobe.succeeded);
        fs::remove_dir_all(root).expect("cleanup live fixture");
    }

    #[test]
    fn comfyui_health_reads_loopback_response_without_submission() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("loopback listener");
        let port = listener.local_addr().expect("listener address").port();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("health request");
            let mut request = [0_u8; 1024];
            let read = stream.read(&mut request).expect("read request");
            assert!(String::from_utf8_lossy(&request[..read]).starts_with("GET /system_stats"));
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n",
                )
                .expect("write health response");
        });
        let report = comfy_ui_health_check(&format!("http://127.0.0.1:{port}"));
        handle.join().expect("health thread");
        assert_eq!(report.status, "ready");
        assert_eq!(report.http_status, Some(200));
        assert!(report.network_probe_performed);
        assert!(!report.side_effects_started);
    }

    #[test]
    fn nanobanana_cdp_preflight_is_read_only_and_requires_chrome_endpoint() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("loopback listener");
        let port = listener.local_addr().expect("listener address").port();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("cdp request");
            let mut request = [0_u8; 1024];
            let read = stream.read(&mut request).expect("read request");
            assert!(String::from_utf8_lossy(&request[..read]).starts_with("GET /json/version"));
            stream
                .write_all(b"HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n")
                .expect("write cdp response");
        });
        let report = nanobanana_cdp_preflight(&format!("http://127.0.0.1:{port}"));
        handle.join().expect("cdp thread");
        assert_eq!(report.status, "unhealthy");
        assert_eq!(report.http_status, Some(503));
        assert!(report.network_probe_performed);
        assert!(!report.side_effects_started);
        assert!(report.message.contains("BrowserMCP 9009"));
    }

    #[test]
    fn nanobanana_initialize_timeout_is_classified_without_marking_success() {
        let raw_report = serde_json::json!({
            "status": "failed",
            "errors": ["Nano Banana MCP timeout ở initialize"]
        });
        let (code, detail) = classify_nanobanana_report(&raw_report);
        assert_eq!(code.as_deref(), Some("MCP_INITIALIZE_TIMEOUT"));
        assert_eq!(
            detail.as_deref(),
            Some("Nano Banana MCP timeout ở initialize")
        );
    }

    #[test]
    fn local_tool_and_comfyui_requests_are_typed_and_loopback_only() {
        assert_eq!(
            local_tool_probe_args("ffmpeg").expect("ffmpeg probe"),
            vec!["--version".to_string()]
        );
        assert_eq!(
            local_tool_probe_args("obscura").expect("obscura probe"),
            vec!["--version".to_string()]
        );
        assert!(local_tool_probe_args("kdenlive").is_err());
        assert!(parse_loopback_endpoint("http://127.0.0.1:8188").is_ok());
        assert!(parse_loopback_endpoint("http://localhost:8188").is_ok());
        assert!(parse_loopback_endpoint("https://127.0.0.1:8188").is_err());
        assert!(parse_loopback_endpoint("http://10.0.0.2:8188").is_err());
        assert!(parse_loopback_endpoint("http://127.0.0.1:8188/api").is_err());
        assert!(parse_loopback_endpoint("http://user:pass@127.0.0.1:8188").is_err());
        assert!(validate_nanobanana_cdp_url("http://127.0.0.1:9222").is_ok());
        assert!(validate_nanobanana_cdp_url("http://10.0.0.2:9222").is_err());
    }

    #[test]
    fn asset_reference_validation_blocks_unsafe_inputs() {
        assert!(validate_asset_kind("image").is_ok());
        assert!(validate_asset_kind("shell").is_err());
        assert!(validate_asset_rights("licensed").is_ok());
        assert!(validate_asset_rights("secret").is_err());
        assert!(validate_reference_role("camera").is_ok());
        assert!(validate_reference_role("random").is_err());
        assert!(asset_status_for_rights("pending") == "quarantined");
        assert!(asset_status_for_rights("owned") == "ready");
        assert!(mime_for_asset_path(Path::new("frame.png"), "image").is_ok());
        assert!(mime_for_asset_path(Path::new("frame.exe"), "image").is_err());
    }

    #[test]
    fn release_media_preview_resolves_allowed_workspace_files_only() {
        let root = std::env::temp_dir().join(now_id("auto3dvideo-media-preview"));
        let preview_dir = root.join("outputs").join("blender");
        fs::create_dir_all(&preview_dir).expect("preview directory");
        fs::write(preview_dir.join("preview.png"), b"png-fixture").expect("preview fixture");
        fs::write(root.join("outside.mp4"), b"outside-fixture").expect("outside fixture");

        let resolved = resolve_workspace_file(
            &root,
            "outputs/blender/preview.png",
            "Media preview",
            512 * 1024 * 1024,
        )
        .expect("allowed preview");
        assert_eq!(workspace_media_mime_type(&resolved), Some("image/png"));
        assert!(resolve_workspace_file(
            &root,
            "../outside.mp4",
            "Media preview",
            512 * 1024 * 1024,
        )
        .is_err());
        assert!(workspace_media_mime_type(Path::new("scene.blend")).is_none());

        fs::remove_dir_all(root).expect("cleanup preview fixture");
    }

    #[test]
    fn video_session_directory_creates_bounded_workspace_tree() {
        let root = std::env::temp_dir().join(now_id("video-session-tree"));
        fs::create_dir_all(&root).expect("workspace root");
        let relative = video_workflow_session_directory(&root, "video-session-test")
            .expect("session directory");
        assert_eq!(relative, "outputs/sessions/video-session-test");
        for child in ["inputs", "storyboard", "gemini", "blender", "video", "logs"] {
            assert!(root.join(&relative).join(child).is_dir(), "missing {child}");
        }
        assert!(video_workflow_session_directory(&root, "../outside").is_err());
        fs::remove_dir_all(root).expect("cleanup session tree");
    }

    #[test]
    fn restart_reconciliation_marks_active_external_attempt_unknown() {
        let state = seeded_state();
        {
            let connection = state.database.lock().expect("database lock");
            connection
                .execute(
                    "UPDATE jobs SET state='running' WHERE job_id='job-test'",
                    [],
                )
                .expect("running job");
            connection
                .execute(
                    "UPDATE job_attempts SET state='running', execution_mode='external_process', process_started=1, worker_id='native-external', lease_owner='external-worker:attempt-test', lease_expires_at='2026-08-23T00:01:00Z', heartbeat_at='2026-08-23T00:00:00Z', started_at='2026-08-23T00:00:00Z' WHERE attempt_id='attempt-test'",
                    [],
                )
                .expect("running external attempt");
            assert_eq!(
                reconcile_active_external_attempts(&connection).expect("reconcile"),
                1
            );
            let attempt: (String, i64, i64) = connection
                .query_row(
                    "SELECT state, external_side_effect_unknown, process_started FROM job_attempts WHERE attempt_id='attempt-test'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .expect("reconciled attempt");
            assert_eq!(attempt, ("reconciliation_required".to_string(), 1, 1));
            let job_state: String = connection
                .query_row(
                    "SELECT state FROM jobs WHERE job_id='job-test'",
                    [],
                    |row| row.get(0),
                )
                .expect("reconciled job");
            assert_eq!(job_state, "reconciliation_required");
        }
    }

    #[test]
    fn external_fixture_success_persists_attempt_and_output_evidence() {
        let state = seeded_state();
        let output_path = "fixtures/attempt/synthetic-1s.mp4".to_string();
        {
            let connection = state.database.lock().expect("database lock");
            connection
                .execute(
                    "UPDATE jobs SET state='running' WHERE job_id='job-test'",
                    [],
                )
                .expect("running job");
            connection
                .execute(
                    "UPDATE job_attempts SET state='running', execution_mode='external_process', executable_id='ffmpeg', process_started=1, worker_id='native-external', lease_owner='external-worker:attempt-test', lease_expires_at='2026-08-23T00:01:00Z', heartbeat_at='2026-08-23T00:00:00Z', started_at='2026-08-23T00:00:00Z' WHERE attempt_id='attempt-test'",
                    [],
                )
                .expect("running external attempt");
            connection
                .execute(
                    "INSERT INTO job_outputs(output_id, attempt_id, relative_path, media_kind, validation_state, created_at) VALUES ('output-test', 'attempt-test', ?1, 'video', 'pending', '0')",
                    params![output_path],
                )
                .expect("pending output");
        }
        let report = LocalMediaFixtureReport {
            output_path: output_path.clone(),
            size_bytes: 42,
            duration_seconds: 1.0,
            stream_count: 2,
            ffmpeg: ExternalProcessResult {
                executable_id: "ffmpeg".to_string(),
                exit_code: Some(0),
                succeeded: true,
                timed_out: false,
                cancelled: false,
                termination_mode: "none".to_string(),
                stdout: String::new(),
                stderr: String::new(),
                stdout_bytes: 0,
                stderr_bytes: 0,
                stdout_truncated: false,
                stderr_truncated: false,
                external_side_effect_unknown: false,
                output_evidence: vec![OutputEvidence {
                    relative_path: output_path,
                    size_bytes: Some(42),
                    validation_state: "valid".to_string(),
                    validation_message: None,
                }],
            },
            ffprobe: ExternalProcessResult {
                executable_id: "ffprobe".to_string(),
                exit_code: Some(0),
                succeeded: true,
                timed_out: false,
                cancelled: false,
                termination_mode: "none".to_string(),
                stdout: String::new(),
                stderr: String::new(),
                stdout_bytes: 0,
                stderr_bytes: 0,
                stdout_truncated: false,
                stderr_truncated: false,
                external_side_effect_unknown: false,
                output_evidence: Vec::new(),
            },
        };
        let result = persist_external_fixture_success(&state, "attempt-test", &report)
            .expect("persist external success");
        assert_eq!(result.job.state, "succeeded");
        assert_eq!(result.attempt.state, "succeeded");
        assert!(result.attempt.process_started);
        let connection = state.database.lock().expect("database lock");
        let output_state: String = connection
            .query_row(
                "SELECT validation_state FROM job_outputs WHERE output_id='output-test'",
                [],
                |row| row.get(0),
            )
            .expect("output evidence state");
        assert_eq!(output_state, "valid");
    }

    #[test]
    fn external_fixture_unknown_failure_requires_reconciliation() {
        let state = seeded_state();
        {
            let connection = state.database.lock().expect("database lock");
            connection
                .execute(
                    "UPDATE jobs SET state='running' WHERE job_id='job-test'",
                    [],
                )
                .expect("running job");
            connection
                .execute(
                    "UPDATE job_attempts SET state='running', execution_mode='external_process', executable_id='ffmpeg', process_started=1, worker_id='native-external', lease_owner='external-worker:attempt-test', lease_expires_at='2026-08-23T00:01:00Z', heartbeat_at='2026-08-23T00:00:00Z', started_at='2026-08-23T00:00:00Z' WHERE attempt_id='attempt-test'",
                    [],
                )
                .expect("running external attempt");
            connection
                .execute(
                    "INSERT INTO job_outputs(output_id, attempt_id, relative_path, media_kind, validation_state, created_at) VALUES ('output-test', 'attempt-test', 'fixtures/attempt/synthetic-1s.mp4', 'video', 'pending', '0')",
                    [],
                )
                .expect("pending output");
        }
        let result = persist_external_fixture_failure(
            &state,
            "attempt-test",
            FixtureFailure {
                output_path: "fixtures/attempt/synthetic-1s.mp4".to_string(),
                error_code: "FFMPEG_CANCELLED".to_string(),
                message: "Process bị hủy theo yêu cầu".to_string(),
                external_side_effect_unknown: true,
                termination_mode: "tree_force".to_string(),
                stdout_bytes: 4,
                stderr_bytes: 8,
                output_evidence: Vec::new(),
            },
        )
        .expect("persist unknown failure");
        assert_eq!(result.state, "reconciliation_required");
        assert!(result.external_side_effect_unknown);
        let connection = state.database.lock().expect("database lock");
        let job_state: String = connection
            .query_row(
                "SELECT state FROM jobs WHERE job_id='job-test'",
                [],
                |row| row.get(0),
            )
            .expect("reconciled job state");
        assert_eq!(job_state, "reconciliation_required");
        let output_state: String = connection
            .query_row(
                "SELECT validation_state FROM job_outputs WHERE output_id='output-test'",
                [],
                |row| row.get(0),
            )
            .expect("unknown output state");
        assert_eq!(output_state, "missing");
    }

    #[test]
    fn narrative_visual_preview_is_deterministic_and_no_spawn() {
        let document: Value =
            serde_json::from_str(NARRATIVE_VISUAL_PLAN_FIXTURE).expect("visual plan fixture");
        let preview = compile_narrative_visual_plan(&document).expect("visual plan preview");
        assert_eq!(preview.plan_id, "minimal-narrative-visual-plan");
        assert_eq!(preview.beats.len(), 3);
        assert_eq!(preview.total_duration_frames, 900);
        assert!(!preview.generation_started);
        assert!(!preview.network_calls_made);
        assert!(!preview.external_publish);
        assert!(!preview.paid_generation);
        assert!(preview.human_review_required);
        assert_eq!(
            preview.beats[1].entities[0].identity_anchors,
            preview.beats[2].entities[0].identity_anchors
        );
    }

    #[test]
    fn narrative_visual_preview_rejects_timing_entity_and_command_drift() {
        let mut timing_gap: Value =
            serde_json::from_str(NARRATIVE_VISUAL_PLAN_FIXTURE).expect("visual plan fixture");
        timing_gap["beats"][1]["timing"]["startFrame"] = serde_json::json!(301);
        assert!(compile_narrative_visual_plan(&timing_gap).is_err());

        let mut entity_drift: Value =
            serde_json::from_str(NARRATIVE_VISUAL_PLAN_FIXTURE).expect("visual plan fixture");
        entity_drift["beats"][1]["entities"][0]["identityAnchors"] =
            serde_json::json!(["changed identity"]);
        assert!(compile_narrative_visual_plan(&entity_drift).is_err());

        let mut raw_command: Value =
            serde_json::from_str(NARRATIVE_VISUAL_PLAN_FIXTURE).expect("visual plan fixture");
        raw_command["beats"][0]["shell"] = serde_json::json!("ffmpeg --help");
        assert!(compile_narrative_visual_plan(&raw_command).is_err());
    }

    #[test]
    fn project_id_normalization_uses_ascii_lowercase_slug_rules() {
        assert_eq!(
            normalize_project_id("Dự án Mặc định"),
            "du-an-mac-dinh"
        );
        assert_eq!(normalize_project_id("Project / 01"), "project-01");
        assert!(is_safe_project_id("du-an-mac-dinh"));
        assert!(!is_safe_project_id("Dự án Mặc định"));
    }

    #[test]
    fn project_id_migration_updates_project_children_without_orphans() {
        let mut connection = Connection::open_in_memory().expect("in-memory migration database");
        apply_migrations(&mut connection).expect("initial migrations");
        connection
            .execute(
                "DELETE FROM schema_migrations WHERE version = ?1",
                params![PROJECT_ID_NORMALIZATION_VERSION],
            )
            .expect("remove normalization marker for fixture");
        connection
            .execute(
                "INSERT INTO projects(project_id, name, locale, workspace_root, policy_profile, created_at, updated_at) VALUES (?1, ?2, 'vi-VN', 'D:/Auto3Dvideo/test', 'safe-local', '0', '0')",
                params!["Dự án Mặc định", "Dự án Mặc định"],
            )
            .expect("legacy project");
        connection
            .execute(
                "INSERT INTO recipes(recipe_id, project_id, name, recipe_kind, config_json, status, created_at, updated_at) VALUES ('recipe-legacy', ?1, 'Legacy', 'fixture', '{}', 'draft', '0', '0')",
                params!["Dự án Mặc định"],
            )
            .expect("legacy child");

        normalize_project_ids(&mut connection).expect("normalize legacy project");
        let project_id: String = connection
            .query_row(
                "SELECT project_id FROM projects WHERE name = 'Dự án Mặc định'",
                [],
                |row| row.get(0),
            )
            .expect("normalized project");
        let recipe_project_id: String = connection
            .query_row(
                "SELECT project_id FROM recipes WHERE recipe_id = 'recipe-legacy'",
                [],
                |row| row.get(0),
            )
            .expect("normalized child");
        assert_eq!(project_id, "du-an-mac-dinh");
        assert_eq!(recipe_project_id, project_id);
    }

    #[test]
    fn migrations_are_idempotent_on_restart() {
        let mut connection = Connection::open_in_memory().expect("in-memory migration database");
        apply_migrations(&mut connection).expect("first migration pass");
        apply_migrations(&mut connection).expect("restart migration pass");
        let versions: i64 = connection
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("migration version count");
        let execution_mode_columns: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('job_attempts') WHERE name = 'execution_mode'",
                [],
                |row| row.get(0),
            )
            .expect("execution mode column count");
        assert_eq!(versions, 9);
        assert_eq!(execution_mode_columns, 1);
        let voice_profile_tables: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('voice_profiles', 'voice_synthesis_jobs')",
                [],
                |row| row.get(0),
            )
            .expect("voice profile tables");
        assert_eq!(voice_profile_tables, 2);
        let prompt_preset_table: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'prompt_presets'",
                [],
                |row| row.get(0),
            )
            .expect("prompt preset table");
        assert_eq!(prompt_preset_table, 1);
        let asset_reference_tables: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('asset_library', 'reference_sets', 'reference_set_assignments')",
                [],
                |row| row.get(0),
            )
            .expect("asset/reference tables");
        assert_eq!(asset_reference_tables, 3);
        let asset_pack_review_tables: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('asset_pack_sources', 'asset_pack_item_reviews')",
                [],
                |row| row.get(0),
            )
            .expect("asset pack review tables");
        assert_eq!(asset_pack_review_tables, 2);
    }

    #[test]
    fn mock_claim_writes_lease_without_external_process() {
        let state = seeded_state();
        let (attempt, cancellation) = claim_mock_attempt(&state, "attempt-test").expect("claim");
        assert_eq!(attempt.state, "running");
        assert_eq!(attempt.execution_mode, "in_process_mock");
        assert!(!attempt.process_started);
        assert!(!cancellation.load(Ordering::SeqCst));

        assert!(
            update_mock_heartbeat_for_state(&state, "attempt-test", 0.5, 60).expect("heartbeat")
        );
        let connection = state.database.lock().expect("database lock");
        let row: (String, String, i64, f64, i64) = connection
            .query_row(
                "SELECT lease_owner, execution_mode, process_started, (SELECT progress FROM jobs WHERE job_id = 'job-test'), COUNT(*) FROM job_attempts WHERE attempt_id = 'attempt-test' AND state = 'running' GROUP BY lease_owner, execution_mode, process_started",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .expect("claimed row");
        assert_eq!(row.0, "mock-worker:attempt-test");
        assert_eq!(row.1, "in_process_mock");
        assert_eq!(row.2, 0);
        assert_eq!(row.3, 0.5);
        assert_eq!(row.4, 1);
        drop(connection);
        finish_mock_attempt_for_state(&state, "attempt-test", false).expect("success finish");
        let connection = state.database.lock().expect("database lock");
        let terminal: (String, String) = connection
            .query_row(
                "SELECT a.state, j.state FROM job_attempts a JOIN jobs j ON j.job_id = a.job_id WHERE a.attempt_id = 'attempt-test'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("terminal row");
        assert_eq!(terminal, ("succeeded".to_string(), "succeeded".to_string()));
    }

    #[test]
    fn mock_cancel_sets_attempt_request_and_token() {
        let state = seeded_state();
        let (_attempt, cancellation) = claim_mock_attempt(&state, "attempt-test").expect("claim");
        assert!(request_attempt_cancel(&state, "job-test").expect("cancel request"));
        assert!(cancellation.load(Ordering::SeqCst));
        finish_mock_attempt_for_state(&state, "attempt-test", true).expect("cancel finish");

        let connection = state.database.lock().expect("database lock");
        let row: (String, Option<String>, String, String) = connection
            .query_row(
                "SELECT a.state, a.cancellation_requested_at, a.termination_mode, j.state FROM job_attempts a JOIN jobs j ON j.job_id = a.job_id WHERE a.attempt_id = 'attempt-test'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("cancelled request row");
        assert_eq!(row.0, "cancelled");
        assert!(row.1.is_some());
        assert_eq!(row.2, "cooperative");
        assert_eq!(row.3, "cancelled");
    }
}

#[cfg(test)]
mod topic_registry_tests {
    use super::*;

    fn valid_preset_input() -> PromptPresetInput {
        PromptPresetInput {
            project_id: "project-test".to_string(),
            name: "Cinematic ocean".to_string(),
            description: "A reusable 3D shot prompt".to_string(),
            scope: "project".to_string(),
            status: "active".to_string(),
            version: "v1.0.0".to_string(),
            template: "Subject {{topic}}, camera wide, slow dolly-in.".to_string(),
            variable_keys: vec!["topic".to_string()],
            negative_template: "no flicker, no broken geometry".to_string(),
            provider_targets: vec!["blender-local".to_string()],
            style_bible_id: None,
            rights_license_note: "Use only owned or reviewed assets.".to_string(),
            parent_preset_id: None,
        }
    }

    #[test]
    fn prompt_preset_validation_accepts_safe_input() {
        assert!(validate_prompt_preset_input(&valid_preset_input()).is_ok());
        assert_eq!(bump_prompt_preset_version("v1.2.9"), "v1.2.10");
    }

    #[test]
    fn prompt_preset_validation_rejects_secrets_and_invalid_version() {
        let mut secret = valid_preset_input();
        secret.template = "Use api_key=do-not-store".to_string();
        assert!(validate_prompt_preset_input(&secret).is_err());

        let mut version = valid_preset_input();
        version.version = "latest".to_string();
        assert!(validate_prompt_preset_input(&version).is_err());
    }

    #[test]
    fn topic_prompt_preview_renders_topic_without_side_effects() {
        let report = preview_topic_prompt(TopicPromptPreviewRequest {
            profile_id: "science-explainer".to_string(),
            template_id: "content-brief-v1".to_string(),
            topic: "Vì sao cực quang xuất hiện?".to_string(),
            audience: "Người xem phổ thông".to_string(),
            content_goal: "Giải thích có nguồn".to_string(),
            additional_prompt: "Nhịp bình tĩnh, video dọc.".to_string(),
        })
        .expect("valid topic preview");
        assert!(report
            .rendered_prompt
            .contains("Vì sao cực quang xuất hiện?"));
        assert!(report
            .rendered_prompt
            .contains("Nhịp bình tĩnh, video dọc."));
        assert_eq!(report.selected_recipe_kind, "html_to_video");
        assert!(!report.network_calls_made);
        assert!(!report.paid_generation);
        assert!(!report.external_publish);
        assert!(report.required_human_review);
    }

    #[test]
    fn topic_prompt_preview_rejects_secret_like_input() {
        let error = preview_topic_prompt(TopicPromptPreviewRequest {
            profile_id: "science-explainer".to_string(),
            template_id: "content-brief-v1".to_string(),
            topic: "topic".to_string(),
            audience: "audience".to_string(),
            content_goal: "goal".to_string(),
            additional_prompt: "api_key=do-not-accept".to_string(),
        })
        .expect_err("secret-shaped prompt must be rejected");
        assert!(error.contains("bí mật"));
    }
}

#[cfg(test)]
mod obscura_preview_tests {
    use super::{
        build_obscura_preview_report, build_ytdlp_creator_preview_report,
        merge_bilibili_public_catalog, merge_preview_platform_fallback, obscura_canonical_video_url,
        preview_report_has_cards_for_platform,
    };

    #[test]
    fn obscura_report_parses_cards_and_strips_worker_only_fields() {
        let stdout = r#"{"sourceUrl":"https://www.tiktok.com/explore","cards":[{"shareUrl":"https://www.tiktok.com/@creator/video/123456","title":"Hot dance","author":"creator","thumbnailUrl":"https://cdn.example.com/thumb.jpg","observedSignals":["hot"],"freshSignal":true,"observedMetrics":{"engagement":true}}]}"#;
        let report = build_obscura_preview_report(stdout, &["tiktok".to_string()], 24);
        assert_eq!(report.get("status").and_then(|value| value.as_str()), Some("success"));
        let card = &report["cards"][0];
        assert_eq!(card["platform"], "tiktok");
        assert_eq!(card["embedUrl"], "https://www.tiktok.com/player/v1/123456");
        assert!(card.get("observedSignals").is_none());
        assert!(card["radarBuckets"].as_array().is_some_and(|buckets| {
            buckets.iter().any(|bucket| bucket == "hot_new")
        }));
    }

    #[test]
    fn obscura_rejects_discovery_route_as_video_card() {
        assert!(obscura_canonical_video_url("https://www.tiktok.com/explore", "tiktok").is_none());
        assert!(obscura_canonical_video_url("https://www.tiktok.com/item/create", "tiktok").is_none());
        assert!(obscura_canonical_video_url("https://www.ixigua.com/video/app", "xigua").is_none());
        assert!(obscura_canonical_video_url("https://www.ixigua.com/video/pc", "xigua").is_none());
        assert!(obscura_canonical_video_url("https://www.bilibili.com/v/popular/all", "bilibili").is_none());
        assert!(obscura_canonical_video_url("https://www.tiktok.com/@creator/video/123456", "tiktok").is_some());
        assert!(obscura_canonical_video_url("https://www.douyin.com/video/987654321", "douyin").is_some());
        assert!(obscura_canonical_video_url("https://www.bilibili.com/video/BV1Existing", "bilibili").is_some());
        assert!(obscura_canonical_video_url("https://www.ixigua.com/video/123456789", "xigua").is_some());
    }

    #[test]
    fn ytdlp_catalog_report_keeps_only_video_urls_and_marks_missing_metrics() {
        let stdout = r#"{"entries":[{"webpage_url":"https://www.tiktok.com/@creator/video/123456","title":"Dance reference","uploader":"creator"},{"webpage_url":"https://www.tiktok.com/explore","title":"Not a video"}]}"#;
        let report = build_ytdlp_creator_preview_report(
            stdout,
            "tiktok",
            "https://www.tiktok.com/@creator",
            24,
        );
        assert_eq!(report["status"], "success");
        assert_eq!(report["cards"].as_array().map(Vec::len), Some(1));
        assert_eq!(report["cards"][0]["title"], "Dance reference");
        assert_eq!(report["cards"][0]["radarBuckets"][0], "unranked");
        assert!(report["cards"][0]["rankingEvidence"]
            .as_str()
            .is_some_and(|value| value.contains("chưa có dữ liệu view/like")));
    }

    #[test]
    fn public_bilibili_catalog_merges_only_new_video_cards() {
        let mut base = serde_json::json!({
            "status": "blocked",
            "platformResults": [{
                "platform": "bilibili",
                "status": "blocked",
                "scannedCount": 0,
                "discoveryUrl": "https://www.bilibili.com/v/popular/all",
                "message": "BrowserOS không đọc được card"
            }],
            "cards": [{
                "platform": "bilibili",
                "shareUrl": "https://www.bilibili.com/video/BV1Existing",
                "title": "Existing"
            }]
        });
        let catalog = serde_json::json!({
            "status": "success",
            "platformResults": [{
                "platform": "bilibili",
                "status": "success",
                "scannedCount": 2,
                "discoveryUrl": "https://www.bilibili.com/v/popular/all",
                "message": "catalog ok"
            }],
            "cards": [
                {"platform": "bilibili", "shareUrl": "https://www.bilibili.com/video/BV1Existing", "title": "Duplicate"},
                {"platform": "bilibili", "shareUrl": "https://www.bilibili.com/video/BV1NewCard", "title": "New"}
            ]
        });
        assert!(preview_report_has_cards_for_platform(&base, "bilibili"));
        let added = merge_bilibili_public_catalog(&mut base, &catalog).expect("merge should pass");
        assert_eq!(added, 1);
        assert_eq!(base["cards"].as_array().map(Vec::len), Some(2));
        assert_eq!(base["status"], "success");
        assert_eq!(base["platformResults"][0]["status"], "success");
    }

    #[test]
    fn browseros_fallback_merges_only_platforms_missing_from_obscura() {
        let base = serde_json::json!({
            "status": "partial",
            "platforms": ["tiktok", "bilibili"],
            "platformResults": [
                {"platform": "tiktok", "status": "blocked", "scannedCount": 0, "message": "Obscura blocked"},
                {"platform": "bilibili", "status": "success", "scannedCount": 1, "message": "Bilibili catalog"}
            ],
            "cards": [{"platform": "bilibili", "shareUrl": "https://www.bilibili.com/video/BV1Existing"}]
        });
        let fallback = serde_json::json!({
            "status": "success",
            "platforms": ["tiktok"],
            "platformResults": [
                {"platform": "tiktok", "status": "success", "scannedCount": 1, "message": "BrowserOS card"}
            ],
            "cards": [
                {"platform": "tiktok", "shareUrl": "https://www.tiktok.com/@creator/video/123456789"},
                {"platform": "tiktok", "shareUrl": "https://www.tiktok.com/item/create"}
            ]
        });
        let process = super::ExternalProcessResult {
            executable_id: "node".to_string(),
            exit_code: Some(0),
            succeeded: true,
            timed_out: false,
            cancelled: false,
            termination_mode: "none".to_string(),
            stdout: String::new(),
            stderr: String::new(),
            stdout_bytes: 0,
            stderr_bytes: 0,
            stdout_truncated: false,
            stderr_truncated: false,
            external_side_effect_unknown: false,
            output_evidence: Vec::new(),
        };
        let merged = merge_preview_platform_fallback(base, &fallback, &["tiktok".to_string()], &process)
            .expect("fallback should merge");
        assert_eq!(merged["cards"].as_array().map(Vec::len), Some(2));
        assert_eq!(merged["platformResults"][0]["status"], "success");
        assert_eq!(merged["status"], "success");
        assert_eq!(merged["engine"], "obscura_public_scrape+browseros_preview_scan");
    }
}

#[cfg(test)]
mod reference_video_tests {
    use super::{validate_preview_creator_source_url, validate_reference_video_source_url};

    #[test]
    fn accepts_allowlisted_https_video_hosts() {
        assert_eq!(
            validate_reference_video_source_url("https://www.tiktok.com/@creator/video/123"),
            Ok("tiktok.com".to_string())
        );
        assert_eq!(
            validate_reference_video_source_url("https://www.douyin.com/video/123"),
            Ok("douyin.com".to_string())
        );
    }

    #[test]
    fn rejects_non_https_private_or_secret_like_urls() {
        assert!(validate_reference_video_source_url("http://www.tiktok.com/video/123").is_err());
        assert!(validate_reference_video_source_url("https://example.com/video/123").is_err());
        assert!(
            validate_reference_video_source_url("https://tiktok.com/video/123?token=secret")
                .is_err()
        );
        assert!(validate_reference_video_source_url("https://user:tiktok.com/video/123").is_err());
    }

    #[test]
    fn creator_source_requires_the_selected_platform() {
        assert_eq!(
            validate_preview_creator_source_url("https://www.tiktok.com/@creator", "tiktok"),
            Ok("https://www.tiktok.com/@creator".to_string())
        );
        assert!(validate_preview_creator_source_url("https://www.tiktok.com/@creator", "douyin").is_err());
    }
}
