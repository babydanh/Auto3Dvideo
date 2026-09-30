import type { AppSnapshot } from "./features/shared/appTypes";
import type { HealthStatus, ToolReadinessReport } from "./features/settings/settingsTypes";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { TabGuide } from "./features/help/helpTypes";
import type { WorkspaceActivityEvent } from "./features/shared/workspaceActivityTypes";
import { ActivityRow, JobsPanel } from "./features/jobs/JobsPanel";
import { AssetPackReviewPanel } from "./features/assets/AssetPackReviewPanel";
import { AssetReferencePanel } from "./features/assets/AssetReferencePanel";
import { AuditPanel } from "./features/audit/AuditPanel";
import { BrowserHandoffPanel } from "./features/browserhandoff/BrowserHandoffPanel";
import { EmptyState, HealthRow, MetricCard } from "./features/shared/ui";
import { HelpPanel } from "./features/help/HelpPanel";
import { OmniVoiceStudioPanel } from "./features/voice/OmniVoiceStudioPanel";
import { OnePromptWorkflowPanel } from "./features/oneprompt/OnePromptWorkflowPanel";
import { PreviewLibraryPanel } from "./features/preview/PreviewLibraryPanel";
import { PromptStudioPanel } from "./features/prompts/PromptStudioPanel";
import { ProviderCatalog } from "./features/providers/ProviderCatalog";
import { RecipeCard, RecipeCatalog } from "./features/recipes/RecipeCatalog";
import { ReviewPanel } from "./features/review/ReviewPanel";
import { SettingsPanel } from "./features/settings/SettingsPanel";
import { SubtitleStudioPanel } from "./features/subtitles/SubtitleStudioPanel";
import { TabGuidePanel } from "./features/help/TabGuidePanel";
import { TopicWorkflowPanel } from "./features/topic/TopicWorkflowPanel";
import { VideoVisionPanel } from "./features/videovision/VideoVisionPanel";
import { VieneuPanel } from "./features/voice/VieneuPanel";
import { VoiceStudioPanel } from "./features/voice/VoiceStudioPanel";
import { displayWorkspaceActivityState } from "./features/shared/workspaceActivityTypes";
import { invoke } from "@tauri-apps/api/core";
import { useAssetLibrary } from "./features/assets/useAssetLibrary";
import { useAuditLog } from "./features/audit/useAuditLog";
import { useBrowserFlowState } from "./features/browserflow/useBrowserFlowState";
import { useEffect, useRef, useState } from "react";
import { useJobQueue } from "./features/jobs/useJobQueue";
import { usePreviewLibraryState } from "./features/preview/usePreviewLibraryState";
import { useProjectWorkspace } from "./features/projects/useProjectWorkspace";
import { usePromptPresets } from "./features/prompts/usePromptPresets";
import { useProviderCatalogState } from "./features/providers/useProviderCatalogState";
import { useRecipeCatalog } from "./features/recipes/useRecipeCatalog";
import { useReviewPreview } from "./features/review/useReviewPreview";
import { useSettingsFixtures } from "./features/settings/useSettingsFixtures";
import { useSubtitleStudioState } from "./features/subtitles/useSubtitleStudioState";
import { useTopicWorkflowState } from "./features/topic/useTopicWorkflowState";
import { useVideoVisionState } from "./features/videovision/useVideoVisionState";
import { useVoiceStudioState } from "./features/voice/useVoiceStudioState";
import "./App.css";

