import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { createCanvasGraphForSegments } from "./src/features/workspace/canvasGraph.ts";

const desktopRoot = path.dirname(fileURLToPath(import.meta.url));
const server = await createServer({
  configFile: path.join(desktopRoot, "vite.config.ts"),
  root: desktopRoot,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

try {
  const { ProjectWorkspaceCanvas } = await server.ssrLoadModule("/src/features/workspace/ProjectWorkspaceCanvas.tsx");
  const { OnePromptWorkflowPanel } = await server.ssrLoadModule("/src/features/oneprompt/OnePromptWorkflowPanel.tsx");
  const panelMarkup = renderToStaticMarkup(React.createElement(OnePromptWorkflowPanel, {
    projectId: "project-test",
    projectName: "Test project",
    onCreateProject() {},
    workspaceRoot: "",
    topic: "A two-shot sequence",
    loading: false,
    cloudGenerationEnabled: false,
    localScriptReview: null,
    videoSessions: [],
    assets: [],
    referenceSets: [],
    browserFlowWorkflow: null,
    browserFlowBusy: false,
    promptObjective: "",
    additionalPrompt: "",
    onTopicChange() {},
    onActivity() {},
    onNotice() {},
    async onSaveSession() { return null; },
    onDeleteSession() {},
    async onStartBrowserFlowDiscovery() { return false; },
    async onConnectGflowCli() { return ""; },
    onLoadBrowserFlowWorkflow() {},
    async onGenerateScript() { return null; },
    async onChooseSource() { return null; },
    async onImport() { return null; },
    async onCreateReferenceSet() { return null; },
    async onAssignReference() { return null; },
    async onDetachReference() { return false; },
    onOpenAdvanced() {},
  }));
  assert.match(panelMarkup, /aria-label="Project shot workspace"/);
  assert.match(panelMarkup, /Run one-prompt workflow/);
  assert.doesNotMatch(panelMarkup, /studio-flow-shell/);
  const script = {
    schemaVersion: "1.0.0",
    scriptId: "script-test",
    briefId: "brief-test",
    language: "en",
    title: "Two-shot sequence",
    hook: "A clear opening",
    segments: [
      { segmentId: "segment-001", narration: "First narration", onScreenText: "Opening shot", durationSeconds: 4, claimStatus: "not_applicable", continuityNotes: "Establish the setting." },
      { segmentId: "segment-002", narration: "Second narration", onScreenText: "Closing shot", durationSeconds: 5, claimStatus: "not_applicable", continuityNotes: "Continue the same action." },
    ],
    totalDurationSeconds: 9,
    approvalStatus: "pending",
  };
  const canvasSessionId = "video-session-test";
  const baseGraph = createCanvasGraphForSegments(canvasSessionId, script.segments.map((segment) => segment.segmentId));
  const graph = { ...baseGraph, nodes: [...baseGraph.nodes].reverse() };
  const props = {
    projectId: "project-test",
    projectName: "Test project",
    topic: "A two-shot sequence",
    sessionName: "Canvas test",
    sessionDirectory: null,
    sessions: [{
      sessionId: canvasSessionId, name: "Canvas test", title: "Two-shot sequence", topic: "A two-shot sequence",
      status: "draft", durationSeconds: 9, lastStep: "storyboard", script,
    }],
    assets: [],
    shotReferenceBindings: [],
    activeSessionId: canvasSessionId,
    canvasSessionId,
    canvasGraph: graph,
    canvasGraphDirty: true,
    script,
    selectedSegmentId: "segment-002",
    loading: false,
    agentBusy: false,
    sessionSaving: false,
    revisionPrompt: "",
    runStatus: "draft",
    runDetail: "No run yet.",
    outputCount: 0,
    getMediaUrl: (relativePath) => `asset://${relativePath}`,
    onTopicChange() {},
    onSessionNameChange() {},
    onOpenSession() {},
    onDeleteSession() {},
    onCreateSession() {},
    onSaveSession() {},
    onCreateProject() {},
    onRunAgent() {},
    onAttachReference() {},
    onAttachProjectReference() {},
    shotReferenceBusy: false,
    existingReferenceAssetId: "",
    onAssignShotReference() {},
    onAssignExistingShotReference() {},
    onExistingReferenceAssetChange() {},
    onSelectSegment() {},
    onUpdateSegment() {},
    onRevisionPromptChange() {},
    onReviseSelectedShot() {},
    onNotice() {},
    selectedFlowProjectId: "",
    flowPreflight: null,
    flowCards: [],
    flowCardDiscovery: null,
    flowCardsProjectId: "",
    flowCardsMessage: "",
    flowCardSelection: "",
    flowBindingBusy: false,
    onPrepareShotReferenceForFlow() {},
    onDiscoverFlowImageCards() {},
    onSelectFlowCard() {},
    onConfirmFlowCardBinding() {},
    onCanvasGraphChange() {},
    onFlowCardPreviewFailed() {},
    onOpenAdvanced() {},
  };
  const markup = renderToStaticMarkup(React.createElement(ProjectWorkspaceCanvas, props));
  const openingIndex = markup.indexOf("Opening shot");
  const closingIndex = markup.indexOf("Closing shot");
  assert.ok(openingIndex >= 0 && closingIndex > openingIndex, "shot cards must render in source script order");
  assert.match(markup, /aria-pressed="true"[^>]*aria-label="Select shot 002/);
  assert.match(markup, /aria-label="Run and review status"/);
  assert.match(markup, /role="region" aria-label="Shot layout canvas"/);
  assert.match(markup, /Save session/);
  assert.match(markup, /Add project reference/);
  assert.doesNotMatch(markup, /FLOW SLOT/);
  assert.match(markup, /data-shot-reference-target="segment-001"/, "each shot renders an explicit native drop target");
  assert.match(markup, /data-shot-reference-target="segment-002"/, "the selected shot has its own drop target, not a shared one");
  assert.match(markup, /data-armed="true"/, "a saved session with an idle workspace arms the drop targets");
  assert.match(markup, /Drop one image here/);
  assert.match(markup, /Choose image for selected shot/, "the accessible picker stays available next to native drop");

  const boundProps = {
    ...props,
    assets: [{
      schemaVersion: "1.0.0", assetId: "asset-start", projectId: "project-test", title: "start.png",
      relativePath: "assets/references/start.png", sha256: "d".repeat(64), kind: "image", mimeType: "image/png",
      sizeBytes: 2048, width: 800, height: 600, durationSeconds: null, status: "quarantined",
      rightsStatus: "pending", sourceUri: null, tags: [], note: "", createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z", archivedAt: null,
    }],
    shotReferenceBindings: [{
      segmentId: "segment-002", referenceSetId: "set-shot", assignmentId: "assignment-start",
      assetId: "asset-start", assetSha256: "d".repeat(64), role: "start_frame",
    }],
  };
  const boundMarkup = renderToStaticMarkup(React.createElement(ProjectWorkspaceCanvas, boundProps));
  assert.match(boundMarkup, /Start frame bound/, "a bound shot shows its assignment instead of an empty drop target");
  assert.match(boundMarkup, /assignment-start/, "the inspector reports the exact assignment identity");
  assert.match(boundMarkup, /set-shot/);
  assert.match(boundMarkup, />start_frame · not approved</, "a local assignment never claims approval");
  assert.match(boundMarkup, /Rights pending/, "a pending-rights asset stays visibly pending");
  assert.match(boundMarkup, /Not bound in Flow/, "a local assignment never claims a Flow ingredient");
  assert.match(boundMarkup, /never approved for generation/, "a local assignment never claims generation eligibility");
  assert.doesNotMatch(boundMarkup, /stays pending until rights are reviewed/, "the static note must not claim every assigned asset is pending rights");
  // The badge, not the static note, is the rights source of truth: an asset
  // whose rights are already cleared must not be described as pending.
  const clearedRightsMarkup = renderToStaticMarkup(React.createElement(ProjectWorkspaceCanvas, {
    ...boundProps,
    assets: [{ ...boundProps.assets[0], assetId: "asset-cleared", title: "cleared.png", status: "ready", rightsStatus: "licensed" }],
    shotReferenceBindings: [{ ...boundProps.shotReferenceBindings[0], assetId: "asset-cleared" }],
  }));
  assert.match(clearedRightsMarkup, /licensed/, "the badge reports the asset's actual cleared rights state");
  assert.doesNotMatch(clearedRightsMarkup, /Rights pending/, "a cleared-rights asset is never shown as pending");
  const armedUnbound = renderToStaticMarkup(React.createElement(ProjectWorkspaceCanvas, { ...boundProps, shotReferenceBindings: [] }));
  assert.match(armedUnbound, /No shot reference bound/);
  assert.doesNotMatch(armedUnbound, /assignment-start/);
  const unarmedMarkup = renderToStaticMarkup(React.createElement(ProjectWorkspaceCanvas, { ...props, shotReferenceBusy: true }));
  assert.match(unarmedMarkup, /data-armed="false"/, "a running assignment disarms every drop target");
  assert.match(unarmedMarkup, /Assigning reference/);
  const noSessionMarkup = renderToStaticMarkup(React.createElement(ProjectWorkspaceCanvas, { ...props, activeSessionId: null }));
  assert.match(noSessionMarkup, /data-armed="false"/, "an unsaved session cannot accept a durable shot reference");
  // A stale activeSessionId with no matching row must not keep the target armed.
  const staleSessionMarkup = renderToStaticMarkup(React.createElement(ProjectWorkspaceCanvas, { ...props, sessions: [], canvasGraphDirty: false }));
  assert.match(staleSessionMarkup, /data-armed="false"/, "a stale session id with no session row must disarm the drop targets");
  assert.match(staleSessionMarkup, /save the session to enable layout editing/, "layout editing is gated on the session row, not on a bare id");
  assert.match(staleSessionMarkup, /<button type="button" class="secondary-button" disabled="">Choose image for selected shot<\/button>/, "the picker is disabled while no session row backs the id");
  assert.doesNotMatch(staleSessionMarkup, /Session folder:/, "a stale session id with no session row shows no session folder");
  const staleDirectoryMarkup = renderToStaticMarkup(React.createElement(ProjectWorkspaceCanvas, { ...props, sessions: [], sessionDirectory: "outputs/sessions/video-session-test" }));
  assert.doesNotMatch(staleDirectoryMarkup, /Session folder:/, "a session folder is only shown for a session row this project owns");
  const sessionFolderMarkup = renderToStaticMarkup(React.createElement(ProjectWorkspaceCanvas, { ...props, sessionDirectory: "outputs/sessions/video-session-test" }));

  assert.match(sessionFolderMarkup, /Session folder: <code>outputs\/sessions\/video-session-test<\/code>/, "a real session row still shows its folder");

  // A Flow card list is only renderable evidence: a card whose thumbnail is
  // not comparable must stay listed but unselectable, and the manual
  // confirmation gate must stay closed while it is the only visible card.
  const preflight = {
    ready: true, projectId: "project-test", segmentId: "segment-002", referenceSetId: "set-shot",
    assignmentId: "assignment-start", assetId: "asset-start", assetSha256: "d".repeat(64),
    role: "start_frame", relativePath: "assets/references/start.png", currentSha256: "d".repeat(64),
    assetStatus: "ready", rightsStatus: "licensed", assignmentApproved: true,
    referenceSetStatus: "active", reasons: [], message: "Local check passed.",
  };
  const flowProps = {
    ...boundProps,
    selectedFlowProjectId: "proj-9",
    flowPreflight: preflight,
    flowCardsProjectId: "proj-9",
    flowCardDiscovery: {
      projectId: "project-test", segmentId: "segment-002", referenceSetId: "set-shot",
      assignmentId: "assignment-start", assetId: "asset-start", assetSha256: "d".repeat(64),
      role: "start_frame",
    },
    flowCardSelection: "media-failed",
  };
  const failedCardProps = {
    ...flowProps,
    flowCards: [{
      mediaId: "media-failed", label: "hero", preview: "data:image/jpeg;base64,/9j/4AAQSkZJRgAB",
      previewAvailable: false, selectable: false,
      previewNote: "The Flow card image could not be decoded in this window, so it cannot be compared.",
    }],
  };
  const failedCardMarkup = renderToStaticMarkup(React.createElement(ProjectWorkspaceCanvas, failedCardProps));
  assert.match(failedCardMarkup, /data-selectable="false"/, "a card with no comparable preview is not selectable");
  assert.match(failedCardMarkup, /could not be decoded in this window/, "the failed preview is reported, not hidden");
  assert.match(failedCardMarkup, /<input type="radio"[^>]*disabled=""/, "an unselectable card cannot be chosen");
  assert.doesNotMatch(failedCardMarkup, /I compared both images above/, "no manual confirmation is offered for a card nobody could see");
  assert.match(failedCardMarkup, /Blocked:/, "the confirmation gate stays closed");
  assert.match(failedCardMarkup, /<button type="button" class="primary-button" disabled="">Save this Flow card/, "saving a failed card stays disabled");

  // A repeated media ID reaches the UI as two unselectable cards, so it can
  // never be bound just because only the first copy was normalised away.
  const duplicateCard = { selectable: false, previewNote: "Flow shows more than one card with this media ID, so none of them can be chosen." };
  const duplicateMarkup = renderToStaticMarkup(React.createElement(ProjectWorkspaceCanvas, {
    ...flowProps,
    flowCards: [
      { mediaId: "media-dup", label: "first", preview: "data:image/jpeg;base64,/9j/4AAQSkZJRgAB", previewAvailable: true, ...duplicateCard },
      { mediaId: "media-dup", label: "second", preview: "data:image/png;base64,iVBORw0KGgo=", previewAvailable: true, ...duplicateCard },
    ],
    flowCardSelection: "media-dup",
  }));
  assert.match(duplicateMarkup, /Có nhiều card cùng media ID/, "a repeated media ID is surfaced as ambiguous");
  assert.doesNotMatch(duplicateMarkup, /I compared both images above/, "an ambiguous media ID is never confirmable");

  const unsavedMarkup = renderToStaticMarkup(React.createElement(ProjectWorkspaceCanvas, {
    ...props,
    sessions: [],
    activeSessionId: null,
    canvasGraph: createCanvasGraphForSegments("video-session-draft", script.segments.map((segment) => segment.segmentId)),
    canvasGraphDirty: false,
  }));
  assert.match(unsavedMarkup, /Create session/);
  assert.match(unsavedMarkup, /save the session to enable layout editing/);
  const draftMarkup = renderToStaticMarkup(React.createElement(ProjectWorkspaceCanvas, {
    ...props,
    script: null,
    selectedSegmentId: null,
    canvasGraph: createCanvasGraphForSegments(canvasSessionId, []),
    canvasGraphDirty: false,
  }));
  assert.match(draftMarkup, /No shots yet/);
  assert.doesNotMatch(draftMarkup, /Select shot 001/);

  const longScript = {
    ...script,
    segments: Array.from({ length: 80 }, (_, index) => ({
      ...script.segments[index % script.segments.length],
      segmentId: `long-${String(index + 1).padStart(3, "0")}`,
      onScreenText: `Long shot ${String(index + 1).padStart(3, "0")}`,
    })),
  };
  const longMarkup = renderToStaticMarkup(React.createElement(ProjectWorkspaceCanvas, {
    ...props,
    script: longScript,
    selectedSegmentId: "long-080",
    canvasGraph: createCanvasGraphForSegments(canvasSessionId, longScript.segments.map((segment) => segment.segmentId)),
  }));
  assert.ok(longMarkup.indexOf("Long shot 001") < longMarkup.indexOf("Long shot 080"), "long shot boards must preserve script order");
  assert.match(longMarkup, /aria-label="Select shot 080/);
} finally {
  await server.close();
}

console.log("Project workspace shot-board rendering checks passed.");
