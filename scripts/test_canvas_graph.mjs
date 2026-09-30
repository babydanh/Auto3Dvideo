import assert from "node:assert/strict";
import * as canvasGraphModel from "../desktop/src/features/workspace/canvasGraph.ts";
const { createCanvasGraphForSegments, isCanvasGraphValid } = canvasGraphModel;

const graph = {
  version: 1,
  sessionId: "video-session-test",
  nodes: [
    { id: "shot-001", kind: "shot", segmentId: "segment-001", x: 0, y: 0 },
    { id: "asset-a", kind: "asset", assetId: "asset-a", x: 240, y: 0 },
  ],
  edges: [{ id: "edge-001", from: "shot-001", to: "asset-a" }],
  viewport: { x: 0, y: 0, zoom: 1 },
};

assert.equal(isCanvasGraphValid(graph, "video-session-test"), true);
assert.equal(isCanvasGraphValid({ ...graph, sessionId: "another-session" }, "video-session-test"), false);
assert.equal(isCanvasGraphValid({ ...graph, edges: [{ id: "edge-001", from: "shot-001", to: "missing" }] }), false);
assert.equal(isCanvasGraphValid({ ...graph, nodes: [{ ...graph.nodes[0], x: 10001 }, graph.nodes[1]] }), false);
assert.equal(isCanvasGraphValid({ ...graph, nodes: [graph.nodes[0], { ...graph.nodes[1], id: "shot-001" }] }), false);

const emptyGraph = createCanvasGraphForSegments("video-session-empty", []);
assert.equal(isCanvasGraphValid(emptyGraph, "video-session-empty"), true);
assert.deepEqual(emptyGraph.nodes, []);

const legacyLayout = {
  version: 1,
  sessionId: "video-session-test",
  nodes: [
    { id: "shot:segment-b", kind: "shot", segmentId: "segment-b", x: 820, y: 460 },
    { id: "shot:segment-removed", kind: "shot", segmentId: "segment-removed", x: 180, y: 720 },
    { id: "asset:asset-1", kind: "asset", assetId: "asset-1", x: 1160, y: 80 },
  ],
  edges: [
    { id: "edge:kept", from: "shot:segment-b", to: "asset:asset-1" },
    { id: "edge:removed", from: "shot:segment-removed", to: "asset:asset-1" },
  ],
  viewport: { x: 12, y: -4, zoom: 1.25 },
};
const reconciled = createCanvasGraphForSegments("video-session-test", ["segment-b", "segment-a", "segment-new"], legacyLayout);
assert.equal(isCanvasGraphValid(reconciled, "video-session-test"), true);
assert.deepEqual(reconciled.nodes.filter((node) => node.kind === "shot").map((node) => node.segmentId), ["segment-b", "segment-a", "segment-new"]);
assert.deepEqual(reconciled.nodes.find((node) => node.kind === "shot" && node.segmentId === "segment-b"), {
  id: "shot:segment-b", kind: "shot", segmentId: "segment-b", x: 820, y: 460,
});
assert.equal(reconciled.nodes.some((node) => node.kind === "shot" && node.segmentId === "segment-removed"), false);
assert.equal(reconciled.nodes.some((node) => node.kind === "asset" && node.assetId === "asset-1"), true);
assert.deepEqual(reconciled.edges, [{ id: "edge:kept", from: "shot:segment-b", to: "asset:asset-1" }]);
assert.deepEqual(reconciled.viewport, legacyLayout.viewport);

const longShotGraph = createCanvasGraphForSegments("video-session-long", Array.from({ length: 80 }, (_, index) => `segment-${String(index + 1).padStart(3, "0")}`));
assert.equal(isCanvasGraphValid(longShotGraph, "video-session-long"), true);
assert.equal(longShotGraph.nodes.length, 80);
assert.equal(longShotGraph.nodes.every((node) => Math.abs(node.x) <= 10_000 && Math.abs(node.y) <= 10_000), true);
assert.deepEqual(longShotGraph.nodes.map((node) => node.segmentId), Array.from({ length: 80 }, (_, index) => `segment-${String(index + 1).padStart(3, "0")}`));

assert.throws(() => createCanvasGraphForSegments("video-session-test", ["segment-a", "segment-a"]), /duplicate/i);
assert.equal(typeof canvasGraphModel.withCanvasGraphForSessionSave, "function", "session persistence must gate layout by session identity and explicit changes");
const withCanvasGraphForSessionSave = canvasGraphModel.withCanvasGraphForSessionSave;
const sessionInput = {
  sessionId: "video-session-save",
  topic: "Keep current script",
  script: { title: "Current script", segments: [{ segmentId: "segment-save", narration: "Keep the current narration." }] },
};
const saveGraph = createCanvasGraphForSegments("video-session-save", ["segment-save"]);
const legacyGraph = createCanvasGraphForSegments("video-session-legacy-save", ["segment-save"]);
const legacyAutosave = withCanvasGraphForSessionSave({ ...sessionInput, sessionId: "video-session-legacy-save" }, legacyGraph, { persistedGraph: null });
assert.equal(Object.hasOwn(legacyAutosave, "canvasGraph"), false, "derived layouts must not migrate legacy sessions during autosave");
const explicitSave = withCanvasGraphForSessionSave(sessionInput, saveGraph, { explicitSave: true });
assert.deepEqual(explicitSave.script, sessionInput.script, "adding a layout must preserve the current script snapshot");
assert.deepEqual(explicitSave.canvasGraph, saveGraph);
const dirtyLayoutSave = withCanvasGraphForSessionSave(sessionInput, saveGraph, { layoutDirty: true });
assert.deepEqual(dirtyLayoutSave.canvasGraph, saveGraph, "user-edited layout must persist through autosave");
const mismatchedSave = withCanvasGraphForSessionSave({ ...sessionInput, sessionId: "video-session-other" }, saveGraph, { explicitSave: true });
assert.equal(Object.hasOwn(mismatchedSave, "canvasGraph"), false, "a layout from another session must never be persisted");

console.log("Canvas graph validation and layout checks passed.");
