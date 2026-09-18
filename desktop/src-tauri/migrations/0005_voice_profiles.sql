CREATE TABLE IF NOT EXISTS voice_profiles (
  voice_profile_id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('clone', 'design')),
  model_id TEXT NOT NULL,
  language TEXT NOT NULL,
  instruct TEXT,
  reference_audio_path TEXT,
  reference_audio_sha256 TEXT,
  reference_audio_duration_seconds REAL,
  reference_audio_sample_rate INTEGER,
  reference_transcript TEXT,
  rights_status TEXT NOT NULL DEFAULT 'pending' CHECK (rights_status IN ('pending', 'personal', 'owned', 'licensed', 'restricted', 'blocked')),
  commercial_use TEXT NOT NULL DEFAULT 'restricted' CHECK (commercial_use IN ('allowed', 'restricted', 'unknown', 'not_allowed')),
  clone_consent INTEGER NOT NULL DEFAULT 0 CHECK (clone_consent IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'needs_consent', 'ready', 'failed', 'rights_blocked', 'deleted')),
  last_preview_path TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS voice_synthesis_jobs (
  synthesis_id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  voice_profile_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'validating', 'running', 'succeeded', 'failed', 'cancelled', 'blocked')),
  request_path TEXT,
  output_path TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
  FOREIGN KEY (voice_profile_id) REFERENCES voice_profiles(voice_profile_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_voice_profiles_project_status ON voice_profiles(project_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_voice_synthesis_project ON voice_synthesis_jobs(project_id, created_at);
