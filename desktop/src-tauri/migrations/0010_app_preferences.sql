CREATE TABLE IF NOT EXISTS app_preferences (
  preference_key TEXT PRIMARY KEY NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO app_preferences(preference_key, enabled, updated_at)
SELECT
  'cloud_generation_enabled',
  CASE WHEN event_type = 'cloud_generation.enabled' THEN 1 ELSE 0 END,
  created_at
FROM audit_events
WHERE subject_type = 'provider_gate'
  AND event_type IN ('cloud_generation.enabled', 'cloud_generation.disabled')
ORDER BY created_at DESC, event_id DESC
LIMIT 1;
