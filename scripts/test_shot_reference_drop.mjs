import assert from "node:assert/strict";
import * as dropModel from "../desktop/src/features/workspace/shotReferenceDrop.ts";
import { isShotReferenceTargetCurrent, pickCreatedShotAssignment, resolveShotReferenceCommit, shotReferenceBindingsForScript } from "../desktop/src/features/workspace/shotReferenceBindings.ts";

const { classifyShotReferenceDropPaths, physicalToCssPoint, resolveShotReferenceDropTarget, supportedShotReferenceImageExtensions } = dropModel;

// --- exactly one supported image is required -------------------------------
const single = classifyShotReferenceDropPaths(["C:/Users/me/Pictures/start frame.png"]);
assert.equal(single.ok, true, "one supported image must be accepted");
assert.equal(single.sourcePath, "C:/Users/me/Pictures/start frame.png", "the chosen path is used verbatim, including spaces");

assert.equal(classifyShotReferenceDropPaths([]).reason, "no_path");
assert.equal(classifyShotReferenceDropPaths(["   "]).reason, "no_path", "blank paths carry no file");
const many = classifyShotReferenceDropPaths(["C:/a/one.png", "C:/a/two.png"]);
assert.equal(many.reason, "multiple_paths", "a multi-file drop must never assign one of its files");
assert.match(many.message, /2 files/);
for (const extension of supportedShotReferenceImageExtensions) {
  assert.equal(classifyShotReferenceDropPaths([`/tmp/frame.${extension}`]).ok, true, `${extension} must be accepted`);
  assert.equal(classifyShotReferenceDropPaths([`/tmp/frame.${extension.toUpperCase()}`]).ok, true, "extension matching is case-insensitive");
}
for (const rejected of ["clip.mp4", "voice.mp3", "model.glb", "notes.md", "archive.zip", "noextension"]) {
  assert.equal(classifyShotReferenceDropPaths([`/tmp/${rejected}`]).reason, "unsupported_image", `${rejected} is not a shot reference image`);
}

// --- physical pixels map to CSS pixels at any DPI --------------------------
assert.deepEqual(physicalToCssPoint({ x: 125, y: 250 }, 1), { x: 125, y: 250 }, "100% scale is an identity conversion");
assert.deepEqual(physicalToCssPoint({ x: 125, y: 250 }, 1.25), { x: 100, y: 200 }, "a 125% display must divide by the webview scale");
assert.deepEqual(physicalToCssPoint({ x: 300, y: 150 }, 1.5), { x: 200, y: 100 }, "a 150% display must divide by the webview scale");
assert.deepEqual(physicalToCssPoint({ x: 12, y: 34 }, 2), { x: 6, y: 17 }, "a 200% display must divide by the webview scale");
assert.deepEqual(physicalToCssPoint({ x: 12, y: 34 }, 0), { x: 12, y: 34 }, "an unusable scale falls back to physical pixels");
assert.deepEqual(physicalToCssPoint({ x: 12, y: 34 }, Number.NaN), { x: 12, y: 34 }, "a non-finite scale falls back to physical pixels");

// --- only an explicit target resolves, and only one of them ----------------
const target = (segmentId) => ({
  closest: (selector) => (selector === "[data-shot-reference-target]" && segmentId ? { getAttribute: () => segmentId } : null),
  getAttribute: () => segmentId,
});
const noTarget = { closest: () => null, getAttribute: () => null };

assert.deepEqual(resolveShotReferenceDropTarget([noTarget]), { kind: "background" }, "empty canvas space is not a drop target");
assert.deepEqual(resolveShotReferenceDropTarget([]), { kind: "background" });
assert.deepEqual(resolveShotReferenceDropTarget([target("segment-002")]), { kind: "shot", segmentId: "segment-002" });
assert.deepEqual(
  resolveShotReferenceDropTarget([target("segment-002"), noTarget, target("segment-002")]),
  { kind: "shot", segmentId: "segment-002" },
  "a stacked drop zone still resolves to its own shot",
);
assert.deepEqual(
  resolveShotReferenceDropTarget([target("segment-002"), target("segment-005")]),
  { kind: "ambiguous" },
  "overlapping targets must never cross-bind",
);
assert.equal(target("segment-001").getAttribute(), "segment-001");

// --- one binding per stable segment id --------------------------------------
const script = { segments: [{ segmentId: "segment-001" }, { segmentId: "segment-002" }] };
const binding = (segmentId, suffix) => ({
  segmentId,
  referenceSetId: "set-1",
  assignmentId: `assignment-${suffix}`,
  assetId: `asset-${suffix}`,
  assetSha256: "a".repeat(64),
  role: "start_frame",
});
const kept = shotReferenceBindingsForScript([binding("segment-002", "old"), binding("segment-009", "ghost")], script);
assert.deepEqual(kept.map((item) => item.segmentId), ["segment-002"], "a binding for a removed segment is never carried into a save");
assert.deepEqual(shotReferenceBindingsForScript([binding("segment-001", "a")], null), [], "no script means no persistable binding");
assert.deepEqual(shotReferenceBindingsForScript([], script), []);

