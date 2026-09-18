CREATE TABLE IF NOT EXISTS asset_pack_sources (
    project_id TEXT NOT NULL,
    pack_id TEXT NOT NULL,
    pack_relative_path TEXT NOT NULL,
    items_relative_path TEXT NOT NULL,
    report_relative_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, pack_id),
    FOREIGN KEY (project_id) REFERENCES projects(project_id)
);

CREATE INDEX IF NOT EXISTS idx_asset_pack_sources_project_updated
    ON asset_pack_sources(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS asset_pack_item_reviews (
    project_id TEXT NOT NULL,
    pack_id TEXT NOT NULL,
    asset_item_id TEXT NOT NULL,
    review_state TEXT NOT NULL CHECK (review_state IN ('not_started', 'in_review', 'approved', 'rejected', 'needs_revision')),
    rights_status TEXT NOT NULL CHECK (rights_status IN ('unknown', 'pending', 'personal', 'owned', 'licensed', 'public_domain', 'restricted', 'rejected')),
    acceptance_checks_json TEXT NOT NULL DEFAULT '[]',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, pack_id, asset_item_id),
    FOREIGN KEY (project_id) REFERENCES projects(project_id)
);

CREATE INDEX IF NOT EXISTS idx_asset_pack_item_reviews_project_updated
    ON asset_pack_item_reviews(project_id, updated_at DESC);
