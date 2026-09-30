from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

WORKER = Path(__file__).with_name("gflow_cli_worker.py")


def _legacy_codepage_environment() -> dict[str, str]:
    environment = os.environ.copy()
    environment["PYTHONIOENCODING"] = "cp1252"
    environment["PYTHONUTF8"] = "0"
    return environment


def test_json_protocol_preserves_vietnamese_under_cp1252() -> None:
    import_line = f"sys.path.insert(0, {str(WORKER.parent)!r})"
    code = (
        "import sys; "
        f"{import_line}; "
        "from gflow_cli_worker import _emit_json_line; "
        "from gflow_cli_auth_worker import _emit_json_line as emit_auth_json_line; "
        "_emit_json_line({'status': 'ok', 'message': 'Bước hoàn tất'}); "
        "_emit_json_line({'status': 'fail', 'error': {'code': 'WORKER_ERROR', 'message': 'Không thể xử lý'}}); "
        "emit_auth_json_line({'status': 'success', 'message': 'Đăng nhập Google Flow'})"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        env=_legacy_codepage_environment(),
        timeout=10,
        check=False,
    )

    assert result.returncode == 0, result.stderr.decode("ascii", errors="replace")
    reports = [json.loads(line) for line in result.stdout.decode("ascii").splitlines()]
    assert reports == [
        {"status": "ok", "message": "Bước hoàn tất"},
        {"status": "fail", "error": {"code": "WORKER_ERROR", "message": "Không thể xử lý"}},
        {"status": "success", "message": "Đăng nhập Google Flow"},
    ]


def test_worker_entrypoint_keeps_vietnamese_error_json_under_cp1252() -> None:
    result = subprocess.run(
        [sys.executable, str(WORKER)],
        capture_output=True,
        env=_legacy_codepage_environment(),
        timeout=10,
        check=False,
    )

    assert result.returncode == 1
    report = json.loads(result.stdout.decode("ascii"))
    assert report["status"] == "fail"
    assert report["error"]["code"] == "GFLOW_WORKER_ERROR"
    assert report["error"]["message"].startswith("Cú pháp:")


def test_auth_status_probe_error_is_not_labeled_missing_login() -> None:
    from gflow_cli_worker import _auth_status_failure

    message, code = _auth_status_failure(
        "auto3dvideo",
        {"status": "error", "error": "OSError"},
        "Could not verify the Flow session. Check network connectivity and retry.",
    )

    assert code == "GFLOW_AUTH_UNVERIFIED"
    assert "chưa xác minh được phiên Flow" in message
    assert "chưa gửi yêu cầu tạo video" in message
    assert "Check network connectivity and retry" in message
    assert "chưa xác thực Flow" not in message




def test_auth_login_reports_only_allowlisted_diagnostics() -> None:
    from gflow_cli_auth_worker import _login_failure_message

    output = "\n".join(
        [
            json.dumps({
                "event": "auth_login_started",
                "profile_dir": "C:\\Users\\user\\sensitive-profile",
            }),
            json.dumps({
                "event": "auth_login_launch_failed",
                "strategy": "chrome",
                "error": "OSError",
                "cookie": "secret-cookie-value",
            }),
            json.dumps({
                "event": "auth_flow_session_probe_error",
                "source": "cookie_store",
                "error": "PermissionError",
                "token": "secret-token-value",
            }),
        ]
    )
    message = _login_failure_message(output)

    assert "auth_login_launch_failed" in message
    assert "error=OSError" in message
    assert "auth_flow_session_probe_error" in message
    assert "error=PermissionError" in message
    assert "sensitive-profile" not in message
    assert "secret-cookie-value" not in message
    assert "secret-token-value" not in message
    assert _login_failure_message("unstructured secret output") == (
        "gflow-cli login failed; no safe structured diagnostic was emitted."
    )
if __name__ == "__main__":
    test_json_protocol_preserves_vietnamese_under_cp1252()
    test_worker_entrypoint_keeps_vietnamese_error_json_under_cp1252()
    test_auth_status_probe_error_is_not_labeled_missing_login()
    test_auth_login_reports_only_allowlisted_diagnostics()
    print("gflow_cli_worker: 4 protocol/auth tests passed")
