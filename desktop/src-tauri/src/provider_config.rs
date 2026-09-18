use serde::Serialize;
use std::{collections::BTreeMap, env, fs, path::PathBuf};

const MAX_DOTENV_BYTES: u64 = 128 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderEnvProfile {
    pub profile_id: String,
    pub capability: String,
    pub provider: String,
    pub adapter: String,
    pub model: String,
    pub endpoint_ref: String,
    pub endpoint_configured: bool,
    pub enabled: bool,
    pub configured: bool,
    pub credential_ref: String,
    pub credential_state: String,
    pub pricing_mode: String,
    pub timeout_seconds: i64,
    pub max_attempts: i64,
    pub fallback_profiles: Vec<String>,
    pub env_prefix: String,
    pub source: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRoutingProfile {
    pub role_id: String,
    pub label: String,
    pub model: String,
    pub model_env: String,
    pub responsibility: String,
    pub trigger: String,
    pub input_artifact: String,
    pub output_artifact: String,
    pub configured: bool,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderEnvSnapshot {
    pub execution_profile: String,
    pub secret_backend: String,
    pub dotenv_loaded: bool,
    pub dotenv_source: String,
    pub cloud_requests_blocked: bool,
    pub external_publish_blocked: bool,
    pub paid_approval_required: bool,
    pub unknown_cost_policy: String,
    pub profiles: Vec<ProviderEnvProfile>,
    pub routing: Vec<ProviderRoutingProfile>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
struct EnvContext {
    values: BTreeMap<String, String>,
    dotenv_loaded: bool,
    dotenv_source: String,
    warnings: Vec<String>,
}

const CAPABILITY_SPECS: [(&str, &str, &str, &str, &str); 9] = [
    ("LLM", "llm", "ollama_compatible", "llm_local", "llm"),
    ("IMAGE", "image", "nano_banana", "image_local", "image"),
    (
        "VIDEO",
        "video",
        "official_video_api",
        "video_primary",
        "video",
    ),
    ("TTS", "tts", "vieneu_local_onnx", "voice_primary", "voice"),
    ("STT", "stt", "whisper_local", "stt_local", "stt"),
    (
        "AUDIO",
        "audio",
        "official_audio_api",
        "audio_primary",
        "audio",
    ),
    (
        "ASSET3D",
        "asset3d",
        "local_asset_adapter",
        "asset3d_local",
        "asset3d",
    ),
    (
        "RENDER3D",
        "render3d",
        "blender",
        "blender_local",
        "render3d",
    ),
    ("MEDIA", "media", "ffmpeg", "media_local", "media"),
];

pub fn load_provider_env_snapshot() -> ProviderEnvSnapshot {
    let context = load_context();
    let mut warnings = context.warnings.clone();
    let execution_profile =
        value(&context, "AUTO3DVIDEO_PROFILE").unwrap_or_else(|| "mock".to_string());
    let secret_backend =
        value(&context, "AUTO3DVIDEO_SECRET_BACKEND").unwrap_or_else(|| "env".to_string());
    let secret_backend = if matches!(secret_backend.as_str(), "env" | "os_credential_store") {
        secret_backend
    } else {
        warnings
            .push("AUTO3DVIDEO_SECRET_BACKEND không hợp lệ; dùng env cho development.".to_string());
        "env".to_string()
    };

    let paid_approval_required = bool_value(
        &context,
        "AUTO3DVIDEO_REQUIRE_PAID_APPROVAL",
        true,
        &mut warnings,
    );
    let unknown_cost_policy = match value(&context, "AUTO3DVIDEO_UNKNOWN_COST_POLICY")
        .as_deref()
        .unwrap_or("block")
    {
        "block" | "warn" => value(&context, "AUTO3DVIDEO_UNKNOWN_COST_POLICY")
            .unwrap_or_else(|| "block".to_string()),
        _ => {
            warnings.push(
                "AUTO3DVIDEO_UNKNOWN_COST_POLICY chỉ nhận block hoặc warn; dùng block.".to_string(),
            );
            "block".to_string()
        }
    };

    let external_publish_requested = bool_value(
        &context,
        "AUTO3DVIDEO_EXTERNAL_PUBLISH",
        false,
        &mut warnings,
    );
    if external_publish_requested {
        warnings.push(
            "External publish bị khóa cứng; biến môi trường không thể tự mở publish.".to_string(),
        );
    }

    let profiles = CAPABILITY_SPECS
        .iter()
        .map(|spec| build_profile(&context, spec, &mut warnings))
        .collect();
    let routing = build_llm_routing(&context);

    ProviderEnvSnapshot {
        execution_profile,
        secret_backend,
        dotenv_loaded: context.dotenv_loaded,
        dotenv_source: context.dotenv_source,
        cloud_requests_blocked: true,
        external_publish_blocked: true,
        paid_approval_required,
        unknown_cost_policy,
        profiles,
        routing,
        warnings,
    }
}

pub fn image_endpoint() -> String {
    let context = load_context();
    value(&context, "AUTO3DVIDEO_IMAGE_BASE_URL")
        .unwrap_or_else(|| "http://127.0.0.1:9222".to_string())
}

pub fn image_workflow_path() -> String {
    let context = load_context();
    value(&context, "AUTO3DVIDEO_IMAGE_WORKFLOW_PATH")
        .unwrap_or_else(|| ".auto3dvideo/config/comfyui-image-workflow-api.json".to_string())
}

pub fn nanobanana_server_entry() -> String {
    let context = load_context();
    value(&context, "AUTO3DVIDEO_NANOBANANA_MCP_SERVER_ENTRY")
        .unwrap_or_else(|| r"D:\Auto3DvideoTools\nano-banana-mcp\dist\index.js".to_string())
}

pub fn nanobanana_flow_cdp_url() -> String {
    let context = load_context();
    value(&context, "AUTO3DVIDEO_NANOBANANA_FLOW_CDP_URL")
        .unwrap_or_else(|| "http://127.0.0.1:9222".to_string())
}

pub fn nanobanana_model() -> String {
    let context = load_context();
    value(&context, "AUTO3DVIDEO_IMAGE_MODEL")
        .unwrap_or_else(|| "gemini-3.1-flash-image-preview".to_string())
}

pub fn nanobanana_tool_name() -> String {
    let context = load_context();
    value(&context, "AUTO3DVIDEO_NANOBANANA_TOOL").unwrap_or_else(|| "generate_image".to_string())
}

/// Model used only for the bounded BrowserMCP action planner. The planner
/// receives a fresh accessibility snapshot plus screenshot and can propose one typed action;
/// BrowserMCP execution remains behind the Rust ref/target guards.
pub fn vision_browser_model() -> String {
    let context = load_context();
    let configured = value(&context, "AUTO3DVIDEO_LLM_VISION_MODEL")
        .unwrap_or_else(|| "ag/gemini-3.8-flash-low".to_string());
    // 9router exposes the Gemini route under the `ag/` alias. Older local
    // settings used the provider-facing `antigravity/` prefix, which makes
    // 9router reject the request even when its API key is valid. Normalize
    // that legacy value at the boundary so BrowserMCP always uses the chosen
    // 9router route.
    let normalized = if configured.starts_with("antigravity/") {
        configured.replacen("antigravity/", "ag/", 1)
    } else {
        configured
    };
    // Browser interaction is intentionally pinned to the cheap low route. A
    // stale medium/high value in an old .env must not silently change the
    // model used for this user-authorized UI action loop.
    if normalized == "ag/gemini-3.8-flash-low" {
        normalized
    } else {
        "ag/gemini-3.8-flash-low".to_string()
    }
}

/// Gemini route used after a real Flow image has been downloaded. The
/// evaluator receives the image plus one shot contract and returns strict QA
/// JSON; it is intentionally stronger than the cheap browser action planner.
pub fn visual_evaluator_model() -> String {
    "ag/gemini-3.8-flash-high".to_string()
}

fn build_llm_routing(context: &EnvContext) -> Vec<ProviderRoutingProfile> {
    [
        (
            "director",
            "Main / Director",
            "AUTO3DVIDEO_LLM_DIRECTOR_MODEL",
            "ag/gemini-3.8-flash-medium",
            "Phân tích chủ đề, style bible, shot plan, prompt và Blender job JSON.",
            "Bắt đầu project; dựng hoặc sửa kế hoạch.",
            "Ý tưởng + reference assets",
            "Style bible + shot plan + prompt + Blender job JSON",
        ),
        (
            "vision_browser",
            "Vision + Browser",
            "AUTO3DVIDEO_LLM_VISION_MODEL",
            "ag/gemini-3.8-flash-low",
            "Đọc render/viewport, đối chiếu reference và điều khiển bước Google Flow.",
            "Sau khi Blender có preview hoặc cần thao tác Flow.",
            "Render/viewport + UI snapshot",
            "Visual mismatch report + BrowserMCP action plan",
        ),
        (
            "polling",
            "Simple snapshot / polling",
            "AUTO3DVIDEO_LLM_POLLING_MODEL",
            "ag/gemini-3.8-flash-low",
            "Đọc trạng thái nhẹ, chờ job/download/session; không lập kế hoạch.",
            "Mỗi lần poll hoặc đọc status.",
            "Status snapshot + process log",
            "State update + next wait",
        ),
        (
            "recovery",
            "Recovery / visual mismatch",
            "AUTO3DVIDEO_LLM_RECOVERY_MODEL",
            "ag/gemini-3.8-flash-high",
            "Phân tích lỗi nặng và yêu cầu sửa đúng shot bị lỗi.",
            "Chỉ sau 2 lỗi liên tiếp hoặc visual mismatch nặng.",
            "Failed logs + render + acceptance checks",
            "Repair plan + revised shot prompt",
        ),
    ]
    .into_iter()
    .map(
        |(
            role_id,
            label,
            model_env,
            default_model,
            responsibility,
            trigger,
            input_artifact,
            output_artifact,
        )| {
            let configured_value = value(context, model_env);
            let model_pinned = matches!(role_id, "director" | "vision_browser");
            ProviderRoutingProfile {
                role_id: role_id.to_string(),
                label: label.to_string(),
                model: if model_pinned {
                    default_model.to_string()
                } else {
                    configured_value
                        .clone()
                        .unwrap_or_else(|| default_model.to_string())
                },
                model_env: model_env.to_string(),
                responsibility: responsibility.to_string(),
                trigger: trigger.to_string(),
                input_artifact: input_artifact.to_string(),
                output_artifact: output_artifact.to_string(),
                configured: configured_value.is_some(),
                source: if role_id == "director" {
                    "pinned-for-director".to_string()
                } else if model_pinned {
                    "pinned-for-browser-actions".to_string()
                } else if configured_value.is_some() {
                    "env/process".to_string()
                } else {
                    "mặc định".to_string()
                },
            }
        },
    )
    .collect()
}

pub fn credential_reference_state(reference: &str) -> String {
    let context = load_context();
    credential_state(reference, &context.values)
}

fn build_profile(
    context: &EnvContext,
    spec: &(&str, &str, &str, &str, &str),
    global_warnings: &mut Vec<String>,
) -> ProviderEnvProfile {
    let (prefix, capability, default_provider, default_profile_id, _label) = *spec;
    let key = |suffix: &str| format!("AUTO3DVIDEO_{prefix}_{suffix}");
    let provider = value(context, &key("PROVIDER")).unwrap_or_else(|| default_provider.to_string());
    let adapter = value(context, &key("ADAPTER")).unwrap_or_else(|| provider.clone());
    let profile_id_key = key("PROFILE_ID");
    let mut warnings = Vec::new();
    let profile_id = match value(context, &profile_id_key) {
        Some(candidate) if safe_profile_id(&candidate) => candidate,
        Some(_) => {
            warnings.push(format!(
                "{profile_id_key} không phải safe profile id; dùng {default_profile_id}."
            ));
            default_profile_id.to_string()
        }
        None => default_profile_id.to_string(),
    };
    let enabled = bool_value(
        context,
        &key("ENABLED"),
        capability == "media",
        &mut warnings,
    );
    let model = value(context, &key("MODEL"))
        .filter(|candidate| !candidate.eq_ignore_ascii_case("replace-with-your-model"))
        .unwrap_or_else(|| "not-configured".to_string());
    let base_url = value(context, &key("BASE_URL"));
    let endpoint_configured = base_url.as_deref().map(valid_base_url).unwrap_or(
        is_local_provider(&provider, &adapter)
            || matches!(capability, "stt" | "asset3d" | "render3d" | "media"),
    );
    if base_url.is_some() && !endpoint_configured {
        warnings.push(format!(
            "{} endpoint phải là http(s) URL không chứa secret/query.",
            key("BASE_URL")
        ));
    }
    let credential_ref =
        credential_reference(context, prefix, capability, &provider, &mut warnings);
    let credential_state = credential_state(&credential_ref, &context.values);
    let pricing_mode = value(context, &key("PRICING_MODE")).unwrap_or_else(|| {
        if is_local_provider(&provider, &adapter) {
            "free_local".to_string()
        } else {
            "unknown".to_string()
        }
    });
    if !matches!(
        pricing_mode.as_str(),
        "free_local" | "free_tier" | "subscription" | "paid_api" | "unknown"
    ) {
        warnings.push(format!(
            "{} pricing mode không được nhận diện; dùng unknown.",
            key("PRICING_MODE")
        ));
    }
    let pricing_mode = if matches!(
        pricing_mode.as_str(),
        "free_local" | "free_tier" | "subscription" | "paid_api" | "unknown"
    ) {
        pricing_mode
    } else {
        "unknown".to_string()
    };
    let timeout_seconds = integer_value(
        context,
        &key("TIMEOUT_SECONDS"),
        300,
        1,
        86_400,
        &mut warnings,
    );
    let max_attempts = integer_value(context, &key("MAX_ATTEMPTS"), 1, 1, 10, &mut warnings);
    let fallback_profiles = list_value(context, &key("FALLBACK_PROFILES"), &mut warnings);
    if !is_local_provider(&provider, &adapter) && pricing_mode == "unknown" {
        warnings.push(
            "Cloud profile chưa có pricing mode; real request phải bị budget gate chặn."
                .to_string(),
        );
    }
    if credential_state != "configured" && credential_ref != "none" {
        warnings.push(format!(
            "Credential state: {credential_state}; secret không được hiển thị."
        ));
    }
    let configured = !model.is_empty()
        && model != "not-configured"
        && endpoint_configured
        && credential_state == "configured";
    let source = if context.dotenv_loaded {
        "dotenv+process".to_string()
    } else {
        "process/defaults".to_string()
    };
    global_warnings.extend(
        warnings
            .iter()
            .filter(|warning| warning.contains("external") || warning.contains("secret"))
            .cloned(),
    );

    ProviderEnvProfile {
        profile_id,
        capability: capability.to_string(),
        provider,
        adapter,
        model,
        endpoint_ref: format!("env:AUTO3DVIDEO_{prefix}_BASE_URL"),
        endpoint_configured,
        enabled,
        configured,
        credential_ref,
        credential_state,
        pricing_mode,
        timeout_seconds,
        max_attempts,
        fallback_profiles,
        env_prefix: format!("AUTO3DVIDEO_{prefix}"),
        source,
        warnings,
    }
}

fn credential_reference(
    context: &EnvContext,
    prefix: &str,
    capability: &str,
    provider: &str,
    warnings: &mut Vec<String>,
) -> String {
    let credential_key = format!("AUTO3DVIDEO_{prefix}_CREDENTIAL_REF");
    if let Some(reference) = value(context, &credential_key) {
        if validate_credential_ref(&reference) {
            return reference;
        }
        warnings.push(format!(
            "{credential_key} bị từ chối; chỉ dùng none, env:VAR hoặc os:handle."
        ));
        return "invalid-ref-blocked".to_string();
    }
    let api_key_name = format!("AUTO3DVIDEO_{prefix}_API_KEY");
    if is_local_provider(provider, provider) || capability == "stt" {
        "none".to_string()
    } else {
        format!("env:{api_key_name}")
    }
}

fn credential_state(reference: &str, values: &BTreeMap<String, String>) -> String {
    if reference == "none" {
        return "configured".to_string();
    }
    if reference == "invalid-ref-blocked" {
        return "rejected".to_string();
    }
    if let Some(variable) = reference.strip_prefix("env:") {
        return if values
            .get(variable)
            .map(|candidate| !candidate.trim().is_empty())
            .unwrap_or(false)
        {
            "configured".to_string()
        } else {
            "missing".to_string()
        };
    }
    if reference.starts_with("os:") {
        return "unresolved".to_string();
    }
    "rejected".to_string()
}

fn validate_credential_ref(reference: &str) -> bool {
    if reference == "none" {
        return true;
    }
    let Some((kind, name)) = reference.split_once(':') else {
        return false;
    };
    if name.is_empty() || name.len() > 128 {
        return false;
    }
    match kind {
        "env" => {
            let mut chars = name.chars();
            matches!(chars.next(), Some(character) if character.is_ascii_uppercase())
                && chars.all(|character| {
                    character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_'
                })
        }
        "os" => name.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.' | '/')
        }),
        _ => false,
    }
}

fn safe_profile_id(value: &str) -> bool {
    (3..=64).contains(&value.len())
        && value.chars().enumerate().all(|(index, character)| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || (index > 0 && matches!(character, '-' | '_'))
        })
        && value
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
}