const reordered = { segments: [{ segmentId: "segment-002" }, { segmentId: "segment-001" }] };
assert.deepEqual(
  shotReferenceBindingsForScript([binding("segment-001", "a"), binding("segment-002", "b")], reordered).map((item) => item.assignmentId),
  ["assignment-b", "assignment-a"],
  "reordering shots keeps each binding on its own stable segment id",
);

const replaced = shotReferenceBindingsForScript(
  [...kept.filter((item) => item.segmentId !== "segment-002"), binding("segment-002", "new")],
  script,
);
assert.deepEqual(replaced.map((item) => item.assignmentId), ["assignment-new"], "a replacement never leaves two bindings on one segment");

// --- the created row is found by id difference, never by timestamp ---------
const HASH_A = "b".repeat(64);
const HASH_B = "c".repeat(64);
const assignment = (assignmentId, assetId, shotId, role, createdAt, overrides = {}) => ({
  assignmentId,
  projectId: "project-1",
  referenceSetId: "set-1",
  assetId,
  role,
  strength: 0.85,
  priority: 0,
  shotId,
  shotRangeStart: null,
  shotRangeEnd: null,
  crop: null,
  notes: "",
  approved: false,
  assetSha256: HASH_A,
  createdAt,
  updatedAt: createdAt,
  ...overrides,
});

const sameSecond = "2026-01-01T00:00:00Z";
const previous = assignment("assignment-old", "asset-a", "segment-002", "start_frame", sameSecond);
const inserted = assignment("assignment-new", "asset-b", "segment-002", "start_frame", sameSecond, { assetSha256: HASH_B });
const baselineIds = [previous.assignmentId];

// A leftover orphan from a failed cleanup shares the timestamp, so a
// timestamp-ordered pick would pick the wrong row; the id delta does not.
const withOrphan = [previous, inserted, assignment("assignment-orphan", "asset-b", "segment-002", "start_frame", sameSecond, { assetSha256: HASH_B })];
const orphanBaseline = ["assignment-old", "assignment-orphan"];
assert.equal(
  pickCreatedShotAssignment(withOrphan, orphanBaseline, "asset-b", "segment-002", HASH_B).assignment.assignmentId,
  "assignment-new",
  "an orphan left by a failed cleanup can never be adopted as the new binding",
);
assert.equal(
  pickCreatedShotAssignment(withOrphan, ["assignment-old"], "asset-b", "segment-002", HASH_B).kind,
  "ambiguous",
  "two equally matching new rows must be refused, not guessed",
);

const cleanDelta = pickCreatedShotAssignment([previous, inserted], baselineIds, "asset-b", "segment-002", HASH_B);
assert.equal(cleanDelta.kind, "found");
assert.equal(cleanDelta.assignment.assignmentId, "assignment-new");
assert.equal(
  pickCreatedShotAssignment([previous, inserted], [], "asset-b", "segment-002", HASH_B).kind,
  "found",
  "an empty baseline means every returned row counts as newly created",
);
assert.equal(
  pickCreatedShotAssignment([previous, inserted], baselineIds, "asset-b", "segment-002", HASH_A).kind,
  "missing",
  "a backend hash that differs from the imported asset is never bound",
);
assert.equal(
  pickCreatedShotAssignment([previous], baselineIds, "asset-a", "segment-002", HASH_A).kind,
  "missing",
  "a row that already existed before the insert is never treated as new",
);
assert.equal(
  pickCreatedShotAssignment([inserted, { ...inserted, assignmentId: "assignment-other-shot", shotId: "segment-001" }], baselineIds, "asset-b", "segment-002", HASH_B).assignment.assignmentId,
  "assignment-new",
  "a concurrent row for another shot does not block this shot's row",
);
assert.equal(
  pickCreatedShotAssignment([{ ...inserted, role: "identity" }], baselineIds, "asset-b", "segment-002", HASH_B).kind,
  "missing",
  "only a start_frame role can become this shot's start frame",
);
assert.equal(
  pickCreatedShotAssignment([{ ...inserted, approved: true }], baselineIds, "asset-b", "segment-002", HASH_B).kind,
  "missing",
  "an approved row is never accepted as a local, unapproved assignment",
);

