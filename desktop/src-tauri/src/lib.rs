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
const WINDOWS_USER_MAPPED_FILE_ERROR: i32 = 1224;

mod app_shell;
mod asset_library;
mod asset_packs;
mod browser_handoff;
mod catalogs;
mod external_worker;
mod google_flow_automation;
mod image_generation;
mod local_video;
mod media_io;
mod preview_discovery;
mod process_executor;
mod project_jobs;
mod provider_catalog;
mod provider_config;
mod reference_sets;
mod subtitle;
mod tool_readiness;
mod true3d_scene;
mod video_vision;
mod video_workflow_sessions;
mod voice_tts;
mod worker_execution;
use asset_library::{
    asset_status_for_rights, fetch_asset, fetch_reference_set, import_asset_with_state,
    validate_asset_rights, validate_asset_text, validate_reference_role, validate_reference_scope,
    AssetImportInput, AssetView, ReferenceAssignmentInput, ReferenceSetInput, ReferenceSetView,
};
#[cfg(test)]
use asset_library::{
    mime_for_asset_path, validate_asset_kind, validate_reference_video_source_url,
};
use catalogs::preview_recipe;
#[cfg(test)]
use catalogs::{
    bump_prompt_preset_version, preview_topic_prompt, validate_prompt_preset_input,
    PromptPresetInput, TopicPromptPreviewRequest,
};
use external_worker::{
    run_external_process, ExternalProcessRequest, ExternalProcessResult, OutputEvidence,
};
#[cfg(test)]
use google_flow_automation::{
    browseros_flow_download_clicked, browseros_flow_operation_for_dom_mode,
    flow_image_cards_from_report, flow_video_action_confirmed, google_flow_project_urls_match,
    preflight_shot_reference_flow_binding_in, safe_flow_card_media_id, sanitize_flow_card_label,
    sanitize_flow_card_preview, shot_reference_rights_cleared, video_action_reference_media_id,
    GoogleFlowVideoActionRequest, ShotReferenceFlowPreflightRequest,
};
#[cfg(test)]
use image_generation::{
    classify_nanobanana_report, comfy_ui_health_check, gflow_worker_failure_detail,
    nanobanana_cdp_preflight, validate_nanobanana_cdp_url,
};
#[cfg(test)]
use media_io::workspace_media_mime_type;
#[cfg(test)]
use preview_discovery::{
    build_obscura_preview_report, build_ytdlp_creator_preview_report,
    merge_bilibili_public_catalog, merge_preview_platform_fallback, obscura_canonical_video_url,
    preview_report_has_cards_for_platform, validate_preview_creator_source_url,
};
use process_executor::{plan_process_dry_run, ProcessDryRunPlan, ProcessSpec};
use tool_readiness::resolve_configured_tool;

#[cfg(test)]
use tool_readiness::{
    executable_ref_available, executable_ref_usable, local_tool_probe_args,
    preferred_tool_reference, validate_executable_ref,
};
#[cfg(test)]
use true3d_scene::compile_narrative_visual_plan;
#[cfg(test)]
use video_workflow_sessions::{
    read_video_workflow_sessions, video_workflow_session_directory,
    video_workflow_session_recovery_path, VideoWorkflowSessionFile, VideoWorkflowSessionView,
};
use voice_tts::{
    ensure_omnivoice_worker_script, omnivoice_worker_environment, validate_omnivoice_wav,
};
use worker_execution::{commandcode_worker_environment, request_attempt_cancel};

#[cfg(test)]
use worker_execution::{
    claim_mock_attempt, execute_ffmpeg_fixture_for_attempt, finish_mock_attempt_for_state,
    persist_external_fixture_failure, persist_external_fixture_success,
    reconcile_active_external_attempts, update_mock_heartbeat_for_state, FixtureFailure,
    LocalMediaFixtureReport,
};

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
const APP_PREFERENCES_MIGRATION: &str = include_str!("../migrations/0010_app_preferences.sql");
const APP_PREFERENCES_VERSION: &str = "0010_app_preferences";
const PROJECT_ID_NORMALIZATION_VERSION: &str = "0009_project_id_normalization";
const CLOUD_GENERATION_PREFERENCE_KEY: &str = "cloud_generation_enabled";
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
const GOOGLE_FLOW_MCP_WORKER_SCRIPT: &str =
    include_str!("../../../scripts/google_flow_mcp_worker.mjs");
const GOOGLE_FLOW_DOM_WORKER_SCRIPT: &str =
    include_str!("../../../scripts/google_flow_dom_worker.mjs");
const PLAYWRIGHT_FLOW_WORKER_SCRIPT: &str =
    include_str!("../../../scripts/playwright_flow_worker.mjs");
const BROWSEROS_FLOW_WORKER_SCRIPT: &str =
    include_str!("../../../scripts/browseros_flow_worker.mjs");
