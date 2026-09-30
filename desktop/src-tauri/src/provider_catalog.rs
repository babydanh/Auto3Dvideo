use super::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProviderProfileView {
    profile_id: String,
    capability: String,
    provider: String,
    model: String,
    endpoint_ref: String,
    enabled: bool,
    configured: bool,
    credential_ref: String,
}

#[tauri::command]
pub(super) fn get_provider_env_snapshot(
    state: State<'_, AppState>,
) -> provider_config::ProviderEnvSnapshot {
    let mut snapshot = provider_config::load_provider_env_snapshot();
    let cloud_enabled = state
        .database
        .lock()
        .ok()
        .and_then(|connection| read_cloud_generation_enabled(&connection).ok())
        .unwrap_or(false);
    snapshot.cloud_requests_blocked = !cloud_enabled;
    snapshot
}

#[tauri::command]
pub(super) fn list_provider_catalog(
    state: State<'_, AppState>,
) -> Result<Vec<ProviderProfileView>, String> {
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
pub(super) fn create_provider_profile(
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
