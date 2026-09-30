use super::asset_library::{
    import_asset_with_state, validate_asset_rights, validate_asset_text, AssetImportInput,
    AssetView,
};
use super::tool_readiness::resolve_configured_tool;
use super::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GflowCliGenerationRequest {
    project_id: String,
    flow_project_id: String,
    run_id: String,
    script: Value,
    #[serde(default)]
    profile: Option<String>,
    #[serde(default = "default_gflow_model")]
    model: String,
    #[serde(default = "default_gflow_aspect")]
    aspect: String,
}

fn default_gflow_model() -> String {
    "veo-fast".to_string()
}

fn default_gflow_aspect() -> String {
    "16:9".to_string()
}

fn gflow_cli_site_relative() -> &'static str {
    ".auto3dvideo/tools/gflow-cli/site-packages"
}

fn gflow_cli_runtime_ready(site: &Path) -> bool {
    [
        "gflow_cli/cli.py",
        "click/__init__.py",
        "httpx/__init__.py",
        "playwright/__init__.py",
        "rich/__init__.py",
        "pydantic_settings/__init__.py",
        "platformdirs/__init__.py",
        "structlog/__init__.py",
        "colorama/__init__.py",
        "tenacity/__init__.py",
        "browser_cookie3/__init__.py",
        "mcp/__init__.py",
        "fastapi/__init__.py",
        "uvicorn/__init__.py",
        "sse_starlette/__init__.py",
    ]
    .iter()
    .all(|relative| site.join(relative).is_file())
}

#[tauri::command]
pub(super) async fn connect_gflow_cli_account(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let project_id = safe_id(&project_id, "Project ID")?;
    let (workspace, python) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        let workspace: String = connection
            .query_row(
                "SELECT workspace_root FROM projects WHERE project_id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .map_err(|error| format!("Không đọc được project workspace: {error}"))?;
        (
            fs::canonicalize(workspace)
                .map_err(|error| format!("Không canonicalize workspace: {error}"))?,
            resolve_configured_tool(&connection, "python")?,
        )
    };
    let site = ensure_gflow_cli_runtime(&workspace, &python).await?;
    let run_relative = ".auto3dvideo/runs/gflow-cli-auth";
    let run_directory = workspace.join(run_relative.replace('/', "\\"));
    fs::create_dir_all(&run_directory)
        .map_err(|error| format!("Không tạo được gflow auth worker directory: {error}"))?;
    let worker_relative = format!("{run_relative}/gflow_cli_auth_worker.py");
    fs::write(
        workspace.join(worker_relative.replace('/', "\\")),
        GFLOW_CLI_AUTH_WORKER_SCRIPT,
    )
    .map_err(|error| format!("Không ghi được gflow auth worker: {error}"))?;
    let source_root = workspace.join("vendor\\gflow-cli\\src");
    let process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "python".to_string(),
            args: vec![worker_relative],
            working_directory: ".".to_string(),
            environment: BTreeMap::from([
                (
                    "AUTO3DVIDEO_GFLOWSOURCE".to_string(),
                    source_root.to_string_lossy().to_string(),
                ),
                (
                    "AUTO3DVIDEO_GFLOWSITE".to_string(),
                    site.to_string_lossy().to_string(),
                ),
            ]),
            timeout_seconds: 1800,
            expected_outputs: Vec::new(),
        },
        executable_path: python,
        absolute_working_directory: workspace.clone(),
        output_root: workspace,
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    let response = serde_json::from_str::<Value>(&process.stdout).ok();
    let message = response
        .as_ref()
        .and_then(|value| value.get("message"))
        .and_then(Value::as_str);
    if !process.succeeded
        || response
            .as_ref()
            .and_then(|value| value.get("status"))
            .and_then(Value::as_str)
            != Some("success")
    {
        let detail = message.unwrap_or_else(|| {
            if !process.stderr.trim().is_empty() {
                process.stderr.trim()
            } else {
                "gflow-cli login chưa hoàn tất"
            }
        });
        return Err(format!(
            "GFLOW_AUTH_FAILED: {}",
            detail.chars().take(1000).collect::<String>()
        ));
    }
    Ok(
        "Đã xác thực profile gflow-cli trên Google Chrome. Có thể quay lại app và chạy tạo video."
            .to_string(),
    )
}