const FLOW_EXACT_MEDIA_SCRIPT: &str = include_str!("../../../scripts/flow_exact_media.mjs");
const GFLOW_CLI_WORKER_SCRIPT: &str = include_str!("../../../scripts/gflow_cli_worker.py");
const GFLOW_CLI_AUTH_WORKER_SCRIPT: &str =
    include_str!("../../../scripts/gflow_cli_auth_worker.py");
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
struct AppState {
    database: Mutex<Connection>,
    cancellation_tokens: Mutex<HashMap<String, Arc<AtomicBool>>>,
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
        'a' | 'à' | 'á' | 'ả' | 'ã' | 'ạ' | 'â' | 'ầ' | 'ấ' | 'ẩ' | 'ẫ' | 'ậ' | 'ă' | 'ằ' | 'ắ'
        | 'ẳ' | 'ẵ' | 'ặ' | 'À' | 'Á' | 'Ả' | 'Ã' | 'Ạ' | 'Â' | 'Ầ' | 'Ấ' | 'Ẩ' | 'Ẫ' | 'Ậ'
        | 'Ă' | 'Ằ' | 'Ắ' | 'Ẳ' | 'Ẵ' | 'Ặ' => 'a',
        'd' | 'đ' | 'D' | 'Đ' => 'd',
        'e' | 'è' | 'é' | 'ẻ' | 'ẽ' | 'ẹ' | 'ê' | 'ề' | 'ế' | 'ể' | 'ễ' | 'ệ' | 'È' | 'É' | 'Ẻ'
        | 'Ẽ' | 'Ẹ' | 'Ê' | 'Ề' | 'Ế' | 'Ể' | 'Ễ' | 'Ệ' => 'e',
        'i' | 'ì' | 'í' | 'ỉ' | 'ĩ' | 'ị' | 'Ì' | 'Í' | 'Ỉ' | 'Ĩ' | 'Ị' => 'i',
        'o' | 'ò' | 'ó' | 'ỏ' | 'õ' | 'ọ' | 'ô' | 'ồ' | 'ố' | 'ổ' | 'ỗ' | 'ộ' | 'ơ' | 'ờ' | 'ớ'
        | 'ở' | 'ỡ' | 'ợ' | 'Ò' | 'Ó' | 'Ỏ' | 'Õ' | 'Ọ' | 'Ô' | 'Ồ' | 'Ố' | 'Ổ' | 'Ỗ' | 'Ộ'
        | 'Ơ' | 'Ờ' | 'Ớ' | 'Ở' | 'Ỡ' | 'Ợ' => 'o',
        'u' | 'ù' | 'ú' | 'ủ' | 'ũ' | 'ụ' | 'ư' | 'ừ' | 'ứ' | 'ử' | 'ữ' | 'ự' | 'Ù' | 'Ú' | 'Ủ'
        | 'Ũ' | 'Ụ' | 'Ư' | 'Ừ' | 'Ứ' | 'Ử' | 'Ữ' | 'Ự' => 'u',
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
    let app_preferences_applied: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = ?1",
            params![APP_PREFERENCES_VERSION],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if app_preferences_applied == 0 {
        connection
            .execute_batch(APP_PREFERENCES_MIGRATION)
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                params![APP_PREFERENCES_VERSION, now_string()],
            )
            .map_err(|error| error.to_string())?;
    }
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
    worker_execution::reconcile_active_external_attempts(&connection)?;
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

// A media ID names a Flow card, so it is checked against the one card contract
// the discovery parser and the session schema already enforce rather than the
// shorter batch-identity rule. Without this, a card whose ID is longer than 96
// characters could be discovered, previewed and saved into a binding, then
// refused at the moment the worker was asked to attach it. The `__newest__`
// sentinel is the one non-card value the download route still sends.
fn validate_google_flow_media_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value == "__newest__" || google_flow_automation::safe_flow_card_media_id(value) {
        return Ok(value.to_string());
    }
    Err("mediaId chứa media ID không hợp lệ".to_string())
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

fn safe_id(value: &str, field: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if !safe_preview_id(trimmed) {
        return Err(format!("{field} không hợp lệ"));
    }
    Ok(trimmed.to_string())
}

fn safe_flow_shot_id(value: &str) -> bool {
    let trimmed = value.trim();
    (3..=64).contains(&trimmed.len())
        && trimmed.chars().all(|character| {
            character.is_ascii_uppercase()
                || character.is_ascii_digit()
                || matches!(character, '-' | '_')
        })
}

fn safe_relative_path(value: &str, field: &str) -> Result<String, String> {
    let normalized = value.trim().replace('\\', "/");
    if !safe_preview_relative_path(&normalized) {
        return Err(format!("{field} không phải đường dẫn tương đối an toàn"));
    }
    Ok(normalized)
}

