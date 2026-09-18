"""Smoke-test the P0 SQLite migration without requiring the Rust toolchain."""
from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True, type=Path)
    args = parser.parse_args()
    root = args.project.resolve()
    migration_dir = root / "desktop" / "src-tauri" / "migrations"
    migration_paths = [
        migration_dir / "0001_initial.sql",
        migration_dir / "0002_execution_attempts.sql",
        migration_dir / "0003_tool_configs.sql",
        migration_dir / "0004_attempt_execution_mode.sql",
    ]
    connection = sqlite3.connect(":memory:")
    connection.execute("PRAGMA foreign_keys = ON")
    for migration_path in migration_paths:
        connection.executescript(migration_path.read_text(encoding="utf-8"))
    tables = {
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }
    expected = {
        "schema_migrations",
        "projects",
        "recipes",
        "provider_profiles",
        "jobs",
        "assets",
        "approvals",
        "audit_events",
        "job_attempts",
        "job_outputs",
        "tool_configs",
    }
    missing = expected - tables
    if missing:
        raise SystemExit(f"missing_tables={','.join(sorted(missing))}")

    connection.execute(
        "INSERT INTO projects(project_id, name, workspace_root, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        ("project-test", "Test project", "D:/Auto3Dvideo/test", "0", "0"),
    )
    connection.execute(
        "INSERT INTO jobs(job_id, project_id, kind, state, progress, attempt_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("job-test", "project-test", "image_slideshow", "queued", 0.0, 0, "0"),
    )
    connection.execute(
        "INSERT INTO audit_events(event_id, project_id, event_type, subject_type, subject_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("event-test", "project-test", "job.pending_created", "job", "job-test", "{}", "0"),
    )
    connection.execute(
        "INSERT INTO tool_configs(tool_id, executable_ref, required, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        ("ffmpeg", "C:/Tools/ffmpeg/bin/ffmpeg.exe", 1, "0", "0"),
    )
    connection.execute(
        "INSERT INTO job_attempts(attempt_id, job_id, attempt_number, state, timeout_seconds, max_log_bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ("attempt-test", "job-test", 1, "pending", 1800, 1048576, "0", "0"),
    )
    connection.execute(
        "INSERT INTO job_outputs(output_id, attempt_id, relative_path, media_kind, validation_state, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ("output-test", "attempt-test", "preview/test.mp4", "video", "pending", "0"),
    )
    try:
        connection.execute(
            "INSERT INTO job_attempts(attempt_id, job_id, attempt_number, state, timeout_seconds, max_log_bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ("attempt-test-duplicate", "job-test", 1, "pending", 1800, 1048576, "0", "0"),
        )
    except sqlite3.IntegrityError:
        uniqueness_guard = True
    else:
        uniqueness_guard = False
    if not uniqueness_guard:
        raise SystemExit("missing_unique_job_attempt_guard")

    try:
        connection.execute(
            "INSERT INTO job_outputs(output_id, attempt_id, relative_path, media_kind, validation_state, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            ("output-orphan", "attempt-missing", "preview/orphan.mp4", "video", "pending", "0"),
        )
    except sqlite3.IntegrityError:
        foreign_key_guard = True
    else:
        foreign_key_guard = False
    if not foreign_key_guard:
        raise SystemExit("missing_foreign_key_output_guard")

    connection.commit()
    count = connection.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
    attempt_count = connection.execute("SELECT COUNT(*) FROM job_attempts").fetchone()[0]
    output_count = connection.execute("SELECT COUNT(*) FROM job_outputs").fetchone()[0]
    tool_row = connection.execute(
        "SELECT tool_id, executable_ref, required FROM tool_configs WHERE tool_id = ?",
        ("ffmpeg",),
    ).fetchone()
    execution_mode = connection.execute(
        "SELECT execution_mode FROM job_attempts WHERE attempt_id = ?",
        ("attempt-test",),
    ).fetchone()
    audit_rows = connection.execute(
        "SELECT event_id, event_type, subject_type, subject_id, created_at FROM audit_events WHERE project_id = ? ORDER BY created_at DESC",
        ("project-test",),
    ).fetchall()
    if len(audit_rows) != 1 or audit_rows[0][1:4] != ("job.pending_created", "job", "job-test"):
        raise SystemExit(f"unexpected_audit_rows={audit_rows!r}")
    if tool_row != ("ffmpeg", "C:/Tools/ffmpeg/bin/ffmpeg.exe", 1):
        raise SystemExit(f"unexpected_tool_config={tool_row!r}")
    if execution_mode != ("external_process",):
        raise SystemExit(f"unexpected_execution_mode={execution_mode!r}")
    if count != 1 or attempt_count != 1 or output_count != 1:
        raise SystemExit(f"unexpected_counts={count}/{attempt_count}/{output_count}")
    print("MIGRATION_SMOKE_TEST=PASS")
    print("tables_checked=11")
    print("attempt_output_insert=PASS")
    print("foreign_key_insert=PASS")
    print("unique_attempt_guard=PASS")
    print("orphan_output_guard=PASS")
    print("audit_metadata_read=PASS")
    print("tool_config_metadata_read=PASS")
    print("execution_mode_guard=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
