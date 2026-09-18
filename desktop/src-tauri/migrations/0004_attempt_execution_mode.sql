ALTER TABLE job_attempts
  ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'external_process'
  CHECK (execution_mode IN ('external_process', 'in_process_mock'));

CREATE INDEX IF NOT EXISTS idx_job_attempts_execution_mode ON job_attempts(execution_mode);