const fallbackSnapshot: AppSnapshot = {
  appVersion: "0.1.0-dev",
  locale: "vi-VN",
  projectCount: 0,
  jobCount: 0,
  publishEnabled: false,
  paidGenerationEnabled: false,
};
const fallbackHealth: HealthStatus = {
  database: "preview",
  externalTools: "not_checked",
  publishPolicy: "blocked_by_default",
  locale: "vi-VN",
};
const fallbackReadiness: ToolReadinessReport = {
  status: "not_checked",
  requiredMissing: [],
  tools: [],
  externalProcessesStarted: false,
  networkProbePerformed: false,
  allowShellWrapper: false,
  rejectPathsOutsideProject: true,
  workerExecutionEnabled: false,
  workerGate: "native_build_and_supervision_required",
};
const navItems = [
  { id: "overview", label: "Tổng quan", short: "01" },
  { id: "recipes", label: "Quy trình video", short: "02" },
  { id: "providers", label: "Mô hình & API", short: "03" },
  { id: "jobs", label: "Hàng đợi tác vụ", short: "04" },
  { id: "review", label: "Quyền & duyệt", short: "05" },
  { id: "settings", label: "Cài đặt", short: "06" },
  { id: "voice", label: "Voice Studio", short: "07" },
  { id: "subtitles", label: "Subtitle Studio", short: "08" },
  { id: "vision", label: "Video Vision", short: "09" },
  { id: "handoff", label: "Browser Handoff", short: "10" },
  { id: "audit", label: "Nhật ký cục bộ", short: "11" },
  { id: "help", label: "Hướng dẫn sử dụng", short: "12" },
  { id: "preview", label: "Kho Preview", short: "13" },
];
const tabGuides: Record<string, TabGuide> = {
  overview: {
    eyebrow: "BẮT ĐẦU TẠI ĐÂY",
    title: "Tổng quan dùng để làm gì?",
    purpose: "Đây là bảng điều khiển để kiểm tra project, sức khỏe hệ thống và chọn hướng sản xuất video phù hợp.",
    steps: ["Tạo hoặc chọn một project local.", "Chọn Quy trình video để xem recipe phù hợp với mục tiêu.", "Theo dõi jobs, review và evidence trước khi xuất delivery."],
    note: "Khuyến nghị: luôn bắt đầu bằng project và recipe; không gửi file cá nhân hoặc gọi cloud chỉ từ màn hình này.",
  },
  recipes: {
    eyebrow: "CHỌN QUY TRÌNH",
    title: "Quy trình video dùng để chọn cách sản xuất",
    purpose: "Mỗi recipe là một kiểu đầu ra: HTML motion, ảnh/GIF, lồng tiếng, quay demo, hybrid 2D–3D hoặc Blender 3D.",
    steps: ["Chọn recipe theo loại video muốn làm.", "Đọc worker, execution và approval ở phần chi tiết.", "Dùng mock preview để xem graph hoặc tạo queued job an toàn."],
    note: "Mock preview chỉ kiểm tra state; chưa tạo video production, chưa chạy general worker và chưa publish.",
  },
  providers: {
    eyebrow: "MODEL & API",
    title: "Model & API dùng để quản lý profile theo chức năng",
    purpose: "Mỗi nhóm LLM, image, video, TTS, STT hoặc audio có thể dùng provider/model riêng; secret chỉ lưu bằng credential reference.",
    steps: ["Xem profile và trạng thái configured/missing đã được mask.", "Thêm provider bằng endpoint và env/OS credential reference, không nhập API key.", "Kiểm tra policy trước khi bật adapter thật."],
    note: "Hiện cloud request vẫn bị khóa ở native boundary; tab này mới là catalog/readiness, không tự gửi request.",
  },
  jobs: {
    eyebrow: "JOB CONTROL",
    title: "Hàng đợi jobs dùng để theo dõi execution evidence",
    purpose: "Theo dõi job, progress, retry/cancel, execution attempt, output expected và side-effect state.",
    steps: ["Chạy recipe để tạo mock job hoặc queued job.", "Mở Attempts để xem lease, timeout, process và output evidence.", "Chỉ chạy mock hoặc fixture đã được gate; không dùng path tùy ý ngoài workspace."],
    note: "Nếu side effect không xác định, job phải dừng ở reconciliation; không được đánh dấu thành công giả.",
  },
  review: {
    eyebrow: "REVIEW TRƯỚC KHI TẠO",
    title: "Quyền & review dùng để kiểm tra nội dung trước generation/delivery",
    purpose: "Kiểm tra narration coverage, visual proof, entity continuity, prompt grounding, rights, AI disclosure và accessibility.",
    steps: ["Compile visual plan để xem các beat và anchor.", "Kiểm tra candidate có đúng chủ đề, hành động và entity hay không.", "Duyệt rights, voice/likeness, disclosure và subtitle trước delivery."],
    note: "Không coi plan hợp lệ là video publishable; chất lượng sáng tạo và quyền sử dụng vẫn cần người duyệt.",
  },
  settings: {
    eyebrow: "CẤU HÌNH LOCAL",
    title: "Cài đặt dùng để kiểm tra công cụ và policy runtime",
    purpose: "Cấu hình reference cho FFmpeg, FFprobe, Python, Blender, yt-dlp và Obscura; chạy probe, ComfyUI loopback health và fixture có kiểm soát.",
    steps: ["Lưu đường dẫn binary đúng allowlist.", "Probe version để xác nhận tool thực sự chạy được.", "Dùng dry-run/fixture để kiểm tra trước khi mở rộng worker."],
    note: "Không lưu API key trong SQLite; yt-dlp và Obscura là binary tùy chọn. App tự nhận bản Obscura local nếu có, hoặc cho phép đổi path trong Cài đặt; Obscura chỉ quét public, không stealth/proxy.",
  },
  voice: {
    eyebrow: "VOICE STUDIO / VIENEUTTS",
    title: "Chuẩn hoá giọng trước khi đưa vào video",
    purpose: "Chọn preset, nhiệt độ sinh giọng và cue cảm xúc thử nghiệm theo từng đoạn; preview local trước khi render.",
    steps: ["Chọn preset voice và phong cách đọc phù hợp.", "Gán cue cảm xúc cho từng scene, sau đó nghe thử.", "Chỉ bật clone khi có audio và consent hợp lệ; không dùng để giả mạo người khác."],
    note: "VieNeu v3 Turbo không dùng style prompt tự do; cue như [cười] chỉ là experimental và phải nghe lại.",
  },
  subtitles: {
    eyebrow: "SUBTITLE STUDIO / EDITOR",
    title: "Tạo và chỉnh phụ đề theo từng câu",
    purpose: "Nhập video và SRT/VTT local, sửa nội dung/timestamp, kiểm tra lỗi rồi xuất sidecar hoặc bản sao burn-in.",
    steps: ["Chọn video và phụ đề có quyền xử lý.", "Sửa từng dòng, timestamp, tìm-thay thế hoặc chia/gộp cue.", "Validate, xuất file mới hoặc burn-in vào bản sao MP4; file gốc không bị ghi đè."],
    note: "Transcript/dịch tự động cần worker hoặc provider riêng; Subtitle Studio luôn giữ bản gốc và yêu cầu review trước delivery.",
  },
  vision: {
    eyebrow: "VIDEO VISION / EVIDENCE",
    title: "Đọc hiểu video theo bằng chứng, không đoán mò",
    purpose: "Tách video local thành frame, shot, audio và visual cues có timestamp để làm input cho storyboard; bước này chưa gọi VLM, OCR hoặc STT.",
    steps: ["Chọn video bạn có quyền xử lý trong workspace.", "Probe và trích frame/audio bằng FFmpeg qua native supervisor.", "Mở evidence JSON, kiểm tra shot/visual cues rồi mới đưa sang planner hoặc Qwen3-VL adapter."],
    note: "Semantic VLM, OCR và transcript vẫn đang chờ adapter/model được người dùng duyệt; output hiện tại là deterministic evidence và luôn cần human review.",
  },
  handoff: {
    eyebrow: "BROWSERMCP / CONNECTION CENTER",
    title: "Kết nối BrowserOS neo một lần cho Quy trình video",
    purpose: "Xác nhận session BrowserOS MCP và DOM Flow thật. Asset Blender, shot prompt và handoff pack do Quy trình video tự quản lý.",
    steps: ["Mở Google Flow trong BrowserOS neo và đăng nhập profile riêng nếu cần.", "Vào đây bấm kiểm tra kết nối để xác nhận snapshot/DOM thật.", "Quay lại Quy trình video để chạy shot Blender và bước Omni."],
    note: "Không chọn asset, nhập prompt, duyệt upload hay import candidate ở màn hình này. Không đọc cookie/token và không giả vờ upload/download.",
  },
  preview: {
    eyebrow: "PREVIEW RADAR / LOCAL QUEUE",
    title: "Kho Preview dùng để gom tín hiệu video",
    purpose: "Lập kế hoạch quét, giữ link preview và chọn những video đáng đưa vào plan nội dung gốc.",
    steps: ["Chọn nhiều nền tảng và giới hạn kết quả để tạo scan plan; app ưu tiên Obscura rồi fallback BrowserOS một tab nếu route public trả 0 card.", "Nạp URL preview, chọn card và xác nhận quyền sử dụng trước khi tải.", "Mở Subtitle Studio hoặc Voice Studio từ asset local rồi review trước khi xuất."],
    note: "Tải video chỉ chạy với URL HTTPS allowlist và quyền đã xác nhận. Không né CAPTCHA, không xoá watermark và không tự đăng bài.",
  },
  audit: {
    eyebrow: "BẰNG CHỨNG CỤC BỘ",
    title: "Nhật ký cục bộ dùng để xem lịch sử thao tác",
    purpose: "Xem thông tin sự kiện từ SQLite để biết project, job hoặc attempt nào đã được tạo hay thay đổi.",
    steps: ["Làm mới nhật ký sau khi thao tác.", "Đối chiếu sự kiện với job, attempt và bằng chứng đầu ra.", "Dùng nhật ký để điều tra lỗi hoặc chuẩn bị review, không thay cho phê duyệt quyền."],
    note: "Dữ liệu bí mật không hiển thị; nhật ký hiện chỉ lưu cục bộ, chưa đồng bộ cloud và chưa ghi đăng bài thật.",
  },
  help: {
    eyebrow: "TRUNG TÂM HƯỚNG DẪN",
    title: "Hướng dẫn sử dụng Auto3Dvideo Studio",
    purpose: "Đi theo thứ tự từ tạo project, chọn quy trình, kiểm tra quyền, chạy thử an toàn đến xem bằng chứng đầu ra.",
    steps: ["Tạo project local và chọn workspace riêng.", "Chọn recipe đúng mục tiêu: HTML, ảnh/GIF, lồng tiếng, quay demo hoặc 3D.", "Review nội dung và quyền trước khi xuất; hiện chưa tự gọi cloud hay đăng bài."],
    note: "Đây là ứng dụng ưu tiên cục bộ. Các nút có chữ “thử”, “mô phỏng” hoặc “fixture” chỉ kiểm tra quy trình, không phải sản xuất/đăng bài hoàn chỉnh.",
  },
};

