import assert from "node:assert/strict";
import {
  createFlowRunCheckpoint,
  flowRunCheckpointRecordedCredits,
  flowRunCheckpointRecoveryDecision,
  flowRunCheckpointShot,
  flowRunCheckpointStorageKey,
  flowRunReferenceEvidenceStorageKey,
  parseFlowRunCheckpoint,
  parseFlowRunReferenceEvidence,
  recordFlowRunCheckpointShot,
  recordFlowRunReferenceEvidence,
  serializeFlowRunCheckpoint,
  serializeFlowRunReferenceEvidence,
} from "../desktop/src/flowRunCheckpoint.ts";

const sourcePromptHash = "a".repeat(64);
const key = flowRunCheckpointStorageKey("project-default", "flow-project-1", "video-session-1", sourcePromptHash);
assert.equal(key, flowRunCheckpointStorageKey("project-default", "flow-project-1", "video-session-1", sourcePromptHash));
assert.notEqual(key, flowRunCheckpointStorageKey("project-other", "flow-project-1", "video-session-1", sourcePromptHash));
assert.notEqual(key, flowRunCheckpointStorageKey("project-default", "flow-project-2", "video-session-1", sourcePromptHash));
assert.notEqual(key, flowRunCheckpointStorageKey("project-default", "flow-project-1", "video-session-2", sourcePromptHash));
assert.notEqual(key, flowRunCheckpointStorageKey("project-default", "flow-project-1", "video-session-1", "not-a-hash"));

let checkpoint = createFlowRunCheckpoint("auto-muigr1z5");
assert.ok(checkpoint);
checkpoint = recordFlowRunCheckpointShot(checkpoint, "SHOT-001", "rev-001", 12);
assert.ok(checkpoint);
const restored = parseFlowRunCheckpoint(serializeFlowRunCheckpoint(checkpoint));
assert.deepEqual(restored, checkpoint);
assert.equal(flowRunCheckpointRecordedCredits(restored), 12);
assert.deepEqual(flowRunCheckpointShot(restored, "SHOT-001"), { revisionId: "rev-001", expectedCreditCost: 12 });
assert.equal(recordFlowRunCheckpointShot(restored, "SHOT-001", "rev-002", 12), null);
assert.equal(recordFlowRunCheckpointShot(restored, "SHOT-002", "rev-001", 0), null);
assert.equal(flowRunCheckpointRecoveryDecision(restored, "SHOT-001", "rev-001", 0), "blocked");
assert.equal(flowRunCheckpointRecoveryDecision(restored, "SHOT-001", "rev-001", 1), "recover");
assert.equal(flowRunCheckpointRecoveryDecision(restored, "SHOT-001", "rev-001", 2), "blocked");
assert.equal(flowRunCheckpointRecoveryDecision(restored, "SHOT-001", "rev-002", 0), "blocked");
assert.equal(flowRunCheckpointRecoveryDecision(restored, "SHOT-002", "rev-001", 0), "generate");
assert.equal(flowRunCheckpointRecoveryDecision(restored, "SHOT-002", "rev-001", 1), "blocked");
assert.equal(parseFlowRunCheckpoint("not-json"), null);
assert.equal(parseFlowRunCheckpoint(JSON.stringify({ schemaVersion: 1, runId: "../unsafe", submittedShots: {} })), null);

// --- the optional inputHash / referenceFingerprint pair --------------------
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const PRINT_A = "c".repeat(64);
const PRINT_B = "d".repeat(64);

// A v1 entry written before this feature carries neither field and must keep
// parsing, serialising and deciding exactly as it did.
assert.deepEqual(
  flowRunCheckpointShot(restored, "SHOT-001"),
  { revisionId: "rev-001", expectedCreditCost: 12 },
  "an old entry is untouched, with no fabricated hash fields",
);

