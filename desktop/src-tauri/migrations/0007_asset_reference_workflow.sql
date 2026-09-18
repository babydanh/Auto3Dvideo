CREATE TABLE IF NOT EXISTS asset_library (
    asset_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    media_kind TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    width INTEGER,
    height INTEGER,
    duration_seconds REAL,
    status TEXT NOT NULL CHECK (status IN ('ready', 'quarantined', 'missing', 'archived')),
    rights_status TEXT NOT NULL CHECK (rights_status IN ('unknown', 'pending', 'personal', 'owned', 'licensed', 'public_domain', 'restricted', 'rejected')),
    source_uri TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    UNIQUE(project_id, sha256, relative_path),
    FOREIGN KEY (project_id) REFERENCES projects(project_id)
);

CREATE INDEX IF NOT EXISTS idx_asset_library_project_status_updated
    ON asset_library(project_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS reference_sets (
    reference_set_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('sequence', 'character', 'object', 'world', 'shot')),
    status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
    continuity_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    UNIQUE(project_id, name),
    FOREIGN KEY (project_id) REFERENCES projects(project_id)
);

CREATE INDEX IF NOT EXISTS idx_reference_sets_project_status_updated
    ON reference_sets(project_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS reference_set_assignments (
    assignment_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    reference_set_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('identity', 'composition', 'pose', 'camera', 'style', 'start_frame', 'end_frame', 'negative')),
    strength REAL NOT NULL DEFAULT 1.0 CHECK (strength >= 0.0 AND strength <= 1.0),
    priority INTEGER NOT NULL DEFAULT 0 CHECK (priority >= 0),
    shot_id TEXT,
    shot_range_start INTEGER,
    shot_range_end INTEGER,
    crop TEXT,
    notes TEXT NOT NULL DEFAULT '',
    approved INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0, 1)),
    asset_sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(reference_set_id, asset_id, role, shot_id),
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    FOREIGN KEY (reference_set_id) REFERENCES reference_sets(reference_set_id) ON DELETE CASCADE,
    FOREIGN KEY (asset_id) REFERENCES asset_library(asset_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_reference_assignments_set_priority
    ON reference_set_assignments(reference_set_id, priority DESC, created_at ASC);