function App() {
  const [activeNav, setActiveNav] = useState("recipes");

  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

  const [snapshot, setSnapshot] = useState<AppSnapshot>(fallbackSnapshot);

  const paidGenerationAllowed = snapshot.paidGenerationEnabled;

  const [health, setHealth] = useState<HealthStatus>(fallbackHealth);

  const [readiness, setReadiness] = useState<ToolReadinessReport>(fallbackReadiness);

  const [workspaceActivity, setWorkspaceActivity] = useState<WorkspaceActivityEvent[]>([]);

  const [topTerminalPage, setTopTerminalPage] = useState(0);

  const [showProductionAdvanced, setShowProductionAdvanced] = useState(false);

  const [notice, setNoticeText] = useState("Đang ở chế độ local-first; chưa gọi API cloud và chưa chạy process ngoài.");

  const [actionFeedback, setActionFeedback] = useState<{ label: string; state: "running" | "success" | "error" | "info" } | null>(null);

  const activeButtonRef = useRef<HTMLButtonElement | null>(null);

  const noticeVersionRef = useRef(0);

  const [loading, setLoading] = useState(false);

  function setNotice(message: string) {
      noticeVersionRef.current += 1;
      setNoticeText(message);
      if (!message) {
        setActionFeedback(null);
        activeButtonRef.current?.removeAttribute("data-action-active");
        activeButtonRef.current = null;
        return;
      }
      const normalized = message.toLowerCase();
      const state = /^không |bị chặn|thất bại|chưa kết nối|chưa tạo được/.test(normalized)
        ? "error"
        : /^đang |đã nhận lệnh|đang bắt đầu|đang chuyển|đang tạo|đang kiểm/.test(normalized)
          ? "running"
          : /^hãy |cần |chọn /.test(normalized)
            ? "info"
            : "success";
      setActionFeedback((current) => ({ label: current?.label ?? "Thao tác", state }));
      if (state !== "running") {
        activeButtonRef.current?.removeAttribute("data-action-active");
        activeButtonRef.current = null;
      }
    }

  function recordWorkspaceActivity(input: Omit<WorkspaceActivityEvent, "eventId" | "timestamp">) {
      const event: WorkspaceActivityEvent = {
        ...input,
        eventId: `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
      };
      setWorkspaceActivity((current) => [...current, event].slice(-80));
      return event.eventId;
    }

  function updateWorkspaceActivity(eventId: string, patch: Partial<Omit<WorkspaceActivityEvent, "eventId" | "timestamp">>) {
      setWorkspaceActivity((current) => current.map((event) => event.eventId === eventId ? { ...event, ...patch } : event));
    }

  function handleButtonFeedback(event: ReactMouseEvent<HTMLDivElement>) {
      const button = (event.target as HTMLElement).closest("button") as HTMLButtonElement | null;
      if (!button || button.disabled || button.dataset.feedbackIgnore === "true") return;
      const label = (button.innerText || button.getAttribute("aria-label") || "Thao tác").replace(/\s+/g, " ").trim();
      activeButtonRef.current?.removeAttribute("data-action-active");
      activeButtonRef.current = button;
      button.dataset.actionActive = "true";
      const version = ++noticeVersionRef.current;
      setActionFeedback({ label, state: "running" });
      setNoticeText(`Đang thực hiện: ${label}…`);
      window.setTimeout(() => {
        if (noticeVersionRef.current !== version) return;
        setActionFeedback({ label, state: "info" });
        setNoticeText(`Đã nhận thao tác: ${label}. Nếu đây là tác vụ dài, kết quả sẽ cập nhật tiếp ở workspace log.`);
        button.removeAttribute("data-action-active");
        if (activeButtonRef.current === button) activeButtonRef.current = null;
      }, 900);
    }

  async function refresh() {
    try {
      const [nextSnapshot, nextHealth, nextReadiness, nextProjects, nextJobs, nextRecipes, nextTopicProfiles, nextPromptTemplates, nextProviders, nextProviderEnvSnapshot, nextAuditEvents] = await Promise.all([
        invoke<AppSnapshot>("app_snapshot"),
        invoke<HealthStatus>("health_check"),
        invoke<ToolReadinessReport>("list_tool_readiness"),
        loadProjects(),
        loadJobs(),
        loadRecipes(),
        loadTopicProfiles(),
        loadPromptTemplates(),
        loadProviders(),
        loadProviderEnvSnapshot(),
        loadAuditEvents(),
      ]);
      setSnapshot(nextSnapshot);
      setHealth(nextHealth);
      setReadiness(nextReadiness);
      setProjects(nextProjects);
      setJobs(nextJobs);
      setRecipes(nextRecipes);
      setTopicProfiles(nextTopicProfiles);
      setPromptTemplates(nextPromptTemplates);
      setProviders(nextProviders);
      setProviderEnvSnapshot(nextProviderEnvSnapshot);
      setAuditEvents(nextAuditEvents);
      if (!selectedProjectId && nextProjects[0]) setSelectedProjectId(nextProjects[0].projectId);
    } catch {
      setNotice("Chế độ xem trước UI: Tauri backend chưa kết nối trong cửa sổ trình duyệt này.");
    }
  }

  const { chooseWorkspace, createProject, deleteProject, loadProjects, projectName, projects, selectedProject, selectedProjectId, setProjectName, setProjects, setSelectedProjectId, setShowProjectForm, setWorkspaceRoot, showProjectForm, workspaceRoot } = useProjectWorkspace({ setActiveNav: setActiveNav, setLoading: setLoading, setNotice: setNotice, setSnapshot: setSnapshot, });

  const { attemptExecutableId, attemptJobId, attemptMediaKind, attemptOutputPath, attemptOutputs, attempts, inspectAttempts, jobs, launchPlan, loadJobs, mutateJob, prepareAttempt, previewWorkerLaunch, setAttemptExecutableId, setAttemptMediaKind, setAttemptOutputPath, setJobs, startMockAttempt } = useJobQueue({ refresh: refresh, setLoading: setLoading, setNotice: setNotice, });

  const { loadRecipes, queuePendingJob, recipes, runRecipe, selectedRecipe, setRecipes, setSelectedRecipe } = useRecipeCatalog({ selectedProjectId: selectedProjectId, setActiveNav: setActiveNav, setJobs: setJobs, setLoading: setLoading, setNotice: setNotice, setSnapshot: setSnapshot, });

  const { assetPackBlenderBinding, assetPackBlenderRun, assetPackReviews, assets, assignReference, changeAssetState, changeReferenceSetState, chooseAssetPackSource, chooseAssetSource, createReferenceSet, detachReference, importAsset, loadAssetsAndReferenceSets, prepareAssetPackBlenderBinding, referenceSets, registerAssetPackSource, runAssetPackBlenderBinding, setAssets, setReferenceSets, updateAssetMetadata, updateAssetPackItemReview, updateReferenceSet } = useAssetLibrary({ recordWorkspaceActivity: recordWorkspaceActivity, selectedProjectId: selectedProjectId, setLoading: setLoading, setNotice: setNotice, updateWorkspaceActivity: updateWorkspaceActivity, });

  const { checkOmniVoice, checkVieneu, chooseVoiceReference, createVoiceProfile, deleteVoiceProfile, loadVoiceProfiles, loadVoiceSamples, omnivoiceError, omnivoiceReadiness, omnivoiceReport, prepareOmniVoiceModel, runOmniVoiceTts, runVieneuTts, setVoiceSettings, updateVoiceProfile, vieneuReadiness, vieneuReport, voiceProfiles, voiceSamples, voiceSettings } = useVoiceStudioState({ recordWorkspaceActivity: recordWorkspaceActivity, refresh: refresh, selectedProjectId: selectedProjectId, setLoading: setLoading, setNotice: setNotice, updateWorkspaceActivity: updateWorkspaceActivity, });

  const { additionalPrompt, availablePromptTemplates, contentGoal, generateLocalScript, handleTopicInputChange, loadPromptTemplates, loadTopicProfiles, localScriptReview, localVideoReport, previewTopicWorkflow, renderApprovedLocalVideo, selectTopicProfile, selectedPromptTemplateId, selectedTopicProfile, selectedTopicProfileId, setAdditionalPrompt, setContentGoal, setPromptTemplates, setSelectedPromptTemplateId, setTopic, setTopicProfiles, topic, topicProfiles } = useTopicWorkflowState({ recordWorkspaceActivity: recordWorkspaceActivity, refresh: refresh, selectedProjectId: selectedProjectId, setLoading: setLoading, setNotice: setNotice, setSelectedRecipe: setSelectedRecipe, updateWorkspaceActivity: updateWorkspaceActivity, voiceSettings: voiceSettings, });

  const { applyPromptPreset, changePromptPresetState, createPromptPreset, loadPromptPresets, promptPresets, setPromptPresets, updatePromptPreset } = usePromptPresets({ contentGoal: contentGoal, recordWorkspaceActivity: recordWorkspaceActivity, selectedProjectId: selectedProjectId, selectedTopicProfile: selectedTopicProfile, setAdditionalPrompt: setAdditionalPrompt, setLoading: setLoading, setNotice: setNotice, topic: topic, updateWorkspaceActivity: updateWorkspaceActivity, });

  const { burnInSubtitles, chooseSubtitleFile, chooseSubtitleVideo, loadSubtitleDocument, probeSubtitleVideo, saveSubtitleDocument, setSubtitleDocument, setSubtitleFormat, setSubtitleOutputPath, setSubtitlePath, setSubtitleProbe, setSubtitleSourceLanguage, setSubtitleTargetLanguage, setSubtitleVideoPath, subtitleBurnInReport, subtitleDocument, subtitleFormat, subtitleOutputPath, subtitlePath, subtitleProbe, subtitleReport, subtitleSourceLanguage, subtitleTargetLanguage, subtitleVideoPath, toProjectRelativePath } = useSubtitleStudioState({ selectedProject: selectedProject, selectedProjectId: selectedProjectId, setLoading: setLoading, setNotice: setNotice, });

  const { analyzeVideoVision, chooseVideoVisionFile, setVideoVisionExtractAudio, setVideoVisionMaxFrames, setVideoVisionOutputPath, setVideoVisionPath, setVideoVisionSampleFps, videoVisionExtractAudio, videoVisionMaxFrames, videoVisionOutputPath, videoVisionPath, videoVisionReport, videoVisionSampleFps } = useVideoVisionState({ refresh: refresh, selectedProjectId: selectedProjectId, setLoading: setLoading, setNotice: setNotice, toProjectRelativePath: toProjectRelativePath, });

  const { changePreviewRightsStatus, clearPreviewLibrary, continueDownloadedToSubtitles, continueDownloadedToVoice, createPreviewScanPlan, downloadSelectedReferenceVideo, importPreviewUrls, previewCards, previewCreatorUrl, previewDownloadReport, previewMaxResults, previewPlatforms, previewRightsStatus, previewScanPlan, previewScanReport, previewUrls, reviewSelectedPreview, scanLicensedFootage, scanPreviewCreatorCatalog, selectPreviewCard, selectedPreviewId, setPreviewCreatorUrl, setPreviewMaxResults, setPreviewUrls, togglePreviewPlan, togglePreviewPlatform } = usePreviewLibraryState({ recordWorkspaceActivity: recordWorkspaceActivity, refresh: refresh, selectedProjectId: selectedProjectId, setActiveNav: setActiveNav, setAssets: setAssets, setLoading: setLoading, setNotice: setNotice, setSubtitleProbe: setSubtitleProbe, setSubtitleVideoPath: setSubtitleVideoPath, setVideoVisionPath: setVideoVisionPath, updateWorkspaceActivity: updateWorkspaceActivity, });

  const { commandCodeReport, commandCodeTesting, loadProviderEnvSnapshot, loadProviders, providerEnvSnapshot, providers, setProviderEnvSnapshot, setProviders, testCommandCode, toggleCloudGeneration } = useProviderCatalogState({ recordWorkspaceActivity: recordWorkspaceActivity, setNotice: setNotice, setSnapshot: setSnapshot, snapshot: snapshot, });

  const { assetPipelineCheckReport, blenderFixtureReport, fixtureReport, runAssetPipelineCheck, runBlenderFixture, runFfmpegFixture, runFfmpegFixtureAttempt, runTrue3dFixture, runTrue3dMultishotFixture, true3dFixtureReport, true3dMultishotFixtureReport } = useSettingsFixtures({ inspectAttempts: inspectAttempts, refresh: refresh, setActiveNav: setActiveNav, setJobs: setJobs, setLoading: setLoading, setNotice: setNotice, setSnapshot: setSnapshot, });

  const { previewNarrativeVisualPlan, visualPlanPreview } = useReviewPreview({ setActiveNav: setActiveNav, setLoading: setLoading, setNotice: setNotice, });

  const { auditEvents, loadAuditEvents, setAuditEvents } = useAuditLog();

  const { browserFlowWorkflow, browserHandoffBusy, browserMcpFreshState, browserMcpRuntimeReport, checkBrowserMcpSession, chromeAutoFlowReport, connectGflowCliAccount, deleteVideoWorkflowSession, flowBatchApprovalRequest, loadLatestBrowserFlowWorkflow, loadVideoWorkflowSessions, openAutoFlowWorkspace, probeBrowserMcpRuntime, resolveFlowBatchApproval, saveVideoWorkflowSession, setBrowserFlowWorkflow, setVideoWorkflowSessions, startBrowserFlowDiscovery, videoWorkflowSessions } = useBrowserFlowState({ paidGenerationAllowed: paidGenerationAllowed, recordWorkspaceActivity: recordWorkspaceActivity, selectedProjectId: selectedProjectId, setNotice: setNotice, snapshot: snapshot, topic: topic, updateWorkspaceActivity: updateWorkspaceActivity, });

  useEffect(() => {
      setBrowserFlowWorkflow(null);
      if (selectedProjectId) {
        void loadLatestBrowserFlowWorkflow(selectedProjectId);
        void loadVoiceProfiles(selectedProjectId);
        void loadVoiceSamples(selectedProjectId);
        void loadPromptPresets(selectedProjectId);
        void loadVideoWorkflowSessions(selectedProjectId);
        void loadAssetsAndReferenceSets(selectedProjectId);
      } else {
        setPromptPresets([]);
        setVideoWorkflowSessions([]);
        setAssets([]);
        setReferenceSets([]);
      }
    }, [selectedProjectId]);

  const topTerminalPageSize = 4;

  const topTerminalPageCount = Math.max(1, Math.ceil(workspaceActivity.length / topTerminalPageSize));

  const topTerminalPageIndex = Math.min(topTerminalPage, topTerminalPageCount - 1);

  const topTerminalEvents = workspaceActivity
      .slice()
      .reverse()
      .slice(topTerminalPageIndex * topTerminalPageSize, (topTerminalPageIndex + 1) * topTerminalPageSize)
      .reverse();

  const topTerminalLastEvent = workspaceActivity[workspaceActivity.length - 1];

  const topTerminalRunning = loading || topTerminalLastEvent?.state === "running";

  const topBrowserMcpStatus = browserMcpFreshState.status === "attached"
      ? `BROWSER/MCP: ATTACHED · ${browserMcpFreshState.uiRefCount} UI REF · FRESH`
      : browserMcpFreshState.status === "session-found"
        ? "BROWSER/MCP: SESSION FOUND · REF NOT VERIFIED"
        : browserMcpFreshState.status === "not-connected"
        ? "BROWSER/MCP: NOT CONNECTED"
        : "BROWSER/MCP: NOT VERIFIED · SNAPSHOT NEEDED";

  useEffect(() => {
      void refresh();
    }, []);

  useEffect(() => {
      (window as unknown as { switchTab?: (t: string) => void }).switchTab = (t: string) => {
        setActiveNav(t);
      };
    }, []);

  useEffect(() => {
      setTopTerminalPage(0);
    }, [workspaceActivity.length]);

  return (
      <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`} onClickCapture={handleButtonFeedback}>
        <button type="button" className="global-sidebar-toggle" onClick={() => setSidebarCollapsed((value) => !value)} aria-label="Mở hoặc thu gọn trung tâm điều hướng">{sidebarCollapsed ? "›" : "‹"}</button>
        <aside className="sidebar">
          <div className="brand-lockup">
            <div className="brand-mark">A3</div>
            <div>
              <p className="eyebrow">TRUNG TÂM TỰ ĐỘNG HÓA</p>
              <h1>Auto3Dvideo</h1>
            </div>
          </div>
          <div className="workspace-switcher">
            <span className="status-dot" />
            <div>
              <span className="muted-label">Không gian làm việc hiện tại</span>
              <strong>{selectedProject?.name ?? "Dự án Mặc định"}</strong>
            </div>
            <button className="icon-button" onClick={() => setShowProjectForm(true)} aria-label="Tạo project">+</button>
          </div>
          <button
            type="button"
            className="sidebar-project-back"
            onClick={() => setActiveNav("overview")}
            aria-label="Quay lại danh sách dự án"
          >
            ← Danh sách dự án
          </button>
          <nav className="main-nav" aria-label="Điều hướng chính">
            {navItems.map((item) => (
              <button
                key={item.id}
                className={`nav-item ${activeNav === item.id ? "active" : ""}`}
                onClick={() => setActiveNav(item.id)}
              >
                <span className="nav-number">{item.short}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="sidebar-footer">
            <div className="safe-badge"><span className="shield">S</span><div><strong>Chế độ an toàn</strong><span>Đăng bài đang khóa</span></div></div>
            <span className="version-label">v{snapshot.appVersion} · {snapshot.locale}</span>
          </div>
        </aside>

        <main className={`main-content ${activeNav === "recipes" ? "production-workspace" : ""}`}>
          <header className="topbar">
            <div>
              <p className="eyebrow">BẢNG ĐIỀU PHỐI / {navItems.find((item) => item.id === activeNav)?.label?.toUpperCase() ?? "TỔNG QUAN"}</p>
              <h2>{navItems.find((item) => item.id === activeNav)?.label ?? "Tổng quan"}</h2>
            </div>
            <div className="topbar-actions">
              <span className="runtime-pill"><span className="status-dot" /> Môi trường cục bộ <b>SẴN SÀNG</b></span>
              <button className="secondary-button" onClick={() => void refresh()}>Làm mới</button>
              {activeNav !== "recipes" && <button className="primary-button" onClick={() => setShowProjectForm(true)}>＋ Dự án mới</button>}
            </div>
          </header>

          <div className={`notice-banner notice-${actionFeedback?.state ?? "info"}`} role="status" aria-live="polite"><span className="notice-icon">{actionFeedback?.state === "running" ? "⟳" : actionFeedback?.state === "error" ? "!" : "i"}</span><div className="notice-copy"><strong>{actionFeedback?.state === "running" ? `Đang làm: ${actionFeedback.label}` : actionFeedback?.label ?? "Trạng thái hệ thống"}</strong><span>{notice}</span></div><button data-feedback-ignore="true" onClick={() => setNotice("")} aria-label="Đóng thông báo">×</button></div>
          <section className={`global-task-terminal ${topTerminalRunning ? "running" : ""}`} aria-label="Tiến độ workspace">
            <div className="global-task-terminal-head"><div><strong>TIẾN ĐỘ WORKSPACE</strong><span>{snapshot.paidGenerationEnabled ? "CLOUD/API: ENABLED" : "LOCAL-FIRST"}</span><span>{topBrowserMcpStatus}</span></div><div className="global-task-terminal-state"><b>{topTerminalRunning ? "RUNNING" : topTerminalEvents.length ? "IDLE / LAST RESULT" : "WAITING"}</b><div className="global-task-terminal-pager" aria-label="Phân trang log"><button type="button" onClick={() => setTopTerminalPage((current) => Math.min(current + 1, topTerminalPageCount - 1))} disabled={topTerminalPageIndex >= topTerminalPageCount - 1} aria-label="Xem log cũ hơn">Cũ hơn</button><span>{workspaceActivity.length ? `${topTerminalPageIndex + 1}/${topTerminalPageCount}` : "0/0"}</span><button type="button" onClick={() => setTopTerminalPage((current) => Math.max(current - 1, 0))} disabled={topTerminalPageIndex === 0} aria-label="Xem log mới hơn">Mới hơn</button></div></div></div>
            <div className="global-task-terminal-subline">Log rút gọn còn 4 dòng mỗi trang. Khi chưa có UI ref thật, app vẫn giữ trạng thái bị chặn.</div>
            <div className="global-task-terminal-body">
              {topTerminalEvents.length ? topTerminalEvents.map((entry) => <div className={`global-task-terminal-line state-${entry.state}`} key={entry.eventId}><small>{new Date(entry.timestamp).toLocaleTimeString("vi-VN")}</small><b>{displayWorkspaceActivityState(entry.state)}</b><strong>{entry.tool}</strong><code>{entry.stage}</code><span>{entry.message}</span>{entry.progress !== undefined && <i>{Math.round(entry.progress * 100)}%</i>}{entry.output && <em>out: {entry.output}</em>}</div>) : <div className="global-task-terminal-empty">Chưa có tác vụ. Khi bấm chạy, log chi tiết sẽ xuất hiện ở đây ngay lập tức.</div>}
            </div>
          </section>
          {activeNav !== "recipes" && activeNav !== "preview" && <TabGuidePanel guide={tabGuides[activeNav] ?? tabGuides.overview} />}

          {activeNav === "overview" && (
            <>
              <section className="hero-grid">
                <div className="hero-card">
                  <div className="hero-copy">
                    <p className="eyebrow accent">TỰ ĐỘNG HÓA VIDEO</p>
                    <h3>Từ ý tưởng đến bàn giao,<br /><em>có kiểm soát.</em></h3>
                    <p>Điều phối slideshow 2D, video HTML, lồng tiếng, bản demo màn hình, cảnh AI và 3D trong một không gian làm việc cục bộ.</p>
                    <button className="primary-button" onClick={() => setActiveNav("recipes")}>Chọn quy trình video <span>→</span></button>
                  </div>
                  <div className="hero-orbit" aria-hidden="true"><div className="orbit-ring ring-one" /><div className="orbit-ring ring-two" /><div className="orbit-core">A3</div><span className="orbit-tag tag-one">Ý TƯỞNG</span><span className="orbit-tag tag-two">KẾT XUẤT</span><span className="orbit-tag tag-three">DUYỆT</span></div>
                </div>
                <div className="health-card">
                  <div className="section-heading"><div><p className="eyebrow">SỨC KHỎE HỆ THỐNG</p><h3>Trạng thái hệ thống</h3></div><span className="live-chip">ĐANG CHẠY</span></div>
                  <div className="health-list">
                    <HealthRow label="Dữ liệu SQLite cục bộ" value={health.database === "ready" ? "Hoạt động" : "Xem trước"} tone="green" />
                    <HealthRow label="Công cụ bên ngoài" value={health.externalTools === "not_checked" ? "Chưa kiểm tra" : health.externalTools} tone="amber" />
                    <HealthRow label="Tạo video qua cloud" value={snapshot.paidGenerationEnabled ? "Đã bật" : "Đã tắt"} tone="gray" />
                    <HealthRow label="Đăng bài" value={snapshot.publishEnabled ? "Đã bật" : "Đang khóa"} tone="red" />
                  </div>
                  <button className="text-button" onClick={() => setActiveNav("settings")}>Mở cài đặt công cụ <span>→</span></button>
                </div>
              </section>

              <section className="panel project-list-panel">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow accent">PROJECT WORKSPACES</p>
                    <h3>Danh sách dự án</h3>
                    <p className="section-subtitle">Chọn một dự án để mở đúng workspace, prompt, asset và lịch sử của dự án đó.</p>
                  </div>
                  <button className="primary-button" type="button" onClick={() => setShowProjectForm(true)}>＋ Dự án mới</button>
                </div>
                {projects.length === 0 ? (
                  <EmptyState label="Chưa có dự án" detail="Tạo dự án đầu tiên để bắt đầu một workspace video riêng." />
                ) : (
                  <div className="project-list-grid">
                    {projects.map((project) => (
                      <article className={`project-list-item ${project.projectId === selectedProjectId ? "selected" : ""}`} key={project.projectId}>
                        <div className="project-list-item-copy">
                          <span className="project-list-mark">A3</span>
                          <div>
                            <strong>{project.name}</strong>
                            <span>{project.workspaceRoot || "Workspace cục bộ"}</span>
                            <small>{project.projectId === selectedProjectId ? "Đang mở" : "Sẵn sàng mở workspace"} · {project.locale}</small>
                          </div>
                        </div>
                        <div className="project-list-item-actions">
                          <button
                            type="button"
                            className={project.projectId === selectedProjectId ? "secondary-button" : "primary-button"}
                            onClick={() => {
                              setSelectedProjectId(project.projectId);
                              setActiveNav("recipes");
                              setNotice(`Đã mở workspace “${project.name}”.`);
                            }}
                          >
                            {project.projectId === selectedProjectId ? "Mở lại workspace" : "Mở workspace"} →
                          </button>
                          <button type="button" className="small-button danger" onClick={() => void deleteProject(project)}>Xóa</button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="metrics-grid">
                <MetricCard label="Dự án" value={snapshot.projectCount} note="Không gian cục bộ" accent="blue" />
                <MetricCard label="Tác vụ hoàn tất" value={snapshot.jobCount} note="Lịch sử mô phỏng an toàn" accent="violet" />
                <MetricCard label="Quy trình" value={recipes.length} note="Danh mục đa định dạng" accent="orange" />
                <MetricCard label="Hồ sơ API" value={providers.length} note={`${providers.filter((provider) => provider.enabled).length} đang bật`} accent="green" />
              </section>

              <section className="content-grid">
                <div className="panel large-panel">
                  <div className="section-heading"><div><p className="eyebrow">BẮT ĐẦU TẠI ĐÂY</p><h3>Chọn một hướng sản xuất</h3></div><button className="text-button" onClick={() => setActiveNav("recipes")}>Xem tất cả <span>→</span></button></div>
                  <div className="recipe-mini-grid">{recipes.slice(0, 4).map((recipe) => <RecipeCard key={recipe.recipeKind} recipe={recipe} compact onRun={() => void runRecipe(recipe)} />)}</div>
                </div>
                <div className="panel activity-panel">
                  <div className="section-heading"><div><p className="eyebrow">HOẠT ĐỘNG GẦN ĐÂY</p><h3>Hoạt động gần đây</h3></div><span className="count-chip">{jobs.length}</span></div>
                  {jobs.length === 0 ? <EmptyState label="Chưa có job nào" detail="Tạo project và chạy mock recipe đầu tiên." /> : <div className="activity-list">{jobs.slice(0, 4).map((job) => <ActivityRow key={job.jobId} job={job} />)}</div>}
                </div>
              </section>
            </>
          )}

          {activeNav === "recipes" && <>
            <OnePromptWorkflowPanel
              projectId={selectedProjectId}
              projectName={selectedProject?.name ?? "Project workspace"}
              onCreateProject={() => setShowProjectForm(true)}
              workspaceRoot={selectedProject?.workspaceRoot ?? ""}
              topic={topic}
              loading={loading}
              cloudGenerationEnabled={snapshot.paidGenerationEnabled}
              localScriptReview={localScriptReview}
              videoSessions={videoWorkflowSessions}
              assets={assets}
              referenceSets={referenceSets}
              browserFlowWorkflow={browserFlowWorkflow}
              browserFlowBusy={browserHandoffBusy}
              promptObjective={contentGoal}
              additionalPrompt={additionalPrompt}
              onTopicChange={handleTopicInputChange}
              onActivity={(event) => recordWorkspaceActivity(event)}
              onNotice={setNotice}
              onGenerateScript={(approved, referenceContext) => generateLocalScript(approved, referenceContext)}
              onConnectGflowCli={connectGflowCliAccount}
              onStartBrowserFlowDiscovery={async (script, report, sessionId, autoGenerate, autoRunId) => startBrowserFlowDiscovery(script, report, sessionId, autoGenerate, autoRunId)}
              onLoadBrowserFlowWorkflow={(sessionId) => { if (sessionId) void loadLatestBrowserFlowWorkflow(selectedProjectId, sessionId); else setBrowserFlowWorkflow(null); }}
              onSaveSession={(input, announce) => saveVideoWorkflowSession(input, announce)}
              onDeleteSession={(sessionId) => void deleteVideoWorkflowSession(sessionId)}
              onChooseSource={chooseAssetSource}
              onImport={importAsset}
              onCreateReferenceSet={createReferenceSet}
              onAssignReference={assignReference}
              onDetachReference={detachReference}
              onOpenAdvanced={() => setShowProductionAdvanced(true)}
            />
            {showProductionAdvanced && <>
              <div className="production-advanced-heading"><strong>Quản lý nâng cao</strong><button type="button" className="secondary-button" onClick={() => setShowProductionAdvanced(false)}>Ẩn phần nâng cao</button></div>
              <PromptStudioPanel projectId={selectedProjectId} projectName={selectedProject?.name} presets={promptPresets} topic={topic} contentGoal={contentGoal} selectedProfileName={selectedTopicProfile?.name ?? ""} selectedAudience={selectedTopicProfile?.defaultAudience ?? ""} loading={loading} onActivity={(event) => recordWorkspaceActivity(event)} onNotice={setNotice} onCreate={(draft) => createPromptPreset(draft)} onUpdate={(presetId, draft) => updatePromptPreset(presetId, draft)} onArchive={(preset) => void changePromptPresetState(preset, "archive")} onRestore={(preset) => void changePromptPresetState(preset, "restore")} onApply={applyPromptPreset} />
              <AssetPackReviewPanel projectId={selectedProjectId} projectName={selectedProject?.name} packs={assetPackReviews} loading={loading} blenderBinding={assetPackBlenderBinding} blenderRun={assetPackBlenderRun} onChoosePack={chooseAssetPackSource} onRegisterPack={registerAssetPackSource} onReview={updateAssetPackItemReview} onPrepareBlenderBinding={prepareAssetPackBlenderBinding} onRunBlenderBinding={runAssetPackBlenderBinding} onNotice={setNotice} />
              <AssetReferencePanel projectName={selectedProject?.name} assets={assets} referenceSets={referenceSets} loading={loading} onChooseSource={chooseAssetSource} onImport={importAsset} onUpdateAsset={updateAssetMetadata} onAssetState={changeAssetState} onCreateSet={createReferenceSet} onUpdateSet={updateReferenceSet} onSetState={changeReferenceSetState} onAssign={assignReference} onDetach={detachReference} />
              <TopicWorkflowPanel profiles={topicProfiles} templates={availablePromptTemplates} selectedProfileId={selectedTopicProfile?.profileId ?? ""} selectedTemplateId={selectedPromptTemplateId} topic={topic} contentGoal={contentGoal} additionalPrompt={additionalPrompt} projectId={selectedProjectId} loading={loading} activityEvents={workspaceActivity} onActivity={(event) => recordWorkspaceActivity(event)} localScriptReview={localScriptReview} localVideoReport={localVideoReport} voiceSettings={voiceSettings} onProfileChange={selectTopicProfile} onTemplateChange={setSelectedPromptTemplateId} onTopicChange={handleTopicInputChange} onContentGoalChange={setContentGoal} onAdditionalPromptChange={setAdditionalPrompt} onPreview={() => void previewTopicWorkflow()} onGenerateScript={(approved) => void generateLocalScript(approved)} onRenderApprovedLocalVideo={(script, scriptPath) => void renderApprovedLocalVideo(script, scriptPath)} />
              <RecipeCatalog recipes={recipes} selectedRecipe={selectedRecipe} onSelect={setSelectedRecipe} onRun={(recipe) => void runRecipe(recipe)} onQueuePending={(recipe) => void queuePendingJob(recipe)} />
            </>}
          </>}
          {activeNav === "providers" && <ProviderCatalog providers={providers} envSnapshot={providerEnvSnapshot} cloudGenerationEnabled={snapshot.paidGenerationEnabled} onToggleCloudGeneration={() => void toggleCloudGeneration()} commandCodeReport={commandCodeReport} commandCodeTesting={commandCodeTesting} onTestCommandCode={() => void testCommandCode()} onAdded={(provider) => setProviders((current) => [provider, ...current])} onNotice={setNotice} />}
          {activeNav === "jobs" && <JobsPanel jobs={jobs} projects={projects} attempts={attempts} attemptOutputs={attemptOutputs} launchPlan={launchPlan} attemptJobId={attemptJobId} attemptExecutableId={attemptExecutableId} attemptOutputPath={attemptOutputPath} attemptMediaKind={attemptMediaKind} onAttemptExecutableChange={setAttemptExecutableId} onAttemptOutputPathChange={setAttemptOutputPath} onAttemptMediaKindChange={setAttemptMediaKind} onAction={(action, jobId) => void mutateJob(action, jobId)} onInspect={(jobId) => void inspectAttempts(jobId)} onPrepareAttempt={(jobId) => void prepareAttempt(jobId)} onStartMockAttempt={(attemptId, jobId) => void startMockAttempt(attemptId, jobId)} onPreviewLaunch={(attemptId) => void previewWorkerLaunch(attemptId)} />}
          {activeNav === "review" && <ReviewPanel preview={visualPlanPreview} onPreview={() => void previewNarrativeVisualPlan()} />}
          {activeNav === "settings" && <SettingsPanel health={health} readiness={readiness} loading={loading} projectId={selectedProjectId} fixtureReport={fixtureReport} blenderFixtureReport={blenderFixtureReport} true3dFixtureReport={true3dFixtureReport} true3dMultishotFixtureReport={true3dMultishotFixtureReport} assetPipelineCheckReport={assetPipelineCheckReport} onRunFfmpegFixture={(projectId) => void runFfmpegFixture(projectId)} onRunFfmpegFixtureAttempt={(projectId) => void runFfmpegFixtureAttempt(projectId)} onRunBlenderFixture={(projectId) => void runBlenderFixture(projectId)} onRunTrue3dFixture={(projectId, renderVideo) => void runTrue3dFixture(projectId, renderVideo)} onRunTrue3dMultishotFixture={(projectId, renderVideo, rerunShotId) => void runTrue3dMultishotFixture(projectId, renderVideo, rerunShotId)} onRunAssetPipelineCheck={(projectId) => void runAssetPipelineCheck(projectId)} onNotice={setNotice} onRefresh={() => void refresh()} />}
          {activeNav === "voice" && <OmniVoiceStudioPanel projectId={selectedProjectId} profiles={voiceProfiles} samples={voiceSamples} readiness={omnivoiceReadiness} report={omnivoiceReport} error={omnivoiceError} loading={loading} settings={voiceSettings} onSettingsChange={setVoiceSettings} onCheck={(projectId) => void checkOmniVoice(projectId)} onPrepareModel={(projectId) => void prepareOmniVoiceModel(projectId)} onChooseReference={chooseVoiceReference} onNotice={setNotice} onCreate={(input) => void createVoiceProfile(input)} onUpdate={(input) => void updateVoiceProfile(input)} onDelete={(profile) => void deleteVoiceProfile(profile)} onSynthesize={(input) => void runOmniVoiceTts(input)} />}
          {activeNav === "__legacy_voice__" && <VoiceStudioPanel report={vieneuReport} loading={loading} settings={voiceSettings} onSettingsChange={setVoiceSettings} />}
          {activeNav === "__legacy_vieneu__" && <VieneuPanel readiness={vieneuReadiness} report={vieneuReport} projectId={selectedProjectId} loading={loading} onCheck={(projectId) => void checkVieneu(projectId)} onRun={(projectId, text, voice, outputPath, referenceAudioPath, temperature, cloneConsent) => void runVieneuTts(projectId, text, voice, outputPath, referenceAudioPath, temperature, cloneConsent)} />}
          {activeNav === "preview" && <PreviewLibraryPanel
            projectId={selectedProjectId}
            projectName={selectedProject?.name ?? "Chưa chọn project"}
            loading={loading}
            platforms={previewPlatforms}
            maxResults={previewMaxResults}
            creatorUrl={previewCreatorUrl}
            urls={previewUrls}
            cards={previewCards}
            selectedPreviewId={selectedPreviewId}
            scanPlan={previewScanPlan}
            scanReport={previewScanReport}
            rightsStatus={previewRightsStatus}
            downloadReport={previewDownloadReport}
            onTogglePlatform={togglePreviewPlatform}
            onMaxResultsChange={setPreviewMaxResults}
            onCreatorUrlChange={setPreviewCreatorUrl}
            onUrlsChange={setPreviewUrls}
            onPlanScan={createPreviewScanPlan}
            onScanCreator={scanPreviewCreatorCatalog}
            onScanLicensed={scanLicensedFootage}
            onImportUrls={importPreviewUrls}
            onSelectPreview={selectPreviewCard}
            onReviewSelected={reviewSelectedPreview}
            onTogglePlan={togglePreviewPlan}
            onClear={clearPreviewLibrary}
            onRightsStatusChange={changePreviewRightsStatus}
            onDownloadSelected={() => void downloadSelectedReferenceVideo()}
            onContinueToSubtitles={continueDownloadedToSubtitles}
            onContinueToVoice={continueDownloadedToVoice}
          />}
                  {activeNav === "vision" && <VideoVisionPanel projectId={selectedProjectId} loading={loading} videoPath={videoVisionPath} outputPath={videoVisionOutputPath} sampleFps={videoVisionSampleFps} maxFrames={videoVisionMaxFrames} extractAudio={videoVisionExtractAudio} report={videoVisionReport} onVideoPathChange={setVideoVisionPath} onOutputPathChange={setVideoVisionOutputPath} onSampleFpsChange={setVideoVisionSampleFps} onMaxFramesChange={setVideoVisionMaxFrames} onExtractAudioChange={setVideoVisionExtractAudio} onChooseVideo={() => void chooseVideoVisionFile()} onAnalyze={() => void analyzeVideoVision()} />}

          {activeNav === "subtitles" && <SubtitleStudioPanel projectId={selectedProjectId} loading={loading} videoPath={subtitleVideoPath} subtitlePath={subtitlePath} outputPath={subtitleOutputPath} sourceLanguage={subtitleSourceLanguage} targetLanguage={subtitleTargetLanguage} format={subtitleFormat} document={subtitleDocument} probe={subtitleProbe} report={subtitleReport} burnInReport={subtitleBurnInReport} onVideoPathChange={setSubtitleVideoPath} onSubtitlePathChange={setSubtitlePath} onOutputPathChange={setSubtitleOutputPath} onSourceLanguageChange={setSubtitleSourceLanguage} onTargetLanguageChange={setSubtitleTargetLanguage} onFormatChange={setSubtitleFormat} onDocumentChange={setSubtitleDocument} onChooseVideo={() => void chooseSubtitleVideo()} onChooseSubtitle={() => void chooseSubtitleFile()} onProbe={() => void probeSubtitleVideo()} onLoad={() => void loadSubtitleDocument()} onSave={() => void saveSubtitleDocument()} onBurnIn={() => void burnInSubtitles()} onNotice={setNotice} />}
          {activeNav === "handoff" && <BrowserHandoffPanel projectId={selectedProjectId} loading={loading || browserHandoffBusy} runtimeReport={browserMcpRuntimeReport} autoFlowReport={chromeAutoFlowReport} onCheckSession={() => void checkBrowserMcpSession()} onOpenAutoFlow={() => void openAutoFlowWorkspace()} onProbeRuntime={() => void probeBrowserMcpRuntime()} />}
          {activeNav === "audit" && <AuditPanel events={auditEvents} onRefresh={() => void refresh()} />}
          {activeNav === "help" && <HelpPanel />}

          <footer className="app-footer"><span>Auto3Dvideo · Local-first control plane</span><span>Không tự đăng bài · Người dùng phải duyệt · {loading ? "Đang xử lý…" : "Sẵn sàng"}</span></footer>
        </main>
        {flowBatchApprovalRequest && (
          <div className="modal-backdrop flow-batch-approval-backdrop" role="presentation">
            <section
              className="modal-card flow-batch-approval-modal"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="flow-batch-approval-title"
              aria-describedby="flow-batch-approval-details"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  resolveFlowBatchApproval(false);
                }
              }}
            >
              <p className="eyebrow accent">GOOGLE FLOW · DUYỆT NGÂN SÁCH</p>
              <h3 id="flow-batch-approval-title">Xác nhận trần chi phí trước khi nhập prompt</h3>
              <p className="flow-batch-approval-cap">
                Nếu chọn duyệt, app có thể tiêu tối đa {flowBatchApprovalRequest.totalCreditCap} credit cho batch này.
                Chưa có prompt nào được nhập và chưa có Generate nào được bấm.
              </p>
              <pre id="flow-batch-approval-details">{flowBatchApprovalRequest.message}</pre>
              <div className="flow-batch-approval-actions">
                <button type="button" className="secondary-button" autoFocus onClick={() => resolveFlowBatchApproval(false)}>Hủy, chưa nhập prompt</button>
                <button type="button" className="primary-button" onClick={() => resolveFlowBatchApproval(true)}>
                  Duyệt tối đa {flowBatchApprovalRequest.totalCreditCap} credit và tiếp tục
                </button>
              </div>
            </section>
          </div>
        )}

        {showProjectForm && <div className="modal-backdrop" role="presentation" onClick={() => setShowProjectForm(false)}><div className="modal-card project-modal-card" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title" onClick={(event) => event.stopPropagation()}><div className="section-heading"><div><p className="eyebrow">KHÔNG GIAN LÀM VIỆC CỤC BỘ</p><h3 id="project-dialog-title">Tạo dự án mới</h3></div><button className="icon-button" onClick={() => setShowProjectForm(false)}>×</button></div><p className="modal-description">Dự án lưu thông tin mô tả vào SQLite cục bộ. Tệp phương tiện sẽ nằm trong không gian làm việc bạn chọn.</p><label>Tên dự án<input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label><label>Đường dẫn không gian làm việc<div className="workspace-picker-field"><input value={workspaceRoot} onChange={(event) => setWorkspaceRoot(event.target.value)} aria-label="Đường dẫn không gian làm việc" /><button type="button" className="secondary-button compact-button" onClick={() => void chooseWorkspace()}>Browse</button></div></label><label>Chủ đề / ý tưởng<textarea rows={3} value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Ví dụ: Vì sao cực quang xuất hiện?" /></label><label>Profile nội dung<select value={selectedTopicProfileId} onChange={(event) => selectTopicProfile(event.target.value)}>{topicProfiles.map((profile) => <option value={profile.profileId} key={profile.profileId}>{profile.name}</option>)}</select></label><p className="attempt-note">Prompt nội dung chi tiết sẽ được xem và chỉnh trong tab <strong>Quy trình video</strong>, mục Topic Studio.</p><div className="modal-actions"><button className="secondary-button" onClick={() => setShowProjectForm(false)}>Hủy</button><button className="primary-button" onClick={() => void createProject()} disabled={loading}>Tạo dự án cục bộ</button></div></div></div>}
      </div>
    );
}

export default App;