fn valid_base_url(value: &str) -> bool {
    let trimmed = value.trim();
    (trimmed.starts_with("http://") || trimmed.starts_with("https://"))
        && trimmed.len() <= 1000
        && !trimmed
            .chars()
            .any(|character| character.is_whitespace() || character == '\0')
        && !trimmed.contains('?')
        && !trimmed.contains('#')
        && trimmed[trimmed.find("://").unwrap_or(0) + 3..]
            .split('/')
            .next()
            .map(|host| !host.is_empty() && !host.contains('@'))
            .unwrap_or(false)
}

fn is_local_provider(provider: &str, adapter: &str) -> bool {
    let provider = provider.to_ascii_lowercase();
    let adapter = adapter.to_ascii_lowercase();
    [
        "local",
        "ollama",
        "ollama_compatible",
        "comfyui",
        "nano_banana",
        "nano_banana_mcp",
        "whisper_local",
        "blender",
        "ffmpeg",
        "local_asset_adapter",
        "vieneu",
        "vieneu_local_onnx",
    ]
    .iter()
    .any(|marker| provider == *marker || adapter == *marker)
}

fn value(context: &EnvContext, key: &str) -> Option<String> {
    context
        .values
        .get(key)
        .map(|candidate| candidate.trim().to_string())
        .filter(|candidate| !candidate.is_empty())
}

