import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AssetView, ReferenceAssignment, ReferenceSet } from "../assets/assetTypes";
import { buildBrowserFlowImagePrompt, buildBrowserFlowShotPrompt, compactBrowserFlowText, findBrowserFlowBackRef, findBrowserFlowCloseRef, findBrowserFlowImageGenerateRef, findBrowserFlowImageModeRef, findBrowserFlowProjectRef, findBrowserFlowPromptRef, findResumableFlowAsset, flowSegmentsForGeneration, hasBrowserFlowDestructiveOverlay, inferPromptTimingRequirements, inspectBrowserFlowImageComposer, isGoogleFlowSignInPage, promptSourceFingerprintInput, runBrowserFlowAgent, scriptMatchesPrompt, sha256Text, shouldUseGoogleFlowMcpDesktopRoute, stableBrowserFlowPrompt } from "../browserflow/browserFlowHelpers";
import type { BrowserFlowDownloadEntry, BrowserFlowDownloadImportReport, BrowserFlowUiRef, BrowserFlowVisualEvaluationReport, BrowserFlowWorkflow, BrowserFlowWorkflowReport, GoogleFlowDomOutputReport } from "../browserflow/browserFlowTypes";
import { WorkspaceMediaImage } from "./WorkspaceMediaImage";
import { isNanoBananaGenerationSuccessful, nanoBananaReportFailureState } from "./onePromptTypes";
import type { BlenderShotPreviewReport, ChromeCdpLaunchReport, FlowImageCard, FlowImageReviewRequest, GoogleFlowImageCardsReport, GoogleFlowPlaywrightReport, NanoBananaImageGenerationReport, NanoBananaProgressReport, ShotReferenceBinding, ShotReferenceFlowPreflight, VideoWorkflowSession, VideoWorkflowSessionInput } from "./onePromptTypes";
import { parseGoogleFlowProjectSettings } from "../shared/scriptTypes";
import type { GoogleFlowProjectSettings, LocalScriptDocument, LocalScriptReviewReport, LocalScriptSegment, SavedGoogleFlowProject } from "../shared/scriptTypes";
import type { WorkspaceActivityEvent, WorkspaceActivityState } from "../shared/workspaceActivityTypes";
import { ProjectWorkspaceCanvas } from "../workspace/ProjectWorkspaceCanvas";
import { createFlowRunCheckpoint, flowRunCheckpointStorageKey, parseFlowRunCheckpoint, serializeFlowRunCheckpoint } from "../../flowRunCheckpoint";
import type { ProcessRunSummary } from "../../processTypes";
import { useEffect, useMemo, useRef, useState } from "react";
import { createCanvasGraphForSegments, withCanvasGraphForSessionSave } from "../workspace/canvasGraph";
import type { CanvasGraph } from "../workspace/canvasGraph";
import { classifyShotReferenceDropPaths } from "../workspace/shotReferenceDrop";
import { isShotReferenceTargetCurrent, pickCreatedShotAssignment, resolveShotReferenceCommit, shotReferenceBindingsForScript } from "../workspace/shotReferenceBindings";
import { buildConfirmedFlowBinding, flowBindingIdentity, flowBindingBlockerMessages, flowCardsAfterPreviewFailure, resolveFlowBindingBlocker, type FlowBindingIdentity } from "../workspace/flowReferenceBinding";

