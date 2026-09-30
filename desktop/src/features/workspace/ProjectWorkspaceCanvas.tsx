import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { AssetView } from "../assets/assetTypes";
import type { FlowImageCard, ShotReferenceBinding, ShotReferenceFlowPreflight } from "../oneprompt/onePromptTypes";
import { WorkspaceMediaImage } from "../oneprompt/WorkspaceMediaImage";
import type { LocalScriptDocument, LocalScriptSegment } from "../shared/scriptTypes";
import type { CanvasGraph } from "./canvasGraph";
import { classifyShotReferenceDropPaths, physicalToCssPoint, resolveShotReferenceDropTarget } from "./shotReferenceDrop";
import { flowBindingBlockerMessages, resolveFlowBindingBlocker, resolveFlowCardSelection, type FlowBindingIdentity } from "./flowReferenceBinding";

type ProjectWorkspaceSession = {
  sessionId: string;
  name: string;
  title: string;
  topic: string;
  status: string;
  durationSeconds: number | null;
  lastStep: string;
  sessionDirectory?: string;
  script: LocalScriptDocument | null;
};

type ProjectWorkspaceCanvasProps = {
  projectId: string;
  projectName: string;
  topic: string;
  sessionName: string;
  sessionDirectory: string | null;
  sessions: ProjectWorkspaceSession[];
  assets: AssetView[];
  referenceAsset: AssetView | null;
  activeSessionId: string | null;
  shotReferenceBindings: ShotReferenceBinding[];
  canvasGraph: CanvasGraph;
  canvasGraphDirty: boolean;
  script: LocalScriptDocument | null;
  selectedSegmentId: string | null;
  loading: boolean;
  agentBusy: boolean;
  sessionSaving: boolean;
  revisionPrompt: string;
  runStatus: string;
  runDetail: string;
  outputCount: number;
  getMediaUrl: (relativePath: string) => string;
  onTopicChange: (value: string) => void;
  onSessionNameChange: (value: string) => void;
  onOpenSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onCreateSession: () => void;
  onCreateProject: () => void;
  onSaveSession: () => void;
  onRunAgent: () => void;
  onAttachReference: (segmentId: string) => void;
  onAttachProjectReference: () => void;
  shotReferenceBusy: boolean;
  existingReferenceAssetId: string;
  onAssignShotReference: (segmentId: string, sourcePath: string) => void;
  onAssignExistingShotReference: (segmentId: string, assetId: string) => void;
  onExistingReferenceAssetChange: (assetId: string) => void;
  onSelectSegment: (segmentId: string) => void;
  onUpdateSegment: (segmentId: string, patch: Partial<LocalScriptSegment>) => void;
  onRevisionPromptChange: (value: string) => void;
  onReviseSelectedShot: () => void;
  onCanvasGraphChange: (graph: CanvasGraph) => void;
  selectedFlowProjectId: string;
  flowPreflight: ShotReferenceFlowPreflight | null;
  flowCards: FlowImageCard[];
  flowCardsProjectId: string;
  flowCardsMessage: string;
  flowCardDiscovery: FlowBindingIdentity | null;
  flowCardSelection: string;
  flowBindingBusy: boolean;
  onPrepareShotReferenceForFlow: (segmentId: string) => void;
  onDiscoverFlowImageCards: (segmentId: string) => void;
  onSelectFlowCard: (mediaId: string) => void;
  onFlowCardPreviewFailed: (mediaId: string) => void;
  onConfirmFlowCardBinding: (segmentId: string, confirmed: boolean) => void;
  onNotice: (message: string) => void;
  onOpenAdvanced: () => void;
};

type LayoutDrag = {
  segmentId: string;
  pointerId: number;
  startX: number;
  startY: number;
  startPositionX: number;
  startPositionY: number;
  snapshot: CanvasGraph;
  moved: boolean;
};

const cardWidth = 272;
const cardHeight = 190;
const nodeGapX = 300;
const nodeGapY = 230;
const maxLayoutCoordinate = 10_000;

function shotTitle(segment: LocalScriptSegment, index: number): string {
  return segment.onScreenText.trim() || segment.subject?.trim() || segment.action?.trim() || `Shot ${String(index + 1).padStart(3, "0")}`;
}

function shotPrompt(segment: LocalScriptSegment): string {
  return segment.visualPrompt ?? segment.action ?? segment.narration;
}

