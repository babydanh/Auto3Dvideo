use crate::process_executor::{plan_process_dry_run, ProcessSpec};
use serde::Serialize;
use std::{
    fs,
    path::{Component, Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::{Child, Command};

const MAX_LOG_BYTES: usize = 1_048_576;
const CANCEL_POLL_MILLIS: u64 = 50;

#[derive(Debug)]
pub struct ExternalProcessRequest {
    pub spec: ProcessSpec,
    pub executable_path: PathBuf,
    pub absolute_working_directory: PathBuf,
    pub output_root: PathBuf,
    pub cancellation: Arc<AtomicBool>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OutputEvidence {
    pub relative_path: String,
    pub size_bytes: Option<u64>,
    pub validation_state: String,
    pub validation_message: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExternalProcessResult {
    pub executable_id: String,
    pub exit_code: Option<i32>,
    pub succeeded: bool,
    pub timed_out: bool,
    pub cancelled: bool,
    pub termination_mode: String,
    pub stdout: String,
    pub stderr: String,
    pub stdout_bytes: usize,
    pub stderr_bytes: usize,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    pub external_side_effect_unknown: bool,
    pub output_evidence: Vec<OutputEvidence>,
}

#[derive(Debug)]
struct BoundedLog {
    text: String,
    total_bytes: usize,
    truncated: bool,
}

pub async fn run_external_process(
    request: ExternalProcessRequest,
) -> Result<ExternalProcessResult, String> {
    let dry_run = plan_process_dry_run(request.spec.clone())?;
    validate_runtime_paths(
        &request.spec,
        &dry_run.allowlisted_binary_name,
        &request.executable_path,
        &request.absolute_working_directory,
    )?;

    let mut command = Command::new(&request.executable_path);
    command
        .args(&request.spec.args)
        .current_dir(&request.absolute_working_directory)
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // Keep the child environment deterministic while preserving only OS runtime
    // values required by Python/Windows networking and native DLL lookup. These
    // keys are never accepted from ProcessSpec and are copied only from the parent.
    for key in [
        "SystemRoot",
        "WINDIR",
        "PATH",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "LOCALAPPDATA",
        "PROGRAMDATA",
    ] {
        if let Ok(value) = std::env::var(key) {
            command.env(key, value);
        }
    }
    for (key, value) in &request.spec.environment {
        command.env(key, value);
    }
    configure_no_window(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| format!("Không spawn được executable allowlist: {error}"))?;
    let process_tree = ProcessTreeGuard::attach(&child).map_err(|error| {
        let _ = child.start_kill();
        error
    })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Không lấy được stdout pipe".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Không lấy được stderr pipe".to_string())?;
    let stdout_task = tokio::spawn(read_bounded(stdout));
    let stderr_task = tokio::spawn(read_bounded(stderr));

    let cancellation = wait_for_cancellation(request.cancellation.clone());
    tokio::pin!(cancellation);
    let timeout = tokio::time::sleep(Duration::from_secs(request.spec.timeout_seconds));
    tokio::pin!(timeout);

    let mut timed_out = false;
    let mut cancelled = false;
    let status = tokio::select! {
        result = child.wait() => result.map_err(|error| format!("Không đọc được exit status: {error}"))?,
        _ = &mut timeout => {
            timed_out = true;
            process_tree.terminate();
            let _ = child.kill().await;
            child.wait().await.map_err(|error| format!("Không đọc được exit status sau timeout: {error}"))?
        }
        _ = &mut cancellation => {
            cancelled = true;
            process_tree.terminate();
            let _ = child.kill().await;
            child.wait().await.map_err(|error| format!("Không đọc được exit status sau cancellation: {error}"))?
        }
    };

    let stdout = stdout_task
        .await
        .map_err(|error| format!("stdout task lỗi: {error}"))??;
    let stderr = stderr_task
        .await
        .map_err(|error| format!("stderr task lỗi: {error}"))??;
    let termination_mode = if timed_out || cancelled {
        "tree_force".to_string()
    } else {
        "none".to_string()
    };
    let output_evidence =
        validate_output_files(&request.output_root, &request.spec.expected_outputs)?;
    let outputs_valid = output_evidence
        .iter()
        .all(|output| output.validation_state == "valid");
    let succeeded = !timed_out && !cancelled && status.success() && outputs_valid;
    Ok(ExternalProcessResult {
        executable_id: request.spec.executable_id,
        exit_code: status.code(),
        succeeded,
        timed_out,
        cancelled,
        termination_mode,
        stdout: redact_log(&stdout.text),
        stderr: redact_log(&stderr.text),
        stdout_bytes: stdout.total_bytes,
        stderr_bytes: stderr.total_bytes,
        stdout_truncated: stdout.truncated,
        stderr_truncated: stderr.truncated,
        external_side_effect_unknown: timed_out || cancelled,
        output_evidence,
    })
}

pub fn validate_output_files(
    workspace_root: &Path,
    expected_outputs: &[String],
) -> Result<Vec<OutputEvidence>, String> {
    let canonical_root = fs::canonicalize(workspace_root)
        .map_err(|error| format!("Không canonicalize được output workspace: {error}"))?;
    let mut evidence = Vec::with_capacity(expected_outputs.len());
    for relative in expected_outputs {
        let path = Path::new(relative);
        if path.is_absolute()
            || path
                .components()
                .any(|component| component == Component::ParentDir)
        {
            return Err(format!("Output path không an toàn: {relative}"));
        }
        let candidate = canonical_root.join(path);
        if !candidate.is_file() {
            evidence.push(OutputEvidence {
                relative_path: relative.clone(),
                size_bytes: None,
                validation_state: "missing".to_string(),
                validation_message: Some("Output file không tồn tại".to_string()),
            });
            continue;
        }
        let canonical_output = fs::canonicalize(&candidate)
            .map_err(|error| format!("Không canonicalize được output {relative}: {error}"))?;
        if !canonical_output.starts_with(&canonical_root) {
            return Err(format!("Output path vượt workspace: {relative}"));
        }
        let size_bytes = fs::metadata(&canonical_output)
            .map_err(|error| format!("Không đọc được output {relative}: {error}"))?
            .len();
        let (validation_state, validation_message) = if size_bytes == 0 {
            ("invalid".to_string(), Some("Output file rỗng".to_string()))
        } else {
            ("valid".to_string(), None)
        };
        evidence.push(OutputEvidence {
            relative_path: relative.clone(),
            size_bytes: Some(size_bytes),
            validation_state,
            validation_message,
        });
    }
    Ok(evidence)
}

fn redact_log(text: &str) -> String {
    let markers = [
        "api_key=",
        "apikey=",
        "access_token=",
        "authorization=",
        "bearer ",
        "client_secret=",
        "password=",
        "secret=",
        "token=",
    ];
    let mut redacted = text.to_string();
    for marker in markers {
        let mut search_from = 0_usize;
        loop {
            let lower = redacted.to_ascii_lowercase();
            let Some(relative_start) = lower[search_from..].find(marker) else {
                break;
            };
            let start = search_from + relative_start;
            let value_start = start + marker.len();
            let value_end = redacted[value_start..]
                .char_indices()
                .find(|(_, character)| character.is_whitespace())
                .map(|(index, _)| value_start + index)
                .unwrap_or(redacted.len());
            redacted.replace_range(value_start..value_end, "[REDACTED]");
            search_from = value_start + "[REDACTED]".len();
        }
    }
    redacted
}

fn validate_runtime_paths(
    spec: &ProcessSpec,
    expected_binary_name: &str,
    executable_path: &Path,
    absolute_working_directory: &Path,
) -> Result<(), String> {
    if !executable_path.is_absolute() || !executable_path.is_file() {
        return Err("Executable path phải là file tuyệt đối tồn tại".to_string());
    }
    let actual_binary_name = executable_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Executable path không có tên file hợp lệ".to_string())?;
    if !actual_binary_name.eq_ignore_ascii_case(expected_binary_name) {
        return Err(format!(
            "Executable path không khớp allowlist: cần {expected_binary_name}"
        ));
    }
    if !absolute_working_directory.is_absolute() || !absolute_working_directory.is_dir() {
        return Err("Working directory tuyệt đối phải tồn tại và là thư mục".to_string());
    }
    if spec.timeout_seconds == 0 {
        return Err("Timeout phải lớn hơn 0".to_string());
    }
    Ok(())
}

async fn read_bounded<R>(mut reader: R) -> Result<BoundedLog, String>
where
    R: AsyncRead + Unpin,
{
    let mut retained = Vec::with_capacity(MAX_LOG_BYTES.min(8192));
    let mut buffer = [0_u8; 8192];
    let mut total_bytes = 0_usize;
    let mut truncated = false;
    loop {
        let read = reader
            .read(&mut buffer)
            .await
            .map_err(|error| format!("Không đọc được process log: {error}"))?;
        if read == 0 {
            break;
        }
        total_bytes = total_bytes.saturating_add(read);
        let remaining = MAX_LOG_BYTES.saturating_sub(retained.len());
        if remaining > 0 {
            retained.extend_from_slice(&buffer[..read.min(remaining)]);
        }
        if read > remaining {
            truncated = true;
        }
    }
    Ok(BoundedLog {
        text: String::from_utf8_lossy(&retained).to_string(),
        total_bytes,
        truncated,
    })
}

async fn wait_for_cancellation(cancellation: Arc<AtomicBool>) {
    while !cancellation.load(Ordering::SeqCst) {
        tokio::time::sleep(Duration::from_millis(CANCEL_POLL_MILLIS)).await;
    }
}

fn configure_no_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.as_std_mut().creation_flags(0x0800_0000);
    }
    #[cfg(not(windows))]
    let _ = command;
}

#[cfg(windows)]
struct ProcessTreeGuard {
    handle: isize,
}

#[cfg(not(windows))]
struct ProcessTreeGuard;

impl ProcessTreeGuard {
    fn attach(child: &Child) -> Result<Self, String> {
        #[cfg(windows)]
        {
            windows_job::attach(child)
        }
        #[cfg(not(windows))]
        {
            let _ = child;
            Ok(Self)
        }
    }

    fn terminate(&self) {
        #[cfg(windows)]
        windows_job::terminate(self.handle);
    }
}

#[cfg(windows)]
impl Drop for ProcessTreeGuard {
    fn drop(&mut self) {
        windows_job::close(self.handle);
    }
}

#[cfg(windows)]
mod windows_job {
    use super::Child;
    use std::{
        mem::{size_of, zeroed},
        ptr::null,
    };

    type Handle = isize;
    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: u32 = 9;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x2000;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct IoCounters {
        read_operations: u64,
        write_operations: u64,
        other_operations: u64,
        read_bytes: u64,
        write_bytes: u64,
        other_bytes: u64,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct BasicLimitInformation {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct ExtendedLimitInformation {
        basic_limit_information: BasicLimitInformation,
        io_info: IoCounters,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateJobObjectW(attributes: *mut core::ffi::c_void, name: *const u16) -> Handle;
        fn SetInformationJobObject(
            job: Handle,
            info_class: u32,
            info: *mut core::ffi::c_void,
            info_size: u32,
        ) -> i32;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
        fn OpenProcess(access: u32, inherit_handle: i32, process_id: u32) -> Handle;
        fn TerminateJobObject(job: Handle, exit_code: u32) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
    }

    pub fn attach(child: &Child) -> Result<super::ProcessTreeGuard, String> {
        let handle = unsafe { CreateJobObjectW(core::ptr::null_mut(), null()) };
        if handle == 0 {
            return Err("Không tạo được Windows Job Object".to_string());
        }
        let mut limits: ExtendedLimitInformation = unsafe { zeroed() };
        limits.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                handle,
                JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                (&mut limits as *mut ExtendedLimitInformation).cast(),
                size_of::<ExtendedLimitInformation>() as u32,
            )
        };
        if configured == 0 {
            unsafe { CloseHandle(handle) };
            return Err("Không cấu hình được Windows Job Object".to_string());
        }
        let process_id = child
            .id()
            .ok_or_else(|| "Không lấy được PID của child process".to_string())?;
        let process_handle = unsafe { OpenProcess(0x0100 | 0x0001, 0, process_id) };
        if process_handle == 0 {
            unsafe { CloseHandle(handle) };
            return Err("Không mở được process handle để gắn Job Object".to_string());
        }
        let assigned = unsafe { AssignProcessToJobObject(handle, process_handle) };
        unsafe { CloseHandle(process_handle) };
        if assigned == 0 {
            unsafe { CloseHandle(handle) };
            return Err("Không gắn process vào Windows Job Object".to_string());
        }
        Ok(super::ProcessTreeGuard { handle })
    }

    pub fn terminate(handle: Handle) {
        unsafe {
            let _ = TerminateJobObject(handle, 1);
        }
    }

    pub fn close(handle: Handle) {
        unsafe {
            let _ = CloseHandle(handle);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{read_bounded, validate_runtime_paths, MAX_LOG_BYTES};
    use crate::process_executor::ProcessSpec;
    use std::{
        collections::BTreeMap,
        fs,
        path::{Path, PathBuf},
        sync::{atomic::AtomicBool, Arc},
    };

    #[tokio::test]
    async fn bounded_log_retains_prefix_and_marks_truncation() {
        let input = vec![b'x'; MAX_LOG_BYTES + 7];
        let log = read_bounded(std::io::Cursor::new(input))
            .await
            .expect("bounded log");
        assert_eq!(log.text.len(), MAX_LOG_BYTES);
        assert_eq!(log.total_bytes, MAX_LOG_BYTES + 7);
        assert!(log.truncated);
    }

    #[test]
    fn output_evidence_rejects_traversal_and_accepts_nonempty_file() {
        let root = std::env::temp_dir().join("auto3dvideo-output-test");
        let _ = fs::create_dir_all(&root);
        fs::write(root.join("valid.mp4"), b"fixture").expect("fixture output");
        let evidence = super::validate_output_files(&root, &["valid.mp4".to_string()])
            .expect("valid output evidence");
        assert_eq!(evidence[0].validation_state, "valid");
        assert!(super::validate_output_files(&root, &["../outside.mp4".to_string()]).is_err());
        let _ = fs::remove_file(root.join("valid.mp4"));
        let _ = fs::remove_dir(&root);
    }

    #[test]
    fn logs_redact_credential_shaped_values() {
        assert_eq!(
            super::redact_log("token=secret-value ok"),
            "token=[REDACTED] ok"
        );
    }

    fn python_path() -> PathBuf {
        std::env::var_os("PATH")
            .into_iter()
            .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
            .map(|directory| directory.join("python.exe"))
            .find(|path| path.is_file())
            .expect("python.exe in PATH for external worker tests")
    }

    #[tokio::test]
    async fn direct_worker_runs_allowlisted_process_without_shell() {
        let root = std::env::temp_dir().join("auto3dvideo-external-worker-run");
        let _ = fs::create_dir_all(&root);
        let python = python_path();
        let spec = ProcessSpec {
            executable_id: "python".to_string(),
            args: vec!["--version".to_string()],
            working_directory: ".".to_string(),
            environment: BTreeMap::new(),
            timeout_seconds: 10,
            expected_outputs: Vec::new(),
        };
        let result = super::run_external_process(super::ExternalProcessRequest {
            spec,
            executable_path: python,
            absolute_working_directory: root.clone(),
            output_root: root.clone(),
            cancellation: Arc::new(AtomicBool::new(false)),
        })
        .await
        .expect("direct worker");
        assert!(result.succeeded);
        assert!(!result.external_side_effect_unknown);
        assert_eq!(result.termination_mode, "none");
        assert!(!result.stdout_truncated);
        assert!(!result.stderr_truncated);
        let _ = fs::remove_dir(&root);
    }

    #[tokio::test]
    async fn direct_worker_terminates_on_timeout() {
        let root = std::env::temp_dir().join("auto3dvideo-external-worker-timeout");
        let _ = fs::create_dir_all(&root);
        let python = python_path();
        let spec = ProcessSpec {
            executable_id: "python".to_string(),
            args: vec!["-c".to_string(), "import time; time.sleep(5)".to_string()],
            working_directory: ".".to_string(),
            environment: BTreeMap::new(),
            timeout_seconds: 1,
            expected_outputs: Vec::new(),
        };
        let result = super::run_external_process(super::ExternalProcessRequest {
            spec,
            executable_path: python,
            absolute_working_directory: root.clone(),
            output_root: root.clone(),
            cancellation: Arc::new(AtomicBool::new(false)),
        })
        .await
        .expect("timeout worker");
        assert!(!result.succeeded);
        assert!(result.timed_out);
        assert!(!result.cancelled);
        assert_eq!(result.termination_mode, "tree_force");
        assert!(result.external_side_effect_unknown);
        let _ = fs::remove_dir(&root);
    }

    #[test]
    fn runtime_path_requires_matching_allowlisted_binary_name() {
        let temp = std::env::temp_dir().join("auto3dvideo-worker-test");
        let _ = fs::create_dir_all(&temp);
        let executable = temp.join("ffmpeg.exe");
        fs::write(&executable, b"fixture").expect("fixture executable");
        let spec = ProcessSpec {
            executable_id: "ffmpeg".to_string(),
            args: Vec::new(),
            working_directory: "jobs/test".to_string(),
            environment: BTreeMap::new(),
            timeout_seconds: 60,
            expected_outputs: Vec::new(),
        };
        assert!(validate_runtime_paths(&spec, "ffmpeg.exe", &executable, &temp).is_ok());
        assert!(validate_runtime_paths(&spec, "ffprobe.exe", &executable, &temp).is_err());
        let _ = fs::remove_file(&executable);
        let _ = fs::remove_dir(&temp);
        let _: PathBuf = temp;
        assert!(Path::new("ffmpeg.exe").file_name().is_some());
    }
}
