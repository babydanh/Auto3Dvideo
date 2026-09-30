import { invoke, isTauri } from "@tauri-apps/api/core";
import { MAX_FLOW_VIDEO_GENERATION_SECONDS, boundedBrowserFlowAgentGoal, browserFlowCapabilityCacheIdentity, buildBrowserFlowPrompt, buildBrowserFlowShotPrompt, clearBrowserFlowCapabilityCache, compactBrowserFlowText, describeFlowReferenceCoverage, describeFlowShotReferenceAttach, flowShotImageCoverageFromCards, findBrowserFlowApprovalRef, findBrowserFlowBackRef, findBrowserFlowDownloadRef, findBrowserFlowProjectRef, findBrowserFlowPromptRef, findBrowserFlowStoryboardChoiceRef, findBrowserFlowVideoModeRef, findBrowserFlowVideoNavigationRef, flowProjectIdFromUrl, flowReferenceFingerprint, flowSegmentsForGeneration, flowShotInputHashInput, hasCompleteFlowReferenceSet, inspectBrowserFlowGeneration, inspectBrowserFlowImageAgentMenu, inspectBrowserFlowImageComposer, inspectBrowserFlowVideoComposer, isGoogleFlowSignInPage, planFlowShotReferenceAttach, readBrowserFlowCapabilityCache, sha256Text, stableBrowserFlowPrompt, verifyFlowShotReferenceAttach, writeBrowserFlowCapabilityCache } from "./browserFlowHelpers";
import type { BrowserFlowAgentStepReport, BrowserFlowDownloadEntry, BrowserFlowUiRef, BrowserFlowWorkflow, BrowserFlowWorkflowReport, BrowserMcpFreshState, BrowserMcpRuntimeReport, GoogleFlowDomOutputReport, GoogleFlowVideoActionExecution } from "./browserFlowTypes";
import type { BlenderShotPreviewReport, GoogleFlowPlaywrightReport, ShotReferenceBinding, ShotReferenceFlowPreflight, VideoWorkflowSession, VideoWorkflowSessionInput } from "../oneprompt/onePromptTypes";
import type { AppActivityRecorder, AppActivityUpdater, AppNotice, AppSnapshot } from "../shared/appTypes";
import type { LocalScriptDocument } from "../shared/scriptTypes";
import type { WorkspaceActivityEvent, WorkspaceActivityState } from "../shared/workspaceActivityTypes";
import { checkFlowBatchBudget, createFlowBatchBudgetApproval, parseVisibleFlowCreditCost } from "../../flowBatchBudget";
import type { FlowBatchBudgetApproval } from "../../flowBatchBudget";
import { createFlowRunCheckpoint, flowRunCheckpointInputBlocker, flowRunCheckpointRecordedCredits, flowRunCheckpointRecoveryDecision, flowRunCheckpointShot, flowRunCheckpointStorageKey, parseFlowRunCheckpoint, recordFlowRunCheckpointShot, serializeFlowRunCheckpoint, flowRunReferenceEvidenceStorageKey, parseFlowRunReferenceEvidence, recordFlowRunReferenceEvidence, serializeFlowRunReferenceEvidence } from "../../flowRunCheckpoint";
import type { FlowRunReferenceEvidenceShot } from "../../flowRunCheckpoint";
import { useEffect, useRef, useState } from "react";

