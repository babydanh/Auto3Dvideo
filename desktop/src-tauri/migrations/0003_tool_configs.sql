CREATE TABLE IF NOT EXISTS tool_configs (
  tool_id TEXT PRIMARY KEY NOT NULL,
  executable_ref TEXT NOT NULL CHECK (length(executable_ref) >= 1 AND length(executable_ref) <= 1024),
  required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tool_configs_required ON tool_configs(required, tool_id);

