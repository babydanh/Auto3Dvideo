"""Run the pinned gflow-cli interactive login and return a redacted result."""

from __future__ import annotations

import contextlib
import io
import json
import os
import re
import sys
from pathlib import Path


def _redact(value: str) -> str:
    value = re.sub(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", "[account]", value, flags=re.IGNORECASE)
    return value[-5000:]


_SAFE_AUTH_EVENT_FIELDS = {
    "auth_login_launch_failed": ("strategy", "error"),
    "auth_login_subprocess_fallback": ("strategy", "reason"),
    "auth_flow_session_probe_error": ("source", "error"),
    "auth_flow_session_unexpected_response": ("source", "status_code"),
    "auth_flow_session_unverified": ("strategy", "outcome"),
    "auth_login_webdriver_probe_failed": ("strategy", "error"),
    "auth_profile_marker_missing": ("source",),
}
_SAFE_AUTH_VALUE = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")


def _safe_auth_diagnostics(output: str) -> str:
    diagnostics = []
    for line in output.splitlines():
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(record, dict):
            continue
        event = record.get("event")
        fields = _SAFE_AUTH_EVENT_FIELDS.get(event) if isinstance(event, str) else None
        if fields is None:
            continue
        values = [
            f"{key}={value}"
            for key in fields
            if isinstance((value := record.get(key)), (str, int))
            and not isinstance(value, bool)
            and _SAFE_AUTH_VALUE.fullmatch(str(value))
        ]
        diagnostics.append(event + (f" ({', '.join(values)})" if values else ""))
    return "; ".join(diagnostics[-4:])


def _login_failure_message(output: str) -> str:
    diagnostics = _safe_auth_diagnostics(output)
    if diagnostics:
        return f"gflow-cli login failed; safe diagnostics: {diagnostics}"
    return "gflow-cli login failed; no safe structured diagnostic was emitted."


def _emit_json_line(payload: dict[str, str]) -> None:
    print(json.dumps(payload, ensure_ascii=True))


def main() -> int:
    source = Path(os.environ.get("AUTO3DVIDEO_GFLOWSOURCE", "")).resolve()
    site = Path(os.environ.get("AUTO3DVIDEO_GFLOWSITE", "")).resolve()
    if not (source / "gflow_cli" / "cli.py").is_file() or not (site / "click" / "__init__.py").is_file():
        _emit_json_line({"status": "fail", "message": "gflow-cli runtime chưa được cài đầy đủ"})
        return 1
    sys.path.insert(0, str(site))
    sys.path.insert(0, str(source))
    captured = io.StringIO()
    exit_code = 0
    try:
        from gflow_cli.cli import main as gflow_main

        with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
            gflow_main(args=["auth", "login", "--browser", "chrome", "--profile", "auto3dvideo"], standalone_mode=False)
    except SystemExit as exc:
        exit_code = int(exc.code or 0)
    except Exception as exc:
        exit_code = 1
        captured.write(f"\n{type(exc).__name__}: {exc}")

    raw_output = captured.getvalue()
    status = "success" if exit_code == 0 else "fail"
    if exit_code:
        output = _login_failure_message(raw_output)
    else:
        output = _redact(raw_output)
        if not output.strip():
            output = "Google Flow login hoàn tất."
    _emit_json_line({"status": status, "message": output})
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
