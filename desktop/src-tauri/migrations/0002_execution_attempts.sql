CREATE TABLE IF NOT EXISTS job_attempts (
  attempt_id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1 AND attempt_number <= 10),
  state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'succeeded', 'failed', 'cancel_requested', 'cancelled', 'expired', 'blocked', 'reconciliation_required')),
  worker_id TEXT,
  executable_id TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  heartbeat_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  cancellation_requested_at TEXT,
  termination_mode TEXT NOT NULL DEFAULT 'none' CHECK (termination_mode IN ('none', 'cooperative', 'tree_soft', 'tree_force')),
  timeout_seconds INTEGER NOT NULL CHECK (timeout_seconds >= 1 AND timeout_seconds <= 604800),
  max_log_bytes INTEGER NOT NULL CHECK (max_log_bytes >= 1024 AND max_log_bytes <= 104857600),
  stdout_bytes INTEGER NOT NULL DEFAULT 0 CHECK (stdout_bytes >= 0 AND stdout_bytes <= 1073741824),
  stderr_bytes INTEGER NOT NULL DEFAULT 0 CHECK (stderr_bytes >= 0 AND stderr_bytes <= 1073741824),
  process_started INTEGER NOT NULL DEFAULT 0 CHECK (process_started IN (0, 1)),
  external_side_effect_unknown INTEGER NOT NULL DEFAULT 0 CHECK (external_side_effect_unknown IN (0, 1)),
  retryable INTEGER NOT NULL DEFAULT 0 CHECK (retryable IN (0, 1)),
  error_code TEXT,
  redacted_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(job_id, attempt_number),
  FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS job_outputs (
  output_id TEXT PRIMARY KEY NOT NULL,
  attempt_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('video', 'audio', 'image', 'subtitle', 'thumbnail', 'metadata', 'image_sequence')),
  content_hash TEXT,
  size_bytes INTEGER CHECK (size_bytes IS NULL OR (size_bytes >= 0 AND size_bytes <= 10737418240)),
  validation_state TEXT NOT NULL CHECK (validation_state IN ('pending', 'valid', 'invalid', 'missing', 'not_checked')),
  validation_message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (attempt_id) REFERENCES job_attempts(attempt_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_attempts_job_state ON job_attempts(job_id, state);
CREATE INDEX IF NOT EXISTS idx_job_attempts_lease ON job_attempts(lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_job_outputs_attempt ON job_outputs(attempt_id);