let boundCheckpoint = recordFlowRunCheckpointShot(checkpoint, "SHOT-003", "rev-001", 9, {
  inputHash: HASH_A,
  referenceFingerprint: PRINT_A,
});
assert.ok(boundCheckpoint);
assert.deepEqual(
  flowRunCheckpointShot(boundCheckpoint, "SHOT-003"),
  { revisionId: "rev-001", expectedCreditCost: 9, inputHash: HASH_A, referenceFingerprint: PRINT_A },
);
assert.deepEqual(parseFlowRunCheckpoint(serializeFlowRunCheckpoint(boundCheckpoint)), boundCheckpoint, "the pair survives a save/load cycle");
assert.deepEqual(flowRunCheckpointShot(boundCheckpoint, "SHOT-001"), { revisionId: "rev-001", expectedCreditCost: 12 }, "recording one shot never rewrites another");

// A shot already recorded under different provenance is never re-recorded.
assert.equal(recordFlowRunCheckpointShot(boundCheckpoint, "SHOT-003", "rev-001", 9, { inputHash: HASH_B, referenceFingerprint: PRINT_A }), null);
assert.equal(recordFlowRunCheckpointShot(boundCheckpoint, "SHOT-003", "rev-001", 9, { inputHash: HASH_A, referenceFingerprint: PRINT_B }), null);
assert.equal(recordFlowRunCheckpointShot(boundCheckpoint, "SHOT-003", "rev-002", 9, { inputHash: HASH_A, referenceFingerprint: PRINT_A }), null);
assert.equal(recordFlowRunCheckpointShot(boundCheckpoint, "SHOT-003", "rev-001", 8, { inputHash: HASH_A, referenceFingerprint: PRINT_A }), null);
// Re-recording the identical submission is idempotent.
assert.deepEqual(
  recordFlowRunCheckpointShot(boundCheckpoint, "SHOT-003", "rev-001", 9, { inputHash: HASH_A, referenceFingerprint: PRINT_A }),
  boundCheckpoint,
);
// A legacy call with no pair still records exactly the old shape.
assert.deepEqual(recordFlowRunCheckpointShot(checkpoint, "SHOT-006", "rev-001", 4), {
  ...checkpoint,
  submittedShots: { ...checkpoint.submittedShots, "SHOT-006": { revisionId: "rev-001", expectedCreditCost: 4 } },
});

// Only 64 lowercase hex is provenance; anything else is a broken record.
assert.equal(recordFlowRunCheckpointShot(checkpoint, "SHOT-004", "rev-001", 9, { inputHash: HASH_A.toUpperCase() }), null);
assert.equal(recordFlowRunCheckpointShot(checkpoint, "SHOT-004", "rev-001", 9, { inputHash: `${HASH_A}0` }), null);
assert.equal(recordFlowRunCheckpointShot(checkpoint, "SHOT-004", "rev-001", 9, { referenceFingerprint: "nope" }), null);
for (const malformed of [{ inputHash: "zz" }, { referenceFingerprint: "ZZ".repeat(32) }, { inputHash: HASH_A.toUpperCase() }]) {
  assert.equal(
    parseFlowRunCheckpoint(JSON.stringify({
      schemaVersion: 1,
      runId: "auto-muigr1z5",
      submittedShots: { "SHOT-004": { revisionId: "rev-001", expectedCreditCost: 9, ...malformed } },
    })),
    null,
    `a malformed stored hash rejects the whole checkpoint: ${JSON.stringify(malformed)}`,
  );
}

// --- decisions over the pair ---------------------------------------------
const expectBound = { inputHash: HASH_A, referenceFingerprint: PRINT_A };
assert.equal(flowRunCheckpointRecoveryDecision(boundCheckpoint, "SHOT-003", "rev-001", 1, expectBound), "recover");
assert.equal(flowRunCheckpointRecoveryDecision(boundCheckpoint, "SHOT-003", "rev-001", 0, expectBound), "blocked");
assert.equal(flowRunCheckpointRecoveryDecision(boundCheckpoint, "SHOT-004", "rev-001", 0, expectBound), "generate");