async fn ensure_gflow_cli_runtime(workspace: &Path, python: &Path) -> Result<PathBuf, String> {
    let site_relative = gflow_cli_site_relative();
    let site = workspace.join(site_relative.replace('/', "\\"));
    if gflow_cli_runtime_ready(&site) {
        return Ok(site);
    }
    let vendor_path = workspace.join("vendor\\gflow-cli");
    if !vendor_path.join("pyproject.toml").is_file() {
        return Err("Thiếu vendor/gflow-cli đã pin trong workspace".to_string());
    }
    fs::create_dir_all(&site).map_err(|error| format!("Không tạo được gflow runtime: {error}"))?;
    let install = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "python".to_string(),
            args: vec![
                "-m".to_string(),
                "pip".to_string(),
                "install".to_string(),
                "--disable-pip-version-check".to_string(),
                "--no-warn-script-location".to_string(),
                "--upgrade".to_string(),
                "--target".to_string(),
                site_relative.to_string(),
                "vendor/gflow-cli".to_string(),
            ],
            working_directory: ".".to_string(),
            environment: BTreeMap::new(),
            timeout_seconds: 1200,
            expected_outputs: Vec::new(),
        },
        executable_path: python.to_path_buf(),
        absolute_working_directory: workspace.to_path_buf(),
        output_root: workspace.to_path_buf(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    if !install.succeeded {
        let detail = if !install.stderr.trim().is_empty() {
            install.stderr.trim()
        } else {
            install.stdout.trim()
        };
        return Err(format!(
            "GFLOW_RUNTIME_INSTALL_FAILED: không cài được gflow-cli; {}",
            detail.chars().take(700).collect::<String>()
        ));
    }
    if !gflow_cli_runtime_ready(&site) {
        return Err("GFLOW_RUNTIME_INSTALL_INCOMPLETE: pip kết thúc nhưng thiếu thư viện bắt buộc trong runtime local".to_string());
    }
    Ok(site)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GflowCliGenerationReport {
    status: String,
    run_id: String,
    provider: String,
    flow_project_id: String,
    generated_shot_ids: Vec<String>,
    skipped_shot_ids: Vec<String>,
    validated_video_count: usize,
    expected_video_count: usize,
    output_paths: Vec<String>,
    message: String,
    process: ExternalProcessResult,
    ffprobe_failures: Vec<String>,
    final_video_path: Option<String>,
    final_video_validated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ComfyUiHealthReport {
    pub(super) endpoint: String,
    pub(super) status: String,
    pub(super) http_status: Option<u16>,
    pub(super) message: String,
    pub(super) network_probe_performed: bool,
    pub(super) side_effects_started: bool,
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
pub(super) struct ComfyUiImageGenerationRequest {
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
pub(super) struct ComfyUiImageGenerationReport {
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
    #[serde(default)]
    revision_id: String,
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
pub(super) struct NanoBananaImageGenerationRequest {
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
pub(super) struct NanoBananaProgressRequest {
    project_id: String,
    run_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct NanoBananaProgressReport {
    run_id: String,
    exists: bool,
    progress_path: String,
    events: Vec<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct NanoBananaImageGenerationReport {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleFlowMcpImageInput {
    shot_id: String,
    duration_seconds: f64,
    relative_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ComposeGoogleFlowMcpImagesRequest {
    project_id: String,
    run_id: String,
    images: Vec<GoogleFlowMcpImageInput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ComposeGoogleFlowMcpImagesReport {
    status: String,
    output_path: String,
    sha256: String,
    size_bytes: u64,
    duration_seconds: f64,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct NanoBananaCdpPreflightReport {
    pub(super) endpoint: String,
    pub(super) status: String,
    pub(super) http_status: Option<u16>,
    pub(super) message: String,
    pub(super) network_probe_performed: bool,
    pub(super) side_effects_started: bool,
}

#[tauri::command]
pub(super) async fn run_google_flow_mcp_image_generation(
    request: NanoBananaImageGenerationRequest,
    state: State<'_, AppState>,
) -> Result<NanoBananaImageGenerationReport, String> {
    if !current_cloud_generation_enabled(&state)? {
        return Err("Cloud/API đang tắt. Hãy bấm ‘Bật Cloud/API’ trước khi gọi Google Flow MCP; app chưa tiêu credit.".to_string());
    }
    valid_text(&request.project_id, "Project ID")?;
    if request.tasks.is_empty() || request.tasks.len() > 32 {
        return Err("Google Flow MCP image job cần từ 1 đến 32 task theo shot".to_string());
    }
    let model = request
        .model
        .clone()
        .unwrap_or_else(|| "nano-banana-pro".to_string());
    valid_text(&model, "Google Flow MCP model")?;
    if model.chars().count() > 120 || preview_secret_like(&model) {
        return Err("Google Flow MCP model không hợp lệ hoặc có dấu hiệu secret".to_string());
    }
    for task in &request.tasks {
        if !safe_preview_id(&task.asset_id) {
            return Err(format!(
                "Asset ID Google Flow MCP không hợp lệ: {}",
                task.asset_id
            ));
        }
        if task.shot_id.trim().is_empty()
            || !task.shot_id.chars().all(|character| {
                character.is_ascii_uppercase()
                    || character.is_ascii_digit()
                    || matches!(character, '-' | '_')
            })
        {
            return Err(format!(
                "Shot ID Google Flow MCP không hợp lệ: {}",
                task.shot_id
            ));
        }
        validate_asset_rights(task.rights_status.trim())?;
        if !matches!(
            task.role.trim(),
            "identity" | "composition" | "pose" | "camera" | "style" | "environment" | "prop"
        ) {
            return Err(format!(
                "Vai trò ảnh Google Flow MCP không hợp lệ: {}",
                task.role
            ));
        }
        validate_asset_text(&task.title, "Tên ảnh Google Flow MCP", 160)?;
        valid_text(&task.prompt, "Prompt ảnh Google Flow MCP")?;
        if task.prompt.chars().count() > 20_000 || task.negative_prompt.chars().count() > 8_000 {
            return Err("Prompt Google Flow MCP vượt giới hạn ký tự".to_string());
        }
        if prompt_secret_like(&task.prompt) || prompt_secret_like(&task.negative_prompt) {
            return Err(
                "Prompt Google Flow MCP chứa credential assignment; chỉ gửi prompt sáng tạo, không gửi khóa/token".to_string(),
            );
        }
        for dimension in [task.width, task.height].into_iter().flatten() {
            if !(64..=4096).contains(&dimension) {
                return Err("Kích thước ảnh Google Flow MCP phải nằm trong 64..4096".to_string());
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
    let (workspace_root, node_path, server_entry) = {
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
        let node_path = resolve_configured_tool(&connection, "node")?;
        let configured_entry = request
            .server_entry
            .clone()
            .unwrap_or_else(provider_config::google_flow_mcp_server_entry);
        let candidate = PathBuf::from(configured_entry.trim());
        if !candidate.is_absolute() {
            return Err("Google Flow MCP server entry phải là đường dẫn tuyệt đối".to_string());
        }
        let server_entry = fs::canonicalize(&candidate)
            .map_err(|error| format!("Không tìm thấy Google Flow MCP server entry: {error}"))?;
        let server_root = server_entry
            .parent()
            .and_then(Path::parent)
            .ok_or_else(|| "Không xác định được root Google Flow MCP".to_string())?;
        let package_path = server_root.join("package.json");
        let package_json = fs::read_to_string(&package_path)
            .map_err(|error| format!("Không đọc được package.json Google Flow MCP: {error}"))?;
        let package: Value = serde_json::from_str(&package_json)
            .map_err(|error| format!("package.json Google Flow MCP không hợp lệ: {error}"))?;
        if package.get("name").and_then(Value::as_str) != Some("google-flow-mcp")
            || server_entry.file_name().and_then(|value| value.to_str()) != Some("index.js")
            || server_entry
                .parent()
                .and_then(Path::file_name)
                .and_then(|value| value.to_str())
                != Some("dist")
        {
            return Err(
                "Google Flow MCP server entry phải là dist/index.js của package google-flow-mcp"
                    .to_string(),
            );
        }
        (workspace_root, node_path, server_entry)
    };
    let run_id = if let Some(requested_run_id) = request.run_id.as_deref() {
        if !safe_preview_id(requested_run_id) {
            return Err("Google Flow MCP run ID không hợp lệ".to_string());
        }
        requested_run_id.to_string()
    } else {
        now_id("google-flow-mcp-images")
    };
    let output_dir = workspace_root
        .join(".auto3dvideo")
        .join("runs")
        .join(&run_id)
        .join("google-flow-mcp-images");
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Không tạo được Google Flow MCP output directory: {error}"))?;
    let spec_path = output_dir.join("google-flow-mcp-image-job.json");
    let worker_path = output_dir.join("google_flow_mcp_worker.mjs");
    let relative = |path: &Path| -> Result<String, String> {
        path.strip_prefix(&workspace_root)
            .map_err(|_| "Google Flow MCP output vượt project workspace".to_string())
            .map(|value| value.to_string_lossy().replace('\\', "/"))
    };
    let output_relative = relative(&output_dir)?;
    let spec_relative = relative(&spec_path)?;
    let worker_relative = relative(&worker_path)?;
    let report_relative = relative(&output_dir.join("google-flow-mcp-image-report.json"))?;
    let spec = serde_json::json!({
        "schemaVersion": "1.0.0",
        "jobType": "image.generate",
        "provider": "google_flow_mcp",
        "projectId": request.project_id.trim(),
        "runId": run_id,
        "serverEntry": server_entry.to_string_lossy().to_string(),
        "model": model,
        "aspectRatio": "16:9",
        "outputDirectory": output_relative,
        "timeoutSeconds": request.timeout_seconds.unwrap_or(900).clamp(15, 900),
        "tasks": request.tasks.clone(),
    });
    fs::write(
        &spec_path,
        serde_json::to_vec_pretty(&spec).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Không ghi được Google Flow MCP job spec: {error}"))?;
    fs::write(&worker_path, GOOGLE_FLOW_MCP_WORKER_SCRIPT)
        .map_err(|error| format!("Không ghi được Google Flow MCP worker: {error}"))?;
    let mut worker_environment = BTreeMap::new();
    worker_environment.insert(
        "FLOW_MCP_CDP_URL".to_string(),
        provider_config::nanobanana_flow_cdp_url(),
    );
    let process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "node".to_string(),
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
                "--server-entry".to_string(),
                server_entry.to_string_lossy().to_string(),
            ],
            working_directory: ".".to_string(),
            environment: worker_environment,
            timeout_seconds: request.timeout_seconds.unwrap_or(900).clamp(30, 3600),
            expected_outputs: vec![report_relative.clone()],
        },
        executable_path: node_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    let report_path = workspace_root.join(&report_relative);
    let raw_report: Value = serde_json::from_str(
        &fs::read_to_string(&report_path)
            .map_err(|error| format!("Không đọc được Google Flow MCP image report: {error}"))?,
    )
    .map_err(|error| format!("Google Flow MCP image report không hợp lệ: {error}"))?;
    let task_lookup = request
        .tasks
        .iter()
        .map(|task| {
            (
                task.asset_id.clone(),
                (
                    task.shot_id.clone(),
                    task.revision_id.clone(),
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
            .ok_or_else(|| "Google Flow MCP output thiếu assetId".to_string())?;
        let relative_path = output
            .get("relativePath")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("Google Flow MCP output {asset_id} thiếu relativePath"))?;
        if !safe_preview_relative_path(relative_path) {
            return Err(format!(
                "Google Flow MCP output path không an toàn: {relative_path}"
            ));
        }
        let source = fs::canonicalize(workspace_root.join(relative_path.replace('/', "\\")))
            .map_err(|error| format!("Không đọc được ảnh Google Flow MCP {asset_id}: {error}"))?;
        if !source.starts_with(&workspace_root) || !source.is_file() {
            return Err(format!(
                "Ảnh Google Flow MCP {asset_id} vượt workspace hoặc không tồn tại"
            ));
        }
        let (shot_id, revision_id, role, rights_status) = task_lookup
            .get(asset_id)
            .cloned()
            .ok_or_else(|| format!("Google Flow MCP output không khớp task: {asset_id}"))?;
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
                source_uri: Some(format!("local://google-flow-mcp/{run_id}/{asset_id}")),
                tags: vec![
                    "google-flow-mcp-generated".to_string(),
                    "nano-banana".to_string(),
                    format!("shot-{}", shot_id.to_ascii_lowercase()),
                    format!("revision-{}", revision_id.to_ascii_lowercase()),
                    format!("role-{role}"),
                ],
                note: "Ảnh do google-flow-mcp tạo qua workspace Google Flow; job ID và downloadedFiles đã được xác minh. Rights, continuity và chất lượng vẫn cần human review trước delivery.".to_string(),
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
    let failure_detail = raw_report
        .get("errors")
        .and_then(Value::as_array)
        .and_then(|errors| errors.first())
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let message = if failed_count == 0 {
        "Đã tạo và nhập đủ ảnh qua google-flow-mcp; mỗi file thuộc downloadedFiles của job Flow, không lấy gallery item đoán. Cần review rights/continuity trước compose.".to_string()
    } else {
        format!(
            "Google Flow MCP chỉ hoàn thành {ready_count}/{task_count} ảnh; giữ job/report và không giả đã đủ asset. {}",
            failure_detail.clone().unwrap_or_else(|| "Các shot lỗi có thể resume theo job report sau khi kiểm tra account/workspace.".to_string())
        )
    };
    let report = NanoBananaImageGenerationReport {
        run_id: run_id.clone(),
        status,
        report_path: report_relative,
        output_directory: output_relative,
        generated_assets,
        task_count,
        ready_count,
        failed_count,
        process,
        message,
        failure_code: failure_detail
            .as_ref()
            .map(|_| "GOOGLE_FLOW_MCP_PARTIAL".to_string()),
        failure_detail,
        cdp_preflight: None,
    };
    let connection = state
        .database
        .lock()
        .map_err(|_| "Không thể khóa database để ghi audit".to_string())?;
    audit_event(
        &connection,
        Some(request.project_id.trim()),
        "google_flow_mcp.image_generation.completed",
        "google_flow_mcp_image_run",
        &run_id,
    )?;
    Ok(report)
}

pub(super) fn gflow_worker_failure_detail(stdout: &str) -> Option<String> {
    let report = serde_json::from_str::<Value>(stdout.trim()).ok()?;
    if report.get("status").and_then(Value::as_str) != Some("fail") {
        return None;
    }
    let error = report.get("error")?.as_object()?;
    let code = error.get("code")?.as_str()?.trim();
    let message = error
        .get("message")?
        .as_str()?
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if code.is_empty()
        || !code.chars().all(|character| {
            character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_'
        })
        || message.is_empty()
    {
        return None;
    }
    let message = if prompt_secret_like(&message) {
        "Chi tiết lỗi đã được ẩn vì có thể chứa thông tin nhạy cảm.".to_string()
    } else {
        message
    };
    Some(format!("{code}: {message}").chars().take(480).collect())
}

#[tauri::command]
pub(super) async fn run_gflow_cli_video_generation(
    request: GflowCliGenerationRequest,
    state: State<'_, AppState>,
) -> Result<GflowCliGenerationReport, String> {
    if !current_cloud_generation_enabled(&state)? {
        return Err("Cloud/API đang tắt. Hãy bật Cloud/API trước khi tạo video Google Flow; app chưa tiêu credit.".to_string());
    }
    let project_id = safe_id(&request.project_id, "Project ID")?;
    valid_text(&request.flow_project_id, "Google Flow Project ID")?;
    if !safe_preview_id(&request.run_id) {
        return Err("gflow run ID không hợp lệ".to_string());
    }
    if !matches!(
        request.model.as_str(),
        "veo-fast" | "veo-lite" | "veo-quality" | "veo-lite-lp" | "omni-flash"
    ) {
        return Err("gflow model không nằm trong allowlist upstream v0.79.0".to_string());
    }
    if request.aspect != "16:9" && request.aspect != "9:16" {
        return Err("gflow aspect chỉ hỗ trợ 16:9 hoặc 9:16".to_string());
    }

    let (workspace_root, python_path, ffprobe_path) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        let workspace: String = connection
            .query_row(
                "SELECT workspace_root FROM projects WHERE project_id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .map_err(|error| format!("Không đọc được project workspace: {error}"))?;
        (
            fs::canonicalize(workspace)
                .map_err(|error| format!("Không canonicalize workspace: {error}"))?,
            resolve_configured_tool(&connection, "python")?,
            resolve_configured_tool(&connection, "ffprobe")?,
        )
    };
    let gflow_site = ensure_gflow_cli_runtime(&workspace_root, &python_path).await?;
    let run_relative = format!(".auto3dvideo/runs/{}/gflow-cli", request.run_id);
    let run_directory = workspace_root.join(run_relative.replace('/', "\\"));
    fs::create_dir_all(&run_directory)
        .map_err(|error| format!("Không tạo được gflow run directory: {error}"))?;
    let state_relative = format!(".auto3dvideo/gflow-cli/{project_id}/state.json");
    let state_path = workspace_root.join(state_relative.replace('/', "\\"));
    if let Some(parent) = state_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Không tạo được gflow state directory: {error}"))?;
    }

    let segments = request
        .script
        .get("segments")
        .and_then(Value::as_array)
        .ok_or_else(|| "Prompt Skill script thiếu segments".to_string())?;
    if segments.is_empty() || segments.len() > 24 {
        return Err("gflow cần từ 1 đến 24 shot".to_string());
    }
    let global_refs = request
        .script
        .get("referenceAssetPaths")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if global_refs.len() > 3 {
        return Err("gflow veo-fast chỉ nhận tối đa 3 reference local trong route này".to_string());
    }
    let mut worker_segments = Vec::with_capacity(segments.len());
    let mut expected_outputs = Vec::with_capacity(segments.len());
    let mut target_durations = Vec::with_capacity(segments.len());
    for (index, segment) in segments.iter().enumerate() {
        let prompt = segment
            .get("visualPrompt")
            .and_then(Value::as_str)
            .or_else(|| segment.get("prompt").and_then(Value::as_str))
            .unwrap_or("")
            .trim();
        if prompt.is_empty() {
            return Err(format!("SHOT-{:03} thiếu visualPrompt", index + 1));
        }
        if prompt.chars().count() > 12000 || preview_secret_like(prompt) {
            return Err(format!("SHOT-{:03} prompt không hợp lệ", index + 1));
        }
        let shot_id = segment
            .get("shotId")
            .and_then(Value::as_str)
            .filter(|value| safe_preview_id(value))
            .map(str::to_string)
            .unwrap_or_else(|| format!("SHOT-{:03}", index + 1));
        let revision_id = segment
            .get("revisionId")
            .and_then(Value::as_str)
            .unwrap_or("rev-001");
        if !safe_preview_id(revision_id) {
            return Err(format!("{shot_id} revision ID không hợp lệ"));
        }
        let prompt_sha = format!("{:x}", Sha256::digest(prompt.as_bytes()));
        let target_duration = segment
            .get("durationSeconds")
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && *value > 0.0 && *value <= 10.0)
            .unwrap_or(8.0);
        let supported_durations: &[i64] = if request.model == "omni-flash" {
            &[4, 6, 8, 10]
        } else {
            &[4, 6, 8]
        };
        let max_duration = *supported_durations.last().unwrap_or(&8) as f64;
        if target_duration > max_duration {
            return Err(format!("{shot_id} cần {target_duration:.1}s nhưng model {} chỉ nhận tối đa {max_duration:.0}s/shot", request.model));
        }
        let duration = supported_durations
            .iter()
            .copied()
            .find(|supported| *supported as f64 >= target_duration)
            .unwrap_or(max_duration as i64);
        let aspect_name = request.aspect.replace(':', "x");
        let output_relative = format!(".auto3dvideo/gflow-cli/{project_id}/{shot_id}-{revision_id}-{duration}-{}-{aspect_name}-{}.mp4", request.model, &prompt_sha[..12]);
        let mut references = Vec::new();
        for reference in &global_refs {
            let relative = reference
                .as_str()
                .ok_or_else(|| "referenceAssetPaths phải là chuỗi".to_string())?
                .replace('\\', "/");
            let path = Path::new(&relative);
            if path.is_absolute()
                || path
                    .components()
                    .any(|component| component == Component::ParentDir)
            {
                return Err("referenceAssetPaths phải nằm trong workspace".to_string());
            }
            if !workspace_root.join(path).is_file() {
                return Err(format!("Không tìm thấy reference local: {relative}"));
            }
            references.push(relative);
        }
        expected_outputs.push(output_relative.clone());
        target_durations.push(target_duration);
        worker_segments.push(serde_json::json!({
            "projectId": project_id,
            "shotId": shot_id,
            "revisionId": revision_id,
            "prompt": prompt,
            "promptSha256": prompt_sha,
            "durationSeconds": duration,
            "targetDurationSeconds": target_duration,
            "outputRelativePath": output_relative,
            "referencePaths": references,
            "settings": {
                "flowProjectId": request.flow_project_id.clone(),
                "profile": request.profile.clone(),
                "model": request.model.clone(),
                "aspect": request.aspect.clone(),
            },
        }));
    }
    let request_relative = format!("{run_relative}/request.json");
    let request_path = workspace_root.join(request_relative.replace('/', "\\"));
    let worker_relative = format!("{run_relative}/gflow_cli_worker.py");
    let worker_path = workspace_root.join(worker_relative.replace('/', "\\"));
    fs::write(&worker_path, GFLOW_CLI_WORKER_SCRIPT)
        .map_err(|error| format!("Không ghi được gflow worker: {error}"))?;
    let worker_request = serde_json::json!({
        "projectId": project_id,
        "flowProjectId": request.flow_project_id.clone(),
        "profile": request.profile.clone().unwrap_or_else(|| "auto3dvideo".to_string()),
        "model": request.model.clone(),
        "aspect": request.aspect.clone(),
        "stateRelativePath": state_relative,
        "ffprobePath": ffprobe_path.to_string_lossy().to_string(),
        "segments": worker_segments.clone(),
    });
    fs::write(
        &request_path,
        serde_json::to_vec_pretty(&worker_request).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Không ghi được gflow request: {error}"))?;
    let source_root = workspace_root.join("vendor\\gflow-cli\\src");
    if !source_root.join("gflow_cli").is_dir() {
        return Err(
            "Không tìm thấy pinned vendor/gflow-cli/src trong project workspace".to_string(),
        );
    }
    let cancellation = Arc::new(AtomicBool::new(false));
    {
        let mut registry = state
            .cancellation_tokens
            .lock()
            .map_err(|_| "Không thể khóa cancellation registry".to_string())?;
        if registry.contains_key(&request.run_id) {
            return Err("gflow run đang được xử lý; không chạy song song cùng run ID".to_string());
        }
        registry.insert(request.run_id.clone(), cancellation.clone());
    }
    let process_result = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "python".to_string(),
            args: vec![worker_relative, request_relative, ".".to_string()],
            working_directory: ".".to_string(),
            environment: BTreeMap::from([
                (
                    "AUTO3DVIDEO_GFLOWSOURCE".to_string(),
                    source_root.to_string_lossy().to_string(),
                ),
                (
                    "AUTO3DVIDEO_GFLOWSITE".to_string(),
                    gflow_site.to_string_lossy().to_string(),
                ),
            ]),
            timeout_seconds: 7200,
            // The worker returns a structured per-shot report and may stop on a
            // single unverified shot. Validate outputs below, one at a time.
            expected_outputs: Vec::new(),
        },
        executable_path: python_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation,
    })
    .await;
    if let Ok(mut registry) = state.cancellation_tokens.lock() {
        registry.remove(&request.run_id);
    }
    let process = process_result?;
    if process.cancelled {
        return Err(format!(
            "GFLOW_CANCELLED: gflow worker bị hủy; exit_code={:?}",
            process.exit_code
        ));
    }
    if process.timed_out {
        return Err(format!(
            "GFLOW_TIMEOUT: gflow worker quá thời hạn; exit_code={:?}",
            process.exit_code
        ));
    }
    if !process.succeeded {
        if let Some(detail) = gflow_worker_failure_detail(&process.stdout) {
            return Err(detail);
        }
        let detail = if !process.stderr.trim().is_empty() {
            process.stderr.trim()
        } else {
            process.stdout.trim()
        };
        let detail = detail.chars().take(480).collect::<String>();
        return Err(format!(
            "GFLOW_WORKER_FAILED: exit_code={:?}; {}",
            process.exit_code,
            if detail.is_empty() {
                "worker không trả chi tiết"
            } else {
                &detail
            }
        ));
    }

    let mut generated = Vec::new();
    let mut skipped = Vec::new();
    let mut ffprobe_failures = Vec::new();
    let mut valid_output_paths = Vec::new();
    let mut imported_assets = 0usize;
    for segment in worker_segments.iter() {
        let shot_id = segment
            .get("shotId")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        let relative = segment
            .get("outputRelativePath")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let output = workspace_root.join(relative.replace('/', "\\"));
        if !output.is_file() {
            ffprobe_failures.push(format!("{shot_id}: output không tồn tại"));
            continue;
        }
        let probe = run_external_process(ExternalProcessRequest {
            spec: ProcessSpec {
                executable_id: "ffprobe".to_string(),
                args: vec![
                    "-v".to_string(),
                    "error".to_string(),
                    "-show_entries".to_string(),
                    "stream=codec_type,width,height,duration:format=duration".to_string(),
                    "-of".to_string(),
                    "json".to_string(),
                    output.to_string_lossy().to_string(),
                ],
                working_directory: ".".to_string(),
                environment: Default::default(),
                timeout_seconds: 60,
                expected_outputs: Vec::new(),
            },
            executable_path: ffprobe_path.clone(),
            absolute_working_directory: workspace_root.clone(),
            output_root: workspace_root.clone(),
            cancellation: Arc::new(AtomicBool::new(false)),
        })
        .await?;
        if !probe.succeeded {
            ffprobe_failures.push(format!(
                "{shot_id}: ffprobe thất bại: {}",
                probe.stderr.trim().chars().take(240).collect::<String>()
            ));
            continue;
        }
        let metadata: Value = serde_json::from_str(&probe.stdout)
            .map_err(|error| format!("{shot_id}: ffprobe JSON không hợp lệ: {error}"))?;
        let stream = metadata
            .get("streams")
            .and_then(Value::as_array)
            .and_then(|streams| {
                streams.iter().find(|stream| {
                    stream.get("codec_type").and_then(Value::as_str) == Some("video")
                })
            });
        let width = stream
            .and_then(|value| value.get("width"))
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let height = stream
            .and_then(|value| value.get("height"))
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let duration = stream
            .and_then(|value| value.get("duration"))
            .and_then(Value::as_str)
            .and_then(|value| value.parse::<f64>().ok())
            .or_else(|| {
                metadata
                    .get("format")
                    .and_then(|value| value.get("duration"))
                    .and_then(Value::as_str)
                    .and_then(|value| value.parse::<f64>().ok())
            });
        if width == 0
            || height == 0
            || !duration.is_some_and(|value| value.is_finite() && value > 0.0)
        {
            ffprobe_failures.push(format!(
                "{shot_id}: video stream thiếu width/height/duration hợp lệ"
            ));
            continue;
        }
        let relative = relative.replace('\\', "/");
        valid_output_paths.push(relative.clone());
        let is_skipped = serde_json::from_str::<Value>(&process.stdout)
            .ok()
            .and_then(|report| report.get("shots").and_then(Value::as_array).cloned())
            .is_some_and(|shots| {
                shots.iter().any(|item| {
                    item.get("shotId").and_then(Value::as_str) == Some(shot_id.as_str())
                        && item.get("status").and_then(Value::as_str) == Some("skipped_validated")
                })
            });
        if is_skipped {
            skipped.push(shot_id.clone());
        } else {
            generated.push(shot_id.clone());
        }
        import_asset_with_state(AssetImportInput {
            project_id: project_id.clone(),
            source_path: output.to_string_lossy().to_string(),
            title: format!("Google Flow {shot_id}"),
            media_kind: "video".to_string(),
            source_uri: Some(format!("gflow-cli://{}/{}/{}", request.flow_project_id, request.run_id, shot_id)),
            tags: vec!["gflow-cli".to_string(), format!("shot-{}", shot_id.to_ascii_lowercase())],
            note: "Video do gflow-cli tạo; identity, ffprobe và output path đã được xác minh. Rights, chất lượng và publishability vẫn cần human review.".to_string(),
            rights_status: "needs_review".to_string(),
        }, &state)?;
        imported_assets += 1;
    }
    let validated_count = valid_output_paths.len();
    let worker_detail = serde_json::from_str::<Value>(&process.stdout)
        .ok()
        .and_then(|report| report.get("shots").and_then(Value::as_array).cloned())
        .and_then(|shots| {
            shots.into_iter().find(|item| {
                item.get("status").and_then(Value::as_str) == Some("blocked_unverified")
            })
        })
        .and_then(|item| {
            let shot = item.get("shotId").and_then(Value::as_str).unwrap_or("shot");
            let detail = item
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("output chưa xác minh");
            Some(format!("{shot}: {detail}"))
        });
    let mut final_video_path = None;
    let mut final_video_validated = false;
    if validated_count == expected_outputs.len() && ffprobe_failures.is_empty() {
        let final_relative = format!("{run_relative}/final.mp4");
        let final_path = workspace_root.join(final_relative.replace('/', "\\"));
        if !final_path.is_file() {
            let mut args = vec!["-y".to_string()];
            for path in &valid_output_paths {
                args.extend(["-i".to_string(), path.clone()]);
            }
            let mut filter_parts = Vec::with_capacity(valid_output_paths.len() + 1);
            let (width, height) = if request.aspect == "9:16" {
                (720, 1280)
            } else {
                (1280, 720)
            };
            for (index, target_duration) in target_durations.iter().enumerate() {
                filter_parts.push(format!("[{index}:v:0]scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,trim=duration={target_duration:.3},setpts=PTS-STARTPTS[v{index}]"));
            }
            let labels = (0..valid_output_paths.len())
                .map(|index| format!("[v{index}]"))
                .collect::<String>();
            filter_parts.push(format!(
                "{labels}concat=n={}:v=1:a=0[v]",
                valid_output_paths.len()
            ));
            let filter = filter_parts.join(";");
            args.extend([
                "-filter_complex".to_string(),
                filter,
                "-map".to_string(),
                "[v]".to_string(),
                "-an".to_string(),
                "-c:v".to_string(),
                "libx264".to_string(),
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
                "-r".to_string(),
                "30".to_string(),
                "-movflags".to_string(),
                "+faststart".to_string(),
                final_relative.clone(),
            ]);
            let compose = run_external_process(ExternalProcessRequest {
                spec: ProcessSpec {
                    executable_id: "ffmpeg".to_string(),
                    args,
                    working_directory: ".".to_string(),
                    environment: BTreeMap::new(),
                    timeout_seconds: 1800,
                    expected_outputs: vec![final_relative.clone()],
                },
                executable_path: {
                    let connection = state
                        .database
                        .lock()
                        .map_err(|_| "Không thể khóa database".to_string())?;
                    resolve_configured_tool(&connection, "ffmpeg")?
                },
                absolute_working_directory: workspace_root.clone(),
                output_root: workspace_root.clone(),
                cancellation: Arc::new(AtomicBool::new(false)),
            })
            .await?;
            if !compose.succeeded {
                return Err(format!(
                    "GFLOW_COMPOSE_FAILED: {}",
                    compose.stderr.trim().chars().take(480).collect::<String>()
                ));
            }
        }
        final_video_path = Some(final_relative.clone());
        let final_probe = run_external_process(ExternalProcessRequest {
            spec: ProcessSpec {
                executable_id: "ffprobe".to_string(),
                args: vec![
                    "-v".to_string(),
                    "error".to_string(),
                    "-show_entries".to_string(),
                    "stream=codec_type,width,height,duration:format=duration".to_string(),
                    "-of".to_string(),
                    "json".to_string(),
                    final_relative.clone(),
                ],
                working_directory: ".".to_string(),
                environment: BTreeMap::new(),
                timeout_seconds: 60,
                expected_outputs: Vec::new(),
            },
            executable_path: ffprobe_path,
            absolute_working_directory: workspace_root.clone(),
            output_root: workspace_root.clone(),
            cancellation: Arc::new(AtomicBool::new(false)),
        })
        .await?;
        final_video_validated = final_probe.succeeded
            && serde_json::from_str::<Value>(&final_probe.stdout)
                .ok()
                .is_some_and(|value| {
                    let stream =
                        value
                            .get("streams")
                            .and_then(Value::as_array)
                            .and_then(|streams| {
                                streams.iter().find(|stream| {
                                    stream.get("codec_type").and_then(Value::as_str)
                                        == Some("video")
                                })
                            });
                    let dimensions_valid = stream
                        .and_then(|stream| stream.get("width"))
                        .and_then(Value::as_u64)
                        .is_some_and(|width| width > 0)
                        && stream
                            .and_then(|stream| stream.get("height"))
                            .and_then(Value::as_u64)
                            .is_some_and(|height| height > 0);
                    let duration = stream
                        .and_then(|stream| stream.get("duration"))
                        .and_then(Value::as_str)
                        .and_then(|value| value.parse::<f64>().ok())
                        .or_else(|| {
                            value
                                .get("format")
                                .and_then(|format| format.get("duration"))
                                .and_then(Value::as_str)
                                .and_then(|value| value.parse::<f64>().ok())
                        });
                    dimensions_valid
                        && duration.is_some_and(|value| value.is_finite() && value > 0.0)
                });
        if final_video_validated {
            import_asset_with_state(
                AssetImportInput {
                    project_id: project_id.clone(),
                    source_path: final_path.to_string_lossy().to_string(),
                    title: format!("Google Flow {} final", request.run_id),
                    media_kind: "video".to_string(),
                    source_uri: Some(format!(
                        "gflow-cli://{}/{}/final",
                        request.flow_project_id, request.run_id
                    )),
                    tags: vec!["gflow-cli".to_string(), "final-compose".to_string()],
                    note:
                        "FFmpeg compose từ các shot đã ffprobe xác minh; human review vẫn bắt buộc."
                            .to_string(),
                    rights_status: "needs_review".to_string(),
                },
                &state,
            )?;
        }
    }
    let status = if final_video_validated {
        "success"
    } else if validated_count > 0 {
        "partial"
    } else {
        "blocked"
    };
    let message = if final_video_validated {
        format!("gflow-cli đã xác minh {validated_count} shot, nhập {imported_assets} asset và compose final MP4 qua FFmpeg.")
    } else if let Some(detail) = worker_detail {
        format!(
            "{} video hợp lệ trên {}; {detail}. Không submit shot đó lần nữa tự động.",
            validated_count,
            expected_outputs.len()
        )
    } else if let Some(detail) = ffprobe_failures.first() {
        format!(
            "{} video hợp lệ trên {}; {detail}.",
            validated_count,
            expected_outputs.len()
        )
    } else {
        "gflow-cli chưa trả đủ video hợp lệ; output đã có được giữ nguyên và không giả thành công."
            .to_string()
    };
    Ok(GflowCliGenerationReport {
        status: status.to_string(),
        run_id: request.run_id,
        provider: "ffroliva/gflow-cli@56d95015".to_string(),
        flow_project_id: request.flow_project_id,
        generated_shot_ids: generated,
        skipped_shot_ids: skipped,
        validated_video_count: validated_count,
        expected_video_count: expected_outputs.len(),
        output_paths: valid_output_paths,
        message,
        process,
        ffprobe_failures,
        final_video_path,
        final_video_validated,
    })
}

#[tauri::command]
pub(super) async fn compose_google_flow_mcp_images(
    request: ComposeGoogleFlowMcpImagesRequest,
    state: State<'_, AppState>,
) -> Result<ComposeGoogleFlowMcpImagesReport, String> {
    let project_id = safe_id(&request.project_id, "projectId")?;
    let run_id = safe_id(&request.run_id, "runId")?;
    if request.images.is_empty() || request.images.len() > 32 {
        return Err("Compose Google Flow MCP cần từ 1 đến 32 ảnh".to_string());
    }
    let total_duration: f64 = request
        .images
        .iter()
        .map(|image| image.duration_seconds)
        .sum();
    if !total_duration.is_finite() || !(0.1..=600.0).contains(&total_duration) {
        return Err("Tổng thời lượng compose ảnh phải nằm trong khoảng 0.1–600 giây".to_string());
    }
    for image in &request.images {
        if !safe_flow_shot_id(&image.shot_id) {
            return Err(format!("shotId không hợp lệ: {}", image.shot_id));
        }
        if !image.duration_seconds.is_finite() || !(0.1..=120.0).contains(&image.duration_seconds) {
            return Err(format!("Thời lượng không hợp lệ cho {}", image.shot_id));
        }
        if !safe_preview_relative_path(&image.relative_path) {
            return Err(format!(
                "Ảnh compose không nằm trong workspace: {}",
                image.relative_path
            ));
        }
    }
    let workspace = browser_handoff::workspace_for_project(&state, &project_id)?;
    let compose_root_relative =
        format!(".auto3dvideo/runs/{run_id}/google-flow-mcp-images/compose");
    let compose_root = browser_handoff::ensure_relative_parent(&workspace, &compose_root_relative)?;
    fs::create_dir_all(&compose_root)
        .map_err(|error| format!("Không tạo được thư mục compose Google Flow MCP: {error}"))?;
    let output_relative = safe_relative_path(
        &format!("{compose_root_relative}/{run_id}-slideshow.mp4"),
        "outputPath",
    )?;
    let output_path = browser_handoff::ensure_relative_parent(&workspace, &output_relative)?;
    if output_path.exists() {
        return Err(
            "Output compose Google Flow MCP cùng run đã tồn tại; không ghi đè output cũ"
                .to_string(),
        );
    }
    let (ffmpeg_path, ffprobe_path) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        (
            resolve_configured_tool(&connection, "ffmpeg")?,
            resolve_configured_tool(&connection, "ffprobe")?,
        )
    };
    let mut clips = Vec::with_capacity(request.images.len());
    for (index, image) in request.images.iter().enumerate() {
        let source = workspace.join(image.relative_path.replace('/', "\\"));
        if !source.is_file() {
            return Err(format!("Không tìm thấy ảnh {}", image.relative_path));
        }
        let clip_relative = safe_relative_path(
            &format!("{compose_root_relative}/clips/{:02}.mp4", index + 1),
            "clipPath",
        )?;
        let clip_process = run_external_process(ExternalProcessRequest {
            spec: ProcessSpec {
                executable_id: "ffmpeg".to_string(),
                args: vec![
                    "-y".to_string(),
                    "-loop".to_string(),
                    "1".to_string(),
                    "-framerate".to_string(),
                    "30".to_string(),
                    "-i".to_string(),
                    image.relative_path.clone(),
                    "-t".to_string(),
                    format!("{:.3}", image.duration_seconds),
                    "-vf".to_string(),
                    "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,zoompan=z='min(zoom+0.0012,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30".to_string(),
                    "-an".to_string(),
                    "-c:v".to_string(),
                    "libx264".to_string(),
                    "-pix_fmt".to_string(),
                    "yuv420p".to_string(),
                    "-r".to_string(),
                    "30".to_string(),
                    "-movflags".to_string(),
                    "+faststart".to_string(),
                    clip_relative.clone(),
                ],
                working_directory: ".".to_string(),
                environment: BTreeMap::new(),
                timeout_seconds: 300,
                expected_outputs: vec![clip_relative.clone()],
            },
            executable_path: ffmpeg_path.clone(),
            absolute_working_directory: workspace.clone(),
            output_root: workspace.clone(),
            cancellation: Arc::new(AtomicBool::new(false)),
        })
        .await?;
        if !clip_process.succeeded {
            return Err(format!(
                "Tạo clip slideshow {} thất bại: mã thoát {:?}",
                image.shot_id, clip_process.exit_code
            ));
        }
        clips.push(clip_relative);
    }
    let concat_relative =
        safe_relative_path(&format!("{compose_root_relative}/concat.txt"), "concatPath")?;
    let concat_path = browser_handoff::ensure_relative_parent(&workspace, &concat_relative)?;
    let concat_text = clips
        .iter()
        .map(|clip| format!("file '{}'", clip.replace('\'', "'\\''")))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&concat_path, format!("{concat_text}\n"))
        .map_err(|error| format!("Không ghi được Google Flow MCP concat input: {error}"))?;
    let ffmpeg = run_external_process(ExternalProcessRequest {
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
                "-map".to_string(),
                "0:v:0".to_string(),
                "-an".to_string(),
                "-c:v".to_string(),
                "libx264".to_string(),
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
                "-r".to_string(),
                "30".to_string(),
                "-movflags".to_string(),
                "+faststart".to_string(),
                output_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: BTreeMap::new(),
            timeout_seconds: 1800,
            expected_outputs: vec![output_relative.clone()],
        },
        executable_path: ffmpeg_path,
        absolute_working_directory: workspace.clone(),
        output_root: workspace.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    let _ = fs::remove_file(&concat_path);
    if !ffmpeg.succeeded {
        return Err(format!(
            "Compose Google Flow MCP FFmpeg thất bại: {}",
            ffmpeg.stderr.chars().take(480).collect::<String>()
        ));
    }
    let probe = run_external_process(ExternalProcessRequest {
        spec: browser_handoff::candidate_probe_args(&output_relative),
        executable_path: ffprobe_path,
        absolute_working_directory: workspace.clone(),
        output_root: workspace.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;
    if !probe.succeeded {
        return Err("FFprobe không xác nhận output Google Flow MCP slideshow".to_string());
    }
    let parsed: Value = serde_json::from_str(probe.stdout.trim())
        .map_err(|error| format!("FFprobe Google Flow MCP trả JSON không hợp lệ: {error}"))?;
    let (duration_seconds, _, _, _, _) = browser_handoff::parse_candidate_probe(&parsed)?;
    let size_bytes = fs::metadata(&output_path)
        .map_err(|error| format!("Không đọc được output Google Flow MCP: {error}"))?
        .len();
    let sha256 = sha256_file(&output_path)?;
    Ok(ComposeGoogleFlowMcpImagesReport {
        status: "completed".to_string(),
        output_path: output_relative,
        sha256,
        size_bytes,
        duration_seconds: duration_seconds.unwrap_or(total_duration),
        message: "Đã ghép ảnh Google Flow MCP theo thứ tự shot bằng FFmpeg/FFprobe. Đây là slideshow có chuyển động camera nhẹ, không phải motion video do Flow sinh.".to_string(),
    })
}

#[tauri::command]
pub(super) async fn run_comfyui_image_generation(
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
        if task.prompt.chars().count() > 12_000 || task.negative_prompt.chars().count() > 8_000 {
            return Err("Prompt ComfyUI vượt giới hạn ký tự".to_string());
        }
        if prompt_secret_like(&task.prompt) || prompt_secret_like(&task.negative_prompt) {
            return Err(
                "Prompt ComfyUI chứa credential assignment; chỉ gửi prompt sáng tạo, không gửi khóa/token".to_string(),
            );
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
pub(super) async fn run_nanobanana_image_generation(
    request: NanoBananaImageGenerationRequest,
    state: State<'_, AppState>,
) -> Result<NanoBananaImageGenerationReport, String> {
    if !current_cloud_generation_enabled(&state)? {
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
        if task.prompt.chars().count() > 12_000 || task.negative_prompt.chars().count() > 8_000 {
            return Err("Prompt Nano Banana vượt giới hạn ký tự".to_string());
        }
        if prompt_secret_like(&task.prompt) || prompt_secret_like(&task.negative_prompt) {
            return Err(
                "Prompt Nano Banana chứa credential assignment; chỉ gửi prompt sáng tạo, không gửi khóa/token".to_string(),
            );
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
pub(super) fn read_nanobanana_image_progress(
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

pub(super) fn parse_nanobanana_cdp_endpoint(
    endpoint: &str,
) -> Result<(String, SocketAddr), String> {
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

pub(super) fn validate_nanobanana_cdp_url(endpoint: &str) -> Result<(), String> {
    parse_nanobanana_cdp_endpoint(endpoint).map(|_| ())
}

pub(super) fn nanobanana_cdp_preflight(endpoint: &str) -> NanoBananaCdpPreflightReport {
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

pub(super) fn classify_nanobanana_report(raw_report: &Value) -> (Option<String>, Option<String>) {
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

pub(super) fn comfy_ui_health_check(endpoint: &str) -> ComfyUiHealthReport {
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
pub(super) fn check_comfyui_health(
    endpoint: Option<String>,
) -> Result<ComfyUiHealthReport, String> {
    let endpoint = endpoint.unwrap_or_else(|| "http://127.0.0.1:8188".to_string());
    valid_text(&endpoint, "ComfyUI endpoint")?;
    Ok(comfy_ui_health_check(&endpoint))
}