export function OnePromptWorkflowPanel({
  projectId,
  projectName,
  onCreateProject,
  workspaceRoot,
  topic,
  loading,
  cloudGenerationEnabled,
  localScriptReview,
  videoSessions,
  assets,
  referenceSets,
  browserFlowWorkflow,
  browserFlowBusy,
  promptObjective,
  additionalPrompt,
  onTopicChange,
  onActivity,
  onNotice,
  onSaveSession,
  onDeleteSession,
  onStartBrowserFlowDiscovery,
  onConnectGflowCli,
  onLoadBrowserFlowWorkflow,
  onGenerateScript,
  onChooseSource,
  onImport,
  onCreateReferenceSet,
  onAssignReference,
  onDetachReference,
  onOpenAdvanced,
}: {
  projectId: string;
  projectName: string;
  onCreateProject: () => void;
  workspaceRoot: string;
  topic: string;
  loading: boolean;
  cloudGenerationEnabled: boolean;
  localScriptReview: LocalScriptReviewReport | null;
  videoSessions: VideoWorkflowSession[];
  assets: AssetView[];
  referenceSets: ReferenceSet[];
  browserFlowWorkflow: BrowserFlowWorkflow | null;
  browserFlowBusy: boolean;
  promptObjective: string;
  additionalPrompt: string;
  onTopicChange: (value: string) => void;
  onActivity: (event: Omit<WorkspaceActivityEvent, "eventId" | "timestamp">) => void;
  onNotice: (message: string) => void;
  onSaveSession: (input: VideoWorkflowSessionInput, announce?: boolean) => Promise<VideoWorkflowSession | null>;
  onDeleteSession: (sessionId: string) => void;
  onStartBrowserFlowDiscovery: (script: LocalScriptDocument | null, report: BlenderShotPreviewReport | null, sessionId?: string | null, autoGenerate?: boolean, autoRunId?: string | null) => Promise<boolean>;
  onConnectGflowCli: () => Promise<string>;
  onLoadBrowserFlowWorkflow: (sessionId: string | null) => void;
   onGenerateScript: (approved: boolean, referenceContext?: string) => Promise<LocalScriptDocument | null>;
  onChooseSource: () => Promise<string | null>;
  onImport: (input: { sourcePath: string; title: string; mediaKind: string; sourceUri: string | null; tags: string[]; note: string; rightsStatus: AssetView["rightsStatus"] }) => Promise<AssetView | null>;
  onCreateReferenceSet: (input: { name: string; scope: ReferenceSet["scope"]; continuityNote: string }) => Promise<ReferenceSet | null>;
  onAssignReference: (input: { referenceSetId: string; assetId: string; role: ReferenceAssignment["role"]; strength: number; priority: number; shotId: string; notes: string; approved: boolean }) => Promise<ReferenceSet | null>;
  onDetachReference: (assignmentId: string) => Promise<boolean>;
  onOpenAdvanced: () => void;
}) {
  const [referenceAsset, setReferenceAsset] = useState<AssetView | null>(null);
  const [scriptDraft, setScriptDraft] = useState<LocalScriptDocument | null>(localScriptReview?.script ?? null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(localScriptReview?.script?.segments[0]?.segmentId ?? null);
  // The app shell owns the single live terminal. Keep workflow activity in
  // that data source instead of rendering a second copy inside this panel.
  const [blenderPreviewReport, setBlenderPreviewReport] = useState<BlenderShotPreviewReport | null>(null);
  const [previewCacheKey] = useState(() => Date.now());
  const [geminiAssets, setGeminiAssets] = useState<AssetView[]>([]);
  const [revisionPrompt, setRevisionPrompt] = useState("");
  const [comfyuiAssets, setComfyuiAssets] = useState<AssetView[]>([]);
  const [, setComfyuiGenerating] = useState(false);
  const [flowImageReview, setFlowImageReview] = useState<FlowImageReviewRequest | null>(null);
  const flowImageReviewResolverRef = useRef<((approved: boolean) => void) | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState("Phiên video mới");
  const [sessionSaving, setSessionSaving] = useState(false);
  const [canvasGraphDrafts, setCanvasGraphDrafts] = useState<Record<string, CanvasGraph>>({});
  const [dirtyCanvasSessionIds, setDirtyCanvasSessionIds] = useState<Set<string>>(() => new Set());
  const [flowProjectId, setFlowProjectId] = useState("");
  const [flowProjectName, setFlowProjectName] = useState("");
  const [savedFlowProjects, setSavedFlowProjects] = useState<SavedGoogleFlowProject[]>([]);
  const [flowProjectStorageReadyFor, setFlowProjectStorageReadyFor] = useState("");
  const [flowVideoModelSelecting, setFlowVideoModelSelecting] = useState(false);
  const [flowVideoModelSelectedFor, setFlowVideoModelSelectedFor] = useState("");
  const activeFlowProjectId = flowProjectStorageReadyFor === projectId && savedFlowProjects.some((item) => item.projectId === flowProjectId)
    ? flowProjectId
    : "";
  useEffect(() => {
    setFlowVideoModelSelectedFor("");
  }, [activeFlowProjectId]);
  const [gflowAuthBusy, setGflowAuthBusy] = useState(false);
  const [autoPipelineBusy, setAutoPipelineBusy] = useState(false);
  const autoPipelineLockRef = useRef(false);
  const lastAssetGenerationBlockerRef = useRef<string | null>(null);
  const canvasGraphRef = useRef<CanvasGraph | null>(null);
  const sessionSaveLockRef = useRef(false);
  const canvasGraphRevisionRef = useRef(0);
  const pendingSessionAutosaveRef = useRef(false);
  const saveCurrentSessionRef = useRef<(announce?: boolean) => Promise<VideoWorkflowSession | null>>(async () => null);
  const sessionIdentityRef = useRef({ projectId, activeSessionId, sessionName });
  sessionIdentityRef.current = { projectId, activeSessionId, sessionName };
  // The shell keeps the previous project's session list in state while the new
  // one loads, so every session lookup is scoped to the selected project.
  const projectSessions = useMemo(() => videoSessions.filter((session) => session.projectId === projectId), [videoSessions, projectId]);
  const projectSessionsRef = useRef<VideoWorkflowSession[]>(projectSessions);
  projectSessionsRef.current = projectSessions;
  const graphSessionId = activeSessionId ?? "video-session-draft";
  const activeSession = activeSessionId ? projectSessions.find((session) => session.sessionId === activeSessionId) ?? null : null;
  // The fallback directory is only meaningful for a session this project owns;
  // a stale id would otherwise display a folder that does not exist here.
  const activeSessionDirectory = activeSession ? activeSession.sessionDirectory || `outputs/sessions/${activeSession.sessionId}` : null;
  const canvasSegmentIds = useMemo(() => scriptDraft?.segments.map((segment) => segment.segmentId) ?? [], [scriptDraft?.segments]);
  const savedCanvasGraph = activeSessionId ? canvasGraphDrafts[activeSessionId] ?? activeSession?.canvasGraph : undefined;
  const canvasGraph = useMemo(
    () => createCanvasGraphForSegments(graphSessionId, canvasSegmentIds, savedCanvasGraph),
    [graphSessionId, canvasSegmentIds, savedCanvasGraph],
  );
  const canvasGraphDirty = activeSessionId ? dirtyCanvasSessionIds.has(activeSessionId) : false;
  const selectedShotIndex = scriptDraft?.segments.findIndex((segment) => segment.segmentId === selectedSegmentId) ?? -1;
  const selectedShot = selectedShotIndex >= 0 ? scriptDraft?.segments[selectedShotIndex] ?? null : null;
  const scriptDraftRef = useRef(scriptDraft);
  scriptDraftRef.current = scriptDraft;
  canvasGraphRef.current = canvasGraph;
  const legacyBrowserFlowRecoveryRef = useRef<string | null>(null);
  const autoResumedProjectRef = useRef<string | null>(null);
  const promptDirtyRef = useRef(false);
  const saveSessionRef = useRef(onSaveSession);
  const [shotReferenceBindings, setShotReferenceBindings] = useState<ShotReferenceBinding[]>([]);
  const [shotReferenceBusy, setShotReferenceBusy] = useState(false);
  const [existingReferenceAssetId, setExistingReferenceAssetId] = useState("");
  const shotReferenceBindingsRef = useRef<ShotReferenceBinding[]>([]);
  // The exact text the paid run would type for the selected shot. A source
  // segment longer than the per-shot limit is cut into several paid parts, each
  // with its own prompt and its own shot/revision identity, so every part is
  // previewed: showing only the first would hide what the run actually sends.
  // RUN_ID is the only line that differs per run, and it is excluded from the
  // shot's stable input hash, so this preview is the text that gets approved.
  const selectedShotPromptPreviews = useMemo(() => {
    if (!scriptDraft || !selectedShot || selectedShotIndex < 0) return null;
    const parts = flowSegmentsForGeneration(scriptDraft)
      .map((part, flowIndex) => ({ part, flowIndex }))
      .filter(({ part }) => part.sourceIndex === selectedShotIndex);
    if (!parts.length) return null;
    const binding = shotReferenceBindings.find((item) => item.segmentId === parts[0].part.sourceSegmentId) ?? null;
    const previews: { partNumber: number; partCount: number; prompt: string }[] = [];
    for (const { part, flowIndex } of parts) {
      // A split part carries its own revision identity, exactly as the run does.
      const revisionId = `${part.segment.revisionId || "rev-001"}${part.partCount > 1 ? `-part-${String(part.partIndex + 1).padStart(2, "0")}` : ""}`;
      const prompt = buildBrowserFlowShotPrompt(
        scriptDraft,
        part.segment,
        flowIndex,
        "auto-preview-browser-flow",
        revisionId,
        activeFlowProjectId ? { providerProjectKey: activeFlowProjectId } : null,
        activeSessionId,
        topic.trim(),
        selectedShotIndex + 1,
        binding ? { role: binding.role } : null,
      );
      if (!prompt) return null;
      previews.push({ partNumber: part.partIndex + 1, partCount: part.partCount, prompt });
    }
    return previews;
  }, [activeFlowProjectId, activeSessionId, flowProjectName, scriptDraft, selectedShot, selectedShotIndex, shotReferenceBindings, topic]);
  const selectedShotBinding = useMemo(
    () => (selectedShot ? shotReferenceBindings.find((item) => item.segmentId === selectedShot.segmentId) ?? null : null),
    [selectedShot, shotReferenceBindings],
  );
  const shotReferenceBusyRef = useRef(false);
  // Pins one assignment to the project, session and segment that requested it,
  // so neither a project nor a session switch during the async
  // import/assign/save sequence can write it anywhere else. It also carries the
  // preview path so the save never needs the live script to be mutated first.
  const pendingShotBindingRef = useRef<{
    projectId: string;
    sessionId: string;
    segmentId: string;
    bindings: ShotReferenceBinding[];
    previewPath: string;
  } | null>(null);
  const referenceSetsRef = useRef<ReferenceSet[]>(referenceSets);
  referenceSetsRef.current = referenceSets;
  const assetsRef = useRef<AssetView[]>(assets);
  assetsRef.current = assets;
  // Manual Flow binding state. The discovered cards are transient: they exist
  // only for the side-by-side comparison and are never written to a session or
  // a report, so switching project, session or Flow project discards them.
  const [flowPreflight, setFlowPreflight] = useState<ShotReferenceFlowPreflight | null>(null);
  const [flowCards, setFlowCards] = useState<FlowImageCard[]>([]);
  const [flowCardsProjectId, setFlowCardsProjectId] = useState("");
  const [flowCardsMessage, setFlowCardsMessage] = useState("");
  const [flowCardSelection, setFlowCardSelection] = useState("");
  const [flowBindingBusy, setFlowBindingBusy] = useState(false);
  const flowBindingBusyRef = useRef(false);
  const [flowCardDiscovery, setFlowCardDiscovery] = useState<FlowBindingIdentity | null>(null);
  useEffect(() => {
    setFlowPreflight(null);
    setFlowCards([]);
    setFlowCardsProjectId("");
    setFlowCardsMessage("");
    setFlowCardSelection("");
    setFlowCardDiscovery(null);
  }, [activeSessionId, projectId, activeFlowProjectId]);

  useEffect(() => {
    if (!projectId) {
      setFlowProjectId("");
      setFlowProjectName("");
      setSavedFlowProjects([]);
      setFlowProjectStorageReadyFor("");
      return;
    }

    const storageKey = `auto3dvideo.google-flow-projects.${projectId}`;
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(storageKey); } catch { /* Project selection stays usable without storage. */ }
    let settings = parseGoogleFlowProjectSettings(stored);

    if (!stored) {
      try {
        const legacyId = window.localStorage.getItem("auto3dvideo.googleFlowProjectId")?.trim() ?? "";
        if (legacyId.length >= 8 && legacyId.length <= 128) {
          const name = `Google Flow ${legacyId.slice(0, 8)}`;
          settings = { selectedProjectId: legacyId, projects: [{ projectId: legacyId, name }] };
          window.localStorage.setItem(storageKey, JSON.stringify(settings));
          window.localStorage.removeItem("auto3dvideo.googleFlowProjectId");
        }
      } catch { /* Legacy ID remains recoverable if the storage migration cannot write. */ }
    }

    const selected = settings.projects.find((item) => item.projectId === settings.selectedProjectId);
    setSavedFlowProjects(settings.projects);
    setFlowProjectId(settings.selectedProjectId);
    setFlowProjectName(selected?.name ?? "");
    setFlowProjectStorageReadyFor(projectId);
  }, [projectId]);

  useEffect(() => {
    if (!projectId || flowProjectStorageReadyFor !== projectId) return;
    const settings: GoogleFlowProjectSettings = {
      selectedProjectId: flowProjectId,
      projects: savedFlowProjects,
    };
    try {
      window.localStorage.setItem(`auto3dvideo.google-flow-projects.${projectId}`, JSON.stringify(settings));
    } catch { /* Saved provider projects are a local convenience and never block generation. */ }
  }, [flowProjectId, flowProjectStorageReadyFor, projectId, savedFlowProjects]);

  function saveFlowProject() {
    const id = flowProjectId.trim();
    const name = flowProjectName.trim();
    if (!projectId) {
      onNotice("Chọn project Auto3Dvideo trước khi lưu project Google Flow.");
      return;
    }
    if (id.length < 8 || id.length > 128 || /\s/.test(id) || !name || name.length > 120) {
      onNotice("Nhập tên dễ nhớ và Project ID Flow hợp lệ (8–128 ký tự, không có khoảng trắng).");
      return;
    }
    setSavedFlowProjects((current) => [...current.filter((item) => item.projectId !== id), { projectId: id, name }].sort((left, right) => left.name.localeCompare(right.name)));
    setFlowProjectId(id);
    onNotice(`Đã lưu “${name}” làm project Google Flow mặc định cho project local này.`);
  }

  function removeFlowProject() {
    if (!flowProjectId || !savedFlowProjects.some((item) => item.projectId === flowProjectId)) return;
    setSavedFlowProjects((current) => current.filter((item) => item.projectId !== flowProjectId));
    setFlowProjectId("");
    setFlowProjectName("");
    onNotice("Đã bỏ project Flow khỏi danh sách local; project trên Google Flow không bị xóa.");
  }

  async function selectFlowVideoModel() {
    if (!projectId || !activeFlowProjectId || flowProjectStorageReadyFor !== projectId || flowVideoModelSelecting) {
      onNotice("Chọn project Auto3Dvideo và project Google Flow đã lưu trước khi chọn model video.");
      return;
    }
    setFlowVideoModelSelecting(true);
    setFlowVideoModelSelectedFor("");
    try {
      const report = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
        projectId,
        request: {
          projectUrl: `https://flow.google.com/project/${activeFlowProjectId}`,
          mode: "select_video_model",
          model: "Omni 1.1 Flash",
          runId: `flow-model-${Date.now()}`,
        },
      });
      const selected = report.status === "ready"
        && report.modelSelected
        && report.videoModeFound === true
        && report.videoComposerReady === true
        && /\bOmni 1\.1 Flash\b/i.test(report.selectedModel || "");
      const message = selected
        ? `Đã chọn và xác nhận Omni 1.1 Flash trong project Flow ${flowProjectName || activeFlowProjectId}. Chưa nhập prompt và chưa Generate.`
        : `Flow chưa xác nhận Omni 1.1 Flash cùng video composer: ${report.message}`;
      setFlowVideoModelSelectedFor(selected ? activeFlowProjectId : "");
      onNotice(message);
      onActivity({
        stage: "google_flow.video_model.select",
        tool: "BrowserOS / Google Flow",
        state: selected ? "success" : "blocked",
        message,
        output: report.reportPath,
        nextAction: selected ? "Kiểm tra video composer; chỉ chạy shot sau khi đã xem estimate/credit và duyệt." : "Mở đúng project Flow, chọn model video khả dụng trong UI rồi thử lại; không Generate.",
      });
    } catch (error) {
      const detail = String(error).replace(/^Error:\s*/i, "").slice(0, 360);
      const message = `Không chọn được model Flow: ${detail}`;
      onNotice(message);
      onActivity({
        stage: "google_flow.video_model.select",
        tool: "BrowserOS / Google Flow",
        state: "blocked",
        message,
        nextAction: "Kiểm tra BrowserOS, project Flow và model video trong UI; chưa nhập prompt hoặc Generate.",
      });
    } finally {
      setFlowVideoModelSelecting(false);
    }
  }


  function resolveFlowImageReview(approved: boolean) {
    const resolver = flowImageReviewResolverRef.current;
    flowImageReviewResolverRef.current = null;
    setFlowImageReview(null);
    resolver?.(approved);
  }

  function waitForFlowImageReview(request: FlowImageReviewRequest): Promise<boolean> {
    const previousResolver = flowImageReviewResolverRef.current;
    flowImageReviewResolverRef.current = null;
    previousResolver?.(false);
    setFlowImageReview(request);
    onNotice(`${request.shotId}: ảnh đã tải và import. Đang chờ bạn xác nhận trước khi làm shot tiếp.`);
    onActivity({
      stage: "google_flow.image_review",
      tool: "Human review / Asset Library",
      state: "waiting_user",
      progress: undefined,
      message: `${request.shotId}: ảnh đã tải về và đăng ký Asset Library; workflow đang tạm dừng để bạn kiểm tra ảnh thật.`,
      output: request.asset.relativePath,
      nextAction: request.remainingShots > 0
        ? "Xem ảnh rồi bấm “Ảnh đúng — làm tiếp”; nếu sai, bấm “Ảnh sai — dừng tại shot này”."
        : "Xem ảnh rồi bấm “Ảnh đúng — hoàn tất”; nếu sai, bấm “Ảnh sai — dừng tại shot này”.",
    });
    return new Promise<boolean>((resolve) => {
      flowImageReviewResolverRef.current = resolve;
    });
  }

  useEffect(() => {
    saveSessionRef.current = onSaveSession;
  }, [onSaveSession]);

  useEffect(() => {
    setScriptDraft(localScriptReview?.script ?? null);
    setSelectedSegmentId(localScriptReview?.script?.segments[0]?.segmentId ?? null);
    setBlenderPreviewReport(null);
  }, [localScriptReview]);

  useEffect(() => {
    const segments = scriptDraft?.segments ?? [];
    if (selectedSegmentId && segments.some((segment) => segment.segmentId === selectedSegmentId)) return;
    setSelectedSegmentId(segments[0]?.segmentId ?? null);
  }, [scriptDraft?.segments, selectedSegmentId]);

  useEffect(() => {
    flowImageReviewResolverRef.current?.(false);
    flowImageReviewResolverRef.current = null;
    setFlowImageReview(null);
    setActiveSessionId(null);
    setCanvasGraphDrafts({});
    setDirtyCanvasSessionIds(new Set());
    canvasGraphRef.current = null;
    canvasGraphRevisionRef.current = 0;
    pendingSessionAutosaveRef.current = false;
    setSelectedSegmentId(null);
    setSessionName("Phiên video mới");
    setScriptDraft(null);
    setReferenceAsset(null);
    setGeminiAssets([]);
    setComfyuiAssets([]);
    setBlenderPreviewReport(null);
    autoResumedProjectRef.current = null;
    promptDirtyRef.current = false;
  }, [projectId]);

  useEffect(() => {
    const [latestSession] = projectSessions;
    if (!projectId || promptDirtyRef.current || activeSessionId || scriptDraft || autoResumedProjectRef.current === projectId || !latestSession) return;
    autoResumedProjectRef.current = projectId;
    openVideoSession(latestSession);
  }, [projectId, projectSessions, activeSessionId, scriptDraft]);

  useEffect(() => {
    if (!projectId || !scriptDraft || promptDirtyRef.current) return;
    const restoredReferenceContext = (scriptDraft.referenceAssetPaths ?? []).length
      ? `Ảnh tham chiếu local: ${(scriptDraft.referenceAssetPaths ?? []).join(", ")}`
      : "";
    void currentPromptContract(restoredReferenceContext).then(({ requirements, sourcePromptHash }) => {
      if (!scriptDraft || promptDirtyRef.current || scriptMatchesPrompt(scriptDraft, sourcePromptHash, requirements)) return;
      invalidateStaleWorkflow("Phiên cache được mở nhưng sourcePromptHash/shot count/thời lượng không khớp prompt hiện tại; đã loại workflow cũ.");
    });
  }, [projectId, topic, promptObjective, additionalPrompt, scriptDraft?.sourcePromptHash, scriptDraft?.requestedShotCount, scriptDraft?.requestedDurationSeconds, scriptDraft?.segments.length, scriptDraft?.totalDurationSeconds]);

  function handleTopicChange(value: string) {
    resolveFlowImageReview(false);
    promptDirtyRef.current = true;
    autoResumedProjectRef.current = projectId;
    onTopicChange(value);
    // A prompt edit starts a new source revision. Do not autosave the new
    // topic together with the previous script/preview/provider workflow.
    setScriptDraft(null);
    setBlenderPreviewReport(null);
    setGeminiAssets([]);
    setComfyuiAssets([]);
    setSelectedSegmentId(null);
    setShotReferenceBindings([]);
    shotReferenceBindingsRef.current = [];
    onLoadBrowserFlowWorkflow(null);
    onNotice("Prompt đã đổi: script, Blender preview, asset và Flow workflow cũ đã được đánh dấu stale; hãy chạy lại từ prompt mới.");
    onActivity({ stage: "storyboard.invalidate", tool: "Prompt source guard", state: "info", message: "Đã loại cache workflow cũ vì prompt nguồn thay đổi.", nextAction: "Bấm Tự làm toàn bộ để tạo lại đúng shot count và thời lượng." });
  }

  async function currentPromptContract(referenceContext = "") {
    const requirements = inferPromptTimingRequirements(topic);
    const sourcePromptHash = await sha256Text(promptSourceFingerprintInput(topic, promptObjective, additionalPrompt, referenceContext));
    return { requirements, sourcePromptHash };
  }

  function invalidateStaleWorkflow(reason: string) {
    setScriptDraft(null);
    setBlenderPreviewReport(null);
    setGeminiAssets([]);
    setComfyuiAssets([]);
    setSelectedSegmentId(null);
    setShotReferenceBindings([]);
    shotReferenceBindingsRef.current = [];
    onLoadBrowserFlowWorkflow(null);
    onActivity({ stage: "storyboard.invalidate", tool: "Prompt source guard", state: "blocked", message: reason, nextAction: "Tạo lại script từ prompt hiện tại; cache cũ không được dùng." });
  }

  function sessionAssetPaths() {
    return {
      referenceAssetPaths: [...new Set([...(scriptDraft?.referenceAssetPaths ?? []), ...(referenceAsset ? [referenceAsset.relativePath] : [])])].filter(Boolean).slice(0, 8),
      geminiAssetPaths: [...new Set([...(scriptDraft?.geminiAssetPaths ?? []), ...geminiAssets.map((asset) => asset.relativePath)])].filter(Boolean).slice(0, 8),
      // Flow reference images are one-per-shot; retain all shot bindings in
      // the resumable session instead of using the generic eight-reference cap.
      comfyuiAssetPaths: [...new Set([...(scriptDraft?.comfyuiAssetPaths ?? []), ...comfyuiAssets.map((asset) => asset.relativePath)])].filter(Boolean).slice(0, 32),
    };
  }

  function makeSessionInput(sessionId = activeSessionId, includeCanvasGraph = false): VideoWorkflowSessionInput | null {
    if (!projectId || !topic.trim()) return null;
    // A session id that is not a row of the selected project must never be
    // written: the backend would push it into this project's manifest as a new
    // session. A null id is a legitimate new draft and stays allowed.
    if (sessionId && !projectSessions.some((session) => session.sessionId === sessionId)) {
      onNotice("The active session is no longer part of this project, so it was not saved. Open a session of this project and try again.");
      return null;
    }
    const paths = sessionAssetPaths();
    const baseScript = scriptDraft ? { ...scriptDraft, referenceAssetPaths: paths.referenceAssetPaths, geminiAssetPaths: paths.geminiAssetPaths, comfyuiAssetPaths: paths.comfyuiAssetPaths } : null;
    // A pending assignment is pinned to one project, session and segment, so
    // neither a project nor a session switch can write it somewhere else. Every
    // other save writes the live binding list. Bindings are also trimmed to the
    // segments the persisted script still contains, because the backend rejects
    // a binding whose segment is absent and that would block every later save.
    const pinned = pendingShotBindingRef.current;
    const pinApplies = Boolean(sessionId) && pinned !== null && pinned.projectId === projectId && pinned.sessionId === sessionId;
    const bindingSource = pinApplies && pinned ? pinned.bindings : shotReferenceBindingsRef.current;
    const script = pinApplies && pinned && baseScript
      ? {
        ...baseScript,
        segments: baseScript.segments.map((segment) => segment.segmentId === pinned.segmentId
          ? { ...segment, revisionImagePath: pinned.previewPath, dirty: true }
          : segment),
      }
      : baseScript;
    const savedBindings = shotReferenceBindingsForScript(bindingSource, script);
    const status = scriptDraft ? (blenderPreviewReport ? (paths.comfyuiAssetPaths.length ? "comfyui_ready" : paths.geminiAssetPaths.length ? "gemini_ready" : "preview_ready") : "storyboard_ready") : "draft";
    const lastStep = scriptDraft ? (blenderPreviewReport ? (paths.comfyuiAssetPaths.length ? "comfyui-image" : paths.geminiAssetPaths.length ? "gemini" : "blender") : "storyboard") : "topic";
    const typedName = sessionName.trim();
    const placeholderName = !typedName || /^Phiên video mới(?:\s·.*)?$/i.test(typedName);
    const fallbackName = (script?.title || topic.trim().replace(/\s+/g, " ")).slice(0, 160);
    const storedSession = sessionId ? projectSessions.find((session) => session.sessionId === sessionId) ?? null : null;
    const candidateGraph = sessionId
      ? (sessionId === activeSessionId && canvasGraphRef.current?.sessionId === sessionId
        ? canvasGraphRef.current
        : canvasGraphDrafts[sessionId] ?? storedSession?.canvasGraph ?? null)
      : null;
    const input = {
      projectId,
      sessionId,
      name: (placeholderName ? fallbackName : typedName) || "Phiên video mới",
      topic: topic.trim(),
      title: (script?.title || topic.trim()).slice(0, 240),
      durationSeconds: script?.totalDurationSeconds ?? null,
      status,
      lastStep,
      script,
      referenceAssetPaths: paths.referenceAssetPaths,
      geminiAssetPaths: paths.geminiAssetPaths,
      comfyuiAssetPaths: paths.comfyuiAssetPaths,
      blenderPreview: blenderPreviewReport,
      ...(savedBindings.length || pinApplies ? { shotReferenceBindings: savedBindings } : {}),
    };
    return withCanvasGraphForSessionSave(input, candidateGraph, {
      explicitSave: includeCanvasGraph,
      layoutDirty: Boolean(sessionId && dirtyCanvasSessionIds.has(sessionId)),
      persistedGraph: storedSession?.canvasGraph,
    });
  }
  function handleCanvasGraphChange(graph: CanvasGraph) {
    const sessionId = activeSessionId;
    if (!sessionId || graph.sessionId !== sessionId) return;
    const nextGraph = createCanvasGraphForSegments(sessionId, canvasSegmentIds, graph);
    canvasGraphRevisionRef.current += 1;
    canvasGraphRef.current = nextGraph;
    setCanvasGraphDrafts((current) => ({ ...current, [sessionId]: nextGraph }));
    setDirtyCanvasSessionIds((current) => {
      if (current.has(sessionId)) return current;
      const next = new Set(current);
      next.add(sessionId);
      return next;
    });
    if (sessionSaveLockRef.current) pendingSessionAutosaveRef.current = true;
  }

  async function saveCurrentSession(announce = true): Promise<VideoWorkflowSession | null> {
    if (sessionSaveLockRef.current) {
      if (!announce) pendingSessionAutosaveRef.current = true;
      return null;
    }
    const input = makeSessionInput(activeSessionId, announce);
    if (!input) {
      onNotice("Nhập chủ đề/prompt trước để tạo hoặc lưu phiên.");
      return null;
    }
    const projectIdAtSave = projectId;
    const activeSessionIdAtSave = activeSessionId;
    const sessionNameAtSave = sessionName;
    const graphRevisionAtSave = canvasGraphRevisionRef.current;
    sessionSaveLockRef.current = true;
    setSessionSaving(true);
    if (announce) {
      onNotice("Đang lưu phiên, manifest và thư mục session…");
      onActivity({ stage: "video_session.save", tool: "Session workspace", state: "running", message: "Đang ghi chủ đề, shot, asset, bố cục canvas và tiến độ vào phiên local.", nextAction: "Chờ app xác nhận đã lưu xong." });
    }
    try {
      const saved = await saveSessionRef.current(input, announce);
      if (saved) {
        const currentSession = sessionIdentityRef.current;
        if (currentSession.projectId !== projectIdAtSave || currentSession.activeSessionId !== activeSessionIdAtSave || saved.projectId !== projectIdAtSave) return saved;
        setActiveSessionId(saved.sessionId);
        if (currentSession.sessionName === sessionNameAtSave) setSessionName(saved.name);
        if (input.canvasGraph && input.canvasGraph.sessionId === saved.sessionId) {
          if (canvasGraphRevisionRef.current !== graphRevisionAtSave) {
            pendingSessionAutosaveRef.current = true;
          } else {
            setCanvasGraphDrafts((current) => ({ ...current, [saved.sessionId]: input.canvasGraph! }));
            setDirtyCanvasSessionIds((current) => {
              if (!current.has(saved.sessionId)) return current;
              const next = new Set(current);
              next.delete(saved.sessionId);
              return next;
            });
          }
        }
      }
      return saved;
    } finally {
      sessionSaveLockRef.current = false;
      setSessionSaving(false);
    }
  }
  saveCurrentSessionRef.current = saveCurrentSession;
  useEffect(() => {
    if (sessionSaving || !pendingSessionAutosaveRef.current) return;
    pendingSessionAutosaveRef.current = false;
    void saveCurrentSessionRef.current(false);
  }, [sessionSaving]);

  function openVideoSession(session: VideoWorkflowSession) {
    resolveFlowImageReview(false);
    promptDirtyRef.current = false;
    // A session row from another project can still be in shell state while the
    // new project loads, and the backend would happily create it as a new one.
    if (session.projectId && session.projectId !== projectId) {
      onNotice(`Session “${session.name}” belongs to another project and was not opened.`);
      return;
    }
    setActiveSessionId(session.sessionId);
    setSessionName(session.name);
    onTopicChange(session.topic);
    setScriptDraft(session.script);
    // Legacy sessions may still contain a Blender preview. The active studio
    // route is provider-first and must not resurrect that retired UI.
    setBlenderPreviewReport(null);
    setReferenceAsset(null);
    setGeminiAssets([]);
    setComfyuiAssets([]);
    setSelectedSegmentId(session.script?.segments[0]?.segmentId ?? null);
    const storedBindings = shotReferenceBindingsForScript(session.shotReferenceBindings ?? [], session.script);
    const droppedBindingCount = (session.shotReferenceBindings?.length ?? 0) - storedBindings.length;
    shotReferenceBindingsRef.current = storedBindings;
    setShotReferenceBindings(storedBindings);
    pendingShotBindingRef.current = null;
    setExistingReferenceAssetId("");
    if (droppedBindingCount > 0) {
      onNotice(`Session “${session.name}” kept ${storedBindings.length} shot reference(s); ${droppedBindingCount} referred to shots the saved script no longer contains and were not loaded.`);
    }
    onLoadBrowserFlowWorkflow(session.sessionId);
    onNotice(`Đã mở phiên “${session.name}”; khôi phục ${session.title || "video chưa đặt tiêu đề"} và trạng thái ${session.lastStep}.`);
    onActivity({ stage: "video_session.open", tool: "Workspace cache", state: "success", message: `Đã khôi phục phiên “${session.name}” từ cache local.`, nextAction: "Tiếp tục sửa prompt/shot hoặc dựng preview." });
  }

  function createNewVideoSession() {
    resolveFlowImageReview(false);
    promptDirtyRef.current = false;
    setActiveSessionId(null);
    setSessionName(`Phiên video mới · ${new Date().toLocaleDateString("vi-VN")}`);
    onTopicChange("");
    setScriptDraft(null);
    setBlenderPreviewReport(null);
    setReferenceAsset(null);
    setGeminiAssets([]);
    setComfyuiAssets([]);
    setSelectedSegmentId(null);
    setShotReferenceBindings([]);
    shotReferenceBindingsRef.current = [];
    pendingShotBindingRef.current = null;
    setExistingReferenceAssetId("");
    onLoadBrowserFlowWorkflow(null);
    onNotice("Đã tạo khung phiên video mới. Nhập một prompt để hệ thống tự lưu và nhớ tiến độ.");
    onActivity({ stage: "video_session.create", tool: "Workspace cache", state: "info", message: "Đã mở phiên video mới; chưa ghi cache vì chưa có prompt.", nextAction: "Nhập prompt rồi bấm Phân tích & dựng workflow." });
  }

  async function startBrowserFlowFromWorkspace(nextScript: LocalScriptDocument | null = scriptDraft, nextPreview: BlenderShotPreviewReport | null = blenderPreviewReport, autoGenerate = false, autoRunId: string | null = null) {
    const referenceContext = nextScript && sessionAssetPaths().referenceAssetPaths.length
      ? `Ảnh tham chiếu local: ${sessionAssetPaths().referenceAssetPaths.join(", ")}`
      : "";
    const promptContract = nextScript ? await currentPromptContract(referenceContext) : null;
    if (nextScript && promptContract && !scriptMatchesPrompt(nextScript, promptContract.sourcePromptHash, promptContract.requirements)) {
      invalidateStaleWorkflow(`Browser Flow bị chặn: script/preview không khớp prompt hiện tại (${promptContract.requirements.shotCount ?? "theo prompt"} shot / ${promptContract.requirements.durationSeconds ?? "thời lượng suy ra"} giây).`);
      return false;
    }
    let sessionId = activeSessionId;
    if (!sessionId) {
      const saved = await saveCurrentSession(false);
      sessionId = saved?.sessionId ?? null;
    }
    if (!sessionId) {
      onNotice("Chưa tạo được session local; chưa chạy Google Flow.");
      return false;
    }
    const paths = {
      referenceAssetPaths: [...new Set([...(nextScript?.referenceAssetPaths ?? []), ...(referenceAsset ? [referenceAsset.relativePath] : [])])].filter(Boolean).slice(0, 8),
      geminiAssetPaths: [...new Set([...(nextScript?.geminiAssetPaths ?? []), ...geminiAssets.map((asset) => asset.relativePath)])].filter(Boolean).slice(0, 8),
      comfyuiAssetPaths: [...new Set([...(nextScript?.comfyuiAssetPaths ?? []), ...comfyuiAssets.map((asset) => asset.relativePath)])].filter(Boolean).slice(0, 32),
    };

    const targetedScript = nextScript ? { ...nextScript, ...paths, flowProjectId: activeFlowProjectId } : null;
    return await onStartBrowserFlowDiscovery(targetedScript, nextPreview, sessionId, autoGenerate, autoRunId);
  }

  useEffect(() => {
    if (!browserFlowWorkflow || !scriptDraft || !blenderPreviewReport || browserFlowBusy) return;
    const promptMilestone = browserFlowWorkflow.roadmap.find((item) => item.milestoneId === "roadmap-prompt");
    const hasTypeProcess = browserFlowWorkflow.processes.some((process) => process.operation === "type");
    const needsAutomaticRecovery = !promptMilestone || (promptMilestone.status === "blocked" && !hasTypeProcess);
    const recoveryKey = `auto-project-ref-v1:${browserFlowWorkflow.sessionId ?? browserFlowWorkflow.workflowId}`;
    if (!needsAutomaticRecovery || legacyBrowserFlowRecoveryRef.current === recoveryKey) return;
    legacyBrowserFlowRecoveryRef.current = recoveryKey;
    const message = "Đang tự nối lại workflow của session hiện tại để giữ nguyên tab Connect và nạp prompt; không hỏi lại từng bước.";
    onNotice(message);
    onActivity({ stage: "browser_flow.legacy_recovery", tool: "BrowserMCP", state: "running", message, nextAction: "Đang quét lại tab Connect và khôi phục roadmap mới." });
    void startBrowserFlowFromWorkspace(scriptDraft, blenderPreviewReport);
  }, [browserFlowWorkflow, scriptDraft, blenderPreviewReport, browserFlowBusy, activeSessionId]);

  useEffect(() => {
    if (!topic.trim() || !projectId) return;
    const timer = window.setTimeout(() => {
      void saveCurrentSession(false);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [scriptDraft, topic, sessionName, blenderPreviewReport, referenceAsset, geminiAssets, comfyuiAssets, projectId, activeSessionId]);

  async function attachReference() {
    if (!projectId) {
      const message = "Chưa có project để nhập ảnh tham chiếu.";
      onNotice(message);
      onActivity({ stage: "asset.import.validate", tool: "Asset Library", state: "blocked", message, nextAction: "Tạo hoặc chọn project local." });
      return;
    }
    const sourcePath = await onChooseSource();
    if (!sourcePath) return;
    const title = sourcePath.split(/[\\/]/).pop() ?? "Ảnh tham chiếu";
    const imported = await onImport({
      sourcePath,
      title,
      mediaKind: "image",
      sourceUri: null,
      tags: ["prompt-reference"],
      note: "Ảnh tham chiếu do người dùng đính kèm cho workflow tự động.",
      rightsStatus: "pending",
    });
    if (imported) {
      setReferenceAsset(imported);
      onNotice(`Đã gắn ảnh tham chiếu “${imported.title}”; workflow sẽ giữ subject, màu và bố cục chính.`);
    }
  }

  async function ensureGoogleFlowImageComposer(workflow: BrowserFlowWorkflow): Promise<{ workflow: BrowserFlowWorkflow; promptRef?: BrowserFlowUiRef; domPromptComposer?: boolean; blocked: boolean; message: string }> {
    let latestWorkflow = workflow;
    const store = (next: BrowserFlowWorkflow) => {
      latestWorkflow = next;
      onLoadBrowserFlowWorkflow(activeSessionId);
    };
    const step = (operation: string, element: string | null = null, elementRef: string | null = null, time: number | null = null) => invoke<BrowserFlowWorkflowReport>("run_browser_flow_step", { request: { projectId, workflowId: latestWorkflow.workflowId, operation, approved: true, url: null, element, elementRef, text: null, submit: false, key: null, time } });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      let current: BrowserFlowWorkflowReport;
      try {
        current = await step("snapshot");
      } catch (error) {
        const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "snapshot không xác định";
        return { workflow: latestWorkflow, blocked: true, message: `Không đọc được snapshot image composer: ${detail.slice(0, 260)}` };
      }
      store(current.workflow);
      if (!current.workflow.browserSessionAttached) {
        return { workflow: latestWorkflow, blocked: true, message: `BrowserMCP chưa trả session/UI ref thật: ${current.message}` };
      }
      if (isGoogleFlowSignInPage(current.workflow)) {
        const message = "BLOCKED_GOOGLE_SIGN_IN: BrowserOS đang ở màn hình đăng nhập Google, chưa có phiên Google Flow. App không tự nhập tài khoản hoặc mật khẩu.";
        onActivity({ stage: "google_flow.auth_gate", tool: "BrowserOS / Google Account", state: "blocked", message, nextAction: "Đăng nhập Google một lần trong đúng cửa sổ/profile BrowserOS, giữ nguyên tab Flow rồi bấm Làm mới/Đọc trạng thái Flow." });
        return { workflow: latestWorkflow, blocked: true, message };
      }
      if (!current.workflow.providerProjectIdentity && !current.workflow.projectEntryConfirmed) {
        if (current.workflow.uiRefs.length === 0) {
          return { workflow: latestWorkflow, blocked: true, message: `BrowserMCP chưa trả UI ref để mở project: ${current.message}` };
        }
        const projectRef = findBrowserFlowProjectRef(current.workflow.uiRefs);
        if (!projectRef) {
          return { workflow: latestWorkflow, blocked: true, message: "Flow đang ở ngoài project nhưng snapshot chưa có ref Start Creating/New project an toàn." };
        }
        onActivity({ stage: "google_flow.project.acquire", tool: "BrowserMCP / Google Flow", state: "running", message: `Đang mở project Flow bằng ref mới “${projectRef.label}”; chưa nhập prompt và chưa tạo ảnh.`, nextAction: "Chờ URL /project/<id> rồi mới chọn composer Nano Banana." });
        const beforeProcessIds = new Set(current.workflow.processes.map((process) => process.processId));
        const clicked = await step("click_project", projectRef.label, projectRef.reference);
        const clickProcess = [...clicked.workflow.processes].reverse().find((process) => process.operation === "click_project" && !beforeProcessIds.has(process.processId));
        if (clicked.status !== "ready" || clickProcess?.state !== "succeeded") {
          return { workflow: clicked.workflow, blocked: true, message: `Không xác nhận được mở project Flow: ${clicked.message}` };
        }
        store(clicked.workflow);
        const settled = await step("wait", null, null, 2);
        if (!settled.workflow.browserSessionAttached || settled.workflow.uiRefs.length === 0) {
          return { workflow: settled.workflow, blocked: true, message: `Flow chưa ổn định sau khi mở project: ${settled.message}` };
        }
        store(settled.workflow);
        continue;
      }
      // Flow can leave the project composer on an image-detail route after an
      // output/revision transition. That route exposes Trash/Delete controls
      // and recycled accessibility refs, so it is never a valid composer
      // target. Return to the same pinned project before inspecting or typing.
      if (/\/project\/[^/]+\/edit(?:[/?#]|$)/i.test(current.workflow.currentUrl ?? "")) {
        const backRef = findBrowserFlowBackRef(current.workflow.uiRefs);
        if (backRef) {
          const beforeProcessIds = new Set(current.workflow.processes.map((process) => process.processId));
          onActivity({ stage: "google_flow.image_route_recover", tool: "BrowserMCP / Google Flow", state: "running", message: `Flow đang ở route /edit chi tiết ảnh; quay về project bằng ref Back mới “${backRef.label}”, không chạm Trash/Delete.`, nextAction: "Chờ project ổn định rồi đọc lại composer bằng DOM mới." });
          const backed = await step("click", backRef.label, backRef.reference);
          const newClick = [...backed.workflow.processes].reverse().find((process) => process.operation === "click" && !beforeProcessIds.has(process.processId));
          if (backed.status !== "ready" || newClick?.state !== "succeeded") {
            const message = `Không xác nhận được thoát route /edit bằng Back: ${backed.message}`;
            onActivity({ stage: "google_flow.image_route_recover", tool: "BrowserMCP / Google Flow", state: "blocked", message, nextAction: "Không click thêm; mở đúng project Flow rồi chạy resume." });
            return { workflow: backed.workflow, blocked: true, message };
          }
          store(backed.workflow);
          const settled = await step("wait", null, null, 2);
          if (settled.status !== "ready" || !settled.workflow.browserSessionAttached) {
            const message = `Project Flow chưa ổn định sau khi rời route /edit: ${settled.message}`;
            onActivity({ stage: "google_flow.image_route_recover", tool: "BrowserMCP / Google Flow", state: "blocked", message, nextAction: "Chờ tab Flow tải xong rồi chạy resume; không tạo project mới." });
            return { workflow: settled.workflow, blocked: true, message };
          }
          store(settled.workflow);
          continue;
        }
        const projectKey = current.workflow.providerProjectIdentity?.providerProjectKey;
        if (projectKey) {
          const projectUrl = `https://flow.google.com/project/${projectKey}`;
          onActivity({ stage: "google_flow.image_route_recover", tool: "BrowserMCP / Google Flow", state: "running", message: "Flow đang ở route /edit nhưng không có Back ref; điều hướng có kiểm soát về đúng provider project key, không mở project mới.", nextAction: "Chờ project hiện lại rồi đọc composer bằng snapshot mới." });
          const navigated = await invoke<BrowserFlowWorkflowReport>("run_browser_flow_step", { request: { projectId, workflowId: current.workflow.workflowId, operation: "navigate", approved: true, url: projectUrl, element: null, elementRef: null, text: null, submit: false, key: null, time: null } });
          if (navigated.status !== "ready") {
            const message = `Không điều hướng được về provider project từ route /edit: ${navigated.message}`;
            onActivity({ stage: "google_flow.image_route_recover", tool: "BrowserMCP / Google Flow", state: "blocked", message, nextAction: "Mở đúng URL project Flow rồi chạy resume; không click các nút trong detail overlay." });
            return { workflow: navigated.workflow, blocked: true, message };
          }
          store(navigated.workflow);
          const settled = await step("wait", null, null, 2);
          if (settled.status !== "ready" || !settled.workflow.browserSessionAttached) {
            const message = `Provider project chưa ổn định sau navigate từ route /edit: ${settled.message}`;
            onActivity({ stage: "google_flow.image_route_recover", tool: "BrowserMCP / Google Flow", state: "blocked", message, nextAction: "Chờ Flow tải xong rồi chạy resume; không mở Tools/Create New." });
            return { workflow: settled.workflow, blocked: true, message };
          }
          store(settled.workflow);
          continue;
        }
        const message = "Flow đang ở route /edit nhưng không có Back ref hoặc provider project key; khóa mọi click để không chạm Trash/Delete.";
        onActivity({ stage: "google_flow.image_route_recover", tool: "BrowserMCP / Google Flow", state: "blocked", message, nextAction: "Mở đúng project Flow rồi chạy resume; app không đoán ref trong detail route." });
        return { workflow: latestWorkflow, blocked: true, message };
      }
      // A destructive Flow overlay is never a valid image-composer state.
      // Do not auto-click Undo here: the overlay proves that a destructive
      // provider-side action already happened, and another guessed/stale ref
      // must never be sent while the page is in recovery UI. The user can
      // restore the items manually, then resume after a fresh snapshot.
      if (hasBrowserFlowDestructiveOverlay(current.workflow.uiRefs)) {
        const message = "FLOW_DESTRUCTIVE_OVERLAY_VISIBLE: Flow đang có overlay Trash/Delete; app khóa mọi click tự động để không xoá thêm. Khôi phục media thủ công bằng Undo/View in trash, rồi chụp snapshot mới trước khi resume.";
        onActivity({ stage: "google_flow.trash_recovery", tool: "BrowserMCP / Google Flow", state: "blocked", message, nextAction: "Khôi phục media trong Trash của Flow rồi bấm resume; app không click đoán." });
        return { workflow: latestWorkflow, blocked: true, message };
      }
      // A previous video-mode attempt may have left the shared Flow tab at
      // /tools. Image fallback must recover back to the same provider project
      // before asking the planner for image controls; it must never ask the
      // planner to click Tools again or create a new project.
      if (/\/tools(?:[/?#]|$)/i.test(current.workflow.currentUrl ?? "")) {
        const backRef = findBrowserFlowBackRef(current.workflow.uiRefs);
        if (backRef) {
          const beforeProcessIds = new Set(current.workflow.processes.map((process) => process.processId));
          onActivity({ stage: "google_flow.image_route_recover", tool: "BrowserMCP / Google Flow", state: "running", message: `Flow đang ở /tools; tự quay lại đúng project bằng ref mới “${backRef.label}”, không mở Tools lại.`, nextAction: "Chờ project ổn định rồi đọc lại image composer." });
          const backed = await step("click", backRef.label, backRef.reference);
          const newClick = [...backed.workflow.processes].reverse().find((process) => process.operation === "click" && !beforeProcessIds.has(process.processId));
          if (backed.status !== "ready" || newClick?.state !== "succeeded") {
            const message = `Không xác nhận được quay lại project từ /tools: ${backed.message}`;
            onActivity({ stage: "google_flow.image_route_recover", tool: "BrowserMCP / Google Flow", state: "blocked", message, nextAction: "Giữ tab Flow ở project hiện tại rồi đọc snapshot lại; không bấm Tools." });
            return { workflow: backed.workflow, blocked: true, message };
          }
          store(backed.workflow);
          const settled = await step("wait", null, null, 2);
          if (settled.status !== "ready" || !settled.workflow.browserSessionAttached) {
            const message = `Project Flow chưa ổn định sau khi rời /tools: ${settled.message}`;
            onActivity({ stage: "google_flow.image_route_recover", tool: "BrowserMCP / Google Flow", state: "blocked", message, nextAction: "Chờ tab Flow tải xong rồi chạy resume; không tạo project mới." });
            return { workflow: settled.workflow, blocked: true, message };
          }
          store(settled.workflow);
          continue;
        }
        const projectKey = current.workflow.providerProjectIdentity?.providerProjectKey;
        if (projectKey) {
          const projectUrl = `https://flow.google.com/project/${projectKey}`;
          onActivity({ stage: "google_flow.image_route_recover", tool: "BrowserMCP / Google Flow", state: "running", message: "Flow đang ở /tools nhưng không có Back ref; điều hướng có kiểm soát về đúng provider project key hiện tại.", nextAction: "Chờ project hiện lại rồi đọc image composer bằng DOM/snapshot mới." });
          const navigated = await invoke<BrowserFlowWorkflowReport>("run_browser_flow_step", { request: { projectId, workflowId: current.workflow.workflowId, operation: "navigate", approved: true, url: projectUrl, element: null, elementRef: null, text: null, submit: false, key: null, time: null } });
          if (navigated.status !== "ready") {
            const message = `Không điều hướng được về provider project từ /tools: ${navigated.message}`;
            onActivity({ stage: "google_flow.image_route_recover", tool: "BrowserMCP / Google Flow", state: "blocked", message, nextAction: "Mở đúng URL project Flow đang dùng rồi chạy resume; không tạo project mới." });
            return { workflow: navigated.workflow, blocked: true, message };
          }
          store(navigated.workflow);
          const settled = await step("wait", null, null, 2);
          if (settled.status !== "ready" || !settled.workflow.browserSessionAttached) {
            const message = `Provider project chưa ổn định sau navigate: ${settled.message}`;
            onActivity({ stage: "google_flow.image_route_recover", tool: "BrowserMCP / Google Flow", state: "blocked", message, nextAction: "Chờ Flow tải xong rồi chạy resume; không mở Tools." });
            return { workflow: settled.workflow, blocked: true, message };
          }
          store(settled.workflow);
          continue;
        }
        const message = "Flow đang ở /tools nhưng snapshot không có Back ref và không có provider project key để quay lại an toàn; giữ nguyên 5/12 asset và không đoán route.";
        onActivity({ stage: "google_flow.image_route_recover", tool: "BrowserMCP / Google Flow", state: "blocked", message, nextAction: "Mở đúng project Flow hiện tại rồi bấm resume; app không tạo project mới." });
        return { workflow: latestWorkflow, blocked: true, message };
      }
      const projectUrl = current.workflow.currentUrl
        ?? current.workflow.providerProjectIdentity?.currentUrl
        ?? null;
      let domComposerDetected = false;
      let domModelGateDetected = false;
      let domComposerDiagnostic = "";
      if (projectUrl) {
        try {
          const domComposer = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
            projectId,
            request: { projectUrl, mode: "inspect_composer" },
          });
           domComposerDetected = domComposer.status === "ready"
             && domComposer.composerFound
             && domComposer.promptEditorFound
             && Boolean(domComposer.generateButtonFound)
             && domComposer.imageModeFound;
          // Flow renders the image-model picker inside Agent settings. In that
          // state the prompt editor is intentionally hidden, so requiring the
          // editor before opening the model gate deadlocks the workflow. A
          // visible composer + image mode + selected model is sufficient to
          // safely run the non-generating model/Save action; the worker then
          // re-reads the editor after Save.
          domModelGateDetected = domComposer.composerFound
            && domComposer.imageModeFound
            && Boolean(domComposer.selectedModel);
            domComposerDiagnostic = `status=${domComposer.status}, composer=${domComposer.composerFound}, editor=${domComposer.promptEditorFound}, generateControl=${Boolean(domComposer.generateButtonFound)}, generateEnabled=${Boolean(domComposer.generateButtonEnabled)}, imageMode=${domComposer.imageModeFound}, selectedModel=${Boolean(domComposer.selectedModel)}`;
          if (domComposerDetected) {
            onActivity({ stage: "google_flow.dom_composer", tool: "BrowserOS neo DOM / Google Flow", state: "success", message: "Đã đọc trực tiếp DOM Flow bằng BrowserOS neo và xác nhận prompt editor ảnh thật; không phụ thuộc chat panel.", output: domComposer.reportPath, nextAction: "Chọn Nano Banana Pro rồi nhập prompt theo từng shot." });
          } else if (domModelGateDetected) {
            onActivity({ stage: "google_flow.image_model", tool: "BrowserOS neo DOM / Google Flow", state: "running", message: "Đã xác nhận Agent settings của image composer; đang chọn Nano Banana Pro và Save trước khi đọc lại ô prompt.", output: domComposer.reportPath, nextAction: "Chờ model gate đóng panel rồi đọc lại editor ảnh." });
          }
        } catch (error) {
          // Keep the BrowserMCP gate, but preserve the actual DOM failure so a
          // regression cannot collapse into the vague “composer not found”.
          domComposerDiagnostic = String(error).replace(/^Error:\s*/i, "").slice(0, 320);
        }
      }
      if (current.workflow.uiRefs.length === 0 && !domComposerDetected && !domModelGateDetected) {
        return { workflow: latestWorkflow, blocked: true, message: `BrowserMCP chưa trả UI ref thật và DOM chưa xác nhận image composer: ${current.message}${domComposerDiagnostic ? ` (${domComposerDiagnostic})` : ""}` };
      }
      const composer = inspectBrowserFlowImageComposer(current.workflow.uiRefs);
      if (composer.verified || domComposerDetected || domModelGateDetected) {
        if (!projectUrl) {
          return { workflow: latestWorkflow, blocked: true, message: "Đã thấy image composer nhưng thiếu URL project Flow để chọn model Pro." };
        }
        try {
          const modelReport = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
            projectId,
            request: { projectUrl, model: "Nano Banana Pro" },
          });
          if (modelReport.status !== "ready" || !modelReport.modelSelected || !modelReport.saved) {
            return { workflow: latestWorkflow, blocked: true, message: `Flow chưa xác nhận image composer fingerprint (project=${modelReport.projectKey || "trống"}, target=${modelReport.targetUrl || "trống"}, modelSelected=${modelReport.modelSelected}, saved=${modelReport.saved}, output=${modelReport.outputCount || "trống"}, picker=${modelReport.selectedModel || "trống"}, fingerprint=${modelReport.composerFingerprint || "trống"}): ${modelReport.message}` };
          }
          // The worker verifies the editor again after Save. This is the
          // transition out of Agent settings and must be used for the return
          // decision; the pre-Save snapshot may legitimately have no editor.
          // The model-gate report from older BrowserOS workers did not expose
          // generateButtonFound even though its composer fingerprint was
          // produced from the exact editor + ingredients + image controls.
          // Do not throw that proof away and fall back to the lossy a11y tree.
          const modelComposerFingerprint = modelReport.composerFingerprint || "";
          const modelComposerProof = modelReport.status === "ready"
            && modelReport.composerFound
            && modelReport.promptEditorFound
            && modelReport.imageModeFound
            && (/image-editor/.test(modelComposerFingerprint) && /ingredients/.test(modelComposerFingerprint)
              || Boolean(modelReport.generateButtonFound));
          domComposerDetected = domComposerDetected || modelComposerProof;
          onActivity({ stage: "google_flow.image_model", tool: "BrowserOS neo DOM / Google Flow", state: "success", message: "Đã tự mở Agent settings, chọn Nano Banana Pro và bấm Save bằng BrowserOS neo trước khi tạo ảnh.", output: modelReport.reportPath, nextAction: "Tiếp tục nhập prompt từng shot trong image composer Pro." });
        } catch (error) {
          const detail = String(error).replace(/^Error:\s*/i, "").slice(0, 320);
          return { workflow: latestWorkflow, blocked: true, message: `Không chọn được Nano Banana Pro trong Flow: ${detail}` };
        }
        // After the model Save action Flow refreshes the accessibility tree.
        // Prefer a real BrowserOS prompt ref when it is available: the live
        // page exposes the editor as a generic node immediately before
        // "Add ingredients to the prompt box". Using that ref updates
        // Flow's application state, whereas writing only to the DOM can look
        // successful while Generate still submits the previous prompt.
        let refreshedPromptRef: BrowserFlowUiRef | undefined;
        try {
          const refreshed = await step("snapshot");
          store(refreshed.workflow);
          refreshedPromptRef = findBrowserFlowPromptRef(refreshed.workflow.uiRefs);
        } catch {
          refreshedPromptRef = findBrowserFlowPromptRef(current.workflow.uiRefs);
        }
         // When the exact CDP DOM proves the Flow image editor, prefer that
         // selector over the generic BrowserOS paragraph ref. The live Flow
         // accessibility tree can recycle generic refs from assistant output
         // cards; typing into one can produce a text-only assistant response
         // even though the snapshot still exposes "Start generation".
         if (domComposerDetected) {
           const projectLabel = current.workflow.providerProjectIdentity?.providerProjectKey
             ?? "project vừa mở trong session BrowserMCP";
           return { workflow: latestWorkflow, domPromptComposer: true, blocked: false, message: `Đã xác nhận ${projectLabel}, chọn Nano Banana Pro và khóa composer bằng exact CDP DOM; bỏ qua generic BrowserOS ref.` };
         }
         if (refreshedPromptRef) {
           const projectLabel = latestWorkflow.providerProjectIdentity?.providerProjectKey
             ?? "project vừa mở trong session BrowserMCP";
           return { workflow: latestWorkflow, promptRef: refreshedPromptRef, domPromptComposer: false, blocked: false, message: `Đã xác nhận ${projectLabel}, chọn Nano Banana Pro và khóa prompt bằng UI ref BrowserOS.` };
         }
         if (composer.domPromptComposer) {
           const projectLabel = current.workflow.providerProjectIdentity?.providerProjectKey
             ?? "project vừa mở trong session BrowserMCP";
           return { workflow: latestWorkflow, domPromptComposer: true, blocked: false, message: `Đã xác nhận ${projectLabel}, chọn Nano Banana Pro và khóa composer bằng CDP DOM.` };
         }
        // The live Flow page exposes a generic paragraph immediately beside
        // the composer controls. It is not a stable type target: BrowserMCP
        // may accept it and then hang until its 30s timeout. Once the exact
        // image-composer controls are present, always use the locked CDP DOM
        // editor path instead of falling back to that paragraph ref.
        const promptRef = composer.domPromptComposer
          ? undefined
          : findBrowserFlowPromptRef(current.workflow.uiRefs);
        if (promptRef) {
          const projectLabel = current.workflow.providerProjectIdentity?.providerProjectKey
            ?? "project vừa mở trong session BrowserMCP";
          return { workflow: latestWorkflow, promptRef, blocked: false, message: `Đã xác nhận ${projectLabel} và composer Nano Banana Pro.` };
        }
      }
      const detailCloseRef = findBrowserFlowCloseRef(current.workflow.uiRefs);
      if (detailCloseRef && !composer.verified && !domComposerDetected && !domModelGateDetected && attempt < 2) {
        onActivity({ stage: "google_flow.image_composer.acquire", tool: "BrowserOS / Google Flow", state: "running", message: `Flow đang mở detail/output panel; tự đóng bằng ref “${detailCloseRef.label}” rồi chụp lại DOM để tìm image composer.`, nextAction: "Đọc snapshot mới sau khi đóng panel; không nhập revision vào Agent/chat." });
        const closed = await step("click", detailCloseRef.label, detailCloseRef.reference);
        if (closed.status !== "ready") {
          return { workflow: closed.workflow, blocked: true, message: `Không đóng được detail/output panel Flow: ${closed.message}` };
        }
        store(closed.workflow);
        const settled = await step("wait", null, null, 2);
        if (settled.status !== "ready" || !settled.workflow.browserSessionAttached) {
          return { workflow: settled.workflow, blocked: true, message: `Flow chưa ổn định sau khi đóng detail panel: ${settled.message}` };
        }
        store(settled.workflow);
        continue;
      }
      const imageModeRef = findBrowserFlowImageModeRef(current.workflow.uiRefs);
      if (imageModeRef) {
        onActivity({ stage: "google_flow.image_composer.acquire", tool: "BrowserMCP / Google Flow", state: "running", message: `Snapshot đã học được entry image “${imageModeRef.label}”; đang mở bằng UI ref mới.`, nextAction: "Chờ Flow mở Nano Banana rồi quét snapshot lại." });
        const beforeProcessIds = new Set(current.workflow.processes.map((process) => process.processId));
        const selected = await step("click", imageModeRef.label, imageModeRef.reference);
        const selectedProcess = [...selected.workflow.processes].reverse().find((process) => process.operation === "click" && !beforeProcessIds.has(process.processId));
        if (selected.status !== "ready" || selectedProcess?.state !== "succeeded") {
          return { workflow: selected.workflow, blocked: true, message: `Không xác nhận được mở image composer: ${selected.message}` };
        }
        store(selected.workflow);
        const settled = await step("wait", null, null, 2);
        if (!settled.workflow.browserSessionAttached || settled.workflow.uiRefs.length === 0) {
          return { workflow: settled.workflow, blocked: true, message: `Image composer chưa ổn định sau khi chọn entry: ${settled.message}` };
        }
        store(settled.workflow);
        continue;
      }
      if (!composer.creditGate && attempt < 3) {
        try {
          const agent = await runBrowserFlowAgent(
            projectId,
            current.workflow,
              "Đọc UI refs hiện tại và mở đúng image composer Nano Banana trong project Flow này. Chụp screenshot + DOM mới trước khi chọn. Chỉ click một ref image/Nano Banana/Settings rõ ràng; TUYỆT ĐỐI KHÔNG click Agent, Tools, Add media, Media menu, New project, Create New, chat, credit, tài khoản hoặc tab khác. Nếu chưa có ref image thật thì trả stop, không điều hướng sang route khác.",
          );
          if (agent) {
            store(agent.workflow);
            onActivity({ stage: "google_flow.image_agent", tool: `Vision Browser / ${agent.model}`, state: agent.status === "ready" ? "success" : "blocked", message: agent.message, output: agent.plannerReportPath ?? undefined, nextAction: agent.status === "ready" ? "Đọc snapshot mới sau action của planner." : "Kiểm tra model planner và UI ref hiện tại." });
            if (agent.status === "ready" && agent.action?.action !== "stop") continue;
          }
        } catch (error) {
          const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "planner không xác định";
          onActivity({ stage: "google_flow.image_agent", tool: "Vision Browser", state: "blocked", message: `Planner không chạy được: ${detail.slice(0, 320)}`, nextAction: "Kiểm tra model vision_browser và credential; không tự click theo tọa độ." });
        }
      }
      return { workflow: latestWorkflow, blocked: true, message: "Đã vào đúng project nhưng snapshot chưa có Nano Banana Pro + ô prompt ảnh; không gõ vào chat." };
    }
    return { workflow: latestWorkflow, blocked: true, message: "Đã đọc lại Flow nhiều lần nhưng chưa xác nhận image composer." };
  }

  async function generateGoogleFlowMcpReferenceAssets(nextScript = scriptDraft, allowCloud = cloudGenerationEnabled): Promise<NanoBananaImageGenerationReport | null> {
    lastAssetGenerationBlockerRef.current = null;
    if (!projectId || !nextScript) {
      const message = "Cần có project và shot plan trước khi gọi Google Flow MCP.";
      lastAssetGenerationBlockerRef.current = message;
      onNotice(message);
      return null;
    }
    if (!allowCloud) {
      const message = "Cloud/API đang tắt: chưa gọi Google Flow MCP và chưa phát sinh credit.";
      lastAssetGenerationBlockerRef.current = message;
      onNotice(message);
      onActivity({ stage: "google_flow_mcp.image_guard", tool: "Policy / Cloud gate", state: "blocked", progress: 0, message, nextAction: "Bật Cloud/API rồi chạy lại; shot plan local vẫn được giữ nguyên." });
      return null;
    }
    const referenceContext = sessionAssetPaths().referenceAssetPaths.length
      ? `Ảnh tham chiếu local: ${sessionAssetPaths().referenceAssetPaths.join(", ")}`
      : "";
    const promptContract = await currentPromptContract(referenceContext);
    if (!scriptMatchesPrompt(nextScript, promptContract.sourcePromptHash, promptContract.requirements)) {
      const message = "Không gọi Google Flow MCP: script hiện tại không khớp prompt nguồn hoặc lệch shot count/thời lượng yêu cầu.";
      lastAssetGenerationBlockerRef.current = message;
      onNotice(message);
      invalidateStaleWorkflow(message);
      return null;
    }
    const tasks = nextScript.segments.slice(0, 32).map((segment, index) => ({
      shotId: `SHOT-${String(index + 1).padStart(3, "0")}`,
      revisionId: segment.revisionId || "rev-001",
      segment,
    }));
    const runId = `flow-mcp-images-${Date.now().toString(36)}`;
    const processSummary = (succeeded: boolean): ProcessRunSummary => ({
      executableId: "google-flow-mcp",
      exitCode: succeeded ? 0 : null,
      succeeded,
      timedOut: false,
      cancelled: false,
      terminationMode: "none",
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      externalSideEffectUnknown: !succeeded,
      outputEvidence: [],
    });
    const localAssets = await invoke<AssetView[]>("list_assets", { projectId, includeArchived: false }).catch(() => []);
    const findExisting = (task: { shotId: string; revisionId: string }) => localAssets
      .filter((asset) => asset.kind === "image" && asset.status === "ready" && asset.tags.includes(`shot-${task.shotId.toLowerCase()}`))
      .filter((asset) => asset.tags.includes(`revision-${task.revisionId.toLowerCase()}`) || asset.sourceUri?.startsWith("local://nano-banana-mcp/") || asset.sourceUri?.startsWith("local://google-flow-mcp/"))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const reusedAssets = tasks.map(findExisting).filter((asset): asset is AssetView => Boolean(asset));
    const missingTasks = tasks.filter((task) => !findExisting(task));
    const saveAssets = (assets: AssetView[]) => {
      setComfyuiAssets((currentAssets) => [...assets, ...currentAssets.filter((asset) => !assets.some((item) => item.assetId === asset.assetId))]);
      setScriptDraft((currentScript) => currentScript ? {
        ...currentScript,
        comfyuiAssetPaths: [...new Set([...(currentScript.comfyuiAssetPaths ?? []), ...assets.map((asset) => asset.relativePath)])],
      } : currentScript);
    };
    if (missingTasks.length === 0) {
      saveAssets(reusedAssets);
      const message = `Google Flow MCP resume: đã giữ nguyên đủ ${reusedAssets.length}/${tasks.length} asset hiện có; không Generate lại và không xoá asset.`;
      onNotice(message);
      onActivity({ stage: "google_flow_mcp.image_reuse", tool: "Google Flow MCP / local Asset Library", state: "success", progress: 1, message, nextAction: "Review ảnh rồi compose slideshow local nếu cần." });
      return {
        runId,
        status: "succeeded_needs_review",
        reportPath: `.auto3dvideo/runs/${runId}/google-flow-mcp-images/google-flow-mcp-image-report.json`,
        outputDirectory: `.auto3dvideo/runs/${runId}/google-flow-mcp-images`,
        generatedAssets: reusedAssets,
        taskCount: tasks.length,
        readyCount: reusedAssets.length,
        failedCount: 0,
        process: processSummary(true),
        message,
        failureCode: null,
        failureDetail: null,
        cdpPreflight: null,
      };
    }
    onActivity({ stage: "google_flow_mcp.chrome_cdp", tool: "Brave CDP / Google Flow", state: "running", progress: reusedAssets.length / Math.max(1, tasks.length), message: "Đang kiểm tra CDP trước khi mở Google Flow MCP; nếu chưa có sẽ mở Brave Flow session riêng.", nextAction: "Chờ cửa sổ Brave Flow riêng mở; chưa gọi Generate và chưa tiêu credit." });
    let chromeCdp: ChromeCdpLaunchReport;
    try {
      chromeCdp = await invoke<ChromeCdpLaunchReport>("ensure_chrome_cdp_session");
    } catch (error) {
      const detail = String(error).replace(/^Error:\s*/i, "").slice(0, 420);
      const message = `Google Flow MCP chưa chạy vì CDP chưa sẵn sàng: ${detail}`;
      onNotice(message);
      onActivity({ stage: "google_flow_mcp.chrome_cdp", tool: "Brave CDP / Google Flow", state: "blocked", progress: reusedAssets.length / Math.max(1, tasks.length), message, nextAction: "Kiểm tra cửa sổ Brave Flow session riêng rồi thử lại; chưa gọi MCP và chưa tiêu credit." });
      return null;
    }
    if (chromeCdp.needsLogin) {
      const message = `${chromeCdp.message} Chọn account/đăng nhập trong cửa sổ Brave Flow riêng rồi bấm chạy lại; chưa gọi MCP và chưa tiêu credit.`;
      onNotice(message);
      onActivity({ stage: "google_flow_mcp.chrome_cdp", tool: "Brave CDP / Google Flow", state: "waiting_user", progress: 1, message, nextAction: "Chọn account hoặc đăng nhập trong Brave Flow session riêng; Brave thường không bị ảnh hưởng." });
      return null;
    }
    onActivity({ stage: "google_flow_mcp.chrome_cdp", tool: "Brave CDP / Google Flow", state: "success", progress: reusedAssets.length / Math.max(1, tasks.length), message: chromeCdp.message, nextAction: "CDP đã sẵn sàng; chuyển sang inspect account rồi mới tạo ảnh." });
    const referenceImages = sessionAssetPaths().referenceAssetPaths.slice(0, 4);
    setComfyuiGenerating(true);
    onNotice(`Google Flow MCP: giữ ${reusedAssets.length}/${tasks.length} asset, tạo tiếp ${missingTasks.length} shot thiếu bằng job ID riêng.`);
    onActivity({ stage: "google_flow_mcp.image_generation", tool: "Google Flow MCP / Nano Banana Pro", state: "running", progress: reusedAssets.length / Math.max(1, tasks.length), message: `App gọi MCP trực tiếp: inspect account → flow_generate_image → flow_job_status → flow_download_job; không đọc DOM và không click gallery.`, nextAction: "Chờ MCP trả job/output theo đúng shot; không bấm lặp." });
    try {
      const report = await invoke<NanoBananaImageGenerationReport>("run_google_flow_mcp_image_generation", {
        request: {
          projectId,
          runId,
            model: "ui-default",
          timeoutSeconds: 900,
          tasks: missingTasks.map((task) => ({
            assetId: `flow-${task.shotId.toLowerCase()}-${task.revisionId.toLowerCase()}`,
            shotId: task.shotId,
            title: `${nextScript.title} · ${task.shotId}`,
            prompt: buildBrowserFlowImagePrompt(nextScript, task.segment, tasks.findIndex((candidate) => candidate.shotId === task.shotId), runId, task.revisionId),
            negativePrompt: task.segment.negativePrompt ?? "",
            width: 1280,
            height: 720,
            role: "composition",
            rightsStatus: "pending",
            referenceImages,
          })),
        },
      });
      const allAssets = [...new Map([...reusedAssets, ...report.generatedAssets].map((asset) => [asset.assetId, asset])).values()];
      saveAssets(allAssets);
      const complete = allAssets.length === tasks.length;
      const message = complete
        ? `Google Flow MCP đã trả đủ ${allAssets.length}/${tasks.length} ảnh theo job/download identity; không qua BrowserOS DOM.`
        : `Google Flow MCP trả ${allAssets.length}/${tasks.length} ảnh; giữ nguyên asset đã có, không xoá và không tạo lại shot cũ.`;
      onNotice(message);
      onActivity({ stage: "google_flow_mcp.image_generation", tool: "Google Flow MCP / Nano Banana Pro", state: complete ? "success" : "blocked", progress: allAssets.length / Math.max(1, tasks.length), message, output: report.reportPath, nextAction: complete ? "Compose local từ ảnh đã xác minh rồi review." : "Kiểm tra report/job ID của shot lỗi rồi chạy resume; không bấm lặp để tạo trùng." });
      return { ...report, generatedAssets: allAssets, taskCount: tasks.length, readyCount: allAssets.length, failedCount: Math.max(0, tasks.length - allAssets.length), status: complete ? "succeeded_needs_review" : "blocked", message };
    } catch (error) {
      const detail = String(error).replace(/^Error:\s*/i, "").slice(0, 420);
      const message = `Google Flow MCP bị chặn trước khi đủ asset: ${detail}`;
      lastAssetGenerationBlockerRef.current = message;
      onNotice(message);
      onActivity({ stage: "google_flow_mcp.image_generation", tool: "Google Flow MCP / Nano Banana Pro", state: "blocked", progress: reusedAssets.length / Math.max(1, tasks.length), message, nextAction: "Mở Antigravity/MCP kiểm tra flow_list_accounts và flow_inspect_account; không xoá asset hiện có." });
      return null;
    } finally {
      setComfyuiGenerating(false);
    }
  }

  async function generateGoogleFlowReferenceAssets(nextScript = scriptDraft, allowCloud = cloudGenerationEnabled, autoApproveImages = false, workflowOverride: BrowserFlowWorkflow | null = null): Promise<NanoBananaImageGenerationReport | null> {
    // Google Flow MCP owns account/capability/job/download identity. Keep the
    // legacy BrowserOS image composer below for old reports and manual debug,
    // but the desktop workflow now uses the MCP route first.
    if (shouldUseGoogleFlowMcpDesktopRoute()) {
      return generateGoogleFlowMcpReferenceAssets(nextScript, allowCloud);
    }
    lastAssetGenerationBlockerRef.current = null;
    if (!projectId || !nextScript) {
      const message = "Cần có project và shot plan trước khi tạo ảnh trong Google Flow.";
      lastAssetGenerationBlockerRef.current = message;
      onNotice(message);
      return null;
    }
    const referenceContext = sessionAssetPaths().referenceAssetPaths.length
      ? `Ảnh tham chiếu local: ${sessionAssetPaths().referenceAssetPaths.join(", ")}`
      : "";
    const promptContract = await currentPromptContract(referenceContext);
    if (!scriptMatchesPrompt(nextScript!, promptContract.sourcePromptHash, promptContract.requirements)) {
      const message = "Không tạo ảnh Flow: script hiện tại không khớp prompt nguồn hoặc lệch shot count/thời lượng yêu cầu.";
      lastAssetGenerationBlockerRef.current = message;
      onNotice(message);
      invalidateStaleWorkflow(message);
      return null;
    }
    if (!allowCloud) {
      const message = "Cloud/API đang tắt: chưa gọi Google Flow và chưa phát sinh credit.";
      lastAssetGenerationBlockerRef.current = message;
      onNotice(message);
      onActivity({ stage: "google_flow.image_guard", tool: "Policy / Cloud gate", state: "blocked", progress: 0, message, nextAction: "Bật Cloud/API rồi chạy lại; shot plan local vẫn được giữ nguyên." });
      return null;
    }

    const tasks = nextScript!.segments.slice(0, 32).map((segment, index) => ({
      shotId: `SHOT-${String(index + 1).padStart(3, "0")}`,
      revisionId: segment.revisionId || "rev-001",
      segment,
    }));
    const runId = `flow-images-${Date.now().toString(36)}`;
    const startedAt = performance.now();
    setComfyuiGenerating(true);
    onNotice(autoApproveImages
      ? `Google Flow / Nano Banana Pro · x1: tự tạo tuần tự ${tasks.length} ảnh; Gemini sẽ tự QA/revision và không dừng chờ xác nhận từng ảnh.`
      : `Google Flow / Nano Banana Pro · x1: sẽ tạo tuần tự ${tasks.length} ảnh, mỗi shot chờ tải và duyệt xong rồi mới sang shot kế.`);
    onActivity({ stage: "google_flow.image_generation", tool: "Google Flow / Nano Banana Pro · x1", state: "running", progress: 0, message: `Run ${runId}: dùng composer Nano Banana Pro x1 ngay trong tab Flow; mỗi shot đúng một ảnh.`, nextAction: "Đọc snapshot mới, nhập SHOT-001 và chờ file ảnh mới trong Downloads." });
    let latestWorkflow: BrowserFlowWorkflow | null = workflowOverride ?? browserFlowWorkflow;

    const processSummary = (succeeded: boolean): ProcessRunSummary => ({
      executableId: "google-flow-browser",
      exitCode: succeeded ? 0 : null,
      succeeded,
      timedOut: false,
      cancelled: false,
      terminationMode: "none",
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      externalSideEffectUnknown: !succeeded,
      outputEvidence: [],
    });
    const makeReport = (status: string, assets: AssetView[], message: string, failureCode?: string): NanoBananaImageGenerationReport => ({
      runId,
      status,
      reportPath: latestWorkflow?.discoveryPath ?? `outputs/sessions/${activeSessionId ?? "current"}/browser-flow`,
      outputDirectory: activeSessionId ? `outputs/sessions/${activeSessionId}/browser-flow/downloads` : "outputs/browser-flow/downloads",
      generatedAssets: assets,
      taskCount: tasks.length,
      readyCount: assets.length,
      failedCount: Math.max(0, tasks.length - assets.length),
      process: processSummary(status === "succeeded_needs_review"),
      message,
      failureCode: failureCode ?? null,
      failureDetail: failureCode ? message : null,
      cdpPreflight: null,
    });

    const store = (workflow: BrowserFlowWorkflow) => {
      latestWorkflow = workflow;
    };
    const step = (operation: string, element: string | null = null, elementRef: string | null = null, text: string | null = null, submit: boolean | null = false, time: number | null = null) => {
      if (!latestWorkflow) throw new Error("Chưa có Browser Flow workflow");
      return invoke<BrowserFlowWorkflowReport>("run_browser_flow_step", { request: { projectId, workflowId: latestWorkflow.workflowId, operation, approved: true, url: null, element, elementRef, text, submit, key: null, time } });
    };
    const snapshot = async () => {
      const result = await step("snapshot");
      store(result.workflow);
      return result;
    };
    const downloadImageWithRetry = async (request: { projectUrl: string; shotId: string; revisionId: string; mediaId?: string }): Promise<GoogleFlowPlaywrightReport> => {
      let last: GoogleFlowPlaywrightReport | null = null;
      let lastError = "";
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (attempt > 1) {
          onActivity({ stage: "google_flow.image_download_retry", tool: "BrowserOS DOM / Google Flow", state: "running", progress: undefined, message: `${request.shotId}: Download chưa tạo file, đọc lại DOM và thử lại cùng batch (${attempt}/${maxAttempts}); không Generate lại và không xoá asset.`, nextAction: "Chờ snapshot mới rồi dùng đúng Download batch của shot hiện tại." });
          try {
            await new Promise((resolve) => window.setTimeout(resolve, 900));
            await snapshot();
          } catch (error) {
            lastError = String(error).replace(/^Error:\s*/i, "").slice(0, 280);
          }
        }
        try {
          const result = await invoke<GoogleFlowPlaywrightReport>("run_google_flow_playwright_action", { projectId, request: { projectUrl: request.projectUrl, mode: "download_image", shotId: request.shotId, revisionId: request.revisionId, runId, mediaId: request.mediaId } });
          last = result;
          if (result.status === "ready" && result.downloadStarted && result.downloadName && (result.downloadSizeBytes ?? 0) > 0) return result;
          lastError = result.message;
        } catch (error) {
          lastError = String(error).replace(/^Error:\s*/i, "").slice(0, 360);
        }
        onActivity({ stage: "google_flow.image_download_retry", tool: "BrowserOS DOM / Google Flow", state: attempt < maxAttempts ? "info" : "blocked", progress: undefined, message: `${request.shotId}: Download lần ${attempt}/${maxAttempts} chưa được xác nhận${lastError ? ` — ${lastError}` : ""}.`, nextAction: attempt < maxAttempts ? "Không nhập lại prompt; sẽ refresh snapshot và retry cùng media." : "Đánh dấu shot này deferred, chuyển các shot khác rồi resume lại shot thiếu." });
      }
      return last ?? ({ status: "blocked", message: lastError || "Download không trả report", downloadStarted: false } as GoogleFlowPlaywrightReport);
    };

    type FlowRevisionResult = {
      asset: AssetView;
      evaluation: BrowserFlowVisualEvaluationReport | null;
      prompt: string;
      revisionId: string;
    };

    // A revision is serial and shot-local. It reuses the current Flow project
    // and exact DOM/download guards, then hands the new file back to the same
    // visual evaluator. A timeout may perform one transport retry with the
    // same revision identity, but no second shot can start while this function
    // is waiting or reconciling its output.
    const retryFlowShotOnce = async (
      task: { shotId: string; revisionId: string; segment: LocalScriptSegment },
      previousPrompt: string,
      previousEvaluation: BrowserFlowVisualEvaluationReport,
      attempt: number,
      transportRetry = 0,
    ): Promise<FlowRevisionResult> => {
      if (!latestWorkflow) throw new Error("Không có workflow Flow để revision");
      if (attempt > 2) throw new Error("Shot đã hết ngân sách revision (tối đa 2 lần tạo)");
      const revisionNumber = Math.max(2, Number(task.revisionId.match(/(\d+)$/)?.[1] ?? "1") + 1);
      const revisionId = `rev-${String(revisionNumber).padStart(3, "0")}`;
      const revisionInstruction = previousEvaluation.revisionInstruction.trim();
      if (!revisionInstruction) throw new Error("Gemini yêu cầu revise nhưng không trả hướng sửa");
      const revisedPrompt = previousPrompt.replace(
        /^REVISION_ID:\s*[^\r\n]+/m,
        `REVISION_ID: ${revisionId}`,
      ) + `\nREVISION_ATTEMPT: ${attempt}/2\nREVISION_INSTRUCTIONS: ${compactBrowserFlowText(revisionInstruction, 1_200)}`;
      const shotCount = (revisedPrompt.match(/^SHOT_ID:\s*/gm) ?? []).length;
      if (shotCount !== 1 || !revisedPrompt.includes(`REVISION_ID: ${revisionId}`)) {
        throw new Error("Revision prompt không giữ đúng một SHOT_ID/REVISION_ID");
      }
      const currentFlowUrl = latestWorkflow.currentUrl
        ?? latestWorkflow.providerProjectIdentity?.currentUrl
        ?? null;
      if (!currentFlowUrl) throw new Error("Không có URL project Flow hiện tại để revision");
      const providerProjectKey = latestWorkflow.providerProjectIdentity?.providerProjectKey?.trim();
      const composerProjectUrl = providerProjectKey
        ? `https://flow.google.com/project/${providerProjectKey}`
        : currentFlowUrl.replace(/\/edit(?:\/.*)?$/, "");
      if (!/^https:\/\/flow\.google\.com\/project\/[A-Za-z0-9-]+(?:\/.*)?$/.test(composerProjectUrl)) {
        throw new Error("URL project Flow không hợp lệ để mở lại image composer revision");
      }
      if (currentFlowUrl !== composerProjectUrl) {
        const navigated = await invoke<BrowserFlowWorkflowReport>("run_browser_flow_step", {
          request: {
            projectId,
            workflowId: latestWorkflow.workflowId,
            operation: "navigate",
            approved: true,
            url: composerProjectUrl,
            element: null,
            elementRef: null,
            text: null,
            submit: false,
            key: null,
            time: null,
          },
        });
        if (navigated.status !== "ready" || !navigated.workflow.browserSessionAttached) {
          throw new Error(`Không mở lại được project Flow trước revision: ${navigated.message}`);
        }
        store(navigated.workflow);
        const settled = await step("wait", null, null, null, false, 2);
        if (settled.status !== "ready" || !settled.workflow.browserSessionAttached) {
          throw new Error(`Project Flow chưa ổn định sau khi quay lại composer: ${settled.message}`);
        }
        store(settled.workflow);
      }
      const imageComposer = await ensureGoogleFlowImageComposer(latestWorkflow);
      if (imageComposer.blocked) {
        throw new Error(`Không khôi phục được image composer trước revision: ${imageComposer.message}`);
      }
      latestWorkflow = imageComposer.workflow;
      store(latestWorkflow);
      const projectUrl = latestWorkflow.currentUrl
        ?? latestWorkflow.providerProjectIdentity?.currentUrl
        ?? composerProjectUrl;
      const beforeRevision = await invoke<{ files: BrowserFlowDownloadEntry[] }>("list_browser_flow_downloads", { projectId });
      const beforeRevisionPaths = new Set(beforeRevision.files.map((file) => file.relativePath));
      const revisionInputHash = await sha256Text(stableBrowserFlowPrompt(revisedPrompt));
      const revisionMediaIds = (output: GoogleFlowDomOutputReport) => output.matchingBatchCount > 0
        ? (output.matchingBatchMediaIds ?? [])
        : output.shotRevisionBatchCount > 0
          ? (output.shotRevisionBatchMediaIds ?? [])
          : [];

      const importRevisionImage = async (imageFile: BrowserFlowDownloadEntry): Promise<FlowRevisionResult> => {
        const importedReport = await invoke<BrowserFlowDownloadImportReport>("import_browser_flow_download", { request: { projectId, workflowId: latestWorkflow!.workflowId, relativePath: imageFile.relativePath, runId, shotId: task.shotId, revisionId, inputHash: revisionInputHash } });
        store(importedReport.workflow);
        let asset = importedReport.asset ?? null;
        if (!asset) {
          const revisionAssets = await invoke<AssetView[]>("list_assets", { projectId, includeArchived: false });
          asset = revisionAssets.find((candidate) => candidate.relativePath === importedReport.importedPath) ?? null;
        }
        if (!asset) throw new Error(`${task.shotId}/${revisionId}: import không trả Asset Library asset`);
        let evaluation: BrowserFlowVisualEvaluationReport | null = null;
        try {
          evaluation = await invoke<BrowserFlowVisualEvaluationReport>("evaluate_browser_flow_image", {
            request: {
              projectId,
              workflowId: latestWorkflow!.workflowId,
              runId,
              shotId: task.shotId,
              revisionId,
              imageRelativePath: asset.relativePath,
              prompt: revisedPrompt,
              negativePrompt: task.segment.negativePrompt ?? "",
              continuityNotes: task.segment.continuityNotes ?? "",
              referenceRelativePaths: sessionAssetPaths().referenceAssetPaths.slice(0, 3),
            },
          });
        } catch (error) {
          onActivity({ stage: "google_flow.image_evaluation", tool: "Gemini Visual QA", state: "blocked", progress: undefined, message: `${task.shotId}/${revisionId}: evaluator revision lỗi, giữ người duyệt. ${String(error).replace(/^Error:\s*/i, "").slice(0, 220)}`, output: asset.relativePath, nextAction: "Không tự duyệt revision khi Gemini không trả report." });
        }
        return { asset, evaluation, prompt: revisedPrompt, revisionId };
      };

      const baselineDom = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
        projectId,
        request: { projectUrl, mode: "inspect_output", shotId: task.shotId, revisionId, runId },
      });
      const pendingRevisionMediaIds = revisionMediaIds(baselineDom);
      if (!baselineDom.generationActive && pendingRevisionMediaIds.length === 1) {
        onActivity({ stage: "google_flow.image_revision_resume", tool: "BrowserOS neo DOM / Google Flow", state: "running", progress: undefined, message: `${task.shotId}/${revisionId}: phát hiện output revision đã tồn tại từ lần chạy trước; tải/import lại, không Generate thêm.`, output: baselineDom.reportPath, nextAction: "Download đúng media revision cũ rồi chạy lại Gemini QA." });
        const resumedDownload = await downloadImageWithRetry({ projectUrl, shotId: task.shotId, revisionId, mediaId: pendingRevisionMediaIds[0] });
        if (resumedDownload.status === "ready" && resumedDownload.downloadStarted && resumedDownload.downloadName && (resumedDownload.downloadSizeBytes ?? 0) > 0) {
          const resumedDownloads = await invoke<{ files: BrowserFlowDownloadEntry[] }>("list_browser_flow_downloads", { projectId });
          const resumedFile = resumedDownloads.files
            .filter((file) => file.mediaKind === "image" && (file.name === resumedDownload.downloadName || file.relativePath.endsWith(`/${resumedDownload.downloadName}`)))
            .sort((left, right) => Number(right.modifiedAt) - Number(left.modifiedAt))[0];
          if (resumedFile) return importRevisionImage(resumedFile);
        }
        onActivity({ stage: "google_flow.image_revision_resume", tool: "Google Flow / Nano Banana Pro", state: "info", progress: undefined, message: `${task.shotId}/${revisionId}: thấy media revision nhưng chưa xác nhận được file tải; không gán nhầm, tiếp tục theo dõi/retry có giới hạn.`, output: resumedDownload.reportPath, nextAction: "Chờ file mới hoặc chạy lại resume; không coi revision là hoàn tất." });
      }
      const baselineMediaIds = new Set(baselineDom.mediaIds ?? []);
      const baselineMediaCount = baselineDom.mediaCount;
      const observed = await invoke<GoogleFlowPlaywrightReport>("run_google_flow_playwright_action", {
        projectId,
        request: { projectUrl, mode: "observe", runId },
      });
      const observedComposer = Boolean((observed.observed as { imageComposerDetected?: boolean } | null)?.imageComposerDetected);
      if (observed.status !== "ready" || !observedComposer) {
        throw new Error(`Flow không ở image composer thật trước revision: ${observed.message}`);
      }
      const typed = await invoke<GoogleFlowPlaywrightReport>("run_google_flow_playwright_action", {
        projectId,
        request: { projectUrl, mode: "type_prompt", prompt: revisedPrompt, runId },
      });
      if (typed.status !== "ready" || !typed.editorFound || !typed.promptAccepted || typed.generateClicked) {
        throw new Error(`Flow không xác nhận prompt revision: ${typed.message}`);
      }
      const generated = await invoke<GoogleFlowPlaywrightReport>("run_google_flow_playwright_action", {
        projectId,
        request: { projectUrl, mode: "click_generate", runId },
      });
      if (generated.status !== "ready" || !generated.generateClicked) {
        throw new Error(`Flow không xác nhận Generate revision: ${generated.message}`);
      }
      onActivity({ stage: "google_flow.image_revision", tool: "Gemini revision → Google Flow / Nano Banana Pro", state: "running", progress: undefined, message: `${task.shotId}: Gemini yêu cầu sửa; đã gửi ${revisionId} (attempt ${attempt}/2), không đụng shot khác.`, output: generated.reportPath, nextAction: "Chờ đúng output revision, tải một file mới rồi chấm lại." });

      let waitedSeconds = 0;
      let clickedDownload = false;
      let downloadedName: string | null = null;
      const initialRevisionWaitSeconds = 300;
      const extendedRevisionWaitSeconds = 900;
      let maxRevisionWaitSeconds = initialRevisionWaitSeconds;
      let lastGenerationActive = baselineDom.generationActive;
      let lastGenerationActiveAt = baselineDom.generationActive ? 0 : -1;
      while (waitedSeconds < maxRevisionWaitSeconds) {
        const waitFor = Math.min(2, maxRevisionWaitSeconds - waitedSeconds);
        try {
          const waited = await step("wait", null, null, null, false, waitFor);
          store(waited.workflow);
        } catch (error) {
          const detail = String(error).replace(/^Error:\s*/i, "").slice(0, 220);
          onActivity({ stage: "google_flow.image_revision_wait", tool: "BrowserOS / Google Flow", state: "info", progress: undefined, message: `${task.shotId}/${revisionId}: wait bị gián đoạn nhưng chưa kết luận fail (${detail}); đọc lại snapshot mới.`, nextAction: "Không nhập lại prompt; khôi phục snapshot và tiếp tục theo dõi output." });
        }
        waitedSeconds += waitFor;
        let refreshed: BrowserFlowWorkflowReport;
        try {
          refreshed = await snapshot();
        } catch (error) {
          const detail = String(error).replace(/^Error:\s*/i, "").slice(0, 220);
          onActivity({ stage: "google_flow.image_revision_wait", tool: "BrowserOS / Google Flow", state: "info", progress: undefined, message: `${task.shotId}/${revisionId}: chưa đọc được snapshot sau wait (${detail}); giữ nguyên revision và thử lại.`, nextAction: "Giữ tab Flow mở; app sẽ tiếp tục polling bounded." });
          continue;
        }
        const refreshedUrl = refreshed.workflow.currentUrl
          ?? refreshed.workflow.providerProjectIdentity?.currentUrl
          ?? projectUrl;
        const outputDom = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
          projectId,
          request: { projectUrl: refreshedUrl, mode: "inspect_output", shotId: task.shotId, revisionId, runId },
        });
        lastGenerationActive = outputDom.generationActive;
        if (lastGenerationActive) lastGenerationActiveAt = waitedSeconds;
        const candidateMediaIds = revisionMediaIds(outputDom);
        const candidateMediaCount = outputDom.matchingBatchCount > 0
          ? outputDom.matchingBatchMediaCount
          : outputDom.shotRevisionBatchCount > 0
            ? outputDom.shotRevisionBatchMediaCount
            : 0;
        const freshMediaIds = candidateMediaIds.filter((mediaId) => !baselineMediaIds.has(mediaId));
        const unlabelledFreshMedia = outputDom.mediaCount === baselineMediaCount + 1
          && outputDom.mediaCount > 0
          && !outputDom.generationActive
          && freshMediaIds.length === 0
          && candidateMediaCount === 0;
        if (freshMediaIds.length > 1) throw new Error(`${task.shotId}/${revisionId}: Flow trả nhiều media mới, không thể gán chính xác`);
        if (candidateMediaCount > 1) throw new Error(`${task.shotId}/${revisionId}: batch revision trả hơn một media dù cấu hình x1`);
        if (!clickedDownload && !outputDom.generationActive && (candidateMediaCount > 0 || freshMediaIds.length === 1 || unlabelledFreshMedia)) {
          const download = await downloadImageWithRetry({ projectUrl: refreshedUrl, shotId: task.shotId, revisionId, mediaId: freshMediaIds.length === 1 ? freshMediaIds[0] : unlabelledFreshMedia ? "__newest__" : undefined });
          if (download.status !== "ready" || !download.downloadStarted || !download.downloadName || (download.downloadSizeBytes ?? 0) <= 0) {
            throw new Error(`${task.shotId}/${revisionId}: Download revision không được xác nhận: ${download.message}`);
          }
          clickedDownload = true;
          downloadedName = download.downloadName;
        }
        const downloads = await invoke<{ files: BrowserFlowDownloadEntry[] }>("list_browser_flow_downloads", { projectId });
        let freshImages = downloads.files
          .filter((file) => file.mediaKind === "image" && !beforeRevisionPaths.has(file.relativePath))
          .sort((left, right) => Number(right.modifiedAt) - Number(left.modifiedAt));
        if (downloadedName) freshImages = freshImages.filter((file) => file.name === downloadedName || file.relativePath.endsWith(`/${downloadedName}`));
        if (freshImages.length > 1) throw new Error(`${task.shotId}/${revisionId}: có nhiều file ảnh mới, dừng để không gán nhầm`);
        if (!clickedDownload || freshImages.length !== 1) {
          const recentlyActive = lastGenerationActive || (lastGenerationActiveAt >= 0 && waitedSeconds - lastGenerationActiveAt <= 30);
          if (recentlyActive && maxRevisionWaitSeconds < extendedRevisionWaitSeconds && waitedSeconds >= initialRevisionWaitSeconds) {
            maxRevisionWaitSeconds = extendedRevisionWaitSeconds;
            onActivity({ stage: "google_flow.image_revision_wait", tool: "Google Flow / Nano Banana Pro", state: "running", progress: undefined, message: `${task.shotId}/${revisionId}: đã qua mốc ${initialRevisionWaitSeconds}s nhưng Flow vẫn còn dấu hiệu đang xử lý; kéo dài polling đến ${extendedRevisionWaitSeconds}s, không gửi lại prompt.`, nextAction: "Tiếp tục chờ generation kết thúc và tải đúng output revision." });
          }
          onActivity({ stage: "google_flow.image_revision_wait", tool: "Google Flow / Nano Banana Pro", state: "running", progress: undefined, message: `${task.shotId}/${revisionId}: đang chờ output revision (${waitedSeconds}/${maxRevisionWaitSeconds}s).`, nextAction: "Không bấm Generate lại; chờ DOM và file mới." });
          continue;
        }
        return importRevisionImage(freshImages[0]);
      }
      if (!lastGenerationActive && transportRetry < 1) {
        onActivity({ stage: "google_flow.image_revision_retry", tool: "Google Flow / Nano Banana Pro", state: "running", progress: undefined, message: `${task.shotId}/${revisionId}: timeout nhưng Flow đã dừng và chưa có output; gửi lại cùng revision một lần để khôi phục, không tạo revision thứ ba.`, nextAction: "Mở lại image composer, nhập lại cùng prompt revision và chờ output mới." });
        return retryFlowShotOnce(task, previousPrompt, previousEvaluation, attempt, transportRetry + 1);
      }
      throw new Error(`${task.shotId}/${revisionId}: hết thời gian chờ output sau ${waitedSeconds}s; generationActive=${lastGenerationActive}; đã thử retry transport=${transportRetry}/1, có thể chạy lại resume để tiếp tục shot còn thiếu`);
    };

    let generatedAssets: AssetView[] = [];
    try {
      if (autoApproveImages) {
        // A full-auto resume must be able to finish from the local Asset
        // Library even when the BrowserOS tab/workflow is no longer attached.
        // This is the fast path for a project whose shots were already
        // downloaded/imported in an earlier run.
        const resumeAssets = await invoke<AssetView[]>("list_assets", { projectId, includeArchived: false });
        const existingAssets = tasks.map((task) => findResumableFlowAsset(
          resumeAssets,
          latestWorkflow?.downloadedFiles ?? [],
          task.shotId,
          task.revisionId,
          "",
        ));
        if (existingAssets.every((asset): asset is AssetView => Boolean(asset))) {
          const reusedAssets = existingAssets as AssetView[];
          setComfyuiAssets((currentAssets) => [...reusedAssets, ...currentAssets.filter((asset) => !reusedAssets.some((item) => item.assetId === asset.assetId))]);
          setScriptDraft((currentScript) => currentScript ? { ...currentScript, comfyuiAssetPaths: [...new Set([...(currentScript.comfyuiAssetPaths ?? []), ...reusedAssets.map((asset) => asset.relativePath)])] } : currentScript);
          const message = `Resume full-auto: đã tìm thấy đủ ${reusedAssets.length}/${tasks.length} asset shot cũ trong Asset Library; không mở Flow và không tạo lại.`;
          onNotice(message);
          onActivity({ stage: "google_flow.image_reuse", tool: "Studio Flow Agent / local resume", state: "success", progress: 1, message, nextAction: "Review creative/rights; chỉ chạy lại shot cụ thể nếu muốn thay ảnh." });
          return makeReport("succeeded_needs_review", reusedAssets, message);
        }
      }
      if (!latestWorkflow || latestWorkflow.phase === "failed" || latestWorkflow.phase === "cancelled" || !latestWorkflow.browserSessionAttached) {
        const prepared = await startBrowserFlowFromWorkspace(nextScript, null, false);
        if (!prepared) {
          const message = "Google Flow chưa tạo được workflow/snapshot thật; dừng trước khi nhập prompt ảnh.";
          onActivity({ stage: "google_flow.image_generation", tool: "Google Flow / Nano Banana Pro", state: "blocked", progress: 0, message, nextAction: "Mở đúng project Flow và Connect BrowserMCP, rồi chạy lại." });
          return makeReport("blocked", [], message, "FLOW_WORKFLOW_NOT_READY");
        }
        const restored = await invoke<BrowserFlowWorkflowReport | null>("get_latest_browser_flow_workflow", { projectId, sessionId: activeSessionId ?? null });
        latestWorkflow = restored?.workflow ?? null;
        if (latestWorkflow) store(latestWorkflow);
      }
      if (!latestWorkflow) {
        const message = "Không khôi phục được workflow Google Flow sau discovery; không giả đã tạo ảnh.";
        return makeReport("blocked", [], message, "FLOW_WORKFLOW_MISSING");
      }
      // Reconcile local assets before opening the provider composer. A failed
      // composer probe must not turn a resumable 4/12 or 5/12 run into a
      // misleading 0/12 report, and it must never cause existing files to be
      // deleted or regenerated.
      let localAssets: AssetView[] = [];
      try {
        localAssets = await invoke<AssetView[]>("list_assets", { projectId, includeArchived: false });
      } catch {
        localAssets = [];
      }
      const resumableAssets = tasks
        .map((task) => findResumableFlowAsset(
          localAssets,
          latestWorkflow!.downloadedFiles ?? [],
          task.shotId,
          task.revisionId,
          "",
        ))
        .filter((asset): asset is AssetView => Boolean(asset));
      const imageComposer = await ensureGoogleFlowImageComposer(latestWorkflow);
      latestWorkflow = imageComposer.workflow;
      if (imageComposer.blocked) {
        generatedAssets = resumableAssets;
        const message = `Google Flow chưa vào được image composer: ${imageComposer.message} Giữ nguyên ${generatedAssets.length}/${tasks.length} ảnh đã có; không xoá và không tạo lại ảnh cũ.`;
          onActivity({ stage: "google_flow.image_generation", tool: "Google Flow / Nano Banana Pro", state: "blocked", progress: generatedAssets.length / Math.max(1, tasks.length), message, nextAction: "Giữ nguyên project vừa được mở; không gõ vào chat và bấm Tự làm toàn bộ lại để resume đúng shot còn thiếu sau khi Flow trả composer ảnh." });
        return makeReport("blocked", generatedAssets, message, "FLOW_IMAGE_COMPOSER_NOT_FOUND");
      }
      // Keep the locally verified assets in the report before touching Flow.
      // A failed run must resume as 5/12 (or whatever is already present),
      // never reset to 0/12 and never regenerate the completed shots.
      generatedAssets = [...new Map(resumableAssets.map((asset) => [asset.assetId, asset])).values()];
      if (generatedAssets.length > 0) {
        setComfyuiAssets((currentAssets) => [
          ...generatedAssets,
          ...currentAssets.filter((asset) => !generatedAssets.some((item) => item.assetId === asset.assetId)),
        ]);
        setScriptDraft((currentScript) => currentScript ? {
          ...currentScript,
          comfyuiAssetPaths: [...new Set([...(currentScript.comfyuiAssetPaths ?? []), ...generatedAssets.map((asset) => asset.relativePath)])],
        } : currentScript);
      }
      const deferredShots: string[] = [];
      for (let index = 0; index < tasks.length; index += 1) {
        const task = tasks[index];
        const segment = task.segment;
        const prompt = buildBrowserFlowImagePrompt(nextScript, segment, index, runId, task.revisionId);
        const shotIdentityCount = (prompt.match(/^SHOT_ID:\s*/gm) ?? []).length;
        const embeddedShotIds = [...prompt.matchAll(/SHOT_ID:\s*(SHOT-\d+)/g)].map((match) => match[1]);
        if (shotIdentityCount !== 1 || embeddedShotIds.some((shotId) => shotId !== task.shotId)) {
          const message = `${task.shotId}: prompt bị gộp nhiều shot; dừng trước khi nhập để không tạo sai ảnh.`;
          onActivity({ stage: "google_flow.image_prompt", tool: "Workflow guard", state: "blocked", progress: index / tasks.length, message, nextAction: "Tách prompt theo từng shot rồi chạy lại; mỗi lần nhập chỉ được có đúng một SHOT_ID." });
          return makeReport("blocked", generatedAssets, message, "FLOW_PROMPT_MULTIPLE_SHOTS");
        }
        // RUN_ID identifies an execution, not the content of a shot. It must
        // not invalidate resume when the user presses full-auto again.
        const inputHash = await sha256Text(stableBrowserFlowPrompt(prompt));
        const existingAsset = findResumableFlowAsset(
          localAssets,
          latestWorkflow.downloadedFiles ?? [],
          task.shotId,
          task.revisionId,
          inputHash,
        );
        if (existingAsset) {
            if (!generatedAssets.some((asset) => asset.assetId === existingAsset.assetId)) {
              generatedAssets.push(existingAsset);
            }
            onActivity({ stage: "google_flow.image_reuse", tool: "Studio Flow Agent / local resume", state: "info", progress: index / tasks.length, message: `${task.shotId}/${task.revisionId}: đã tìm thấy asset cũ ổn định; bỏ qua Generate và không chạy lại shot này.`, output: existingAsset.relativePath, nextAction: "Chuyển shot kế tiếp trong cùng project Flow." });
            const approved = autoApproveImages
              ? (() => {
                  onActivity({ stage: "google_flow.image_reuse", tool: "Studio Flow Agent / local resume", state: "success", progress: (index + 1) / tasks.length, message: `${task.shotId}: full-auto tái sử dụng asset cũ và chuyển tiếp, không hỏi lại.`, output: existingAsset.relativePath, nextAction: index + 1 < tasks.length ? `Tự chuyển sang ${tasks[index + 1].shotId}.` : "Đã đủ asset; vẫn cần human review creative/rights trước delivery." });
                  return true;
                })()
              : await waitForFlowImageReview({
                  shotId: task.shotId,
                  revisionId: task.revisionId,
                  attempt: 1,
                  asset: existingAsset,
                  remainingShots: tasks.length - index - 1,
                });
            if (!approved) {
              const message = `${task.shotId}: bạn chưa duyệt ảnh đã có; workflow dừng tại shot này để sửa hoặc chạy lại.`;
              setComfyuiAssets((currentAssets) => currentAssets.filter((asset) => asset.assetId !== existingAsset.assetId));
              setScriptDraft((currentScript) => currentScript ? { ...currentScript, comfyuiAssetPaths: (currentScript.comfyuiAssetPaths ?? []).filter((path) => path !== existingAsset.relativePath) } : currentScript);
              onActivity({ stage: "google_flow.image_review", tool: "Human review / Asset Library", state: "blocked", progress: index / tasks.length, message, output: existingAsset.relativePath, nextAction: "Sửa prompt/revision rồi chạy lại riêng shot này." });
              return makeReport("blocked", generatedAssets.filter((asset) => asset.assetId !== existingAsset.assetId), message, "FLOW_IMAGE_REVIEW_REJECTED");
            }
            onActivity({ stage: "google_flow.image_review", tool: "Human review / Asset Library", state: "success", progress: (index + 1) / tasks.length, message: `${task.shotId}: đã xác nhận ảnh đúng; cho phép chuyển shot kế tiếp.`, output: existingAsset.relativePath, nextAction: index + 1 < tasks.length ? `Bắt đầu ${tasks[index + 1].shotId}.` : "Đã duyệt đủ ảnh; chuyển sang bước review tổng." });
            continue;
        }

         let shotTransportRetry = 0;
         while (true) {
         let current = await snapshot();
        let composer = inspectBrowserFlowImageComposer(current.workflow.uiRefs);
        // Do not let a later accessibility snapshot erase the exact DOM proof
        // established for this project. Re-read the live DOM for every shot,
        // however, so a tab that really left the composer still fails closed.
        let domComposerReady = false;
        let domComposerDiagnostic = "";
        let currentProjectUrl = current.workflow.currentUrl
          ?? current.workflow.providerProjectIdentity?.currentUrl
          ?? null;
        if (currentProjectUrl) {
          try {
            const domComposer = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
              projectId,
              request: { projectUrl: currentProjectUrl, mode: "inspect_composer" },
            });
            domComposerReady = domComposer.status === "ready"
              && domComposer.composerFound
              && domComposer.promptEditorFound
              && Boolean(domComposer.generateButtonFound)
              && domComposer.imageModeFound;
            domComposerDiagnostic = `status=${domComposer.status}, project=${domComposer.projectKey || "trống"}, composer=${domComposer.composerFound}, editor=${domComposer.promptEditorFound}, generateControl=${Boolean(domComposer.generateButtonFound)}, generateEnabled=${Boolean(domComposer.generateButtonEnabled)}, imageMode=${domComposer.imageModeFound}, fingerprint=${domComposer.composerFingerprint || "trống"}`;
          } catch {
            domComposerDiagnostic = "DOM probe lỗi hoặc hết thời gian";
          }
        }
        if (!composer.verified && !domComposerReady && !composer.creditGate && current.workflow.uiRefs.length > 0) {
          try {
            const agent = await runBrowserFlowAgent(
              projectId,
              current.workflow,
              "Fresh refs chưa chứng minh image composer. Chụp screenshot + DOM mới và chỉ chọn một image/Nano Banana/Settings/prompt control rõ ràng. TUYỆT ĐỐI KHÔNG click Agent, Tools, Add media, Media menu, New project, Create New, chat, account hoặc credit; nếu thiếu bằng chứng, trả stop và giữ nguyên project.",
            );
            store(agent.workflow);
            onActivity({ stage: "google_flow.image_agent", tool: `Gemini Vision Browser / ${agent.model}`, state: agent.status === "ready" ? "success" : "waiting_user", progress: index / tasks.length, message: `${task.shotId}: Gemini đã đọc snapshot mới và trả lời: ${agent.message}`, output: agent.plannerReportPath ?? undefined, nextAction: agent.status === "ready" && agent.action?.action !== "stop" ? "Đọc lại snapshot sau action của Gemini rồi thử composer ảnh." : "Gemini chưa thấy action an toàn; app sẽ thử đọc DOM thật trước khi dừng." });
            if (agent.status === "ready" && agent.action?.action !== "stop") {
              current = await snapshot();
              composer = inspectBrowserFlowImageComposer(current.workflow.uiRefs);
              currentProjectUrl = current.workflow.currentUrl
                ?? current.workflow.providerProjectIdentity?.currentUrl
                ?? currentProjectUrl;
              if (currentProjectUrl) {
                try {
                  const domComposer = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
                    projectId,
                    request: { projectUrl: currentProjectUrl, mode: "inspect_composer" },
                  });
                  domComposerReady = domComposer.status === "ready"
                    && domComposer.composerFound
                    && domComposer.promptEditorFound
                    && Boolean(domComposer.generateButtonFound)
                    && domComposer.imageModeFound;
                  domComposerDiagnostic = `status=${domComposer.status}, project=${domComposer.projectKey || "trống"}, composer=${domComposer.composerFound}, editor=${domComposer.promptEditorFound}, generateControl=${Boolean(domComposer.generateButtonFound)}, generateEnabled=${Boolean(domComposer.generateButtonEnabled)}, imageMode=${domComposer.imageModeFound}, fingerprint=${domComposer.composerFingerprint || "trống"}`;
                } catch {
                  domComposerReady = false;
                  domComposerDiagnostic = "DOM probe lỗi hoặc hết thời gian sau planner";
                }
              }
            }
          } catch (error) {
            const detail = String(error).replace(/^Error:\s*/i, "").slice(0, 240);
            onActivity({ stage: "google_flow.image_agent", tool: "Gemini Vision Browser", state: "info", progress: index / tasks.length, message: `${task.shotId}: Gemini planner không chạy được: ${detail}`, nextAction: "Tiếp tục bằng locator Playwright/DOM; nếu vẫn không thấy composer sẽ dừng fail-closed." });
          }
        }
        // BrowserOS' fresh accessibility snapshot is the control authority for
        // the action. Flow's CDP DOM probe can miss the Material/Shadow DOM
        // Generate button even while the fresh UI ref is valid (this was the
        // exact `composer=true, editor=true, generateControl=false` false
        // block). Keep the DOM probe as a diagnostic and fallback proof, but
        // do not let that weaker probe reject an independently verified
        // BrowserOS composer.
        const browserComposerReady = composer.verified;
        if (!browserComposerReady && !domComposerReady) {
          const message = composer.creditGate
            ? `${task.shotId}: Flow đang báo credit/quota/gói; app dừng và không giả đã tạo.`
            : `${task.shotId}: chưa xác nhận image composer hiện tại bằng BrowserOS snapshot hoặc DOM; app không gõ vào chat. ${domComposerDiagnostic ? `(${domComposerDiagnostic})` : "(thiếu URL project để đọc DOM)"}`;
          onActivity({ stage: "google_flow.image_generation", tool: "Google Flow / Nano Banana Pro", state: "blocked", progress: index / tasks.length, message, nextAction: "Giữ nguyên tab character/image của Flow, Connect BrowserMCP rồi đọc snapshot lại." });
          return makeReport("blocked", generatedAssets, message, composer.creditGate ? "FLOW_CREDIT_GATE" : "FLOW_IMAGE_COMPOSER_NOT_FOUND");
        }
        if (browserComposerReady && !domComposerReady) {
          onActivity({ stage: "google_flow.image_generation", tool: "BrowserOS fresh snapshot / Google Flow", state: "success", progress: index / tasks.length, message: `${task.shotId}: BrowserOS đã xác nhận đúng image composer và Generate; DOM probe không thấy Generate nhưng không được phủ định ref thật.`, nextAction: "Dùng ref mới của BrowserOS để nhập prompt; sau đó đọc lại snapshot trước khi Generate." });
        }
        // Prefer the live BrowserOS accessibility ref whenever Flow exposes
        // one. The DOM probe is useful as evidence/fallback, but it must not
        // silently route a trusted composer through the old DOM injection
        // path: Flow can display that text without updating its Angular
        // generation state.
        const promptRef = findBrowserFlowPromptRef(current.workflow.uiRefs);
        const domPromptForShot = !promptRef && (domComposerReady || composer.domPromptComposer);
        if (!promptRef && !domPromptForShot) {
          const message = `${task.shotId}: BrowserMCP chưa trả ref thật cho ô prompt Nano Banana Pro.`;
          return makeReport("blocked", generatedAssets, message, "FLOW_IMAGE_PROMPT_REF_MISSING");
        }
        let baselineGeneratedMessages = 0;
        let baselineKnown = false;
        let baselineMediaIds = new Set<string>();
        let baselineMediaCount = 0;
        const captureBaselineDom = async (projectUrl: string) => {
          const baselineDom = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
            projectId,
            request: { projectUrl, mode: "inspect_output" },
          });
          baselineGeneratedMessages = baselineDom.generatedMessageCount;
          baselineMediaIds = new Set((baselineDom.mediaIds ?? []).filter(Boolean));
          baselineMediaCount = baselineDom.mediaCount;
          baselineKnown = true;
          return baselineDom;
        };
        const before = await invoke<{ files: BrowserFlowDownloadEntry[] }>("list_browser_flow_downloads", { projectId });
        const beforePaths = new Set(before.files.map((file) => file.relativePath));
        let clickedDownload = false;
        let downloadedName: string | null = null;
        let downloadExhausted = false;
        let reusedExisting = false;

        // Flow history survives the current run. Reuse only an exact card
        // whose visible context proves this shot and revision; never guess
        // from a generic thumbnail list.
        if (currentProjectUrl) {
          try {
            const history = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
              projectId,
              request: { projectUrl: currentProjectUrl, mode: "inspect_output", shotId: task.shotId, revisionId: task.revisionId },
            });
            const historicalIds = [...new Set(history.historicalShotMediaIds ?? [])];
            if (historicalIds.length === 1) {
              const reuseId = historicalIds[0];
              onActivity({ stage: "google_flow.image_reuse", tool: "BrowserOS neo DOM / Google Flow", state: "running", progress: index / tasks.length, message: `${task.shotId}: tìm thấy đúng một ảnh cũ theo identity/nhãn shot ${task.shotId}; đang tải lại để tái sử dụng, chưa tạo ảnh mới.`, output: history.reportPath, nextAction: "Download đúng mediaId cũ rồi chạy Gemini QA." });
              const reused = await invoke<GoogleFlowPlaywrightReport>("run_google_flow_playwright_action", {
                projectId,
                request: { projectUrl: currentProjectUrl, mode: "download_image", shotId: task.shotId, revisionId: task.revisionId, runId, mediaId: reuseId },
              });
              if (reused.status === "ready" && reused.downloadStarted && reused.downloadName && (reused.downloadSizeBytes ?? 0) > 0) {
                reusedExisting = true;
                clickedDownload = true;
                downloadedName = reused.downloadName;
                onActivity({ stage: "google_flow.image_reuse", tool: "BrowserOS neo download / Google Flow", state: "success", progress: index / tasks.length, message: `${task.shotId}: đã tái sử dụng ảnh cũ ${reuseId} (${reused.downloadSizeBytes} bytes); bỏ qua Generate.`, output: reused.reportPath, nextAction: "Import ảnh, cho Gemini chấm, chỉ revision nếu ảnh cũ không đạt." });
              } else {
                onActivity({ stage: "google_flow.image_reuse", tool: "BrowserOS neo download / Google Flow", state: "info", progress: index / tasks.length, message: `${task.shotId}: ảnh cũ khớp nhưng Download không xác nhận; không đoán file, chuyển sang tạo mới.`, output: reused.reportPath, nextAction: "Dùng prompt một shot và chờ output mới." });
              }
            } else if (historicalIds.length > 1) {
              onActivity({ stage: "google_flow.image_reuse", tool: "BrowserOS neo DOM / Google Flow", state: "info", progress: index / tasks.length, message: `${task.shotId}: tìm thấy ${historicalIds.length} ảnh cũ cùng identity; không tự chọn nhầm, sẽ tạo một ảnh mới x1.`, output: history.reportPath, nextAction: "Tạo mới vì lịch sử không đủ bằng chứng để gán ảnh chính xác." });
            }
          } catch (error) {
            const detail = String(error).replace(/^Error:\s*/i, "").slice(0, 220);
            onActivity({ stage: "google_flow.image_reuse", tool: "BrowserOS neo DOM / Google Flow", state: "info", progress: index / tasks.length, message: `${task.shotId}: chưa đọc được lịch sử Flow để tái sử dụng (${detail}); tiếp tục bằng Generate mới.`, nextAction: "Giữ identity một shot và chỉ nhận Download mới của run hiện tại." });
          }
        }

        if (!reusedExisting) {
          onActivity({ stage: "google_flow.image_prompt", tool: "Google Flow / Nano Banana Pro", state: "running", progress: index / tasks.length, message: `${task.shotId}: đang nhập prompt với identity ${task.shotId}/${task.revisionId} (hash ${inputHash.slice(0, 12)}…).`, nextAction: "Chờ Flow xác nhận đã nhận prompt; không gửi lại lần hai." });
        if (currentProjectUrl) {
          try {
            // Capture the output baseline before the side-effecting type action.
            // Flow can remove Start/Stop from the accessibility tree while an
            // image job is transitioning, so the baseline must not be taken
            // after the prompt has already been submitted.
            await captureBaselineDom(currentProjectUrl);
          } catch (error) {
            const detail = String(error).replace(/^Error:\s*/i, "").slice(0, 220);
            onActivity({ stage: "google_flow.output_inspect", tool: "BrowserOS neo DOM / Google Flow", state: "info", progress: index / tasks.length, message: "Chưa chụp được mốc media trước khi nhập prompt: " + detail, nextAction: "Vẫn tiếp tục, nhưng chỉ nhận file mới nếu Downloads xác nhận đúng." });
          }
        }
        if (promptRef) {
          // Fill the live BrowserOS target without submitting. Flow's image
          // composer uses Enter for a newline; generation must be a separate,
          // explicitly verified click on Start generation.
          const typed = await step("type", promptRef.label, promptRef.reference, prompt, false);
          store(typed.workflow);
          if (typed.status !== "ready") {
            const message = `${task.shotId}: Flow chưa xác nhận prompt ảnh: ${typed.message}`;
            return makeReport("blocked", generatedAssets, message, "FLOW_IMAGE_PROMPT_NOT_ACCEPTED");
          }
          const typedSnapshot = await snapshot();
          // Typing a long prompt can immediately start Flow generation. In
          // that state the fresh UI replaces Start generation with Stop; the
          // old Start ref from `typed.workflow` is stale and must never be
          // reused after the fresh snapshot.
          let generationSnapshot = typedSnapshot;
          let generateRef = findBrowserFlowImageGenerateRef(generationSnapshot.workflow.uiRefs);
          let generationActiveRef = generationSnapshot.workflow.uiRefs.find((item) =>
            /button|link/.test(item.role.toLowerCase())
              && /^(stop|dừng|cancel generation|hủy tạo)$/.test(item.label.trim().toLowerCase())
          );
          let generationObservedInDom = false;
          if (!generateRef && !generationActiveRef && currentProjectUrl) {
            // During the first seconds after typing, Flow may hide both
            // controls while the generation request is being committed. Ask
            // the DOM output inspector before declaring the shot blocked; it
            // is the authoritative signal for an active/new media job.
            try {
              const transitionOutput = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
                projectId,
                request: { projectUrl: currentProjectUrl, mode: "inspect_output", shotId: task.shotId, revisionId: task.revisionId, runId },
              });
              const transitionMediaIds = (transitionOutput.matchingBatchCount > 0
                ? (transitionOutput.matchingBatchMediaIds ?? [])
                : transitionOutput.shotRevisionBatchCount > 0
                  ? (transitionOutput.shotRevisionBatchMediaIds ?? [])
                  : (transitionOutput.mediaIds ?? []));
              const freshTransitionMediaIds = baselineKnown
                ? transitionMediaIds.filter((mediaId) => !baselineMediaIds.has(mediaId))
                : [];
              generationObservedInDom = transitionOutput.generationActive || freshTransitionMediaIds.length === 1;
              if (generationObservedInDom) {
                onActivity({ stage: "google_flow.image_generation", tool: "BrowserOS neo DOM / Google Flow / Nano Banana Pro", state: "running", progress: index / tasks.length, message: `${task.shotId}: DOM đã xác nhận Flow đang xử lý prompt hoặc vừa tạo media mới; snapshot UI đang chuyển trạng thái nên không bấm lại.`, output: transitionOutput.reportPath, nextAction: "Chờ generation kết thúc rồi tải đúng media mới của shot này." });
              }
            } catch (error) {
              const detail = String(error).replace(/^Error:\s*/i, "").slice(0, 220);
              onActivity({ stage: "google_flow.output_inspect", tool: "BrowserOS neo DOM / Google Flow", state: "info", progress: index / tasks.length, message: `${task.shotId}: chưa đọc được trạng thái chuyển tiếp sau khi nhập prompt: ${detail}`, nextAction: "Lấy snapshot mới; không gõ lại prompt." });
            }
          }
          if (!generateRef && !generationActiveRef && !generationObservedInDom) {
            // Give Flow a bounded transition window. A fresh snapshot is
            // mandatory before any later click, and the prompt is never typed
            // twice. This covers the live state where Start/Stop disappears
            // for a few seconds between prompt acceptance and generation.
            for (let transitionAttempt = 1; transitionAttempt <= 5 && !generateRef && !generationActiveRef && !generationObservedInDom; transitionAttempt += 1) {
              onActivity({ stage: "google_flow.image_generation", tool: "BrowserOS / Google Flow / Nano Banana Pro", state: "running", progress: index / tasks.length, message: `${task.shotId}: Flow đang chuyển trạng thái sau khi nhận prompt (${transitionAttempt}/5); chưa bấm lại và chưa nhập lại.`, nextAction: "Chờ snapshot mới của cùng shot." });
              const waited = await step("wait", null, null, null, false, 2);
              store(waited.workflow);
              generationSnapshot = await snapshot();
              generateRef = findBrowserFlowImageGenerateRef(generationSnapshot.workflow.uiRefs);
              generationActiveRef = generationSnapshot.workflow.uiRefs.find((item) =>
                /button|link/.test(item.role.toLowerCase())
                  && /^(stop|dừng|cancel generation|hủy tạo)$/.test(item.label.trim().toLowerCase())
              );
              if (!generateRef && !generationActiveRef && currentProjectUrl) {
                try {
                  const transitionOutput = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
                    projectId,
                    request: { projectUrl: currentProjectUrl, mode: "inspect_output", shotId: task.shotId, revisionId: task.revisionId, runId },
                  });
                  const transitionMediaIds = (transitionOutput.matchingBatchCount > 0
                    ? (transitionOutput.matchingBatchMediaIds ?? [])
                    : transitionOutput.shotRevisionBatchCount > 0
                      ? (transitionOutput.shotRevisionBatchMediaIds ?? [])
                      : (transitionOutput.mediaIds ?? []));
                  const freshTransitionMediaIds = baselineKnown
                    ? transitionMediaIds.filter((mediaId) => !baselineMediaIds.has(mediaId))
                    : [];
                  generationObservedInDom = transitionOutput.generationActive || freshTransitionMediaIds.length === 1;
                  if (generationObservedInDom) {
                    onActivity({ stage: "google_flow.image_generation", tool: "BrowserOS neo DOM / Google Flow / Nano Banana Pro", state: "running", progress: index / tasks.length, message: `${task.shotId}: DOM đã xác nhận job sau cửa sổ chuyển trạng thái; tiếp tục chờ output thật.`, output: transitionOutput.reportPath, nextAction: "Chờ generation kết thúc rồi tải đúng media mới." });
                  }
                } catch {
                  // The next bounded snapshot remains the safe fallback.
                }
              }
            }
          }
          if (!generateRef && !generationActiveRef && !generationObservedInDom) {
            const message = `${task.shotId}: đã nhập prompt nhưng Flow không trả ref Start/Stop và DOM không xác nhận generation/output sau cửa sổ chờ; không gửi lại prompt và không đoán nút.`;
            return makeReport("blocked", generatedAssets, message, "FLOW_GENERATE_REF_MISSING");
          }
          const clickGenerate = async (ref: BrowserFlowUiRef) => {
            try {
              return await step("click", ref.label, ref.reference);
            } catch (error) {
              const detail = String(error).replace(/^Error:\s*/i, "").slice(0, 360);
              return {
                status: "blocked",
                message: detail,
                workflow: latestWorkflow ?? typed.workflow,
              } as BrowserFlowWorkflowReport;
            }
          };
          let generated: BrowserFlowWorkflowReport;
          if (generationActiveRef) {
            generated = generationSnapshot;
            onActivity({ stage: "google_flow.image_generation", tool: "BrowserOS / Google Flow / Nano Banana Pro", state: "running", progress: index / tasks.length, message: `${task.shotId}: snapshot mới đã đổi Start generation thành “${generationActiveRef.label}”; Flow đang tạo ảnh, không bấm ref cũ.`, nextAction: "Chờ media mới và Download đúng output của shot này." });
          } else if (generationObservedInDom) {
            generated = generationSnapshot;
            onActivity({ stage: "google_flow.image_generation", tool: "BrowserOS neo DOM / Google Flow / Nano Banana Pro", state: "running", progress: index / tasks.length, message: `${task.shotId}: DOM đã xác nhận generation/output nhưng UI ref chưa ổn định; không click lại, chuyển sang chờ media mới.`, nextAction: "Chờ generation kết thúc rồi tải đúng media mới của shot này." });
          } else {
            generated = await clickGenerate(generateRef!);
            const staleGenerateRef = /unknown ref|take a new snapshot|stale ref/i.test(generated.message.toLowerCase());
            if (generated.status !== "ready" && staleGenerateRef) {
              // Flow may re-render the Generate button between the snapshot
              // and click. Refresh once and only use the fresh ref; never fall
              // back to a ref from the pre-type workflow.
              const freshBeforeGenerate = await snapshot();
              const freshGenerateRef = findBrowserFlowImageGenerateRef(freshBeforeGenerate.workflow.uiRefs);
              const freshGenerationActiveRef = freshBeforeGenerate.workflow.uiRefs.find((item) =>
                /button|link/.test(item.role.toLowerCase())
                  && /^(stop|dừng|cancel generation|hủy tạo)$/.test(item.label.trim().toLowerCase())
              );
              if (freshGenerationActiveRef) {
                generated = freshBeforeGenerate;
                onActivity({ stage: "google_flow.image_generation", tool: "BrowserOS / Google Flow / Nano Banana Pro", state: "running", progress: index / tasks.length, message: `${task.shotId}: snapshot sau lỗi ref cho thấy Flow đã chuyển sang “${freshGenerationActiveRef.label}”; không bấm lại.`, nextAction: "Chờ media mới và Download đúng output của shot này." });
              } else if (freshGenerateRef) {
                onActivity({ stage: "google_flow.browser_ref_refresh", tool: "BrowserOS / Google Flow", state: "info", progress: index / tasks.length, message: `${task.shotId}: ref Generate vừa hết hạn; đã lấy snapshot mới ${freshGenerateRef.reference} và thử lại đúng một lần.`, nextAction: "Chờ BrowserOS xác nhận click mới; không gửi lại prompt." });
                generated = await clickGenerate(freshGenerateRef);
              } else {
                generated = {
                  status: "blocked",
                  message: `${generated.message}; snapshot mới không còn ref Start generation`,
                  workflow: freshBeforeGenerate.workflow,
                } as BrowserFlowWorkflowReport;
              }
            }
          }
          store(generated.workflow);
          if (generated.status !== "ready") {
            const message = `${task.shotId}: BrowserOS không xác nhận click Start generation: ${generated.message}`;
            return makeReport("blocked", generatedAssets, message, "FLOW_GENERATE_CLICK_NOT_ACCEPTED");
          }
          onActivity({ stage: "google_flow.image_generation", tool: "BrowserMCP / Google Flow / Nano Banana Pro", state: "success", progress: index / tasks.length, message: `${task.shotId}: đã nhập prompt bằng UI ref thật và bấm đúng Start generation; đang chờ media mới.`, nextAction: "Chờ ảnh mới xuất hiện trong Flow rồi tải đúng media của lượt này." });
        } else {
          const projectUrl = current.workflow.currentUrl
            ?? current.workflow.providerProjectIdentity?.currentUrl
            ?? null;
          if (!projectUrl) {
            const message = `${task.shotId}: không có URL project Flow hiện tại để khóa CDP DOM; không nhập prompt.`;
            return makeReport("blocked", generatedAssets, message, "FLOW_PROJECT_URL_MISSING");
          }
          const playwrightObserved = await invoke<GoogleFlowPlaywrightReport>("run_google_flow_playwright_action", {
            projectId,
            request: { projectUrl, mode: "observe", runId },
          });
          if (playwrightObserved.status !== "ready") {
            const message = `${task.shotId}: AI không đọc được trạng thái Flow bằng Playwright: ${playwrightObserved.message}`;
            return makeReport("blocked", generatedAssets, message, "FLOW_PLAYWRIGHT_OBSERVE_FAILED");
          }
          const observedControlCount = Number(playwrightObserved.observed?.controlCount ?? 0);
          onActivity({ stage: "google_flow.browser_observe", tool: "BrowserOS neo DOM / Google Flow", state: "success", progress: index / tasks.length, message: `${task.shotId}: BrowserOS đã đọc tab Flow thật (${observedControlCount} control, có accessibility DOM); không dùng tọa độ màn hình.`, output: playwrightObserved.reportPath, nextAction: "Dùng ref đã xác minh để nhập prompt." });
          const playwrightTyped = await invoke<GoogleFlowPlaywrightReport>("run_google_flow_playwright_action", {
            projectId,
            request: { projectUrl, mode: "type_prompt", prompt, runId },
          });
          if (playwrightTyped.status !== "ready" || !playwrightTyped.editorFound || !playwrightTyped.promptAccepted || playwrightTyped.generateClicked) {
            const message = `${task.shotId}: Playwright không xác nhận đúng ô prompt Flow: ${playwrightTyped.message}`;
            return makeReport("blocked", generatedAssets, message, "FLOW_IMAGE_DOM_PROMPT_NOT_ACCEPTED");
          }
          onActivity({ stage: "google_flow.image_prompt", tool: "BrowserOS neo DOM / Google Flow", state: "success", progress: index / tasks.length, message: `${task.shotId}: BrowserOS đã đọc đúng editor và nhập prompt; chưa bấm Generate.`, output: playwrightTyped.reportPath, nextAction: "Bấm Start generation bằng ref đã xác minh." });
          try {
            await captureBaselineDom(projectUrl);
          } catch (error) {
            const detail = String(error).replace(/^Error:\s*/i, "").slice(0, 220);
            onActivity({ stage: "google_flow.output_inspect", tool: "BrowserOS neo DOM / Google Flow", state: "info", progress: index / tasks.length, message: `Chưa chụp được mốc DOM output trước khi Generate: ${detail}`, nextAction: "Vẫn bấm Generate, nhưng chỉ kết luận bằng Download hoặc timeout an toàn." });
          }
          const generated = await invoke<GoogleFlowPlaywrightReport>("run_google_flow_playwright_action", {
            projectId,
            request: { projectUrl, mode: "click_generate", runId },
          });
          if (generated.status !== "ready" || !generated.generateClicked) {
            const message = `${task.shotId}: Playwright không xác nhận nút Start generation: ${generated.message}`;
            return makeReport("blocked", generatedAssets, message, "FLOW_GENERATE_CLICK_NOT_ACCEPTED");
          }
          onActivity({ stage: "google_flow.image_generation", tool: "BrowserOS neo DOM / Google Flow", state: "success", progress: index / tasks.length, message: `${task.shotId}: đã bấm đúng Start generation bằng ref BrowserOS; đang chờ output thật.`, output: generated.reportPath, nextAction: "Chờ ảnh xuất hiện trong Flow rồi tải đúng output mới." });
        }
        }

        const maxWaitSeconds = 300;
        let waitedSeconds = 0;
        let imported: AssetView | null = null;
        while (waitedSeconds < maxWaitSeconds && !imported) {
          let refreshed: BrowserFlowWorkflowReport;
          if (reusedExisting && waitedSeconds === 0) {
            // The historical download is already complete; do not spend a
            // fake generation wait before importing it.
            refreshed = await snapshot();
            waitedSeconds = 12;
          } else {
            const waitFor = Math.min(2, maxWaitSeconds - waitedSeconds);
            const waited = await step("wait", null, null, null, false, waitFor);
            store(waited.workflow);
            waitedSeconds += waitFor;
            refreshed = await snapshot();
          }
          if (waitedSeconds >= 12 && baselineKnown) {
            const projectUrl = refreshed.workflow.currentUrl
              ?? refreshed.workflow.providerProjectIdentity?.currentUrl
              ?? null;
            if (projectUrl) {
              try {
                const outputDom = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
                  projectId,
                  request: { projectUrl, mode: "inspect_output", shotId: task.shotId, revisionId: task.revisionId, runId },
                });
                const candidateMediaIds = outputDom.matchingBatchCount > 0
                  ? (outputDom.matchingBatchMediaIds ?? [])
                  : outputDom.shotRevisionBatchCount > 0
                    ? (outputDom.shotRevisionBatchMediaIds ?? [])
                    : (outputDom.mediaIds ?? []);
                const candidateMediaCount = outputDom.matchingBatchCount > 0
                  ? outputDom.matchingBatchMediaCount
                  : outputDom.shotRevisionBatchCount > 0
                    ? outputDom.shotRevisionBatchMediaCount
                    : 0;
                const freshMediaIds = candidateMediaIds.filter((mediaId) => !baselineMediaIds.has(mediaId));
                const unlabelledFreshMedia = outputDom.mediaCount === baselineMediaCount + 1
                  && outputDom.mediaCount > 0
                  && !outputDom.generationActive
                  && freshMediaIds.length === 0
                  && candidateMediaCount === 0;
                if (freshMediaIds.length > 1) {
                  const message = task.shotId + ": Flow trả về nhiều media mới trong một shot; không thể gán ảnh chính xác.";
                  return makeReport("blocked", generatedAssets, message, "FLOW_IMAGE_OUTPUT_AMBIGUOUS");
                }
                if (candidateMediaCount > 1) {
                  const message = `${task.shotId}: batch hiện tại trả hơn một media dù đã đặt x1; không tải nhầm ảnh.`;
                  return makeReport("blocked", generatedAssets, message, "FLOW_IMAGE_OUTPUT_COUNT_NOT_ONE");
                }
                if (outputDom.status === "blocked_text_only" && outputDom.generatedMessageCount > baselineGeneratedMessages) {
                  const message = `${task.shotId}: Flow chỉ trả về văn bản “đã tạo ảnh”, nhưng DOM không có media output và không có nút Download.`;
                  onActivity({ stage: "google_flow.output_inspect", tool: "BrowserOS neo DOM / Google Flow", state: "blocked", progress: Math.min(0.98, (index + 0.5) / tasks.length), message, output: outputDom.reportPath, nextAction: "Dừng run này; mở đúng image composer/kiểm tra output thật trong Flow rồi chạy lại, không chờ đủ 300 giây." });
                  return makeReport("blocked", generatedAssets, message, "FLOW_IMAGE_TEXT_ONLY_OUTPUT");
                }
                if (unlabelledFreshMedia) {
                  onActivity({ stage: "google_flow.output_inspect", tool: "BrowserOS neo DOM / Google Flow + temporal media analysis", state: "running", progress: Math.min(0.98, (index + 0.5) / tasks.length), message: `${task.shotId}: DOM không gắn RUN_ID nhưng media count tăng đúng +1 (${baselineMediaCount} → ${outputDom.mediaCount}); AI/DOM sẽ chọn tile mới nhất để tải, không dùng card lịch sử.`, output: outputDom.reportPath, nextAction: "Tải đúng tile mới nhất theo DOM delta rồi kiểm tra file mới trên disk." });
                } else if (waitedSeconds >= 45 && outputDom.mediaCount > 0 && candidateMediaCount === 0 && freshMediaIds.length === 0 && !outputDom.generationActive) {
                  const diagnostic = `media=${outputDom.mediaCount}, batchRun=${outputDom.matchingBatchCount}, batchShotRevision=${outputDom.shotRevisionBatchCount}, generationActive=${outputDom.generationActive}, assistantClaims=${outputDom.assistantClaimsGenerated}, imageMode=${outputDom.imageModeFound}, promptEditor=${outputDom.promptEditorFound}, generate=${Boolean(outputDom.generateButtonFound)}, model=${outputDom.selectedModel || "trống"}`;
                  if (shotTransportRetry < 1) {
                    shotTransportRetry += 1;
                    onActivity({ stage: "google_flow.image_transport_retry", tool: "BrowserOS neo DOM + Google Flow", state: "running", progress: Math.min(0.98, (index + 0.5) / tasks.length), message: `${task.shotId}: lần Generate vừa rồi không tạo media mới (${diagnostic}); chụp DOM/snapshot mới và retry cùng shot lần 1/1, không tải ảnh lịch sử.`, output: outputDom.reportPath, nextAction: "Khôi phục image composer exact, nhập lại đúng prompt một lần rồi chờ output mới." });
                    try {
                      if (!latestWorkflow) throw new Error("workflow Flow đã mất trong lúc retry");
                      const recovered = await ensureGoogleFlowImageComposer(latestWorkflow);
                      if (recovered.blocked) throw new Error(recovered.message);
                      latestWorkflow = recovered.workflow;
                      store(latestWorkflow);
                      onActivity({ stage: "google_flow.image_transport_retry", tool: "BrowserOS neo DOM + Google Flow", state: "success", progress: Math.min(0.98, (index + 0.5) / tasks.length), message: `${task.shotId}: đã đọc lại DOM và khóa lại image composer trước khi retry; chưa coi lần trước là thành công.`, output: latestWorkflow.discoveryPath ?? undefined, nextAction: "Nhập lại cùng SHOT_ID/REVISION_ID bằng composer exact và chờ media delta +1." });
                      continue;
                    } catch (error) {
                      const detail = String(error).replace(/^Error:\s*/i, "").slice(0, 300);
                      onActivity({ stage: "google_flow.image_transport_retry", tool: "BrowserOS neo DOM + Google Flow", state: "blocked", progress: Math.min(0.98, (index + 0.5) / tasks.length), message: `${task.shotId}: không khôi phục được image composer để retry: ${detail}`, output: outputDom.reportPath, nextAction: "Giữ nguyên ảnh đã có; mở Flow đúng image composer rồi chạy resume shot này." });
                    }
                  }
                  const message = `${task.shotId}: Flow không sinh media mới sau ${waitedSeconds}s và retry transport thất bại (${diagnostic}); app không tải output lịch sử.`;
                  onActivity({ stage: "google_flow.output_inspect", tool: "BrowserOS neo DOM / Google Flow", state: "blocked", progress: Math.min(0.98, (index + 0.5) / tasks.length), message, output: outputDom.reportPath, nextAction: "Mở đúng image composer/kiểm tra model và credit trong Flow; chạy resume sẽ chỉ làm lại shot thiếu." });
                  return makeReport("blocked", generatedAssets, message, "FLOW_IMAGE_RUN_ID_OUTPUT_NOT_FOUND");
                }
                  if (!clickedDownload && !downloadExhausted && !outputDom.generationActive && (candidateMediaCount > 0 || freshMediaIds.length === 1)) {
                    if (domPromptForShot) {
                      const playwrightDownload = await downloadImageWithRetry({
                        projectUrl,
                        shotId: task.shotId,
                        revisionId: task.revisionId,
                        mediaId: freshMediaIds.length === 1 ? freshMediaIds[0] : undefined,
                      });
                      if (playwrightDownload.status !== "ready" || !playwrightDownload.downloadStarted || !playwrightDownload.downloadName || (playwrightDownload.downloadSizeBytes ?? 0) <= 0) {
                        downloadExhausted = true;
                        onActivity({ stage: "google_flow.image_download", tool: "BrowserOS DOM / Google Flow", state: "blocked", progress: Math.min(0.98, (index + 0.75) / tasks.length), message: `${task.shotId}: Download đã retry đủ 3 lần nhưng chưa có file thật: ${playwrightDownload.message}`, output: playwrightDownload.reportPath, nextAction: "Đánh dấu shot này deferred, chuyển shot kế tiếp; resume sau sẽ retry đúng shot thiếu, không Generate lại và không xoá asset." });
                      } else {
                        clickedDownload = true;
                        downloadedName = playwrightDownload.downloadName;
                        onActivity({ stage: "google_flow.image_download", tool: "BrowserOS neo download / Google Flow", state: "success", progress: Math.min(0.98, (index + 0.75) / tasks.length), message: `${task.shotId}: BrowserOS đã tải đúng ảnh mới và lưu ${playwrightDownload.downloadName} (${playwrightDownload.downloadSizeBytes} bytes).`, output: playwrightDownload.reportPath, nextAction: "Hash/kiểm tra file mới rồi import vào Asset Library." });
                      }
                    } else {
                      // The BrowserOS ref may expose the prompt while the
                      // provider's DOM probe does not expose Download. Use
                      // the same fresh-DOM + exact-batch worker in both cases
                      // so a stale accessibility ref cannot strand the shot.
                      const playwrightDownload = await downloadImageWithRetry({
                        projectUrl,
                        shotId: task.shotId,
                        revisionId: task.revisionId,
                        mediaId: freshMediaIds.length === 1 ? freshMediaIds[0] : undefined,
                      });
                      if (playwrightDownload.status === "ready" && playwrightDownload.downloadStarted && playwrightDownload.downloadName && (playwrightDownload.downloadSizeBytes ?? 0) > 0) {
                        clickedDownload = true;
                        downloadedName = playwrightDownload.downloadName;
                        onActivity({ stage: "google_flow.image_download", tool: "BrowserOS neo download / Google Flow", state: "success", progress: Math.min(0.98, (index + 0.75) / tasks.length), message: `${task.shotId}: BrowserOS đã tải đúng ảnh mới và lưu ${playwrightDownload.downloadName} (${playwrightDownload.downloadSizeBytes} bytes).`, output: playwrightDownload.reportPath, nextAction: "Hash/kiểm tra file mới rồi import vào Asset Library." });
                      } else {
                        downloadExhausted = true;
                        onActivity({ stage: "google_flow.image_download", tool: "BrowserOS DOM / Google Flow", state: "blocked", progress: Math.min(0.98, (index + 0.75) / tasks.length), message: `${task.shotId}: Download đã retry đủ 3 lần nhưng chưa có file thật: ${playwrightDownload.message}`, output: playwrightDownload.reportPath, nextAction: "Đánh dấu shot này deferred, chuyển shot kế tiếp; resume sau sẽ retry đúng shot thiếu, không Generate lại và không xoá asset." });
                      }
                    }
                  }
              } catch (error) {
                const detail = String(error).replace(/^Error:\s*/i, "").slice(0, 220);
                downloadExhausted = true;
                onActivity({ stage: "google_flow.image_download", tool: "BrowserOS DOM / Google Flow", state: "blocked", progress: Math.min(0.98, (index + 0.75) / tasks.length), message: `${task.shotId}: lỗi khi đọc/click Download sau retry: ${detail}`, nextAction: "Đánh dấu shot này deferred, chuyển shot kế tiếp; resume sau sẽ đọc DOM mới và retry đúng shot thiếu." });
              }
            }
          }
          if (downloadExhausted) break;
          const downloads = await invoke<{ files: BrowserFlowDownloadEntry[] }>("list_browser_flow_downloads", { projectId });
          let freshImages = downloads.files
            .filter((file) => file.mediaKind === "image" && !beforePaths.has(file.relativePath))
            .sort((left, right) => Number(right.modifiedAt) - Number(left.modifiedAt));
          if (downloadedName) {
            freshImages = freshImages.filter((file) => file.name === downloadedName || file.relativePath.endsWith(`/${downloadedName}`));
          }
          if (freshImages.length > 1) {
            const message = `${task.shotId}: có ${freshImages.length} ảnh mới sau một lần Download; không thể gán chính xác cho shot này.`;
            return makeReport("blocked", generatedAssets, message, "FLOW_IMAGE_DOWNLOAD_AMBIGUOUS");
          }
          if (clickedDownload && freshImages.length > 0) {
            const importedReport = await invoke<BrowserFlowDownloadImportReport>("import_browser_flow_download", { request: { projectId, workflowId: latestWorkflow!.workflowId, relativePath: freshImages[0].relativePath, runId, shotId: task.shotId, revisionId: task.revisionId, inputHash } });
            store(importedReport.workflow);
            onLoadBrowserFlowWorkflow(activeSessionId);
            imported = importedReport.asset ?? null;
            if (!imported) {
              localAssets = await invoke<AssetView[]>("list_assets", { projectId, includeArchived: false });
              imported = localAssets.find((asset) => asset.relativePath === importedReport.importedPath) ?? null;
            }
            if (imported) {
              generatedAssets.push(imported);
              setComfyuiAssets((currentAssets) => [imported!, ...currentAssets.filter((asset) => asset.assetId !== imported!.assetId)]);
              setScriptDraft((currentScript) => currentScript ? { ...currentScript, comfyuiAssetPaths: [...new Set([...(currentScript.comfyuiAssetPaths ?? []), imported!.relativePath])] } : currentScript);
              let evaluation: BrowserFlowVisualEvaluationReport | null = null;
              try {
                evaluation = await invoke<BrowserFlowVisualEvaluationReport>("evaluate_browser_flow_image", {
                  request: {
                    projectId,
                    workflowId: latestWorkflow!.workflowId,
                    runId,
                    shotId: task.shotId,
                    revisionId: task.revisionId,
                    imageRelativePath: imported.relativePath,
                    prompt,
                    negativePrompt: task.segment.negativePrompt ?? "",
                    continuityNotes: task.segment.continuityNotes ?? "",
                    referenceRelativePaths: sessionAssetPaths().referenceAssetPaths.slice(0, 3),
                  },
                });
                const evaluationState = evaluation.decision === "pass" ? "success" : "info";
                onActivity({
                  stage: "google_flow.image_evaluation",
                  tool: `Gemini Visual QA / ${evaluation.model}`,
                  state: evaluationState,
                  progress: (index + 1) / tasks.length,
                  message: `${task.shotId}: Gemini đã xem ảnh thật — ${evaluation.decision}, điểm ${evaluation.overallScore ?? "?"}/100. ${evaluation.summary}`,
                  output: evaluation.reportPath,
                  nextAction: evaluation.decision === "pass" ? "Vẫn chờ người duyệt creative/rights trước khi sang shot tiếp." : "Xem cờ lỗi và hướng sửa trong hộp duyệt; ảnh chưa được tự coi là đạt.",
                });
              } catch (error) {
                const detail = String(error).replace(/^Error:\s*/i, "").slice(0, 240);
                onActivity({ stage: "google_flow.image_evaluation", tool: "Gemini Visual QA", state: "blocked", progress: (index + 1) / tasks.length, message: `${task.shotId}: Gemini chưa chấm được ảnh; giữ ở review người dùng. ${detail}`, nextAction: "Xem ảnh thật và quyết định thủ công; không tự duyệt khi evaluator lỗi." });
              }
              let reviewAsset = imported;
              let reviewEvaluation = evaluation;
              let reviewRevisionId = task.revisionId;
              if (evaluation?.decision === "revise" && evaluation.revisionInstruction.trim()) {
                try {
                  const firstAsset = imported;
                  const revision = await retryFlowShotOnce(task, prompt, evaluation, 2);
                  imported = revision.asset;
                  reviewAsset = revision.asset;
                  reviewEvaluation = revision.evaluation;
                  reviewRevisionId = revision.revisionId;
                  generatedAssets[generatedAssets.length - 1] = revision.asset;
                  setComfyuiAssets((currentAssets) => [revision.asset, ...currentAssets.filter((asset) => asset.assetId !== firstAsset.assetId && asset.assetId !== revision.asset.assetId)]);
                  setScriptDraft((currentScript) => currentScript ? { ...currentScript, comfyuiAssetPaths: [...new Set([...(currentScript.comfyuiAssetPaths ?? []).filter((path) => path !== firstAsset.relativePath), revision.asset.relativePath])] } : currentScript);
                  onActivity({ stage: "google_flow.image_revision", tool: `Gemini Visual QA / ${evaluation.model}`, state: "success", progress: (index + 1) / tasks.length, message: `${task.shotId}: đã revision một lần thành ${revision.revisionId}; đây là lần tạo cuối cho shot này.`, output: revision.asset.relativePath, nextAction: revision.evaluation?.decision === "pass" ? "Mở review người dùng; không tự bỏ qua duyệt creative/rights." : "Revision vẫn cần người xem và quyết định; không thử lần thứ ba." });
                } catch (error) {
                  const detail = String(error).replace(/^Error:\s*/i, "").slice(0, 300);
                  // A revision is an enhancement, not the shot's only valid
                  // output. Keep the original imported image and continue the
                  // batch when Flow is on the wrong route or fails to render
                  // the revision response.
                  reviewAsset = imported;
                  reviewEvaluation = evaluation;
                  reviewRevisionId = task.revisionId;
                  onActivity({ stage: "google_flow.image_revision", tool: "Gemini revision / Google Flow", state: "info", progress: index / tasks.length, message: `${task.shotId}: revision không thực hiện được, giữ ảnh gốc và chuyển tiếp: ${detail}`, output: imported.relativePath, nextAction: "Không xoá ảnh gốc; tiếp tục shot kế trong cùng batch." });
                }
              }
              onActivity({ stage: "google_flow.image_import", tool: "Google Flow / Nano Banana Pro", state: "success", progress: (index + 1) / tasks.length, message: `${task.shotId}: ${reusedExisting ? "tái sử dụng ảnh Flow cũ" : "đã tải file ảnh mới"}, đăng ký Asset Library, chạy Gemini visual QA${reviewRevisionId !== task.revisionId ? ` và revision thành ${reviewRevisionId}` : ""}.`, output: reviewAsset.relativePath, nextAction: autoApproveImages ? "Agent tự duyệt theo Gemini và chuyển sang shot kế; vẫn giữ human review cuối." : "Mở hộp xác nhận ảnh ở phía trên; workflow chưa chạy shot kế tiếp." });
              const approved = autoApproveImages
                ? (() => {
                    const qaNote = reviewEvaluation
                      ? `Gemini trả ${reviewEvaluation.decision} · ${reviewEvaluation.overallScore ?? "?"}/100${reviewRevisionId !== task.revisionId ? "; đã dùng revision tối đa một lần" : ""}.`
                      : "Gemini không trả được đánh giá; full-auto vẫn tiếp tục và giữ cảnh báo cho review cuối.";
                    onActivity({ stage: "google_flow.image_review", tool: "Studio Flow Agent / Gemini auto-review", state: reviewEvaluation?.decision === "pass" ? "success" : "info", progress: (index + 1) / tasks.length, message: `${task.shotId}: full-auto đã tự duyệt output. ${qaNote}`, output: reviewAsset.relativePath, nextAction: index + 1 < tasks.length ? `Tự chuyển sang ${tasks[index + 1].shotId}; không chờ click.` : "Đã đủ asset; vẫn cần human review creative/rights trước delivery." });
                    return true;
                  })()
                : await waitForFlowImageReview({
                    shotId: task.shotId,
                    revisionId: reviewRevisionId,
                    attempt: reviewRevisionId === task.revisionId ? 1 : 2,
                    asset: reviewAsset,
                    remainingShots: tasks.length - index - 1,
                    evaluation: reviewEvaluation,
                  });
              if (!approved) {
                const message = `${task.shotId}: bạn đánh dấu ảnh chưa đúng; workflow dừng tại shot này để sửa hoặc chạy lại.`;
                setComfyuiAssets((currentAssets) => currentAssets.filter((asset) => asset.assetId !== imported!.assetId));
                setScriptDraft((currentScript) => currentScript ? { ...currentScript, comfyuiAssetPaths: (currentScript.comfyuiAssetPaths ?? []).filter((path) => path !== imported!.relativePath) } : currentScript);
                onActivity({ stage: "google_flow.image_review", tool: "Human review / Asset Library", state: "blocked", progress: index / tasks.length, message, output: imported.relativePath, nextAction: "Sửa prompt/revision rồi chạy lại riêng shot này." });
                return makeReport("blocked", generatedAssets.filter((asset) => asset.assetId !== imported!.assetId), message, "FLOW_IMAGE_REVIEW_REJECTED");
              }
              onActivity({ stage: "google_flow.image_review", tool: "Human review / Asset Library", state: "success", progress: (index + 1) / tasks.length, message: `${task.shotId}: đã xác nhận ảnh đúng; cho phép chuyển shot kế tiếp.`, output: imported.relativePath, nextAction: index + 1 < tasks.length ? `Bắt đầu ${tasks[index + 1].shotId}.` : "Đã duyệt đủ ảnh; chuyển sang bước review tổng." });
            }
          } else {
            onActivity({ stage: "google_flow.image_wait", tool: "Google Flow / Nano Banana Pro", state: "running", progress: Math.min(0.98, (index + waitedSeconds / maxWaitSeconds) / tasks.length), message: `${task.shotId}: Flow đang tạo ảnh (${waitedSeconds}/${maxWaitSeconds}s); chưa thấy Download mới nên chưa báo xong.`, nextAction: "Tiếp tục chờ output ảnh hoặc kiểm tra credit/quota trong chính tab Flow." });
          }
        }
        if (!imported) {
          const message = `${task.shotId}: chưa import được ảnh sau khi chờ/retry Download; deferred, không dừng cả batch.`;
          deferredShots.push(task.shotId);
          onActivity({ stage: "google_flow.image_download", tool: "BrowserOS DOM / Google Flow", state: "info", progress: index / tasks.length, message, nextAction: "Đã chuyển shot kế tiếp. Chạy resume sau sẽ retry đúng shot thiếu theo SHOT_ID/REVISION_ID, không tạo lại ảnh đã có." });
          continue;
        }
        break;
        }
      }
      const complete = generatedAssets.length === tasks.length && deferredShots.length === 0;
      const message = complete
        ? `Google Flow / Nano Banana Pro đã tạo và nhập ${generatedAssets.length}/${tasks.length} ảnh theo từng shot trong cùng project; cần review chất lượng/rights trước khi dựng video.`
        : `Google Flow / Nano Banana Pro đã nhập ${generatedAssets.length}/${tasks.length} ảnh; shot deferred: ${deferredShots.join(", ") || "chưa xác định"}. Không xoá hoặc tạo lại ảnh đã có; chạy resume để retry đúng shot thiếu.`;
      onLoadBrowserFlowWorkflow(activeSessionId);
      onNotice(message);
      onActivity({ stage: "google_flow.image_generation", tool: "Google Flow / Nano Banana Pro", state: complete ? "success" : "blocked", progress: generatedAssets.length / Math.max(1, tasks.length), durationMs: Math.round(performance.now() - startedAt), message, nextAction: complete ? "Review ảnh trong Asset Library rồi mới gửi prompt ảnh-to-video/video cho Flow." : "Giữ nguyên các ảnh đã tải; chạy resume sau khi Flow expose Download để tiếp tục shot deferred." });
      return makeReport(complete ? "succeeded_needs_review" : "blocked", generatedAssets, message, complete ? undefined : "FLOW_IMAGE_SHOTS_DEFERRED");
    } catch (error) {
      const message = `Google Flow / Nano Banana Pro bị dừng: ${String(error).replace(/^Error:\s*/i, "").slice(0, 420)}`;
      onNotice(message);
      onActivity({ stage: "google_flow.image_generation", tool: "Google Flow / Nano Banana Pro", state: "blocked", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Không bấm lặp; giữ nguyên project Flow, xem process log và chạy lại để resume theo input hash." });
      // Preserve every already imported asset. A late revision/download or
      // provider error must never make the UI report 0/N or remove files that
      // were successfully verified in earlier shots.
      return makeReport("blocked", generatedAssets, message, "FLOW_IMAGE_RUNTIME_ERROR");
    } finally {
      setComfyuiGenerating(false);
    }
  }

  // Legacy worker path kept for old reports/cache compatibility. The active
  // image workflow above uses the Nano Banana composer inside Google Flow.
  // BrowserOS neo is now the only supported browser backend. Route any old
  // UI/cache caller into the same per-shot Flow path instead of reviving the
  // retired Chrome-CDP preflight and blocking before the composer.
  async function generateNanoBananaReferenceAssets(nextScript = scriptDraft, allowCloud = cloudGenerationEnabled): Promise<NanoBananaImageGenerationReport | null> {
    return generateGoogleFlowReferenceAssets(nextScript, allowCloud);

    // Kept below only as source-compatible dead code for older cached reports;
    // it must never be reached by the current UI/backend.
    if (!projectId || !nextScript) {
      onNotice("Cần có project và shot plan trước khi tạo ảnh Nano Banana.");
      return null;
    }
    const referenceContext = sessionAssetPaths().referenceAssetPaths.length
      ? `Ảnh tham chiếu local: ${sessionAssetPaths().referenceAssetPaths.join(", ")}`
      : "";
    const promptContract = await currentPromptContract(referenceContext);
    if (!scriptMatchesPrompt(nextScript!, promptContract.sourcePromptHash, promptContract.requirements)) {
      invalidateStaleWorkflow("Không tạo asset Nano Banana: script hiện tại không khớp prompt nguồn hoặc lệch shot count/thời lượng yêu cầu.");
      return null;
    }
    if (!allowCloud) {
      const message = "CLOUD/API đang tắt: chưa gọi Nano Banana, MCP hay Google Flow. Chỉ có thể tiếp tục bằng preview Blender local.";
      onNotice(message);
      onActivity({ stage: "nano_banana.guard", tool: "Policy / Cloud gate", state: "blocked", progress: 0, message, nextAction: "Bật API/cloud generation trong Cài đặt rồi chạy lại." });
      return null;
    }
    const tasks = nextScript!.segments.slice(0, 32).map((segment, index) => ({
      assetId: `nano-shot-${String(index + 1).padStart(3, "0")}-reference`,
      shotId: `SHOT-${String(index + 1).padStart(3, "0")}`,
      title: `Nano Banana reference · Shot ${String(index + 1).padStart(2, "0")}`,
      prompt: `Cinematic 3D reference still for shot ${String(index + 1).padStart(2, "0")}. ${segment.visualPrompt ?? segment.narration}. Preserve subject identity, world scale, camera direction, material language and continuity from the project bible. No UI, no contact sheet, no labels, no watermark.`,
      negativePrompt: `${segment.negativePrompt ?? ""} broken geometry, random characters, text, logo, watermark, contact sheet, debug primitive, duplicate subject`,
      width: 1024,
      height: 576,
      role: "composition",
      rightsStatus: "pending",
    }));
    onActivity({ stage: "nano_banana.chrome_cdp", tool: "Brave CDP / Google Flow", state: "running", progress: 0, message: "Đang tự kiểm tra Brave CDP 9222; nếu chưa có, app sẽ mở cửa sổ Brave Flow bằng session riêng.", nextAction: "Chờ cửa sổ Brave Flow riêng mở; không mở worker trước khi cổng trả lời." });
    let chromeCdp: ChromeCdpLaunchReport;
    try {
      chromeCdp = await invoke<ChromeCdpLaunchReport>("ensure_chrome_cdp_session");
    } catch (error) {
      const message = String(error).replace(/^Error:\s*/i, "").slice(0, 420);
      onNotice(message);
      onActivity({ stage: "nano_banana.chrome_cdp", tool: "Brave CDP / Google Flow", state: "blocked", progress: 0, message, nextAction: "Đảm bảo Brave đã mở profile Flow với CDP 9222; app chưa gọi Nano Banana và chưa tiêu credit." });
      return null;
    }
    if (chromeCdp.needsLogin) {
      const message = `${chromeCdp.message} Đăng nhập xong rồi bấm Tự làm toàn bộ lại; chưa gọi Nano Banana và chưa tiêu credit.`;
      onNotice(message);
      onActivity({ stage: "nano_banana.chrome_cdp", tool: "Brave CDP / Google Flow", state: "waiting_user", progress: 1, message, nextAction: "Chọn account/đăng nhập trong cửa sổ Brave Flow riêng; Brave thường vẫn giữ nguyên." });
      return null;
    }
    onActivity({ stage: "nano_banana.chrome_cdp", tool: "Brave CDP / Google Flow", state: "success", progress: 1, message: chromeCdp.message, nextAction: "Brave CDP đã sẵn sàng; chuyển sang kiểm tra và chạy Nano Banana." });
    setComfyuiGenerating(true);
    const runId = `nano-${Date.now().toString(36)}`;
    const startedAt = performance.now();
    let progressSeen = 0;
    let waitingNoticeShown = false;
    let progressTimer: number | null = null;
    onNotice(`Nano Banana đang kiểm tra Chrome CDP trước khi gửi ${tasks.length} shot — chưa tiêu credit và chưa xếp hàng task.`);
    onActivity({ stage: "nano_banana.validate", tool: "Nano Banana MCP / Google Flow", state: "running", progress: 0.02, message: `Đã chuẩn bị ${tasks.length} task reference; đang kiểm tra Chrome CDP trước khi mở worker.`, nextAction: "Chờ preflight xác nhận http://127.0.0.1:9222/json/version; BrowserMCP 9009 không thay thế CDP." });
    onActivity({ stage: "nano_banana.run", tool: "Nano Banana MCP / Google Flow", state: "running", progress: 0, message: `Run ${runId}: chưa xếp hàng task; đang kiểm tra kết nối Chrome CDP.`, nextAction: "Nếu CDP không phản hồi, app sẽ dừng ngay và không mở Nano Banana worker." });
    const syncProgress = async () => {
      try {
        const snapshot = await invoke<NanoBananaProgressReport>("read_nanobanana_image_progress", { request: { projectId, runId } });
        if (snapshot.exists) {
          const freshEvents = snapshot.events.slice(progressSeen);
          progressSeen = snapshot.events.length;
          for (const entry of freshEvents) {
            const rawState = entry.state ?? "info";
            const state: WorkspaceActivityState = ["running", "success", "info", "waiting_user", "error", "blocked", "cancelled"].includes(rawState)
              ? rawState as WorkspaceActivityState
              : "info";
            onActivity({
              stage: entry.stage ?? "nano_banana.worker",
              tool: "Nano Banana MCP / Google Flow",
              state,
              progress: typeof entry.progress === "number" ? entry.progress : undefined,
              message: entry.message ?? "Worker cập nhật trạng thái.",
              output: entry.shotId ? `${entry.shotId}${entry.taskIndex && entry.taskCount ? ` · ${entry.taskIndex}/${entry.taskCount}` : ""}` : undefined,
              nextAction: state === "running" ? "Đang chờ bước này hoàn tất; nếu đứng lâu, kiểm tra Chrome Flow/CDP." : undefined,
            });
          }
        } else if (!waitingNoticeShown && performance.now() - startedAt > 6000) {
          waitingNoticeShown = true;
          onActivity({ stage: "nano_banana.waiting", tool: "Nano Banana MCP / Google Flow", state: "waiting_user", progress: 0.1, message: "Worker đã được gọi nhưng chưa tạo progress log; nhiều khả năng đang chờ MCP/Chrome Flow CDP phản hồi.", nextAction: "Giữ Chrome Flow đã đăng nhập và CDP 9222; không bấm Generate thủ công trong lúc này." });
        }
      } catch (error) {
        if (!waitingNoticeShown) {
          waitingNoticeShown = true;
          const detail = String(error).replace(/^Error:\s*/i, "").slice(0, 240);
          onActivity({ stage: "nano_banana.progress", tool: "Workspace terminal", state: "info", message: `Chưa đọc được progress worker: ${detail}`, nextAction: "Tiếp tục chờ kết quả cuối; nếu không có report, kiểm tra run folder." });
        }
      }
    };
    progressTimer = window.setInterval(() => void syncProgress(), 1000);
    void syncProgress();
    try {
      // Rust has a child-process timeout, but the UI must not remain locked
      // forever if that child writes a failed report and then hangs on exit.
      // A timed-out invoke is a hard stop for this run; it never advances to Flow.
      const invokeTimeoutMs = Math.min(600_000, Math.max(120_000, tasks.length * 60_000));
      const report = await new Promise<NanoBananaImageGenerationReport>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          reject(new Error(`Nano Banana MCP timeout sau ${Math.round(invokeTimeoutMs / 1000)} giây; worker/report chưa xác nhận hoàn tất, không chạy tiếp sang Flow.`));
        }, invokeTimeoutMs);
        void invoke<NanoBananaImageGenerationReport>("run_nanobanana_image_generation", { request: { projectId: projectId, runId, tasks } })
          .then((result) => {
            window.clearTimeout(timeoutId);
            resolve(result);
          })
          .catch((error) => {
            window.clearTimeout(timeoutId);
            reject(error);
          });
      });
      const reportSucceeded = isNanoBananaGenerationSuccessful(report, tasks.length);
      if (!reportSucceeded) {
        const state = nanoBananaReportFailureState(report);
        const classification = report.failureCode ? ` mã=${report.failureCode}.` : "";
        const detail = report.failureDetail ? ` Chi tiết: ${report.failureDetail}` : "";
        const message = `Nano Banana không hoàn tất: status=${report.status}, ${report.readyCount}/${report.taskCount} asset, ${report.failedCount} task lỗi.${classification} Không nhập asset và không chạy tiếp sang Flow.${detail}`;
        onNotice(message);
        onActivity({ stage: "nano_banana.image_generation", tool: "Nano Banana MCP / Google Flow", state, progress: 1, message: `${message} ${report.message}`.slice(0, 520), output: report.reportPath, nextAction: "Mở report đúng run để xem lỗi MCP/Flow; sửa blocker rồi chạy lại, không dùng output cũ." });
        return report;
      }
      const paths = report.generatedAssets.map((asset) => asset.relativePath);
      setComfyuiAssets((current) => [...report.generatedAssets, ...current.filter((item) => !report.generatedAssets.some((candidate) => candidate.assetId === item.assetId))]);
      setScriptDraft((current) => current ? { ...current, comfyuiAssetPaths: [...new Set([...(current.comfyuiAssetPaths ?? []), ...paths])] } : current);
      onNotice(`Nano Banana: ${report.readyCount}/${report.taskCount} ảnh đã nhập; ${report.failedCount} task lỗi.`);
      onActivity({ stage: "nano_banana.image_generation", tool: "Nano Banana MCP / Google Flow", state: "success", progress: 1, message: report.message, output: report.reportPath, nextAction: "Review rights/quality rồi dùng ảnh làm reference cho Omni." });
      return report;
    } catch (error) {
      const message = String(error).replace(/^Error:\s*/i, "").slice(0, 360);
      onNotice(message || "Không chạy được Nano Banana MCP; kiểm tra server entry và Chrome Flow CDP port 9222.");
      const isTimeout = /timeout/i.test(message);
      onActivity({ stage: "nano_banana.image_generation", tool: "Nano Banana MCP / Google Flow", state: isTimeout ? "error" : "blocked", message: message || "Nano Banana MCP worker bị chặn.", nextAction: isTimeout ? "Mở report của run này để đối chiếu; app đã thoát loading và không chạy tiếp sang Flow." : "Cài/build Nano Banana MCP, mở Chrome Flow đã đăng nhập với CDP 9222 rồi thử lại." });
      return null;
    } finally {
      if (progressTimer !== null) window.clearInterval(progressTimer as number);
      setComfyuiGenerating(false);
    }
  }

  void generateNanoBananaReferenceAssets;


  function updateSegment(segmentId: string, patch: Partial<LocalScriptSegment>) {
    setScriptDraft((current) => current ? { ...current, segments: current.segments.map((segment) => segment.segmentId === segmentId ? { ...segment, ...patch } : segment) } : current);
  }

  async function reviseSelectedShot() {
    if (!scriptDraft || !selectedShot || !revisionPrompt.trim()) {
      onNotice("Chọn một shot và nhập mô tả sửa trước khi chạy lại.");
      return;
    }
    const segmentId = selectedShot.segmentId;
    const sourceIndex = scriptDraft.segments.findIndex((segment) => segment.segmentId === segmentId);
    if (sourceIndex < 0) return;
    const revisionId = `rev-${Date.now().toString(36)}`;
    const revisionText = revisionPrompt.trim();
    const revisedSegment: LocalScriptSegment = {
      ...selectedShot,
      revisionId,
      revisionPrompt: revisionText,
      dirty: true,
      visualPrompt: `${selectedShot.visualPrompt ?? ""}\nREVISION INTENT: ${revisionText}`.trim(),
      action: `${selectedShot.action ?? selectedShot.narration}. Revision intent: ${revisionText}`,
    };
    const nextScript: LocalScriptDocument = {
      ...scriptDraft,
      approvalStatus: "approved",
      segments: scriptDraft.segments.map((segment) => segment.segmentId === segmentId ? revisedSegment : segment),
    };
    const shotLabel = `SHOT-${String(sourceIndex + 1).padStart(3, "0")}`;
    setScriptDraft(nextScript);
    setRevisionPrompt("");
    onNotice(`Đã đánh dấu ${shotLabel} là ${revisionId}; output cũ giữ nguyên, chỉ chạy lại shot có hash mới.`);
    onActivity({ stage: "studio_flow.shot_revision", tool: "Studio Flow Agent", state: "running", message: `Revision ${revisionId} chỉ áp dụng cho ${shotLabel}; các shot đã import cùng hash sẽ được bỏ qua.`, nextAction: "Đang chạy lại shot đã chọn qua Flow rồi import output mới." });
    await startBrowserFlowFromWorkspace(nextScript, null, true, `revision-${Date.now().toString(36)}`);
  }
  function applyShotReferenceBindings(next: ShotReferenceBinding[]) {
    shotReferenceBindingsRef.current = next;
    setShotReferenceBindings(next);
  }

  async function resolveShotReferenceSet(sessionId: string, ownerProjectId: string): Promise<ReferenceSet | null> {
    const recorded = shotReferenceBindingsRef.current.find((binding) => binding.referenceSetId)?.referenceSetId ?? null;
    if (recorded) {
      const existing = referenceSetsRef.current.find((set) => set.referenceSetId === recorded);
      // Only this session's own active shot-scoped set is reused. Every other
      // reference set in the project is left exactly as it was.
      if (existing && existing.projectId === ownerProjectId && existing.status === "active" && existing.scope === "shot") return existing;
    }
    return onCreateReferenceSet({
      name: `Shot start frames · ${sessionIdentityRef.current.sessionName.trim() || "video session"}`.slice(0, 160),
      scope: "shot",
      continuityNote: `Local start-frame references for video session ${sessionId}; each is bound to one source segment, never uploaded to Flow and never approved for generation.`,
    });
  }

  async function persistShotReferenceBindings(
    target: { projectId: string; sessionId: string; segmentId: string; assignmentId: string; previewPath: string },
    bindings: ShotReferenceBinding[],
  ): Promise<VideoWorkflowSession | null> {
    // Pinning the target project and session keeps a switch during the async
    // sequence from writing this binding anywhere else.
    pendingShotBindingRef.current = { ...target, bindings };
    for (let attempt = 0; attempt < 60 && sessionSaveLockRef.current; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    if (sessionSaveLockRef.current) return null;
    // The lock wait is an async boundary: re-check the target before writing,
    // because the save always targets whichever session is active right now.
    if (!isShotReferenceTargetCurrent(target, sessionIdentityRef.current, projectSessionsRef.current)) return null;
    const saved = await saveCurrentSessionRef.current(false);
    // Success means the backend returned this project and session with this
    // exact binding, not merely that some session was written.
    if (!saved || saved.projectId !== target.projectId || saved.sessionId !== target.sessionId) return null;
    const persisted = saved.shotReferenceBindings?.some((binding) => binding.segmentId === target.segmentId && binding.assignmentId === target.assignmentId);
    return persisted ? saved : null;
  }

  async function assignShotReference(
    segmentId: string,
    source: { kind: "path"; sourcePath: string } | { kind: "asset"; asset: AssetView },
    origin: "drop" | "picker" | "existing",
  ) {
    // The active session must belong to the selected project, otherwise the
    // backend would create a brand new session from a foreign id.
    if (!projectId || !activeSessionId || !projectSessionsRef.current.some((session) => session.sessionId === activeSessionId && session.projectId === projectId)) {
      onNotice("Open a saved video session in this project first; a shot reference stays bound to exactly one of its own sessions.");
      return;
    }
    const scriptAtStart = scriptDraftRef.current;
    const sourceIndex = scriptAtStart?.segments.findIndex((segment) => segment.segmentId === segmentId) ?? -1;
    if (!scriptAtStart || sourceIndex < 0) {
      onNotice("Select one ordered shot first; a reference is always assigned to a single source segment.");
      return;
    }
    if (shotReferenceBusyRef.current) {
      onNotice("A shot reference assignment is already running; wait for it to finish before starting another.");
      return;
    }
    if (source.kind === "path") {
      const classified = classifyShotReferenceDropPaths([source.sourcePath]);
      if (!classified.ok) {
        onNotice(classified.message);
        return;
      }
    }
    const projectIdAtStart = projectId;
    const sessionIdAtStart = activeSessionId;
    const shotLabel = `SHOT-${String(sourceIndex + 1).padStart(3, "0")}`;
    const previousBindings = shotReferenceBindingsRef.current;
    const previousBinding = previousBindings.find((binding) => binding.segmentId === segmentId) ?? null;
    // Project, session and segment identity are re-checked after every await so
    // a mid-flight switch can never cross-assign the file to another shot. The
    // target must also still be a real session row of the selected project, or
    // the backend would recreate a deleted session from a stale id.
    const targetIsCurrent = () => isShotReferenceTargetCurrent(
      { projectId: projectIdAtStart, sessionId: sessionIdAtStart },
      sessionIdentityRef.current,
      projectSessionsRef.current,
    );
    const identityIsCurrent = () => targetIsCurrent()
      && Boolean(scriptDraftRef.current?.segments.some((segment) => segment.segmentId === segmentId));
    const abandonNewAssignment = async (assignmentId: string, reason: string) => {
      pendingShotBindingRef.current = null;
      const removed = await onDetachReference(assignmentId);
      onNotice(removed ? reason : `${reason} The new assignment could not be removed either — delete it in the Asset Library.`);
    };

    shotReferenceBusyRef.current = true;
    setShotReferenceBusy(true);
    onActivity({ stage: "shot_reference.assign", tool: "Asset Library", state: "running", message: `Đang gán ảnh local cho ${shotLabel}…`, nextAction: "Import ảnh, gán vào reference set shot rồi lưu binding vào session." });
    try {
      const imported = source.kind === "asset" ? source.asset : await onImport({
        sourcePath: source.sourcePath,
        title: `Shot reference · ${shotLabel}`,
        mediaKind: "image",
        sourceUri: null,
        tags: ["shot-reference", `shot-${sourceIndex + 1}`],
        note: `Local start-frame reference for ${shotLabel}; never uploaded to Flow.`,
        rightsStatus: "pending",
      });
      if (!imported) {
        onNotice(`Could not import an image for ${shotLabel}; the saved shot reference is unchanged.`);
        return;
      }
      if (imported.projectId !== projectIdAtStart) {
        onNotice(`${imported.title} belongs to another project, so it was not assigned to ${shotLabel}.`);
        return;
      }
      if (imported.status === "archived" || imported.status === "missing") {
        onNotice(`${imported.title} is ${imported.status} in this project and cannot be assigned to ${shotLabel}; restore it in the Asset Library first.`);
        return;
      }
      if (!identityIsCurrent()) {
        onNotice(`${imported.title} was imported into the Asset Library, but not assigned because the project, session, or shot changed.`);
        return;
      }
      const referenceSet = await resolveShotReferenceSet(sessionIdAtStart, projectIdAtStart);
      if (!referenceSet) {
        onNotice(`Could not open a shot-scoped reference set for ${shotLabel}; the saved shot reference is unchanged.`);
        return;
      }
      if (!identityIsCurrent()) {
        onNotice(`The reference set is ready, but the project, session, or shot changed, so ${shotLabel} was left unbound.`);
        return;
      }
      const assigned = await onAssignReference({
        referenceSetId: referenceSet.referenceSetId,
        assetId: imported.assetId,
        role: "start_frame",
        strength: 0.85,
        priority: 0,
        shotId: segmentId,
        notes: `Local start frame for ${shotLabel} (${origin}); never uploaded and never approved for generation.`,
        approved: false,
      });
      if (!assigned) {
        onNotice(`Could not assign ${imported.title} to ${shotLabel}; the saved shot reference is unchanged.`);
        return;
      }
      const created = pickCreatedShotAssignment(assigned.assignments, referenceSet.assignments.map((item) => item.assignmentId), imported.assetId, segmentId, imported.sha256);
      if (created.kind !== "found") {
        // Ambiguity is refused rather than guessed: the row cannot be identified
        // without risking that an orphan is adopted as this shot's binding.
        onNotice(created.kind === "ambiguous"
          ? `${created.candidates} new assignments matched ${shotLabel}, so nothing was bound. Remove the duplicate in the Asset Library and retry.`
          : `The reference set did not return a new unapproved start-frame assignment for ${shotLabel}, so nothing was bound.`);
        return;
      }
      const assignment = created.assignment;
      if (!identityIsCurrent()) {
        onNotice(`The reference assignment was created, but the project, session, or shot changed, so ${shotLabel} was left unbound.`);
        await abandonNewAssignment(assignment.assignmentId, "The new assignment was removed again.");
        return;
      }
      const nextBindings = shotReferenceBindingsForScript([
        ...previousBindings.filter((binding) => binding.segmentId !== segmentId),
        {
          segmentId,
          referenceSetId: assigned.referenceSetId,
          assignmentId: assignment.assignmentId,
          assetId: imported.assetId,
          assetSha256: assignment.assetSha256,
          role: "start_frame",
        },
      ], scriptDraftRef.current);

      const saved = identityIsCurrent()
        ? await persistShotReferenceBindings(
          { projectId: projectIdAtStart, sessionId: sessionIdAtStart, segmentId, assignmentId: assignment.assignmentId, previewPath: imported.relativePath },
          nextBindings,
        )
        : null;
      // A failed save must never be replayed by a later autosave, so the pin is
      // consumed on both outcomes.
      pendingShotBindingRef.current = null;
      // The replaced assignment is captured as its own nullable id: the commit
      // union cannot narrow `previousBinding`, and it is the only value the
      // release paths need.
      const replacedAssignmentId = previousBinding && previousBinding.assignmentId !== assignment.assignmentId ? previousBinding.assignmentId : null;
      const commit = resolveShotReferenceCommit({
        saved: Boolean(saved),
        targetIsCurrent: targetIsCurrent(),
        replacesAssignment: replacedAssignmentId !== null,
        targetProjectActive: sessionIdentityRef.current.projectId === projectIdAtStart,
      });
      if (commit.kind === "rollback") {
        await abandonNewAssignment(assignment.assignmentId, `Could not save the session binding for ${shotLabel}; the previous reference and preview were kept.`);
        return;
      }
      // The backend really wrote the target session, so its binding stands.
      // Live state follows it only while that session is still the active one,
      // otherwise the newly active session would be contaminated and autosaved.
      if (commit.liveState === "replace") {
        applyShotReferenceBindings(nextBindings);
        // `revisionImagePath` stays a local preview hint only; it is never a
        // Flow ingredient and never enters the global reference path lists.
        updateSegment(segmentId, { revisionImagePath: imported.relativePath, dirty: true });
        setExistingReferenceAssetId("");
      }
      const quarantined = imported.status === "quarantined" || imported.rightsStatus === "pending";
      const rightsNote = quarantined ? " It stays pending rights and is not upload- or generation-eligible." : "";
      const savedNote = commit.kind === "keep_separate"
        ? `${imported.title} was saved as the start-frame reference for ${shotLabel} in its own session, which is no longer the active one, so the current session's binding and preview were left untouched.${rightsNote}`
        : `${imported.title} is now the local start-frame reference for ${shotLabel}.${rightsNote}`;
      if (commit.release === "not_applicable") {
        onNotice(`${savedNote} Nothing was uploaded to Flow.`);
        return;
      }
      if (!replacedAssignmentId) {
        onNotice(`${savedNote} Nothing was uploaded to Flow.`);
        return;
      }
      const cleanupNotice = `${savedNote} The replaced start-frame assignment ${replacedAssignmentId} belongs to the project that session was saved in and was not released automatically — remove it in that project's Asset Library. Nothing was uploaded to Flow.`;
      // The old assignment is detached only after the new binding is saved, so
      // a failed save never destroys the working reference. The shell detaches
      // against the selected project, so re-check it right before the call.
      if (commit.release === "cleanup_required" || sessionIdentityRef.current.projectId !== projectIdAtStart) {
        onNotice(cleanupNotice);
        return;
      }
      const released = await onDetachReference(replacedAssignmentId);
      onNotice(released
        ? `${savedNote} Nothing was uploaded to Flow.`
        : `${savedNote} The previous start-frame assignment ${replacedAssignmentId} could not be removed — delete it in the Asset Library.`);
    } finally {
      shotReferenceBusyRef.current = false;
      setShotReferenceBusy(false);
    }
  }

  async function attachRevisionReference(segmentId: string) {
    const sourcePath = await onChooseSource();
    if (!sourcePath) return;
    await assignShotReference(segmentId, { kind: "path", sourcePath }, "picker");
  }

  function assignExistingShotReference(segmentId: string, assetId: string) {
    const asset = assetsRef.current.find((item) => item.assetId === assetId) ?? null;
    if (!asset) {
      onNotice("Pick an imported project image before assigning it to this shot.");
      return;
    }
    void assignShotReference(segmentId, { kind: "asset", asset }, "existing");
  }

  function bindingForSegment(segmentId: string) {
    return shotReferenceBindingsRef.current.find((binding) => binding.segmentId === segmentId) ?? null;
  }

  // Step 1: the local, SQLite-authoritative gate. It never uploads anything and
  // it never grants rights — it only reports whether this exact assignment may
  // be prepared for a human import into Flow.
  async function prepareShotReferenceForFlow(segmentId: string) {
    const binding = bindingForSegment(segmentId);
    if (!binding) {
      onNotice("Assign a local image to this shot before preparing it for Flow.");
      return;
    }
    if (flowBindingBusyRef.current) return;
    flowBindingBusyRef.current = true;
    setFlowBindingBusy(true);
    setFlowPreflight(null);
    setFlowCards([]);
    setFlowCardsProjectId("");
    setFlowCardSelection("");
    setFlowCardDiscovery(null);
    setFlowCardsMessage("");
    try {
      const preflight = await invoke<ShotReferenceFlowPreflight>("preflight_shot_reference_flow_binding", {
        projectId,
        request: {
          segmentId: binding.segmentId,
          assetId: binding.assetId,
          referenceSetId: binding.referenceSetId,
          assignmentId: binding.assignmentId,
          assetSha256: binding.assetSha256,
          role: binding.role,
        },
      });
      setFlowPreflight(preflight);
      onNotice(preflight.message);
    } catch (error) {
      onNotice(`Could not check this shot reference locally: ${String(error)}`);
    } finally {
      flowBindingBusyRef.current = false;
      setFlowBindingBusy(false);
    }
  }

  // Step 2: read-only discovery of the image cards the pinned Flow project
  // currently shows. The user imports the image into Flow themselves; this
  // only reads what is already on screen.
  async function discoverFlowImageCards(segmentId: string) {
    const binding = bindingForSegment(segmentId);
    if (!binding) {
      onNotice("Assign a local image to this shot before reading Flow cards.");
      return;
    }
    if (!activeFlowProjectId) {
      setFlowCardsMessage(flowBindingBlockerMessages.no_flow_project);
      return;
    }
    if (flowBindingBusyRef.current) return;
    flowBindingBusyRef.current = true;
    setFlowBindingBusy(true);
    setFlowCards([]);
    setFlowCardsProjectId("");
    setFlowCardSelection("");
    setFlowCardDiscovery(null);
    try {
      const report = await invoke<GoogleFlowImageCardsReport>("discover_google_flow_image_cards", {
        projectId,
        request: { projectUrl: `https://flow.google.com/project/${activeFlowProjectId}` },
      });
      setFlowCards(report.cards);
      setFlowCardsProjectId(report.flowProjectId);
      // The full local identity is captured with the cards, so a reference
      // replaced after this read can never be confirmed against this
      // comparison, and a card list read for another shot stays unusable.
      setFlowCardDiscovery(flowBindingIdentity(binding, projectId));
      const duplicateNote = report.duplicateMediaIds.length
        ? ` ${report.duplicateMediaIds.length} media ID bị trùng nên không thể chọn.`
        : "";
      setFlowCardsMessage(`${report.message}${duplicateNote}`);
      onNotice(report.message);
    } catch (error) {
      setFlowCardsMessage(String(error));
      onNotice(`Could not read Flow image cards: ${String(error)}`);
    } finally {
      flowBindingBusyRef.current = false;
      setFlowBindingBusy(false);
    }
  }

  // Step 3: persist the manual attestation. Nothing is written unless every
  // gate is clear, the human ticked the comparison, and the saved session
  // really comes back with the new binding.
  async function confirmFlowCardBinding(segmentId: string, confirmed: boolean) {
    const binding = bindingForSegment(segmentId);
    const blocker = resolveFlowBindingBlocker({
      projectId,
      binding,
      preflight: flowPreflight,
      selectedFlowProjectId: activeFlowProjectId,
      discoveredFlowProjectId: flowCardsProjectId,
      cards: flowCards,
      selectedMediaId: flowCardSelection,
      discoveredFor: flowCardDiscovery,
    });
    if (blocker) {
      onNotice(flowBindingBlockerMessages[blocker]);
      return;
    }
    if (!binding || !activeSessionId || !projectId) return;
    const confirmedAt = new Date().toISOString();
    const nextBinding = buildConfirmedFlowBinding({
      projectId,
      binding,
      preflight: flowPreflight,
      selectedFlowProjectId: activeFlowProjectId,
      discoveredFlowProjectId: flowCardsProjectId,
      cards: flowCards,
      selectedMediaId: flowCardSelection,
      discoveredFor: flowCardDiscovery,
      confirmed,
      confirmedAt,
    });
    if (!nextBinding) {
      onNotice("The card comparison was not confirmed, so no Flow media ID was saved for this shot.");
      return;
    }
    const target = { projectId, sessionId: activeSessionId, segmentId, assignmentId: binding.assignmentId, previewPath: "" };
    const nextBindings = shotReferenceBindingsForScript([
      ...shotReferenceBindingsRef.current.filter((item) => item.segmentId !== segmentId),
      nextBinding,
    ], scriptDraftRef.current);
    const saved = await persistShotReferenceBindings(target, nextBindings);
    if (!saved) {
      onNotice(`The confirmed Flow card was not saved for ${segmentId}; the previous binding is unchanged.`);
      return;
    }
    applyShotReferenceBindings(nextBindings);
    onNotice(`Flow card ${nextBinding.flowMediaId} in project ${nextBinding.flowProjectId} is now the confirmed start frame for this shot. This is your own visual comparison, not a hash or pixel match, and nothing was uploaded or generated by the app.`);
  }

  // A card thumbnail that the webview cannot actually decode was never a
  // comparable picture. The selection is revoked so the manual comparison gate
  // closes again instead of confirming an image the user never really saw.
  function markFlowCardPreviewFailed(mediaId: string) {
    setFlowCards((current) => flowCardsAfterPreviewFailure(current, mediaId));
    setFlowCardSelection((current) => (current === mediaId ? "" : current));
  }



  function workspaceMediaUrl(relativePath: string) {
    if (isTauri() && projectId.trim()) {
      const params = new URLSearchParams({ projectId: projectId.trim(), path: relativePath });
      if (relativePath.includes("shot-composer-preview")) params.set("cache", String(previewCacheKey));
      return `http://auto3d-media.localhost/media?${params.toString()}`;
    }
    const params = new URLSearchParams({ path: relativePath });
    if (workspaceRoot.trim()) params.set("workspaceRoot", workspaceRoot.trim());
    if (relativePath.includes("shot-composer-preview")) params.set("cache", String(previewCacheKey));
    return `/api/stream-file?${params.toString()}`;
  }

  const flowPromptReady = topic.trim().length >= 3;
  const outputCount = browserFlowWorkflow?.downloadedFiles?.length ?? 0;
  const flowRunFailed = browserFlowWorkflow?.phase === "failed" || browserFlowWorkflow?.phase === "cancelled";
  const runStatus = autoPipelineBusy || browserFlowBusy
    ? "running"
    : flowRunFailed
      ? "blocked"
      : outputCount
        ? "review"
        : scriptDraft
          ? "shot_plan_ready"
          : "draft";
  const runDetail = autoPipelineBusy
    ? "The Flow runner is active; project, model, settings, visible price, and approval checks remain required."
    : browserFlowBusy
      ? "Refreshing Flow state; no new media is assumed."
      : flowRunFailed
        ? "The Flow workflow failed or was cancelled. No output is treated as success."
        : outputCount
          ? "Local outputs are available for human creative, rights, and policy review."
          : scriptDraft
            ? "The ordered shot plan is ready. Generate remains behind fresh Flow state, visible price, and approval."
            : "No workflow run yet. The saved Flow project and chosen model remain unchanged.";

  async function runStudioFlowAgent() {
    if (!flowPromptReady) {
      onNotice("Agent đang chờ prompt. Nhập một chủ đề video trước.");
      return;
    }
    if (autoPipelineBusy || autoPipelineLockRef.current) {
      onNotice("Agent đang chạy một phiên rồi; nút bị khóa để không tạo run/MCP trùng.");
      return;
    }
    autoPipelineLockRef.current = true;
    setAutoPipelineBusy(true);
    let runId = `auto-${Date.now().toString(36)}`;
    let runCheckpointKey: string | null = null;
    onNotice("Đã nhận prompt. Prompt Skill Video đang phân tích và dựng shot plan…");

    let currentStage = "khởi động agent";
    const heartbeatTimer = window.setInterval(() => {
      onActivity({ stage: "prompt_skill_video.heartbeat", tool: "Local Prompt Skill", state: "running", progress: undefined, message: `Prompt Skill vẫn đang chạy ở bước: ${currentStage}.`, nextAction: "Nếu bước này đứng quá lâu, terminal sẽ báo lỗi local hoặc timeout." });
    }, 3000);
    try {
      const referenceContext = sessionAssetPaths().referenceAssetPaths.length
        ? `Ảnh tham chiếu local: ${sessionAssetPaths().referenceAssetPaths.join(", ")}`
        : "";
      const promptContract = await currentPromptContract(referenceContext);
      runCheckpointKey = flowRunCheckpointStorageKey(projectId, activeFlowProjectId, activeSessionId, promptContract.sourcePromptHash);
      if (!runCheckpointKey) throw new Error("Không lập được checkpoint cho project, phiên và prompt hiện tại.");
      const storedCheckpointRaw = localStorage.getItem(runCheckpointKey);
      if (storedCheckpointRaw !== null) {
        const storedCheckpoint = parseFlowRunCheckpoint(storedCheckpointRaw);
        if (!storedCheckpoint) throw new Error("Checkpoint Flow bị lỗi; không mở một run có thể tính phí.");
        runId = storedCheckpoint.runId;
      } else {
        const checkpoint = createFlowRunCheckpoint(runId);
        if (!checkpoint) throw new Error("Run ID mới không hợp lệ.");
        localStorage.setItem(runCheckpointKey, serializeFlowRunCheckpoint(checkpoint));
      }
      onActivity({ stage: "prompt_skill_video.run", tool: "Local Prompt Skill", state: "running", progress: 0, message: `Run ${runId}: prompt → skill pack → shot plan → prompt từng shot.`, nextAction: "Đang phân tích chủ thể, hành động, camera, ánh sáng và continuity." });
      let workingScript = scriptDraft;
      const staleScript = workingScript
        ? !scriptMatchesPrompt(workingScript, promptContract.sourcePromptHash, promptContract.requirements)
        : true;
      if (staleScript && workingScript) {
        invalidateStaleWorkflow(`Script cache không khớp prompt hiện tại (${promptContract.requirements.shotCount ?? "theo prompt"} shot / ${promptContract.requirements.durationSeconds ?? "thời lượng suy ra"} giây); đã loại script/preview/asset/Flow cũ.`);
        workingScript = null;
      }
      if (!workingScript) {
        currentStage = "Director phân tích prompt và chia shot";
        onActivity({ stage: "prompt_skill_video.plan", tool: "Local Prompt Skill", state: "running", progress: 0.08, message: "Đang phân tích prompt, khóa chủ thể/bối cảnh và chia shot độc lập.", nextAction: "Chờ shot plan có cấu trúc." });
        const generated = await onGenerateScript(true, referenceContext);
        if (!generated) {
          onActivity({ stage: "prompt_skill_video.plan", tool: "Local Prompt Skill", state: "blocked", progress: 0.35, message: "Prompt Skill không trả shot plan; agent dừng run này, không chạy bước sau.", nextAction: "Xem lỗi local worker rồi chạy lại." });
          return;
        }
        workingScript = generated;
        if (!scriptMatchesPrompt(workingScript, promptContract.sourcePromptHash, promptContract.requirements)) {
          invalidateStaleWorkflow(`Planner trả script lệch hợp đồng: nhận ${workingScript.segments.length} shot / ${workingScript.totalDurationSeconds}s, không đúng yêu cầu prompt. Đã chặn trước bước Flow.`);
          return;
        }
        setScriptDraft(generated);
        onActivity({ stage: "prompt_skill_video.plan", tool: "Local Prompt Skill", state: "success", progress: 0.9, message: `Đã tạo ${generated.segments.length} shot khác nhau và prompt riêng cho từng shot.`, nextAction: "Kiểm tra shot plan và prompt trước khi chọn provider/render." });
      }

      if (!workingScript) return;
      const flowScript: LocalScriptDocument = { ...workingScript, flowProjectId: activeFlowProjectId };
      const flowRunId = `${runId}-browser-flow`;
      currentStage = "BrowserOS Google Flow tạo video từng shot";
      if (!cloudGenerationEnabled) throw new Error("Cloud generation đang tắt; bật trong Providers trước khi gửi yêu cầu có thể tiêu credit.");
      const generated = await onStartBrowserFlowDiscovery(flowScript, blenderPreviewReport, activeSessionId, true, flowRunId);
      const expectedVideoCount = flowSegmentsForGeneration(flowScript).length;
      const message = generated
        ? `Flow đã hoàn tất ${expectedVideoCount} shot; xem output đã tải/ffprobe trong workspace để review.`
        : "Luồng Google Flow bị chặn hoặc dừng giữa chừng; xem báo cáo BrowserOS để biết shot cuối cùng và lỗi.";
      if (generated) {
        onNotice(message);
        onActivity({ stage: "browser_flow.video_generation", tool: "BrowserOS / Google Flow", state: "success", progress: 1, message, nextAction: "Review từng MP4; không tự publish." });
      }
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi không xác định";
      const message = `Agent dừng ở bước “${currentStage}”: ${detail.slice(0, 420)}`;
      onNotice(message);
      onActivity({ stage: "prompt_skill_video.run", tool: "Local Prompt Skill", state: "error", progress: undefined, message, nextAction: "Sửa prompt hoặc cấu hình Python local rồi chạy lại; chưa có provider nào được gọi." });
    } finally {
      window.clearInterval(heartbeatTimer);
      autoPipelineLockRef.current = false;
      setAutoPipelineBusy(false);
    }
  }



  return <section className="panel one-prompt-workspace" aria-label="Tạo video từ một prompt">
    <section className="google-flow-project-panel" aria-label="Chọn project Google Flow">
      <div className="google-flow-project-heading">
        <div><p className="eyebrow accent">GOOGLE FLOW / VIDEO ĐÍCH</p><h3>Chọn project Flow có sẵn</h3><p>Danh sách được lưu riêng theo project Auto3Dvideo đang mở. Lấy ID từ URL của project trên flow.google.com.</p></div>
        <button type="button" className="secondary-button" disabled={gflowAuthBusy || loading || !projectId} onClick={() => { setGflowAuthBusy(true); void onConnectGflowCli().then(onNotice).catch((error) => onNotice(String(error))).finally(() => setGflowAuthBusy(false)); }}>{gflowAuthBusy ? "⏳ Đang mở đăng nhập…" : "Kết nối Google Flow"}</button>
      </div>
      <div className="google-flow-project-fields">
        <label>Project Flow đã lưu<select value={savedFlowProjects.some((item) => item.projectId === flowProjectId) ? flowProjectId : ""} disabled={!projectId || flowProjectStorageReadyFor !== projectId} onChange={(event) => {
          const selected = savedFlowProjects.find((item) => item.projectId === event.target.value);
          setFlowProjectId(selected?.projectId ?? "");
          setFlowProjectName(selected?.name ?? "");
        }}><option value="">Chưa chọn project Flow</option>{savedFlowProjects.map((item) => <option key={item.projectId} value={item.projectId}>{item.name}</option>)}</select></label>
        <label>Tên dễ nhớ<input value={flowProjectName} onChange={(event) => setFlowProjectName(event.target.value)} maxLength={120} disabled={!projectId || flowProjectStorageReadyFor !== projectId} placeholder="Ví dụ: Video du lịch · Veo" /></label>
        <label>Google Flow Project ID<input value={flowProjectId} onChange={(event) => setFlowProjectId(event.target.value)} maxLength={128} disabled={!projectId || flowProjectStorageReadyFor !== projectId} placeholder="ID trong flow.google.com/project/..." /></label>
        <div className="google-flow-project-actions">
          <button type="button" className="primary-button" onClick={saveFlowProject} disabled={!projectId || flowProjectStorageReadyFor !== projectId || loading}>Lưu và chọn</button>
          <button type="button" className="secondary-button" onClick={removeFlowProject} disabled={!flowProjectId || !savedFlowProjects.some((item) => item.projectId === flowProjectId)}>Bỏ khỏi danh sách</button>
        </div>
      </div>
      <small className="google-flow-project-note">{activeFlowProjectId ? `Project đang chọn: ${flowProjectName} · ${activeFlowProjectId}` : "Chưa có project đích đã lưu. Nhập tên và ID rồi bấm “Lưu và chọn”."} Tạo video sẽ dùng project này; không tự tạo project Flow mới. Generation có thể tiêu tốn credit.</small>
      <div className="google-flow-project-actions">
        <button type="button" className="secondary-button" onClick={() => void selectFlowVideoModel()} disabled={!activeFlowProjectId || loading || autoPipelineBusy || browserFlowBusy || flowVideoModelSelecting}>
          {flowVideoModelSelecting ? "⏳ Đang chọn model…" : flowVideoModelSelectedFor === activeFlowProjectId ? "Đã chọn Omni 1.1 Flash" : "Chọn Omni 1.1 Flash trong Flow"}
        </button>
      </div>
      <small className="google-flow-project-note">Chọn model chỉ thay đổi model trong Flow; không nhập prompt, không bấm Generate và không tự trừ credit. Model cần được xác nhận lại nếu đổi project Flow.</small>
    </section>
      <ProjectWorkspaceCanvas
        projectId={projectId}
        projectName={projectName || "Project workspace"}
        topic={topic}
        sessionName={sessionName}
        sessionDirectory={activeSessionDirectory}
        sessions={projectSessions}
        assets={assets}
        referenceAsset={referenceAsset}
        activeSessionId={activeSessionId}
        shotReferenceBindings={shotReferenceBindings}
        canvasGraph={canvasGraph}
        canvasGraphDirty={canvasGraphDirty}
        script={scriptDraft}
        selectedSegmentId={selectedSegmentId}
        loading={loading}
        agentBusy={autoPipelineBusy || browserFlowBusy}
        sessionSaving={sessionSaving}
        revisionPrompt={revisionPrompt}
        runStatus={runStatus}
        runDetail={runDetail}
        outputCount={outputCount}
        getMediaUrl={workspaceMediaUrl}
        onTopicChange={handleTopicChange}
        onSessionNameChange={setSessionName}
        onOpenSession={(sessionId) => {
          const session = projectSessions.find((item) => item.sessionId === sessionId);
          if (session) openVideoSession(session);
        }}
        onDeleteSession={onDeleteSession}
        onCreateSession={createNewVideoSession}
        onCreateProject={onCreateProject}
        onSaveSession={() => void saveCurrentSession(true)}
        onRunAgent={() => void runStudioFlowAgent()}
        onAttachReference={(segmentId) => void attachRevisionReference(segmentId)}
        onAttachProjectReference={() => void attachReference()}
        shotReferenceBusy={shotReferenceBusy}
        existingReferenceAssetId={existingReferenceAssetId}
        onAssignShotReference={(segmentId, sourcePath) => void assignShotReference(segmentId, { kind: "path", sourcePath }, "drop")}
        onAssignExistingShotReference={assignExistingShotReference}
        onExistingReferenceAssetChange={setExistingReferenceAssetId}
        onSelectSegment={(segmentId) => {
          setSelectedSegmentId(segmentId);
          setRevisionPrompt(scriptDraft?.segments.find((segment) => segment.segmentId === segmentId)?.revisionPrompt ?? "");
        }}
        onUpdateSegment={updateSegment}
        onRevisionPromptChange={setRevisionPrompt}
        onReviseSelectedShot={() => void reviseSelectedShot()}
        onCanvasGraphChange={handleCanvasGraphChange}
        selectedFlowProjectId={activeFlowProjectId}
        flowPreflight={flowPreflight}
        flowCards={flowCards}
        flowCardDiscovery={flowCardDiscovery}
        flowCardsProjectId={flowCardsProjectId}
        flowCardsMessage={flowCardsMessage}
        flowCardSelection={flowCardSelection}
        flowBindingBusy={flowBindingBusy}
        onPrepareShotReferenceForFlow={(segmentId) => void prepareShotReferenceForFlow(segmentId)}
        onDiscoverFlowImageCards={(segmentId) => void discoverFlowImageCards(segmentId)}
        onSelectFlowCard={setFlowCardSelection}
        onFlowCardPreviewFailed={markFlowCardPreviewFailed}
        onConfirmFlowCardBinding={(segmentId, confirmed) => void confirmFlowCardBinding(segmentId, confirmed)}
        onNotice={onNotice}
        onOpenAdvanced={onOpenAdvanced}
      />
      <div className="project-workspace-shot-inspector">
        <section className="project-workspace-shot-inspector-form" aria-label="Compiled shot prompt inspector">
          {selectedShotPromptPreviews?.length ? <>
            <div className="project-workspace-shot-inspector-head"><div><p className="eyebrow accent">PROMPT SẼ GỬI</p><h3>SHOT {String(selectedShotIndex + 1).padStart(3, "0")} · {selectedShot?.segmentId}</h3></div><span>duyệt trước khi bấm Run</span></div>
            <div className="project-workspace-shot-reference">
              <div><strong>Reference state for this shot</strong><span>{selectedShotBinding
                ? `Role ${selectedShotBinding.role}${selectedShotBinding.flowMediaId ? ` · Flow media ${selectedShotBinding.flowMediaId}` : " · no Flow media confirmed yet"}`
                : "No shot reference bound; the prompt asserts no attached image."}</span></div>
              {selectedShotBinding && <dl className="project-workspace-binding-facts">
                <div><dt>Assignment</dt><dd><code>{selectedShotBinding.assignmentId}</code></dd></div>
                <div><dt>Asset</dt><dd><code>{selectedShotBinding.assetId}</code></dd></div>
                <div><dt>SHA-256</dt><dd><code>{selectedShotBinding.assetSha256}</code></dd></div>
                <div><dt>Flow ingredient</dt><dd>{selectedShotBinding.flowMediaId ? `media ${selectedShotBinding.flowMediaId}` : "Not bound in Flow"}</dd></div>
              </dl>}
            </div>
            {selectedShotPromptPreviews.length === 1
              ? <label>Compiled paid prompt<textarea aria-label={`Compiled prompt for shot ${String(selectedShotIndex + 1).padStart(3, "0")}`} value={selectedShotPromptPreviews[0].prompt} readOnly rows={12} /></label>
              : selectedShotPromptPreviews.map((preview) => <label key={preview.partNumber}>{`Part ${preview.partNumber} of ${preview.partCount} · compiled paid prompt`}<textarea aria-label={`Compiled prompt for shot ${String(selectedShotIndex + 1).padStart(3, "0")} part ${preview.partNumber} of ${preview.partCount}`} value={preview.prompt} readOnly rows={12} /></label>)}
            <small>{selectedShotPromptPreviews.length === 1
              ? "This is the exact text the paid run types for this shot. It carries no local path, no provider tag and no attachment claim the app has not verified back from Flow."
              : `This shot runs as ${selectedShotPromptPreviews.length} separate paid parts. Each box above is one part's exact text and each is submitted and paid for on its own; they carry no local path, no provider tag and no attachment claim the app has not verified back from Flow.`}</small>
          </> : <div className="project-workspace-no-shots"><h3>No compiled prompt yet</h3><p>Build a shot plan to see the exact text this run would send before any credit is spent.</p></div>}
        </section>
      </div>
      {flowImageReview && (
        <div className="flow-image-review-card" role="dialog" aria-modal="true" aria-label={`Xác nhận ảnh ${flowImageReview.shotId}`}>
          <div className="flow-image-review-heading">
            <div>
              <p className="eyebrow accent">CHỜ BẠN DUYỆT ẢNH</p>
              <h4>{flowImageReview.shotId} · {flowImageReview.revisionId} · lần {flowImageReview.attempt}/2</h4>
              <p>Ảnh đã tải về, import và được Gemini xem thật. Kiểm tra ảnh bên dưới trước khi workflow được phép chạy shot tiếp theo.</p>
            </div>
            <span className="readiness-chip disabled">TẠM DỪNG</span>
          </div>
          <div className="flow-image-review-media">
            <WorkspaceMediaImage projectId={projectId} relativePath={flowImageReview.asset.relativePath} src={workspaceMediaUrl(flowImageReview.asset.relativePath)} alt={`Ảnh kết quả ${flowImageReview.shotId}`} />
          </div>
          <div className="flow-image-review-meta">
            <span><b>File</b><code>{flowImageReview.asset.relativePath}</code></span>
            <span><b>Còn lại</b><strong>{flowImageReview.remainingShots} shot</strong></span>
            {flowImageReview.evaluation && <span><b>Gemini QA</b><strong>{flowImageReview.evaluation.decision} · {flowImageReview.evaluation.overallScore ?? "?"}/100</strong></span>}
          </div>
          {flowImageReview.evaluation ? (
            <div className="flow-image-review-evaluation">
              <strong>ĐÁNH GIÁ GEMINI / {flowImageReview.evaluation.model}</strong>
              <p>{flowImageReview.evaluation.summary}</p>
              {flowImageReview.evaluation.flags.length > 0 && <small>Cờ cần xem: {flowImageReview.evaluation.flags.join(" · ")}</small>}
              {flowImageReview.evaluation.revisionInstruction && <small>Hướng sửa nếu chưa đạt: {flowImageReview.evaluation.revisionInstruction}</small>}
            </div>
          ) : (
            <div className="flow-image-review-evaluation">
              <strong>GEMINI QA CHƯA CÓ</strong>
              <p>Không nhận được đánh giá máy; quyết định dựa vào ảnh thật và người duyệt.</p>
            </div>
          )}
          <div className="flow-image-review-actions">
            <button type="button" className="primary-button" onClick={() => resolveFlowImageReview(true)}>Ảnh đúng — {flowImageReview.remainingShots > 0 ? "làm tiếp" : "hoàn tất"}</button>
            <button type="button" className="secondary-button" onClick={() => resolveFlowImageReview(false)}>Ảnh sai — dừng tại shot này</button>
          </div>
        </div>
      )}
  </section>;
}
