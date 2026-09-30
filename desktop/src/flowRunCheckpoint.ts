export type FlowRunCheckpointShot = {
  revisionId: string;
  expectedCreditCost: number;
  /** SHA-256 over the stable compiled prompt, plus the reference fingerprint for a bound shot. */
  inputHash?: string;
  /** SHA-256 over the exact reference identity that produced the paid click. */
  referenceFingerprint?: string;
};

/** What the run is about to submit for one shot, used to detect stale provenance. */
export type FlowRunCheckpointExpectation = {
  inputHash: string;
  referenceFingerprint: string | null;
};


export type FlowRunCheckpoint = {
  schemaVersion: 1;
  runId: string;
  submittedShots: Record<string, FlowRunCheckpointShot>;
};

/**
 * Bounded, additive provenance for what a bound shot actually sent to Flow.
 * It is written next to the run checkpoint under its own key, so the v1
 * checkpoint's storage key, version and stored shots are never rewritten.
 */
export type FlowRunReferenceEvidenceShot = {
  shotId: string;
  revisionId: string;
  segmentId: string;
  assignmentId: string;
  assetId: string;
  assetSha256: string;
  flowProjectId: string;
  flowMediaId: string;
  confirmationKind: string | null;
  promptVersion: string;
  promptHash: string;
  referenceFingerprint: string;
  chipVerification: string;
  reportPath: string | null;
  recordedAt: string;
};

export type FlowRunReferenceEvidence = {
  schemaVersion: 1;
  runId: string;
  projectId: string;
  sessionId: string | null;
  shots: Record<string, FlowRunReferenceEvidenceShot>;
};


const SAFE_HASH = /^[0-9a-f]{64}$/;
const SAFE_RUN_ID = /^auto-[a-z0-9]+$/;
const SAFE_SHOT_ID = /^SHOT-\d{3}$/;
const SAFE_REVISION_ID = /^rev-[a-z0-9][a-z0-9-]{0,40}$/;

export function flowRunCheckpointStorageKey(
  projectId: string,
  flowProjectId: string,
  sessionId: string | null,
  sourcePromptHash: string,
): string | null {
  if (!projectId.trim() || !flowProjectId.trim() || !/^[0-9a-f]{64}$/i.test(sourcePromptHash)) return null;
  return [
    "auto3dvideo.flow-run.v1",
    encodeURIComponent(projectId.trim()),
    encodeURIComponent(flowProjectId.trim()),
    encodeURIComponent(sessionId?.trim() || "no-session"),
    sourcePromptHash.toLowerCase(),
  ].join(".");
}

export function createFlowRunCheckpoint(runId: string): FlowRunCheckpoint | null {
  return SAFE_RUN_ID.test(runId) ? { schemaVersion: 1, runId, submittedShots: {} } : null;
}

export function parseFlowRunCheckpoint(raw: string | null): FlowRunCheckpoint | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<FlowRunCheckpoint>;
    if (value.schemaVersion !== 1 || typeof value.runId !== "string" || !SAFE_RUN_ID.test(value.runId)) return null;
    if (!value.submittedShots || typeof value.submittedShots !== "object" || Array.isArray(value.submittedShots)) return null;
    const entries = Object.entries(value.submittedShots);
    if (entries.length > 12) return null;
    const submittedShots: Record<string, FlowRunCheckpointShot> = {};
    for (const [shotId, shot] of entries) {
      if (!SAFE_SHOT_ID.test(shotId) || !shot || typeof shot !== "object") return null;
      if (!SAFE_REVISION_ID.test(shot.revisionId) || !Number.isSafeInteger(shot.expectedCreditCost) || shot.expectedCreditCost <= 0) return null;
      // An old entry carries neither field and stays valid; a field that is
      // present but malformed means the record cannot be trusted at all.
      if (shot.inputHash !== undefined && (typeof shot.inputHash !== "string" || !SAFE_HASH.test(shot.inputHash))) return null;
      if (shot.referenceFingerprint !== undefined && (typeof shot.referenceFingerprint !== "string" || !SAFE_HASH.test(shot.referenceFingerprint))) return null;
      submittedShots[shotId] = {
        revisionId: shot.revisionId,
        expectedCreditCost: shot.expectedCreditCost,
        ...(shot.inputHash === undefined ? {} : { inputHash: shot.inputHash }),
        ...(shot.referenceFingerprint === undefined ? {} : { referenceFingerprint: shot.referenceFingerprint }),
      };
    }
    return { schemaVersion: 1, runId: value.runId, submittedShots };
  } catch {
    return null;
  }
}

export function serializeFlowRunCheckpoint(checkpoint: FlowRunCheckpoint): string {
  return JSON.stringify(checkpoint);
}

export function flowRunCheckpointRecordedCredits(checkpoint: FlowRunCheckpoint): number {
  return Object.values(checkpoint.submittedShots).reduce((total, shot) => total + shot.expectedCreditCost, 0);
}

