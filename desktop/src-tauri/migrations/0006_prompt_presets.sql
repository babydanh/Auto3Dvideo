CREATE TABLE IF NOT EXISTS prompt_presets (
  preset_id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT 'project' CHECK (scope IN ('project', 'user')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  version TEXT NOT NULL,
  template TEXT NOT NULL,
  variable_keys_json TEXT NOT NULL DEFAULT '[]',
  negative_template TEXT NOT NULL DEFAULT '',
  provider_targets_json TEXT NOT NULL DEFAULT '[]',
  style_bible_id TEXT,
  rights_license_note TEXT NOT NULL DEFAULT '',
  parent_preset_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
  FOREIGN KEY (parent_preset_id) REFERENCES prompt_presets(preset_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_prompt_presets_project_status_updated
  ON prompt_presets(project_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_prompt_presets_parent
  ON prompt_presets(parent_preset_id, version);