export function useBrowserFlowState({ paidGenerationAllowed, recordWorkspaceActivity, selectedProjectId, setNotice, snapshot, topic, updateWorkspaceActivity }: {
  paidGenerationAllowed: boolean;
  recordWorkspaceActivity: AppActivityRecorder;
  selectedProjectId: string;
  setNotice: AppNotice;
  snapshot: AppSnapshot;
  topic: string;
  updateWorkspaceActivity: AppActivityUpdater;
}) {
  const [browserMcpRuntimeReport, setBrowserMcpRuntimeReport] = useState<BrowserMcpRuntimeReport | null>(null);

  const [chromeAutoFlowReport, setChromeAutoFlowReport] = useState<BrowserMcpRuntimeReport | null>(null);

  const [browserMcpFreshState, setBrowserMcpFreshState] = useState<BrowserMcpFreshState>({ status: "unknown", uiRefCount: 0, checkedAt: 0 });

  const [browserHandoffBusy, setBrowserHandoffBusy] = useState(false);

  const [browserFlowWorkflow, setBrowserFlowWorkflow] = useState<BrowserFlowWorkflow | null>(null);

  const [flowBatchApprovalRequest, setFlowBatchApprovalRequest] = useState<{ message: string; totalCreditCap: number; resolve: (approved: boolean) => void } | null>(null);

  const [videoWorkflowSessions, setVideoWorkflowSessions] = useState<VideoWorkflowSession[]>([]);

  const autoFlowWorkspaceBootstrappedRef = useRef(false);

  async function loadVideoWorkflowSessions(projectId = selectedProjectId) {
    if (!projectId) {
      setVideoWorkflowSessions([]);
      return;
    }
    try {
      const sessions = await invoke<VideoWorkflowSession[]>("list_video_workflow_sessions", { projectId });
      setVideoWorkflowSessions(sessions);
    } catch (error) {
      const message = `Không tải được phiên video đã lưu: ${String(error).slice(0, 240)}`;
      setNotice(message);
      recordWorkspaceActivity({ stage: "video_session.load", tool: "Workspace cache", state: "error", message, nextAction: "Kiểm tra workspace local rồi thử làm mới." });
    }
  }

  async function saveVideoWorkflowSession(input: VideoWorkflowSessionInput, announce = false): Promise<VideoWorkflowSession | null> {
    if (!input.projectId) return null;
    try {
      const saved = await invoke<VideoWorkflowSession>("save_video_workflow_session", { input });
      setVideoWorkflowSessions((current) => [saved, ...current.filter((item) => item.sessionId !== saved.sessionId)].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
      if (announce) {
        const message = `Đã lưu phiên “${saved.name}”; app đã nhớ chủ đề, tiến độ và thư mục riêng của phiên.`;
        setNotice(message);
        recordWorkspaceActivity({ stage: "video_session.save", tool: "Session workspace", state: "success", message, output: saved.sessionDirectory ? `${saved.sessionDirectory}/session.json` : ".auto3dvideo/video-workflow-sessions.json", nextAction: "Mở lại phiên này để khôi phục đúng prompt, shot, asset và workflow." });
      }
      return saved;
    } catch (error) {
      const message = `Không lưu được phiên video: ${String(error).slice(0, 320)}`;
      setNotice(message);
      recordWorkspaceActivity({ stage: "video_session.save", tool: "Workspace cache", state: "error", message, nextAction: "Kiểm tra quyền ghi workspace local rồi thử lưu lại." });
      return null;
    }
  }

  async function deleteVideoWorkflowSession(sessionId: string) {
    if (!selectedProjectId) return;
    try {
      await invoke("delete_video_workflow_session", { projectId: selectedProjectId, sessionId });
      setVideoWorkflowSessions((current) => current.filter((item) => item.sessionId !== sessionId));
      setNotice("Đã xóa phiên khỏi danh sách; thư mục output vẫn được giữ nguyên để không mất file.");
      recordWorkspaceActivity({ stage: "video_session.delete", tool: "Session workspace", state: "success", message: "Đã xóa phiên khỏi cache local; không xóa thư mục output để bảo toàn file.", nextAction: "Tạo phiên mới nếu cần." });
    } catch (error) {
      const message = `Không xóa được phiên video: ${String(error).slice(0, 240)}`;
      setNotice(message);
      recordWorkspaceActivity({ stage: "video_session.delete", tool: "Workspace cache", state: "error", message, nextAction: "Kiểm tra cache local rồi thử lại." });
    }
  }

  function applyFreshBrowserMcpReport(report: BrowserMcpRuntimeReport) {
    setBrowserMcpRuntimeReport(report);
    const uiRefCount = Number(report.operationResult?.uiRefCount ?? 0);
    const hasFreshSnapshot = report.operation === "snapshot";
    const attached = report.status === "ready"
      && report.browserSessionAttached
      && !report.operationResult?.isError;
    setBrowserMcpFreshState({
      status: attached && (!hasFreshSnapshot || uiRefCount > 0) ? "attached" : attached ? "session-found" : "not-connected",
      uiRefCount: attached ? uiRefCount : 0,
      checkedAt: Date.now(),
    });
  }

  function clearFreshBrowserMcpState() {
    setBrowserMcpRuntimeReport(null);
    setBrowserMcpFreshState({ status: "not-connected", uiRefCount: 0, checkedAt: Date.now() });
  }

  function applyFreshBrowserFlowWorkflow(workflow: BrowserFlowWorkflow) {
    const attached = workflow.browserSessionAttached === true;
    setBrowserMcpFreshState({
      status: attached && workflow.uiRefCount > 0 ? "attached" : attached ? "session-found" : "not-connected",
      uiRefCount: attached ? workflow.uiRefCount : 0,
      checkedAt: Date.now(),
    });
  }

  async function probeBrowserMcpRuntime() {
    if (!selectedProjectId) {
      setNotice("Hãy tạo/chọn project trước khi kiểm tra BrowserMCP runtime.");
      return;
    }
    setBrowserHandoffBusy(true);
    try {
      const report = await invoke<BrowserMcpRuntimeReport>("probe_browsermcp_runtime", { projectId: selectedProjectId });
      setBrowserMcpRuntimeReport(report);
      setNotice(report.status === "ready" ? `BrowserMCP runtime sẵn sàng: ${report.toolCount} tools; probe không thao tác browser.` : `BrowserMCP runtime bị chặn: ${report.message}`);
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      setNotice(`Không probe được BrowserMCP: ${detail.slice(0, 360)}`);
    } finally {
      setBrowserHandoffBusy(false);
    }
  }

  async function checkBrowserMcpSession() {
    if (!selectedProjectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi kiểm tra kết nối BrowserOS neo.");
      return;
    }
    setBrowserHandoffBusy(true);
    try {
      const report = await invoke<BrowserMcpRuntimeReport>("check_browsermcp_session", { projectId: selectedProjectId });
      applyFreshBrowserMcpReport(report);
      if (!report.browserSessionAttached || report.status === "blocked" || report.operationResult?.isError) {
        setBrowserFlowWorkflow((current) => current ? {
          ...current,
          browserSessionAttached: false,
          uiRefs: [],
          uiRefCount: 0,
          providerProjectIdentity: null,
          visualStatePath: null,
          discoveryStatus: "blocked",
          phase: "waiting_user",
          lastMessage: report.message,
        } : current);
      }
      setNotice(report.browserSessionAttached
        ? "BrowserOS neo đã kết nối MCP. Session này được giữ cho quy trình video theo từng shot."
        : `Chưa kết nối được BrowserOS neo: ${report.message}`);
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi state không xác định";
      clearFreshBrowserMcpState();
      setNotice(`Không kiểm tra được kết nối BrowserOS neo: ${detail.slice(0, 360)}`);
    } finally {
      setBrowserHandoffBusy(false);
    }
  }

  async function openAutoFlowWorkspace() {
    if (!selectedProjectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi mở BrowserOS neo.");
      return;
    }
    setBrowserHandoffBusy(true);
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({
      stage: "browser_flow.auto_workspace",
      tool: "BrowserOS neo / Google Flow",
      state: "running",
      progress: 0,
      message: "Đang mở/kiểm tra session BrowserOS neo và tab Google Flow; chưa gọi Generate.",
      nextAction: "Chờ BrowserOS trả snapshot thật; nếu Flow ở /about thì đăng nhập trong profile BrowserOS.",
    });
    try {
      const openBrowserOsAtSavedRoute = async () => {
        let cachedWorkflow = browserFlowWorkflow;
        if (!cachedWorkflow) {
          try {
            const cached = await invoke<BrowserFlowWorkflowReport | null>("get_latest_browser_flow_workflow", { projectId: selectedProjectId, sessionId: null });
            cachedWorkflow = cached?.workflow ?? null;
            if (cachedWorkflow) setBrowserFlowWorkflow(cachedWorkflow);
          } catch {
            // Opening the Flow home page remains the safe fallback when no
            // local workflow cache exists yet.
          }
        }
        const targetUrl = cachedWorkflow?.currentUrl
          ?? cachedWorkflow?.providerProjectIdentity?.currentUrl
          ?? null;
        await invoke<string>("open_browseros_flow", { targetUrl });
      };
      const waitForBrowserOs = () => new Promise<void>((resolve) => window.setTimeout(resolve, 1800));
      let report: BrowserMcpRuntimeReport;
      try {
        report = await invoke<BrowserMcpRuntimeReport>("check_browsermcp_session", { projectId: selectedProjectId });
      } catch (firstError) {
        await openBrowserOsAtSavedRoute();
        await waitForBrowserOs();
        report = await invoke<BrowserMcpRuntimeReport>("check_browsermcp_session", { projectId: selectedProjectId });
        if (firstError) {
          recordWorkspaceActivity({ stage: "browser_flow.auto_workspace", tool: "BrowserOS neo", state: "info", message: "Snapshot đầu tiên lỗi; đã tự mở lại BrowserOS rồi thử lại.", nextAction: "Đang xác nhận tab Google Flow mới." });
        }
      }
      const initiallyAttached = report.browserSessionAttached && report.status !== "blocked" && !report.operationResult?.isError;
      if (!initiallyAttached) {
        await openBrowserOsAtSavedRoute();
        await waitForBrowserOs();
        report = await invoke<BrowserMcpRuntimeReport>("check_browsermcp_session", { projectId: selectedProjectId });
      }
      setChromeAutoFlowReport(report);
      applyFreshBrowserMcpReport(report);
      const attached = report.browserSessionAttached && report.status !== "blocked" && !report.operationResult?.isError;
      const message = attached
        ? `BrowserOS neo đã sẵn sàng và đã đọc snapshot Flow. ${report.message}`
        : `BrowserOS neo chưa xác nhận snapshot Flow: ${report.message}`;
      setNotice(attached
        ? `${message} Nếu Flow đang ở /about, đăng nhập trong cửa sổ BrowserOS neo.`
        : message);
      updateWorkspaceActivity(activityId, {
        state: attached ? "success" : "waiting_user",
        progress: attached ? 1 : 0.8,
        durationMs: Math.round(performance.now() - startedAt),
        message,
        nextAction: "Đăng nhập Google Flow trong profile BrowserOS neo nếu snapshot còn ở /about; sau đó chạy lại kiểm tra.",
      });
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi state không xác định";
      const message = `Không mở/kiểm tra được BrowserOS neo: ${detail.slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra BrowserOS neo đang chạy rồi thử lại." });
    } finally {
      setBrowserHandoffBusy(false);
    }
  }

  useEffect(() => {
    if (!isTauri() || !selectedProjectId || autoFlowWorkspaceBootstrappedRef.current) return;
    autoFlowWorkspaceBootstrappedRef.current = true;
    void openAutoFlowWorkspace();
  }, [selectedProjectId]);

  async function loadLatestBrowserFlowWorkflow(projectId: string, sessionId?: string | null) {
    try {
      const report = await invoke<BrowserFlowWorkflowReport | null>("get_latest_browser_flow_workflow", { projectId, sessionId: sessionId ?? null });
      setBrowserFlowWorkflow(report?.workflow ?? null);
      setBrowserMcpFreshState({ status: "unknown", uiRefCount: 0, checkedAt: 0 });
      if (report) {
        setNotice(`${report.message} Roadmap, process và file binding của đúng session đã được khôi phục.`);
      }
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "cache workflow không đọc được";
      setBrowserFlowWorkflow(null);
      recordWorkspaceActivity({ stage: "browser_flow.restore", tool: "BrowserMCP", state: "error", message: `Không khôi phục được Browser Flow cache: ${detail.slice(0, 360)}`, nextAction: "Quét route lần đầu để tạo workflow mới; không dùng state lỗi." });
    }
  }

  async function runBrowserFlowAgentOnce(workflow: BrowserFlowWorkflow, goal: string, text: string | null = null): Promise<BrowserFlowAgentStepReport | null> {
    if (!selectedProjectId) return null;
    return invoke<BrowserFlowAgentStepReport>("browser_flow_agent_step", {
      request: {
        projectId: selectedProjectId,
        workflowId: workflow.workflowId,
        goal: boundedBrowserFlowAgentGoal(goal),
        text,
        approved: true,
      },
    });
  }

  async function runBrowserFlowAgent(workflow: BrowserFlowWorkflow, goal: string, text: string | null = null): Promise<BrowserFlowAgentStepReport | null> {
    let latestWorkflow = workflow;
    let last: BrowserFlowAgentStepReport | null = null;
    const seenActions = new Set<string>();
    const maxSteps = 4;
    let recoveryGoal = goal;
    for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
      let agent: BrowserFlowAgentStepReport;
      try {
        agent = await runBrowserFlowAgentOnce(latestWorkflow, recoveryGoal, text) as BrowserFlowAgentStepReport;
      } catch (error) {
        const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "planner action không xác định";
        // Rust intentionally rejects stale/unsafe controls. Give the planner
        // a bounded recovery pass with the rejection as context instead of
        // turning a mistaken ref or failed action into a final block. The
        // next planner call captures a fresh screenshot + DOM snapshot.
        const infrastructureFailure = /no python|không tìm thấy.*python|no active credentials|model_not_found|credential|planner request|vượt project workspace/i.test(detail);
        if (!infrastructureFailure && stepIndex < maxSteps - 1) {
          recordWorkspaceActivity({ stage: "browser_flow.agent_recovery", tool: "Vision Browser", state: "running", message: `Planner/action lỗi; đang chụp screenshot + DOM mới để model phân tích lại (${stepIndex + 1}/${maxSteps}): ${compactBrowserFlowText(detail, 180)}`, nextAction: "Chờ planner đọc UI refs mới; không dùng ref lịch sử." });
          recoveryGoal = `${compactBrowserFlowText(goal, 105)}\nRECOVERY: action vừa lỗi (${compactBrowserFlowText(detail, 90)}); chụp screenshot + snapshot DOM mới, đọc lại refs hiện tại, rồi chọn đúng một action an toàn khác. Không dùng ref cũ.`;
          continue;
        }
        throw error;
      }
      if (!agent) return null;
      last = agent;
      latestWorkflow = agent.workflow;
      const action = agent.action?.action;
      if (agent.status !== "ready" || !action || action === "stop") {
        // A failed click/type is not a final composer blocker. The backend
        // already captured a fresh snapshot and screenshot for this planner
        // turn; run one bounded recovery turn so the model can inspect the
        // new page state plus the execution error and choose a current ref.
        // Infrastructure failures (missing Python/credentials/model) cannot
        // be repaired by clicking the page and remain terminal.
        const infrastructureFailure = /no python|không tìm thấy.*python|no active credentials|model_not_found|credential|planner request|vượt project workspace/i.test(agent.message);
        const actionFailed = agent.status === "failed"
          || /action .*failed|click .*failed|type .*failed|không thực hiện|timeout|không xác nhận.*action|không thao tác/i.test(agent.message);
        if (actionFailed && !infrastructureFailure && stepIndex < maxSteps - 1) {
          recordWorkspaceActivity({ stage: "browser_flow.agent_recovery", tool: `Vision Browser / ${agent.model}`, state: "running", message: `Action không thực hiện được; đang chụp screenshot + DOM mới để model phân tích lại (${stepIndex + 1}/${maxSteps}).`, nextAction: "Không dùng ref cũ; chờ model trả action từ snapshot hiện tại." });
          recoveryGoal = `${compactBrowserFlowText(goal, 105)}\nRECOVERY: action vừa lỗi; chụp screenshot + snapshot DOM mới, đọc lại refs hiện tại, rồi chọn đúng một action an toàn khác. Không dùng ref cũ.`;
          continue;
        }
        return agent;
      }
      const actionKey = `${action}:${agent.action?.ref ?? ""}:${agent.action?.textSource ?? ""}`;
      if (seenActions.has(actionKey)) {
        return {
          ...agent,
          status: "waiting_user",
          message: `${agent.message} Agent lặp lại cùng action; đã dừng để không spam thao tác.`,
        };
      }
      seenActions.add(actionKey);
      if (stepIndex === maxSteps - 1) {
        return {
          ...agent,
          message: `${agent.message} Đã hoàn tất ${maxSteps} vòng quan sát–hành động; caller sẽ đọc snapshot mới để xác nhận trạng thái.`,
        };
      }
    }
    return last;
  }

  async function ensureFlowComposer(workflow: BrowserFlowWorkflow, allowProjectOpen: boolean, mode: "video" | "image" = "video"): Promise<{ workflow: BrowserFlowWorkflow; promptRef?: BrowserFlowUiRef; blocked: boolean; message: string }> {
    if (!selectedProjectId) return { workflow, blocked: true, message: "Chưa có project local để mở composer Google Flow." };
    const onActivity = (event: Omit<WorkspaceActivityEvent, "eventId" | "timestamp">) => recordWorkspaceActivity(event);
    let latestWorkflow = workflow;
    let videoNavigationOpened = false;
    const maxComposerAttempts = 6;
    const cacheKey = browserFlowCapabilityCacheIdentity(selectedProjectId, workflow, mode);
    const cachedCapability = cacheKey ? readBrowserFlowCapabilityCache()[cacheKey] : undefined;
    if (cachedCapability) {
      const observedAt = new Date(cachedCapability.observedAt);
      const observedLabel = Number.isNaN(observedAt.getTime()) ? cachedCapability.observedAt : observedAt.toLocaleString("vi-VN");
      // A capability probe is diagnostic evidence, not a permanent route
      // decision. Flow changes its composer refs after login, project
      // navigation and product rollouts; a stale BLOCKED result must never
      // prevent the next run from taking a fresh snapshot and re-planning.
      onActivity({ stage: "browser_flow.composer.cache", tool: "BrowserMCP / Google Flow", state: "info", message: `Bỏ qua probe capability cũ lúc ${observedLabel}; đang chụp DOM/UI refs hiện tại để phân tích lại. Probe cũ: ${cachedCapability.message}`, nextAction: "Đọc snapshot mới rồi chọn control thật đang hiển thị." });
    }
    const store = (next: BrowserFlowWorkflow) => {
      latestWorkflow = next;
      setBrowserFlowWorkflow(next);
    };
    const step = (operation: string, element: string | null = null, elementRef: string | null = null, time: number | null = null) => invoke<BrowserFlowWorkflowReport>("run_browser_flow_step", { request: { projectId: selectedProjectId, workflowId: latestWorkflow.workflowId, operation, approved: true, url: null, element, elementRef, text: null, submit: false, key: null, time } });
    const settleNavigation = async (context: string) => {
      // Flow briefly exposes only a root ref while the selected project or
      // Video route is mounting. Wait for the route and take a fresh snapshot
      // before deciding whether the composer exists.
      const settled = await step("wait", null, null, 2);
      if (settled.status !== "ready") {
        throw new Error(`Flow chưa ổn định sau ${context}: ${settled.message}`);
      }
      store(settled.workflow);
      const refreshed = await step("snapshot");
      if (refreshed.status !== "ready") {
        throw new Error(`Không đọc được snapshot sau ${context}: ${refreshed.message}`);
      }
      store(refreshed.workflow);
      const snapshotMessage = `Snapshot mới sau ${context}; kiểm tra project và composer.`;
      onActivity({ stage: "browser_flow.composer.snapshot", tool: "BrowserMCP / Google Flow", state: "success", message: snapshotMessage, nextAction: "Đọc snapshot mới để xác minh trang đích và composer." });
    };
    for (let attempt = 0; attempt < maxComposerAttempts; attempt += 1) {
      const snapshotMessage = `Đọc snapshot Flow (${attempt + 1}/${maxComposerAttempts}); không dùng ref cũ.`;
      onActivity({ stage: "browser_flow.composer.snapshot", tool: "BrowserMCP / Google Flow", state: "running", message: snapshotMessage, nextAction: "Chờ UI ref hiện tại của Flow." });
      let snapshot: BrowserFlowWorkflowReport;
      try {
        snapshot = await step("snapshot");
      } catch (error) {
        const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "snapshot không xác định";
        const message = `Không đọc được snapshot Flow mới: ${detail.slice(0, 320)}`;
        onActivity({ stage: "browser_flow.composer.snapshot", tool: "BrowserMCP / Google Flow", state: "blocked", message, nextAction: "Giữ đúng tab Flow và kiểm tra BrowserMCP." });
        return { workflow: latestWorkflow, blocked: true, message };
      }
      applyFreshBrowserFlowWorkflow(snapshot.workflow);
      store(snapshot.workflow);
      if (!snapshot.workflow.browserSessionAttached || snapshot.workflow.uiRefs.length === 0) {
        const message = `BrowserMCP chưa trả session/UI ref thật cho composer: ${snapshot.message}`;
        onActivity({ stage: "browser_flow.composer.snapshot", tool: "BrowserMCP / Google Flow", state: "blocked", message, nextAction: "Connect đúng tab Google Flow rồi đọc lại trạng thái." });
        return { workflow: latestWorkflow, blocked: true, message };
      }
      if (isGoogleFlowSignInPage(snapshot.workflow)) {
        const message = "BLOCKED_GOOGLE_SIGN_IN: BrowserOS đang ở màn hình đăng nhập Google, chưa có phiên Google Flow. App không tự nhập tài khoản hoặc mật khẩu.";
        onActivity({ stage: "browser_flow.auth_gate", tool: "BrowserOS / Google Account", state: "blocked", message, nextAction: "Đăng nhập Google một lần trong đúng cửa sổ/profile BrowserOS, giữ nguyên tab Flow rồi bấm Làm mới/Đọc trạng thái Flow." });
        return { workflow: latestWorkflow, blocked: true, message };
      }
      if (!snapshot.workflow.providerProjectIdentity && !snapshot.workflow.projectEntryConfirmed) {
        const projectRef = allowProjectOpen ? findBrowserFlowProjectRef(snapshot.workflow.uiRefs) : undefined;
        if (!projectRef) {
          const message = "Flow đang ở trang chưa xác định project và snapshot không có ref Start Creating/New project an toàn; chưa nhập prompt.";
          onActivity({ stage: "browser_flow.composer.identity", tool: "BrowserMCP / Google Flow", state: "blocked", message, nextAction: "Để Flow hiện trang tạo project, rồi đọc snapshot lại." });
          return { workflow: latestWorkflow, blocked: true, message };
        }
        const beforeProcessIds = new Set(snapshot.workflow.processes.map((process) => process.processId));
        const message = `Flow đang ở trang ngoài project; tự bấm “${projectRef.label}” bằng ref mới rồi chờ URL project.`;
        onActivity({ stage: "browser_flow.composer.acquire", tool: "BrowserMCP / Google Flow", state: "running", message, nextAction: "Chờ Flow mở project và đọc snapshot mới." });
        const clicked = await step("click_project", projectRef.label, projectRef.reference);
        const newClick = [...clicked.workflow.processes].reverse().find((process) => process.operation === "click_project" && !beforeProcessIds.has(process.processId));
        if (clicked.status !== "ready" || newClick?.state !== "succeeded") {
          const blocked = `Không xác nhận được click mở project bằng process mới: ${clicked.message}`;
          onActivity({ stage: "browser_flow.composer.acquire", tool: "BrowserMCP / Google Flow", state: "blocked", message: blocked, nextAction: "Không bấm lặp; đọc lại tab Flow." });
          return { workflow: clicked.workflow, blocked: true, message: blocked };
        }
        store(clicked.workflow);
        const settled = await step("wait", null, null, 2);
        if (!settled.workflow.browserSessionAttached || settled.workflow.uiRefs.length === 0) {
          const blocked = `Flow chưa ổn định sau khi mở project: ${settled.message}`;
          onActivity({ stage: "browser_flow.composer.acquire", tool: "BrowserMCP / Google Flow", state: "blocked", message: blocked, nextAction: "Chờ trang Flow ổn định rồi chạy lại." });
          return { workflow: settled.workflow, blocked: true, message: blocked };
        }
        store(settled.workflow);
        continue;
      }
      if (mode === "video" && snapshot.workflow.currentUrl) {
        const expectedProjectId = flowProjectIdFromUrl(workflow.targetUrl);
        const currentProjectId = flowProjectIdFromUrl(snapshot.workflow.currentUrl);
        const currentPath = new URL(snapshot.workflow.currentUrl).pathname.replace(/\/$/, "");
        if (expectedProjectId && currentProjectId === expectedProjectId && currentPath === `/project/${currentProjectId}`) {
          const settings = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
            projectId: selectedProjectId,
            request: { projectUrl: snapshot.workflow.currentUrl, mode: "inspect_video_settings" },
          });
          if (settings.status === "ready") {
            const refreshed = await step("snapshot");
            if (refreshed.status !== "ready" || !refreshed.workflow.browserSessionAttached || refreshed.workflow.uiRefs.length === 0) {
              const message = `Flow đã mở bảng Video nhưng snapshot mới chưa ổn định: ${refreshed.message}`;
              onActivity({ stage: "browser_flow.composer.verify", tool: "BrowserMCP / Google Flow", state: "blocked", message, nextAction: "Giữ nguyên project; đọc lại snapshot trước khi nhập prompt." });
              return { workflow: refreshed.workflow, blocked: true, message };
            }
            store(refreshed.workflow);
            const composerState = inspectBrowserFlowVideoComposer(refreshed.workflow.uiRefs, settings);
            const selectedSettings = settings.selectedSettingsEvidence.join(" ").toLowerCase();
            const hasAspect = /\b(?:16:9|9:16)\b/.test(selectedSettings);
            const hasResolution = /\b(?:360p|720p|1080p)\b/.test(selectedSettings);
            const hasDuration = /\b(?:4|6|8|10)\s*(?:s|sec(?:onds?)?|giây)\b/.test(selectedSettings);
            const hasPrice = parseVisibleFlowCreditCost(settings.visibleCreditTexts) !== null;
            if (
              settings.projectKey.toLowerCase() === expectedProjectId.toLowerCase()
              && /\b(?:omni|veo)\b/i.test(settings.selectedModel)
              && settings.videoModeFound === true
              && hasAspect && hasResolution && hasDuration && hasPrice
              && composerState.verified
            ) {
              const message = `Đã xác minh video composer của đúng Flow project: ${settings.selectedModel}; ${selectedSettings}; giá hiển thị trước prompt. Không đổi cài đặt.`;
              onActivity({ stage: "browser_flow.composer.verify", tool: "BrowserMCP / Google Flow", state: "success", message, output: settings.reportPath, nextAction: "Tiếp tục qua batch approval; chưa nhập prompt hoặc Generate." });
              return { workflow: refreshed.workflow, blocked: false, message };
            }
            const message = `BLOCKED_VIDEO_COMPOSER: bảng cài đặt mở nhưng thiếu bằng chứng model/video/settings/giá hoặc prompt ref mới. Model=${settings.selectedModel || "không rõ"}; giá=${hasPrice ? "có" : "không có"}.`;
            onActivity({ stage: "browser_flow.composer.verify", tool: "BrowserMCP / Google Flow", state: "blocked", message, output: settings.reportPath, nextAction: "Kiểm tra lựa chọn model và giá trong Flow; không nhập prompt hoặc Generate." });
            return { workflow: refreshed.workflow, blocked: true, message };
          }
        }
      }
      if (mode === "video") {
        const videoModeRef = findBrowserFlowVideoModeRef(snapshot.workflow.uiRefs);
        if (videoModeRef && !/selected|checked|active|đã chọn/.test(videoModeRef.label.toLowerCase())) {
          onActivity({ stage: "browser_flow.video_mode", tool: "BrowserMCP / Google Flow", state: "running", message: `Đang chọn chế độ video “${videoModeRef.label}” bằng ref mới.`, nextAction: "Chờ snapshot mới xác nhận video composer." });
          const selected = await step("click", videoModeRef.label, videoModeRef.reference);
          const selectedProcess = [...selected.workflow.processes].reverse().find((process) => process.operation === "click");
          if (selected.status !== "ready" || selectedProcess?.state !== "succeeded") {
            const message = `Không xác nhận được chế độ video: ${selected.message}`;
            onActivity({ stage: "browser_flow.video_mode", tool: "BrowserMCP / Google Flow", state: "blocked", message, nextAction: "Chọn chế độ video trong Flow rồi chạy snapshot lại." });
            return { workflow: selected.workflow, blocked: true, message };
          }
          store(selected.workflow);
          continue;
        }
        if (!videoModeRef && snapshot.workflow.currentUrl?.includes("/tools")) {
          const backRef = findBrowserFlowBackRef(snapshot.workflow.uiRefs);
          if (backRef) {
            const beforeProcessIds = new Set(snapshot.workflow.processes.map((process) => process.processId));
            const message = `Flow đang ở Tools route; quay lại project bằng ref “${backRef.label}” để tìm Agent/video mode. Chưa nhập prompt và chưa Generate.`;
            onActivity({ stage: "browser_flow.video_mode", tool: "BrowserMCP / Google Flow", state: "running", message, nextAction: "Chờ project quay lại rồi đọc snapshot mới." });
            const backed = await step("click", backRef.label, backRef.reference);
            const newClick = [...backed.workflow.processes].reverse().find((process) => process.operation === "click" && !beforeProcessIds.has(process.processId));
            if (backed.status !== "ready" || newClick?.state !== "succeeded") {
              const blocked = `Không xác nhận được quay lại project từ Tools: ${backed.message}`;
              onActivity({ stage: "browser_flow.video_mode", tool: "BrowserMCP / Google Flow", state: "blocked", message: blocked, nextAction: "Bấm Back trên Flow rồi chạy snapshot lại." });
              return { workflow: backed.workflow, blocked: true, message: blocked };
            }
            store(backed.workflow);
            await settleNavigation("quay lại từ Tools");
            continue;
          }
        }
        if (!videoModeRef && !videoNavigationOpened && snapshot.workflow.currentUrl) {
          const currentProjectId = flowProjectIdFromUrl(snapshot.workflow.currentUrl);
          const expectedProjectId = flowProjectIdFromUrl(workflow.targetUrl);
          const currentPath = new URL(snapshot.workflow.currentUrl).pathname;
          const normalizedCurrentPath = currentPath.endsWith("/") ? currentPath.slice(0, -1) : currentPath;
          if (currentProjectId && currentProjectId === expectedProjectId && normalizedCurrentPath === `/project/${currentProjectId}`) {
            const videoNavRef = findBrowserFlowVideoNavigationRef(snapshot.workflow.uiRefs);
            const beforeProcessIds = new Set(snapshot.workflow.processes.map((process) => process.processId));
            const message = `Flow đang ở đúng project đã chọn; mở mục Video${videoNavRef ? ` bằng ref “${videoNavRef.label}”` : " bằng DOM exact-label đã xác minh"} để tìm composer. Chưa nhập prompt và chưa Generate.`;
            onActivity({ stage: "browser_flow.video_mode", tool: "BrowserMCP / Google Flow", state: "running", message, nextAction: "Chờ mục Video mở rồi đọc snapshot mới." });
            const opened = await step("click", "Video", videoNavRef?.reference ?? null);
            const newClick = [...opened.workflow.processes].reverse().find((process) => process.operation === "click" && !beforeProcessIds.has(process.processId));
            if (opened.status !== "ready" || newClick?.state !== "succeeded") {
              const blocked = `Không xác nhận được mở mục Video trong project hiện tại: ${opened.message}`;
              onActivity({ stage: "browser_flow.video_mode", tool: "BrowserMCP / Google Flow", state: "blocked", message: blocked, nextAction: "Giữ nguyên project và chạy snapshot mới; không dùng Tools hay đoán tọa độ." });
              return { workflow: opened.workflow, blocked: true, message: blocked };
            }
            videoNavigationOpened = true;
            store(opened.workflow);
            await settleNavigation("mở mục Video");
            continue;
          }
        }
      }
      const imageAgentMenu = inspectBrowserFlowImageAgentMenu(snapshot.workflow.uiRefs);
      if (mode === "video" && videoNavigationOpened && imageAgentMenu.verified) {
        const message = "BLOCKED_VIDEO_MODE_NOT_EXPOSED: Flow chỉ trả Agent instructions/Settings/Start generation; chưa có Video/Text-to-video nên không nhập prompt và không Generate.";
        const observedCacheKey = browserFlowCapabilityCacheIdentity(selectedProjectId, snapshot.workflow, mode);
        if (observedCacheKey) {
          const cache = readBrowserFlowCapabilityCache();
          cache[observedCacheKey] = {
            mode: "video",
            providerProjectKey: snapshot.workflow.providerProjectIdentity?.providerProjectKey ?? "",
            currentUrl: snapshot.workflow.currentUrl ?? "",
            observedAt: new Date().toISOString(),
            message,
          };
          writeBrowserFlowCapabilityCache(cache);
        }
        onActivity({ stage: "browser_flow.composer.verify", tool: "BrowserMCP / Google Flow", state: "blocked", message, nextAction: "Bấm “Đọc trạng thái Flow” khi đã chuyển đúng sang project/composer video; app sẽ xoá probe cũ rồi kiểm tra lại." });
        return { workflow: latestWorkflow, blocked: true, message };
      }
      const composerState = mode === "image"
        ? inspectBrowserFlowImageComposer(snapshot.workflow.uiRefs)
        : inspectBrowserFlowVideoComposer(snapshot.workflow.uiRefs);
      if (!composerState.verified) {
        if (mode === "image" && !composerState.creditGate && attempt < 2) {
          try {
            const agent = await runBrowserFlowAgent(
              snapshot.workflow,
              "Fresh refs chưa chứng minh image composer. Chụp screenshot + DOM mới và chỉ chọn một image/Nano Banana/Settings/prompt control rõ ràng. TUYỆT ĐỐI KHÔNG click Agent, Tools, Add media, Media menu, New project, Create New, chat, account hoặc credit; nếu thiếu bằng chứng, trả stop và giữ nguyên project."
            );
            if (agent) {
              store(agent.workflow);
              const plannerWait = agent.action?.action === "wait";
              onActivity({ stage: "browser_flow.agent", tool: `Vision Browser / ${agent.model}`, state: plannerWait || agent.status === "ready" ? "running" : "blocked", message: plannerWait ? `${agent.message} Wait là thao tác hợp lệ không cần UI ref; sẽ đọc snapshot mới.` : agent.message, output: agent.plannerReportPath ?? undefined, nextAction: plannerWait ? "Chờ Flow tải xong rồi đọc snapshot mới." : agent.status === "ready" ? "Đọc snapshot mới sau action của planner." : "Kiểm tra model planner và UI ref hiện tại." });
              if (plannerWait && attempt < 2) continue;
              if (agent.status === "ready" && agent.action?.action !== "stop") continue;
            }
          } catch (error) {
            const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "planner không xác định";
            onActivity({ stage: "browser_flow.agent", tool: "Vision Browser", state: "blocked", message: `Planner không chạy được: ${detail.slice(0, 320)}`, nextAction: "Kiểm tra model vision_browser và credential; không tự click theo tọa độ." });
          }
        }
        const message = composerState.creditGate
          ? "BLOCKED_CREDIT_GATE: Flow báo credit/quota/gói hoặc nâng cấp; full-auto không hỏi lại và không giả đã chạy."
          : mode === "image"
          ? "BLOCKED_IMAGE_COMPOSER: project đã mở nhưng snapshot chưa có Nano Banana Pro + ô prompt ảnh thật; không gõ vào chat."
          : mode === "video" && inspectBrowserFlowVideoComposer(snapshot.workflow.uiRefs).chatOnly
          ? "BLOCKED_CHAT_ROUTE: Flow đang ở Agent/chat panel; text đã được nhận như hội thoại, không phải video composer. Không tiếp tục và không coi là prompt video."
          : (() => {
            const labels = snapshot.workflow.uiRefs.map((item) => item.label.trim().toLowerCase()).filter(Boolean);
            const videoEvidence = inspectBrowserFlowVideoComposer(snapshot.workflow.uiRefs);
            const imageState = inspectBrowserFlowImageComposer(snapshot.workflow.uiRefs);
            if (snapshot.workflow.uiRefs.length <= 1 && !videoEvidence.chatOnly && !imageState.verified) {
              return "FLOW_LOADING_OR_EMPTY: snapshot mới chỉ có ref nền tảng, chưa đủ UI để kết luận composer; chờ Flow tải xong rồi chạy snapshot lại.";
            }
            if (videoNavigationOpened) {
              return "BLOCKED_VIDEO_COMPOSER: mục Video đã mở nhưng Flow chưa expose composer video thật; không nhập prompt và không Generate.";
            }
            const hasVideoMode = videoEvidence.hasVideoMode ? "yes" : "no";
            const hasPrompt = videoEvidence.hasPrompt ? "yes" : "no";
            const hasGenerate = videoEvidence.hasGenerate ? "yes" : "no";
            const hasTools = labels.includes("tools") || labels.includes("công cụ") ? "yes" : "no";
            const hasAgent = labels.includes("agent") ? "yes" : "no";
            const imageComposer = imageState.verified ? "yes" : "no";
            return `BLOCKED_VIDEO_COMPOSER: video_mode=${hasVideoMode}; prompt=${hasPrompt}; generate=${hasGenerate}; image_composer=${imageComposer}; tools_ref=${hasTools}; agent_ref=${hasAgent}; không type/click khi Flow chưa expose video composer thật.`;
          })();
        onActivity({ stage: "browser_flow.composer.verify", tool: "BrowserMCP / Google Flow", state: "blocked", message, nextAction: "Mở Google Flow video composer, chọn Video/Text-to-video và chạy snapshot lại." });
        return { workflow: latestWorkflow, blocked: true, message };
      }
      const promptRef = findBrowserFlowPromptRef(snapshot.workflow.uiRefs);
      if (promptRef) {
        const message = `Đã xác nhận composer hiện tại qua snapshot mới: ${promptRef.label} (${promptRef.reference}).`;
        onActivity({ stage: "browser_flow.composer.ready", tool: "BrowserMCP / Google Flow", state: "success", message, nextAction: "Có thể nạp prompt shot hiện tại." });
        return { workflow: latestWorkflow, promptRef, blocked: false, message };
      }
      if (!allowProjectOpen) {
        const message = `Flow không còn composer sau shot trước; không tự mở project khác và không dùng ref cũ (UI ref hiện tại: ${snapshot.workflow.uiRefCount}).`;
        onActivity({ stage: "browser_flow.composer.ready", tool: "BrowserMCP / Google Flow", state: "blocked", message, nextAction: "Mở lại đúng project Flow rồi chạy resume; không tạo session ngoài chủ đề." });
        return { workflow: latestWorkflow, blocked: true, message };
      }
      const projectRef = findBrowserFlowProjectRef(snapshot.workflow.uiRefs);
      if (!projectRef) {
        const message = `Flow đang mở nhưng snapshot mới không có composer hoặc nút mở/tạo project rõ ràng (UI ref: ${snapshot.workflow.uiRefCount}).`;
        onActivity({ stage: "browser_flow.composer.acquire", tool: "BrowserMCP / Google Flow", state: "blocked", message, nextAction: "Mở project Flow đích hoặc để Flow hiện nút Start Creating/New project." });
        return { workflow: latestWorkflow, blocked: true, message };
      }
      const beforeProcessIds = new Set(snapshot.workflow.processes.map((process) => process.processId));
      const message = `Đã tìm thấy nút project hiện tại “${projectRef.label}”; đang mở bằng ref mới, không dùng click_project lịch sử.`;
      onActivity({ stage: "browser_flow.composer.acquire", tool: "BrowserMCP / Google Flow", state: "running", message, nextAction: "Chờ Flow mở composer rồi đọc snapshot mới." });
      const clicked = await step("click_project", projectRef.label, projectRef.reference);
      const newClick = [...clicked.workflow.processes].reverse().find((process) => process.operation === "click_project" && !beforeProcessIds.has(process.processId));
      if (clicked.status !== "ready" || newClick?.state !== "succeeded") {
        const blocked = `Không xác nhận được click mở project bằng process mới: ${clicked.message}`;
        onActivity({ stage: "browser_flow.composer.acquire", tool: "BrowserMCP / Google Flow", state: "blocked", message: blocked, nextAction: "Không bấm lặp; đọc lại tab Flow." });
        return { workflow: clicked.workflow, blocked: true, message: blocked };
      }
      store(clicked.workflow);
      const settled = await step("wait", null, null, 2);
      if (settled.status !== "ready") {
        const blocked = `Flow chưa ổn định sau khi mở project: ${settled.message}`;
        onActivity({ stage: "browser_flow.composer.acquire", tool: "BrowserMCP / Google Flow", state: "blocked", message: blocked, nextAction: "Chờ trang Flow ổn định rồi chạy lại." });
        return { workflow: settled.workflow, blocked: true, message: blocked };
      }
      store(settled.workflow);
    }
    const message = "Đã đọc lại Flow nhưng chưa xác nhận composer hiện tại.";
    onActivity({ stage: "browser_flow.composer.ready", tool: "BrowserMCP / Google Flow", state: "blocked", message, nextAction: "Không nhập prompt hoặc Generate khi chưa có composer ref." });
    return { workflow: latestWorkflow, blocked: true, message };
  }

  function resolveFlowBatchApproval(approved: boolean) {
    const request = flowBatchApprovalRequest;
    if (!request) return;
    setFlowBatchApprovalRequest(null);
    request.resolve(approved);
  }

  async function autoGenerateBrowserFlowSequential(workflow: BrowserFlowWorkflow, script: LocalScriptDocument, requestedRunId: string, shotReferenceBindings: ShotReferenceBinding[] = []): Promise<{ workflow: BrowserFlowWorkflow; success: boolean; message: string }> {
    if (!selectedProjectId) return { workflow, success: false, message: "Chưa có project để chạy Generate Google Flow." };
    const expectedFlowProjectId = script.flowProjectId?.trim();
    const liveFlowProjectId = workflow.providerProjectIdentity?.providerProjectKey
      ?? flowProjectIdFromUrl(workflow.currentUrl);
    if (!expectedFlowProjectId) return { workflow, success: false, message: "Chưa lưu/chọn Google Flow Project ID; app không đoán project đích." };
    if (!liveFlowProjectId || liveFlowProjectId.toLowerCase() !== expectedFlowProjectId.toLowerCase()) {
      return { workflow, success: false, message: `BLOCKED_WRONG_FLOW_PROJECT: đã chọn ${expectedFlowProjectId}, nhưng tab Flow hiện tại là ${liveFlowProjectId ?? "chưa xác minh"}.` };
    }
    if (!paidGenerationAllowed) {
      return { workflow, success: false, message: "Cloud generation đang tắt; video không được gửi. Bật trong Providers để tiếp tục." };
    }
    const sourcePromptHash = script.sourcePromptHash;
    if (!sourcePromptHash) return { workflow, success: false, message: "Script thiếu source prompt hash; không thể resume an toàn." };
    const runCheckpointKey = flowRunCheckpointStorageKey(selectedProjectId, expectedFlowProjectId, workflow.sessionId, sourcePromptHash);
    if (!runCheckpointKey) return { workflow, success: false, message: "Không lập được khóa resume an toàn cho project, phiên và prompt hiện tại." };
    const rawRunCheckpoint = localStorage.getItem(runCheckpointKey);
    let runCheckpoint = parseFlowRunCheckpoint(rawRunCheckpoint);
    if (rawRunCheckpoint !== null && !runCheckpoint) {
      return { workflow, success: false, message: "Checkpoint Flow bị lỗi; dừng trước khi nhập prompt hoặc Generate để tránh tạo trùng." };
    }
    if (!runCheckpoint) {
      const baseRunId = requestedRunId.endsWith("-browser-flow") ? requestedRunId.slice(0, -"-browser-flow".length) : requestedRunId;
      runCheckpoint = createFlowRunCheckpoint(baseRunId);
      if (!runCheckpoint) return { workflow, success: false, message: "Run ID không hợp lệ; dừng trước khi gọi Google Flow." };
      localStorage.setItem(runCheckpointKey, serializeFlowRunCheckpoint(runCheckpoint));
    }
    const runBaseId = runCheckpoint.runId;
    const runId = `${runBaseId}-browser-flow`;
    const startedAt = performance.now();
    const flowSegments = flowSegmentsForGeneration(script);
    const shotCount = Math.max(1, flowSegments.length);
    // A binding belongs to a source segment, so a split part inherits it and a
    // reordered shot list can never carry an old numeric assignment across.
    const buildShotReferenceEvidence = (input: {
      shotId: string;
      revisionId: string;
      sourceSegmentId: string;
      promptHash: string;
      binding: ShotReferenceBinding | null;
      referenceFingerprint: string | null;
      attach: { reportPath: string | null; sourceMediaId: string } | null;
    }): FlowRunReferenceEvidenceShot | null => {
      if (!input.binding || !input.referenceFingerprint) return null;
      return {
        shotId: input.shotId,
        revisionId: input.revisionId,
        segmentId: input.sourceSegmentId,
        assignmentId: input.binding.assignmentId,
        assetId: input.binding.assetId,
        assetSha256: input.binding.assetSha256,
        flowProjectId: input.binding.flowProjectId?.trim() || expectedFlowProjectId,
        flowMediaId: input.binding.flowMediaId ?? "",
        confirmationKind: input.binding.confirmationKind ?? null,
        promptVersion: script.promptVersion || "cinematic-3d-bible-v1",
        promptHash: input.promptHash,
        referenceFingerprint: input.referenceFingerprint,
        chipVerification: input.attach ? "exact_media_chip_verified" : "recovered_output_not_reattached",
        reportPath: input.attach?.reportPath ?? null,
        recordedAt: new Date().toISOString(),
      };
    };
    const bindingBySourceSegment = (sourceSegmentId: string) => shotReferenceBindings.find((item) => item.segmentId === sourceSegmentId) ?? null;
    const batchPromptResults = flowSegments.map((flowSegment, index) => {
      const segment = flowSegment.segment;
      const revisionId = `${segment.revisionId || "rev-001"}${flowSegment.partCount > 1 ? `-part-${String(flowSegment.partIndex + 1).padStart(2, "0")}` : ""}`;
      const binding = bindingBySourceSegment(flowSegment.sourceSegmentId);
      return buildBrowserFlowShotPrompt(script, segment, index, runId, revisionId, workflow.providerProjectIdentity, workflow.sessionId, topic.trim(), flowSegment.sourceIndex + 1, binding ? { role: binding.role } : null);
    });
    const invalidPromptIndex = batchPromptResults.findIndex((prompt) => !prompt);
    if (invalidPromptIndex >= 0) return { workflow, success: false, message: `BLOCKED_SHOT_BRIEF: shot ${invalidPromptIndex + 1} không có mô tả shot rõ ràng trong brief; chưa nhập prompt hoặc Generate.` };
    const batchPrompts = batchPromptResults as string[];
    const batchShotSummary = batchPrompts.map((prompt, index) => {
      const action = prompt.match(/(?:^|\n)SHOT\s+\d+:\s*([^\n]+)/i)?.[1]
        ?? prompt.match(/(?:^|\n)ACTION\s*\/\s*CAUSE AND EFFECT:\s*([^\n]+)/i)?.[1]
        ?? prompt;
      return `SHOT-${String(index + 1).padStart(3, "0")}: ${compactBrowserFlowText(action, 180)}`;
    }).join("\n");
    // Name the shots that have no downloaded subject image so a shortfall is
    // readable instead of a bare count. This reads the workflow's own import
    // records, so it does not prove what the live Flow grid holds.
    // Shot IDs must come from the same source as the attach lookup below
    // (`sourceIndex + 1`), not the paid-part index: a split shot contributes
    // several paid parts that all share one source shot and one subject image.
    // Ask the Flow page which subject cards it actually holds. The workflow's
    // import records only prove what reached this machine, so a card the user
    // generated on the page but never downloaded would otherwise be invisible
    // and its shot would silently run without its subject. This is a read.
    const batchShotIds = flowSegments.map((entry) => `SHOT-${String(entry.sourceIndex + 1).padStart(3, "0")}`);
    const importedShotIds = new Set(
      (workflow.downloadedFiles ?? [])
        .filter((file) => file.mediaKind === "image" && (file.shotId ?? "").trim())
        .map((file) => (file.shotId ?? "").trim()),
    );
    let gridShotIds = new Set<string>();
    let gridCoverage = flowShotImageCoverageFromCards([], batchShotIds);
    if (script) {
      try {
        const cards = await invoke<{ cards?: { label?: string | null; selectable?: boolean }[] }>("discover_google_flow_image_cards", {
          projectId: selectedProjectId,
          request: { projectUrl: workflow.currentUrl ?? workflow.providerProjectIdentity?.currentUrl ?? "" },
        });
        gridCoverage = flowShotImageCoverageFromCards(cards.cards ?? [], batchShotIds);
        gridShotIds = new Set(gridCoverage.withImage);
      } catch {
        // An unreadable grid leaves the import records as the only evidence. A
        // shot it cannot confirm then stops rather than paying without a
        // subject, so nothing here silently downgrades to text-only.
      }
    }
    // A run is image-driven when any subject image exists anywhere in it. Only
    // a run with no image at all is a genuine text-to-video run.
    const runIsImageDriven = gridShotIds.size > 0 || importedShotIds.size > 0 || shotReferenceBindings.length > 0;
    const referenceSetNote = script ? describeFlowReferenceCoverage(gridCoverage) : "";
    if (referenceSetNote) console.info(`[Auto3DVideo] ${referenceSetNote}`);
    const activityId = recordWorkspaceActivity({
      stage: "studio_flow.shot_run",
      tool: "BrowserMCP / Google Flow",
      state: "running",
      progress: 0,
      message: [`Auto mode đã chia ${shotCount} shot tuần tự; app sẽ xin duyệt một ngân sách batch rồi kiểm tra giá mới trước từng shot.`, referenceSetNote].filter(Boolean).join(" "),
      nextAction: referenceSetNote
        ? "Ảnh chủ thể còn thiếu ở các shot nêu trên; tạo đủ ảnh trên Flow rồi chạy lại nếu muốn video bám ảnh."
        : "Chờ video composer và giá hiện trên nút Generate để tính trần batch.",
    });
    setBrowserHandoffBusy(true);
    let latestWorkflow = workflow;
    const store = (next: BrowserFlowWorkflow, message: string) => { latestWorkflow = next; setBrowserFlowWorkflow(next); setNotice(message); };
    const step = (operation: string, element: string | null = null, elementRef: string | null = null, text: string | null = null, time: number | null = null) => invoke<BrowserFlowWorkflowReport>("run_browser_flow_step", { request: { projectId: selectedProjectId, workflowId: latestWorkflow.workflowId, operation, approved: true, url: null, element, elementRef, text, submit: false, key: null, time } });
    const snapshot = async () => { const result = await step("snapshot"); applyFreshBrowserFlowWorkflow(result.workflow); store(result.workflow, result.message); return result; };
    let approvedBatchBudget: FlowBatchBudgetApproval | null = null;
    let generatedCreditsEstimate = flowRunCheckpointRecordedCredits(runCheckpoint);
    const fail = (message: string, nextAction: string) => {
      const budgetEvidence = approvedBatchBudget
        ? ` Ngân sách batch đã duyệt tối đa ${approvedBatchBudget.totalCreditCap} credit; checkpoint đang theo dõi khoảng ${generatedCreditsEstimate} credit theo giá hiển thị. Khoản trừ thực tế từ Google Flow chưa được xác minh.`
        : "";
      const finalMessage = `${message}${budgetEvidence}`;
      updateWorkspaceActivity(activityId, { state: "blocked", progress: Math.min(0.99, (latestWorkflow.currentStep || 0) / Math.max(1, shotCount * 8)), durationMs: Math.round(performance.now() - startedAt), message: finalMessage, nextAction });
      setNotice(finalMessage);
      return { workflow: latestWorkflow, success: false, message: finalMessage };
    };
    const countRunVideos = (candidate: BrowserFlowWorkflow) => (candidate.downloadedFiles ?? []).filter((file) =>
      file.mediaKind === "video" &&
      file.runId === runId &&
      Boolean(file.shotId && file.revisionId && file.inputHash)
    ).length;
    if (Object.keys(runCheckpoint.submittedShots).length > 0 && workflow.sessionId) {
      const currentRunVideoCount = countRunVideos(latestWorkflow);
      const restored = await invoke<BrowserFlowWorkflowReport | null>("get_browser_flow_workflow_for_run", {
        projectId: selectedProjectId,
        sessionId: workflow.sessionId,
        runId,
      });
      const preserved = restored?.workflow ?? null;
      if (preserved && countRunVideos(preserved) > currentRunVideoCount) {
        const preservedFlowProjectId = preserved.providerProjectIdentity?.providerProjectKey
          ?? flowProjectIdFromUrl(preserved.currentUrl);
        if (
          preserved.projectId !== selectedProjectId ||
          preserved.sessionId !== workflow.sessionId ||
          !preservedFlowProjectId ||
          preservedFlowProjectId.toLowerCase() !== expectedFlowProjectId.toLowerCase()
        ) {
          return fail("BLOCKED_RESUME_WORKFLOW_IDENTITY: output đã nhập thuộc workflow/project/session khác; không tiếp tục Generate.", "Giữ nguyên các output hiện có và xác minh lại identity của project Flow trước khi resume.");
        }
        latestWorkflow = preserved;
        store(
          preserved,
          `Khôi phục workflow ${preserved.workflowId} với ${countRunVideos(preserved)} video đã nhập cho run ${runId}; bỏ qua các shot đã có bằng chứng.`
        );
      }
    }
    const downloadAndImportOutput = async (
      shotId: string,
      revisionId: string,
      inputHash: string,
      index: number,
      beforeFiles: BrowserFlowDownloadEntry[],
      referenceEvidence: FlowRunReferenceEvidenceShot | null = null,
    ): Promise<string | null> => {
      const beforeMap = new Map(beforeFiles.map((file) => [file.relativePath, `${file.modifiedAt}:${file.sizeBytes}`]));
      const downloadAction = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
        projectId: selectedProjectId,
        request: { projectUrl: latestWorkflow.currentUrl, shotId, revisionId, runId, mode: "click_video_download" },
      });
      if (downloadAction.status !== "ready" || downloadAction.downloadClicked !== true) {
        return `${shotId}: không bấm được Download của output video đã khớp: ${downloadAction.message}`;
      }
      updateWorkspaceActivity(activityId, { state: "running", progress: (index + 0.9) / shotCount, message: `${shotId}: Download output video đã xác nhận; chờ file mp4.`, nextAction: "Kiểm tra file tải xuống." });
      let freshVideos: BrowserFlowDownloadEntry[] = [];
      for (let poll = 0; poll < 24; poll += 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 5_000));
        const report = await invoke<{ status: string; files: BrowserFlowDownloadEntry[]; message: string }>("list_browser_flow_downloads", { projectId: selectedProjectId });
        if (report.status !== "ready") return `${shotId}: không kiểm tra được Downloads sau khi bấm Download: ${report.message}`;
        freshVideos = report.files.filter((file) => file.mediaKind === "video" && (!beforeMap.has(file.relativePath) || beforeMap.get(file.relativePath) !== `${file.modifiedAt}:${file.sizeBytes}`));
        if (freshVideos.length > 0) break;
      }
      if (freshVideos.length !== 1) return `${shotId}: Flow download không tạo đúng một file video mới có thể xác minh; phát hiện ${freshVideos.length}.`;
      const exact = freshVideos[0];
      const imported = await invoke<{ workflow: BrowserFlowWorkflow; importedPath: string; message: string }>("import_browser_flow_download", {
        projectId: selectedProjectId,
        request: { projectId: selectedProjectId, workflowId: latestWorkflow.workflowId, relativePath: exact.relativePath, runId, shotId, revisionId, inputHash },
      });
      if (referenceEvidence) {
        const evidenceKey = flowRunReferenceEvidenceStorageKey(runCheckpointKey);
        const recorded = recordFlowRunReferenceEvidence(
          parseFlowRunReferenceEvidence(localStorage.getItem(evidenceKey)),
          { runId: runBaseId, projectId: selectedProjectId, sessionId: workflow.sessionId ?? null },
          referenceEvidence,
        );
        if (recorded) localStorage.setItem(evidenceKey, serializeFlowRunReferenceEvidence(recorded));
      }
      store(imported.workflow, `${shotId}: video đã import và gắn với hash prompt/run/shot/revision.`);
      updateWorkspaceActivity(activityId, { state: "running", progress: (index + 1) / shotCount, message: `${shotId}: video đã import; tiếp tục shot kế tiếp.`, nextAction: "Chờ kiểm tra ffprobe và ghép video sau batch." });
      return null;
    };
    try {
      for (let index = 0; index < flowSegments.length; index += 1) {
        const flowSegment = flowSegments[index];
        const segment = flowSegment.segment;
        const shotId = `SHOT-${String(index + 1).padStart(3, "0")}`;
        const revisionId = `${segment.revisionId || "rev-001"}${flowSegment.partCount > 1 ? `-part-${String(flowSegment.partIndex + 1).padStart(2, "0")}` : ""}`;
        const imageShotId = `SHOT-${String(flowSegment.sourceIndex + 1).padStart(3, "0")}`;
        const imageRevisionId = segment.revisionId || "rev-001";
        const binding = bindingBySourceSegment(flowSegment.sourceSegmentId);
        if (binding?.flowProjectId && binding.flowProjectId.toLowerCase() !== expectedFlowProjectId.toLowerCase()) {
          return fail(`${shotId}: reference đang gắn vào Flow project ${binding.flowProjectId}, còn run này đang gọi ${expectedFlowProjectId}.`, "Gỡ reference của project khác hoặc chọn đúng project Flow trước khi chạy.");
        }
        // A bound shot's hash covers the prompt *and* the exact reference that
        // produced it; a reference-free shot keeps the legacy prompt-only hash.
        const referenceFingerprint = binding
          ? await flowReferenceFingerprint({
            projectId: selectedProjectId,
            flowProjectId: binding.flowProjectId?.trim() || expectedFlowProjectId,
            sessionId: workflow.sessionId ?? null,
            segmentId: flowSegment.sourceSegmentId,
            assignmentId: binding.assignmentId,
            assetSha256: binding.assetSha256,
            flowMediaId: binding.flowMediaId ?? "",
            role: binding.role,
            confirmationKind: binding.confirmationKind ?? null,
          })
          : null;
        const shotPrompt = batchPrompts[index];
        const inputHash = await sha256Text(flowShotInputHashInput(stableBrowserFlowPrompt(shotPrompt), referenceFingerprint));
        let referenceAttachEvidence: { reportPath: string | null; sourceMediaId: string } | null = null;
        // 1. Reconcile exact imported output for this run/shot/revision/hash.
        const existing = (latestWorkflow.downloadedFiles ?? []).find((file) => file.runId === runId && file.shotId === shotId && file.revisionId === revisionId && file.inputHash === inputHash && file.mediaKind === "video");
        if (existing) {
          const message = `${shotId} đã có output/import cùng run, revision ${revisionId} và hash prompt ${inputHash.slice(0, 12)}…; resume không tạo trùng.`;
          updateWorkspaceActivity(activityId, { state: "running", progress: (index + 1) / shotCount, message, nextAction: "Bỏ qua shot đã có bằng chứng và chuyển shot tiếp theo." });
          continue;
        }
        // 2. Resolve checkpoint provenance and the attach route before the
        // composer is touched: a changed revision, hash or reference identity
        // after a paid click is a human decision, never a second Generate.
        const provenanceBlocker = flowRunCheckpointInputBlocker({
          submitted: flowRunCheckpointShot(runCheckpoint, shotId),
          revisionId,
          expected: { inputHash, referenceFingerprint },
        });
        if (provenanceBlocker) {
          return fail(`${shotId}: ${provenanceBlocker}; dừng trước khi mở composer, gắn ảnh hay bấm Generate.`, "Rà soát thủ công output đã có rồi chọn tiếp tục shot này, hoặc bắt đầu một run mới với reference đã xác nhận.");
        }
        const attachPlan = planFlowShotReferenceAttach({
          binding,
          // Per shot, not per run: this shot keeps its subject image even when a
          // sibling shot has none. The grid read is authoritative; the import
          // record only backs it up when the page could not be read. A shot in an
          // image-driven run that still has neither stops here rather than
          // paying for a video that does not match the storyboard.
          shotHasSubjectImage: gridShotIds.has(imageShotId) || importedShotIds.has(imageShotId),
          runIsImageDriven,
          legacyShotId: imageShotId,
          legacyRevisionId: imageRevisionId,
        });
        if (!attachPlan.ok) {
          return fail(`${shotId}: BLOCKED_${attachPlan.code}: ${attachPlan.message}`, "Chọn và xác nhận một card Flow cho reference này trước khi chạy; app không tự tìm ảnh theo nhãn shot/revision.");
        }
        // Say which image route this shot takes, including the silent
        // text-to-video fallback: without it a run that lost its subject
        // images looks the same as one that attached them.
        const attachRouteNote = describeFlowShotReferenceAttach(shotId, attachPlan);
        console.info(`[Auto3DVideo] ${attachRouteNote}`);
        updateWorkspaceActivity(activityId, {
          state: "running",
          progress: index / shotCount,
          message: attachRouteNote,
          nextAction: attachPlan.route === "text_to_video"
            ? "Bộ ảnh chủ thể chưa đủ cho mọi shot; shot này sẽ chạy không kèm ảnh. Tạo đủ ảnh rồi chạy lại nếu cần ảnh chủ thể."
            : "Tiếp tục: xác nhận ingredient rồi mới nhập prompt.",
        });
        // 3. Re-check SQLite-backed reference identity before acquiring or
        // navigating the live composer. Serialized bindings are snapshots,
        // not current facts; a file, hash, rights or assignment that drifted
        // must stop before any live-tab mutation.
        if (attachPlan.route === "explicit_media" && binding) {
          const preflight = await invoke<ShotReferenceFlowPreflight>("preflight_shot_reference_flow_binding", {
            projectId: selectedProjectId,
            request: {
              segmentId: flowSegment.sourceSegmentId,
              assetId: binding.assetId,
              referenceSetId: binding.referenceSetId,
              assignmentId: binding.assignmentId,
              assetSha256: binding.assetSha256,
              role: binding.role,
            },
          });
          if (
            preflight.ready !== true
            || preflight.segmentId !== flowSegment.sourceSegmentId
            || preflight.assignmentId !== binding.assignmentId
            || preflight.assetSha256 !== binding.assetSha256
          ) {
            return fail(`${shotId}: BLOCKED_REFERENCE_PREFLIGHT: ${preflight.message || "preflight chưa sẵn sàng"}`, "Sửa đúng lý do preflight báo (file, hash, rights, assignment, set) rồi chạy lại; không upload và không Generate.");
          }
        }
        const composer = await ensureFlowComposer(latestWorkflow, index === 0);
        if (composer.blocked) return fail(`${shotId}: ${composer.message}`, "Mở đúng project/composer Google Flow rồi chạy lại; không dùng ref lịch sử.");
        latestWorkflow = composer.workflow;
        let current: BrowserFlowWorkflowReport = { status: "ready", message: composer.message, workflow: composer.workflow };
        const priorOutput = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
          projectId: selectedProjectId,
          request: { projectUrl: latestWorkflow.currentUrl, shotId, revisionId, runId, mode: "inspect_output" },
        });
        if (priorOutput.status !== "ready") return fail(`${shotId}: không thể kiểm tra output trước resume: ${priorOutput.message}`, "Không bấm Generate; khôi phục Flow output inspector rồi kiểm tra lại.");
        const priorBatchCount = priorOutput.matchingBatchVideoMediaCount ?? 0;
        const priorPromptCount = priorOutput.matchingPromptVideoMediaCount ?? 0;
        if (priorBatchCount > 0 && priorPromptCount > 0 && priorBatchCount !== priorPromptCount) {
          return fail(`${shotId}: Flow inspector bất đồng về số video cũ khớp batch (${priorBatchCount} so với ${priorPromptCount}); không tải hay Generate.`, "Kiểm tra output card theo run/shot/revision.");
        }
        const priorVideoCount = priorBatchCount || priorPromptCount;
        const recoveryDecision = flowRunCheckpointRecoveryDecision(runCheckpoint, shotId, revisionId, priorVideoCount, { inputHash, referenceFingerprint });
        if (recoveryDecision === "blocked") {
          if (priorVideoCount > 1) return fail(`${shotId}: có nhiều output video cũ khớp identity; không thể resume an toàn.`, "Rà soát thủ công; không bấm Generate.");
          if (priorVideoCount === 1) return fail(`${shotId}: tìm thấy video khớp run/shot/revision nhưng thiếu checkpoint chứng minh click đã được app cho phép; không tự nhận hay Generate lại.`, "Xác minh output trong Flow trước khi tiếp tục.");
          return fail(`${shotId}: checkpoint xác nhận Generate đã được yêu cầu nhưng chưa thấy output khớp; không bấm Generate lần hai.`, "Chờ Flow hoàn tất hoặc kiểm tra thủ công output; chỉ resume khi đã xác minh trạng thái.");
        }
        if (recoveryDecision === "recover") {
          const beforeDownloads = await invoke<{ status: string; files: BrowserFlowDownloadEntry[]; message: string }>("list_browser_flow_downloads", { projectId: selectedProjectId });
          if (beforeDownloads.status !== "ready") return fail(`${shotId}: không thể lấy Downloads để khôi phục output đã tạo: ${beforeDownloads.message}`, "Không Generate; kiểm tra Downloads rồi chạy lại.");
          const importError = await downloadAndImportOutput(shotId, revisionId, inputHash, index, beforeDownloads.files, buildShotReferenceEvidence({ shotId, revisionId, sourceSegmentId: flowSegment.sourceSegmentId, promptHash: inputHash, binding, referenceFingerprint, attach: null }));
          if (importError) return fail(importError, "Giữ nguyên output Flow; sửa lỗi download/import rồi resume, không bấm Generate lại.");
          continue;
        }
        // 4. Attach the exact media. The binding was just re-checked against
        // SQLite, so this step only proves the human's confirmed card is really
        // the one Flow holds. An explicit binding never falls back to the
        // historical shot/revision label search.
        if (attachPlan.route === "explicit_media") {
          const projectUrl = latestWorkflow.currentUrl
            ?? latestWorkflow.providerProjectIdentity?.currentUrl
            ?? null;
          if (!projectUrl) {
            return fail(`${shotId}: thiếu URL project Flow hiện tại để gắn media ${attachPlan.mediaId}.`, "Giữ nguyên tab Flow đúng project rồi quét lại session.");
          }
          const animated = await invoke<GoogleFlowPlaywrightReport>("run_google_flow_playwright_action", {
            projectId: selectedProjectId,
            request: {
              projectUrl,
              mode: "animate_image",
              mediaId: attachPlan.mediaId,
              shotId,
              revisionId,
              runId,
            },
          });
          const attached = verifyFlowShotReferenceAttach(attachPlan.mediaId, animated);
          if (!attached.ok) {
            return fail(`${shotId}: BLOCKED_REFERENCE_ATTACH: ${attached.message}`, "Kiểm tra card Flow đã xác nhận rồi chạy lại; không nhập prompt khi ingredient chưa đúng.");
          }
          referenceAttachEvidence = { reportPath: animated.reportPath ?? null, sourceMediaId: attached.sourceMediaId };
          updateWorkspaceActivity(activityId, {
            state: "running",
            progress: index / shotCount,
            message: `${shotId}: đã gắn đúng media ${attached.sourceMediaId} đã xác nhận cho assignment ${binding?.assignmentId ?? "—"}.`,
            output: animated.reportPath,
            nextAction: "Nhập prompt chuyển động của shot này; chưa bấm Generate trước khi composer video được xác nhận.",
          });
          latestWorkflow = (await snapshot()).workflow;
        } else if (attachPlan.route === "legacy_label") {
          const projectUrl = latestWorkflow.currentUrl
            ?? latestWorkflow.providerProjectIdentity?.currentUrl
            ?? null;
          if (!projectUrl) {
            return fail(`${shotId}: thiếu URL project Flow hiện tại để mở Animate từ ${imageShotId}.`, "Giữ nguyên tab Flow đúng project rồi quét lại session.");
          }
          const animated = await invoke<GoogleFlowPlaywrightReport>("run_google_flow_playwright_action", {
            projectId: selectedProjectId,
            request: {
              projectUrl,
              mode: "animate_image",
              shotId: imageShotId,
              revisionId: imageRevisionId,
              // The current video action gets its own run ID. BrowserOS finds
              // the historical Flow card by SHOT/REVISION, so stale image
              // metadata must not be required here.
              runId,
            },
          });
          if (animated.status !== "ready" || !animated.referenceAttached) {
            return fail(`${shotId}: Flow chưa xác nhận Animate đúng ảnh ${imageShotId}: ${animated.message}`, "Không nhập prompt video khi ingredient chưa gắn đúng ảnh; kiểm tra card Flow rồi chạy lại.");
          }
          updateWorkspaceActivity(activityId, {
            state: "running",
            progress: index / shotCount,
            message: `${shotId}: đã mở Animate từ ${imageShotId} và xác nhận ingredient media ${animated.sourceMediaId ?? ""}.`,
            output: animated.reportPath,
            nextAction: "Nhập prompt chuyển động của shot này; chưa bấm Generate trước khi composer video được xác nhận.",
          });
          latestWorkflow = (await snapshot()).workflow;
        }
        current = await snapshot();
        const preflightComposerEvidence = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
          projectId: selectedProjectId,
          request: { projectUrl: current.workflow.currentUrl, mode: "inspect_composer" },
        });
        if (
          preflightComposerEvidence.status !== "ready" ||
          preflightComposerEvidence.projectKey.toLowerCase() !== expectedFlowProjectId.toLowerCase() ||
          preflightComposerEvidence.videoComposerReady !== true
        ) {
          return fail(`${shotId}: video composer/project chưa xác minh; prompt và Generate chưa gửi.`, "Mở đúng project/video composer rồi quét lại.");
        }
        const preflightComposerState = inspectBrowserFlowVideoComposer(current.workflow.uiRefs, preflightComposerEvidence);
        if (!preflightComposerState.verified) {
          return fail(`${shotId}: video composer chưa được xác minh; dừng trước khi nhập prompt để tránh ghi vào composer ảnh/chat.`, "Mở video composer trong đúng project Flow rồi quét lại snapshot.");
        }
        const modelLabel = preflightComposerEvidence.selectedModel;
        const selectedSettingsEvidence = preflightComposerEvidence.selectedSettingsEvidence;
        const settingsEvidence = [...new Set([modelLabel, ...selectedSettingsEvidence])].sort((a, b) => a.localeCompare(b)).join(" · ");
        const hasSelectedAspect = selectedSettingsEvidence.some((label) => /\b(?:16:9|9:16|1:1)\b/.test(label));
        const hasSelectedResolution = selectedSettingsEvidence.some((label) => /\b(?:360p|720p|1080p)\b/i.test(label));
        const hasSelectedDuration = selectedSettingsEvidence.some((label) => /\b(?:4|6|8|10)\s*(?:s|sec(?:onds?)?|giây)\b/i.test(label));
        if (!/\bomni\s+1\.1\s+flash\b/i.test(modelLabel) || !hasSelectedAspect || !hasSelectedResolution || !hasSelectedDuration) {
          return fail(`${shotId}: video route chỉ hỗ trợ Omni 1.1 Flash; chưa xác minh đủ model, tỷ lệ, độ phân giải và thời lượng. Prompt và Generate chưa gửi.`, "Chọn Omni 1.1 Flash cùng settings rõ ràng rồi quét lại.");
        }
        const preflightCreditCost = parseVisibleFlowCreditCost(preflightComposerEvidence.visibleCreditTexts);
        if (preflightCreditCost === null) {
          return fail(`${shotId}: Flow chưa hiện nhãn giá credit không mơ hồ; prompt và Generate chưa gửi.`, "Mở lại bảng giá/settings video Flow rồi quét lại.");
        }
        if (!approvedBatchBudget) {
          const batchBudget = createFlowBatchBudgetApproval(preflightCreditCost, shotCount, settingsEvidence);
          if (!batchBudget) return fail(`${shotId}: không thể lập trần credit an toàn từ giá/settings hiện tại.`, "Kiểm tra giá và settings Flow; chưa nhập prompt.");
          const targetProject = current.workflow.providerProjectIdentity?.providerProjectLabel || expectedFlowProjectId;
          const preflightApprovalMessage = [
            `Google Flow sẽ xử lý tối đa ${shotCount} shot trong project "${targetProject}" cho run ${runId}.`,
            `Model/settings: ${settingsEvidence}. Giá: ${preflightCreditCost} credit/shot. Trần cumulative của run này: ${preflightCreditCost} × ${shotCount} = ${batchBudget.totalCreditCap} credit; checkpoint ghi nhận ${generatedCreditsEstimate} credit. Không gồm usage ngoài checkpoint; khoản trừ thực tế chưa xác minh.`,
            `Shot plan (mỗi prompt rút gọn còn 180 ký tự):\n${batchShotSummary}`,
            "Chưa nhập prompt hay bấm Generate cho các shot còn lại. OK duyệt trần cumulative cho run này; Cancel dừng trước khi tiếp tục.",
          ].join("\n\n");
          updateWorkspaceActivity(activityId, { state: "waiting_user", progress: index / shotCount, message: `Chờ duyệt trần ${batchBudget.totalCreditCap} credit trước khi tiếp tục batch.`, nextAction: "Duyệt một lần hoặc hủy; app vẫn xác minh giá/settings từng shot." });
          const approved = await new Promise<boolean>((resolve) => {
            setFlowBatchApprovalRequest({ message: preflightApprovalMessage, totalCreditCap: batchBudget.totalCreditCap, resolve });
          });
          if (!approved) return fail("Người dùng hủy batch; chưa nhập prompt hoặc bấm Generate.", "Kiểm tra project/model/giá rồi chạy lại nếu muốn tiếp tục.");
          approvedBatchBudget = batchBudget;
        }
        if (!approvedBatchBudget) return fail(`${shotId}: chưa có trần ngân sách batch được duyệt.`, "Duyệt trần trước khi tiếp tục; prompt và Generate chưa gửi.");
        const initialBudgetCheck = checkFlowBatchBudget(approvedBatchBudget, preflightCreditCost, settingsEvidence, generatedCreditsEstimate);
        if (!initialBudgetCheck.ok) return fail(`${shotId}: ${initialBudgetCheck.reason} Prompt và Generate chưa gửi.`, "Kiểm tra giá/settings và duyệt batch mới.");
        // An explicitly bound shot re-checks its confirmed chip at the moment
        // of the paid prompt, not only at Animate time, so the reference is
        // named on the request and the worker refuses a drifted chip.
        const referenceMediaId = attachPlan.route === "explicit_media" ? attachPlan.mediaId : null;
        const promptAction = await invoke<GoogleFlowVideoActionExecution>("run_google_flow_video_action", {
          projectId: selectedProjectId,
          request: {
            projectUrl: current.workflow.currentUrl,
            mode: "type_prompt",
            prompt: shotPrompt,
            shotId,
            revisionId,
            runId,
            model: "Omni 1.1 Flash",
            expectedCreditCost: preflightCreditCost,
            approvedBatchCreditCap: approvedBatchBudget.totalCreditCap,
            shotCount,
            userApproved: true,
            referenceMediaId,
          },
        });
        if (promptAction.status !== "ready" || promptAction.promptAccepted !== true) {
          return fail(`${shotId}: BrowserOS chưa xác nhận đã nhập prompt video vào đúng composer: ${promptAction.message}`, "Giữ nguyên tab Flow và rà lại project/model trước khi thử lại.");
        }
        if (referenceMediaId && promptAction.referenceVerified !== true) {
          return fail(`${shotId}: chip reference ảnh không còn khớp media ${referenceMediaId} đã xác nhận ngay trước khi nhập prompt: ${promptAction.message}`, "Kiểm tra ingredient trong tab Flow; không gõ gì thêm và không Generate cho tới khi chip đúng trở lại.");
        }
        current = await snapshot();
        store(current.workflow, `${shotId}: BrowserOS xác nhận prompt đã nhập; chưa bấm Generate.`);
        const settings = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
          projectId: selectedProjectId,
          request: { projectUrl: current.workflow.currentUrl, mode: "inspect_video_settings" },
        });
        if (settings.status !== "ready" || settings.projectKey.toLowerCase() !== expectedFlowProjectId.toLowerCase()) {
          return fail(`${shotId}: Flow không xác minh lại được model/settings/giá sau khi nhập prompt.`, "Không bấm Generate; mở lại đúng composer Flow và xác minh cài đặt.");
        }
        current = await snapshot();
        if (current.status !== "ready" || !current.workflow.browserSessionAttached) {
          return fail(`${shotId}: Flow chưa trả snapshot mới sau khi xác minh lại giá/settings.`, "Không bấm Generate; đọc trạng thái Flow rồi tiếp tục.");
        }
        const composerState = inspectBrowserFlowVideoComposer(current.workflow.uiRefs, settings);
        if (!composerState.verified) {
          const reason = composerState.creditGate ? "BLOCKED_CREDIT_GATE" : composerState.chatOnly ? "BLOCKED_CHAT_ROUTE" : "BLOCKED_VIDEO_COMPOSER";
          return fail(`${shotId}: ${reason}; Flow chưa ở video composer, không click chat/assistant.`, "Mở Video/Text-to-video composer rồi chạy lại snapshot.");
        }
        const currentComposerEvidence = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
          projectId: selectedProjectId,
          request: {
            projectUrl: current.workflow.currentUrl,
            shotId,
            revisionId,
            runId,
            mode: "inspect_composer",
          },
        });
        if (
          currentComposerEvidence.status !== "ready"
          || currentComposerEvidence.projectKey.toLowerCase() !== expectedFlowProjectId.toLowerCase()
          || currentComposerEvidence.videoComposerReady !== true
          || currentComposerEvidence.selectedModel !== modelLabel
        ) {
          return fail(`${shotId}: video composer/project/model không còn đúng hoặc prompt vừa nhập bị mất; chưa bấm Generate.`, "Kiểm tra Flow và nhập lại prompt sau khi xác nhận đúng model.");
        }
        const currentSettingsEvidence = [
          ...new Set([currentComposerEvidence.selectedModel, ...currentComposerEvidence.selectedSettingsEvidence]),
        ].sort((a, b) => a.localeCompare(b)).join(" · ");
        if (currentSettingsEvidence !== settingsEvidence) {
          return fail(`${shotId}: model, độ phân giải hoặc thời lượng đã đổi trước Generate.`, "Xác minh lại settings và duyệt batch mới; shot chưa được gửi.");
        }
        const creditCost = parseVisibleFlowCreditCost([
          ...preflightComposerEvidence.visibleCreditTexts,
          ...currentComposerEvidence.visibleCreditTexts,
        ]);
        if (creditCost === null || creditCost !== preflightCreditCost) {
          return fail(`${shotId}: giá Flow hiện tại không khớp giá đã duyệt; prompt chưa Generate.`, "Mở lại bảng giá/settings Flow và duyệt batch mới.");
        }
        const budgetCheck = checkFlowBatchBudget(approvedBatchBudget, creditCost, settingsEvidence, generatedCreditsEstimate);
        if (!budgetCheck.ok) return fail(`${shotId}: ${budgetCheck.reason} Giá hiện tại ${creditCost} credit; không gửi shot này.`, "Xem các output đã hoàn tất; kiểm tra lại settings/giá và duyệt batch mới cho phần còn lại.");
        const beforeFiles = await invoke<{ status: string; files: BrowserFlowDownloadEntry[]; message: string }>("list_browser_flow_downloads", { projectId: selectedProjectId });
        if (beforeFiles.status !== "ready") return fail(`${shotId}: không lấy được danh sách Downloads trước khi Generate: ${beforeFiles.message}`, "Không Generate khi không thể phân biệt file mới với output cũ.");
        const nextCheckpoint = recordFlowRunCheckpointShot(runCheckpoint, shotId, revisionId, creditCost, { inputHash, referenceFingerprint });
        if (!nextCheckpoint) return fail(`${shotId}: không ghi được checkpoint trước Generate; không gửi request trả phí.`, "Khôi phục storage local trước khi tiếp tục.");
        runCheckpoint = nextCheckpoint;
        localStorage.setItem(runCheckpointKey, serializeFlowRunCheckpoint(runCheckpoint));
        const clicked = await invoke<GoogleFlowVideoActionExecution>("run_google_flow_video_action", {
          projectId: selectedProjectId,
          request: {
            projectUrl: current.workflow.currentUrl,
            mode: "click_generate",
            prompt: shotPrompt,
            shotId,
            revisionId,
            runId,
            model: "Omni 1.1 Flash",
            expectedCreditCost: creditCost,
            approvedBatchCreditCap: approvedBatchBudget.totalCreditCap,
            shotCount,
            userApproved: true,
            referenceMediaId,
          },
        });
        const clickSucceeded = clicked.status === "ready" && clicked.generateClicked === true;
        if (!clickSucceeded) return fail(`${shotId}: không xác nhận được click Generate của video composer: ${clicked.message}`, "Kiểm tra tab Flow và trạng thái tác vụ trước khi thử lại.");
        if (referenceMediaId && clicked.referenceVerified !== true) {
          return fail(`${shotId}: chip reference ảnh không còn khớp media ${referenceMediaId} đã xác nhận ngay trước Generate: ${clicked.message}`, "Giữ nguyên output Flow; kiểm tra ingredient rồi quyết định có Generate lại hay không, không Generate thủ công trước.");
        }
        generatedCreditsEstimate = flowRunCheckpointRecordedCredits(runCheckpoint);
        store(current.workflow, `${shotId}: Generate video đã được bấm sau khi duyệt trần ${approvedBatchBudget.totalCreditCap} credit.`);
        updateWorkspaceActivity(activityId, {
          state: "running",
          progress: (index + 0.25) / shotCount,
          message: `${shotId}: Generate đã được bấm; chờ output khớp run/shot/revision.`,
          nextAction: "Chờ Flow hoàn tất video.",
        });
        const maxWaitSeconds = Math.min(900, Math.max(120, Math.ceil(segment.durationSeconds * 30 + 90)));
        let matchedOutput: GoogleFlowDomOutputReport | null = null;
        for (let waited = 0; waited < maxWaitSeconds; waited += 5) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 5_000));
          const output = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
            projectId: selectedProjectId,
            request: { projectUrl: current.workflow.currentUrl, shotId, revisionId, runId, mode: "inspect_output" },
          });
          if (output.status !== "ready") return fail(`${shotId}: Flow output inspection bị chặn: ${output.message}`, "Giữ nguyên tab Flow và kiểm tra tiến trình.");
          const batchVideoCount = output.matchingBatchVideoMediaCount ?? 0;
          const promptVideoCount = output.matchingPromptVideoMediaCount ?? 0;
          if (batchVideoCount > 0 && promptVideoCount > 0 && batchVideoCount !== promptVideoCount) {
            return fail(`${shotId}: Flow inspector bất đồng về số video khớp batch (${batchVideoCount} so với ${promptVideoCount}); không tải hay retry.`, "Kiểm tra output card theo run/shot/revision.");
          }
          const exactVideoCount = batchVideoCount || promptVideoCount;
          if (exactVideoCount > 1) return fail(`${shotId}: Flow tạo nhiều video khớp cùng identity; không thể gán chính xác.`, "Giữ nguyên Flow output và rà soát thủ công; không bấm Generate lại.");
          if (exactVideoCount === 1) {
            matchedOutput = output;
            break;
          }
          updateWorkspaceActivity(activityId, {
            state: "running",
            progress: Math.min(0.88, (index + 0.25 + (waited / maxWaitSeconds) * 0.6) / shotCount),
            message: output.generationActive ? `${shotId}: Flow đang tạo video.` : `${shotId}: đợi output video khớp ID batch.`,
            nextAction: "Không bấm Generate lần nữa; tiếp tục chờ output.",
          });
        }
        if (!matchedOutput) return fail(`${shotId}: Flow không tạo output khớp run/shot/revision trong ${maxWaitSeconds} giây.`, "Không retry tự động; kiểm tra Flow để tránh tạo thêm video tính phí.");
        const downloadError = await downloadAndImportOutput(shotId, revisionId, inputHash, index, beforeFiles.files, buildShotReferenceEvidence({ shotId, revisionId, sourceSegmentId: flowSegment.sourceSegmentId, promptHash: inputHash, binding, referenceFingerprint, attach: referenceAttachEvidence }));
        if (downloadError) return fail(downloadError, "Giữ nguyên output Flow; sửa lỗi download/import rồi resume, không bấm Generate lại.");
      }
      updateWorkspaceActivity(activityId, { state: "running", progress: 0.99, message: `Đã import đủ ${shotCount} shot; đang compose theo thứ tự và kiểm tra output cuối.`, nextAction: "FFmpeg/FFprobe compose không được ghi đè output cũ." });
      const composed = await invoke<{ workflow: BrowserFlowWorkflow; outputPath: string; durationSeconds: number | null; message: string }>("compose_browser_flow_outputs", { request: { projectId: selectedProjectId, workflowId: latestWorkflow.workflowId, runId, shots: flowSegments.map((flowSegment, index) => ({ shotId: `SHOT-${String(index + 1).padStart(3, "0")}`, durationSeconds: flowSegment.segment.durationSeconds })) } });
      const expectedDurationSeconds = flowSegments.reduce((total, flowSegment) => total + flowSegment.segment.durationSeconds, 0);
      if (composed.durationSeconds === null || Math.abs(composed.durationSeconds - expectedDurationSeconds) > 0.25) {
        throw new Error("FFprobe không xác nhận đúng tổng thời lượng shot; không báo hoàn tất video.");
      }
      store(composed.workflow, `${composed.message} Output: ${composed.outputPath} (${composed.durationSeconds.toFixed(2)}s)`);
      localStorage.removeItem(runCheckpointKey);
      const message = `Đã xử lý tuần tự ${shotCount} shot, import từng output và compose thành ${composed.outputPath} dài ${composed.durationSeconds.toFixed(2)}s; batch được duyệt tối đa ${approvedBatchBudget?.totalCreditCap ?? 0} credit, ước tính theo giá hiển thị ${generatedCreditsEstimate} credit (khoản trừ thực tế chưa được xác minh). Các output có hash prompt/run/shot/revision; chưa tự publish.`;
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Review từng output; compose chỉ được báo ready khi có bằng chứng timeline/FFmpeg hợp lệ." });
      return { workflow: latestWorkflow, success: true, message };
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi runner shot không xác định";
      return fail(`Auto Flow bị dừng: ${detail.slice(0, 360)}`, "Xem terminal theo shot; chạy lại sẽ reconcile file đã import theo run/shot/revision/input hash.");
    } finally {
      setBrowserHandoffBusy(false);
    }
  }

  async function autoGenerateBrowserFlow(workflow: BrowserFlowWorkflow, script: LocalScriptDocument): Promise<{ workflow: BrowserFlowWorkflow; success: boolean; message: string }> {
    if (!selectedProjectId) {
      return { workflow, success: false, message: "Chưa có project để chạy Generate Google Flow." };
    }
    const startedAt = performance.now();
    const shotCount = Math.max(1, script.segments.length);
    const durationSeconds = Math.max(1, script.totalDurationSeconds);
    const maxWaitSeconds = Math.min(900, Math.max(120, Math.ceil(durationSeconds * 3 + shotCount * 20)));
    const activityId = recordWorkspaceActivity({ stage: "studio_flow.generate", tool: "BrowserMCP / Google Flow", state: "running", progress: 0, message: `Auto mode: đang đọc UI ref thật trước khi bấm Generate cho ${shotCount} shot.`, nextAction: "Không dùng tọa độ; chỉ click ref do BrowserMCP vừa trả về." });
    setBrowserHandoffBusy(true);
    let latestWorkflow = workflow;
    let downloadClicked = latestWorkflow.processes.some((process) => process.operation === "click" && /download|tải|export|xuất/i.test(process.message));
    const runStep = (operation: string, element: string | null = null, elementRef: string | null = null, time: number | null = null) => invoke<BrowserFlowWorkflowReport>("run_browser_flow_step", { request: { projectId: selectedProjectId, workflowId: latestWorkflow.workflowId, operation, approved: true, url: null, element, elementRef, text: null, submit: false, key: null, time } });
    const store = (next: BrowserFlowWorkflow, message: string) => {
      latestWorkflow = next;
      setBrowserFlowWorkflow(next);
      setNotice(message);
    };
    try {
      let snapshot = await runStep("snapshot");
      if (snapshot.status !== "ready" || !snapshot.workflow.browserSessionAttached) {
        const message = `BrowserMCP chưa trả UI ref hợp lệ để chạy Generate: ${snapshot.message}`;
        store(snapshot.workflow, message);
        updateWorkspaceActivity(activityId, { state: "blocked", durationMs: Math.round(performance.now() - startedAt), message, output: snapshot.workflow.discoveryPath ?? undefined, nextAction: "Giữ đúng tab Google Flow, Connect BrowserMCP rồi chạy lại; app không đoán tọa độ." });
        return { workflow: snapshot.workflow, success: false, message };
      }
      store(snapshot.workflow, "Đã đọc UI Flow mới nhất; đang tìm nút Generate bằng ref thật…");

      let storyboardRef = findBrowserFlowStoryboardChoiceRef(latestWorkflow.uiRefs);
      const storyboardAlreadyChosen = latestWorkflow.processes.some((process) => process.operation === "click_storyboard" && process.state === "succeeded");
      if (storyboardRef && !storyboardAlreadyChosen) {
        const chosen = await runStep("click_storyboard", storyboardRef.label, storyboardRef.reference);
        if (chosen.status !== "ready") {
          const message = `Flow chưa nhận lựa chọn storyboard “${storyboardRef.label}”: ${chosen.message}`;
          store(chosen.workflow, message);
          updateWorkspaceActivity(activityId, { state: "blocked", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra tab Flow; không bấm lặp nếu BrowserMCP chưa trả success." });
          return { workflow: chosen.workflow, success: false, message };
        }
        store(chosen.workflow, `Đã tự chọn “${storyboardRef.label}”; chờ Flow dựng storyboard rồi đọc nút Generate.`);
        await runStep("wait", null, null, 3);
        snapshot = await runStep("snapshot");
        store(snapshot.workflow, "Đã đọc lại Flow sau storyboard; tiếp tục tìm nút Generate.");
        storyboardRef = findBrowserFlowStoryboardChoiceRef(latestWorkflow.uiRefs);
      }

      let approvalRef = findBrowserFlowApprovalRef(latestWorkflow.uiRefs);
      const generateAlreadyClicked = latestWorkflow.processes.some((process) => process.operation === "click" && process.state === "succeeded" && !/download|tải|export|xuất/i.test(process.message));
      if (!generateAlreadyClicked) {
        if (!approvalRef) {
          const message = "Flow chưa trả ref nút Generate/Approve sau khi prompt đã nạp; app không tự bấm nhầm nút khác.";
          store(latestWorkflow, message);
          updateWorkspaceActivity(activityId, { state: "blocked", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Mở tab Flow để kiểm tra UI thật, rồi bấm Đọc trạng thái Flow; không cần nhập lại prompt." });
          return { workflow: latestWorkflow, success: false, message };
        }
        const clicked = await runStep("click", approvalRef.label, approvalRef.reference);
        const clickSucceeded = clicked.status === "ready" && clicked.workflow.processes.some((process) => process.operation === "click" && process.state === "succeeded");
        if (!clickSucceeded) {
          const message = `Flow chưa xác nhận click “${approvalRef.label}”: ${clicked.message}`;
          store(clicked.workflow, message);
          updateWorkspaceActivity(activityId, { state: "blocked", durationMs: Math.round(performance.now() - startedAt), message, output: clicked.workflow.discoveryPath ?? undefined, nextAction: "Không bấm lặp; kiểm tra Connect và UI ref trong terminal." });
          return { workflow: clicked.workflow, success: false, message };
        }
        store(clicked.workflow, `Đã bấm “${approvalRef.label}” bằng UI ref thật. Flow đang tạo ${shotCount} shot; app sẽ chờ output, không báo thành công sớm.`);
        updateWorkspaceActivity(activityId, { state: "running", progress: 0.35, message: `Đã click Generate thật: ${approvalRef.label}. Đang chờ Flow tạo video.`, nextAction: `Chờ output tối đa ${maxWaitSeconds} giây; không gửi lại prompt.` });
      } else {
        updateWorkspaceActivity(activityId, { state: "running", progress: 0.35, message: "Session đã có evidence click Generate trước đó; không click lại, tiếp tục chờ output.", nextAction: `Chờ Flow trả output tối đa ${maxWaitSeconds} giây.` });
      }

      let waitedSeconds = 0;
      while (waitedSeconds < maxWaitSeconds) {
        const flowState = inspectBrowserFlowGeneration(latestWorkflow.uiRefs);
        if (flowState.readyForOutput) {
          const downloadRef = findBrowserFlowDownloadRef(latestWorkflow.uiRefs);
          if (downloadRef && !downloadClicked) {
            const downloaded = await runStep("click", downloadRef.label, downloadRef.reference);
            const downloadSucceeded = downloaded.status === "ready" && downloaded.workflow.processes.some((process) => process.operation === "click" && process.state === "succeeded");
            if (!downloadSucceeded) {
              const message = `Flow đã có output nhưng chưa click được “${downloadRef.label}”: ${downloaded.message}`;
              store(downloaded.workflow, message);
              updateWorkspaceActivity(activityId, { state: "blocked", progress: 0.95, durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Mở Flow và kiểm tra nút Download; không giả đã lưu video." });
              return { workflow: downloaded.workflow, success: false, message };
            }
            latestWorkflow = downloaded.workflow;
            downloadClicked = true;
            store(latestWorkflow, `Flow đã trả output và app đã bấm “${downloadRef.label}”; đang chờ file xuất hiện trong Downloads.`);
          }
          const message = downloadClicked ? "Đã Generate và yêu cầu Download output từ Google Flow; đang chuyển sang quét file local." : "Đã Generate và Flow đã trả output; không thấy nút Download nên giữ output để review trong tab.";
          updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, output: latestWorkflow.discoveryPath ?? undefined, nextAction: downloadClicked ? "Quét Downloads và nhập video vào workflow." : "Review output trong Flow; app không tự publish." });
          return { workflow: latestWorkflow, success: true, message };
        }
        const waitFor = Math.min(5, maxWaitSeconds - waitedSeconds);
        const settled = await runStep("wait", null, null, waitFor);
        waitedSeconds += waitFor;
        if (settled.status !== "ready") {
          const message = `Flow bị chặn trong lúc chờ output: ${settled.message}`;
          store(settled.workflow, message);
          updateWorkspaceActivity(activityId, { state: "blocked", progress: Math.min(0.95, 0.35 + waitedSeconds / maxWaitSeconds * 0.6), durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra tab Flow và BrowserMCP; chạy lại sẽ không gõ lại prompt." });
          return { workflow: settled.workflow, success: false, message };
        }
        const refreshed = await runStep("snapshot");
        store(refreshed.workflow, refreshed.message);
        const refreshedState = inspectBrowserFlowGeneration(refreshed.workflow.uiRefs);
        const progress = Math.min(0.94, 0.35 + waitedSeconds / maxWaitSeconds * 0.6);
        const stateText = refreshedState.isWorking ? "đang render/tạo" : refreshedState.readyForOutput ? "đã có output" : "đang chờ Flow trả UI";
        const waitMessage = `Google Flow ${stateText}: ${shotCount} shot · ${waitedSeconds}/${maxWaitSeconds}s · không nhập lại prompt.`;
        updateWorkspaceActivity(activityId, { state: "running", progress, message: waitMessage, nextAction: "Tiếp tục chờ trạng thái UI thật; không bấm lặp Generate." });
        setNotice(waitMessage);
      }
      const message = `Đã click Generate nhưng Flow chưa trả output sau ${maxWaitSeconds} giây; không coi là video hoàn tất.`;
      updateWorkspaceActivity(activityId, { state: "blocked", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Mở tab Flow kiểm tra job; chạy lại sẽ tiếp tục từ session hiện tại." });
      return { workflow: latestWorkflow, success: false, message };
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi auto Generate không xác định";
      const message = `Auto Generate bị dừng: ${detail.slice(0, 360)}`;
      setBrowserFlowWorkflow(latestWorkflow);
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Xem process log; không gửi lại prompt nếu Flow đã nhận session." });
      return { workflow: latestWorkflow, success: false, message };
    } finally {
      setBrowserHandoffBusy(false);
    }
  }

  void autoGenerateBrowserFlow;

  async function startBrowserFlowDiscovery(script: LocalScriptDocument | null, report: BlenderShotPreviewReport | null, sessionId?: string | null, autoGenerate = false, autoRunId?: string | null): Promise<boolean> {
    if (!selectedProjectId) {
      const message = "Hãy tạo hoặc chọn project trước khi quét route Google Flow.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "browser_flow.discovery.validate", tool: "BrowserMCP", state: "blocked", message, nextAction: "Tạo hoặc chọn project local." });
      return false;
    }
    if (autoGenerate && !snapshot.paidGenerationEnabled) {
      const message = "Cloud generation đang tắt. Bật ở Providers trước khi gửi video Google Flow; chưa có yêu cầu nào được gửi.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "browser_flow.preflight", tool: "Provider policy", state: "blocked", message, nextAction: "Bật Cloud/API trong Providers rồi chạy lại." });
      return false;
    }
    const selectedFlowProjectId = script?.flowProjectId?.trim() ?? "";
    if (autoGenerate && !/^[A-Za-z0-9][A-Za-z0-9_-]{7,159}$/.test(selectedFlowProjectId)) {
      const message = "Chưa có Google Flow Project ID hợp lệ được lưu/chọn cho project local; chưa mở Flow và chưa tạo video.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "browser_flow.preflight", tool: "Flow project selector", state: "blocked", message, nextAction: "Lưu ID từ URL của một project Flow có sẵn rồi chọn project đó." });
      return false;
    }
    try {
      const runtime = await invoke<BrowserMcpRuntimeReport>("check_browsermcp_session", { projectId: selectedProjectId });
      applyFreshBrowserMcpReport(runtime);
      const connected = runtime.browserSessionAttached && runtime.status !== "blocked" && !runtime.operationResult?.isError;
      if (!connected) {
        const message = `Chưa kết nối Google Flow thật: ${runtime.message}. Không nạp prompt, không gọi Generate và không báo thành công.`;
        setNotice(message);
        setBrowserMcpFreshState({ status: "not-connected", uiRefCount: 0, checkedAt: Date.now() });
        setBrowserFlowWorkflow((current) => {
          if (!current) return current;
          const next = { ...current, browserSessionAttached: false, uiRefs: [], uiRefCount: 0, providerProjectIdentity: null, visualStatePath: null, discoveryStatus: "blocked", phase: "waiting_user", lastMessage: message };
          return next;
        });
        recordWorkspaceActivity({ stage: "browser_flow.preflight", tool: "BrowserMCP", state: "blocked", progress: 0, message, output: runtime.reportPath, nextAction: "Mở đúng tab Google Flow, bấm Connect trên BrowserMCP extension rồi chạy lại." });
        return false;
      }
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "không rõ lỗi";
      const message = `Không kiểm tra được kết nối Google Flow: ${detail.slice(0, 300)}. Chưa chạy provider.`;
      setNotice(message);
      clearFreshBrowserMcpState();
      setBrowserFlowWorkflow((current) => current ? { ...current, browserSessionAttached: false, uiRefs: [], uiRefCount: 0, providerProjectIdentity: null, visualStatePath: null, discoveryStatus: "blocked", phase: "waiting_user", lastMessage: message } : current);
      recordWorkspaceActivity({ stage: "browser_flow.preflight", tool: "BrowserMCP", state: "blocked", progress: 0, message, nextAction: "Mở tab Flow và Connect BrowserMCP trước khi bấm Tự làm toàn bộ." });
      return false;
    }
    const staleWorkflow = browserFlowWorkflow?.phase === "failed" || browserFlowWorkflow?.phase === "cancelled";
    // Do not short-circuit on a historical `type` process. A process record is
    // not proof that the current Flow tab still has the same composer: the tab
    // may have navigated back to the landing page or returned new UI refs. The
    // normal discovery path below creates a bounded workflow record and then
    // calls ensureFlowComposer(), which reacquires a fresh composer before any
    // type/click operation. This also makes resume and first-run obey the same
    // safety rule instead of claiming success from stale history.
    const storyboardPaths = report ? (report.shotPreviewPaths?.length ? report.shotPreviewPaths : [report.previewPath].filter(Boolean) as string[]) : [];
    // A Flow reference is bound one-to-one to a shot. The old generic eight-file
    // cap silently dropped references for shot 9 onward before the provider run.
    const referencePaths = [...(script?.referenceAssetPaths ?? []), ...(script?.comfyuiAssetPaths ?? []), ...(script?.geminiAssetPaths ?? []), ...storyboardPaths].filter(Boolean).slice(0, 32);
    const assets = referencePaths.map((relativePath, index) => ({
      assetId: `asset-${relativePath.includes("comfyui") ? "comfyui" : relativePath.includes("gemini") ? "gemini" : relativePath.includes("shot") ? "shot" : "reference"}-${String(index + 1).padStart(2, "0")}`,
      name: relativePath.split(/[\\/]/).pop() ?? `asset-${index + 1}`,
      relativePath,
      mediaKind: "image",
      role: relativePath.includes("comfyui") ? "comfyui_reference" : relativePath.includes("gemini") ? "gemini_sketch" : relativePath.includes("shot") ? "semantic_shot" : "user_reference",
    }));
    const fileCandidates = report ? [
      { fileId: "file-blender-scene", name: "Blender scene", relativePath: report.scenePath, kind: "blender_scene" },
      { fileId: "file-storyboard-manifest", name: "Storyboard manifest", relativePath: report.manifestPath, kind: "storyboard_manifest" },
      { fileId: "file-storyboard-preview", name: "Storyboard preview", relativePath: report.previewPath, kind: "storyboard_preview" },
      ...(report.editPlanPath ? [{ fileId: "file-edit-plan", name: "Edit plan", relativePath: report.editPlanPath, kind: "edit_plan" }] : []),
      ...(report.videoPath ? [{ fileId: "file-blender-video", name: "Blender video preview", relativePath: report.videoPath, kind: "blender_video" }] : []),
    ] : [];
    // The session's own saved bindings drive the paid run. They are read from
    // the project's loaded sessions rather than from a UI draft, so a stale
    // on-screen state can never bind a reference the session never saved.
    const sessionShotReferenceBindings = (sessionId
      ? videoWorkflowSessions.find((item) => item.sessionId === sessionId && item.projectId === selectedProjectId)?.shotReferenceBindings
      : null) ?? [];
     const startedAt = performance.now();
     const referenceDrivenAutoRun = Boolean(autoGenerate && autoRunId && script && hasCompleteFlowReferenceSet(script));
     const activityId = recordWorkspaceActivity({ stage: referenceDrivenAutoRun ? "browser_flow.video_resume" : "browser_flow.discovery", tool: "BrowserMCP", state: "running", message: referenceDrivenAutoRun ? "Đang giữ workflow Flow chứa ảnh đã duyệt; chưa tạo workflow/session mới." : "Đang tạo workflow ID và quét route Google Flow lần đầu; chưa upload, chưa Generate.", progress: 0 });
     setBrowserHandoffBusy(true);
     setNotice(referenceDrivenAutoRun ? "Đang giữ workflow Flow chứa ảnh đã duyệt để chuyển sang Animate…" : staleWorkflow ? "Workflow cũ đã lỗi; đang tạo lượt mới cùng session và quét lại tab Google Flow…" : "Đang giữ tab Google Flow đã Connect, chờ ổn định, đọc snapshot và lưu roadmap…");
     try {
       if (referenceDrivenAutoRun) {
         // Image generation and image-to-video are a single stateful Flow
         // session. Starting discovery again here would create a fresh
         // workflow with downloadedFiles=[], which previously erased the
         // approved image evidence and caused a false 0/12 blocker.
         const restored = await invoke<BrowserFlowWorkflowReport | null>("get_latest_browser_flow_workflow", { projectId: selectedProjectId, sessionId: sessionId ?? null });
         const preserved = restored?.workflow ?? null;
         if (!preserved) {
           const message = "Không tìm thấy workflow Flow chứa các ảnh reference vừa duyệt; không tạo workflow mới để tránh mất binding shot.";
           setNotice(message);
           updateWorkspaceActivity(activityId, { state: "blocked", progress: 0.86, durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Giữ nguyên project Flow và chạy lại từ bước ảnh reference; không tạo session mới." });
           setBrowserHandoffBusy(false);
           return false;
         }
         const imageCount = (preserved.downloadedFiles ?? []).filter((file) => file.mediaKind === "image").length;
         setBrowserFlowWorkflow(preserved);
         applyFreshBrowserFlowWorkflow(preserved);
         const resumeMessage = `Giữ workflow ${preserved.workflowId} của cùng session; bảo toàn ${imageCount} ảnh reference đã duyệt trước khi Animate.`;
         recordWorkspaceActivity({ stage: "browser_flow.video_resume", tool: "BrowserMCP / Google Flow", state: "running", progress: 0.86, message: resumeMessage, nextAction: "Không tạo workflow mới; mở Animate từ đúng ảnh của từng shot rồi mới tạo video." });
        const generated = await autoGenerateBrowserFlowSequential(preserved, script!, autoRunId!, sessionShotReferenceBindings);
         setBrowserFlowWorkflow(generated.workflow);
         setNotice(generated.message);
         updateWorkspaceActivity(activityId, { state: generated.success ? "success" : "blocked", progress: generated.success ? 1 : 0.99, durationMs: Math.round(performance.now() - startedAt), message: generated.message, nextAction: generated.success ? "Review từng video shot và compose cuối." : "Giữ nguyên workflow hiện tại, sửa đúng shot bị chặn rồi resume." });
         setBrowserHandoffBusy(false);
         return generated.success;
       }
      const targetUrl = selectedFlowProjectId
        ? `https://flow.google.com/project/${encodeURIComponent(selectedFlowProjectId)}`
        : "https://labs.google/fx/tools/flow";
      const result = await invoke<BrowserFlowWorkflowReport>("start_browser_flow_discovery", { request: { projectId: selectedProjectId, name: `${script?.title || topic.trim() || "Video"} · Google Flow workflow`, targetUrl, handoffId: null, sessionId: sessionId ?? null, assets, files: fileCandidates } });
      let latestWorkflow = result.workflow;
      applyFreshBrowserFlowWorkflow(latestWorkflow);
      const liveFlowProjectId = latestWorkflow.providerProjectIdentity?.providerProjectKey
        ?? flowProjectIdFromUrl(latestWorkflow.currentUrl);
      if (selectedFlowProjectId && liveFlowProjectId?.toLowerCase() !== selectedFlowProjectId.toLowerCase()) {
        const mismatchMessage = `BLOCKED_WRONG_FLOW_PROJECT: đích đã chọn ${selectedFlowProjectId}, tab Flow trả ${liveFlowProjectId ?? "không có project ID"}. Không nhập prompt/Generate.`;
        setBrowserFlowWorkflow(latestWorkflow);
        setNotice(mismatchMessage);
        updateWorkspaceActivity(activityId, { state: "blocked", durationMs: Math.round(performance.now() - startedAt), message: mismatchMessage, nextAction: "Kiểm tra URL project Flow đã lưu và kết nối BrowserMCP đúng tài khoản." });
        return false;
      }
      let message = result.message;
      recordWorkspaceActivity({ stage: "browser_flow.visual_fallback", tool: "BrowserMCP screenshot", state: latestWorkflow.visualStatePath ? "success" : "waiting_user", progress: latestWorkflow.visualStatePath ? 1 : 0, message: latestWorkflow.visualStatePath ? "Đã chụp màn hình Flow để làm visual state fallback; không tự bấm theo tọa độ." : "BrowserMCP chưa trả ảnh màn hình; workflow vẫn giữ UI ref/snapshot, chưa dùng tọa độ đoán.", output: latestWorkflow.visualStatePath ?? undefined, nextAction: latestWorkflow.visualStatePath ? "Review ảnh Flow và tiếp tục bằng UI ref thật khi extension trả ref." : "Kiểm tra quyền screenshot của BrowserMCP rồi quét lại." });
      let autoTypeState: WorkspaceActivityState | null = null;
      let autoTypeFailed = false;
      let autoGenerationPassed = false;
      if (script) {
        const referenceDrivenAutoRun = Boolean(autoGenerate && autoRunId && hasCompleteFlowReferenceSet(script));
        if (referenceDrivenAutoRun) {
          // The image stage already created and manually approved one Flow
          // reference per shot. Do not type a text-only video prompt first:
          // the next stage must open Animate from that exact image card.
          const generated = await autoGenerateBrowserFlowSequential(latestWorkflow, script, autoRunId!, sessionShotReferenceBindings);
          latestWorkflow = generated.workflow;
          message = generated.message;
          autoGenerationPassed = generated.success;
          autoTypeFailed = !generated.success;
          autoTypeState = generated.success ? "success" : "blocked";
        } else if (autoGenerate && autoRunId) {
          const generated = await autoGenerateBrowserFlowSequential(latestWorkflow, script, autoRunId, sessionShotReferenceBindings);
          latestWorkflow = generated.workflow;
          message = generated.message;
          autoGenerationPassed = generated.success;
          autoTypeFailed = !generated.success;
          autoTypeState = generated.success ? "success" : "blocked";
        } else {
          const composer = await ensureFlowComposer(latestWorkflow, true);
          latestWorkflow = composer.workflow;
          message = composer.message;
          let promptRef = composer.promptRef;
          if (composer.blocked) {
            autoTypeFailed = true;
            autoTypeState = "blocked";
          }
          if (promptRef) {
          const typeStartedAt = performance.now();
          const typeActivityId = recordWorkspaceActivity({ stage: "browser_flow.type_prompt", tool: "BrowserMCP", state: "running", message: `Discovery xong; tìm thấy ô prompt “${promptRef.label}”, đang nạp prompt của session.`, progress: 0 });
          autoTypeState = "success";
          setNotice(`Đã quét xong; đang nạp prompt vào Google Flow qua ${promptRef.label}…`);
          try {
            const initialFlowPart = flowSegmentsForGeneration(script)[0];
            const initialFlowSegment = initialFlowPart?.segment ?? script.segments[0];
            const initialFlowRevision = `${initialFlowSegment.revisionId || "rev-001"}${initialFlowPart && initialFlowPart.partCount > 1 ? `-part-${String(initialFlowPart.partIndex + 1).padStart(2, "0")}` : ""}`;
            const typed = await invoke<BrowserFlowWorkflowReport>("run_browser_flow_step", { request: {
              projectId: selectedProjectId,
              workflowId: latestWorkflow.workflowId,
              operation: "type",
              approved: true,
              url: null,
              element: promptRef.label,
              elementRef: promptRef.reference,
              text: autoGenerate && autoRunId && script.segments[0]
                ? buildBrowserFlowShotPrompt(script, initialFlowSegment, 0, autoRunId, initialFlowRevision, latestWorkflow.providerProjectIdentity, latestWorkflow.sessionId, topic.trim())
                : buildBrowserFlowPrompt(script, topic.trim()),
              submit: false,
              key: null,
              time: null,
            } });
            latestWorkflow = typed.workflow;
            message = typed.message;
            autoTypeFailed = typed.status === "failed";
            autoTypeState = autoTypeFailed ? "error" : typed.status === "waiting_user" ? "info" : "success";
            const promptWasAcceptedButStillLoading = !autoTypeFailed && (typed.status === "ready" || /timeout|đang xử lý/i.test(typed.message));
            if (promptWasAcceptedButStillLoading) {
              const shotCount = Math.max(1, script.segments.length);
              const durationSeconds = Math.max(1, script.totalDurationSeconds);
              // Flow builds a response for the whole prompt. Six seconds is not a
              // meaningful timeout for a multi-shot request and caused the UI to
              // report success while Flow was still thinking. Keep one session,
              // poll its state, and stop only when the response/approval UI exists.
              const maxWaitSeconds = Math.min(900, Math.max(120, Math.ceil(durationSeconds * 3 + shotCount * 20)));
              const pollSeconds = 5;
              let waitedSeconds = 0;
              let flowReadyForApproval = false;
              setNotice(`Prompt tổng đã được nạp đúng một lần; đây là ${shotCount} shot với tổng ~${durationSeconds.toFixed(1)} giây. Chế độ này chỉ chờ kế hoạch/review; tạo video thật phải gửi từng shot <=${MAX_FLOW_VIDEO_GENERATION_SECONDS}s.`);
              try {
                while (waitedSeconds < maxWaitSeconds) {
                  const waitFor = Math.min(pollSeconds, maxWaitSeconds - waitedSeconds);
                  const settled = await invoke<BrowserFlowWorkflowReport>("run_browser_flow_step", { request: {
                    projectId: selectedProjectId,
                    workflowId: latestWorkflow.workflowId,
                    operation: "wait",
                    approved: true,
                    url: null,
                    element: null,
                    elementRef: null,
                    text: null,
                    submit: false,
                    key: null,
                    time: waitFor,
                  } });
                  waitedSeconds += waitFor;
                  latestWorkflow = settled.workflow;
                  const refreshed = await invoke<BrowserFlowWorkflowReport>("run_browser_flow_step", { request: {
                    projectId: selectedProjectId,
                    workflowId: latestWorkflow.workflowId,
                    operation: "snapshot",
                    approved: true,
                    url: null,
                    element: null,
                    elementRef: null,
                    text: null,
                    submit: false,
                    key: null,
                    time: null,
                  } });
                  latestWorkflow = refreshed.workflow;
                  message = refreshed.message;
                  const flowState = inspectBrowserFlowGeneration(latestWorkflow.uiRefs);
                  const progress = Math.min(0.95, waitedSeconds / maxWaitSeconds);
                  const stateText = flowState.isWorking ? "đang xử lý" : flowState.readyForApproval ? "đã có phản hồi/chờ duyệt" : "đang chờ UI phản hồi";
                  const waitMessage = `Flow ${stateText}: ${shotCount} shot · ${waitedSeconds}/${maxWaitSeconds}s · không nhập lại prompt.`;
                  updateWorkspaceActivity(typeActivityId, { state: "running", progress, message: waitMessage, nextAction: flowState.readyForApproval ? "Kiểm tra phản hồi rồi bấm Generate khi bạn duyệt." : "Tiếp tục chờ Flow trả UI trạng thái; không gõ lại prompt." });
                  setNotice(waitMessage);
                  if (flowState.readyForApproval) {
                    flowReadyForApproval = true;
                    break;
                  }
                }
              } catch {
                autoTypeState = "info";
                message = `Prompt đã được nạp đúng một lần; Flow vẫn đang xử lý ${shotCount} shot. App không gõ lại và không tự Enter.`;
              }
              if (flowReadyForApproval) {
                autoTypeState = "info";
                message = `Flow đã trả phản hồi cho ${shotCount} shot và đang chờ bạn duyệt Generate. App không tạo session riêng cho từng shot.`;
                setNotice(message);
              } else if (waitedSeconds >= maxWaitSeconds) {
                autoTypeState = "info";
                message = `Flow vẫn chưa trả UI hoàn tất sau ${maxWaitSeconds} giây cho ${shotCount} shot. Prompt đã nạp một lần; giữ nguyên session để chờ tiếp, không coi là đã tạo video.`;
                setNotice(message);
              }
            }
            const latestProcess = latestWorkflow.processes[latestWorkflow.processes.length - 1];
            updateWorkspaceActivity(typeActivityId, { state: autoTypeState, progress: autoTypeFailed ? undefined : autoTypeState === "info" ? undefined : 1, durationMs: Math.round(performance.now() - typeStartedAt), message, output: latestProcess?.output ?? undefined, nextAction: latestWorkflow.roadmap.find((item) => item.status === "waiting_user" || item.status === "pending")?.nextAction ?? (autoTypeState === "info" ? "Flow vẫn đang xử lý hoặc đang chờ duyệt; mở tab Flow để kiểm tra trạng thái thật." : "Prompt đã nạp; tiếp tục kiểm tra asset và duyệt Generate.") });
          } catch (error) {
            const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "không rõ lỗi";
            message = `Đã quét được Flow nhưng chưa tự nạp prompt: ${detail.slice(0, 300)}`;
            autoTypeFailed = true;
            autoTypeState = "error";
            updateWorkspaceActivity(typeActivityId, { state: "error", durationMs: Math.round(performance.now() - typeStartedAt), message, nextAction: "Kiểm tra UI ref của ô prompt trong process log rồi quét lại." });
          }
        } else {
          message = "Đã quét được Flow nhưng BrowserMCP chưa trả ref điều khiển cho ô prompt/button; không giả đã nạp. Giữ nguyên tab và quét lại sau khi extension ổn định.";
          autoTypeState = "blocked";
          updateWorkspaceActivity(activityId, { state: "blocked", message, nextAction: "Giữ tab Google Flow đang hiện New project/Agent rồi bấm quét lại; app chỉ thao tác khi BrowserMCP cấp ref thật." });
        }
        }
      }
      setBrowserFlowWorkflow(latestWorkflow);
      setNotice(message);
      const workflowPromptReady = latestWorkflow.processes.some((process) => process.operation === "type" && process.state === "succeeded");
      const workflowOutputReady = (latestWorkflow.downloadedFiles ?? []).some((file) => file.mediaKind === "video" && (!autoRunId || file.runId === autoRunId));
      const finalActivityState = autoTypeFailed ? "error" : autoTypeState === "blocked" || (!autoTypeState && result.status === "waiting_user") ? "blocked" : autoTypeState === "info" ? "info" : autoTypeState === "success" || workflowPromptReady || result.status === "ready" ? "success" : "error";
      updateWorkspaceActivity(activityId, { state: finalActivityState, progress: finalActivityState === "success" ? 1 : undefined, durationMs: Math.round(performance.now() - startedAt), message, output: latestWorkflow.discoveryPath ?? undefined, nextAction: latestWorkflow.roadmap.find((item) => item.status === "blocked" || item.status === "waiting_user" || item.status === "pending")?.nextAction ?? "Session, file binding, roadmap và process đã được lưu." });
      return !autoTypeFailed && autoTypeState !== "blocked" && (!autoGenerate || autoGenerationPassed) && (workflowPromptReady || workflowOutputReady || !script);
    } catch {
      return false;
    } finally {
      setBrowserHandoffBusy(false);
    }
  }

  async function runBrowserFlowStep(operation: string, element: string | null = null, elementRef: string | null = null) {
    if (!selectedProjectId || !browserFlowWorkflow) {
      setNotice("Chưa có Browser Flow workflow. Hãy dựng Blender storyboard rồi quét route lần đầu.");
      return;
    }
    if (operation === "snapshot") {
      clearBrowserFlowCapabilityCache(selectedProjectId);
    }
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: `browser_flow.${operation}`, tool: "BrowserMCP", state: "running", message: `Đang chạy process Browser Flow cho bước ${operation}; chờ output thật.`, progress: 0 });
    setBrowserHandoffBusy(true);
    setNotice(`Đang chạy Browser Flow step: ${operation}…`);
    try {
      let effectiveElement = element;
      let effectiveElementRef = elementRef;
      if (operation === "click" && element && /approve|start generation|bắt đầu tạo/i.test(element)) {
        const fresh = await invoke<BrowserFlowWorkflowReport>("run_browser_flow_step", { request: { projectId: selectedProjectId, workflowId: browserFlowWorkflow.workflowId, operation: "snapshot", approved: true, url: null, element: null, elementRef: null, text: null, submit: false, key: null, time: null } });
        applyFreshBrowserFlowWorkflow(fresh.workflow);
        const currentApprovalRef = findBrowserFlowApprovalRef(fresh.workflow.uiRefs);
        if (currentApprovalRef) {
          effectiveElement = currentApprovalRef.label;
          effectiveElementRef = currentApprovalRef.reference;
        } else {
          const storyboardRef = findBrowserFlowStoryboardChoiceRef(fresh.workflow.uiRefs);
          if (storyboardRef) {
            const chosen = await invoke<BrowserFlowWorkflowReport>("run_browser_flow_step", { request: { projectId: selectedProjectId, workflowId: fresh.workflow.workflowId, operation: "click_storyboard", approved: true, url: null, element: storyboardRef.label, elementRef: storyboardRef.reference, text: null, submit: false, key: null, time: null } });
            setBrowserFlowWorkflow(chosen.workflow);
            setNotice(`Đã tự chọn “${storyboardRef.label}”; Flow đang dựng storyboard, chưa tạo video.`);
            updateWorkspaceActivity(activityId, { state: "info", durationMs: Math.round(performance.now() - startedAt), message: `Đã tự chọn “${storyboardRef.label}”; Flow đang dựng storyboard.`, output: chosen.workflow.processes[chosen.workflow.processes.length - 1]?.output ?? undefined, nextAction: "Chờ Flow dựng storyboard rồi đọc trạng thái lại." });
            return;
          }
          setBrowserFlowWorkflow(fresh.workflow);
          const message = "Flow hiện chưa có nút Approve; app không bấm ref cũ. Đang chờ Flow hiển thị lựa chọn/permission mới.";
          setNotice(message);
          updateWorkspaceActivity(activityId, { state: "info", durationMs: Math.round(performance.now() - startedAt), message, output: fresh.workflow.processes[fresh.workflow.processes.length - 1]?.output ?? undefined, nextAction: "Chờ Flow hiện đúng lựa chọn rồi bấm Đọc trạng thái Flow." });
          return;
        }
      }
      const result = await invoke<BrowserFlowWorkflowReport>("run_browser_flow_step", { request: { projectId: selectedProjectId, workflowId: browserFlowWorkflow.workflowId, operation, approved: true, url: operation === "navigate" ? browserFlowWorkflow.targetUrl : null, element: effectiveElement, elementRef: effectiveElementRef, text: null, submit: null, key: null, time: operation === "wait" ? 1 : null } });
      let latestWorkflow = result.workflow;
      if (operation === "snapshot") applyFreshBrowserFlowWorkflow(latestWorkflow);
      let latestMessage = result.message;
      if (operation === "snapshot") {
        const storyboardRef = findBrowserFlowStoryboardChoiceRef(latestWorkflow.uiRefs);
        const storyboardAlreadyChosen = latestWorkflow.processes.some((process) => process.operation === "click_storyboard" && process.state === "succeeded");
        if (storyboardRef && !storyboardAlreadyChosen) {
          latestMessage = `Đã tự chọn “${storyboardRef.label}”; đang để Flow dựng storyboard trước, không hỏi lại.`;
          setNotice(latestMessage);
          const chosen = await invoke<BrowserFlowWorkflowReport>("run_browser_flow_step", { request: {
            projectId: selectedProjectId,
            workflowId: latestWorkflow.workflowId,
            operation: "click_storyboard",
            approved: true,
            url: null,
            element: storyboardRef.label,
            elementRef: storyboardRef.reference,
            text: null,
            submit: false,
            key: null,
            time: null,
          } });
          latestWorkflow = chosen.workflow;
          latestMessage = chosen.message;
          if (chosen.status === "ready") {
            try {
              const settled = await invoke<BrowserFlowWorkflowReport>("run_browser_flow_step", { request: {
                projectId: selectedProjectId,
                workflowId: latestWorkflow.workflowId,
                operation: "wait",
                approved: true,
                url: null,
                element: null,
                elementRef: null,
                text: null,
                submit: false,
                key: null,
                time: 2,
              } });
              const refreshed = await invoke<BrowserFlowWorkflowReport>("run_browser_flow_step", { request: {
                projectId: selectedProjectId,
                workflowId: settled.workflow.workflowId,
                operation: "snapshot",
                approved: true,
                url: null,
                element: null,
                elementRef: null,
                text: null,
                submit: false,
                key: null,
                time: null,
              } });
              latestWorkflow = refreshed.workflow;
              latestMessage = refreshed.message;
            } catch {
              latestMessage = "Flow đã nhận lựa chọn storyboard; đang xử lý. App không hỏi lại và không gửi prompt lần nữa.";
            }
          }
        }
      }
      setBrowserFlowWorkflow(latestWorkflow);
      setNotice(latestMessage);
      const latestProcess = latestWorkflow.processes[latestWorkflow.processes.length - 1];
      updateWorkspaceActivity(activityId, { state: latestWorkflow.phase === "failed" ? "error" : latestWorkflow.phase === "waiting_user" ? "info" : "success", progress: latestWorkflow.phase === "failed" || latestWorkflow.phase === "waiting_user" ? undefined : 1, durationMs: Math.round(performance.now() - startedAt), message: latestMessage, output: latestProcess?.output ?? undefined, nextAction: latestWorkflow.roadmap.find((item) => item.status === "waiting_user" || item.status === "pending")?.nextAction ?? "Review workflow." });
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi Browser Flow không xác định";
      const message = `Browser Flow step chưa chạy được: ${detail.slice(0, 360)}`;
      if (operation === "snapshot") {
        clearFreshBrowserMcpState();
        setBrowserFlowWorkflow((current) => current ? { ...current, browserSessionAttached: false, uiRefs: [], uiRefCount: 0, providerProjectIdentity: null, visualStatePath: null, phase: "waiting_user", discoveryStatus: "blocked", lastMessage: message } : current);
      }
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Xem process log và sửa blocker trước khi chạy lại." });
    } finally {
      setBrowserHandoffBusy(false);
    }
  }

  async function connectGflowCliAccount() {
    return invoke<string>("connect_gflow_cli_account", { projectId: selectedProjectId });
  }
  return {
    connectGflowCliAccount,
    applyFreshBrowserFlowWorkflow,
    applyFreshBrowserMcpReport,
    autoFlowWorkspaceBootstrappedRef,
    autoGenerateBrowserFlow,
    autoGenerateBrowserFlowSequential,
    browserFlowWorkflow,
    browserHandoffBusy,
    browserMcpFreshState,
    browserMcpRuntimeReport,
    checkBrowserMcpSession,
    chromeAutoFlowReport,
    clearFreshBrowserMcpState,
    deleteVideoWorkflowSession,
    ensureFlowComposer,
    flowBatchApprovalRequest,
    loadLatestBrowserFlowWorkflow,
    loadVideoWorkflowSessions,
    openAutoFlowWorkspace,
    probeBrowserMcpRuntime,
    resolveFlowBatchApproval,
    runBrowserFlowAgent,
    runBrowserFlowAgentOnce,
    runBrowserFlowStep,
    saveVideoWorkflowSession,
    setBrowserFlowWorkflow,
    setBrowserHandoffBusy,
    setBrowserMcpFreshState,
    setBrowserMcpRuntimeReport,
    setChromeAutoFlowReport,
    setFlowBatchApprovalRequest,
    setVideoWorkflowSessions,
    startBrowserFlowDiscovery,
    videoWorkflowSessions,
  };
}