export function flowRunCheckpointShot(
  checkpoint: FlowRunCheckpoint,
  shotId: string,
): FlowRunCheckpointShot | null {
  return checkpoint.submittedShots[shotId] ?? null;
}

export function recordFlowRunCheckpointShot(
  checkpoint: FlowRunCheckpoint,
  shotId: string,
  revisionId: string,
  expectedCreditCost: number,
  provenance?: FlowRunCheckpointExpectation | null,
): FlowRunCheckpoint | null {
  if (!SAFE_SHOT_ID.test(shotId) || !SAFE_REVISION_ID.test(revisionId) || !Number.isSafeInteger(expectedCreditCost) || expectedCreditCost <= 0) return null;
  const inputHash = provenance?.inputHash ?? undefined;
  const referenceFingerprint = provenance?.referenceFingerprint ?? undefined;
  if (provenance) {
    if (inputHash !== undefined && !SAFE_HASH.test(inputHash)) return null;
    if (referenceFingerprint !== undefined && !SAFE_HASH.test(referenceFingerprint)) return null;
    if (inputHash === undefined && referenceFingerprint !== undefined) return null;
  }
  const existing = checkpoint.submittedShots[shotId];
  if (existing && (existing.revisionId !== revisionId || existing.expectedCreditCost !== expectedCreditCost)) return null;
  // A shot already paid for under different provenance is never re-recorded:
  // the new run has to stop for a human instead of clicking Generate again.
  if (existing && provenance && flowRunCheckpointInputBlocker({ submitted: existing, revisionId, expected: { inputHash: inputHash ?? "", referenceFingerprint: referenceFingerprint ?? null } })) return null;
  return {
    ...checkpoint,
    submittedShots: {
      ...checkpoint.submittedShots,
      [shotId]: {
        revisionId,
        expectedCreditCost,
        ...(inputHash === undefined ? {} : { inputHash }),
        ...(referenceFingerprint === undefined ? {} : { referenceFingerprint }),
      },
    },
  };
}

/**
 * Why the recorded paid click no longer matches the input about to be
 * submitted, or `null` when the two agree.
 *
 * Absence is not a mismatch: an entry written before this feature records
 * neither field, and a reference-free shot legitimately records its
 * prompt-only `inputHash` with no fingerprint at all. What must block is a
 * *present but different* value, a fingerprint with no hash behind it, and a
 * shot that was already paid for reference-free and is now about to get a new
 * explicit binding.
 */
export function flowRunCheckpointInputBlocker(input: {
  submitted: FlowRunCheckpointShot | null;
  revisionId: string;
  expected: FlowRunCheckpointExpectation;
}): string | null {
  const { submitted, revisionId, expected } = input;
  if (!submitted) return null;
  // An omitted optional field is the same claim as an explicit "no reference":
  // the caller simply has no binding to offer this shot.
  const expectedFingerprint = expected.referenceFingerprint ?? null;
  if (!SAFE_HASH.test(expected.inputHash)) return "input hash is not a SHA-256 digest";
  if (expectedFingerprint !== null && !SAFE_HASH.test(expectedFingerprint)) {
    return "reference fingerprint is not a SHA-256 digest";
  }
  if (submitted.revisionId !== revisionId) {
    return `checkpoint ghi revision ${submitted.revisionId}, nhưng script hiện tại là ${revisionId}`;
  }
  const hasInputHash = submitted.inputHash !== undefined;
  const hasFingerprint = submitted.referenceFingerprint !== undefined;
  // A fingerprint is only meaningful next to the hash that covered it; a
  // prompt-only entry for a reference-free shot is a complete record.
  if (hasFingerprint && !hasInputHash) {
    return "checkpoint ghi referenceFingerprint mà không ghi inputHash; bản ghi không đáng tin";
  }
  if (expectedFingerprint !== null) {
    if (!hasFingerprint) {
      return "shot này đã bấm Generate cho một lần chạy không có reference fingerprint; gắn reference mới cần người rà soát";
    }
    if (submitted.referenceFingerprint !== expectedFingerprint) {
      return "reference của shot đã đổi sau lần Generate đã ghi; cần người xác nhận lại";
    }
  } else if (hasFingerprint) {
    return "shot đã Generate với một reference đã gắn, nhưng lần chạy này không còn reference đó; cần người xác nhận lại";
  }
  if (hasInputHash && submitted.inputHash !== expected.inputHash) {
    return "input hash của shot đã đổi sau lần Generate đã ghi; cần người xác nhận lại";
  }
  return null;
}

export type FlowRunRecoveryDecision = "generate" | "recover" | "blocked";

export function flowRunCheckpointRecoveryDecision(
  checkpoint: FlowRunCheckpoint,
  shotId: string,
  revisionId: string,
  exactOutputCount: number,
  expected?: FlowRunCheckpointExpectation | null,
): FlowRunRecoveryDecision {
  if (!SAFE_SHOT_ID.test(shotId) || !SAFE_REVISION_ID.test(revisionId) || !Number.isSafeInteger(exactOutputCount) || exactOutputCount < 0) {
    return "blocked";
  }
  const submitted = checkpoint.submittedShots[shotId];
  if (submitted && submitted.revisionId !== revisionId) return "blocked";
  if (expected && flowRunCheckpointInputBlocker({ submitted, revisionId, expected })) return "blocked";
  if (exactOutputCount > 1) return "blocked";
  if (exactOutputCount === 1) return submitted ? "recover" : "blocked";
  return submitted ? "blocked" : "generate";
}

