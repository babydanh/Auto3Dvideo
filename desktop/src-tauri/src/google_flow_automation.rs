use super::image_generation::{nanobanana_cdp_preflight, parse_nanobanana_cdp_endpoint};
use super::tool_readiness::resolve_configured_tool;
use super::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ChromeCdpLaunchReport {
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
pub(super) struct GoogleFlowDomPromptRequest {
    project_url: String,
    prompt: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GoogleFlowDomOutputRequest {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GoogleFlowVideoActionRequest {
    project_url: String,
    mode: String,
    prompt: String,
    shot_id: String,
    revision_id: String,
    run_id: String,
    model: String,
    expected_credit_cost: u32,
    approved_batch_credit_cap: u32,
    shot_count: u32,
    user_approved: bool,
    /// The exact Flow media the human confirmed for this shot. The worker
    /// re-reads the ingredient chip against it immediately before the prompt
    /// and again immediately before Generate, so a chip that was removed or
    /// swapped during the batch wait blocks the paid action. `None` is a
    /// legacy text-only shot with no binding and therefore no chip to re-check.
    #[serde(default)]
    reference_media_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GoogleFlowVideoActionReport {
    status: String,
    message: String,
    prompt_accepted: bool,
    generate_clicked: bool,
    reference_verified: Option<bool>,
    report_path: String,
}

/// The bound media ID travels the same card contract every other media ID does,
/// so a card that discovery and the session schema both accept can also be
/// re-verified, and nothing narrower than a card ever reaches the worker.
pub(super) fn video_action_reference_media_id(
    request: &GoogleFlowVideoActionRequest,
) -> Result<Option<String>, String> {
    request
        .reference_media_id
        .as_deref()
        .map(crate::validate_google_flow_media_id)
        .transpose()
}

/// A bound shot is only confirmed when the worker reported a fresh chip
/// verification for exactly the media it was asked to re-check; a missing,
/// false or absent verification never becomes a paid prompt or a paid
/// Generate. An unbound legacy shot keeps its historical shape, where there is
/// no chip to re-verify and the action stands on its own evidence alone.
pub(super) fn flow_video_action_confirmed(
    mode: &str,
    reference_required: bool,
    raw: &Value,
) -> bool {
    let performed = if mode == "type_prompt" {
        raw.get("promptAccepted").and_then(Value::as_bool) == Some(true)
    } else {
        raw.get("generateClicked").and_then(Value::as_bool) == Some(true)
    };
    performed
        && (!reference_required
            || raw.get("referenceVerified").and_then(Value::as_bool) == Some(true))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GoogleFlowDomPromptReport {
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
pub(super) struct GoogleFlowDomOutputReport {
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
    matching_prompt_media_count: usize,
    matching_batch_video_media_count: usize,
    matching_batch_video_media_ids: Vec<String>,
    matching_prompt_video_media_count: usize,
    matching_prompt_video_media_ids: Vec<String>,
    matching_prompt_media_ids: Vec<String>,
    shot_revision_batch_count: usize,
    shot_revision_batch_media_count: usize,
    shot_revision_batch_media_ids: Vec<String>,
    assistant_claims_generated: bool,
    generated_message_count: usize,
    generation_active: bool,
    download_control_found: bool,
    download_clicked: bool,
    selected_model: String,
    visible_credit_texts: Vec<String>,
    selected_settings_evidence: Vec<String>,
    model_selected: bool,
    saved: bool,
    output_count: String,
    project_key: String,
    composer_fingerprint: String,
    composer_found: bool,
    prompt_editor_found: bool,
    generate_button_found: bool,
    generate_button_enabled: bool,
    image_mode_found: bool,
    video_mode_found: bool,
    video_composer_ready: bool,
    message: String,
    process: ExternalProcessResult,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GoogleFlowPlaywrightRequest {
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GoogleFlowPlaywrightReport {
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

fn resolve_flow_browser_executable() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    // Prefer the browser the user actually signed into. The previous route
    // silently preferred a separate Chrome profile, which opened Flow at
    // /about and made the app look connected while it had no usable session.
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(&local_app_data)
                .join(r"BraveSoftware\Brave-Browser\Application\brave.exe"),
        );
    }
    candidates.push(PathBuf::from(
        r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
    ));
    candidates.push(PathBuf::from(
        r"C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe",
    ));
    // Chrome for Testing remains a fallback for machines without Brave.
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

fn flow_browser_profile_directory(_browser_path: &Path) -> Result<PathBuf, String> {
    if let Some(configured) = std::env::var_os("AUTO3DVIDEO_NANOBANANA_FLOW_PROFILE_DIR") {
        let configured = PathBuf::from(configured);
        if !configured.is_absolute() {
            return Err(
                "AUTO3DVIDEO_NANOBANANA_FLOW_PROFILE_DIR phải là đường dẫn tuyệt đối".to_string(),
            );
        }
        fs::create_dir_all(&configured)
            .map_err(|error| format!("Không tạo được Flow browser profile đã cấu hình: {error}"))?;
        return Ok(configured);
    }
    chrome_cdp_isolated_profile_directory()
}

fn chrome_cdp_isolated_profile_directory() -> Result<PathBuf, String> {
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

fn chrome_flow_url_needs_login(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.contains("accounts.google.com")
        || lower == "https://flow.google.com/about"
        || lower.starts_with("https://flow.google.com/about?")
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
        return "Browser Flow CDP đã sẵn sàng; controller đã chạy và group Auto3Dvideo đã được giữ."
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
            "Browser CDP đã sẵn sàng nhưng browser hiện tại chưa nạp controller local qua --load-extension; chưa tạo group. Có thể tiếp tục nếu Flow composer đã hiện, hoặc nạp thư mục controller một lần tại trang extensions. Profile: {}",
            profile_directory.display()
        );
    }
    "Browser đã mở nhưng controller chưa đăng ký service worker; chưa tạo group. Kiểm tra thư mục controller rồi mở lại; app chưa gọi Generate và chưa tiêu credit.".to_string()
}

#[tauri::command]
pub(super) async fn ensure_chrome_cdp_session() -> Result<ChromeCdpLaunchReport, String> {
    let endpoint = provider_config::nanobanana_flow_cdp_url();
    let (_, address) = parse_nanobanana_cdp_endpoint(&endpoint)?;
    let normalized_endpoint = format!("http://127.0.0.1:{}", address.port());
    let browser_path = resolve_flow_browser_executable().ok_or_else(|| {
        "Không tìm thấy Brave hoặc Google Chrome. Cài Brave/Chrome rồi thử lại; app chưa gọi Nano Banana và chưa tiêu credit.".to_string()
    })?;
    let profile_directory = flow_browser_profile_directory(&browser_path)?;
    let controller_directory = chrome_flow_controller_directory(&profile_directory)?;
    let controller_marker = controller_directory.join("loaded.marker");
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
        let needs_login = selection
            .selected_url
            .as_deref()
            .map(chrome_flow_url_needs_login)
            .unwrap_or(true);
        return Ok(ChromeCdpLaunchReport {
            endpoint: normalized_endpoint,
            status: "ready".to_string(),
            browser_path: None,
            profile_directory: profile_directory.to_string_lossy().to_string(),
            launched: false,
            needs_login,
            flow_group_name: CHROME_FLOW_GROUP_NAME.to_string(),
            flow_group_controller_loaded: controller_loaded,
            flow_target_count: selection.target_count,
            selected_flow_url: selection.selected_url,
            message: if needs_login {
                "Đã kết nối Brave Flow session riêng nhưng profile chưa đăng nhập Google Flow. Hãy chọn account/đăng nhập trong cửa sổ Flow; app chưa gọi MCP và chưa tiêu credit.".to_string()
            } else {
                chrome_flow_controller_message(controller_loaded, None, &profile_directory)
            },
        });
    }
    spawn_chrome_cdp(
        &browser_path,
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
            let needs_login = selection
                .selected_url
                .as_deref()
                .map(chrome_flow_url_needs_login)
                .unwrap_or(true);
            return Ok(ChromeCdpLaunchReport {
                endpoint: normalized_endpoint,
                status: "ready_needs_login_check".to_string(),
                browser_path: Some(browser_path.to_string_lossy().to_string()),
                profile_directory: profile_directory.to_string_lossy().to_string(),
                launched: true,
                needs_login,
                flow_group_name: CHROME_FLOW_GROUP_NAME.to_string(),
                flow_group_controller_loaded: controller_loaded,
                flow_target_count: selection.target_count,
                selected_flow_url: selection.selected_url,
                message: if needs_login {
                    format!("Đã mở {} Flow bằng session riêng nhưng chưa đăng nhập Google Flow. Hãy chọn account/đăng nhập trong cửa sổ này; app chưa gọi MCP và chưa tiêu credit.", browser_path.display())
                } else if controller_loaded {
                    format!("Đã mở {} Flow bằng profile đã đăng nhập; controller đã chạy, group đã được tạo và tab Flow đã được focus.", browser_path.display())
                } else {
                    chrome_flow_controller_message(false, Some(&browser_path), &profile_directory)
                },
            });
        }
    }
    Err(format!(
        "Đã mở Brave Flow session riêng nhưng CDP chưa phản hồi tại {normalized_endpoint}. Kiểm tra cửa sổ Brave Flow vừa mở rồi bấm lại; Brave thường của bạn không bị ảnh hưởng. Chưa spawn Nano Banana worker và chưa tiêu credit."
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

pub(super) fn google_flow_project_urls_match(expected: &str, observed: Option<&str>) -> bool {
    let Some(observed) = observed else {
        return false;
    };
    match (
        validate_google_flow_project_url_for_dom(expected),
        validate_google_flow_project_url_for_dom(observed),
    ) {
        (Ok(expected), Ok(observed)) => expected == observed,
        _ => false,
    }
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
    workspace_root: PathBuf,
    process: ExternalProcessResult,
}

pub(super) fn browseros_flow_operation_for_dom_mode(mode: &str) -> Result<&'static str, String> {
    match mode {
        "inspect_composer" => Ok("flow_inspect_composer"),
        "inspect_video_settings" => Ok("flow_inspect_video_settings"),
        "inspect_output" => Ok("flow_inspect_output"),
        "select_image_model" => Ok("flow_select_model"),
        "select_video_model" => Ok("flow_select_video_model"),
        "click_image_batch" => Ok("flow_download_image"),
        "click_video_download" => Ok("flow_download_video_output"),
        other => Err(format!("BrowserOS Flow DOM mode không được phép: {other}")),
    }
}

pub(super) fn browseros_flow_download_clicked(mode: &str, report: &Value) -> bool {
    let field = match mode {
        "click_video_download" => "downloadClicked",
        "click_image_batch" => "downloadStarted",
        _ => return false,
    };
    report.get(field).and_then(Value::as_bool).unwrap_or(false)
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

fn browseros_download_filename(
    shot_id: &str,
    revision_id: Option<&str>,
    extension: &str,
) -> String {
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
    let revision = revision_id
        .map(clean)
        .unwrap_or_else(|| "rev-001".to_string());
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
        .filter(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                ".png" | ".jpg" | ".jpeg" | ".webp"
            )
        })
        .ok_or_else(|| "BrowserOS download không phải PNG/JPEG/WebP".to_string())?;
    let downloads = browser_handoff::browser_downloads_directory()?;
    let mut destination = downloads.join(browseros_download_filename(
        shot_id,
        revision_id,
        &extension,
    ));
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
        fs::copy(&source, &destination).map_err(|error| {
            format!("Không copy được BrowserOS download vào Downloads: {error}")
        })?;
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
    model: Option<&str>,
    expected_credit_cost: Option<u32>,
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
    // The worker imports its exact-media rules as a sibling module, so the
    // synced copy would fail to resolve them if only the worker were written.
    browser_handoff::sync_embedded_worker(
        &worker_path.with_file_name("flow_exact_media.mjs"),
        FLOW_EXACT_MEDIA_SCRIPT,
        "Flow exact-media rules",
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
        }) {
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
        ("--model", model),
    ] {
        if let Some(value) = value {
            args.push(flag.to_string());
            args.push(value.to_string());
        }
    }
    if let Some(value) = expected_credit_cost {
        args.push("--expected-credit-cost".to_string());
        args.push(value.to_string());
    }
    let process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "node".to_string(),
            args,
            working_directory: ".".to_string(),
            environment: Default::default(),
            timeout_seconds: if operation_safe == "flow_download_image" {
                120
            } else {
                90
            },
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
        .unwrap_or_else(|| {
            serde_json::json!({
                "status": "failed",
                "message": process.stderr.chars().take(900).collect::<String>(),
            })
        });
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
        workspace_root,
        process,
    })
}

#[tauri::command]
pub(super) async fn type_google_flow_dom_prompt(
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
pub(super) async fn inspect_google_flow_dom_output(
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
    let requested_mode = request
        .mode
        .as_deref()
        .map(str::trim)
        .filter(|mode| !mode.is_empty());
    let requested_model = match (request.model.as_deref(), requested_mode) {
        (Some("Nano Banana Pro"), None | Some("select_image_model")) => {
            Some("Nano Banana Pro".to_string())
        }
        (Some("Omni 1.1 Flash"), Some("select_video_model")) => Some("Omni 1.1 Flash".to_string()),
        (None, _) => None,
        (Some(_), _) => {
            return Err("Model Flow không khớp với chế độ image/video được yêu cầu".to_string())
        }
    };
    if let Some(mode) = requested_mode {
        if browseros_flow_operation_for_dom_mode(mode).is_err() {
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
    if mode == "select_video_model" && requested_model.as_deref() != Some("Omni 1.1 Flash") {
        return Err("select_video_model cần model Omni 1.1 Flash".to_string());
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
    if mode == "select_video_model" && requested_run_id.is_none() {
        return Err("select_video_model cần runId của lượt chạy hiện tại".to_string());
    }
    if mode == "click_video_download" && batch_identity.is_none() {
        return Err("click_video_download cần shotId và revisionId".to_string());
    }
    if mode == "click_video_download" && requested_run_id.is_none() {
        return Err("click_video_download cần runId của lượt chạy hiện tại".to_string());
    }
    if mode == "click_video_download" && !browser_handoff::browseros_backend_enabled() {
        return Err("Tải video Flow chỉ hỗ trợ qua BrowserOS.".to_string());
    }
    if mode == "select_video_model" && !browser_handoff::browseros_backend_enabled() {
        return Err("Chọn model video Flow hiện chỉ hỗ trợ qua BrowserOS; chưa thao tác trên tab CDP legacy.".to_string());
    }
    if mode == "inspect_video_settings" && !browser_handoff::browseros_backend_enabled() {
        return Err("Mở cài đặt video Flow hiện chỉ hỗ trợ qua BrowserOS; chưa thao tác trên tab CDP legacy.".to_string());
    }
    if browser_handoff::browseros_backend_enabled() {
        let operation = browseros_flow_operation_for_dom_mode(&mode)?;
        let execution = run_browseros_flow_operation(
            &project_id,
            operation,
            &project_url,
            None,
            batch_identity.as_ref().map(|(shot_id, _)| shot_id.as_str()),
            batch_identity
                .as_ref()
                .map(|(_, revision_id)| revision_id.as_str()),
            requested_run_id.as_deref(),
            None,
            requested_model.as_deref(),
            None,
            state,
        )
        .await?;
        let raw = &execution.raw_report;
        let target_url = raw
            .get("targetUrl")
            .and_then(Value::as_str)
            .map(str::to_string);
        let target_matches = google_flow_project_urls_match(&project_url, target_url.as_deref());
        let status = raw
            .get("status")
            .and_then(Value::as_str)
            .filter(|_| target_matches)
            .unwrap_or("blocked")
            .to_string();
        let message = if !target_matches {
            format!(
                "BLOCKED_WRONG_FLOW_TARGET: worker không chứng minh đúng project composer (expected={}, observed={}). Không type/click.",
                project_url,
                target_url.as_deref().unwrap_or("trống")
            )
        } else {
            raw.get("message")
                .and_then(Value::as_str)
                .unwrap_or("BrowserOS chưa xác nhận trạng thái Google Flow")
                .to_string()
        };
        return Ok(GoogleFlowDomOutputReport {
            status,
            project_url,
            target_url,
            report_path: execution.report_relative,
            media_count: raw.get("mediaCount").and_then(Value::as_u64).unwrap_or(0) as usize,
            media_ids: raw
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
            historical_shot_media_ids: raw
                .get("historicalShotMediaIds")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default(),
            historical_shot_media_count: raw
                .get("historicalShotMediaCount")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize,
            matching_batch_count: raw
                .get("matchingBatchCount")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize,
            matching_batch_media_count: raw
                .get("matchingBatchMediaCount")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize,
            matching_batch_media_ids: raw
                .get("matchingBatchMediaIds")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default(),
            matching_prompt_media_count: raw
                .get("matchingPromptMediaCount")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize,
            matching_prompt_media_ids: raw
                .get("matchingPromptMediaIds")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default(),
            matching_batch_video_media_count: raw
                .get("matchingBatchVideoMediaCount")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize,
            matching_batch_video_media_ids: raw
                .get("matchingBatchVideoMediaIds")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default(),
            matching_prompt_video_media_count: raw
                .get("matchingPromptVideoMediaCount")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize,
            matching_prompt_video_media_ids: raw
                .get("matchingPromptVideoMediaIds")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default(),
            shot_revision_batch_count: raw
                .get("shotRevisionBatchCount")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize,
            shot_revision_batch_media_count: raw
                .get("shotRevisionBatchMediaCount")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize,
            shot_revision_batch_media_ids: raw
                .get("shotRevisionBatchMediaIds")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default(),
            assistant_claims_generated: raw
                .get("assistantClaimsGenerated")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            generated_message_count: raw
                .get("generatedMessageCount")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize,
            generation_active: raw
                .get("generationActive")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            download_control_found: raw
                .get("downloadControlFound")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            download_clicked: browseros_flow_download_clicked(&mode, raw),
            selected_model: raw
                .get("selectedModel")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            visible_credit_texts: raw
                .get("visibleCreditTexts")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default(),
            selected_settings_evidence: raw
                .get("selectedSettingsEvidence")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default(),
            model_selected: raw
                .get("modelSelected")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            saved: raw.get("saved").and_then(Value::as_bool).unwrap_or(false),
            output_count: raw
                .get("outputCount")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            project_key: raw
                .get("projectKey")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            composer_fingerprint: raw
                .get("composerFingerprint")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            composer_found: raw
                .get("composerFound")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            prompt_editor_found: raw
                .get("promptEditorFound")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            generate_button_found: raw
                .get("generationButtonFound")
                .or_else(|| raw.get("generateButtonFound"))
                .and_then(Value::as_bool)
                .unwrap_or(false),
            generate_button_enabled: raw
                .get("generationButtonEnabled")
                .or_else(|| raw.get("generateButtonEnabled"))
                .and_then(Value::as_bool)
                .unwrap_or(false),
            image_mode_found: raw
                .get("imageModeFound")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            video_mode_found: raw
                .get("videoModeFound")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            video_composer_ready: raw
                .get("videoComposerReady")
                .and_then(Value::as_bool)
                .unwrap_or(false),
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
    let target_url = raw_report
        .get("targetUrl")
        .and_then(Value::as_str)
        .map(str::to_string);
    let target_matches = google_flow_project_urls_match(&project_url, target_url.as_deref());
    let status = raw_report
        .get("status")
        .and_then(Value::as_str)
        .filter(|_| target_matches)
        .unwrap_or(if process.succeeded {
            "blocked"
        } else {
            "failed"
        })
        .to_string();
    let message = if !target_matches {
        format!(
            "BLOCKED_WRONG_FLOW_TARGET: worker không chứng minh đúng project composer (expected={}, observed={}). Không type/click.",
            project_url,
            target_url.as_deref().unwrap_or("trống")
        )
    } else {
        raw_report
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
            })
    };
    Ok(GoogleFlowDomOutputReport {
        status,
        project_url,
        target_url,
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
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
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
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        matching_prompt_media_count: raw_report
            .get("matchingPromptMediaCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize,
        matching_prompt_media_ids: raw_report
            .get("matchingPromptMediaIds")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        matching_batch_video_media_count: raw_report
            .get("matchingBatchVideoMediaCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize,
        matching_batch_video_media_ids: raw_report
            .get("matchingBatchVideoMediaIds")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        matching_prompt_video_media_count: raw_report
            .get("matchingPromptVideoMediaCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize,
        matching_prompt_video_media_ids: raw_report
            .get("matchingPromptVideoMediaIds")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
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
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
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
        visible_credit_texts: raw_report
            .get("visibleCreditTexts")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        selected_settings_evidence: raw_report
            .get("selectedSettingsEvidence")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        model_selected: raw_report
            .get("modelSelected")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        saved: raw_report
            .get("saved")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        output_count: raw_report
            .get("outputCount")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        project_key: raw_report
            .get("projectKey")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        composer_fingerprint: raw_report
            .get("composerFingerprint")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        composer_found: raw_report
            .get("composerFound")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        prompt_editor_found: raw_report
            .get("promptEditorFound")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        generate_button_found: raw_report
            .get("generationButtonFound")
            .or_else(|| raw_report.get("generateButtonFound"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        generate_button_enabled: raw_report
            .get("generationButtonEnabled")
            .or_else(|| raw_report.get("generateButtonEnabled"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        image_mode_found: raw_report
            .get("imageModeFound")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        video_mode_found: raw_report
            .get("videoModeFound")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        video_composer_ready: raw_report
            .get("videoComposerReady")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        message,
        process,
    })
}

#[tauri::command]
pub(super) async fn run_google_flow_video_action(
    project_id: String,
    request: GoogleFlowVideoActionRequest,
    state: State<'_, AppState>,
) -> Result<GoogleFlowVideoActionReport, String> {
    valid_text(&project_id, "Project ID")?;
    let project_id = project_id.trim().to_string();
    let project_url = validate_google_flow_project_url_for_dom(&request.project_url)?;
    let shot_id = validate_google_flow_batch_identity(&request.shot_id, "shotId")?;
    let revision_id = validate_google_flow_batch_identity(&request.revision_id, "revisionId")?;
    let run_id = validate_google_flow_batch_identity(&request.run_id, "runId")?;
    let prompt = validate_google_flow_dom_prompt(&request.prompt)?;
    if prompt.is_empty()
        || prompt.len() > 12_000
        || !prompt.contains(&format!("SHOT_ID: {shot_id}"))
        || !prompt.contains(&format!("REVISION_ID: {revision_id}"))
    {
        return Err(
            "Prompt video phải chứa đúng SHOT_ID/REVISION_ID và tối đa 12000 ký tự".to_string(),
        );
    }
    if request.model != "Omni 1.1 Flash" || request.expected_credit_cost == 0 {
        return Err("Video action cần model Omni 1.1 Flash và giá credit đã xác minh".to_string());
    }
    if request.shot_count == 0 || request.shot_count > 12 {
        return Err("Số shot video phải nằm trong khoảng 1..12".to_string());
    }
    let minimum_credit_cap = request
        .expected_credit_cost
        .checked_mul(request.shot_count)
        .ok_or_else(|| "Tràn số khi kiểm tra trần credit video".to_string())?;
    if request.approved_batch_credit_cap < minimum_credit_cap || !request.user_approved {
        return Err(
            "Chưa duyệt trần credit đủ cho toàn batch; không gửi prompt hoặc Generate".to_string(),
        );
    }
    let operation = match request.mode.as_str() {
        "type_prompt" => "flow_type_video_prompt",
        "click_generate" => "flow_click_video_generate",
        _ => return Err("Video action chỉ hỗ trợ type_prompt hoặc click_generate".to_string()),
    };
    // A bound shot names the exact media whose chip must still be in the
    // composer at the moment of the paid action, not just at Animate time.
    let reference_media_id = video_action_reference_media_id(&request)?;
    if !browser_handoff::browseros_backend_enabled() {
        return Err("Video Flow cần BrowserOS đang kết nối".to_string());
    }
    let execution = run_browseros_flow_operation(
        &project_id,
        operation,
        &project_url,
        Some(&prompt),
        Some(&shot_id),
        Some(&revision_id),
        Some(&run_id),
        reference_media_id.as_deref(),
        Some(&request.model),
        Some(request.expected_credit_cost),
        state,
    )
    .await?;
    let raw = &execution.raw_report;
    let target_url = raw.get("targetUrl").and_then(Value::as_str);
    let target_matches = google_flow_project_urls_match(&project_url, target_url);
    let reference_verified = raw.get("referenceVerified").and_then(Value::as_bool);
    let performed = if request.mode == "type_prompt" {
        raw.get("promptAccepted").and_then(Value::as_bool) == Some(true)
    } else {
        raw.get("generateClicked").and_then(Value::as_bool) == Some(true)
    };
    let prompt_accepted = target_matches
        && raw.get("status").and_then(Value::as_str) == Some("ready")
        && performed
        && request.mode == "type_prompt";
    let generate_clicked = target_matches
        && raw.get("status").and_then(Value::as_str) == Some("ready")
        && performed
        && request.mode == "click_generate";
    let reference_required = reference_media_id.is_some();
    let confirmed = target_matches
        && raw.get("status").and_then(Value::as_str) == Some("ready")
        && flow_video_action_confirmed(&request.mode, reference_required, raw);
    let message = if !target_matches {
        format!(
            "BLOCKED_WRONG_FLOW_TARGET: expected {}, observed {}.",
            project_url,
            target_url.unwrap_or("trống")
        )
    } else if reference_required && reference_verified != Some(true) {
        "BLOCKED_STALE_REFERENCE: chip reference ảnh không còn khớp media đã xác nhận; không nhập prompt và không Generate.".to_string()
    } else {
        raw.get("message")
            .and_then(Value::as_str)
            .unwrap_or("BrowserOS chưa xác nhận video action")
            .to_string()
    };
    Ok(GoogleFlowVideoActionReport {
        status: if confirmed { "ready" } else { "blocked" }.to_string(),
        message,
        prompt_accepted,
        generate_clicked,
        reference_verified,
        report_path: execution.report_relative,
    })
}

#[tauri::command]
pub(super) async fn run_google_flow_playwright_action(
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
        .map(crate::validate_google_flow_media_id)
        .transpose()?;
    // An explicit `mediaId` is the manually confirmed Flow card for a shot. It
    // is forwarded so the worker attaches that exact card; a legacy label route
    // stays available only when no explicit binding exists.
    if media_id.is_some() && !matches!(mode.as_str(), "download_image" | "animate_image") {
        return Err("mediaId chỉ dùng cho mode download_image hoặc animate_image".to_string());
    }
    let batch_identity = match (&request.shot_id, &request.revision_id) {
        (Some(shot_id), Some(revision_id)) => Some((
            validate_google_flow_batch_identity(shot_id, "shotId")?,
            validate_google_flow_batch_identity(revision_id, "revisionId")?,
        )),
        (None, None) => None,
        _ => return Err("shotId và revisionId phải đi cùng nhau".to_string()),
    };
    if matches!(mode.as_str(), "animate_image" | "download_image")
        && batch_identity.is_none()
        && media_id.is_none()
    {
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
            batch_identity
                .as_ref()
                .map(|(_, revision_id)| revision_id.as_str()),
            request.run_id.as_deref(),
            media_id.as_deref(),
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
            reference_attached: raw
                .get("referenceAttached")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            source_media_id: raw
                .get("sourceMediaId")
                .and_then(Value::as_str)
                .map(str::to_string),
            download_started: raw
                .get("downloadStarted")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            download_name: raw
                .get("downloadName")
                .and_then(Value::as_str)
                .map(str::to_string),
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
    // Same sibling rule as the BrowserOS worker: the synced copy resolves its
    // exact-media rules next to itself inside `.auto3dvideo/tools`.
    browser_handoff::sync_embedded_worker(
        &worker_path.with_file_name("flow_exact_media.mjs"),
        FLOW_EXACT_MEDIA_SCRIPT,
        "Flow exact-media rules",
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

const MAX_FLOW_IMAGE_CARDS: usize = 24;
const MAX_FLOW_CARD_LABEL: usize = 120;
const MAX_FLOW_CARD_PREVIEW_CHARS: usize = 262_144;

// A media ID is only bindable when the whole visible grid was listed. A read
// that stopped early cannot prove the sampled card is the only one wearing
// that ID, so the note is shown on every card of a truncated report.
const TRUNCATED_FLOW_CARD_LIST_NOTE: &str =
    "Danh sách card ảnh bị cắt bớt nên không chứng minh được media ID nào là duy nhất; không chọn card nào.";

const DUPLICATE_FLOW_CARD_MEDIA_ID_NOTE: &str =
    "Flow shows more than one card with this media ID, so none of them can be chosen.";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GoogleFlowImageCardsRequest {
    project_url: String,
    #[serde(default)]
    limit: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GoogleFlowImageCard {
    pub(super) media_id: String,
    pub(super) label: String,
    pub(super) preview: Option<String>,
    pub(super) preview_available: bool,
    pub(super) preview_note: String,
    pub(super) selectable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GoogleFlowImageCardsReport {
    status: String,
    project_id: String,
    project_url: String,
    flow_project_id: String,
    target_url: Option<String>,
    report_path: String,
    cards: Vec<GoogleFlowImageCard>,
    duplicate_media_ids: Vec<String>,
    truncated: bool,
    message: String,
    process: ExternalProcessResult,
}

pub(super) fn sanitize_flow_card_label(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(MAX_FLOW_CARD_LABEL)
        .collect()
}

// Decodes the leading bytes of a bounded inline preview payload. The crate has
// no base64 dependency, and a preview only ever needs its signature checked,
// so the smallest honest decoder keeps the dependency set unchanged.
fn decode_base64_leading_bytes(value: &str) -> Option<Vec<u8>> {
    let mut bits: u32 = 0;
    let mut bit_count: u32 = 0;
    let mut bytes: Vec<u8> = Vec::new();
    for character in value.bytes() {
        let sextet = match character {
            b'A'..=b'Z' => character - b'A',
            b'a'..=b'z' => character - b'a' + 26,
            b'0'..=b'9' => character - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            _ => return None,
        } as u32;
        bits = (bits << 6) | sextet;
        bit_count += 6;
        if bit_count >= 8 {
            bit_count -= 8;
            bytes.push(((bits >> bit_count) & 0xFF) as u8);
        }
    }
    Some(bytes)
}

// A preview is only kept when the page handed back inline bytes that really
// are the image type the payload claims. A remote URL, a blob handle, an
// oversized payload, or a payload whose decoded signature is wrong is dropped
// so the UI cannot present an empty or mislabelled image as a comparable
// thumbnail.
pub(super) fn sanitize_flow_card_preview(value: Option<&str>) -> Option<String> {
    let candidate = value?.trim();
    if candidate.is_empty() || candidate.len() > MAX_FLOW_CARD_PREVIEW_CHARS {
        return None;
    }
    let prefix = [
        "data:image/png;base64,",
        "data:image/jpeg;base64,",
        "data:image/webp;base64,",
    ]
    .into_iter()
    .find(|prefix| candidate.starts_with(prefix))?;
    let payload = candidate.strip_prefix(prefix)?;
    if payload.is_empty()
        || !payload
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='))
    {
        return None;
    }
    let signature = decode_base64_leading_bytes(&payload[..payload.len().min(16)])?;
    let matches_signature = match prefix {
        "data:image/png;base64," => {
            signature.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A])
        }
        "data:image/jpeg;base64," => signature.starts_with(&[0xFF, 0xD8, 0xFF]),
        _ => signature.starts_with(b"RIFF") && signature.get(8..12) == Some(&b"WEBP"[..]),
    };
    if !matches_signature {
        return None;
    }
    Some(candidate.to_string())
}

pub(super) fn safe_flow_card_media_id(value: &str) -> bool {
    let value = value.trim();
    if value.is_empty() || value.len() > 256 || !value.as_bytes()[0].is_ascii_alphanumeric() {
        return false;
    }
    value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b':'))
}

pub(super) fn flow_image_cards_from_report(
    report: &Value,
    limit: usize,
) -> (Vec<GoogleFlowImageCard>, Vec<String>, bool) {
    let raw_cards = report
        .get("cards")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut cards: Vec<GoogleFlowImageCard> = Vec::new();
    for raw in raw_cards {
        let media_id = raw
            .get("mediaId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        if !safe_flow_card_media_id(&media_id) {
            continue;
        }
        // A repeated media ID is deliberately kept as its own card instead of
        // being skipped or merged: dropping the second copy would leave the UI
        // free to bind the first one as if it were the only card with that
        // identity.
        let label =
            sanitize_flow_card_label(raw.get("label").and_then(Value::as_str).unwrap_or_default());
        let preview = sanitize_flow_card_preview(raw.get("preview").and_then(Value::as_str));
        let preview_available = preview.is_some();
        cards.push(GoogleFlowImageCard {
            media_id,
            label: if label.is_empty() {
                "Flow image card".to_string()
            } else {
                label
            },
            preview_available,
            preview_note: if preview_available {
                String::new()
            } else {
                raw.get("previewNote")
                    .and_then(Value::as_str)
                    .unwrap_or("Flow did not expose a readable thumbnail for this card.")
                    .chars()
                    .take(200)
                    .collect()
            },
            preview,
            selectable: preview_available
                && raw.get("selectable").and_then(Value::as_bool) != Some(false),
        });
    }
    // The counts run over everything the worker observed, before the bound is
    // applied, so a repeat that fell outside the limit still disambiguates the
    // copy that stayed inside it.
    let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for card in &cards {
        *counts.entry(card.media_id.clone()).or_insert(0) += 1;
    }
    let mut duplicate_media_ids: Vec<String> = counts
        .iter()
        .filter(|(_, count)| **count > 1)
        .map(|(media_id, _)| media_id.clone())
        .collect();
    duplicate_media_ids.sort();
    for card in &mut cards {
        if matches!(counts.get(&card.media_id), Some(count) if *count > 1) {
            card.selectable = false;
            card.preview_note = DUPLICATE_FLOW_CARD_MEDIA_ID_NOTE.to_string();
        }
    }
    // The worker reads one card past the bound so an overflowing grid is
    // reported as cut short; that answer, and any overflow found here, means
    // the unread remainder could still hold a second copy of a media ID that
    // looks unique in the sample. Nothing sampled from an incomplete list can
    // be compared and confirmed.
    let truncated =
        report.get("truncated").and_then(Value::as_bool) == Some(true) || cards.len() > limit;
    cards.truncate(limit);
    if truncated {
        for card in &mut cards {
            card.selectable = false;
            card.preview_note = TRUNCATED_FLOW_CARD_LIST_NOTE.to_string();
        }
    }
    (cards, duplicate_media_ids, truncated)
}

// The persisted run report keeps card identity and sanitized labels but never
// image bytes: the preview exists only for the in-app side-by-side comparison.
fn redact_flow_card_previews_in_report(report: &Value, cards: &[GoogleFlowImageCard]) -> Value {
    let mut object = report.clone();
    if let Some(map) = object.as_object_mut() {
        map.insert(
            "cards".to_string(),
            serde_json::Value::Array(
                cards
                    .iter()
                    .map(|card| {
                        serde_json::json!({
                            "mediaId": &card.media_id,
                            "label": &card.label,
                            "previewAvailable": card.preview_available,
                            "previewNote": &card.preview_note,
                            "selectable": card.selectable,
                        })
                    })
                    .collect(),
            ),
        );
        map.insert("previewsRedacted".to_string(), Value::Bool(true));
    }
    object
}

// Read-only discovery of the image cards Flow currently shows in the pinned
// project. It performs no upload, no click on a card, and no generation, and it
// never accepts a free-form media ID from the caller.
#[tauri::command]
pub(super) async fn discover_google_flow_image_cards(
    project_id: String,
    request: GoogleFlowImageCardsRequest,
    state: State<'_, AppState>,
) -> Result<GoogleFlowImageCardsReport, String> {
    valid_text(&project_id, "Project ID")?;
    let project_id = project_id.trim().to_string();
    let project_url = validate_google_flow_project_url_for_dom(&request.project_url)?;
    let flow_project_id = project_url
        .strip_prefix("https://flow.google.com/project/")
        .and_then(|rest| rest.split('/').next())
        .unwrap_or_default()
        .to_string();
    if flow_project_id.is_empty() {
        return Err("Google Flow project URL thiếu project id".to_string());
    }
    let limit = request
        .limit
        .map(|value| value.clamp(1, MAX_FLOW_IMAGE_CARDS as u32) as usize)
        .unwrap_or(MAX_FLOW_IMAGE_CARDS);
    if !browser_handoff::browseros_backend_enabled() {
        return Err(
            "Đọc card ảnh Flow cần backend BrowserOS đang bật; không dùng route Playwright cũ và không upload gì."
                .to_string(),
        );
    }
    let execution = run_browseros_flow_operation(
        &project_id,
        "flow_list_image_cards",
        &project_url,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        state,
    )
    .await?;
    let raw = &execution.raw_report;
    let (cards, duplicate_media_ids, truncated) = flow_image_cards_from_report(raw, limit);
    let target_url = raw
        .get("targetUrl")
        .and_then(Value::as_str)
        .map(str::to_string);
    // The worker proves which project it actually read from. A tab that drifted
    // to another Flow project would otherwise let that project's cards be
    // compared and confirmed for this shot.
    let observed_project_id = raw
        .get("flowProjectId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let status = if observed_project_id == flow_project_id && !cards.is_empty() {
        "ready"
    } else {
        "blocked"
    };
    let message = if status == "ready" {
        format!(
            "Đã đọc {} card ảnh đang hiển thị trong project Flow {}; chưa upload, chưa chọn, chưa Generate.",
            cards.len(),
            flow_project_id
        )
    } else if observed_project_id != flow_project_id {
        format!(
            "Tab Flow đang ở project {} thay vì project {}; không đọc card nào để tránh nhầm project.",
            if observed_project_id.is_empty() { "không xác định" } else { observed_project_id },
            flow_project_id
        )
    } else {
        "Project Flow hiện tại không có card ảnh nào đang hiển thị để đối chiếu.".to_string()
    };
    // A read that stopped early reads as a shorter list in the UI unless it is
    // spelled out, so the reason every card came back unselectable travels
    // with the report.
    let message = if truncated {
        format!("{} {}", message, TRUNCATED_FLOW_CARD_LIST_NOTE)
    } else {
        message
    };
    let redacted = redact_flow_card_previews_in_report(raw, &cards);
    let report_path = execution.workspace_root.join(&execution.report_relative);
    fs::write(
        &report_path,
        serde_json::to_vec_pretty(&redacted)
            .map_err(|error| format!("Không serialize được Flow card report: {error}"))?,
    )
    .map_err(|error| format!("Không cập nhật được Flow card report: {error}"))?;
    Ok(GoogleFlowImageCardsReport {
        status: status.to_string(),
        project_id,
        project_url,
        flow_project_id,
        target_url,
        report_path: execution.report_relative,
        cards,
        duplicate_media_ids,
        truncated,
        message,
        process: execution.process,
    })
}

// The largest shot reference this gate will hash. A start frame is an image,
// so anything larger is a wrong file rather than a reference worth reading.
const MAX_SHOT_REFERENCE_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ShotReferenceFlowPreflightRequest {
    pub(super) segment_id: String,
    pub(super) asset_id: String,
    pub(super) reference_set_id: String,
    pub(super) assignment_id: String,
    pub(super) asset_sha256: String,
    pub(super) role: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ShotReferenceFlowPreflightReport {
    ready: bool,
    project_id: String,
    segment_id: String,
    reference_set_id: String,
    assignment_id: String,
    asset_id: String,
    asset_sha256: String,
    role: String,
    relative_path: Option<String>,
    // Re-read from the bytes currently on disk. Null means the file could not
    // be resolved and hashed, which is a block, not a pass.
    current_sha256: Option<String>,
    asset_status: String,
    rights_status: String,
    assignment_approved: bool,
    reference_set_status: String,
    reasons: Vec<String>,
    message: String,
}

pub(super) fn shot_reference_rights_cleared(rights_status: &str) -> bool {
    matches!(
        rights_status,
        "personal" | "owned" | "licensed" | "public_domain"
    )
}

// Local, SQLite-authoritative gate for preparing a bound shot reference for
// Flow. It never uploads anything and never grants rights: a local assignment
// or a later visual confirmation cannot make a pending, quarantined, changed
// or unapproved reference eligible. The answer is scoped to one exact identity
// — project, shot, set, assignment, asset, hash and role — and to the bytes
// currently on disk for that asset.
#[tauri::command]
pub(super) fn preflight_shot_reference_flow_binding(
    project_id: String,
    request: ShotReferenceFlowPreflightRequest,
    state: State<'_, AppState>,
) -> Result<ShotReferenceFlowPreflightReport, String> {
    preflight_shot_reference_flow_binding_in(project_id, request, &state.database)
}

// The same gate over a plain database handle, so the answer can be exercised
// against an in-memory schema and a disposable workspace.
pub(super) fn preflight_shot_reference_flow_binding_in(
    project_id: String,
    request: ShotReferenceFlowPreflightRequest,
    database: &Mutex<Connection>,
) -> Result<ShotReferenceFlowPreflightReport, String> {
    valid_text(&project_id, "Project ID")?;
    valid_text(&request.segment_id, "Segment ID")?;
    valid_text(&request.asset_id, "Asset ID")?;
    valid_text(&request.reference_set_id, "Reference set ID")?;
    valid_text(&request.assignment_id, "Assignment ID")?;
    validate_reference_role(&request.role)?;
    let project_id = project_id.trim().to_string();
    let segment_id = request.segment_id.trim().to_string();
    let asset_id = request.asset_id.trim().to_string();
    let reference_set_id = request.reference_set_id.trim().to_string();
    let assignment_id = request.assignment_id.trim().to_string();
    let role = request.role.trim().to_string();
    let expected_sha256 = request.asset_sha256.trim().to_ascii_lowercase();
    if expected_sha256.len() != 64
        || !expected_sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("SHA-256 của shot reference không hợp lệ".to_string());
    }

    // Everything that needs the database is answered inside this scope so the
    // connection is released before any file on disk is read and hashed.
    let (
        mut reasons,
        reference_set_status,
        assignment_approved,
        asset_status,
        rights_status,
        relative_path,
        workspace_root,
    ) = {
        let connection = database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        ensure_project_exists(&connection, &project_id)?;

        let mut reasons: Vec<String> = Vec::new();
        let mut reference_set_status = "missing".to_string();
        let mut assignment_approved = false;
        let reference_set = fetch_reference_set(&connection, &reference_set_id).ok();
        if let Some(set) = reference_set.as_ref() {
            reference_set_status = set.status.clone();
            if set.project_id != project_id {
                reasons.push("Reference set thuộc project khác.".to_string());
            }
            if set.scope != "shot" {
                reasons.push("Reference set này không phải set gán cho từng shot.".to_string());
            }
            if set.status == "archived" {
                reasons.push("Reference set đã lưu trữ.".to_string());
            }
            let assignment = set
                .assignments
                .iter()
                .find(|item| item.assignment_id == assignment_id);
            match assignment {
                None => reasons.push(
                    "Không tìm thấy assignment của shot này trong reference set.".to_string(),
                ),
                Some(item) => {
                    assignment_approved = item.approved;
                    if !item.approved {
                        reasons.push("Assignment của shot chưa được duyệt.".to_string());
                    }
                    if item.asset_id != asset_id {
                        reasons.push("Assignment của shot trỏ sang asset khác.".to_string());
                    }
                    // Both columns are NOT NULL and assign_reference fills them
                    // from the asset and the owning project, so anything other
                    // than an exact match is a row that cannot describe this
                    // binding. A blank value is a row that describes nothing,
                    // and that blocks too.
                    if item.asset_sha256.trim().to_ascii_lowercase() != expected_sha256 {
                        reasons.push(
                            "Hash lưu trong assignment khác hash của binding trên session."
                                .to_string(),
                        );
                    }
                    if item.project_id.trim() != project_id {
                        reasons.push("Assignment của shot thuộc project khác.".to_string());
                    }
                    if item.shot_id.as_deref() != Some(segment_id.as_str()) {
                        reasons
                            .push("Assignment của shot không thuộc segment đang chọn.".to_string());
                    }
                    if item.role != role {
                        reasons.push("Assignment của shot dùng vai trò khác.".to_string());
                    }
                }
            }
        } else {
            reasons.push("Không đọc được reference set của shot.".to_string());
        }

        let mut asset_status = "missing".to_string();
        let mut rights_status = "unknown".to_string();
        let mut relative_path: Option<String> = None;
        match fetch_asset(&connection, &asset_id) {
            Ok(asset) => {
                asset_status = asset.status.clone();
                rights_status = asset.rights_status.clone();
                relative_path = Some(asset.relative_path.clone());
                if asset.project_id != project_id {
                    reasons.push("Asset thuộc project khác.".to_string());
                }
                // A shot start frame is a picture. An asset row of any other
                // kind, however clear its rights and matching its hash, is the
                // wrong file for this gate.
                if asset.kind != "image" {
                    reasons.push(format!(
                        "Asset không phải ảnh (kind {}), nên không thể làm ảnh bắt đầu của shot.",
                        asset.kind
                    ));
                }
                if asset.status == "archived" || asset.status == "missing" {
                    reasons.push(format!("Asset đang ở trạng thái {}.", asset.status));
                } else if asset.status != "ready" {
                    reasons.push(format!(
                        "Asset chưa sẵn sàng (trạng thái {}).",
                        asset.status
                    ));
                }
                if !shot_reference_rights_cleared(&asset.rights_status) {
                    reasons.push(format!(
                        "Quyền asset chưa đủ bằng chứng (rightsStatus {}).",
                        asset.rights_status
                    ));
                }
                if asset.sha256.trim().to_ascii_lowercase() != expected_sha256 {
                    reasons.push("Hash asset đã thay đổi so với binding của session.".to_string());
                }
            }
            Err(_) => reasons.push("Asset của shot không còn trong Asset Library.".to_string()),
        }

        // Only this project's own workspace is ever consulted, and only the
        // database decides which relative path inside it is the asset.
        let workspace_root = if relative_path.is_some() {
            project_workspace_root(&connection, &project_id).ok()
        } else {
            None
        };
        (
            reasons,
            reference_set_status,
            assignment_approved,
            asset_status,
            rights_status,
            relative_path,
            workspace_root,
        )
    };

    // The stored hash is a claim about a file, so the file is re-read here: a
    // missing, escaping, oversized, unreadable, or changed asset blocks rather
    // than being confirmed from a hash nobody recomputed.
    let mut current_sha256: Option<String> = None;
    if reasons.is_empty() {
        match (workspace_root.as_deref(), relative_path.as_deref()) {
            (Some(workspace_root), Some(relative_path)) => {
                match resolve_workspace_file(
                    workspace_root,
                    relative_path,
                    "Shot reference",
                    MAX_SHOT_REFERENCE_BYTES,
                )
                .and_then(|path| sha256_file(&path))
                {
                    Ok(digest) if digest == expected_sha256 => current_sha256 = Some(digest),
                    Ok(_) => reasons.push(
                        "File shot reference trên đĩa đã đổi so với hash của binding.".to_string(),
                    ),
                    Err(error) => reasons.push(format!(
                        "Không đọc được file shot reference hiện tại: {error}"
                    )),
                }
            }
            _ => reasons.push(
                "Asset chưa có đường dẫn nào trong workspace của project để kiểm tra byte hiện tại."
                    .to_string(),
            ),
        }
    }

    let ready = reasons.is_empty();
    let message = if ready {
        "Shot reference đã qua kiểm tra cục bộ: đúng shot/set/assignment/role, asset sẵn sàng, quyền đủ bằng chứng, hash trên đĩa khớp, assignment được duyệt và reference set chưa lưu trữ.".to_string()
    } else {
        format!(
            "Chưa thể chuẩn bị shot reference cho Flow: {}",
            reasons.join(" ")
        )
    };
    Ok(ShotReferenceFlowPreflightReport {
        ready,
        project_id,
        segment_id,
        reference_set_id,
        assignment_id,
        asset_id,
        asset_sha256: expected_sha256,
        role,
        relative_path,
        current_sha256,
        asset_status,
        rights_status,
        assignment_approved,
        reference_set_status,
        reasons,
        message,
    })
}