fn bool_value(context: &EnvContext, key: &str, default: bool, warnings: &mut Vec<String>) -> bool {
    match value(context, key).as_deref() {
        None => default,
        Some("true" | "1" | "yes") => true,
        Some("false" | "0" | "no") => false,
        Some(_) => {
            warnings.push(format!("{key} phải là true/false; dùng giá trị mặc định."));
            default
        }
    }
}

fn integer_value(
    context: &EnvContext,
    key: &str,
    default: i64,
    minimum: i64,
    maximum: i64,
    warnings: &mut Vec<String>,
) -> i64 {
    let Some(raw) = value(context, key) else {
        return default;
    };
    match raw.parse::<i64>() {
        Ok(parsed) if (minimum..=maximum).contains(&parsed) => parsed,
        _ => {
            warnings.push(format!(
                "{key} phải nằm trong {minimum}..{maximum}; dùng {default}."
            ));
            default
        }
    }
}

fn list_value(context: &EnvContext, key: &str, warnings: &mut Vec<String>) -> Vec<String> {
    let Some(raw) = value(context, key) else {
        return Vec::new();
    };
    let mut result = Vec::new();
    for item in raw
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        if safe_profile_id(item) && !result.iter().any(|existing| existing == item) {
            result.push(item.to_string());
        } else {
            warnings.push(format!(
                "{key} chứa fallback profile không hợp lệ; phần tử bị bỏ qua."
            ));
        }
    }
    result
}