const MAX_FLOW_RUN_EVIDENCE_SHOTS = 12;
const MAX_FLOW_RUN_EVIDENCE_TEXT = 200;

function safeEvidenceText(value: unknown, maxLength = MAX_FLOW_RUN_EVIDENCE_TEXT) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function parseFlowRunReferenceEvidenceShot(shotId: string, value: unknown): FlowRunReferenceEvidenceShot | null {
  if (!SAFE_SHOT_ID.test(shotId) || !value || typeof value !== "object") return null;
  const shot = value as Record<string, unknown>;
  const revisionId = String(shot.revisionId ?? "");
  if (!SAFE_REVISION_ID.test(revisionId)) return null;
  if (!SAFE_HASH.test(String(shot.assetSha256 ?? "")) || !SAFE_HASH.test(String(shot.promptHash ?? "")) || !SAFE_HASH.test(String(shot.referenceFingerprint ?? ""))) return null;
  return {
    shotId,
    revisionId,
    segmentId: safeEvidenceText(shot.segmentId),
    assignmentId: safeEvidenceText(shot.assignmentId),
    assetId: safeEvidenceText(shot.assetId),
    assetSha256: String(shot.assetSha256),
    flowProjectId: safeEvidenceText(shot.flowProjectId),
    flowMediaId: safeEvidenceText(shot.flowMediaId),
    confirmationKind: shot.confirmationKind === null || shot.confirmationKind === undefined ? null : safeEvidenceText(shot.confirmationKind, 40),
    promptVersion: safeEvidenceText(shot.promptVersion, 80),
    promptHash: String(shot.promptHash),
    referenceFingerprint: String(shot.referenceFingerprint),
    chipVerification: safeEvidenceText(shot.chipVerification, 80),
    reportPath: shot.reportPath === null || shot.reportPath === undefined ? null : safeEvidenceText(shot.reportPath, 240),
    recordedAt: safeEvidenceText(shot.recordedAt, 40),
  };
}

export function flowRunReferenceEvidenceStorageKey(runCheckpointKey: string) {
  return `${runCheckpointKey}.reference-evidence.v1`;
}

export function parseFlowRunReferenceEvidence(raw: string | null): FlowRunReferenceEvidence | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<FlowRunReferenceEvidence>;
    if (value.schemaVersion !== 1 || typeof value.runId !== "string" || !SAFE_RUN_ID.test(value.runId)) return null;
    if (typeof value.projectId !== "string" || !value.projectId.trim()) return null;
    if (value.sessionId !== null && value.sessionId !== undefined && typeof value.sessionId !== "string") return null;
    if (!value.shots || typeof value.shots !== "object" || Array.isArray(value.shots)) return null;
    const entries = Object.entries(value.shots);
    if (entries.length > MAX_FLOW_RUN_EVIDENCE_SHOTS) return null;
    const shots: Record<string, FlowRunReferenceEvidenceShot> = {};
    for (const [shotId, shot] of entries) {
      const parsed = parseFlowRunReferenceEvidenceShot(shotId, shot);
      if (!parsed) return null;
      shots[shotId] = parsed;
    }
    return {
      schemaVersion: 1,
      runId: value.runId,
      projectId: value.projectId,
      sessionId: value.sessionId ?? null,
      shots,
    };
  } catch {
    return null;
  }
}

export function serializeFlowRunReferenceEvidence(evidence: FlowRunReferenceEvidence) {
  return JSON.stringify(evidence);
}

/**
 * Records what one bound shot actually sent. Recording is idempotent per shot
 * and a record from another run is replaced rather than merged, so a resume
 * can never blend two runs' provenance into one claim.
 */
export function recordFlowRunReferenceEvidence(
  current: FlowRunReferenceEvidence | null,
  identity: { runId: string; projectId: string; sessionId: string | null },
  shot: FlowRunReferenceEvidenceShot,
): FlowRunReferenceEvidence | null {
  if (!SAFE_RUN_ID.test(identity.runId) || !identity.projectId.trim()) return null;
  const parsedShot = parseFlowRunReferenceEvidenceShot(shot.shotId, shot);
  if (!parsedShot || !parsedShot.flowMediaId) return null;
  const base = !current || current.runId !== identity.runId || current.projectId !== identity.projectId
    ? { schemaVersion: 1 as const, runId: identity.runId, projectId: identity.projectId, sessionId: identity.sessionId, shots: {} }
    : current;
  const shots = { ...base.shots, [parsedShot.shotId]: parsedShot };
  if (Object.keys(shots).length > MAX_FLOW_RUN_EVIDENCE_SHOTS) return null;
  return { ...base, shots };
}
