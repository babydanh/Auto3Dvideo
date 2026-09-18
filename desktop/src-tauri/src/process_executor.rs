use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Component, Path};

const MAX_ARGUMENTS: usize = 64;
const MAX_ARGUMENT_LENGTH: usize = 4096;
const MAX_TOTAL_ARGUMENT_BYTES: usize = 32 * 1024;
const MAX_ENVIRONMENT_VALUE_LENGTH: usize = 4096;
const MAX_TIMEOUT_SECONDS: u64 = 604_800;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProcessSpec {
    pub executable_id: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub working_directory: String,
    #[serde(default)]
    pub environment: BTreeMap<String, String>,
    pub timeout_seconds: u64,
    #[serde(default)]
    pub expected_outputs: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessDryRunPlan {
    pub executable_id: String,
    pub allowlisted_binary_name: String,
    pub argument_count: usize,
    pub argument_lengths: Vec<usize>,
    pub working_directory: String,
    pub environment_keys: Vec<String>,
    pub expected_outputs: Vec<String>,
    pub timeout_seconds: u64,
    pub process_started: bool,
    pub side_effects_blocked: bool,
    pub policy_messages: Vec<String>,
}

struct AllowlistedExecutable {
    id: &'static str,
    binary_name: &'static str,
}

const ALLOWLIST: &[AllowlistedExecutable] = &[
    AllowlistedExecutable {
        id: "blender",
        binary_name: "blender.exe",
    },
    AllowlistedExecutable {
        id: "ffmpeg",
        binary_name: "ffmpeg.exe",
    },
    AllowlistedExecutable {
        id: "ffprobe",
        binary_name: "ffprobe.exe",
    },
    AllowlistedExecutable {
        id: "node",
        binary_name: "node.exe",
    },
    AllowlistedExecutable {
        id: "obs",
        binary_name: "obs64.exe",
    },
    AllowlistedExecutable {
        id: "python",
        binary_name: "python.exe",
    },
    AllowlistedExecutable {
        id: "yt-dlp",
        binary_name: "yt-dlp.exe",
    },
    AllowlistedExecutable {
        id: "obscura",
        binary_name: "obscura.exe",
    },
];

fn reject_secret_like_text(value: &str, field: &str) -> Result<(), String> {
    let lower = value.to_ascii_lowercase();
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
    if markers.iter().any(|marker| lower.contains(marker))
        || lower.starts_with("sk-")
        || lower.starts_with("key_")
    {
        return Err(format!(
            "{field} không được chứa secret hoặc credential value"
        ));
    }
    Ok(())
}

fn validate_relative_project_path(value: &str, field: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field} không được rỗng"));
    }
    if trimmed.contains('\0') {
        return Err(format!("{field} chứa NUL byte"));
    }

    let slash_normalized = trimmed.replace('\\', "/");
    if slash_normalized.starts_with('/')
        || slash_normalized.starts_with("//")
        || slash_normalized.as_bytes().get(1) == Some(&b':')
    {
        return Err(format!(
            "{field} phải là đường dẫn tương đối trong workspace"
        ));
    }

    let path = Path::new(trimmed);
    if path
        .components()
        .any(|component| component == Component::ParentDir)
        || slash_normalized.split('/').any(|part| part == "..")
    {
        return Err(format!("{field} không được vượt ra ngoài workspace"));
    }
    Ok(trimmed.to_string())
}

fn validate_expected_output(value: &str) -> Result<String, String> {
    let output = validate_relative_project_path(value, "expected output")?;
    if output.len() > 1024 {
        return Err("expected output quá dài".to_string());
    }
    Ok(output)
}

fn validate_argument(value: &str, index: usize) -> Result<(), String> {
    if value.len() > MAX_ARGUMENT_LENGTH {
        return Err(format!("argument {index} vượt quá giới hạn kích thước"));
    }
    if value.contains('\0') {
        return Err(format!("argument {index} chứa NUL byte"));
    }
    reject_secret_like_text(value, &format!("argument {index}"))
}

fn validate_environment(environment: &BTreeMap<String, String>) -> Result<Vec<String>, String> {
    let mut keys = Vec::with_capacity(environment.len());
    for (key, value) in environment {
        if !key.starts_with("AUTO3DVIDEO_")
            || key.len() > 128
            || !key.chars().all(|character| {
                character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_'
            })
        {
            return Err(format!("environment key không được allowlist: {key}"));
        }
        if ["_API_KEY", "_TOKEN", "_SECRET", "_PASSWORD", "_CREDENTIAL"]
            .iter()
            .any(|suffix| key.ends_with(suffix))
        {
            return Err(format!(
                "environment key nhạy cảm không được truyền qua worker: {key}"
            ));
        }
        if value.len() > MAX_ENVIRONMENT_VALUE_LENGTH {
            return Err(format!("environment value quá dài cho key {key}"));
        }
        reject_secret_like_text(value, &format!("environment {key}"))?;
        keys.push(key.clone());
    }
    Ok(keys)
}