fn load_context() -> EnvContext {
    let (dotenv_values, dotenv_loaded, dotenv_source, mut warnings) = load_dotenv();
    let mut values = dotenv_values;
    for (key, value) in env::vars().filter(|(key, _)| key.starts_with("AUTO3DVIDEO_")) {
        values.insert(key, value);
    }
    EnvContext {
        values,
        dotenv_loaded,
        dotenv_source,
        warnings: {
            warnings.shrink_to_fit();
            warnings
        },
    }
}

pub fn find_dotenv_path() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(explicit) = env::var("AUTO3DVIDEO_DOTENV_PATH") {
        if !explicit.trim().is_empty() {
            candidates.push(PathBuf::from(explicit));
        }
    }
    for start in [env::current_dir().ok(), env::current_exe().ok()]
        .into_iter()
        .flatten()
    {
        for ancestor in start.ancestors().take(8) {
            candidates.push(ancestor.join(".env"));
        }
    }
    let mut seen = Vec::new();
    candidates.into_iter().find(|path| {
        let display = path.to_string_lossy().to_string();
        if seen.iter().any(|item| item == &display) {
            return false;
        }
        seen.push(display);
        path.is_file()
    })
}

fn load_dotenv() -> (BTreeMap<String, String>, bool, String, Vec<String>) {
    let Some(path) = find_dotenv_path() else {
        return (BTreeMap::new(), false, "none".to_string(), Vec::new());
    };
    let Ok(metadata) = fs::metadata(&path) else {
        return (BTreeMap::new(), false, "none".to_string(), Vec::new());
    };
    if metadata.len() > MAX_DOTENV_BYTES {
        return (
            BTreeMap::new(),
            false,
            "none".to_string(),
            vec![".env vượt quá giới hạn 128 KiB và không được đọc.".to_string()],
        );
    }
    match fs::read_to_string(path) {
        Ok(contents) => {
            let (values, warnings) = parse_dotenv(&contents);
            (
                values,
                true,
                ".env (local development)".to_string(),
                warnings,
            )
        }
        Err(_) => (
            BTreeMap::new(),
            false,
            "none".to_string(),
            vec!["Không đọc được .env; tiếp tục bằng process environment/defaults.".to_string()],
        ),
    }
}

