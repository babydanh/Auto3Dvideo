# Local Workspace and Storage Layout

## Workspace principle

A project is portable and inspectable. Database metadata, media, scripts, logs, previews, delivery outputs and evidence have explicit locations. The app must not scatter hidden state across arbitrary user directories.

```text
<project-root>/
├── project.json
├── database/
│   ├── auto3dvideo.sqlite
│   └── migrations/
├── briefs/
├── episodes/
│   └── <episode-id>/
│       ├── script/
│       ├── style/
│       ├── shots/
│       ├── scenes/
│       └── timeline/
├── assets/
│   ├── references/
│   ├── images/
│   ├── videos/
│   ├── audio/
│   ├── models/
│   └── generated/
├── workflows/
├── jobs/
│   └── <job-id>/
│       ├── input/
│       ├── output/
│       ├── logs/
│       └── job.json
├── previews/
├── deliveries/
├── evidence/
├── backups/
└── .auto3dvideo/
    ├── cache/
    └── locks/
```

## Path rules

Paths stored in project records are project-relative and use forward slashes. The app resolves them against a canonical project root and rejects traversal, symlink escape and absolute-path injection. Large media is not embedded in SQLite.

## Cache rules

Caches can be deleted and rebuilt. A cache record has tool/version/input hash/config hash and created time. Approved outputs are never treated as disposable cache. Model files may live in a configured global directory but the project records their immutable identifier and source/license status.

## Backup

A backup includes project JSON, SQLite database, migrations, contracts, workflows, scripts, evidence and selected media references. Users can choose whether to include large generated media. Restore is a new workspace by default; it must not overwrite the active project silently.

## Locking

A project lock prevents two app instances from mutating the same SQLite state concurrently. Read-only inspection remains possible. Stale locks require a visible recovery decision with process/host/time evidence.

## Cleanup

Cleanup is scoped by project/job and reports what will be removed. The app retains audit evidence required by the active retention policy. Temporary files are removed only after job completion or explicit recovery decision.
