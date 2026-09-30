use super::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RecipeCatalogItem {
    recipe_kind: String,
    name: String,
    worker: String,
    local_first: bool,
    requires_approval: bool,
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
pub(super) struct TopicProfileView {
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
pub(super) struct TopicProfileRegistry {
    schema_version: String,
    profiles: Vec<TopicProfileView>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct PromptTemplateView {
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
pub(super) struct PromptPresetView {
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
pub(super) struct PromptPresetInput {
    pub(super) project_id: String,
    pub(super) name: String,
    pub(super) description: String,
    pub(super) scope: String,
    pub(super) status: String,
    pub(super) version: String,
    pub(super) template: String,
    pub(super) variable_keys: Vec<String>,
    pub(super) negative_template: String,
    pub(super) provider_targets: Vec<String>,
    pub(super) style_bible_id: Option<String>,
    pub(super) rights_license_note: String,
    pub(super) parent_preset_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PromptTemplateRegistry {
    schema_version: String,
    templates: Vec<PromptTemplateView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TopicPromptPreview {
    pub(super) profile_id: String,
    pub(super) profile_name: String,
    pub(super) template_id: String,
    pub(super) template_version: String,
    pub(super) rendered_prompt: String,
    pub(super) selected_recipe_kind: String,
    pub(super) visual_mode: String,
    pub(super) required_human_review: bool,
    pub(super) network_calls_made: bool,
    pub(super) paid_generation: bool,
    pub(super) external_publish: bool,
    pub(super) message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TopicPromptPreviewRequest {
    pub(super) profile_id: String,
    pub(super) template_id: String,
    pub(super) topic: String,
    pub(super) audience: String,
    pub(super) content_goal: String,
    pub(super) additional_prompt: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MockRecipePreview {
    recipe_kind: String,
    stages: Vec<String>,
    paid_generation_blocked: bool,
    external_publish_blocked: bool,
    external_processes_not_started: bool,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RecipeDocument {
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
pub(super) struct RecipeValidationResult {
    valid: bool,
    recipe_id: String,
    recipe_kind: String,
    errors: Vec<String>,
    warnings: Vec<String>,
    external_side_effects_blocked: bool,
}

#[tauri::command]
pub(super) fn list_recipe_catalog() -> Vec<RecipeCatalogItem> {
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
pub(super) fn validate_recipe_json(recipe_json: String) -> Result<RecipeValidationResult, String> {
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
pub(super) fn preview_recipe(recipe_kind: String) -> Result<MockRecipePreview, String> {
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
pub(super) fn list_topic_profiles() -> Result<Vec<TopicProfileView>, String> {
    let registry: TopicProfileRegistry = serde_json::from_str(TOPIC_PROFILE_REGISTRY)
        .map_err(|error| format!("topic profile registry không hợp lệ: {error}"))?;
    if registry.schema_version != "1.0.0" {
        return Err("topic profile registry dùng schemaVersion không hỗ trợ".to_string());
    }
    Ok(registry.profiles)
}

#[tauri::command]
pub(super) fn list_prompt_templates() -> Result<Vec<PromptTemplateView>, String> {
    let registry: PromptTemplateRegistry = serde_json::from_str(PROMPT_TEMPLATE_REGISTRY)
        .map_err(|error| format!("prompt template registry không hợp lệ: {error}"))?;
    if registry.schema_version != "1.0.0" {
        return Err("prompt template registry dùng schemaVersion không hỗ trợ".to_string());
    }
    Ok(registry.templates)
}

pub(super) fn validate_prompt_preset_input(input: &PromptPresetInput) -> Result<(), String> {
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

pub(super) fn bump_prompt_preset_version(version: &str) -> String {
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

#[tauri::command]
pub(super) fn list_prompt_presets(
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
pub(super) fn create_prompt_preset(
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
pub(super) fn update_prompt_preset(
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
pub(super) fn archive_prompt_preset(
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
pub(super) fn restore_prompt_preset(
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

#[tauri::command]
pub(super) fn preview_topic_prompt(
    request: TopicPromptPreviewRequest,
) -> Result<TopicPromptPreview, String> {
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