function rightsLabel(asset: AssetView): string {
  if (asset.rightsStatus === "pending") return "Rights pending";
  if (asset.rightsStatus === "rejected" || asset.rightsStatus === "restricted") return "Restricted";
  if (asset.rightsStatus === "unknown") return "Rights unknown";
  return asset.rightsStatus.replace(/_/g, " ");
}

type NativeShotReferenceDropOptions = {
  projectId: string;
  activeSessionId: string | null;
  segmentIdsKey: string;
  armed: boolean;
  unarmedReason: string;
  onAssign: (segmentId: string, sourcePath: string) => void;
  onHover: (segmentId: string | null) => void;
  onReject: (message: string) => void;
};

// Tauri's own drag-drop listener is the only path that exposes absolute file
// paths, so it is registered behind the Tauri boundary and torn down whenever
// the project, session or shot set changes. Coordinates arrive as physical
// pixels and are converted before hit testing; file bytes are never read here.
function useNativeShotReferenceDrop(options: NativeShotReferenceDropOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const { projectId, activeSessionId, segmentIdsKey } = options;

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    let hoverFrame = 0;
    let pendingHover: string | null = null;

    const queueHover = (segmentId: string | null) => {
      pendingHover = segmentId;
      if (hoverFrame) return;
      hoverFrame = window.requestAnimationFrame(() => {
        hoverFrame = 0;
        optionsRef.current.onHover(pendingHover);
      });
    };
    const targetAt = (position: { x: number; y: number }) => {
      const point = physicalToCssPoint(position, window.devicePixelRatio);
      return resolveShotReferenceDropTarget(document.elementsFromPoint(point.x, point.y));
    };
    const handleEvent = (payload: DragDropEvent) => {
      const current = optionsRef.current;
      if (payload.type === "enter" || payload.type === "leave") {
        queueHover(null);
        return;
      }
      if (payload.type === "over") {
        const hovered = targetAt(payload.position);
        queueHover(hovered.kind === "shot" ? hovered.segmentId : null);
        return;
      }
      queueHover(null);
      if (!current.armed) {
        current.onReject(current.unarmedReason);
        return;
      }
      const classified = classifyShotReferenceDropPaths(payload.paths);
      if (!classified.ok) {
        current.onReject(classified.message);
        return;
      }
      const target = targetAt(payload.position);
      if (target.kind === "background") {
        current.onReject("The file landed on empty canvas space. Drop exactly one image on a single shot's reference target.");
        return;
      }
      if (target.kind === "ambiguous") {
        current.onReject("The file landed on more than one shot reference target. Separate the overlapping cards, then drop again.");
        return;
      }
      current.onAssign(target.segmentId, classified.sourcePath);
    };

    void getCurrentWebview()
      .onDragDropEvent((event) => handleEvent(event.payload))
      .then((stop) => {
        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;
      })
      .catch((error) => {
        optionsRef.current.onReject(`Native file drop is unavailable in this build (${String(error).slice(0, 160)}). Use “Choose image for selected shot” instead.`);
      });

    return () => {
      disposed = true;
      if (hoverFrame) window.cancelAnimationFrame(hoverFrame);
      hoverFrame = 0;
      unlisten?.();
      unlisten = null;
    };
  }, [projectId, activeSessionId, segmentIdsKey]);
}