fn parse_dotenv(contents: &str) -> (BTreeMap<String, String>, Vec<String>) {
    let mut values = BTreeMap::new();
    let mut warnings = Vec::new();
    for (index, line) in contents.lines().enumerate() {
        let trimmed = line.trim().trim_start_matches('\u{feff}');
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let assignment = trimmed.strip_prefix("export ").unwrap_or(trimmed);
        let Some((raw_key, raw_value)) = assignment.split_once('=') else {
            warnings.push(format!(
                ".env dòng {} không có dạng KEY=VALUE; bỏ qua.",
                index + 1
            ));
            continue;
        };
        let key = raw_key.trim();
        if !key.starts_with("AUTO3DVIDEO_")
            || !key.chars().all(|character| {
                character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_'
            })
        {
            warnings.push(format!(
                ".env dòng {} có key không được phép; bỏ qua.",
                index + 1
            ));
            continue;
        }
        let raw_value = raw_value.trim();
        let value = if raw_value.len() >= 2
            && ((raw_value.starts_with('"') && raw_value.ends_with('"'))
                || (raw_value.starts_with('\'') && raw_value.ends_with('\'')))
        {
            raw_value[1..raw_value.len() - 1].to_string()
        } else {
            raw_value.to_string()
        };
        if value.contains('\0') || value.contains('\n') || value.contains('\r') {
            warnings.push(format!(
                ".env dòng {} có ký tự không được phép; bỏ qua.",
                index + 1
            ));
            continue;
        }
        values.insert(key.to_string(), value);
    }
    (values, warnings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_only_safe_auto3dvideo_dotenv_keys() {
        let (values, warnings) = parse_dotenv(
            "# comment\nAUTO3DVIDEO_VIDEO_MODEL=demo-model\nOTHER_SECRET=should-not-load\nBAD LINE\nAUTO3DVIDEO_VIDEO_ENABLED=true\n",
        );
        assert_eq!(
            values.get("AUTO3DVIDEO_VIDEO_MODEL"),
            Some(&"demo-model".to_string())
        );
        assert_eq!(values.get("OTHER_SECRET"), None);
        assert_eq!(
            values.get("AUTO3DVIDEO_VIDEO_ENABLED"),
            Some(&"true".to_string())
        );
        assert_eq!(warnings.len(), 2);
    }

    #[test]
    fn accepts_utf8_bom_before_comment_or_key() {
        let (values, warnings) =
            parse_dotenv("\u{feff}# comment\n\u{feff}AUTO3DVIDEO_LLM_MODEL=director\n");
        assert_eq!(
            values.get("AUTO3DVIDEO_LLM_MODEL"),
            Some(&"director".to_string())
        );
        assert!(warnings.is_empty());
    }

    #[test]
    fn rejects_query_and_userinfo_in_endpoint_readiness() {
        assert!(valid_base_url("https://api.example.com/v1"));
        assert!(!valid_base_url("https://token@api.example.com/v1"));
        assert!(!valid_base_url("https://api.example.com/v1?token=secret"));
    }

    #[test]
    fn resolves_credential_state_without_returning_secret() {
        let mut values = BTreeMap::new();
        values.insert(
            "AUTO3DVIDEO_VIDEO_API_KEY".to_string(),
            "secret-value".to_string(),
        );
        assert_eq!(
            credential_state("env:AUTO3DVIDEO_VIDEO_API_KEY", &values),
            "configured"
        );
        assert_eq!(
            credential_state("env:AUTO3DVIDEO_MISSING", &values),
            "missing"
        );
        assert_eq!(
            credential_state("os:auto3dvideo/video", &values),
            "unresolved"
        );
        assert_eq!(credential_state("invalid-ref-blocked", &values), "rejected");
    }
}