// The prompt words may still match, but the input that produced the paid
// click no longer does, so the shot blocks for a human.
assert.equal(
  flowRunCheckpointRecoveryDecision(boundCheckpoint, "SHOT-003", "rev-001", 1, { inputHash: HASH_B, referenceFingerprint: PRINT_A }),
  "blocked",
  "a changed input hash blocks even with one matching output",
);
assert.equal(
  flowRunCheckpointRecoveryDecision(boundCheckpoint, "SHOT-003", "rev-001", 1, { inputHash: HASH_A, referenceFingerprint: PRINT_B }),
  "blocked",
  "a changed reference fingerprint blocks even with one matching output",
);
assert.equal(
  flowRunCheckpointRecoveryDecision(boundCheckpoint, "SHOT-003", "rev-001", 1, { inputHash: HASH_A }),
  "blocked",
  "dropping an explicit binding after a paid click blocks",
);
assert.equal(
  flowRunCheckpointRecoveryDecision(boundCheckpoint, "SHOT-003", "rev-001", 1, { inputHash: HASH_A, referenceFingerprint: "not-a-fingerprint" }),
  "blocked",
);

// A prior fingerprint-less submission may still recover its own old output,
// but binding a new explicit reference to that shot needs a human.
assert.equal(flowRunCheckpointRecoveryDecision(restored, "SHOT-001", "rev-001", 1, { inputHash: HASH_A }), "recover");
assert.equal(
  flowRunCheckpointRecoveryDecision(restored, "SHOT-001", "rev-001", 1, { inputHash: HASH_A, referenceFingerprint: PRINT_A }),
  "blocked",
  "a new explicit binding on an already submitted shot never starts a second Generate",
);
assert.equal(
  flowRunCheckpointRecoveryDecision(restored, "SHOT-002", "rev-001", 0, { inputHash: HASH_A, referenceFingerprint: PRINT_A }),
  "generate",
  "a shot that was never submitted is unaffected by the new binding",
);

// A reference-free shot records its prompt-only hash with no fingerprint, and
// that is a complete record, not a half-written one.
const promptOnlyEntry = parseFlowRunCheckpoint(JSON.stringify({
  schemaVersion: 1,
  runId: "auto-muigr1z5",
  submittedShots: { "SHOT-005": { revisionId: "rev-001", expectedCreditCost: 9, inputHash: HASH_A } },
}));
assert.ok(promptOnlyEntry);
assert.equal(flowRunCheckpointRecoveryDecision(promptOnlyEntry, "SHOT-005", "rev-001", 1, { inputHash: HASH_A }), "recover", "a reference-free shot keeps recovering its own output");
assert.equal(
  flowRunCheckpointRecoveryDecision(promptOnlyEntry, "SHOT-005", "rev-001", 1, { inputHash: HASH_B }),
  "blocked",
  "a changed prompt-only hash still blocks",
);
assert.equal(
  flowRunCheckpointRecoveryDecision(promptOnlyEntry, "SHOT-005", "rev-001", 1, { inputHash: HASH_A, referenceFingerprint: PRINT_A }),
  "blocked",
  "binding a new reference to a reference-free paid shot still blocks",
);

// A fingerprint with no hash behind it is a broken record.
const partialPair = parseFlowRunCheckpoint(JSON.stringify({
  schemaVersion: 1,
  runId: "auto-muigr1z5",
  submittedShots: { "SHOT-007": { revisionId: "rev-001", expectedCreditCost: 9, referenceFingerprint: PRINT_A } },
}));
assert.ok(partialPair);
assert.equal(flowRunCheckpointRecoveryDecision(partialPair, "SHOT-007", "rev-001", 1, expectBound), "blocked");
assert.equal(flowRunCheckpointRecoveryDecision(partialPair, "SHOT-007", "rev-001", 1, { inputHash: HASH_A }), "blocked");
assert.equal(recordFlowRunCheckpointShot(checkpoint, "SHOT-008", "rev-001", 9, { referenceFingerprint: PRINT_A }), null, "a fingerprint is never recorded without its hash");

console.log("Flow run checkpoint behavior passed.");