export function ProjectWorkspaceCanvas({
  projectId,
  projectName,
  topic,
  sessionName,
  sessionDirectory,
  sessions,
  assets,
  referenceAsset,
  activeSessionId,
  shotReferenceBindings,
  canvasGraph,
  canvasGraphDirty,
  script,
  selectedSegmentId,
  loading,
  agentBusy,
  sessionSaving,
  revisionPrompt,
  runStatus,
  runDetail,
  outputCount,
  getMediaUrl,
  onTopicChange,
  onSessionNameChange,
  onOpenSession,
  onDeleteSession,
  onCreateSession,
  onCreateProject,
  onSaveSession,
  onRunAgent,
  onAttachReference,
  onAttachProjectReference,
  shotReferenceBusy,
  existingReferenceAssetId,
  onAssignShotReference,
  onAssignExistingShotReference,
  onExistingReferenceAssetChange,
  onSelectSegment,
  onUpdateSegment,
  onRevisionPromptChange,
  onReviseSelectedShot,
  onCanvasGraphChange,
  selectedFlowProjectId,
  flowPreflight,
  flowCardDiscovery,
  flowCards,
  flowCardsProjectId,
  flowCardsMessage,
  flowCardSelection,
  flowBindingBusy,
  onPrepareShotReferenceForFlow,
  onDiscoverFlowImageCards,
  onSelectFlowCard,
  onFlowCardPreviewFailed,
  onConfirmFlowCardBinding,
  onNotice,
  onOpenAdvanced,
}: ProjectWorkspaceCanvasProps) {
  const [history, setHistory] = useState<CanvasGraph[]>([]);
  const [future, setFuture] = useState<CanvasGraph[]>([]);
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);
  const [hoveredDropSegmentId, setHoveredDropSegmentId] = useState<string | null>(null);
  const graphRef = useRef(canvasGraph);
  const dragRef = useRef<LayoutDrag | null>(null);
  const suppressClickRef = useRef(false);
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  graphRef.current = canvasGraph;

  const segments = script?.segments ?? [];
  const segmentIdsKey = segments.map((segment) => segment.segmentId).join("\u001f");
  const shotNodes = useMemo(
    () => new Map(canvasGraph.nodes.filter((node) => node.kind === "shot").map((node) => [node.segmentId, node])),
    [canvasGraph],
  );
  const positions = useMemo(() => segments.map((segment, index) => {
    const node = shotNodes.get(segment.segmentId);
    return {
      segment,
      index,
      x: node?.x ?? 32 + (index % 3) * nodeGapX,
      y: node?.y ?? 32 + Math.floor(index / 3) * nodeGapY,
    };
  }), [segments, shotNodes]);
  const boardWidth = Math.max(960, ...positions.map(({ x }) => x + cardWidth + 32));
  const boardHeight = Math.max(210, ...positions.map(({ y }) => y + cardHeight + 32));
  const selectedShotIndex = segments.findIndex((segment) => segment.segmentId === selectedSegmentId);
  const selectedShot = selectedShotIndex >= 0 ? segments[selectedShotIndex] : null;
  const previousShot = selectedShotIndex > 0 ? segments[selectedShotIndex - 1] : null;
  const bindingsBySegmentId = useMemo(
    () => new Map(shotReferenceBindings.map((binding) => [binding.segmentId, binding])),
    [shotReferenceBindings],
  );
  const selectedReferencePath = selectedShot?.revisionImagePath ?? null;
  const selectedBinding = selectedShot ? bindingsBySegmentId.get(selectedShot.segmentId) ?? null : null;
  const boundReferenceAsset = selectedBinding
    ? assets.find((asset) => asset.assetId === selectedBinding.assetId) ?? null
    : null;
  const selectedReferenceAsset = boundReferenceAsset ?? (selectedReferencePath
    ? assets.find((asset) => asset.relativePath === selectedReferencePath)
      ?? (referenceAsset?.relativePath === selectedReferencePath ? referenceAsset : null)
    : null);
  const imageAssets = assets.filter((asset) => asset.kind === "image" || asset.mimeType.startsWith("image/"));
  const [flowCardConfirmed, setFlowCardConfirmed] = useState(false);
  // A different shot, card or Flow project invalidates the human comparison,
  // so the tick box can never carry over to a card nobody looked at.
  useEffect(() => {
    setFlowCardConfirmed(false);
  }, [selectedSegmentId, flowCardSelection, flowCardsProjectId]);
  const flowCardSelectionResult = resolveFlowCardSelection(flowCards, flowCardSelection);
  const selectedFlowCard = flowCardSelectionResult.kind === "ready" ? flowCardSelectionResult.card : null;
  const flowBlocker = resolveFlowBindingBlocker({
    projectId,
    binding: selectedBinding,
    preflight: flowPreflight,
    selectedFlowProjectId,
    discoveredFlowProjectId: flowCardsProjectId,
    cards: flowCards,
    selectedMediaId: flowCardSelection,
    discoveredFor: flowCardDiscovery,
  });
  const activeSession = activeSessionId ? sessions.find((session) => session.sessionId === activeSessionId) ?? null : null;
  // `activeSessionId` can outlive its row during a project transition, so every
  // guard is based on the row itself, not on a bare id.
  const layoutEnabled = Boolean(activeSession) && !loading && !agentBusy && !sessionSaving;
  // A shot reference is a durable local binding, so it is only armed when one
  // saved session, one ordered script and an idle workspace can receive it.
  const dropArmed = Boolean(script) && Boolean(activeSession) && !loading && !agentBusy && !sessionSaving && !shotReferenceBusy;
  const dropArmedReason = !script
    ? "Save a shot plan first; a reference attaches to one shot of a saved session."
    : !activeSession
      ? "Create or open a saved video session before dropping a shot reference."
      : shotReferenceBusy
        ? "A shot reference assignment is already running; wait for it to finish."
        : "Loading, running or saving is in progress, so shot references are paused.";

  useNativeShotReferenceDrop({
    projectId,
    activeSessionId,
    segmentIdsKey,
    armed: dropArmed,
    unarmedReason: dropArmedReason,
    onAssign: onAssignShotReference,
    onHover: setHoveredDropSegmentId,
    onReject: onNotice,
  });

  useEffect(() => {
    setHoveredDropSegmentId(null);
  }, [activeSessionId, segmentIdsKey]);

  useEffect(() => {
    setHistory([]);
    setFuture([]);
    dragRef.current = null;
  }, [activeSessionId, segmentIdsKey]);

  function changeShotPosition(segmentId: string, x: number, y: number) {
    const current = graphRef.current;
    const next: CanvasGraph = {
      ...current,
      nodes: current.nodes.map((node) => node.kind === "shot" && node.segmentId === segmentId
        ? { ...node, x, y }
        : node),
    };
    graphRef.current = next;
    onCanvasGraphChange(next);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>, segmentId: string, x: number, y: number) {
    if (event.button !== 0 || !layoutEnabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      segmentId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPositionX: x,
      startPositionY: y,
      snapshot: graphRef.current,
      moved: false,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>, segmentId: string) {
    const drag = dragRef.current;
    if (!drag || drag.segmentId !== segmentId || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 4) drag.moved = true;
    if (!drag.moved) return;
    const x = Math.min(maxLayoutCoordinate, Math.max(0, Math.round(drag.startPositionX + deltaX)));
    const y = Math.min(maxLayoutCoordinate, Math.max(0, Math.round(drag.startPositionY + deltaY)));
    changeShotPosition(segmentId, x, y);
  }

  function finishPointerDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) {
      setHistory((current) => [...current, drag.snapshot].slice(-40));
      setFuture([]);
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  }

  function undoLayout() {
    const previous = history[history.length - 1];
    if (!previous) return;
    const currentGraph = graphRef.current;
    setHistory((current) => current.slice(0, -1));
    setFuture((current) => [currentGraph, ...current].slice(0, 40));
    graphRef.current = previous;
    onCanvasGraphChange(previous);
  }

  function redoLayout() {
    const next = future[0];
    if (!next) return;
    const currentGraph = graphRef.current;
    setFuture((current) => current.slice(1));
    setHistory((current) => [...current, currentGraph].slice(-40));
    graphRef.current = next;
    onCanvasGraphChange(next);
  }

  undoRef.current = undoLayout;
  redoRef.current = redoLayout;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undoRef.current();
      } else if (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z")) {
        event.preventDefault();
        redoRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function requestSessionChange(action: () => void) {
    if (canvasGraphDirty) {
      onNotice("Save the current session layout before switching sessions.");
      return;
    }
    action();
  }

  if (!projectId) {
    return <section className="project-workspace-empty" aria-label="Create project workspace">
      <div><p className="eyebrow accent">PROJECT WORKSPACE</p><h2>Create a project to begin</h2><p>The project contains your prompt, shot sessions, local assets, and review outputs.</p><button type="button" className="primary-button" onClick={onCreateProject}>＋ Create project</button></div>
    </section>;
  }

  return <section className="project-workspace-canvas" aria-label="Project shot workspace">
    <header className="project-workspace-header">
      <div><p className="eyebrow accent">PROJECT SHOT WORKSPACE</p><h2>{projectName}</h2><p>Shots stay in script order. Canvas positions change layout only; they never change prompt order or execution.</p></div>
      <div className="project-workspace-header-actions"><span className="runtime-pill">{sessions.length} session{sessions.length === 1 ? "" : "s"} · {assets.length} assets</span><button type="button" className="secondary-button" onClick={onOpenAdvanced} disabled={loading}>Asset Library</button></div>
    </header>

    <div className="project-workspace-session-controls">
      <label>Saved session<select aria-label="Saved video session" value={activeSessionId ?? ""} onChange={(event) => {
        if (event.target.value) requestSessionChange(() => onOpenSession(event.target.value));
      }} disabled={loading || sessionSaving}>
        <option value="">{activeSessionId ? "Current session" : "Unsaved session"}</option>
        {sessions.map((session) => <option key={session.sessionId} value={session.sessionId}>{session.name} · {session.status}</option>)}
      </select></label>
      <label>Session name<input aria-label="Session name" value={sessionName} onChange={(event) => onSessionNameChange(event.target.value)} disabled={loading || sessionSaving} maxLength={160} /></label>
      <div className="project-workspace-session-actions">
        <button type="button" className="secondary-button" onClick={() => requestSessionChange(onCreateSession)} disabled={loading || sessionSaving}>＋ New session</button>
        {activeSessionId && <button type="button" className="secondary-button" onClick={() => setDeleteSessionId(activeSessionId)} disabled={loading || sessionSaving || canvasGraphDirty}>Delete session</button>}
        <button type="button" className="primary-button" onClick={onSaveSession} disabled={loading || sessionSaving || !topic.trim()}>{sessionSaving ? "Saving session…" : !activeSessionId ? "Create session" : canvasGraphDirty ? "Save session and layout" : "Save session"}</button>
      </div>
      {activeSession && sessionDirectory && <small className="project-workspace-session-directory">Session folder: <code>{sessionDirectory}</code></small>}
      {activeSession && <small className="project-workspace-session-meta">{activeSession.status} · {activeSession.lastStep} · {activeSession.durationSeconds ? `${activeSession.durationSeconds.toFixed(1)}s` : "duration not set"}</small>}
    </div>

    <div className="project-workspace-promptbar">
      <div><label htmlFor="project-workspace-prompt">PROJECT PROMPT</label><textarea id="project-workspace-prompt" value={topic} onChange={(event) => onTopicChange(event.target.value)} disabled={loading || agentBusy || sessionSaving} rows={4} maxLength={4000} placeholder="Describe the video subject, action, style, and target duration." /><small className="project-workspace-prompt-hint">The existing Flow runner checks the selected project, model, settings, visible price, and approval before any Generate action.</small></div>
      <div className="project-workspace-run-actions"><button type="button" className="secondary-button" onClick={onAttachProjectReference} disabled={loading || agentBusy || sessionSaving}>Add project reference</button><button type="button" className="primary-button" onClick={onRunAgent} disabled={loading || agentBusy || sessionSaving || topic.trim().length < 3}>{agentBusy ? "Running…" : "Run one-prompt workflow"}</button><span>Project reference is prompt context only, not a per-shot Flow ingredient. Cloud generation can spend credits; approve the displayed cap before submission.</span></div>
    </div>

    <div className="project-workspace-run-status" aria-label="Run and review status" role="status" data-state={runStatus}>
      <div><strong>{runStatus.replace(/_/g, " ")}</strong><span>{runDetail}</span></div>
      <div><strong>{outputCount} output{outputCount === 1 ? "" : "s"}</strong><span>Outputs require human quality, rights, and policy review.</span></div>
    </div>

    {script ? <>
      <div className="project-workspace-layout-toolbar"><span>{segments.length} source shot{segments.length === 1 ? "" : "s"} · {canvasGraphDirty ? "layout has unsaved changes" : activeSession ? "layout saved with session" : "save the session to enable layout editing"}</span><div><button type="button" onClick={undoLayout} disabled={!history.length || !layoutEnabled}>Undo layout</button><button type="button" onClick={redoLayout} disabled={!future.length || !layoutEnabled}>Redo layout</button></div></div>
      <div className="project-workspace-shot-board-viewport" role="region" aria-label="Shot layout canvas" tabIndex={0}>
        <div className="project-workspace-shot-board" style={{ width: `${boardWidth}px`, minHeight: `${boardHeight}px` }}>
          {positions.map(({ segment, index, x, y }) => {
            const title = shotTitle(segment, index);
            const selected = segment.segmentId === selectedSegmentId;
            const prompt = shotPrompt(segment);
            const binding = bindingsBySegmentId.get(segment.segmentId) ?? null;
            const hoverDrop = hoveredDropSegmentId === segment.segmentId;
            return <button
              key={segment.segmentId}
              type="button"
              className={`project-workspace-shot-card${selected ? " project-workspace-shot-card-selected" : ""}${hoverDrop && dropArmed ? " project-workspace-shot-card-drop-hover" : ""}`}
              style={{ left: `${x}px`, top: `${y}px`, width: `${cardWidth}px` }}
              aria-pressed={selected}
              aria-label={`Select shot ${String(index + 1).padStart(3, "0")}: ${title}`}
              onClick={() => {
                if (!suppressClickRef.current) onSelectSegment(segment.segmentId);
              }}
              onPointerDown={(event) => handlePointerDown(event, segment.segmentId, x, y)}
              onPointerMove={(event) => handlePointerMove(event, segment.segmentId)}
              onPointerUp={finishPointerDrag}
              onPointerCancel={finishPointerDrag}
            >
              {segment.revisionImagePath ? <WorkspaceMediaImage projectId={projectId} relativePath={segment.revisionImagePath} src={getMediaUrl(segment.revisionImagePath)} alt={`Local reference for shot ${index + 1}`} className="project-workspace-shot-card-image" /> : <span className="project-workspace-shot-card-image project-workspace-shot-placeholder">No local reference</span>}
              <span className="project-workspace-shot-card-copy"><b>SHOT {String(index + 1).padStart(3, "0")} · {segment.durationSeconds.toFixed(1)}s</b><strong>{title}</strong><small>{prompt || segment.narration || "No shot prompt yet."}</small></span>
              <span
                className="project-workspace-shot-dropzone"
                data-shot-reference-target={segment.segmentId}
                data-armed={dropArmed ? "true" : "false"}
                data-hover={hoverDrop ? "true" : "false"}
              >
                <b>Drop one image here</b>
                <small>{binding ? `Start frame bound · ${binding.assetSha256.slice(0, 12)}…` : "No shot reference bound"}</small>
              </span>
            </button>;
          })}
        </div>
      </div>
    </> : <section className="project-workspace-no-shots" aria-label="No shots yet"><h3>No shots yet</h3><p>Save a draft prompt or run the planner to create ordered shot cards. Layout remains empty until the session has a script.</p></section>}

    <div className="project-workspace-shot-inspector">
      <section className="project-workspace-shot-inspector-form" aria-label="Selected shot inspector">
        {selectedShot ? <>
          <div className="project-workspace-shot-inspector-head"><div><p className="eyebrow accent">SHOT {String(selectedShotIndex + 1).padStart(3, "0")}</p><h3>{shotTitle(selectedShot, selectedShotIndex)}</h3></div><span>{selectedShot.durationSeconds.toFixed(1)}s · {selectedShot.revisionId ?? "original revision"}</span></div>
          <label>Shot prompt<textarea aria-label={`Prompt for shot ${String(selectedShotIndex + 1).padStart(3, "0")}`} value={shotPrompt(selectedShot)} onChange={(event) => onUpdateSegment(selectedShot.segmentId, { visualPrompt: event.target.value, dirty: true })} disabled={loading || agentBusy || sessionSaving} rows={6} /></label>
          <label>Narration<textarea aria-label={`Narration for shot ${String(selectedShotIndex + 1).padStart(3, "0")}`} value={selectedShot.narration} onChange={(event) => onUpdateSegment(selectedShot.segmentId, { narration: event.target.value, dirty: true })} disabled={loading || agentBusy || sessionSaving} rows={3} /></label>
          <div className="project-workspace-continuity"><strong>Continuity cue</strong><p>{previousShot ? `Previous shot: ${previousShot.onScreenText || previousShot.action || previousShot.narration}` : "Opening shot; no prior-shot continuity applies."}</p><p>{selectedShot.continuityNotes?.trim() || "No additional continuity note is recorded for this shot."}</p></div>
          <div className="project-workspace-shot-reference">
            <div><strong>Selected-shot local reference</strong><span>{selectedReferenceAsset ? `${selectedReferenceAsset.title} · ${selectedReferenceAsset.status} · local only` : selectedReferencePath ? "Saved path has no matching current project asset." : "No local reference assigned to this shot."}</span></div>
            {selectedReferenceAsset && <WorkspaceMediaImage projectId={projectId} relativePath={selectedReferenceAsset.relativePath} src={getMediaUrl(selectedReferenceAsset.relativePath)} alt={`Selected local reference: ${selectedReferenceAsset.title}`} />}
            {selectedReferenceAsset && <span className="project-workspace-rights-badge" data-rights={selectedReferenceAsset.rightsStatus}>{rightsLabel(selectedReferenceAsset)}</span>}
            {selectedBinding && <dl className="project-workspace-binding-facts">
              <div><dt>Role</dt><dd>{selectedBinding.role} · not approved</dd></div>
              <div><dt>Asset</dt><dd><code>{selectedBinding.assetId}</code></dd></div>
              <div><dt>SHA-256</dt><dd><code>{selectedBinding.assetSha256}</code></dd></div>
              <div><dt>Set</dt><dd><code>{selectedBinding.referenceSetId}</code></dd></div>
              <div><dt>Assignment</dt><dd><code>{selectedBinding.assignmentId}</code></dd></div>
              <div><dt>Flow ingredient</dt><dd>{selectedBinding.flowMediaId ? `media ${selectedBinding.flowMediaId}` : "Not bound in Flow"}</dd></div>
              {selectedBinding.flowProjectId && <div><dt>Flow project</dt><dd><code>{selectedBinding.flowProjectId}</code></dd></div>}
              {selectedBinding.confirmedAt && <div><dt>Confirmed</dt><dd>{selectedBinding.confirmedAt} · {selectedBinding.confirmationKind === "manual_visual" ? "manual visual check by you" : "unknown confirmation"}</dd></div>}
            </dl>}
            <div className="project-workspace-reference-actions">
              <button type="button" className="secondary-button" onClick={() => onAttachReference(selectedShot.segmentId)} disabled={loading || agentBusy || sessionSaving || shotReferenceBusy || !activeSession}>{shotReferenceBusy ? "Assigning reference…" : "Choose image for selected shot"}</button>
              <label>Or reuse a project image
                <select aria-label="Existing project image for the selected shot" value={existingReferenceAssetId} onChange={(event) => onExistingReferenceAssetChange(event.target.value)} disabled={loading || agentBusy || sessionSaving || shotReferenceBusy || !imageAssets.length}>
                  <option value="">Select an imported image…</option>
                  {imageAssets.slice(0, 64).map((asset) => <option key={asset.assetId} value={asset.assetId}>{asset.title} · {asset.status}</option>)}
                </select>
              </label>
              <button type="button" className="secondary-button" onClick={() => onAssignExistingShotReference(selectedShot.segmentId, existingReferenceAssetId)} disabled={loading || agentBusy || sessionSaving || shotReferenceBusy || !activeSession || !existingReferenceAssetId}>Assign selected image</button>
            </div>
            <small>A local assignment is a durable, shot-scoped binding that is never uploaded to Flow and is never approved for generation. It does not establish rights either: the badge above is the asset's actual rights state.</small>
          </div>
          <div className="project-workspace-flow-binding" aria-label="Prepare this shot reference for Flow">
            <div className="project-workspace-flow-binding-head">
              <strong>Prepare for Flow</strong>
              <span>{selectedFlowProjectId ? `Saved Flow project ${selectedFlowProjectId}` : "No saved Flow project selected"}</span>
            </div>
            <p>Step 1 — the app checks local data only (asset, rights, hash, approved assignment, archived set). It never uploads anything and never grants rights.</p>
            <div className="project-workspace-reference-actions">
              <button type="button" className="secondary-button" onClick={() => onPrepareShotReferenceForFlow(selectedShot.segmentId)} disabled={loading || agentBusy || sessionSaving || flowBindingBusy || !activeSession || !selectedBinding}>{flowBindingBusy ? "Checking…" : "Check local reference"}</button>
              {flowPreflight && <span className={`project-workspace-flow-readiness${flowPreflight.ready ? " ready" : " blocked"}`} role="status">{flowPreflight.message}</span>}
            </div>
            <p>Step 2 — import that same image into the saved Flow project yourself, using Flow&rsquo;s own ingredient import. The app only reads the cards Flow already shows; it never uploads, never clicks a card, and never generates.</p>
            <div className="project-workspace-reference-actions">
              <button type="button" className="secondary-button" onClick={() => onDiscoverFlowImageCards(selectedShot.segmentId)} disabled={loading || agentBusy || sessionSaving || flowBindingBusy || !selectedFlowProjectId || !flowPreflight?.ready || !selectedBinding}>{flowBindingBusy ? "Reading…" : "Read Flow image cards"}</button>
              {flowCardsMessage && <span className="project-workspace-flow-readiness" role="status">{flowCardsMessage}</span>}
            </div>
            {flowCards.length > 0 && <div className="project-workspace-flow-cards" role="radiogroup" aria-label="Flow image cards">
              {/* A repeated media ID is kept as its own unselectable card, so a
                  duplicate must not share a React key with the copy above it. */}
              {flowCards.map((card, index) => <label key={`${card.mediaId}-${index}`} className={`project-workspace-flow-card${flowCardSelection === card.mediaId ? " selected" : ""}`} data-selectable={card.selectable ? "true" : "false"}>
                <input type="radio" name="flow-image-card" value={card.mediaId} checked={flowCardSelection === card.mediaId} onChange={() => onSelectFlowCard(card.mediaId)} disabled={!card.selectable} />
                {card.previewAvailable && card.preview
                  ? <img src={card.preview} alt={`Flow card preview: ${card.label}`} onError={() => onFlowCardPreviewFailed(card.mediaId)} />
                  : <span className="project-workspace-flow-card-placeholder">No readable thumbnail</span>}
                <span className="project-workspace-flow-card-copy"><b>{card.label}</b><code>{card.mediaId}</code>{!card.previewAvailable && <small>{card.previewNote}</small>}</span>
              </label>)}
            </div>}
            {selectedFlowCard && <div className="project-workspace-flow-compare">
              <figure><figcaption>Local reference (never uploaded)</figcaption>{selectedReferenceAsset && <WorkspaceMediaImage projectId={projectId} relativePath={selectedReferenceAsset.relativePath} src={getMediaUrl(selectedReferenceAsset.relativePath)} alt={`Local reference: ${selectedReferenceAsset.title}`} />}</figure>
              <figure><figcaption>Flow card in project {flowCardsProjectId}</figcaption><img src={selectedFlowCard.preview ?? ""} alt={`Flow card preview: ${selectedFlowCard.label}`} onError={() => onFlowCardPreviewFailed(selectedFlowCard.mediaId)} /></figure>
            </div>}
            {flowBlocker
              ? <p className="project-workspace-flow-blocked" role="status">Blocked: {flowBindingBlockerMessages[flowBlocker]}</p>
              : <label className="project-workspace-flow-confirm"><input type="checkbox" checked={flowCardConfirmed} onChange={(event) => setFlowCardConfirmed(event.target.checked)} /><span>I compared both images above and they are the same image.</span></label>}
            <div className="project-workspace-reference-actions">
              <button type="button" className="primary-button" onClick={() => onConfirmFlowCardBinding(selectedShot.segmentId, flowCardConfirmed)} disabled={loading || agentBusy || sessionSaving || flowBindingBusy || Boolean(flowBlocker) || !flowCardConfirmed || !activeSession}>Save this Flow card as the shot&rsquo;s start frame</button>
            </div>
            <small>This is your own visual comparison, not a hash or pixel match: the app cannot prove the provider kept identical bytes. Only the media ID of the card you picked is saved, and a video is never generated by this step.</small>
          </div>
          <label>Revision instruction<textarea aria-label="Revision instruction" value={revisionPrompt} onChange={(event) => onRevisionPromptChange(event.target.value)} disabled={loading || agentBusy || sessionSaving} rows={2} placeholder="Describe only the requested change for this shot." /></label>
          <button type="button" className="secondary-button" onClick={onReviseSelectedShot} disabled={loading || agentBusy || sessionSaving || !revisionPrompt.trim()}>Revise selected shot</button>
        </> : <div className="project-workspace-no-shots"><h3>Select a shot</h3><p>Choose one of the ordered shot cards to inspect its prompt, continuity, and local reference.</p></div>}
      </section>

      <aside className="project-workspace-asset-rail" aria-label="Project image assets">
        <div><p className="eyebrow accent">LOCAL ASSET RAIL</p><h3>Project images</h3><button type="button" className="text-button" onClick={onOpenAdvanced} disabled={loading}>Open Asset Library</button></div>
        {imageAssets.length ? imageAssets.slice(0, 24).map((asset) => <article className="project-workspace-asset-card" key={asset.assetId}>
          <WorkspaceMediaImage projectId={projectId} relativePath={asset.relativePath} src={getMediaUrl(asset.relativePath)} alt={`Local asset ${asset.title}`} />
          <strong>{asset.title}</strong><small>{asset.status} · {asset.kind} · {asset.sizeBytes ? `${(asset.sizeBytes / (1024 * 1024)).toFixed(1)} MB` : "size unknown"}</small>
          <span className="project-workspace-rights-badge" data-rights={asset.rightsStatus}>{rightsLabel(asset)}</span>
        </article>) : <p>No local image assets in this project yet.</p>}
        {imageAssets.length > 24 && <small>Showing 24 of {imageAssets.length} images; open Asset Library for the full list.</small>}
      </aside>
    </div>

    <p className="project-workspace-review-note">Flow media identity, reference eligibility, and rights are not established by this canvas layout. Review local asset rights and each generated output before reuse or publication.</p>

    {deleteSessionId && <div className="modal-backdrop" role="presentation"><section className="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="canvas-delete-session-title" aria-describedby="canvas-delete-session-copy"><h3 id="canvas-delete-session-title">Delete local video session?</h3><p id="canvas-delete-session-copy">This removes the selected session record. Existing Flow projects and generated provider media are not deleted.</p><div className="project-workspace-session-actions"><button type="button" className="secondary-button" onClick={() => setDeleteSessionId(null)}>Cancel</button><button type="button" className="secondary-button danger" onClick={() => { onDeleteSession(deleteSessionId); setDeleteSessionId(null); }}>Delete session</button></div></section></div>}
  </section>;
}
