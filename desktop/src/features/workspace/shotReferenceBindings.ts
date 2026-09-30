import type { ReferenceAssignment } from "../assets/assetTypes";
import type { LocalScriptDocument } from "../shared/scriptTypes";
import type { ShotReferenceBinding } from "../oneprompt/onePromptTypes";

export type ShotReferenceTargetIdentity = { projectId: string; sessionId: string };

// A target is current only while the same project and session are still active
// *and* that session is still a real row of the selected project. Without the
// row check a deleted or stale id would be written back and recreated as a new
// session by the backend.
export function isShotReferenceTargetCurrent(
  target: ShotReferenceTargetIdentity,
  current: { projectId: string; activeSessionId: string | null },
  projectSessions: readonly ShotReferenceTargetIdentity[],
): boolean {
  if (current.projectId !== target.projectId || current.activeSessionId !== target.sessionId) return false;
  return projectSessions.some((session) => session.sessionId === target.sessionId && session.projectId === target.projectId);
}

// `cleanup_required` is deliberately distinct from "nothing to release": a
// replaced assignment that could not be released must be reported by id so the
// user can remove it from the project that actually owns it.
export type ShotReferenceRelease = "not_applicable" | "release" | "cleanup_required";

export type ShotReferenceCommit =
  | { kind: "rollback"; liveState: "unchanged"; detachNewAssignment: true; release: "not_applicable" }
  | { kind: "apply"; liveState: "replace"; release: "not_applicable" | "release" }
  | { kind: "keep_separate"; liveState: "unchanged"; release: ShotReferenceRelease };

// A verified save means the backend really wrote the target session, so the
// binding stands. Live state may only follow it while that session is still
// active; otherwise the newly active session must be left completely untouched,
// and the old assignment can only be released while the shell still points at
// the project that owns it.
export function resolveShotReferenceCommit(input: {
  saved: boolean;
  targetIsCurrent: boolean;
  replacesAssignment: boolean;
  targetProjectActive: boolean;
}): ShotReferenceCommit {
  if (!input.saved) return { kind: "rollback", liveState: "unchanged", detachNewAssignment: true, release: "not_applicable" };
  if (input.targetIsCurrent) return { kind: "apply", liveState: "replace", release: input.replacesAssignment ? "release" : "not_applicable" };
  if (!input.replacesAssignment) return { kind: "keep_separate", liveState: "unchanged", release: "not_applicable" };
  return { kind: "keep_separate", liveState: "unchanged", release: input.targetProjectActive ? "release" : "cleanup_required" };
}

// The backend validates every saved binding against the persisted script, so a
// binding whose segment no longer exists would make every later save of that
// session fail. Trimming in one place keeps a re-planned script saveable and
// guarantees at most one start-frame binding per stable segment id.
export function shotReferenceBindingsForScript(
  bindings: readonly ShotReferenceBinding[],
  script: LocalScriptDocument | null,
): ShotReferenceBinding[] {
  if (!script) return [];
  const segmentIds = new Set(script.segments.map((segment) => segment.segmentId));
  const kept = new Map<string, ShotReferenceBinding>();
  for (const binding of bindings) {
    if (!segmentIds.has(binding.segmentId)) continue;
    kept.set(binding.segmentId, binding);
  }
  // Emitted in script order so reordering shots never re-keys a binding.
  return script.segments.flatMap((segment) => {
    const binding = kept.get(segment.segmentId);
    return binding ? [binding] : [];
  });
}

export type CreatedShotAssignmentResult =
  | { kind: "found"; assignment: ReferenceAssignment }
  | { kind: "missing" }
  | { kind: "ambiguous"; candidates: number };

// `assign_reference` always inserts a new row, and `now_string()` only has
// second precision, so two rows can share a `createdAt`. The new row is found by
// the difference against the set's assignment ids captured before the insert,
// never by timestamp order, and it is only trusted when it is the single new
// row matching this request's asset, shot, role, approval and backend hash.
// An ambiguous delta is rejected instead of guessed.
export function pickCreatedShotAssignment(
  assignments: readonly ReferenceAssignment[],
  baselineAssignmentIds: readonly string[],
  assetId: string,
  segmentId: string,
  assetSha256: string,
): CreatedShotAssignmentResult {
  const baseline = new Set(baselineAssignmentIds);
  const created = assignments.filter((assignment) => !baseline.has(assignment.assignmentId));
  const matching = created.filter((assignment) => assignment.assetId === assetId
    && assignment.shotId === segmentId
    && assignment.role === "start_frame"
    && assignment.approved === false
    && assignment.assetSha256 === assetSha256);
  if (matching.length === 0) return { kind: "missing" };
  if (matching.length > 1) return { kind: "ambiguous", candidates: matching.length };
  return { kind: "found", assignment: matching[0] };
}
