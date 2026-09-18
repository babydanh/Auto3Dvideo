PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'vi-VN',
  workspace_root TEXT NOT NULL,
  policy_profile TEXT NOT NULL DEFAULT 'safe-local',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipes (
  recipe_id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  recipe_kind TEXT NOT NULL,
  config_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS provider_profiles (
  profile_id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT,
  capability TEXT NOT NULL,
  provider_kind TEXT NOT NULL,
  model_id TEXT NOT NULL,
  endpoint_ref TEXT,
  credential_ref TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  recipe_id TEXT,
  kind TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft',
  progress REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
  FOREIGN KEY (recipe_id) REFERENCES recipes(recipe_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS assets (
  asset_id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  content_hash TEXT,
  media_kind TEXT NOT NULL,
  rights_state TEXT NOT NULL DEFAULT 'rights_pending',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS approvals (
  approval_id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT,
  reviewer TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT,
  event_type TEXT NOT NULL,
  subject_type TEXT,
  subject_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recipes_project ON recipes(project_id);
CREATE INDEX IF NOT EXISTS idx_jobs_project_state ON jobs(project_id, state);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);
CREATE INDEX IF NOT EXISTS idx_approvals_subject ON approvals(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_audit_project_created ON audit_events(project_id, created_at);
