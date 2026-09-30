import type { AssetView } from "../assets/assetTypes";
import type { BrowserFlowVisualEvaluationReport } from "../browserflow/browserFlowTypes";
import type { LocalScriptDocument } from "../shared/scriptTypes";
import type { WorkspaceActivityState } from "../shared/workspaceActivityTypes";
import type { ProcessRunSummary } from "../../processTypes";
import type { ReferenceAssignment } from "../assets/assetTypes";
import type { CanvasGraph } from "../workspace/canvasGraph";

export type FlowImageReviewRequest = {
  shotId: string;
  revisionId: string;
  attempt: number;
  asset: AssetView;
  remainingShots: number;
  evaluation?: BrowserFlowVisualEvaluationReport | null;
};

export type NanoBananaImageGenerationReport = {
  runId: string;
  status: string;
  reportPath: string;
  outputDirectory: string;
  generatedAssets: AssetView[];
  taskCount: number;
  readyCount: number;
  failedCount: number;
  process: ProcessRunSummary;
  message: string;
  failureCode?: string | null;
  failureDetail?: string | null;
  cdpPreflight?: {
    endpoint: string;
    status: string;
    httpStatus: number | null;
    message: string;
    networkProbePerformed: boolean;
    sideEffectsStarted: boolean;
  } | null;
};

export type ChromeCdpLaunchReport = {
  endpoint: string;
  status: string;
  browserPath: string | null;
  profileDirectory: string;
  launched: boolean;
  needsLogin: boolean;
  flowGroupName: string;
  flowGroupControllerLoaded: boolean;
  flowTargetCount: number;
  selectedFlowUrl: string | null;
  message: string;
};

export type GoogleFlowPlaywrightReport = {
  status: string;
  projectUrl: string;
  targetUrl: string | null;
  mode: string;
  reportPath: string;
  screenshotPath: string | null;
  editorFound: boolean;
  promptAccepted: boolean;
  generateClicked: boolean;
  referenceAttached?: boolean;
  sourceMediaId?: string | null;
  downloadStarted: boolean;
  downloadName: string | null;
  downloadSizeBytes: number | null;
  observed: Record<string, unknown> | null;
  message: string;
  process: ProcessRunSummary;
};

export type FlowImageCard = {
  mediaId: string;
  label: string;
  preview: string | null;
  previewAvailable: boolean;
  previewNote: string;
  selectable: boolean;
};

export type GoogleFlowImageCardsReport = {
  status: string;
  projectId: string;
  projectUrl: string;
  flowProjectId: string;
  targetUrl: string | null;
  reportPath: string;
  cards: FlowImageCard[];
  duplicateMediaIds: string[];
  truncated: boolean;
  message: string;
};

export type ShotReferenceFlowPreflight = {
  ready: boolean;
  projectId: string;
  segmentId: string;
  referenceSetId: string;
  assignmentId: string;
  assetId: string;
  assetSha256: string;
  role: string;
  relativePath: string | null;
  // Re-read from the bytes currently on disk under this project's workspace.
  // A null value means the file could not be hashed, which blocks the bind.
  currentSha256: string | null;
  assetStatus: string;
  rightsStatus: string;
  assignmentApproved: boolean;
  referenceSetStatus: string;
  reasons: string[];
  message: string;
};

const NANO_BANANA_SUCCESS_STATUSES = new Set(["succeeded", "succeeded_needs_review"]);

export function isNanoBananaGenerationSuccessful(report: NanoBananaImageGenerationReport, expectedTaskCount?: number): boolean {
  const taskCount = expectedTaskCount ?? report.taskCount;
  return NANO_BANANA_SUCCESS_STATUSES.has(report.status)
    && taskCount > 0
    && report.taskCount === taskCount
    && report.readyCount === taskCount
    && report.failedCount === 0
    && report.generatedAssets.length === taskCount
    && report.generatedAssets.every((asset) => Boolean(asset.assetId && asset.relativePath));
}

export function nanoBananaReportFailureState(report: NanoBananaImageGenerationReport): WorkspaceActivityState {
  return report.status === "failed" || report.status === "error" ? "error" : "blocked";
}

type NanoBananaProgressEvent = {
  schemaVersion?: string;
  runId?: string;
  createdAt?: string;
  stage?: string;
  state?: string;
  message?: string;
  progress?: number;
  taskIndex?: number;
  taskCount?: number;
  shotId?: string;
};