// --- a target session must still be a real row of the selected project ------
const sessionsA = [
  { sessionId: "video-a", projectId: "project-1" },
  { sessionId: "video-b", projectId: "project-1" },
];
const targetA = { projectId: "project-1", sessionId: "video-a" };
const activeA = { projectId: "project-1", activeSessionId: "video-a" };
const activeB = { projectId: "project-1", activeSessionId: "video-b" };
const activeOtherProject = { projectId: "project-2", activeSessionId: "video-a" };

assert.equal(isShotReferenceTargetCurrent(targetA, activeA, sessionsA), true, "the target is current while its own session is active");
assert.equal(isShotReferenceTargetCurrent(targetA, activeB, sessionsA), false, "a session switch makes the target stale");
assert.equal(isShotReferenceTargetCurrent(targetA, activeOtherProject, sessionsA), false, "a project switch makes the target stale");
assert.equal(isShotReferenceTargetCurrent(targetA, { ...activeA, activeSessionId: null }, sessionsA), false, "no active session is never the target");
assert.equal(
  isShotReferenceTargetCurrent(targetA, activeA, [{ sessionId: "video-b", projectId: "project-1" }]),
  false,
  "a deleted session row must never be written back and recreated as a new session",
);
assert.equal(
  isShotReferenceTargetCurrent(targetA, activeA, [{ sessionId: "video-a", projectId: "project-2" }]),
  false,
  "a session id that only exists in another project is not the target",
);
assert.equal(isShotReferenceTargetCurrent(targetA, activeA, []), false, "an empty session list makes every target stale");

// --- a save result that arrives after a session switch ---------------------
// The backend really saved target A, so its binding must stand: no rollback of
// the saved binding, and no mutation of the session that became active.
const afterSwitch = resolveShotReferenceCommit({ saved: true, targetIsCurrent: false, replacesAssignment: true, targetProjectActive: true });
assert.equal(afterSwitch.kind, "keep_separate");
assert.equal(afterSwitch.liveState, "unchanged", "the newly active session's binding state must not be replaced");
assert.equal(afterSwitch.detachNewAssignment, undefined, "a verified save must never be rolled back");
assert.equal(afterSwitch.release, "release", "the same project still allows releasing the old assignment");

// A replaced assignment that could not be released must be reported as needing
// manual cleanup, not folded into the "nothing to release" case.
const afterProjectSwitch = resolveShotReferenceCommit({ saved: true, targetIsCurrent: false, replacesAssignment: true, targetProjectActive: false });
assert.equal(afterProjectSwitch.kind, "keep_separate");
assert.equal(afterProjectSwitch.liveState, "unchanged");
assert.equal(
  afterProjectSwitch.release,
  "cleanup_required",
  "the shell detaches against the selected project, so a different project leaves the old assignment for manual cleanup",
);
assert.notEqual(
  afterProjectSwitch.release,
  resolveShotReferenceCommit({ saved: true, targetIsCurrent: false, replacesAssignment: false, targetProjectActive: false }).release,
  "a replaced assignment that needs cleanup must be distinct from having nothing to release",
);

const afterSwitchWithoutReplacement = resolveShotReferenceCommit({ saved: true, targetIsCurrent: false, replacesAssignment: false, targetProjectActive: true });
assert.equal(afterSwitchWithoutReplacement.kind, "keep_separate");
assert.equal(afterSwitchWithoutReplacement.release, "not_applicable", "there is nothing to release for a first assignment");

assert.deepEqual(
  resolveShotReferenceCommit({ saved: true, targetIsCurrent: true, replacesAssignment: true, targetProjectActive: true }),
  { kind: "apply", liveState: "replace", release: "release" },
);
assert.deepEqual(
  resolveShotReferenceCommit({ saved: true, targetIsCurrent: true, replacesAssignment: false, targetProjectActive: true }),
  { kind: "apply", liveState: "replace", release: "not_applicable" },
  "a first assignment applies live state and releases nothing",
);
assert.deepEqual(
  resolveShotReferenceCommit({ saved: true, targetIsCurrent: true, replacesAssignment: true, targetProjectActive: false }),
  { kind: "apply", liveState: "replace", release: "release" },
  "while the target is still active its project is by definition the selected one",
);

for (const targetIsCurrent of [true, false]) {
  for (const targetProjectActive of [true, false]) {
    const failed = resolveShotReferenceCommit({ saved: false, targetIsCurrent, replacesAssignment: true, targetProjectActive });
    assert.equal(failed.kind, "rollback", "an unverified save always rolls back");
    assert.equal(failed.detachNewAssignment, true, "a rolled back assignment is detached");
    assert.equal(failed.liveState, "unchanged", "a rolled back save never mutates live state");
    assert.equal(failed.release, "not_applicable", "a rolled back save never releases the old assignment either");
  }
}

console.log("Shot reference drop and binding checks passed.");