fn find_allowlisted_executable(executable_id: &str) -> Option<&'static AllowlistedExecutable> {
    ALLOWLIST.iter().find(|item| item.id == executable_id)
}

pub fn plan_process_dry_run(spec: ProcessSpec) -> Result<ProcessDryRunPlan, String> {
    let executable_id = spec.executable_id.trim();
    let executable = find_allowlisted_executable(executable_id)
        .ok_or_else(|| format!("Executable chưa được allowlist: {executable_id}"))?;
    if executable_id != spec.executable_id {
        return Err("executableId không được có khoảng trắng đầu/cuối".to_string());
    }

    if spec.args.len() > MAX_ARGUMENTS {
        return Err(format!("Số lượng arguments vượt quá {MAX_ARGUMENTS}"));
    }
    let total_argument_bytes: usize = spec.args.iter().map(String::len).sum();
    if total_argument_bytes > MAX_TOTAL_ARGUMENT_BYTES {
        return Err("Tổng kích thước arguments vượt quá giới hạn".to_string());
    }
    for (index, argument) in spec.args.iter().enumerate() {
        validate_argument(argument, index)?;
    }

    let working_directory =
        validate_relative_project_path(&spec.working_directory, "workingDirectory")?;
    let environment_keys = validate_environment(&spec.environment)?;
    if spec.timeout_seconds == 0 || spec.timeout_seconds > MAX_TIMEOUT_SECONDS {
        return Err(format!(
            "timeoutSeconds phải nằm trong khoảng 1..={MAX_TIMEOUT_SECONDS}"
        ));
    }
    let expected_outputs = spec
        .expected_outputs
        .iter()
        .map(|output| validate_expected_output(output))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(ProcessDryRunPlan {
        executable_id: executable.id.to_string(),
        allowlisted_binary_name: executable.binary_name.to_string(),
        argument_count: spec.args.len(),
        argument_lengths: spec.args.iter().map(String::len).collect(),
        working_directory,
        environment_keys,
        expected_outputs,
        timeout_seconds: spec.timeout_seconds,
        process_started: false,
        side_effects_blocked: true,
        policy_messages: vec![
            "Dry-run chỉ validate plan; không spawn process và không ghi output.".to_string(),
            "Binary path thật phải được resolve từ allowlist cấu hình ở execution slice."
                .to_string(),
            "Credential value không được truyền qua arguments hoặc environment.".to_string(),
        ],
    })
}

#[cfg(test)]
mod tests {
    use super::{plan_process_dry_run, ProcessSpec};
    use std::collections::BTreeMap;

    fn valid_spec() -> ProcessSpec {
        ProcessSpec {
            executable_id: "ffmpeg".to_string(),
            args: vec!["-version".to_string()],
            working_directory: "jobs/job-001".to_string(),
            environment: BTreeMap::new(),
            timeout_seconds: 60,
            expected_outputs: vec!["preview.mp4".to_string()],
        }
    }

    #[test]
    fn dry_run_never_starts_process() {
        let plan = plan_process_dry_run(valid_spec()).expect("valid dry-run spec");
        assert!(!plan.process_started);
        assert!(plan.side_effects_blocked);
    }

    #[test]
    fn rejects_unknown_executable() {
        let mut spec = valid_spec();
        spec.executable_id = "powershell".to_string();
        assert!(plan_process_dry_run(spec).is_err());
    }

    #[test]
    fn rejects_path_traversal() {
        let mut spec = valid_spec();
        spec.working_directory = "jobs/../outside".to_string();
        assert!(plan_process_dry_run(spec).is_err());
    }

    #[test]
    fn rejects_secret_in_argument() {
        let mut spec = valid_spec();
        spec.args = vec!["api_key=do-not-use".to_string()];
        assert!(plan_process_dry_run(spec).is_err());
    }

    #[test]
    fn rejects_non_allowlisted_environment_key() {
        let mut spec = valid_spec();
        spec.environment
            .insert("PATH".to_string(), "unsafe".to_string());
        assert!(plan_process_dry_run(spec).is_err());
    }

    #[test]
    fn rejects_sensitive_environment_key() {
        let mut spec = valid_spec();
        spec.environment.insert(
            "AUTO3DVIDEO_PROVIDER_API_KEY".to_string(),
            "secret-value".to_string(),
        );
        assert!(plan_process_dry_run(spec).is_err());
    }
}

#[cfg(test)]
mod path_tests {
    use super::{plan_process_dry_run, ProcessSpec};
    use std::collections::BTreeMap;

    #[test]
    fn rejects_absolute_windows_path() {
        let spec = ProcessSpec {
            executable_id: "blender".to_string(),
            args: Vec::new(),
            working_directory: "C:\\Windows".to_string(),
            environment: BTreeMap::new(),
            timeout_seconds: 60,
            expected_outputs: Vec::new(),
        };
        assert!(plan_process_dry_run(spec).is_err());
    }
}