export type NanoBananaProgressReport = {
  runId: string;
  exists: boolean;
  progressPath: string;
  events: NanoBananaProgressEvent[];
};

export type BlenderShotPreviewReport = {
  scenePath: string;
  manifestPath: string;
  previewPath: string;
  shotPreviewPaths?: string[];
  editPlanPath?: string;
  videoPath?: string;
  shotCount: number;
  frameRange: [number, number];
  process: ProcessRunSummary;
  status: string;
  message: string;
  storyboardMode?: string;
  omniInstruction?: string;
  heroBinding?: { assetKind: string; status: string; subject?: string; scaleMeters?: number; lengthMeters?: number | null; massKg?: number | null; scaleMultiplier?: number | null; path?: string | null; note?: string };
};

export type ShotReferenceBinding = {
  segmentId: string;
  referenceSetId: string;
  assignmentId: string;
  assetId: string;
  assetSha256: string;
  role: ReferenceAssignment["role"];
  flowProjectId?: string;
  flowMediaId?: string;
  confirmedAt?: string;
  confirmationKind?: "manual_visual";
};

export type VideoWorkflowSession = {
  schemaVersion: string;
  sessionId: string;
  projectId: string;
  sessionDirectory: string;
  name: string;
  topic: string;
  title: string;
  durationSeconds: number | null;
  status: "draft" | "storyboard_ready" | "preview_ready" | "gemini_ready" | "handoff_ready" | string;
  lastStep: string;
  updatedAt: string;
  script: LocalScriptDocument | null;
  referenceAssetPaths: string[];
  geminiAssetPaths: string[];
  comfyuiAssetPaths: string[];
  blenderPreview: BlenderShotPreviewReport | null;
  canvasGraph?: CanvasGraph | null;
  shotReferenceBindings?: ShotReferenceBinding[] | null;
};

export type VideoWorkflowSessionInput = {
  projectId: string;
  sessionId?: string | null;
  name: string;
  topic: string;
  title: string;
  durationSeconds: number | null;
  status: string;
  lastStep: string;
  script: LocalScriptDocument | null;
  referenceAssetPaths: string[];
  geminiAssetPaths: string[];
  comfyuiAssetPaths: string[];
  blenderPreview: BlenderShotPreviewReport | null;
  canvasGraph?: CanvasGraph | null;
  shotReferenceBindings?: ShotReferenceBinding[] | null;
};

type StudioFlowNodeState = "waiting" | "ready" | "running" | "done" | "blocked";

export type StudioFlowNode = {
  id: string;
  eyebrow: string;
  title: string;
  detail: string;
  state: StudioFlowNodeState;
  actionLabel?: string;
  preview?: StudioFlowMediaPreview;
};

export type StudioFlowMediaPreview = {
  kind: "image" | "video";
  url: string;
  title: string;
  detail: string;
};

export const studioFlowStateLabels: Record<StudioFlowNodeState, string> = {
  waiting: "CHỜ INPUT",
  ready: "SẴN SÀNG",
  running: "ĐANG CHẠY",
  done: "ĐÃ XONG",
  blocked: "BỊ CHẶN",
};

export const studioFlowNodeCatalog = [
  { id: "text-to-image", label: "Text to Image", detail: "Tạo ảnh phác từ prompt" },
  { id: "image-to-image", label: "Image to Image", detail: "Biến đổi theo ảnh tham chiếu" },
  { id: "image-to-video", label: "Image to Video", detail: "Dùng ảnh làm đầu vào chuyển động" },
  { id: "text-to-video", label: "Text to Video", detail: "Gửi prompt trực tiếp cho provider video" },
  { id: "start-end-frame", label: "Start / End Frame", detail: "Khóa khung đầu và cuối shot" },
  { id: "voiceover", label: "Voiceover", detail: "Gắn voice profile và lời dẫn" },
  { id: "compose", label: "Compose / Edit", detail: "Ghép các shot thành timeline" },
  { id: "output", label: "Review / Output", detail: "Preview, review và nhập file local" },
];

export const studioFlowDotPositions = [
  { left: "7%", top: "18%" }, { left: "18%", top: "63%" }, { left: "31%", top: "30%" },
  { left: "43%", top: "76%" }, { left: "54%", top: "18%" }, { left: "66%", top: "58%" },
  { left: "78%", top: "28%" }, { left: "90%", top: "70%" }, { left: "35%", top: "48%" },
];