fn preview_secret_like(value: &str) -> bool {
    let normalized = value.to_ascii_lowercase();
    [
        "api_key", "apikey", "secret", "token", "password", "sk-", "bearer ",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}

// Prompt text is allowed to contain ordinary creative vocabulary such as
// "secret", "token" or "password" when those words describe a scene. Only
// reject explicit credential-shaped assignments in prompts.
fn prompt_secret_like(value: &str) -> bool {
    let normalized = value.to_ascii_lowercase();
    [
        "api_key=",
        "api-key=",
        "apikey=",
        "access_token=",
        "access-token=",
        "authorization=",
        "authorization:",
        "client_secret=",
        "client-secret=",
        "password=",
        "password:",
        "secret=",
        "secret:",
        "token=",
        "token:",
        "sk-",
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

fn bounded_failure_message(message: &str) -> String {
    message.chars().take(4096).collect()
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

fn read_cloud_generation_enabled(connection: &Connection) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT COALESCE((SELECT enabled FROM app_preferences WHERE preference_key = ?1), 0)",
            params![CLOUD_GENERATION_PREFERENCE_KEY],
            |row| row.get::<_, i64>(0),
        )
        .map(|enabled| enabled == 1)
        .map_err(|error| format!("Không đọc được quyền Cloud/API: {error}"))
}

fn save_cloud_generation_enabled(connection: &Connection, enabled: bool) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO app_preferences(preference_key, enabled, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(preference_key) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at",
            params![CLOUD_GENERATION_PREFERENCE_KEY, if enabled { 1_i64 } else { 0_i64 }, now_string()],
        )
        .map(|_| ())
        .map_err(|error| format!("Không lưu được quyền Cloud/API: {error}"))
}

fn current_cloud_generation_enabled(state: &AppState) -> Result<bool, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database khi kiểm tra quyền Cloud/API".to_string())?;
    read_cloud_generation_enabled(&connection)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .register_uri_scheme_protocol(WORKSPACE_MEDIA_SCHEME, |_ctx, request| {
            media_io::workspace_media_protocol_response(_ctx.app_handle(), request)
        })
        .setup(|app| {
            let connection = initialize_database(app.handle()).map_err(std::io::Error::other)?;
            app.manage(AppState {
                database: Mutex::new(connection),
                cancellation_tokens: Mutex::new(HashMap::new()),
            });
            if let Err(error) = browser_handoff::start_browsermcp_server(&app.state::<AppState>()) {
                eprintln!("BrowserMCP startup deferred: {error}");
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            app_shell::app_snapshot,
            app_shell::set_cloud_generation_enabled,
            app_shell::health_check,
            project_jobs::list_projects,
            project_jobs::create_project,
            project_jobs::delete_project,
            project_jobs::list_jobs,
            project_jobs::enqueue_mock_job,
            project_jobs::enqueue_pending_job,
            catalogs::list_recipe_catalog,
            catalogs::list_topic_profiles,
            catalogs::list_prompt_templates,
            catalogs::list_prompt_presets,
            catalogs::create_prompt_preset,
            catalogs::update_prompt_preset,
            catalogs::archive_prompt_preset,
            catalogs::restore_prompt_preset,
            video_workflow_sessions::list_video_workflow_sessions,
            video_workflow_sessions::save_video_workflow_session,
            video_workflow_sessions::delete_video_workflow_session,
            asset_library::list_assets,
            asset_library::import_asset,
            asset_library::download_reference_video,
            asset_library::update_asset_metadata,
            asset_library::archive_asset,
            asset_library::restore_asset,
            asset_packs::list_asset_pack_reviews,
            asset_packs::register_asset_pack_source,
            asset_packs::update_asset_pack_item_review,
            asset_packs::prepare_asset_pack_blender_binding,
            asset_packs::run_asset_pack_blender_binding,
            reference_sets::list_reference_sets,
            reference_sets::create_reference_set,
            reference_sets::update_reference_set,
            reference_sets::archive_reference_set,
            reference_sets::restore_reference_set,
            reference_sets::assign_reference,
            reference_sets::detach_reference,
            catalogs::preview_topic_prompt,
            catalogs::validate_recipe_json,
            catalogs::preview_recipe,
            project_jobs::preview_process,
            project_jobs::prepare_pending_attempt,
            worker_execution::start_mock_attempt,
            worker_execution::run_ffmpeg_fixture,
            worker_execution::run_ffmpeg_fixture_attempt,
            tool_readiness::probe_local_tool,
            voice_tts::check_vieneu_local,
            voice_tts::run_vieneu_tts,
            voice_tts::check_omnivoice_local,
            voice_tts::prepare_omnivoice_model,
            voice_tts::list_voice_profiles,
            voice_tts::list_project_voice_samples,
            voice_tts::create_voice_profile,
            voice_tts::update_voice_profile,
            voice_tts::delete_voice_profile,
            voice_tts::run_omnivoice_tts,
            media_io::save_recorded_audio,
            media_io::save_recorded_audio_for_project,
            media_io::read_workspace_audio_base64,
            media_io::read_project_audio_base64,
            media_io::read_project_asset_preview,
            worker_execution::test_commandcode_chat,
            image_generation::check_comfyui_health,
            image_generation::run_comfyui_image_generation,
            image_generation::run_google_flow_mcp_image_generation,
            image_generation::connect_gflow_cli_account,
            image_generation::run_gflow_cli_video_generation,
            image_generation::compose_google_flow_mcp_images,
            google_flow_automation::ensure_chrome_cdp_session,
            preview_discovery::scan_preview_discovery,
            preview_discovery::scan_preview_creator_catalog,
            preview_discovery::scan_licensed_footage_discovery,
            google_flow_automation::type_google_flow_dom_prompt,
            google_flow_automation::inspect_google_flow_dom_output,
            google_flow_automation::run_google_flow_video_action,
            google_flow_automation::discover_google_flow_image_cards,
            google_flow_automation::preflight_shot_reference_flow_binding,
            google_flow_automation::run_google_flow_playwright_action,
            image_generation::run_nanobanana_image_generation,
            image_generation::read_nanobanana_image_progress,
            true3d_scene::run_blender_fixture,
            true3d_scene::run_true3d_fixture,
            true3d_scene::run_true3d_multishot_fixture,
            true3d_scene::run_asset_pipeline_check,
            true3d_scene::build_blender_shot_preview,
            true3d_scene::list_shot_approvals,
            true3d_scene::set_shot_approval,
            true3d_scene::preview_narrative_visual_plan,
            true3d_scene::preview_narrative_visual_plan_fixture,
            project_jobs::list_job_attempts,
            project_jobs::list_attempt_outputs,
            project_jobs::list_audit_events,
            tool_readiness::list_tool_readiness,
            tool_readiness::worker_preflight,
            tool_readiness::preview_worker_launch,
            tool_readiness::save_tool_config,
            project_jobs::retry_job,
            project_jobs::cancel_job,
            provider_catalog::list_provider_catalog,
            provider_catalog::get_provider_env_snapshot,
            provider_catalog::create_provider_profile,
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
            browser_handoff::get_browser_flow_workflow_for_run,
            browser_handoff::get_browser_handoff_state,
            browser_handoff::advance_browser_handoff,
            browser_handoff::list_browser_flow_downloads,
            browser_handoff::import_browser_flow_download,
            browser_handoff::compose_browser_flow_outputs,
            browser_handoff::compose_browser_flow_images,
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
                CREATE TABLE app_preferences (preference_key TEXT PRIMARY KEY, enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)), updated_at TEXT NOT NULL);
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
    fn prompt_secret_filter_allows_cinematic_vocabulary_but_rejects_assignments() {
        assert!(!prompt_secret_like(
            "A secret doorway opens while the token bearer walks through a cinematic fog."
        ));
        assert!(!prompt_secret_like(
            "FLOW CINEMATIC COMMANDS: /filmlook /token; keep the password motif symbolic."
        ));
        assert!(prompt_secret_like("api_key=do-not-send"));
        assert!(prompt_secret_like("token=do-not-send"));
        assert!(prompt_secret_like("Authorization: Bearer do-not-send"));
    }

    #[test]
    fn executable_ref_normalizes_outer_windows_quotes() {
        let path = r#"C:\Users\GIGABYTE\AppData\Local\Programs\Python\Python312\python.exe"#;
        assert_eq!(
            validate_executable_ref(&format!(r#""{path}""#)).expect("quoted path"),
            path
        );
        assert_eq!(
            validate_executable_ref(&format!(r#"'{path}'"#)).expect("single quoted path"),
            path
        );
    }

    #[test]
    fn google_flow_dom_requires_the_same_project_key() {
        let expected = "https://flow.google.com/project/2d478b58-f5fa-4606-baef-71425ab7476c";
        assert!(google_flow_project_urls_match(
            expected,
            Some("https://flow.google.com/project/2d478b58-f5fa-4606-baef-71425ab7476c/tools")
        ));
        assert!(!google_flow_project_urls_match(
            expected,
            Some("https://flow.google.com/project/another-project")
        ));
        assert!(!google_flow_project_urls_match(expected, None));
    }

    #[test]
    fn google_flow_video_download_mode_is_allowlisted() {
        assert_eq!(
            browseros_flow_operation_for_dom_mode("click_video_download")
                .expect("video download mode"),
            "flow_download_video_output"
        );
        assert!(browseros_flow_operation_for_dom_mode("arbitrary").is_err());
    }

    #[test]
    fn google_flow_dom_download_acknowledgement_uses_mode_specific_field() {
        let video_report = serde_json::json!({
            "downloadClicked": true,
            "downloadStarted": false,
        });
        assert!(browseros_flow_download_clicked(
            "click_video_download",
            &video_report
        ));
        assert!(!browseros_flow_download_clicked(
            "click_image_batch",
            &video_report
        ));

        let image_report = serde_json::json!({
            "downloadClicked": false,
            "downloadStarted": true,
        });
        assert!(browseros_flow_download_clicked(
            "click_image_batch",
            &image_report
        ));
        assert!(!browseros_flow_download_clicked(
            "click_video_download",
            &image_report
        ));
    }

    // Real inline image bytes: a PNG, a JPEG and a WebP header.
    const PNG_PREVIEW: &str = "data:image/png;base64,iVBORw0KGgo=";
    const JPEG_PREVIEW: &str = "data:image/jpeg;base64,/9j/4AAQSkZJRgAB";
    const WEBP_PREVIEW: &str = "data:image/webp;base64,UklGRiQAAABXRUJQ";

    #[test]
    fn flow_image_cards_keep_only_comparable_previews() {
        let report = serde_json::json!({
            "cards": [
                { "mediaId": "media-alpha", "label": "  shot  one\n card ", "preview": JPEG_PREVIEW },
                { "mediaId": "media-beta", "label": "remote only", "preview": "https://lh3.googleusercontent.com/secret" },
                { "mediaId": "media-alpha", "label": "duplicate", "preview": PNG_PREVIEW },
                { "mediaId": "not a media id", "label": "malformed", "preview": PNG_PREVIEW }
            ]
        });
        let (cards, duplicates, truncated) = flow_image_cards_from_report(&report, 24);
        assert_eq!(
            cards.len(),
            3,
            "a duplicate survives as its own card and a malformed ID is still dropped"
        );
        assert_eq!(duplicates, vec!["media-alpha".to_string()]);
        assert!(!truncated);
        assert_eq!(cards[0].media_id, "media-alpha");
        assert_eq!(
            cards[0].label, "shot one card",
            "labels are collapsed and control-stripped"
        );
        assert!(cards[0].preview_available);
        assert!(
            !cards[0].selectable,
            "a media ID shown twice can never be bound to the surviving copy"
        );
        assert!(!cards[2].selectable);
        assert_eq!(cards[2].media_id, "media-alpha");
        assert!(
            !cards[1].preview_available && !cards[1].selectable,
            "a card the page could not read is never comparable"
        );
        assert!(
            cards[1].preview.is_none(),
            "a remote preview URL is never forwarded to the UI"
        );

        let unique = serde_json::json!({
            "cards": [{ "mediaId": "media-solo", "label": "solo", "preview": WEBP_PREVIEW }]
        });
        let (solo, duplicates, _) = flow_image_cards_from_report(&unique, 24);
        assert!(duplicates.is_empty());
        assert!(
            solo[0].selectable,
            "a unique, readable card stays selectable"
        );

        let (bounded, _, truncated) = flow_image_cards_from_report(&report, 1);
        assert_eq!(bounded.len(), 1);
        assert!(
            !bounded[0].selectable,
            "a repeat outside the bound still disambiguates the copy that stayed"
        );
        assert!(
            truncated,
            "the caller is told the list was cut instead of silently dropped"
        );
    }

    #[test]
    fn flow_image_cards_from_an_incomplete_read_are_never_selectable() {
        let complete = serde_json::json!({
            "cards": [
                { "mediaId": "media-solo", "label": "solo", "preview": PNG_PREVIEW },
                { "mediaId": "media-second", "label": "second", "preview": JPEG_PREVIEW }
            ]
        });
        let (cards, duplicates, truncated) = flow_image_cards_from_report(&complete, 24);
        assert!(!truncated);
        assert!(duplicates.is_empty());
        assert!(
            cards.iter().all(|card| card.selectable),
            "a complete, unique, previewed list stays bindable"
        );

        // The worker reads one card past the bound, so a report that says it was
        // cut short may be hiding a second copy of a media ID that looks unique
        // in what it did return.
        let cut_short = serde_json::json!({
            "truncated": true,
            "cards": [{ "mediaId": "media-solo", "label": "solo", "preview": PNG_PREVIEW }]
        });
        let (cut, duplicates, truncated) = flow_image_cards_from_report(&cut_short, 24);
        assert!(
            duplicates.is_empty(),
            "an incomplete read cannot rule a repeat out, it simply never saw one"
        );
        assert!(
            truncated,
            "the caller is told the list it holds is not the whole grid"
        );
        assert!(
            !cut[0].selectable,
            "a card read out of a list that was cut short is never bindable"
        );

        // Overflow found here rather than reported is the same incomplete read.
        let (bounded, _, truncated) = flow_image_cards_from_report(&complete, 1);
        assert!(truncated);
        assert!(!bounded[0].selectable);
    }

    #[test]
    fn flow_media_id_requests_accept_the_whole_card_contract() {
        // The discovery parser, the session schema and the worker all allow a
        // 256-character media ID, so the request that attaches one must not be
        // narrower: a card that can be discovered and saved must be attachable.
        let long_id = format!("media-{}", "a".repeat(250));
        assert_eq!(
            validate_google_flow_media_id(&long_id).expect("a card-contract ID is accepted"),
            long_id
        );
        assert_eq!(
            validate_google_flow_media_id("__newest__")
                .expect("the newest-media sentinel survives"),
            "__newest__"
        );
        assert!(validate_google_flow_media_id("media-abc_1.2:3").is_ok());
        assert!(
            validate_google_flow_media_id("has space").is_err(),
            "a malformed media ID is still refused before any worker runs"
        );
        assert!(validate_google_flow_media_id(&"a".repeat(257)).is_err());
        assert!(validate_google_flow_media_id("").is_err());
    }

    #[test]
    fn flow_video_action_reference_media_id_accepts_the_whole_card_contract() {
        let request = |reference: Option<&str>| -> GoogleFlowVideoActionRequest {
            let mut value = serde_json::json!({
                "projectUrl": "https://flow.google.com/project/proj-9/tools",
                "mode": "type_prompt",
                "prompt": "SHOT_ID: SHOT-002 | REVISION_ID: rev-001",
                "shotId": "SHOT-002",
                "revisionId": "rev-001",
                "runId": "flow-run",
                "model": "Omni 1.1 Flash",
                "expectedCreditCost": 20,
                "approvedBatchCreditCap": 200,
                "shotCount": 10,
                "userApproved": true,
            });
            if let Some(media) = reference {
                value["referenceMediaId"] = Value::String(media.to_string());
            }
            serde_json::from_value(value).expect("the video action request deserializes")
        };

        // A legacy text-only shot carries no binding and requires no chip.
        assert_eq!(
            video_action_reference_media_id(&request(None)).expect("an unbound shot is allowed"),
            None
        );
        // A card that discovery and the session schema both accept must survive
        // the trip that re-checks it, or a bindable card would become unusable.
        let long_id = format!("media-{}", "a".repeat(250));
        assert_eq!(
            video_action_reference_media_id(&request(Some(&long_id)))
                .expect("a card-contract reference is accepted"),
            Some(long_id)
        );
        assert_eq!(
            video_action_reference_media_id(&request(Some("media-alpha")))
                .expect("a card reference is accepted"),
            Some("media-alpha".to_string())
        );
        for malformed in ["has space", "", "-leading-dash", "media/alpha"] {
            assert!(
                video_action_reference_media_id(&request(Some(malformed))).is_err(),
                "a malformed reference media ID is refused before any worker runs: {malformed:?}"
            );
        }
    }

    #[test]
    fn flow_video_action_report_requires_a_fresh_reference_verification() {
        let report = |extra: Value| {
            let mut value = serde_json::json!({
                "status": "ready",
                "promptAccepted": true,
                "generateClicked": true,
            });
            for (key, item) in extra
                .as_object()
                .expect("an object of report fields")
                .clone()
            {
                value[key] = item;
            }
            value
        };
        let verified = report(serde_json::json!({ "referenceVerified": true }));

        assert!(flow_video_action_confirmed("type_prompt", true, &verified));
        assert!(flow_video_action_confirmed(
            "click_generate",
            true,
            &verified
        ));
        // A bound shot whose chip was removed, swapped or never re-checked does
        // not become a paid prompt or a paid Generate.
        for unverified in [
            report(serde_json::json!({ "referenceVerified": false })),
            report(serde_json::json!({ "referenceVerified": null })),
            report(serde_json::json!({})),
        ] {
            assert!(!flow_video_action_confirmed(
                "type_prompt",
                true,
                &unverified
            ));
            assert!(!flow_video_action_confirmed(
                "click_generate",
                true,
                &unverified
            ));
        }
        // A legacy unbound shot keeps its historical shape: nothing claims a
        // verified reference, and the action still stands on its own evidence.
        assert!(flow_video_action_confirmed(
            "type_prompt",
            false,
            &report(serde_json::json!({}))
        ));
        assert!(flow_video_action_confirmed(
            "click_generate",
            false,
            &report(serde_json::json!({}))
        ));
        // Neither a typed prompt nor a clicked Generate stands in for the other.
        assert!(!flow_video_action_confirmed(
            "type_prompt",
            false,
            &report(serde_json::json!({ "promptAccepted": false }))
        ));
        assert!(!flow_video_action_confirmed(
            "click_generate",
            false,
            &report(serde_json::json!({ "generateClicked": false }))
        ));
    }

    #[test]
    fn flow_card_media_ids_and_previews_reject_unsafe_values() {
        assert!(safe_flow_card_media_id("media-abc_1.2:3"));
        assert!(!safe_flow_card_media_id(""));
        assert!(!safe_flow_card_media_id("has space"));
        assert!(!safe_flow_card_media_id("-leading-dash"));
        assert!(!safe_flow_card_media_id(&"a".repeat(257)));

        for valid in [PNG_PREVIEW, JPEG_PREVIEW, WEBP_PREVIEW] {
            assert_eq!(
                sanitize_flow_card_preview(Some(valid)),
                Some(valid.to_string()),
                "a payload whose decoded signature matches its type is kept"
            );
        }
        assert!(
            sanitize_flow_card_preview(Some("data:image/jpeg;base64,QUJD")).is_none(),
            "base64 syntax alone is not a picture"
        );
        assert!(
            sanitize_flow_card_preview(Some("data:image/png;base64,/9j/4AAQSkZJRgAB")).is_none(),
            "a JPEG header declared as PNG is rejected"
        );
        assert!(sanitize_flow_card_preview(Some("data:image/svg+xml;base64,QUJD")).is_none());
        assert!(sanitize_flow_card_preview(Some("blob:https://flow.google.com/abc")).is_none());
        assert!(sanitize_flow_card_preview(Some(&format!(
            "data:image/jpeg;base64,{}",
            "A".repeat(262_145)
        )))
        .is_none());
        assert_eq!(sanitize_flow_card_label("a\u{7f}b\n\tc"), "a b c");
    }

    #[test]
    fn shot_reference_flow_gate_requires_cleared_rights() {
        for cleared in ["personal", "owned", "licensed", "public_domain"] {
            assert!(
                shot_reference_rights_cleared(cleared),
                "{cleared} is accepted rights evidence"
            );
        }
        for blocked in ["unknown", "pending", "restricted", "rejected", ""] {
            assert!(
                !shot_reference_rights_cleared(blocked),
                "{blocked} must never pass the Flow transfer gate"
            );
        }
    }

    // A ready, licensed, approved shot assignment whose asset is an image that
    // is still on disk with the hash the session recorded. Everything lives in
    // one disposable temp workspace and one in-memory database, so the gate is
    // exercised without touching a real project or the user's asset library.
    struct ShotReferencePreflightFixture {
        database: Mutex<Connection>,
        root: PathBuf,
        asset_file: PathBuf,
        binding_hash: String,
    }

    impl ShotReferencePreflightFixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(now_id("shot-reference-preflight"));
            let asset_file = root.join("assets/references/shot-002.png");
            fs::create_dir_all(asset_file.parent().expect("reference parent"))
                .expect("reference directory");
            let bytes = b"disposable shot reference bytes";
            fs::write(&asset_file, bytes).expect("reference file");
            // The gate canonicalizes the workspace before it reads anything,
            // so the recorded root has to be the same path it will resolve.
            let root = fs::canonicalize(&root).expect("canonical workspace");
            let binding_hash = format!("{:x}", Sha256::digest(bytes));

            let connection = Connection::open_in_memory().expect("in-memory database");
            connection
                .execute_batch(
                    "CREATE TABLE projects (project_id TEXT PRIMARY KEY, workspace_root TEXT NOT NULL);
                    CREATE TABLE reference_sets (
                        reference_set_id TEXT, project_id TEXT, name TEXT, scope TEXT, status TEXT,
                        continuity_note TEXT, created_at TEXT, updated_at TEXT, archived_at TEXT
                    );
                    CREATE TABLE reference_set_assignments (
                        assignment_id TEXT, project_id TEXT, reference_set_id TEXT, asset_id TEXT,
                        role TEXT, strength REAL, priority INTEGER, shot_id TEXT,
                        shot_range_start INTEGER, shot_range_end INTEGER, crop TEXT, notes TEXT,
                        approved INTEGER, asset_sha256 TEXT, created_at TEXT, updated_at TEXT
                    );
                    CREATE TABLE asset_library (
                        asset_id TEXT, project_id TEXT, title TEXT, relative_path TEXT, sha256 TEXT,
                        media_kind TEXT, mime_type TEXT, size_bytes INTEGER, width INTEGER,
                        height INTEGER, duration_seconds REAL, status TEXT, rights_status TEXT,
                        source_uri TEXT, tags_json TEXT, note TEXT, created_at TEXT,
                        updated_at TEXT, archived_at TEXT
                    );",
                )
                .expect("shot reference schema");
            let workspace_root = root.to_string_lossy().into_owned();
            connection
                .execute(
                    "INSERT INTO projects(project_id, workspace_root) VALUES ('project-shot-ref', ?1)",
                    params![workspace_root],
                )
                .expect("project row");
            connection
                .execute(
                    "INSERT INTO reference_sets
                     VALUES ('set-shot-ref', 'project-shot-ref', 'Shot references', 'shot', 'active', '', '0', '0', NULL)",
                    [],
                )
                .expect("reference set row");
            connection
                .execute(
                    "INSERT INTO reference_set_assignments
                     VALUES ('assignment-shot-ref', 'project-shot-ref', 'set-shot-ref', 'asset-shot-ref',
                             'start_frame', 1.0, 0, 'segment-002', NULL, NULL, NULL, '', 1, ?1, '0', '0')",
                    params![&binding_hash],
                )
                .expect("reference assignment row");
            connection
                .execute(
                    "INSERT INTO asset_library
                     VALUES ('asset-shot-ref', 'project-shot-ref', 'Shot 002 frame',
                             'assets/references/shot-002.png', ?1, 'image', 'image/png', 32,
                             16, 16, NULL, 'ready', 'licensed', NULL, '[]', '', '0', '0', NULL)",
                    params![&binding_hash],
                )
                .expect("asset row");

            Self {
                database: Mutex::new(connection),
                root,
                asset_file,
                binding_hash,
            }
        }

        fn set_asset_kind(&self, kind: &str) {
            let connection = self.database.lock().expect("fixture lock");
            connection
                .execute(
                    "UPDATE asset_library SET media_kind = ?1 WHERE asset_id = 'asset-shot-ref'",
                    params![kind],
                )
                .expect("change asset kind");
        }

        fn set_relative_path(&self, relative_path: &str) {
            let connection = self.database.lock().expect("fixture lock");
            connection
                .execute(
                    "UPDATE asset_library SET relative_path = ?1 WHERE asset_id = 'asset-shot-ref'",
                    params![relative_path],
                )
                .expect("change asset path");
        }

        fn set_assignment_hash(&self, hash: &str) {
            let connection = self.database.lock().expect("fixture lock");
            connection
                .execute(
                    "UPDATE reference_set_assignments SET asset_sha256 = ?1 WHERE assignment_id = 'assignment-shot-ref'",
                    params![hash],
                )
                .expect("change assignment hash");
        }

        fn set_assignment_project(&self, project: &str) {
            let connection = self.database.lock().expect("fixture lock");
            connection
                .execute(
                    "UPDATE reference_set_assignments SET project_id = ?1 WHERE assignment_id = 'assignment-shot-ref'",
                    params![project],
                )
                .expect("change assignment project");
        }

        // The report the UI receives, as JSON, so the assertions stay on what a
        // consumer can observe rather than on the Rust fields behind it.
        fn preflight(&self) -> Value {
            let report = preflight_shot_reference_flow_binding_in(
                "project-shot-ref".to_string(),
                ShotReferenceFlowPreflightRequest {
                    segment_id: "segment-002".to_string(),
                    asset_id: "asset-shot-ref".to_string(),
                    reference_set_id: "set-shot-ref".to_string(),
                    assignment_id: "assignment-shot-ref".to_string(),
                    asset_sha256: self.binding_hash.clone(),
                    role: "start_frame".to_string(),
                },
                &self.database,
            )
            .expect("preflight answers");
            serde_json::to_value(&report).expect("preflight report serializes")
        }
    }

    #[test]
    fn shot_reference_flow_preflight_accepts_a_current_image_matching_its_binding_hash() {
        let fixture = ShotReferencePreflightFixture::new();
        let report = fixture.preflight();

        assert_eq!(report["ready"], true, "{report}");
        assert_eq!(
            report["currentSha256"],
            serde_json::json!(fixture.binding_hash.clone())
        );
        assert_eq!(report["reasons"], serde_json::json!([]));
        assert_eq!(report["assetStatus"], "ready");
        assert_eq!(report["assignmentApproved"], true);

        let _ = fs::remove_dir_all(&fixture.root);
    }

    #[test]
    fn shot_reference_flow_preflight_blocks_an_asset_that_is_not_an_image() {
        let fixture = ShotReferencePreflightFixture::new();
        assert_eq!(
            fixture.preflight()["ready"],
            true,
            "the same fixture passes as an image"
        );
        fixture.set_asset_kind("video");
        let report = fixture.preflight();

        assert_eq!(
            report["ready"], false,
            "a non-image asset is never a shot start frame, however it is licensed: {report}"
        );
        assert_eq!(report["currentSha256"], Value::Null);
        assert!(
            !report["reasons"].as_array().expect("reasons").is_empty(),
            "a block has to say why"
        );

        let _ = fs::remove_dir_all(&fixture.root);
    }

    #[test]
    fn shot_reference_flow_preflight_blocks_an_assignment_that_describes_another_file_or_project() {
        let fixture = ShotReferencePreflightFixture::new();
        assert_eq!(
            fixture.preflight()["ready"],
            true,
            "the same fixture passes as assigned"
        );

        // The assignment snapshots the bytes it was created against, so a row
        // recording a different hash is describing a different file even when
        // the asset and the session agree with each other.
        fixture.set_assignment_hash(&"b".repeat(64));
        let drifted = fixture.preflight();
        assert_eq!(
            drifted["ready"], false,
            "an assignment recorded against other bytes must stop: {drifted}"
        );

        fixture.set_assignment_hash(&fixture.binding_hash);
        assert_eq!(
            fixture.preflight()["ready"],
            true,
            "restoring the recorded hash restores the pass"
        );
        fixture.set_assignment_project("project-other");
        let foreign = fixture.preflight();
        assert_eq!(
            foreign["ready"], false,
            "an assignment owned by another project must stop: {foreign}"
        );

        // Both columns are NOT NULL and assign_reference always fills them, so a
        // blank value is a row that describes nothing: it stops as well.
        fixture.set_assignment_project("");
        let unowned = fixture.preflight();
        assert_eq!(
            unowned["ready"], false,
            "an assignment that asserts no project must stop: {unowned}"
        );

        fixture.set_assignment_project("project-shot-ref");
        fixture.set_assignment_hash("");
        let unhashed = fixture.preflight();
        assert_eq!(
            unhashed["ready"], false,
            "an assignment that asserts no hash must stop: {unhashed}"
        );

        let _ = fs::remove_dir_all(&fixture.root);
    }

    #[test]
    fn shot_reference_flow_preflight_blocks_changed_missing_and_escaping_asset_bytes() {
        let fixture = ShotReferencePreflightFixture::new();

        fs::write(&fixture.asset_file, b"some other bytes entirely").expect("rewrite reference");
        let changed = fixture.preflight();
        assert_eq!(
            changed["ready"], false,
            "bytes that no longer hash to the recorded binding must stop: {changed}"
        );
        assert_eq!(changed["currentSha256"], Value::Null);

        fs::write(&fixture.asset_file, b"disposable shot reference bytes")
            .expect("restore reference");
        fs::remove_file(&fixture.asset_file).expect("remove reference file");
        let missing = fixture.preflight();
        assert_eq!(
            missing["ready"], false,
            "a reference that is no longer in the workspace must stop: {missing}"
        );

        fs::write(&fixture.asset_file, b"disposable shot reference bytes")
            .expect("restore reference");
        fixture.set_relative_path("../outside/shot-002.png");
        let escaping = fixture.preflight();
        assert_eq!(
            escaping["ready"], false,
            "a path pointing out of the project workspace must stop: {escaping}"
        );

        let _ = fs::remove_dir_all(&fixture.root);
    }

    #[test]
    fn preferred_tool_reference_uses_normalized_existing_config() {
        let root = std::env::temp_dir().join("auto3dvideo-python-quote-test");
        let _ = fs::create_dir_all(&root);
        let executable = root.join("python.exe");
        fs::write(&executable, b"fixture").expect("python fixture");
        let quoted = format!(r#""{}""#, executable.display());
        assert_eq!(
            preferred_tool_reference("python", Some(quoted)),
            Some(executable.to_string_lossy().to_string())
        );
        let _ = fs::remove_file(executable);
        let _ = fs::remove_dir(root);
    }

    #[test]
    fn python_readiness_rejects_venv_with_missing_base_interpreter() {
        let root = std::env::temp_dir().join("auto3dvideo-python-broken-venv-test");
        let scripts = root.join("Scripts");
        let _ = fs::create_dir_all(&scripts);
        let executable = scripts.join("python.exe");
        fs::write(&executable, b"launcher fixture").expect("python launcher fixture");
        fs::write(
            root.join("pyvenv.cfg"),
            "home = C:\\missing\\Python312\nexecutable = C:\\missing\\Python312\\python.exe\n",
        )
        .expect("pyvenv fixture");
        assert!(!executable_ref_usable(
            "python",
            &executable.to_string_lossy()
        ));
        let _ = fs::remove_file(executable);
        let _ = fs::remove_file(root.join("pyvenv.cfg"));
        let _ = fs::remove_dir(scripts);
        let _ = fs::remove_dir(root);
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
    fn video_session_cache_recovery_survives_mapped_index_path() {
        let root = std::env::temp_dir().join(now_id("video-session-cache-recovery"));
        fs::create_dir_all(&root).expect("cache root");
        let path = root.join("video-workflow-sessions.json");
        let session = VideoWorkflowSessionView {
            schema_version: "1.0.0".to_string(),
            session_id: "video-session-test".to_string(),
            project_id: "project-test".to_string(),
            session_directory: "outputs/sessions/video-session-test".to_string(),
            name: "Recovery test".to_string(),
            topic: "Tiger and dinosaur".to_string(),
            title: "Recovery test".to_string(),
            duration_seconds: Some(60.0),
            status: "draft".to_string(),
            last_step: "video_session.save".to_string(),
            updated_at: now_string(),
            script: None,
            reference_asset_paths: Vec::new(),
            gemini_asset_paths: Vec::new(),
            comfyui_asset_paths: Vec::new(),
            blender_preview: None,
            canvas_graph: None,
            shot_reference_bindings: None,
        };
        let document = VideoWorkflowSessionFile {
            schema_version: "1.0.0".to_string(),
            sessions: vec![session.clone()],
        };
        let recovery_path = video_workflow_session_recovery_path(&path);
        fs::write(
            recovery_path,
            serde_json::to_vec_pretty(&document).expect("serialize recovery cache"),
        )
        .expect("write recovery cache");
        let restored = read_video_workflow_sessions(&path).expect("read recovery cache");
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].session_id, session.session_id);
        fs::remove_dir_all(root).expect("cleanup cache root");
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
        assert_eq!(normalize_project_id("Dự án Mặc định"), "du-an-mac-dinh");
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
    fn cloud_gate_defaults_off_and_persists_explicit_choice() {
        let mut connection = Connection::open_in_memory().expect("cloud gate test database");
        apply_migrations(&mut connection).expect("app preferences migration");
        assert!(!read_cloud_generation_enabled(&connection).expect("default cloud gate"));
        save_cloud_generation_enabled(&connection, true).expect("save enabled preference");
        assert!(read_cloud_generation_enabled(&connection).expect("persisted cloud gate"));
        save_cloud_generation_enabled(&connection, false).expect("save disabled preference");
        assert!(!read_cloud_generation_enabled(&connection).expect("disabled cloud gate"));
    }

    #[test]
    fn app_preferences_migration_restores_last_audited_cloud_gate() {
        let mut connection = Connection::open_in_memory().expect("legacy cloud gate database");
        connection
            .execute_batch(INITIAL_MIGRATION)
            .expect("legacy database schema");
        connection
            .execute(
                "INSERT INTO audit_events(event_id, event_type, subject_type, subject_id, payload_json, created_at) VALUES ('cloud-off', 'cloud_generation.disabled', 'provider_gate', 'cloud-api-off', '{}', '2026-09-23T10:00:00Z'), ('cloud-on', 'cloud_generation.enabled', 'provider_gate', 'cloud-api', '{}', '2026-09-24T10:00:00Z')",
                [],
            )
            .expect("legacy cloud gate audit");
        apply_migrations(&mut connection).expect("restore cloud preference");
        assert!(read_cloud_generation_enabled(&connection).expect("restored cloud gate"));
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
        assert_eq!(versions, 10);
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
    #[test]
    fn gflow_worker_failure_preserves_code_and_message() {
        let detail = gflow_worker_failure_detail(
            r#"{"status":"fail","error":{"code":"GFLOW_AUTH_UNVERIFIED","message":"Flow session could not be verified; check network connectivity."}}"#,
        );
        assert_eq!(
            detail.as_deref(),
            Some("GFLOW_AUTH_UNVERIFIED: Flow session could not be verified; check network connectivity.")
        );
    }

    #[test]
    fn gflow_worker_failure_ignores_auth_log() {
        let detail = gflow_worker_failure_detail(
            r#"{"source":"status","status":"error","error":"OSError","event":"auth_flow_session_probe_error"}"#,
        );
        assert!(detail.is_none());
    }

    #[test]
    fn gflow_worker_failure_redacts_credentials() {
        let detail = gflow_worker_failure_detail(
            r#"{"status":"fail","error":{"code":"GFLOW_AUTH_UNVERIFIED","message":"access_token=super-secret-value"}}"#,
        );
        assert_eq!(
            detail.as_deref(),
            Some(
                "GFLOW_AUTH_UNVERIFIED: Chi tiết lỗi đã được ẩn vì có thể chứa thông tin nhạy cảm."
            )
        );
    }

    #[test]
    fn gflow_worker_success_is_not_failure_detail() {
        let detail = gflow_worker_failure_detail(
            r#"{"status":"ok","shots":[],"stateRelativePath":"runs/test/state.json"}"#,
        );
        assert!(detail.is_none());
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
        merge_bilibili_public_catalog, merge_preview_platform_fallback,
        obscura_canonical_video_url, preview_report_has_cards_for_platform,
    };

    #[test]
    fn obscura_report_parses_cards_and_strips_worker_only_fields() {
        let stdout = r#"{"sourceUrl":"https://www.tiktok.com/explore","cards":[{"shareUrl":"https://www.tiktok.com/@creator/video/123456","title":"Hot dance","author":"creator","thumbnailUrl":"https://cdn.example.com/thumb.jpg","observedSignals":["hot"],"freshSignal":true,"observedMetrics":{"engagement":true}}]}"#;
        let report = build_obscura_preview_report(stdout, &["tiktok".to_string()], 24);
        assert_eq!(
            report.get("status").and_then(|value| value.as_str()),
            Some("success")
        );
        let card = &report["cards"][0];
        assert_eq!(card["platform"], "tiktok");
        assert_eq!(card["embedUrl"], "https://www.tiktok.com/player/v1/123456");
        assert!(card.get("observedSignals").is_none());
        assert!(card["radarBuckets"]
            .as_array()
            .is_some_and(|buckets| { buckets.iter().any(|bucket| bucket == "hot_new") }));
    }

    #[test]
    fn obscura_rejects_discovery_route_as_video_card() {
        assert!(obscura_canonical_video_url("https://www.tiktok.com/explore", "tiktok").is_none());
        assert!(
            obscura_canonical_video_url("https://www.tiktok.com/item/create", "tiktok").is_none()
        );
        assert!(obscura_canonical_video_url("https://www.ixigua.com/video/app", "xigua").is_none());
        assert!(obscura_canonical_video_url("https://www.ixigua.com/video/pc", "xigua").is_none());
        assert!(
            obscura_canonical_video_url("https://www.bilibili.com/v/popular/all", "bilibili")
                .is_none()
        );
        assert!(obscura_canonical_video_url(
            "https://www.tiktok.com/@creator/video/123456",
            "tiktok"
        )
        .is_some());
        assert!(
            obscura_canonical_video_url("https://www.douyin.com/video/987654321", "douyin")
                .is_some()
        );
        assert!(obscura_canonical_video_url(
            "https://www.bilibili.com/video/BV1Existing",
            "bilibili"
        )
        .is_some());
        assert!(
            obscura_canonical_video_url("https://www.ixigua.com/video/123456789", "xigua")
                .is_some()
        );
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
        let merged =
            merge_preview_platform_fallback(base, &fallback, &["tiktok".to_string()], &process)
                .expect("fallback should merge");
        assert_eq!(merged["cards"].as_array().map(Vec::len), Some(2));
        assert_eq!(merged["platformResults"][0]["status"], "success");
        assert_eq!(merged["status"], "success");
        assert_eq!(
            merged["engine"],
            "obscura_public_scrape+browseros_preview_scan"
        );
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
        assert!(
            validate_preview_creator_source_url("https://www.tiktok.com/@creator", "douyin")
                .is_err()
        );
    }
}
