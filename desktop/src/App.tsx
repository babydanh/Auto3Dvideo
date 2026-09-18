import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";

type AppSnapshot = {
  appVersion: string;
  locale: string;
  projectCount: number;
  jobCount: number;
  publishEnabled: boolean;
  paidGenerationEnabled: boolean;
};

type HealthStatus = {
  database: string;
  externalTools: string;
  publishPolicy: string;
  locale: string;
};

type ToolReadinessItem = {
  toolId: string;
  executableRef: string;
  required: boolean;
  configured: boolean;
  available: boolean;
  status: string;
};

type ToolReadinessReport = {
  status: string;
  requiredMissing: string[];
  tools: ToolReadinessItem[];
  externalProcessesStarted: boolean;
  networkProbePerformed: boolean;
  allowShellWrapper: boolean;
  rejectPathsOutsideProject: boolean;
  workerExecutionEnabled: boolean;
  workerGate: string;
};

type WorkerPreflightReport = {
  readyToStart: boolean;
  blockers: string[];
  checks: string[];
  externalProcessesStarted: boolean;
  networkProbePerformed: boolean;
  publishEnabled: boolean;
  paidGenerationEnabled: boolean;
};

type WorkerLaunchPlan = {
  attemptId: string;
  jobId: string;
  attemptNumber: number;
  state: string;
  executableId: string | null;
  timeoutSeconds: number;
  expectedOutputCount: number;
  canStart: boolean;
  blockers: string[];
  processStarted: boolean;
  externalSideEffectUnknown: boolean;
};

type Project = {
  projectId: string;
  name: string;
  locale: string;
  workspaceRoot: string;
  policyProfile: string;
  updatedAt: string;
};

type Job = {
  jobId: string;
  projectId: string;
  kind: string;
  state: string;
  progress: number;
  attemptCount: number;
  createdAt: string;
};

type Attempt = {
  attemptId: string;
  jobId: string;
  attemptNumber: number;
  state: string;
  executableId: string | null;
  executionMode: "external_process" | "in_process_mock";
  timeoutSeconds: number;
  processStarted: boolean;
  externalSideEffectUnknown: boolean;
  createdAt: string;
  updatedAt: string;
};

type ExecutableId = "blender" | "ffmpeg" | "ffprobe" | "node" | "obs" | "python";
type MediaKind = "video" | "audio" | "image" | "subtitle" | "thumbnail" | "metadata" | "image_sequence";

type PendingOutputSpec = {
  relativePath: string;
  mediaKind: MediaKind;
};

type AttemptOutput = {
  outputId: string;
  attemptId: string;
  relativePath: string;
  mediaKind: string;
  validationState: string;
  validationMessage: string | null;
};

type AuditEvent = {
  eventId: string;
  projectId: string | null;
  eventType: string;
  subjectType: string | null;
  subjectId: string | null;
  createdAt: string;
};

type WorkspaceActivityState = "running" | "success" | "info" | "waiting_user" | "error" | "blocked" | "cancelled";

type WorkspaceActivityEvent = {
  eventId: string;
  timestamp: string;
  stage: string;
  tool: string;
  state: WorkspaceActivityState;
  message: string;
  progress?: number;
  durationMs?: number;
  output?: string;
  nextAction?: string;
};

type Recipe = {
  recipeKind: string;
  name: string;
  worker: string;
  localFirst: boolean;
  requiresApproval: boolean;
};

type TopicAssetPolicy = {
  requiresProvenance: boolean;
  rejectIrrelevantCandidates: boolean;
  requiresHumanReview: boolean;
  allowedSources: string[];
};

type TopicProfile = {
  profileId: string;
  name: string;
  description: string;
  defaultRecipeKind: string;
  visualMode: string;
  defaultAudience: string;
  shotStrategy: string;
  assetPolicy: TopicAssetPolicy;
  qaChecklist: string[];
  promptTemplateIds: string[];
};

type PromptTemplate = {
  templateId: string;
  version: string;
  name: string;
  purpose: string;
  locale: string;
  body: string;
  inputKeys: string[];
  outputContract: string[];
  guardrails: string[];
};

type PromptPreset = {
  schemaVersion: string;
  presetId: string;
  projectId: string;
  name: string;
  description: string;
  scope: "project" | "user";
  status: "draft" | "active" | "archived";
  version: string;
  template: string;
  variableKeys: string[];
  negativeTemplate: string;
  providerTargets: string[];
  styleBibleId: string | null;
  rightsLicenseNote: string;
  parentPresetId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

type PromptPresetDraft = {
  name: string;
  description: string;
  scope: "project" | "user";
  status: "draft" | "active";
  version: string;
  template: string;
  variableKeys: string[];
  negativeTemplate: string;
  providerTargets: string[];
  styleBibleId: string | null;
  rightsLicenseNote: string;
  parentPresetId: string | null;
};

type AssetView = {
  schemaVersion: string;
  assetId: string;
  projectId: string;
  title: string;
  relativePath: string;
  sha256: string;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  status: "ready" | "quarantined" | "missing" | "archived";
  rightsStatus: "unknown" | "pending" | "personal" | "owned" | "licensed" | "public_domain" | "restricted" | "rejected";
  sourceUri: string | null;
  tags: string[];
  note: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

type FlowImageReviewRequest = {
  shotId: string;
  revisionId: string;
  attempt: number;
  asset: AssetView;
  remainingShots: number;
  evaluation?: BrowserFlowVisualEvaluationReport | null;
};

type BrowserFlowVisualEvaluationReport = {
  status: string;
  shotId: string;
  revisionId: string;
  model: string;
  decision: "pass" | "revise" | "needs_review";
  overallScore: number | null;
  confidence: number | null;
  criteria: Record<string, number>;
  flags: string[];
  revisionInstruction: string;
  summary: string;
  imagePath: string;
  imageSha256: string;
  reportPath: string;
  networkCallsMade: boolean;
  costStatus: string;
  humanReviewRequired: boolean;
  message: string;
};

type AssetPackAcceptanceCheck = {
  checkId: string;
  description?: string;
  required?: boolean;
  status: "pending" | "pass" | "fail" | "not_applicable";
  evidence?: string | null;
};

type AssetPackReviewItem = {
  assetItemId: string;
  title: string;
  identityAnchorId: string | null;
  role: string;
  status: string;
  reviewState: "not_started" | "in_review" | "approved" | "rejected" | "needs_revision";
  rightsStatus: AssetView["rightsStatus"];
  prompt: string;
  negativePrompt: string;
  shotIds: string[];
  requiredViews: string[];
  scaleMeters: number | null;
  outputAssetIds: string[];
  outputPaths: string[];
  outputAssets: AssetView[];
  acceptanceChecks: AssetPackAcceptanceCheck[];
  generationAttempts: Array<Record<string, unknown>>;
  note: string;
};

type AssetPackReview = {
  schemaVersion: string;
  projectId: string;
  packId: string;
  title: string;
  status: string;
  source: { packRelativePath: string; itemsRelativePath: string; reportRelativePath: string | null };
  acceptancePolicy: Record<string, unknown>;
  items: AssetPackReviewItem[];
  report: { relativePath: string; status: string; runId: string; itemCounts: Record<string, number>; errors: Array<Record<string, unknown>> } | null;
  createdAt: string;
  updatedAt: string;
};

type AssetPackBlenderBindingReport = {
  schemaVersion: string;
  bindingId: string;
  projectId: string;
  packId: string;
  status: "ready_for_blender_review" | "blocked" | "needs_review";
  bindingPath: string | null;
  jobPath: string | null;
  assetCount: number;
  shotIds: string[];
  worldScaleMeters: number | null;
  approvedReferenceHashes: string[];
  blockers: string[];
  blenderExecutionStarted: boolean;
  humanReviewRequired: boolean;
  message: string;
};

type AssetPackBlenderBindingRunReport = {
  bindingId: string;
  status: string;
  scenePath: string;
  previewOutputs: string[];
  reportPath: string;
  process: { exitCode: number | null; succeeded: boolean; timedOut: boolean; stderr: string; stdout: string };
  message: string;
};

type AssetPreviewView = {
  relativePath: string;
  mimeType: string;
  base64Data: string;
};

type PreviewPlatform = "tiktok" | "douyin" | "kuaishou" | "xiaohongshu" | "bilibili" | "xigua" | "huoshan" | "weishi" | "haokan" | "wikimedia";
type PreviewScanStatus = "idle" | "planned" | "success" | "blocked";
type PreviewRadarBucket = "all" | "potential" | "hot_new" | "rising" | "low_clone" | "fresh" | "unranked";
type PreviewReuseStatus = "permission_required" | "license_candidate" | "user_confirmed";
type PreviewReviewStatus = "unreviewed" | "keep" | "skip";
type PreviewTopic = "knowledge" | "story" | "nature" | "technology" | "lifestyle" | "entertainment" | "sports" | "other";

type VideoPreviewCard = {
  previewId: string;
  platform: PreviewPlatform;
  title: string;
  author: string;
  shareUrl: string;
  embedUrl: string | null;
  thumbnailUrl: string | null;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  licenseName?: string | null;
  licenseUrl?: string | null;
  sourceKind?: string | null;
  potentialScore?: number | null;
  potentialEvidence?: string | null;
  topic?: PreviewTopic | null;
  topicEvidence?: string | null;
  scannedAt: string;
  addedToPlan: boolean;
  radarBuckets?: Exclude<PreviewRadarBucket, "all">[];
  rankingEvidence?: string;
  reuseStatus?: PreviewReuseStatus;
  reuseEvidence?: string;
  reviewStatus?: PreviewReviewStatus;
  reviewNote?: string;
};

type PreviewScanPlan = {
  platforms: PreviewPlatform[];
  maxResults: number;
  scanMode: "discovery_all" | "creator_catalog" | "licensed_footage";
  previewOnly: boolean;
  worker: string;
  status: PreviewScanStatus;
  createdAt: string;
};

type PreviewPlatformScanResult = {
  platform: PreviewPlatform;
  status: "success" | "empty" | "blocked" | "waiting_user" | "error" | string;
  scannedCount: number;
  discoveryUrl: string;
  message: string;
};

type PreviewScanReport = {
  runId: string;
  status: "success" | "partial" | "blocked" | "failed" | string;
  worker: string;
  scanMode: "discovery_all" | "creator_catalog" | "licensed_footage" | string;
  previewOnly: boolean;
  platforms: PreviewPlatform[];
  maxResults: number;
  platformResults: PreviewPlatformScanResult[];
  cards: VideoPreviewCard[];
  reportPath?: string;
  browserSessionAttached?: boolean;
  networkCallsMade?: boolean;
  engine?: string;
  fallbackReason?: string;
  obscuraOutputBytes?: number;
  message: string;
};

const MAX_PREVIEW_CARDS = 2_000;

const previewPlatformOptions: Array<{ value: PreviewPlatform; label: string; host: string }> = [
  { value: "tiktok", label: "TikTok", host: "tiktok.com" },
  { value: "douyin", label: "Douyin", host: "douyin.com" },
  { value: "kuaishou", label: "Kuaishou", host: "kuaishou.com" },
  { value: "xiaohongshu", label: "Xiaohongshu", host: "xiaohongshu.com" },
  { value: "bilibili", label: "Bilibili", host: "bilibili.com" },
  { value: "xigua", label: "Xigua / 西瓜视频", host: "ixigua.com" },
  { value: "huoshan", label: "Huoshan / 火山版", host: "huoshan.com" },
  { value: "weishi", label: "Weishi / 微视", host: "weishi.qq.com" },
  { value: "haokan", label: "Haokan / 好看视频", host: "haokan.baidu.com" },
];

const previewLicensedSourceOptions: Array<{ value: PreviewPlatform; label: string; host: string }> = [
  { value: "wikimedia", label: "Wikimedia Commons", host: "commons.wikimedia.org" },
];

const previewTopicOptions: Array<{ value: "all" | PreviewTopic; label: string }> = [
  { value: "all", label: "Tất cả chủ đề" },
  { value: "knowledge", label: "Kiến thức" },
  { value: "story", label: "Kể chuyện" },
  { value: "nature", label: "Thiên nhiên" },
  { value: "technology", label: "Công nghệ" },
  { value: "lifestyle", label: "Đời sống" },
  { value: "entertainment", label: "Giải trí" },
  { value: "sports", label: "Thể thao" },
  { value: "other", label: "Khác" },
];

const previewRadarBucketOptions: Array<{ value: PreviewRadarBucket; label: string; detail: string }> = [
  { value: "all", label: "Tất cả", detail: "Toàn bộ video worker trả về" },
  { value: "potential", label: "Tiềm năng", detail: "Điểm phù hợp để lồng voice/edit" },
  { value: "hot_new", label: "Hot mới", detail: "Mới, nổi bật và ít tín hiệu trùng" },
  { value: "rising", label: "Đang tăng", detail: "Tương tác tăng nhanh" },
  { value: "low_clone", label: "Ít trùng lượt quét", detail: "Heuristic từ title/thumbnail trong tập này" },
  { value: "fresh", label: "Mới đăng", detail: "Ưu tiên thời gian đăng mới" },
  { value: "unranked", label: "Chưa đủ dữ liệu", detail: "Chưa có metadata để xếp nhóm" },
];

function previewPlatformLabel(platform: PreviewPlatform) {
  return [...previewPlatformOptions, ...previewLicensedSourceOptions].find((item) => item.value === platform)?.label ?? platform;
}

function isPreviewPlatform(value: string): value is PreviewPlatform {
  return [...previewPlatformOptions, ...previewLicensedSourceOptions].some((item) => item.value === value);
}

function previewRadarBucketLabel(bucket: PreviewRadarBucket) {
  return previewRadarBucketOptions.find((item) => item.value === bucket)?.label ?? bucket;
}

function previewTopicLabel(topic: "all" | PreviewTopic) {
  return previewTopicOptions.find((item) => item.value === topic)?.label ?? topic;
}

function previewTopicForCard(card: VideoPreviewCard): PreviewTopic {
  if (card.topic && previewTopicOptions.some((item) => item.value === card.topic)) return card.topic;
  const text = `${card.title} ${card.author}`.toLowerCase();
  if (/how|why|science|history|fact|knowledge|giải thích|kiến thức|lịch sử|vì sao|bí mật/.test(text)) return "knowledge";
  if (/story|storytime|documentary|document|câu chuyện|tư liệu|hành trình|sự thật/.test(text)) return "story";
  if (/nature|ocean|forest|animal|space|earth|nature|thiên nhiên|biển|rừng|động vật|vũ trụ/.test(text)) return "nature";
  if (/tech|robot|machine|ai|computer|công nghệ|robot|máy móc|kỹ thuật/.test(text)) return "technology";
  if (/food|travel|home|fashion|beauty|đời sống|ẩm thực|du lịch|nhà cửa|làm đẹp/.test(text)) return "lifestyle";
  if (/music|dance|comedy|funny|movie|game|giải trí|nhạc|nhảy|hài|game/.test(text)) return "entertainment";
  if (/sport|football|soccer|basketball|thể thao|bóng đá|bóng rổ/.test(text)) return "sports";
  return "other";
}

function previewRadarBuckets(card: VideoPreviewCard): Exclude<PreviewRadarBucket, "all">[] {
  const buckets = card.radarBuckets?.filter((bucket): bucket is Exclude<PreviewRadarBucket, "all"> => previewRadarBucketOptions.some((item) => item.value === bucket)) ?? [];
  return buckets.length ? buckets : ["unranked"];
}

function previewReuseStatus(card: VideoPreviewCard): PreviewReuseStatus {
  return card.reuseStatus === "user_confirmed" || card.reuseStatus === "license_candidate"
    ? card.reuseStatus
    : "permission_required";
}

function previewReuseStatusLabel(card: VideoPreviewCard) {
  const status = previewReuseStatus(card);
  return status === "user_confirmed" ? "Người dùng đã xác nhận" : status === "license_candidate" ? "Có license để kiểm tra" : "Cần xin quyền";
}

function previewReviewStatusLabel(status: PreviewReviewStatus) {
  return status === "keep" ? "Giữ lại" : status === "skip" ? "Bỏ qua" : "Chưa review";
}

function formatPreviewScannedAt(value: string) {
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? "không rõ thời gian" : date.toLocaleString("vi-VN");
}

function detectPreviewPlatform(url: URL): PreviewPlatform | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
  if (host === "douyin.com" || host.endsWith(".douyin.com") || host === "iesdouyin.com" || host.endsWith(".iesdouyin.com")) return "douyin";
  if (host === "kuaishou.com" || host.endsWith(".kuaishou.com")) return "kuaishou";
  if (host === "xiaohongshu.com" || host.endsWith(".xiaohongshu.com")) return "xiaohongshu";
  if (host === "bilibili.com" || host.endsWith(".bilibili.com")) return "bilibili";
  if (host === "ixigua.com" || host.endsWith(".ixigua.com") || host === "xigua.com" || host.endsWith(".xigua.com")) return "xigua";
  if (host === "huoshan.com" || host.endsWith(".huoshan.com")) return "huoshan";
  if (host === "weishi.qq.com" || host.endsWith(".weishi.qq.com")) return "weishi";
  if (host === "haokan.baidu.com" || host.endsWith(".haokan.baidu.com")) return "haokan";
  if (host === "commons.wikimedia.org" || host.endsWith(".commons.wikimedia.org") || host === "upload.wikimedia.org" || host.endsWith(".upload.wikimedia.org")) return "wikimedia";
  return null;
}

function isPreviewVideoUrl(value: string, platform?: PreviewPlatform) {
  try {
    const url = new URL(value);
    const path = url.pathname;
    const detectedPlatform = platform ?? detectPreviewPlatform(url);
    if (url.protocol !== "https:" || !detectedPlatform || (platform && detectedPlatform !== platform)) return false;
    if (detectedPlatform === "wikimedia") return /\/wiki\/File:[^/]+\.(?:webm|mp4|ogv|mov)(?:$|\/)/i.test(path);
    if (detectedPlatform === "tiktok") return /\/@[^/]+\/video\/\d{6,}/i.test(path) || /\/video\/\d{6,}/i.test(path);
    if (detectedPlatform === "douyin") return /\/(?:video|note)\/\d{6,}/i.test(path);
    if (detectedPlatform === "kuaishou") return /\/(?:short-video|photo)\/[a-z0-9_-]{6,}/i.test(path);
    if (detectedPlatform === "xiaohongshu") return /\/explore\/[a-z0-9_-]{12,}/i.test(path) || /\/discovery\/item\/[a-z0-9_-]{12,}/i.test(path);
    if (detectedPlatform === "bilibili") return /\/video\/(?:bv[a-z0-9]{6,20}|av\d{6,})/i.test(path) || /\/(?:bv[a-z0-9]{6,20}|av\d{6,})/i.test(path);
    if (detectedPlatform === "xigua") return /\/video\/\d{6,}/i.test(path) || /\/i\d{6,}/i.test(path);
    if (detectedPlatform === "huoshan") return /\/video\/\d{6,}/i.test(path);
    if (detectedPlatform === "weishi") return /\/(?:video|detail)\/[a-z0-9_-]{8,}/i.test(path);
    if (detectedPlatform === "haokan") return /\/(?:v|video)\/[a-z0-9_-]{8,}/i.test(path);
    return false;
  } catch {
    return false;
  }
}

function previewEmbedUrl(card: VideoPreviewCard) {
  if (card.embedUrl) return card.embedUrl;
  if (card.platform !== "tiktok") return null;
  const tiktokId = card.shareUrl.match(/\/video\/(\d+)/i)?.[1] ?? null;
  return tiktokId ? `https://www.tiktok.com/player/v1/${tiktokId}` : null;
}

function createVideoPreviewCard(rawUrl: string, allowedPlatforms: PreviewPlatform[] | null, index: number): VideoPreviewCard | null {
  try {
    const url = new URL(rawUrl.trim());
    if (url.protocol !== "https:") return null;
    const platform = detectPreviewPlatform(url);
    if (!platform || (allowedPlatforms && allowedPlatforms.length > 0 && !allowedPlatforms.includes(platform))) return null;
    if (!isPreviewVideoUrl(url.toString(), platform)) return null;
    const tiktokId = platform === "tiktok" ? url.pathname.match(/\/video\/(\d+)/i)?.[1] ?? null : null;
    const stableId = tiktokId ?? `${platform}-${url.hostname}-${url.pathname}-${index}`.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 120);
    return {
      previewId: `preview-${stableId}`,
      platform,
      title: "Chưa đọc tiêu đề",
      author: "Đang chờ browser scan",
      shareUrl: url.toString(),
      embedUrl: tiktokId ? `https://www.tiktok.com/player/v1/${tiktokId}` : null,
      thumbnailUrl: null,
      scannedAt: new Date().toISOString(),
      addedToPlan: false,
      radarBuckets: ["unranked"],
      rankingEvidence: "Chưa có metadata từ worker.",
      reuseStatus: "permission_required",
      reuseEvidence: "URL public không chứng minh quyền sao chép hoặc đăng lại.",
      reviewStatus: "unreviewed",
    };
  } catch {
    return null;
  }
}

function isVideoPreviewCard(value: unknown): value is VideoPreviewCard {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<VideoPreviewCard>;
  return typeof candidate.previewId === "string"
    && typeof candidate.platform === "string"
    && isPreviewPlatform(candidate.platform)
    && typeof candidate.title === "string"
    && typeof candidate.author === "string"
    && typeof candidate.shareUrl === "string"
    && isPreviewVideoUrl(candidate.shareUrl, candidate.platform)
    && (candidate.embedUrl === null || typeof candidate.embedUrl === "string")
    && (candidate.thumbnailUrl === null || typeof candidate.thumbnailUrl === "string")
    && typeof candidate.scannedAt === "string"
    && typeof candidate.addedToPlan === "boolean";
}

function WorkspaceMediaImage({ projectId, relativePath, src, alt, className }: { projectId: string; relativePath: string; src: string; alt: string; className?: string }) {
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [fallbackAttempted, setFallbackAttempted] = useState(false);

  useEffect(() => {
    setFallbackUrl(null);
    setFallbackAttempted(false);
  }, [projectId, relativePath, src]);

  async function loadNativeFallback() {
    if (fallbackAttempted || !projectId.trim()) return;
    setFallbackAttempted(true);
    try {
      const preview = await invoke<AssetPreviewView>("read_project_asset_preview", { projectId, relativePath });
      setFallbackUrl(`data:${preview.mimeType};base64,${preview.base64Data}`);
    } catch {
      // Keep the original source visible as the last diagnostic signal.
    }
  }

  return <img className={className} src={fallbackUrl ?? src} alt={alt} onError={() => void loadNativeFallback()} />;
}

type AssetMetadataDraft = {
  title: string;
  sourceUri: string;
  tags: string;
  note: string;
  rightsStatus: AssetView["rightsStatus"];
};

type ReferenceAssignment = {
  assignmentId: string;
  projectId: string;
  referenceSetId: string;
  assetId: string;
  role: "identity" | "composition" | "pose" | "camera" | "style" | "start_frame" | "end_frame" | "negative";
  strength: number;
  priority: number;
  shotId: string | null;
  shotRangeStart: number | null;
  shotRangeEnd: number | null;
  crop: string | null;
  notes: string;
  approved: boolean;
  assetSha256: string;
  createdAt: string;
  updatedAt: string;
};

type ReferenceSet = {
  schemaVersion: string;
  referenceSetId: string;
  projectId: string;
  name: string;
  scope: "sequence" | "character" | "object" | "world" | "shot";
  status: "active" | "archived";
  continuityNote: string;
  assignments: ReferenceAssignment[];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

type TopicPromptPreview = {
  profileId: string;
  profileName: string;
  templateId: string;
  templateVersion: string;
  renderedPrompt: string;
  selectedRecipeKind: string;
  visualMode: string;
  requiredHumanReview: boolean;
  networkCallsMade: boolean;
  paidGeneration: boolean;
  externalPublish: boolean;
  message: string;
};

type CommandCodeProbeReport = {
  status: string;
  httpStatus: number | null;
  model: string;
  responseText: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  networkCallsMade: boolean;
  costStatus: string;
  processStarted: boolean;
  externalSideEffectUnknown: boolean;
  message: string;
};

type LocalVideoPipelineReport = {
  status: string;
  runId: string;
  jobId: string;
  attemptId: string;
  scriptPath: string;
  sceneManifestPath: string;
  audioPath: string;
  captionsPath: string;
  videoPath: string;
  durationSeconds: number | null;
  networkCallsMade: boolean;
  costStatus: string;
  humanReviewRequired: boolean;
  message: string;
};

type VoiceCue = "none" | "laugh" | "sigh" | "clear_throat";
type VoiceEmotion =
  | "neutral" | "calm" | "warm" | "friendly" | "happy" | "excited" | "joyful" | "triumphant"
  | "sad" | "melancholic" | "tender" | "concerned" | "fearful" | "angry" | "shouting"
  | "urgent" | "serious" | "surprised" | "mysterious" | "curious" | "sarcastic" | "whisper";

const VOICE_EMOTION_OPTIONS: Array<{ code: VoiceEmotion; label: string; hint: string }> = [
  { code: "neutral", label: "Bình thường", hint: "đều, rõ" },
  { code: "calm", label: "Điềm tĩnh", hint: "chậm, ổn định" },
  { code: "warm", label: "Ấm áp", hint: "gần gũi" },
  { code: "friendly", label: "Thân thiện", hint: "tự nhiên" },
  { code: "happy", label: "Vui vẻ", hint: "sáng, vui" },
  { code: "excited", label: "Hào hứng", hint: "năng lượng cao" },
  { code: "joyful", label: "Phấn khởi", hint: "rộn ràng" },
  { code: "triumphant", label: "Chiến thắng", hint: "đầy khí thế" },
  { code: "sad", label: "Buồn", hint: "hạ giọng" },
  { code: "melancholic", label: "U sầu", hint: "trầm, kéo dài" },
  { code: "tender", label: "Dịu dàng", hint: "mềm, nhẹ" },
  { code: "concerned", label: "Lo lắng", hint: "căng nhẹ" },
  { code: "fearful", label: "Sợ hãi", hint: "run, dè chừng" },
  { code: "angry", label: "Giận dữ", hint: "mạnh, gắt" },
  { code: "shouting", label: "La lớn", hint: "nhấn mạnh" },
  { code: "urgent", label: "Khẩn cấp", hint: "dồn dập" },
  { code: "serious", label: "Nghiêm trọng", hint: "trang trọng" },
  { code: "surprised", label: "Bất ngờ", hint: "bật lên" },
  { code: "mysterious", label: "Bí ẩn", hint: "gợi tò mò" },
  { code: "curious", label: "Tò mò", hint: "hỏi, khám phá" },
  { code: "sarcastic", label: "Mỉa nhẹ", hint: "có sắc thái" },
  { code: "whisper", label: "Thì thầm", hint: "rất nhỏ" },
];

type VoiceSettings = {
  presetVoice: string;
  temperature: number;
  voiceCueBySegment: Record<string, VoiceCue>;
  emotionCodeBySegment?: Record<string, VoiceEmotion>;
  cloneEnabled: boolean;
  cloneConsent: boolean;
  referenceAudioPath?: string;
  voiceProfileId?: string;
  mode?: "clone" | "design";
  language?: string;
  instruct?: string;
  speed?: number;
  qualityPreset?: "preview" | "balanced" | "quality";
};

type LocalScriptBeat = {
  beatId: string;
  timeFraction: number;
  purpose: string;
  action: string;
  cameraPrompt: string;
  imageRole: "establish" | "action" | "reveal" | "resolve";
  prompt: string;
};

type LocalScriptSegment = {
  segmentId: string;
  narration: string;
  onScreenText: string;
  durationSeconds: number;
  claimStatus: "needs_review" | "verified" | "user_provided" | "not_applicable";
  sourceNote?: string | null;
  voiceCue?: VoiceCue;
  emotionCode?: VoiceEmotion;
  visualPrompt?: string;
  subject?: string;
  action?: string;
  cameraIntent?: string;
  lightingIntent?: string;
  continuityNotes?: string;
  negativePrompt?: string;
  sceneMode?: string;
  beats?: LocalScriptBeat[];
  revisionId?: string;
  revisionPrompt?: string;
  revisionImagePath?: string | null;
  dirty?: boolean;
};

type LocalScriptDocument = {
  schemaVersion: string;
  scriptId: string;
  briefId: string;
  language: string;
  title: string;
  hook: string;
  segments: LocalScriptSegment[];
  totalDurationSeconds: number;
  promptVersion?: string;
  sceneMode?: string;
  referenceAssetPaths?: string[];
  geminiAssetPaths?: string[];
  comfyuiAssetPaths?: string[];
  approvalStatus: "pending" | "approved" | "rejected";
  visualMode?: "space-25d" | "licensed-footage-space" | "cinematic-3d";
  footageManifestPath?: string;
  voiceSettings?: VoiceSettings;
  generatedAt?: string;
  requestedShotCount?: number;
  requestedDurationSeconds?: number;
  sourcePromptHash?: string;
};

type LocalScriptReviewReport = {
  status: string;
  runId: string;
  scriptPath: string;
  script: LocalScriptDocument;
  networkCallsMade: boolean;
  costStatus: string;
  humanReviewRequired: boolean;
  message: string;
};

type ProviderProfile = {
  profileId: string;
  capability: string;
  provider: string;
  model: string;
  endpointRef: string;
  enabled: boolean;
  configured: boolean;
  credentialRef: string;
};

type ProviderEnvProfile = {
  profileId: string;
  capability: string;
  provider: string;
  adapter: string;
  model: string;
  endpointRef: string;
  endpointConfigured: boolean;
  enabled: boolean;
  configured: boolean;
  credentialRef: string;
  credentialState: string;
  pricingMode: string;
  timeoutSeconds: number;
  maxAttempts: number;
  fallbackProfiles: string[];
  envPrefix: string;
  source: string;
  warnings: string[];
};

type ProviderRoutingProfile = {
  roleId: string;
  label: string;
  model: string;
  modelEnv: string;
  responsibility: string;
  trigger: string;
  inputArtifact: string;
  outputArtifact: string;
  configured: boolean;
  source: string;
};

type ProviderEnvSnapshot = {
  executionProfile: string;
  secretBackend: string;
  dotenvLoaded: boolean;
  dotenvSource: string;
  cloudRequestsBlocked: boolean;
  externalPublishBlocked: boolean;
  paidApprovalRequired: boolean;
  unknownCostPolicy: string;
  profiles: ProviderEnvProfile[];
  routing: ProviderRoutingProfile[];
  warnings: string[];
};

type MockRecipePreview = {
  recipeKind: string;
  stages: string[];
  paidGenerationBlocked: boolean;
  externalPublishBlocked: boolean;
  externalProcessesNotStarted: boolean;
  message: string;
};

type RecipeValidationResult = {
  valid: boolean;
  recipeId: string;
  recipeKind: string;
  errors: string[];
  warnings: string[];
  externalSideEffectsBlocked: boolean;
};

type JobAction = "retry_job" | "cancel_job";

type ProcessRunSummary = {
  executableId: string;
  exitCode: number | null;
  succeeded: boolean;
  timedOut: boolean;
  cancelled: boolean;
  terminationMode: string;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  externalSideEffectUnknown: boolean;
  outputEvidence: { relativePath: string; sizeBytes: number | null; validationState: string; validationMessage: string | null }[];
};

type ReferenceVideoDownloadReport = {
  downloadId: string;
  status: "succeeded" | "blocked" | "failed";
  projectId: string;
  sourceUrl: string;
  sourceHost: string;
  relativePath: string | null;
  asset: AssetView | null;
  sizeBytes: number | null;
  sha256: string | null;
  rightsStatus: AssetView["rightsStatus"];
  watermarkStatus: string;
  networkCallsMade: boolean;
  costStatus: string;
  humanReviewRequired: boolean;
  message: string;
  process: ProcessRunSummary | null;
};

type ExternalFixtureAttemptReport = {
  job: Job;
  attempt: Attempt;
  outputPath: string;
};

type LocalToolProbeReport = {
  toolId: string;
  executablePath: string;
  status: string;
  exitCode: number | null;
  version: string;
  stdoutBytes: number;
  stderrBytes: number;
  processStarted: boolean;
  externalSideEffectUnknown: boolean;
};

type ComfyUiHealthReport = {
  endpoint: string;
  status: string;
  httpStatus: number | null;
  message: string;
  networkProbePerformed: boolean;
  sideEffectsStarted: boolean;
};

type NanoBananaImageGenerationReport = {
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

type ChromeCdpLaunchReport = {
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

type GoogleFlowDomOutputReport = {
  status: string;
  projectUrl: string;
  targetUrl: string | null;
  reportPath: string;
  mediaCount: number;
  mediaIds: string[];
  historicalShotMediaIds: string[];
  historicalShotMediaCount: number;
  matchingBatchCount: number;
  matchingBatchMediaCount: number;
  matchingBatchMediaIds: string[];
  shotRevisionBatchCount: number;
  shotRevisionBatchMediaCount: number;
  shotRevisionBatchMediaIds: string[];
  assistantClaimsGenerated: boolean;
  generatedMessageCount: number;
  generationActive: boolean;
  downloadControlFound: boolean;
  downloadClicked: boolean;
  selectedModel: string;
  modelSelected: boolean;
  saved: boolean;
  composerFound: boolean;
  promptEditorFound: boolean;
  imageModeFound: boolean;
  message: string;
  process: ProcessRunSummary;
};

type GoogleFlowPlaywrightReport = {
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

const NANO_BANANA_SUCCESS_STATUSES = new Set(["succeeded", "succeeded_needs_review"]);

function isNanoBananaGenerationSuccessful(report: NanoBananaImageGenerationReport, expectedTaskCount?: number): boolean {
  const taskCount = expectedTaskCount ?? report.taskCount;
  return NANO_BANANA_SUCCESS_STATUSES.has(report.status)
    && taskCount > 0
    && report.taskCount === taskCount
    && report.readyCount === taskCount
    && report.failedCount === 0
    && report.generatedAssets.length === taskCount
    && report.generatedAssets.every((asset) => Boolean(asset.assetId && asset.relativePath));
}

function nanoBananaReportFailureState(report: NanoBananaImageGenerationReport): WorkspaceActivityState {
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

type NanoBananaProgressReport = {
  runId: string;
  exists: boolean;
  progressPath: string;
  events: NanoBananaProgressEvent[];
};

type LocalBlenderFixtureReport = {
  outputPath: string;
  sizeBytes: number;
  process: ProcessRunSummary;
};

type True3dFixtureReport = {
  runId: string;
  scenePath: string;
  manifestPath: string;
  qualityPath: string;
  previewPaths: string[];
  videoPath?: string | null;
  frameRange: [number, number];
  fps: number;
  objectCount: number;
  status: string;
  process: ProcessRunSummary;
  ffmpegProcess?: ProcessRunSummary | null;
  message: string;
};

type True3dMultishotFixtureReport = {
  runId: string;
  scenePath: string;
  sceneManifestPath: string;
  assetLibraryPath: string;
  assetBindingsPath: string;
  continuityReportPath: string;
  qualityPath: string;
  shotCount: number;
  renderedShotIds: string[];
  assetHashesUnchanged: boolean;
  rerunShotId?: string | null;
  status: string;
  process: ProcessRunSummary;
  message: string;
};

type AssetPipelineCheckReport = {
  runId: string;
  reportPath: string;
  bindingsPath: string;
  quarantinePath: string;
  qualityPath?: string | null;
  assetCount: number;
  readyCount: number;
  quarantinedCount: number;
  status: string;
  process: ProcessRunSummary;
  qualityProcess?: ProcessRunSummary | null;
  message: string;
};

type BlenderShotPreviewReport = {
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

type VideoWorkflowSession = {
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
};

type VideoWorkflowSessionInput = {
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
};

type NarrativeEntityPreview = {
  entityId: string;
  name: string;
  continuityMode: string;
  identityAnchors: string[];
};

type NarrativeVisualBeatPreview = {
  beatId: string;
  sequence: number;
  narrationText: string;
  startFrame: number;
  endFrame: number;
  durationFrames: number;
  narrativeClaim: string;
  visualIntent: string;
  setting: string;
  entities: NarrativeEntityPreview[];
  requiredVisualElements: string[];
  positivePrompt: string;
  negativePrompt: string;
  expectedAssetPath: string;
  candidateState: string;
  reviewDecision: string;
  semanticState: string;
  continuityState: string;
  rightsState: string;
};

type NarrativeVisualPlanPreview = {
  planId: string;
  projectId: string;
  episodeId: string;
  language: string;
  aspectRatio: string;
  frameRate: number;
  totalDurationFrames: number;
  beats: NarrativeVisualBeatPreview[];
  generationStarted: boolean;
  networkCallsMade: boolean;
  externalPublish: boolean;
  paidGeneration: boolean;
  humanReviewRequired: boolean;
  message: string;
};

type LocalMediaFixtureReport = {
  outputPath: string;
  sizeBytes: number;
  durationSeconds: number;
  streamCount: number;
  ffmpeg: ProcessRunSummary;
  ffprobe: ProcessRunSummary;
};

type SubtitleEntry = {
  entryId: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
  confidence?: number;
  sourceSegmentId?: string;
};

type SubtitleDocument = {
  schemaVersion: string;
  documentId: string;
  sourceVideoPath: string;
  sourceSubtitlePath?: string;
  sourceLanguage: string;
  targetLanguage: string;
  durationSeconds: number;
  format: "srt" | "vtt";
  entries: SubtitleEntry[];
  rightsStatus: "pending" | "user_owned" | "licensed" | "public_domain" | "blocked";
  reviewState: "draft" | "validated" | "needs_review" | "approved" | "blocked";
  networkCallsMade: boolean;
  costStatus?: string;
  notes?: string;
  validation?: { valid: boolean; warnings: string[]; maxCps: number };
};

type SubtitleDocumentReport = {
  status: string;
  document: SubtitleDocument | null;
  outputPath: string | null;
  outputSizeBytes: number | null;
  outputSha256: string | null;
  format: "srt" | "vtt" | null;
  networkCallsMade: boolean;
  costStatus: string;
  humanReviewRequired: boolean;
  message: string;
  process: ProcessRunSummary | null;
};

type SubtitleVideoProbeReport = {
  status: string;
  videoPath: string;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioPresent: boolean;
  networkCallsMade: boolean;
  costStatus: string;
  message: string;
  process: ProcessRunSummary;
};

type SubtitleBurnInReport = {
  status: string;
  videoPath: string;
  subtitlePath: string;
  outputPath: string;
  outputSizeBytes: number;
  outputSha256: string;
  durationSeconds: number | null;
  networkCallsMade: boolean;
  costStatus: string;
  humanReviewRequired: boolean;
  message: string;
  ffmpeg: ProcessRunSummary;
  ffprobe: ProcessRunSummary;
};

type VideoVisionEvidenceReport = {
  status: string;
  evidenceId: string;
  sourceVideoPath: string;
  outputPath: string;
  frameDir: string;
  audioPath: string | null;
  sourceSha256: string;
  durationSeconds: number;
  width: number;
  height: number;
  frameCount: number;
  shotCount: number;
  semanticVlm: boolean;
  transcriptAvailable: boolean;
  ocrAvailable: boolean;
  networkCallsMade: boolean;
  costStatus: string;
  humanReviewRequired: boolean;
  message: string;
  ffprobe: ProcessRunSummary;
  frameExtract: ProcessRunSummary;
  audioExtract: ProcessRunSummary | null;
  worker: ProcessRunSummary;
};

type BrowserHandoffReport = {
  status: string;
  handoffId: string;
  projectId: string;
  handoffPath: string;
  promptPath: string;
  inputAssets: { relativePath: string; mediaKind: string; sha256?: string; sizeBytes?: number }[];
  state: string;
  networkCallsMade: boolean;
  browserSessionAttached: boolean;
  uploadPerformed: boolean;
  generatePerformed: boolean;
  importPerformed: boolean;
  costStatus: string;
  humanReviewRequired: boolean;
  message: string;
  process: ProcessRunSummary;
};

type BrowserMcpRuntimeReport = {
  status: string;
  operation: string;
  reportPath: string;
  serverInfo: { name?: string; version?: string } | null;
  protocolVersion: string | null;
  toolCount: number;
  tools: string[];
  toolName: string | null;
  approved: boolean;
  browserSessionAttached: boolean;
  browserActionsPerformed: boolean;
  networkCallsMade: boolean;
  operationResult: { isError?: boolean; contentItemCount?: number; contentTypes?: string[]; textBytes?: number; hasImage?: boolean; uiRefCount?: number; uiRefs?: BrowserFlowUiRef[]; screenshotPath?: string; screenshotMimeType?: string; screenshotBytes?: number; screenshotSource?: string };
  message: string;
  process: ProcessRunSummary | null;
};

type BrowserMcpFreshState = {
  status: "unknown" | "attached" | "session-found" | "not-connected";
  uiRefCount: number;
  checkedAt: number;
};

type BrowserFlowAsset = {
  assetId: string;
  name: string;
  relativePath: string;
  mediaKind: string;
  role: string;
  processId: string;
};

type BrowserFlowFileBinding = {
  fileId: string;
  name: string;
  relativePath: string;
  kind: string;
  processId: string;
};

type BrowserFlowDownloadedFile = {
  downloadId: string;
  name: string;
  sourceRelativePath: string;
  relativePath: string;
  mediaKind: string;
  sha256: string;
  sizeBytes: number;
  importedAt: string;
  processId: string;
  runId?: string | null;
  shotId?: string | null;
  revisionId?: string | null;
  inputHash?: string | null;
};

type BrowserFlowDownloadImportReport = {
  status: string;
  workflow: BrowserFlowWorkflow;
  importedPath: string;
  sourceRelativePath: string;
  sha256: string;
  sizeBytes: number;
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
  asset?: AssetView | null;
  message: string;
};

type BrowserFlowDownloadEntry = {
  name: string;
  relativePath: string;
  mediaKind: string;
  sizeBytes: number;
  modifiedAt: string;
};

type BrowserFlowRouteStep = {
  stepId: string;
  name: string;
  operation: string;
  capability: string;
  state: string;
  requiresUser: boolean;
  toolName: string | null;
  note: string;
};

type BrowserFlowProcess = {
  processId: string;
  name: string;
  operation: string;
  state: string;
  stepIndex: number;
  startedAt: string;
  updatedAt: string;
  output: string | null;
  message: string;
  nextAction: string | null;
};

type BrowserFlowRoadmapItem = {
  milestoneId: string;
  name: string;
  status: string;
  dependsOn: string[];
  processId: string | null;
  evidence: string | null;
  nextAction: string;
};

type BrowserFlowUiRef = {
  role: string;
  label: string;
  reference: string;
};

type BrowserFlowProviderIdentity = {
  providerProjectKey: string;
  providerProjectLabel: string;
  currentUrl: string;
  evidenceHash: string;
  observedAt: string;
};

type BrowserFlowTargetBinding = {
  providerProjectKey: string;
  providerProjectLabel: string;
  pinnedUrl: string;
  evidenceHash: string;
  pinnedAt: string;
};

type BrowserFlowWorkflow = {
  schemaVersion: string;
  workflowId: string;
  projectId: string;
  name: string;
  provider: string;
  targetUrl: string;
  phase: string;
  discoveryStatus: string;
  discoveryPath: string | null;
  handoffId: string | null;
  sessionId: string | null;
  providerProjectIdentity?: BrowserFlowProviderIdentity | null;
  currentUrl?: string | null;
  projectEntryConfirmed?: boolean;
  pinnedBrowserTarget?: BrowserFlowTargetBinding | null;
  currentStep: number;
  route: BrowserFlowRouteStep[];
  roadmap: BrowserFlowRoadmapItem[];
  availableTools?: string[];
  uiRefs: BrowserFlowUiRef[];
  visualStatePath?: string | null;
  assets: BrowserFlowAsset[];
  files?: BrowserFlowFileBinding[];
  downloadedFiles?: BrowserFlowDownloadedFile[];
  processes: BrowserFlowProcess[];
  uiRefCount: number;
  browserSessionAttached: boolean;
  networkCallsMade: boolean;
  humanReviewRequired: boolean;
  lastMessage: string;
  updatedAt: string;
};

type BrowserFlowWorkflowReport = {
  status: string;
  workflow: BrowserFlowWorkflow;
  message: string;
};

type BrowserFlowAgentStepReport = {
  status: string;
  workflow: BrowserFlowWorkflow;
  model: string;
  action: { action?: string; ref?: string | null; textSource?: string; reason?: string; submit?: boolean; seconds?: number | null } | null;
  plannerReportPath: string | null;
  message: string;
};

type StudioFlowNodeState = "waiting" | "ready" | "running" | "done" | "blocked";

type StudioFlowNode = {
  id: string;
  eyebrow: string;
  title: string;
  detail: string;
  state: StudioFlowNodeState;
  actionLabel?: string;
  preview?: StudioFlowMediaPreview;
};

type StudioFlowMediaPreview = {
  kind: "image" | "video";
  url: string;
  title: string;
  detail: string;
};

const studioFlowStateLabels: Record<StudioFlowNodeState, string> = {
  waiting: "CHỜ INPUT",
  ready: "SẴN SÀNG",
  running: "ĐANG CHẠY",
  done: "ĐÃ XONG",
  blocked: "BỊ CHẶN",
};

const studioFlowNodeCatalog = [
  { id: "text-to-image", label: "Text to Image", detail: "Tạo ảnh phác từ prompt" },
  { id: "image-to-image", label: "Image to Image", detail: "Biến đổi theo ảnh tham chiếu" },
  { id: "image-to-video", label: "Image to Video", detail: "Dùng ảnh làm đầu vào chuyển động" },
  { id: "text-to-video", label: "Text to Video", detail: "Gửi prompt trực tiếp cho provider video" },
  { id: "start-end-frame", label: "Start / End Frame", detail: "Khóa khung đầu và cuối shot" },
  { id: "voiceover", label: "Voiceover", detail: "Gắn voice profile và lời dẫn" },
  { id: "compose", label: "Compose / Edit", detail: "Ghép các shot thành timeline" },
  { id: "output", label: "Review / Output", detail: "Preview, review và nhập file local" },
];

const studioFlowDotPositions = [
  { left: "7%", top: "18%" }, { left: "18%", top: "63%" }, { left: "31%", top: "30%" },
  { left: "43%", top: "76%" }, { left: "54%", top: "18%" }, { left: "66%", top: "58%" },
  { left: "78%", top: "28%" }, { left: "90%", top: "70%" }, { left: "35%", top: "48%" },
];

function StudioFlowNodeCard({ node, onAction, onPreview, disabled }: { node: StudioFlowNode; onAction?: () => void; onPreview?: (preview: StudioFlowMediaPreview) => void; disabled?: boolean }) {
  return <article className={`studio-flow-node studio-flow-node-${node.state}`} data-node-id={node.id}>
    <div className="studio-flow-node-top"><span className="studio-flow-node-dot" /><span>{node.eyebrow}</span><b>{studioFlowStateLabels[node.state]}</b></div>
    <h4>{node.title}</h4>
    <p>{node.detail}</p>
    {node.preview && <button type="button" className="studio-flow-node-preview" onClick={() => onPreview?.(node.preview!)} aria-label={`Mở preview ${node.preview.title}`}><span className="studio-flow-node-preview-media">{node.preview.kind === "video" ? <video muted preload="metadata" src={node.preview.url} /> : <img src={node.preview.url} alt={node.preview.title} />}</span><span className="studio-flow-node-preview-caption"><b>▶ Xem preview</b><small>{node.preview.title}</small></span></button>}
    {node.actionLabel && onAction && <button type="button" className="studio-flow-node-action" onClick={onAction} disabled={disabled}>{disabled ? "⏳ Đang xử lý…" : node.actionLabel}</button>}
    <span className="studio-flow-node-port studio-flow-node-port-in" aria-hidden="true" />
    <span className="studio-flow-node-port studio-flow-node-port-out" aria-hidden="true" />
  </article>;
}

type VieneuReadinessReport = {
  status: string;
  packageInstalled: boolean;
  packageVersion: string | null;
  modelId: string;
  backend: string;
  modelCachePath: string;
  modelCachePresent: boolean;
  modelDownloadRequested: boolean;
  networkCallsMade: boolean;
  processStarted: boolean;
  message: string;
};

type VieneuTtsReport = {
  outputPath: string;
  sizeBytes: number;
  modelId: string;
  voice: string;
  backend: string;
  precision: string;
  temperature: number;
  referenceAudioUsed: boolean;
  cloneConsent: boolean;
  modelDownloadRequested: boolean;
  networkCallsMade: boolean;
  humanReviewRequired: boolean;
  outputValidated: boolean;
  message: string;
  process: ProcessRunSummary;
};

type OmniVoiceReadinessReport = {
  status: string;
  packageInstalled: boolean;
  torchInstalled: boolean;
  modelId: string;
  audioTokenizerId: string;
  modelCachePath: string;
  modelCachePresent: boolean;
  device: string;
  modelDownloadRequested: boolean;
  networkCallsMade: boolean;
  processStarted: boolean;
  message: string;
  process: ProcessRunSummary;
};

type VoiceProfile = {
  voiceProfileId: string;
  projectId: string;
  name: string;
  mode: "clone" | "design";
  modelId: string;
  language: string;
  instruct: string | null;
  referenceAudioPath: string | null;
  referenceAudioSha256: string | null;
  referenceAudioDurationSeconds: number | null;
  referenceAudioSampleRate: number | null;
  referenceTranscript: string | null;
  rightsStatus: string;
  commercialUse: string;
  cloneConsent: boolean;
  status: string;
  lastPreviewPath: string | null;
  createdAt: string;
  updatedAt: string;
};

type VoiceSample = {
  relativePath: string;
  fileName: string;
  sourceKind: "sample" | "recording";
  sizeBytes: number;
  durationSeconds: number | null;
  sampleRate: number | null;
  modifiedUnixSeconds: number;
  transcript: string | null;
  license: string | null;
  sourceDataset: string | null;
};

type OmniVoiceTtsReport = {
  status: string;
  outputPath: string;
  sizeBytes: number;
  modelId: string;
  voiceProfileId: string;
  mode: "clone" | "design";
  language: string;
  durationSeconds: number | null;
  sampleRate: number | null;
  device: string;
  modelDownloadRequested: boolean;
  networkCallsMade: boolean;
  humanReviewRequired: boolean;
  outputValidated: boolean;
  emotionCodesUsed?: string[];
  emotionSegments?: number;
  emotionFallback?: string;
  message: string;
  process: ProcessRunSummary;
};

type ProcessDryRunPlan = {
  executableId: string;
  allowlistedBinaryName: string;
  argumentCount: number;
  argumentLengths: number[];
  workingDirectory: string;
  environmentKeys: string[];
  expectedOutputs: string[];
  timeoutSeconds: number;
  processStarted: boolean;
  sideEffectsBlocked: boolean;
  policyMessages: string[];
};

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

const fallbackVieneuReadiness: VieneuReadinessReport = {
  status: "not_checked",
  packageInstalled: false,
  packageVersion: null,
  modelId: "pnnbao-ump/VieNeu-TTS-v3-Turbo",
  backend: "onnx",
  modelCachePath: ".auto3dvideo/cache/huggingface",
  modelCachePresent: false,
  modelDownloadRequested: false,
  networkCallsMade: false,
  processStarted: false,
  message: "Chưa kiểm tra package VieNeu.",
};

const fallbackOmniVoiceReadiness: OmniVoiceReadinessReport = {
  status: "not_checked",
  packageInstalled: false,
  torchInstalled: false,
  modelId: "k2-fsa/OmniVoice",
  audioTokenizerId: "eustlb/higgs-audio-v2-tokenizer",
  modelCachePath: "D:/Auto3DvideoTools/omnivoice/cache",
  modelCachePresent: false,
  device: "unknown",
  modelDownloadRequested: false,
  networkCallsMade: false,
  processStarted: false,
  message: "Chưa kiểm tra OmniVoice local.",
  process: {
    executableId: "python",
    exitCode: null,
    succeeded: false,
    timedOut: false,
    cancelled: false,
    terminationMode: "not_started",
    stdoutBytes: 0,
    stderrBytes: 0,
    externalSideEffectUnknown: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    outputEvidence: [],
  },
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

type TabGuide = {
  eyebrow: string;
  title: string;
  purpose: string;
  steps: string[];
  note: string;
};

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

const fallbackRecipes: Recipe[] = [
  { recipeKind: "image_slideshow", name: "2D slideshow hình ảnh", worker: "FFmpeg / Remotion", localFirst: true, requiresApproval: true },
  { recipeKind: "html_to_video", name: "HTML / React thành video", worker: "Remotion", localFirst: true, requiresApproval: true },
  { recipeKind: "voiceover_package", name: "Lồng tiếng và phụ đề", worker: "Piper / TTS / Whisper", localFirst: true, requiresApproval: true },
  { recipeKind: "screen_demo", name: "Quay màn hình / demo", worker: "OBS / FFmpeg", localFirst: true, requiresApproval: true },
  { recipeKind: "hybrid_2d_3d", name: "Hybrid 2D–3D", worker: "Blender + Remotion", localFirst: true, requiresApproval: true },
  { recipeKind: "true_3d", name: "True 3D Blender", worker: "Blender CLI/Python", localFirst: true, requiresApproval: true },
];

const fallbackTopicProfiles: TopicProfile[] = [
  { profileId: "science-explainer", name: "Khoa học / giải thích", description: "Claim, nguồn, biểu đồ và minh họa có căn cứ.", defaultRecipeKind: "html_to_video", visualMode: "editorial-data", defaultAudience: "Người xem phổ thông", shotStrategy: "Mỗi claim cần visual proof.", assetPolicy: { requiresProvenance: true, rejectIrrelevantCandidates: true, requiresHumanReview: true, allowedSources: ["user-owned", "generated-local", "public-domain"] }, qaChecklist: ["Kiểm tra nguồn", "Kiểm tra số liệu", "Kiểm tra subtitle"], promptTemplateIds: ["content-brief-v1", "research-claims-v1", "storyboard-shots-v1", "asset-candidates-v1", "narration-v1"] },
  { profileId: "history-documentary", name: "Lịch sử / tài liệu", description: "Timeline, bản đồ và tư liệu có provenance.", defaultRecipeKind: "image_slideshow", visualMode: "documentary", defaultAudience: "Người xem cần ngữ cảnh", shotStrategy: "Mỗi mốc có nguồn và chú thích.", assetPolicy: { requiresProvenance: true, rejectIrrelevantCandidates: true, requiresHumanReview: true, allowedSources: ["wikimedia-reviewed", "public-domain"] }, qaChecklist: ["Đối chiếu ngày tháng", "Kiểm tra license", "Kiểm tra tái hiện AI"], promptTemplateIds: ["content-brief-v1", "research-claims-v1", "storyboard-shots-v1", "asset-candidates-v1", "narration-v1"] },
  { profileId: "story-narrative", name: "Truyện / kể chuyện", description: "Nhân vật, bối cảnh và continuity xuyên suốt.", defaultRecipeKind: "hybrid_2d_3d", visualMode: "narrative", defaultAudience: "Người xem thích chuyện ngắn", shotStrategy: "Khóa identity anchor trước từng beat.", assetPolicy: { requiresProvenance: true, rejectIrrelevantCandidates: true, requiresHumanReview: true, allowedSources: ["generated-local", "user-owned"] }, qaChecklist: ["Kiểm tra nhân vật", "Kiểm tra đạo cụ", "Kiểm tra IP"], promptTemplateIds: ["content-brief-v1", "character-bible-v1", "storyboard-shots-v1", "asset-candidates-v1", "narration-v1"] },
  { profileId: "product-demo", name: "Sản phẩm / demo", description: "Demo tính năng bằng claim và màn hình có bằng chứng.", defaultRecipeKind: "screen_demo", visualMode: "product-demo", defaultAudience: "Khách hàng hoặc người dùng", shotStrategy: "Mỗi claim gắn với màn hình hoặc tài liệu.", assetPolicy: { requiresProvenance: true, rejectIrrelevantCandidates: true, requiresHumanReview: true, allowedSources: ["user-owned", "generated-local"] }, qaChecklist: ["Duyệt claim", "Che dữ liệu riêng", "Kiểm tra CTA"], promptTemplateIds: ["content-brief-v1", "product-claims-v1", "storyboard-shots-v1", "asset-candidates-v1", "narration-v1"] },
  { profileId: "gameplay-demo", name: "Gameplay / hướng dẫn", description: "Thao tác thật, callout đúng frame và media có quyền.", defaultRecipeKind: "screen_demo", visualMode: "gameplay", defaultAudience: "Người xem cần thấy thao tác", shotStrategy: "Capture theo bước và che dữ liệu riêng.", assetPolicy: { requiresProvenance: true, rejectIrrelevantCandidates: true, requiresHumanReview: true, allowedSources: ["user-owned", "licensed-game-capture"] }, qaChecklist: ["Kiểm tra quyền capture", "Che tài khoản", "Kiểm tra callout"], promptTemplateIds: ["content-brief-v1", "tutorial-steps-v1", "storyboard-shots-v1", "asset-candidates-v1", "narration-v1"] },
  { profileId: "cinematic-3d", name: "Cinematic 3D", description: "Asset, camera, ánh sáng và chuyển động tái sử dụng được.", defaultRecipeKind: "true_3d", visualMode: "cinematic-3d", defaultAudience: "Người xem cần hình ảnh điện ảnh", shotStrategy: "Visual bible trước, Blender giữ geometry/camera.", assetPolicy: { requiresProvenance: true, rejectIrrelevantCandidates: true, requiresHumanReview: true, allowedSources: ["generated-local", "user-owned", "licensed-3d"] }, qaChecklist: ["Kiểm tra asset", "Kiểm tra camera", "Kiểm tra output"], promptTemplateIds: ["content-brief-v1", "world-bible-v1", "storyboard-shots-v1", "asset-candidates-v1", "narration-v1"] },
];

const fallbackPromptTemplates: PromptTemplate[] = [
  { templateId: "content-brief-v1", version: "v1.0.0", name: "Brief nội dung theo chủ đề", purpose: "Biến ý tưởng thành brief có claim và phạm vi.", locale: "vi-VN", body: "Chủ đề: {{topic}}. Profile: {{topic_profile}}. Đối tượng: {{audience}}. Mục tiêu: {{content_goal}}. Tạo brief, claim cần kiểm chứng, entity và điều không được suy diễn.", inputKeys: ["topic", "topic_profile", "audience", "content_goal"], outputContract: ["promise", "scope", "claims_to_verify"], guardrails: ["Không bịa nguồn.", "Không đưa bí mật.", "Bắt buộc review."] },
];

const fallbackProviderEnvSnapshot: ProviderEnvSnapshot = {
  executionProfile: "mock",
  secretBackend: "env",
  dotenvLoaded: false,
  dotenvSource: "none",
  cloudRequestsBlocked: true,
  externalPublishBlocked: true,
  paidApprovalRequired: true,
  unknownCostPolicy: "block",
  profiles: [],
  routing: [],
  warnings: [],
};

const fallbackProviders: ProviderProfile[] = [
  { profileId: "llm_local", capability: "llm", provider: "local", model: "configured-local-llm", endpointRef: "local://llm", enabled: true, configured: true, credentialRef: "none" },
  { profileId: "media_local", capability: "media", provider: "ffmpeg", model: "installed-binary", endpointRef: "binary://ffmpeg", enabled: true, configured: true, credentialRef: "none" },
  { profileId: "stt_local", capability: "stt", provider: "whisper", model: "configured-whisper", endpointRef: "local://whisper", enabled: false, configured: true, credentialRef: "none" },
  { profileId: "voice_primary", capability: "tts", provider: "omnivoice", model: "OmniVoice", endpointRef: "local://python", enabled: true, configured: false, credentialRef: "none" },
  { profileId: "video_primary", capability: "video", provider: "configured-by-user", model: "configured-video-model", endpointRef: "env:AUTO3DVIDEO_VIDEO_BASE_URL", enabled: false, configured: false, credentialRef: "env:AUTO3DVIDEO_VIDEO_API_KEY" },
];

function compactBrowserFlowText(value: string | null | undefined, maxLength: number) {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function inspectBrowserFlowVideoComposer(uiRefs: BrowserFlowUiRef[]) {
  const labels = uiRefs.map((item) => item.label.trim().toLowerCase()).filter(Boolean);
  const chatOnly = labels.some((label) => /bạn muốn tạo gì|câu trả lời tốt|câu trả lời không tốt|assistant|conversation|chat|message|tìm hiểu về|cho tôi biết/.test(label));
  const creditGate = labels.some((label) => /out of credits?|credits? exhausted|no credits|not enough credits?|insufficient credits?|credit required|quota (?:exceeded|exhausted)|limit reached|hết credit|không đủ credit|hết hạn mức|payment required|upgrade to generate/.test(label));
  const hasVideoMode = labels.some((label) => /text[- ]to[- ]video|video generation|video generator|video mode|chế độ video|tạo video|video flow/.test(label));
  const hasGenerate = labels.some((label) => /^(generate video|generate|start generation|tạo video|create video)$/.test(label) || /generate video|start generation|create video|tạo video/.test(label));
  const hasPrompt = uiRefs.some((item) => /textbox|textarea|input|contenteditable|generic|paragraph/.test(item.role.toLowerCase()) && /prompt|describe|text to video|what do you want|what would you like|video|bạn muốn thay đổi gì|tạo ảnh|image/.test(item.label.toLowerCase()));
  return { chatOnly, creditGate, hasVideoMode, hasGenerate, hasPrompt, verified: hasVideoMode && hasGenerate && hasPrompt && !chatOnly && !creditGate };
}

function inspectBrowserFlowImageComposer(uiRefs: BrowserFlowUiRef[]) {
  const labels = uiRefs.map((item) => item.label.trim().toLowerCase()).filter(Boolean);
  const creditGate = labels.some((label) => /out of credits?|credits? exhausted|no credits|not enough credits?|insufficient credits?|credit required|quota (?:exceeded|exhausted)|limit reached|hết credit|không đủ credit|hết hạn mức|payment required|upgrade to generate/.test(label));
  const imageModePattern = /nano banana|image generation|image generator|create image|generate image|tạo ảnh|hình ảnh|bạn muốn thay đổi gì/;
  const hasNanoBanana = labels.some((label) => imageModePattern.test(label));
  const imageModeIndex = uiRefs.findIndex((item) => imageModePattern.test(item.label.trim().toLowerCase()));
  const addIngredientsIndex = uiRefs.findIndex((item) => {
    const label = item.label.trim().toLowerCase();
    return (label.includes("add ingredients") && label.includes("prompt"))
      || label.includes("thêm thành phần vào ô nhập câu lệnh")
      || (label.includes("thành phần") && label.includes("câu lệnh"));
  });
  const hasStartGeneration = labels.some((label) => label === "start generation" || label === "generate" || label.includes("start generation") || label === "tạo ảnh");
  const explicitVideo = labels.some((label) => label === "video" || label === "text-to-video" || label === "text to video" || /video generation|video generator|video mode|chế độ video|video flow/.test(label));
  const hasPrompt = uiRefs.some((item, index) => {
    const role = item.role.toLowerCase();
    const label = item.label.trim().toLowerCase();
    const isInput = /textbox|textarea|input|contenteditable|generic|paragraph/.test(role);
    const explicit = /bạn muốn thay đổi gì|nano banana|image|tạo ảnh|prompt|what do you want|what would you like|describe/.test(label);
    // Flow exposes the project title as [textbox] "Editable text". It sits
    // close to the composer controls in the accessibility tree, but it is
    // never a safe prompt target.
    const generic = !label || /^(textbox|paragraph)$/.test(label);
    const nearIngredients = addIngredientsIndex >= 0 && Math.abs(addIngredientsIndex - index) <= 16;
    return isInput && (explicit || (generic && (nearIngredients || (imageModeIndex >= 0 && Math.abs(imageModeIndex - index) <= 10))));
  });
  const hasSend = uiRefs.some((item) => /button|link|menuitem/.test(item.role.toLowerCase()) && /send|gửi|create|generate|tạo|arrow|submit/.test(item.label.toLowerCase()));
  // BrowserMCP 0.1.3 omits the Nano Banana/model label from this live Flow
  // page, but still exposes the real composer controls. This bounded trio is
  // enough to identify the image composer without accepting the chat box.
  const collapsedImageComposer = !explicitVideo && addIngredientsIndex >= 0 && hasStartGeneration && hasPrompt;
  // This live Flow composer exposes its real ProseMirror editor outside the
  // accessibility refs. Prefer the locked CDP DOM path whenever the exact
  // image-composer controls are present, even if BrowserMCP also exposes a
  // generic paragraph ref. This avoids stale BrowserMCP type retries after a
  // previous WebSocket timeout.
  const domPromptComposer = !explicitVideo && addIngredientsIndex >= 0 && hasStartGeneration;
  return { creditGate, hasNanoBanana, hasPrompt, hasSend, domPromptComposer, verified: !creditGate && ((hasNanoBanana && hasPrompt) || collapsedImageComposer || domPromptComposer) };
}

function findBrowserFlowVideoModeRef(uiRefs: BrowserFlowUiRef[]) {
  return uiRefs
    .filter((item) => /button|radio|tab|option/.test(item.role.toLowerCase()))
    .map((item) => {
      const label = item.label.trim().toLowerCase();
      const value = /^(video|text[- ]to[- ]video|video generation|chế độ video)$/.test(label) ? 30
        : /text[- ]to[- ]video|video generation|video mode|chế độ video/.test(label) ? 20 : -1;
      return { item, value };
    })
    .filter(({ value }) => value > 0)
    .sort((a, b) => b.value - a.value)[0]?.item;
}

function findBrowserFlowImageModeRef(uiRefs: BrowserFlowUiRef[]) {
  const imageEntryPattern = /tạo một vài phiên bản của một hình ảnh|tạo bản vẽ ý tưởng|create an image|create image|text to image|image generation|image generator/;
  return uiRefs
    .filter((item) => /button|link|generic|card|tab|radio|option/.test(item.role.toLowerCase()))
    .map((item) => {
      const label = item.label.trim().toLowerCase();
      if (/nano banana|bạn muốn thay đổi|prompt|send|gửi|download|tải xuống/.test(label)) return { item, value: -1 };
      const value = /tạo một vài phiên bản của một hình ảnh|tạo bản vẽ ý tưởng/.test(label)
        ? 30
        : imageEntryPattern.test(label)
          ? 20
          : -1;
      return { item, value };
    })
    .filter(({ value }) => value > 0)
    .sort((a, b) => b.value - a.value)[0]?.item;
}

function flowSegmentsForGeneration(script: LocalScriptDocument) {
  return script.segments.flatMap((segment, sourceIndex) => {
    const total = Math.max(1, segment.durationSeconds);
    const count = Math.max(1, Math.ceil(total / 10));
    return Array.from({ length: count }, (_, partIndex) => ({
      segment: count === 1 ? segment : {
        ...segment,
        segmentId: `${segment.segmentId}-part-${String(partIndex + 1).padStart(2, "0")}`,
        durationSeconds: Math.min(10, Math.max(1, total - partIndex * 10)),
        action: `${segment.action || segment.narration} Part ${partIndex + 1}/${count}; continue directly from the previous part with identical subject identity, environment and screen direction.`,
        continuityNotes: `${segment.continuityNotes} This is part ${partIndex + 1}/${count} of the same shot beat; preserve the exact visual state at the cut.`,
      },
      sourceIndex,
      partIndex,
      partCount: count,
    }));
  });
}

function findBrowserFlowPromptRef(uiRefs: BrowserFlowUiRef[]) {
  const promptControlPattern = /add ingredients.*prompt|prompt.*ingredients|thêm thành phần.*(?:ô )?nhập câu lệnh|ô nhập câu lệnh.*thành phần|thành phần.*câu lệnh/;
  const addIngredientsIndex = uiRefs.findIndex((item) => promptControlPattern.test(item.label.trim().toLowerCase()));
  const imageModePattern = /nano banana|image generation|image generator|create image|generate image|tạo ảnh|hình ảnh|bạn muốn thay đổi gì/;
  const imageModeIndex = uiRefs.findIndex((item) => imageModePattern.test(item.label.trim().toLowerCase()));
  const score = (item: BrowserFlowUiRef, index: number) => {
    const role = item.role.toLowerCase();
    const label = item.label.trim().toLowerCase();
    const isTextInput = /textbox|textarea|input|contenteditable/.test(role);
    const isComposerParagraph = role === "paragraph" && label === "paragraph" && addIngredientsIndex > index && addIngredientsIndex - index <= 2;
    if (label === "editable text") return -1000;
    if (/^(search|filter|find|address|url|email|title|name)$/.test(label) || /^(search|filter|find|address|url)\b/.test(label)) return -1000;
    const nearPromptControls = addIngredientsIndex >= 0 && Math.abs(addIngredientsIndex - index) <= 16;
    const nearImageMode = imageModeIndex >= 0 && Math.abs(imageModeIndex - index) <= 10;
    const explicitPrompt = /prompt|describe|text to video|what do you want|what would you like|create|write|concept|message|bạn muốn tạo gì|bạn muốn thay đổi gì|ô nhập câu lệnh|câu lệnh|nano banana|tạo ảnh|image/.test(label);
    const isExplicitComposer = explicitPrompt && /generic|paragraph|textbox|textarea|input|contenteditable|combobox|editable|div/.test(role);
    if (!isTextInput && !isComposerParagraph && !isExplicitComposer) return -1000;
    const genericComposer = !label || /^(textbox|editable text|paragraph)$/.test(label);
    if (!explicitPrompt && !(nearPromptControls && genericComposer) && !(nearImageMode && genericComposer) && !isComposerParagraph) return -1000;
    let value = isComposerParagraph ? 26 : nearPromptControls ? 22 : nearImageMode ? 20 : 12;
    if (explicitPrompt) value += 16;
    if (isExplicitComposer) value += 12;
    if (genericComposer) value += 4;
    return value;
  };
  return uiRefs
    .map((item, index) => ({ item, value: score(item, index) }))
    .filter(({ value }) => value > 0)
    .sort((a, b) => b.value - a.value)[0]?.item;
}

function findBrowserFlowApprovalRef(uiRefs: BrowserFlowUiRef[]) {
  if (!inspectBrowserFlowVideoComposer(uiRefs).verified) return undefined;
  return uiRefs
    .filter((item) => /button|radio|option/.test(item.role.toLowerCase()))
    .map((item) => ({
      item,
      value: /^(approve|generate video|generate|tạo video|start generation|create video)$/.test(item.label.trim().toLowerCase())
        ? 20
        : /approve.*video|start generation|generate video|create video|tạo video/.test(item.label.toLowerCase())
          ? 12
          : /always approve|reject|cancel/.test(item.label.toLowerCase())
            ? -100
            : -1,
    }))
    .filter(({ value }) => value > 0)
    .sort((a, b) => b.value - a.value)[0]?.item;
}

function findBrowserFlowDownloadRef(uiRefs: BrowserFlowUiRef[]) {
  return uiRefs
    .filter((item) => /button|link|menuitem/.test(item.role.toLowerCase()))
    .map((item) => ({
      item,
      value: /download video|download image|tải ảnh|tải video|tải xuống|download|export video|export image|xuất video|xuất ảnh|save video|save image|lưu video|lưu ảnh/.test(item.label.trim().toLowerCase()) ? 20 : -1,
    }))
    .filter(({ value }) => value > 0)
    .sort((a, b) => b.value - a.value)[0]?.item;
}

function findBrowserFlowProjectRef(uiRefs: BrowserFlowUiRef[]) {
  return uiRefs
    .filter((item) => /button|link|generic|card/.test(item.role.toLowerCase()))
    .map((item) => {
      const label = item.label.trim().toLowerCase();
      const isOpenProject = /open project|mở project|continue project|resume project/.test(label);
      const isComposerEntry = /start creating|bắt đầu tạo|new project|dự án mới|create project|tạo dự án/.test(label);
      return { item, value: isOpenProject ? 30 : isComposerEntry ? 20 : -1 };
    })
    .filter(({ value }) => value > 0)
    .sort((a, b) => b.value - a.value)[0]?.item;
}

function findBrowserFlowStoryboardChoiceRef(uiRefs: BrowserFlowUiRef[]) {
  return uiRefs
    .filter((item) => /button|radio|option/.test(item.role.toLowerCase()))
    .map((item) => ({
      item,
      value: /storyboard\s+all\s+\d+\s+shots?\s+first/.test(item.label.toLowerCase())
        ? 30
        : /storyboard.*shots?.*first/.test(item.label.toLowerCase())
          ? 20
          : -1,
    }))
    .filter(({ value }) => value > 0)
    .sort((a, b) => b.value - a.value)[0]?.item;
}

function inspectBrowserFlowGeneration(uiRefs: BrowserFlowUiRef[]) {
  const composer = inspectBrowserFlowVideoComposer(uiRefs);
  const labels = uiRefs.map((item) => item.label.trim().toLowerCase()).filter(Boolean);
  const isWorking = labels.some((label) => /\bdừng\b|\btư duy\b|generating|processing|rendering|creating|loading|đang tạo|đang xử lý|đang dựng/.test(label));
  const hasResponse = labels.some((label) => /câu trả lời tốt|câu trả lời không tốt|sao chép|copy|bắt đầu tạo|start generation|download|tải xuống|export|xuất/.test(label));
  const hasMedia = uiRefs.some((item) => /video|media/.test(item.role.toLowerCase()));
  const hasOutputControl = labels.some((label) => /download video|tải video|tải xuống|download|export video|xuất video|save video|lưu video|generated video|video result|video ready|đã tạo video|video đã sẵn sàng/.test(label));
  const readyForApproval = composer.verified && hasResponse && !isWorking;
  // A generic media region is not proof that this run generated anything.
  // Output becomes actionable only when Flow exposes an explicit download/export control.
  const readyForOutput = composer.verified && hasOutputControl && !isWorking;
  return { ...composer, isWorking, hasResponse, hasMedia, hasOutputControl, readyForApproval, readyForOutput };
}

function buildBrowserFlowPrompt(script: LocalScriptDocument, originalPrompt: string) {
  const lines = [
    "Create a coherent cinematic 3D video from the following concept and shot plan.",
    `ORIGINAL CONCEPT: ${compactBrowserFlowText(originalPrompt, 720)}`,
    `TITLE: ${compactBrowserFlowText(script.title, 240)}`,
    `HOOK: ${compactBrowserFlowText(script.hook, 420)}`,
    `TOTAL DURATION: ${script.totalDurationSeconds.toFixed(1)} seconds`,
    `SHOT COUNT: ${script.segments.length}. Keep every shot as a distinct shot in this single Flow session; do not merge the plan into one repeated image or create a separate browser session per shot.`,
    "TIMING CONTRACT: Preserve shot order and the requested approximate durations. If a shot is very short, treat it as a rapid montage beat; do not discard, duplicate or silently compress the other shot cards.",
    "SHOT PLAN:",
  ];
  script.segments.slice(0, 24).forEach((segment, index) => {
    const beats = (segment.beats ?? []).slice(0, 6).map((beat) => `${beat.imageRole}: ${compactBrowserFlowText(beat.prompt || beat.action, 220)}`).join(" | ");
    const visual = compactBrowserFlowText(segment.visualPrompt || `${segment.subject ?? "subject"}; ${segment.action ?? segment.narration}`, 620);
    lines.push(`SHOT ${String(index + 1).padStart(2, "0")} (${segment.durationSeconds.toFixed(1)}s): ${visual}`);
    if (beats) lines.push(`BEATS: ${beats}`);
  });
  lines.push("Continuity: preserve subject identity, palette, screen direction, scale, lighting and camera logic across all shots.");
  lines.push("Use the attached reference images when available. Generate the requested video in the current Google Flow project.");
  const compiled = lines.join("\n");
  return compiled.length <= 3950
    ? compiled
    : `${compiled.slice(0, 3650)}\nAUTO MODE CONTRACT: submit each SHOT separately; later shots are not omitted when this overview is truncated.`;
}

async function sha256Text(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type PromptTimingRequirements = {
  shotCount: number | null;
  durationSeconds: number | null;
};

function inferPromptTimingRequirements(prompt: string): PromptTimingRequirements {
  const normalized = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  const shotMatch = normalized.match(/(?<!\d)(\d{1,2})\s*(?:shot|shots|cảnh|phân cảnh)\b/);
  let shotCount = shotMatch ? Math.max(2, Math.min(12, Number(shotMatch[1]))) : null;
  const pairMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*(?:s|sec|secs|giây)\s+(\d{1,2})\s*(?:shot|shots|cảnh|phân cảnh)\b|(?:shot|shots|cảnh|phân cảnh)\s*(?:\/|mỗi)?\s*(\d+(?:[.,]\d+)?)\s*(?:s|sec|secs|giây)/);
  const perShotSeconds = pairMatch
    ? Number((pairMatch[1] ?? pairMatch[3] ?? "").replace(",", "."))
    : null;
  if (!shotCount && pairMatch?.[2]) shotCount = Math.max(2, Math.min(12, Number(pairMatch[2])));
  if (shotCount && perShotSeconds && Number.isFinite(perShotSeconds)) {
    return { shotCount, durationSeconds: Math.round(shotCount * Math.max(1, perShotSeconds) * 100) / 100 };
  }
  const durationMatch = normalized.match(/(?:dài|khoảng|trong|thời lượng|duration|video)\D{0,24}(\d+(?:[.,]\d+)?)\s*(?:s|sec|secs|giây)\b/) ?? normalized.match(/(?<!\d)(\d+(?:[.,]\d+)?)\s*(?:giây|secs?|sec)\b/);
  const durationSeconds = durationMatch ? Number(durationMatch[1].replace(",", ".")) : null;
  return { shotCount, durationSeconds: durationSeconds !== null && Number.isFinite(durationSeconds) ? Math.max(1, Math.min(180, durationSeconds)) : null };
}

function promptSourceFingerprintInput(topic: string, objective: string, additionalPrompt: string, referenceContext: string) {
  return JSON.stringify({
    topic: topic.trim().replace(/\r\n/g, "\n"),
    objective: objective.trim(),
    additionalPrompt: additionalPrompt.trim(),
    referenceContext: referenceContext.trim(),
  });
}

function scriptMatchesPrompt(script: LocalScriptDocument, sourcePromptHash: string, requirements: PromptTimingRequirements): boolean {
  if (script.sourcePromptHash !== sourcePromptHash) return false;
  if (requirements.shotCount !== null && (script.requestedShotCount !== requirements.shotCount || script.segments.length !== requirements.shotCount)) return false;
  if (requirements.durationSeconds !== null && (script.requestedDurationSeconds !== requirements.durationSeconds || Math.abs(script.totalDurationSeconds - requirements.durationSeconds) > 0.25)) return false;
  return script.segments.length >= 2 && script.segments.every((segment) => Number.isFinite(segment.durationSeconds) && segment.durationSeconds >= 1);
}

function buildBrowserFlowShotPrompt(script: LocalScriptDocument, segment: LocalScriptSegment, index: number, runId: string, revisionId: string, providerIdentity?: BrowserFlowProviderIdentity | null, sessionId?: string | null) {
  const shotId = `SHOT-${String(index + 1).padStart(3, "0")}`;
  // The video prompt carries the shot's exact Animate ingredient as the
  // authoritative reference. Keep the serialized reference set complete for
  // resume/audit instead of truncating a 12-shot session at eight paths.
  const references = [...(segment.revisionImagePath ? [segment.revisionImagePath] : []), ...(script.referenceAssetPaths ?? []), ...(script.comfyuiAssetPaths ?? []), ...(script.geminiAssetPaths ?? [])].slice(0, 32);
  const referenceSetKey = references.length ? references.join("|") : "none";
  const lines = [
    "AUTO3DVIDEO SHOT SUBMISSION — create exactly one standalone video shot; never make a contact sheet, storyboard grid or repeated placeholder.",
    `SHOT_ID: ${shotId} | REVISION_ID: ${revisionId}`,
    `RUN_ID: ${runId}`,
    `CONTINUITY_BIBLE_VERSION: ${compactBrowserFlowText(script.promptVersion || "cinematic-3d-bible-v1", 180)}`,
    `PROJECT_IDENTITY: ${providerIdentity?.providerProjectKey || "UNVERIFIED — do not submit until the current Flow project URL is verified"}`,
    `SESSION_ID: ${sessionId || "local-session"}`,
    `REFERENCE_SET_KEY: ${compactBrowserFlowText(referenceSetKey, 600)}`,
    `THEME: ${compactBrowserFlowText(script.title, 180)} — ${compactBrowserFlowText(script.hook, 260)}`,
    `DURATION: ${segment.durationSeconds.toFixed(2)} seconds. Keep this shot separate and preserve its order in the project.`,
    `SUBJECT / IDENTITY: ${compactBrowserFlowText(segment.subject, 650)}`,
    `ENVIRONMENT: ${compactBrowserFlowText(segment.visualPrompt, 900)}`,
    `ACTION / CAUSE AND EFFECT: ${compactBrowserFlowText(segment.action || segment.narration, 700)}`,
    `CAMERA / LENS: ${compactBrowserFlowText(segment.cameraIntent, 420)}`,
    `LIGHT / MATERIAL: ${compactBrowserFlowText(segment.lightingIntent, 420)}`,
    `CONTINUITY: ${compactBrowserFlowText(segment.continuityNotes, 650)}`,
    `REFERENCES: ${references.length ? references.join(", ") : "none; do not invent an unrelated reference"}`,
    `NEGATIVE: ${compactBrowserFlowText(segment.negativePrompt, 600)}`,
    "ACCEPTANCE: visible intended subject; correct species/object identity; correct scale and action; no unrelated vehicle/prop substitution; stable camera and lighting; explicit video output available for download.",
    "Use the current Google Flow project and wait until this shot's output is ready before starting another shot.",
  ];
  return lines.join("\n").slice(0, 3950);
}

const MAX_BROWSER_FLOW_IMAGE_PROMPT_CHARS = 8_000;

function buildBrowserFlowImagePrompt(script: LocalScriptDocument, segment: LocalScriptSegment, index: number, runId: string, revisionId: string) {
  const shotId = `SHOT-${String(index + 1).padStart(3, "0")}`;
  const lines = [
    `SHOT_ID: ${shotId}`,
    `REVISION_ID: ${revisionId}`,
    `RUN_ID: ${runId}`,
    "Create exactly one polished cinematic 3D reference image for this shot. Never create a contact sheet, storyboard grid, collage, or multiple images.",
    `SUBJECT AND ACTION: ${compactBrowserFlowText(segment.visualPrompt || segment.action || segment.narration, 1_800)}`,
    `CAMERA AND LIGHTING: ${compactBrowserFlowText(segment.cameraIntent, 900) || "cinematic camera, readable composition"}; ${compactBrowserFlowText(segment.lightingIntent, 900) || "physically based cinematic lighting"}`,
    `CONTINUITY: ${compactBrowserFlowText(segment.continuityNotes, 1_400) || "Preserve the same hero identity, proportions, colors, materials, world scale, and screen direction across every shot."}`,
    `STYLE: ${compactBrowserFlowText(script.title, 260)}; full CGI 3D, realistic anatomy and materials, detailed environment, clean single frame, 16:9, no text, no logo, no watermark, no contact sheet, no collage, no debug primitives.`,
    `NEGATIVE: ${compactBrowserFlowText(segment.negativePrompt, 1_200) || "random characters, duplicate subject, broken anatomy, plastic toy look, UI, text, watermark"}`,
  ];
  return lines.join("\n").slice(0, MAX_BROWSER_FLOW_IMAGE_PROMPT_CHARS);
}

function stableBrowserFlowPrompt(prompt: string) {
  return prompt
    .replace(/^RUN_ID:\s*[^\r\n]+\r?\n?/m, "")
    .trim();
}

function assetContainsFlowIdentity(asset: AssetView, shotId: string, revisionId: string) {
  const searchable = [asset.relativePath, asset.title, ...asset.tags, asset.note].join(" ");
  const escapedShot = shotId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedRevision = revisionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const shotMatches = new RegExp(`(?:^|[^A-Z0-9])${escapedShot}(?:[^A-Z0-9]|$)`, "i").test(searchable)
    || new RegExp(`(?:^|[^A-Z0-9])shot[-_ ]?0*${shotId.match(/(\d+)$/)?.[1] ?? ""}(?:[^A-Z0-9]|$)`, "i").test(searchable);
  const revisionMatches = new RegExp(`(?:^|[^A-Z0-9])${escapedRevision}(?:[^A-Z0-9]|$)`, "i").test(searchable)
    || !/rev(?:ision)?[-_ ]?\d+/i.test(searchable);
  return shotMatches && revisionMatches;
}

function findResumableFlowAsset(
  localAssets: AssetView[],
  downloadedFiles: BrowserFlowDownloadedFile[],
  shotId: string,
  revisionId: string,
  inputHash: string,
) {
  const workflowCandidates = downloadedFiles
    .filter((file) => file.mediaKind === "image" && file.shotId === shotId && file.revisionId === revisionId)
    .sort((left, right) => String(right.importedAt).localeCompare(String(left.importedAt)));
  const exactWorkflow = workflowCandidates.find((file) => file.inputHash === inputHash);
  const workflowAsset = [...(exactWorkflow ? [exactWorkflow] : []), ...workflowCandidates.filter((file) => file !== exactWorkflow)]
    .map((file) => localAssets.find((asset) => asset.relativePath === file.relativePath))
    .find((asset): asset is AssetView => Boolean(asset));
  if (workflowAsset) return workflowAsset;

  // Migration fallback for older downloads: they were imported with a
  // per-run hash and no stable revision in the filename. Only accept one
  // unambiguous asset for this shot, never guess among multiple revisions.
  const shotCandidates = localAssets.filter((asset) => asset.kind === "image"
    && asset.status !== "archived"
    && assetContainsFlowIdentity(asset, shotId, revisionId));
  return shotCandidates.length === 1 ? shotCandidates[0] : null;
}

async function runBrowserFlowAgent(projectId: string, workflow: BrowserFlowWorkflow, goal: string, text: string | null = null): Promise<BrowserFlowAgentStepReport> {
  return invoke<BrowserFlowAgentStepReport>("browser_flow_agent_step", {
    request: {
      projectId,
      workflowId: workflow.workflowId,
      goal,
      text,
      approved: true,
    },
  });
}

function App() {
  const [activeNav, setActiveNav] = useState("recipes");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [snapshot, setSnapshot] = useState<AppSnapshot>(fallbackSnapshot);
  const [health, setHealth] = useState<HealthStatus>(fallbackHealth);
  const [readiness, setReadiness] = useState<ToolReadinessReport>(fallbackReadiness);
  const [projects, setProjects] = useState<Project[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [attemptOutputs, setAttemptOutputs] = useState<AttemptOutput[]>([]);
  const [launchPlan, setLaunchPlan] = useState<WorkerLaunchPlan | null>(null);
  const [fixtureReport, setFixtureReport] = useState<LocalMediaFixtureReport | null>(null);
  const [blenderFixtureReport, setBlenderFixtureReport] = useState<LocalBlenderFixtureReport | null>(null);
  const [true3dFixtureReport, setTrue3dFixtureReport] = useState<True3dFixtureReport | null>(null);
  const [true3dMultishotFixtureReport, setTrue3dMultishotFixtureReport] = useState<True3dMultishotFixtureReport | null>(null);
  const [assetPipelineCheckReport, setAssetPipelineCheckReport] = useState<AssetPipelineCheckReport | null>(null);
  const [vieneuReadiness, setVieneuReadiness] = useState<VieneuReadinessReport>(fallbackVieneuReadiness);
  const [vieneuReport, setVieneuReport] = useState<VieneuTtsReport | null>(null);
  const [omnivoiceReadiness, setOmnivoiceReadiness] = useState<OmniVoiceReadinessReport>(fallbackOmniVoiceReadiness);
  const [omnivoiceReport, setOmnivoiceReport] = useState<OmniVoiceTtsReport | null>(null);
  const [voiceProfiles, setVoiceProfiles] = useState<VoiceProfile[]>([]);
  const [voiceSamples, setVoiceSamples] = useState<VoiceSample[]>([]);
  const [subtitleDocument, setSubtitleDocument] = useState<SubtitleDocument | null>(null);
  const [subtitleVideoPath, setSubtitleVideoPath] = useState("");
  const [subtitlePath, setSubtitlePath] = useState("");
  const [subtitleOutputPath, setSubtitleOutputPath] = useState(".auto3dvideo/subtitles/edited-captions.srt");
  const [subtitleSourceLanguage, setSubtitleSourceLanguage] = useState("vi-VN");
  const [subtitleTargetLanguage, setSubtitleTargetLanguage] = useState("vi-VN");
  const [subtitleFormat, setSubtitleFormat] = useState<"srt" | "vtt">("srt");
  const [subtitleProbe, setSubtitleProbe] = useState<SubtitleVideoProbeReport | null>(null);
  const [subtitleReport, setSubtitleReport] = useState<SubtitleDocumentReport | null>(null);
  const [subtitleBurnInReport, setSubtitleBurnInReport] = useState<SubtitleBurnInReport | null>(null);
  const [videoVisionPath, setVideoVisionPath] = useState("");
  const [videoVisionOutputPath, setVideoVisionOutputPath] = useState("outputs/video-evidence/evidence.json");
  const [videoVisionSampleFps, setVideoVisionSampleFps] = useState(1);
  const [videoVisionMaxFrames, setVideoVisionMaxFrames] = useState(120);
  const [videoVisionExtractAudio, setVideoVisionExtractAudio] = useState(true);
  const [videoVisionReport, setVideoVisionReport] = useState<VideoVisionEvidenceReport | null>(null);
  const [browserMcpRuntimeReport, setBrowserMcpRuntimeReport] = useState<BrowserMcpRuntimeReport | null>(null);
  const [chromeAutoFlowReport, setChromeAutoFlowReport] = useState<BrowserMcpRuntimeReport | null>(null);
  const [browserMcpFreshState, setBrowserMcpFreshState] = useState<BrowserMcpFreshState>({ status: "unknown", uiRefCount: 0, checkedAt: 0 });
  const [browserHandoffBusy, setBrowserHandoffBusy] = useState(false);
  const [browserFlowWorkflow, setBrowserFlowWorkflow] = useState<BrowserFlowWorkflow | null>(null);
  const [visualPlanPreview, setVisualPlanPreview] = useState<NarrativeVisualPlanPreview | null>(null);
  const [attemptJobId, setAttemptJobId] = useState("");
  const [attemptExecutableId, setAttemptExecutableId] = useState<ExecutableId | "">("ffmpeg");
  const [attemptOutputPath, setAttemptOutputPath] = useState("preview.mp4");
  const [attemptMediaKind, setAttemptMediaKind] = useState<MediaKind>("video");
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>(fallbackRecipes);
  const [topicProfiles, setTopicProfiles] = useState<TopicProfile[]>(fallbackTopicProfiles);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>(fallbackPromptTemplates);
  const [promptPresets, setPromptPresets] = useState<PromptPreset[]>([]);
  const [videoWorkflowSessions, setVideoWorkflowSessions] = useState<VideoWorkflowSession[]>([]);
  const [assets, setAssets] = useState<AssetView[]>([]);
  const [referenceSets, setReferenceSets] = useState<ReferenceSet[]>([]);
  const [assetPackReviews, setAssetPackReviews] = useState<AssetPackReview[]>([]);
  const [assetPackBlenderBinding, setAssetPackBlenderBinding] = useState<AssetPackBlenderBindingReport | null>(null);
  const [assetPackBlenderRun, setAssetPackBlenderRun] = useState<AssetPackBlenderBindingRunReport | null>(null);
  const [previewPlatforms, setPreviewPlatforms] = useState<PreviewPlatform[]>(["tiktok", "douyin", "kuaishou", "bilibili", "xigua"]);
  const [previewMaxResults, setPreviewMaxResults] = useState(24);
  const [previewCreatorUrl, setPreviewCreatorUrl] = useState("https://www.tiktok.com/@tiktok");
  const [previewUrls, setPreviewUrls] = useState("");
  const [previewCards, setPreviewCards] = useState<VideoPreviewCard[]>([]);
  const [selectedPreviewId, setSelectedPreviewId] = useState<string | null>(null);
  const [previewScanPlan, setPreviewScanPlan] = useState<PreviewScanPlan | null>(null);
  const [previewScanReport, setPreviewScanReport] = useState<PreviewScanReport | null>(null);
  const [previewRightsStatus, setPreviewRightsStatus] = useState<AssetView["rightsStatus"]>("unknown");
  const [previewDownloadReport, setPreviewDownloadReport] = useState<ReferenceVideoDownloadReport | null>(null);
  const [previewStorageReadyFor, setPreviewStorageReadyFor] = useState("");
  const [, setTopicPromptPreview] = useState<TopicPromptPreview | null>(null);
  const [, setTopicWorkflowMessage] = useState("Chưa chạy preview brief.");
  const [workspaceActivity, setWorkspaceActivity] = useState<WorkspaceActivityEvent[]>([]);
  const [topTerminalPage, setTopTerminalPage] = useState(0);
  const [commandCodeReport, setCommandCodeReport] = useState<CommandCodeProbeReport | null>(null);
  const [commandCodeTesting, setCommandCodeTesting] = useState(false);
  const [localVideoReport, setLocalVideoReport] = useState<LocalVideoPipelineReport | null>(null);
  const [localScriptReview, setLocalScriptReview] = useState<LocalScriptReviewReport | null>(null);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>({
    presetVoice: "OmniVoice documentary narrator",
    temperature: 0.8,
    voiceCueBySegment: {},
    emotionCodeBySegment: { default: "neutral" },
    cloneEnabled: false,
    cloneConsent: false,
    mode: "design",
    language: "en",
    instruct: "male, middle-aged, low pitch, british accent",
    speed: 1,
    qualityPreset: "preview",
  });
  const [providers, setProviders] = useState<ProviderProfile[]>(fallbackProviders);
  const [providerEnvSnapshot, setProviderEnvSnapshot] = useState<ProviderEnvSnapshot>(fallbackProviderEnvSnapshot);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedRecipe, setSelectedRecipe] = useState("image_slideshow");
  const [selectedTopicProfileId, setSelectedTopicProfileId] = useState("science-explainer");
  const [selectedPromptTemplateId, setSelectedPromptTemplateId] = useState("content-brief-v1");
  const [topic, setTopic] = useState("");
  const [contentGoal, setContentGoal] = useState("Giải thích rõ, có nguồn và dễ xem trên video dọc");
  const [additionalPrompt, setAdditionalPrompt] = useState("");
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showProductionAdvanced, setShowProductionAdvanced] = useState(false);
  const [projectName, setProjectName] = useState("Demo Video Project");
  const [workspaceRoot, setWorkspaceRoot] = useState("D:\\Auto3Dvideo\\projects\\demo-video");
  const [notice, setNoticeText] = useState("Đang ở chế độ local-first; chưa gọi API cloud và chưa chạy process ngoài.");
  const [actionFeedback, setActionFeedback] = useState<{ label: string; state: "running" | "success" | "error" | "info" } | null>(null);
  const activeButtonRef = useRef<HTMLButtonElement | null>(null);
  const noticeVersionRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const autoFlowWorkspaceBootstrappedRef = useRef(false);

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

  const selectedProject = useMemo(
    () => projects.find((project) => project.projectId === selectedProjectId),
    [projects, selectedProjectId],
  );
  const selectedTopicProfile = useMemo(
    () => topicProfiles.find((profile) => profile.profileId === selectedTopicProfileId) ?? topicProfiles[0],
    [topicProfiles, selectedTopicProfileId],
  );
  const availablePromptTemplates = useMemo(
    () => promptTemplates.filter((template) => selectedTopicProfile?.promptTemplateIds.includes(template.templateId)),
    [promptTemplates, selectedTopicProfile],
  );

  useEffect(() => {
    if (!selectedProjectId) {
      setPreviewCards([]);
      setSelectedPreviewId(null);
      setPreviewScanPlan(null);
      setPreviewScanReport(null);
      setPreviewRightsStatus("unknown");
      setPreviewDownloadReport(null);
      setPreviewStorageReadyFor("");
      return;
    }
    const storageKey = `auto3dvideo.preview-cards.${selectedProjectId}`;
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      setPreviewCards(Array.isArray(parsed) ? parsed.filter(isVideoPreviewCard).slice(0, MAX_PREVIEW_CARDS) : []);
    } catch {
      setPreviewCards([]);
    }
    setSelectedPreviewId(null);
    setPreviewScanPlan(null);
    setPreviewScanReport(null);
    setPreviewRightsStatus("unknown");
    setPreviewDownloadReport(null);
    setPreviewStorageReadyFor(selectedProjectId);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId || previewStorageReadyFor !== selectedProjectId) return;
    try {
      window.localStorage.setItem(`auto3dvideo.preview-cards.${selectedProjectId}`, JSON.stringify(previewCards));
    } catch {
      // Local storage is a convenience cache; the UI remains usable when it is unavailable.
    }
  }, [previewCards, previewStorageReadyFor, selectedProjectId]);

  async function createPreviewScanPlan() {
    if (!selectedProjectId) {
      const message = "Hãy chọn project trước khi quét.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "preview.scan.validate", tool: "Preview Radar", state: "blocked", message, nextAction: "Chọn hoặc tạo project local." });
      return;
    }
    if (!previewPlatforms.length) {
      const message = "Chọn ít nhất một nền tảng để quét.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "preview.scan.validate", tool: "Preview Radar", state: "blocked", message, nextAction: "Chọn một hoặc nhiều nền tảng rồi thử lại." });
      return;
    }
    const platformsForRun = [...previewPlatforms];
    const plan: PreviewScanPlan = {
      platforms: platformsForRun,
      maxResults: previewMaxResults,
      scanMode: "discovery_all",
      previewOnly: true,
      worker: "Tự chọn · ưu tiên Obscura, fallback BrowserOS",
      status: "planned",
      createdAt: new Date().toISOString(),
    };
    setPreviewScanPlan(plan);
    setPreviewScanReport(null);
    const platformNames = platformsForRun.map(previewPlatformLabel).join(", ");
    const activityId = recordWorkspaceActivity({ stage: "preview.scan.run", tool: "Obscura / BrowserOS neo", state: "running", progress: 0, message: `Đang quét ${platformNames} bằng engine public phù hợp; chưa tải video và chưa đăng bài.` });
    setLoading(true);
    setNotice(`Đang quét ${platformNames}…`);
    try {
      if (!isTauri()) throw new Error("Cần mở bản app desktop để chạy worker BrowserOS thật; trang web dev chỉ hiển thị giao diện.");
      const report = await invoke<PreviewScanReport>("scan_preview_discovery", {
        request: {
          projectId: selectedProjectId,
          platforms: platformsForRun,
          maxResults: previewMaxResults,
        },
      });
      setPreviewScanReport(report);
      const importedCards = report.cards.filter(isVideoPreviewCard);
      setPreviewCards((current) => {
        const byUrl = new Map(current.map((card) => [card.shareUrl, card]));
        importedCards.forEach((card) => {
          const existing = byUrl.get(card.shareUrl);
          byUrl.set(card.shareUrl, existing ? { ...card, addedToPlan: existing.addedToPlan } : card);
        });
        return Array.from(byUrl.values()).slice(0, MAX_PREVIEW_CARDS);
      });
      if (importedCards[0]) setSelectedPreviewId(importedCards[0].previewId);
      const scanSucceeded = report.status === "success" || report.status === "partial";
      const planStatus: PreviewScanStatus = scanSucceeded ? "success" : "blocked";
      setPreviewScanPlan({ ...plan, worker: report.worker || plan.worker, status: planStatus });
      const message = report.message || (scanSucceeded ? `Đã nhận ${importedCards.length} card preview.` : "Worker chưa trả được video preview.");
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: scanSucceeded ? "success" : "blocked", progress: scanSucceeded ? 1 : 0, message, output: report.reportPath, nextAction: scanSucceeded ? "Xem các nhóm tự phân loại và chọn card cần review." : "Đọc lý do từng nền tảng; đăng nhập trực tiếp hoặc thử lại khi nền tảng hết chặn." });
      report.platformResults.forEach((result) => {
        const resultState: WorkspaceActivityState = result.status === "success" ? "success" : result.status === "waiting_user" ? "waiting_user" : result.status === "error" ? "error" : "blocked";
        recordWorkspaceActivity({ stage: "preview.scan.platform", tool: report.worker || "Obscura / BrowserOS neo", state: resultState, progress: result.status === "success" ? 1 : 0, message: `${previewPlatformLabel(result.platform)}: ${result.message}`, output: result.discoveryUrl, nextAction: resultState === "waiting_user" ? "Xử lý đăng nhập/CAPTCHA trực tiếp trong BrowserOS rồi bấm Quét toàn bộ lại." : undefined });
      });
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi worker không xác định";
      const message = `Không chạy được quét preview: ${detail.slice(0, 360)}`;
      setPreviewScanPlan({ ...plan, status: "blocked" });
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", progress: 0, message, nextAction: "Kiểm tra Obscura trong Cài đặt; nếu dùng fallback thì mở BrowserOS neo rồi thử lại." });
    } finally {
      setLoading(false);
    }
  }

  async function scanPreviewCreatorCatalog() {
    if (!selectedProjectId) {
      const message = "Hãy chọn project trước khi quét creator/playlist.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "preview.creator.validate", tool: "yt-dlp", state: "blocked", message, nextAction: "Chọn hoặc tạo project local." });
      return;
    }
    if (previewPlatforms.length !== 1) {
      const message = "Quét creator/playlist cần đúng 1 nền tảng đang chọn.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "preview.creator.validate", tool: "yt-dlp", state: "blocked", message, nextAction: "Bỏ chọn các nền tảng khác, chỉ giữ nền tảng của URL nguồn." });
      return;
    }
    if (!previewCreatorUrl.trim()) {
      const message = "Nhập URL creator hoặc playlist công khai trước khi quét.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "preview.creator.validate", tool: "yt-dlp", state: "blocked", message, nextAction: "Dán URL profile/playlist https công khai." });
      return;
    }
    const platformsForRun = [...previewPlatforms];
    const plan: PreviewScanPlan = {
      platforms: platformsForRun,
      maxResults: previewMaxResults,
      scanMode: "creator_catalog",
      previewOnly: true,
      worker: "yt-dlp · creator/playlist catalog",
      status: "planned",
      createdAt: new Date().toISOString(),
    };
    setPreviewScanPlan(plan);
    setPreviewScanReport(null);
    const platformName = previewPlatformLabel(platformsForRun[0]);
    const activityId = recordWorkspaceActivity({ stage: "preview.creator.scan", tool: "yt-dlp", state: "running", progress: 0, message: `Đang đọc catalog public ${platformName}; chỉ lấy metadata preview, chưa tải video.` });
    setLoading(true);
    setNotice(`Đang quét nguồn ${platformName}…`);
    try {
      if (!isTauri()) throw new Error("Cần mở bản app desktop để chạy yt-dlp thật; trang web dev chỉ hiển thị giao diện.");
      const report = await invoke<PreviewScanReport>("scan_preview_creator_catalog", {
        request: {
          projectId: selectedProjectId,
          platform: platformsForRun[0],
          sourceUrl: previewCreatorUrl.trim(),
          maxResults: previewMaxResults,
        },
      });
      setPreviewScanReport(report);
      const importedCards = report.cards.filter(isVideoPreviewCard);
      setPreviewCards((current) => {
        const byUrl = new Map(current.map((card) => [card.shareUrl, card]));
        importedCards.forEach((card) => {
          const existing = byUrl.get(card.shareUrl);
          byUrl.set(card.shareUrl, existing ? { ...card, addedToPlan: existing.addedToPlan } : card);
        });
        return Array.from(byUrl.values()).slice(0, MAX_PREVIEW_CARDS);
      });
      if (importedCards[0]) setSelectedPreviewId(importedCards[0].previewId);
      const scanSucceeded = report.status === "success" || report.status === "partial";
      setPreviewScanPlan({ ...plan, worker: report.worker || plan.worker, status: scanSucceeded ? "success" : "blocked" });
      const message = report.message || (scanSucceeded ? `Đã nhận ${importedCards.length} card preview.` : "Nguồn chưa trả được video preview.");
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: scanSucceeded ? "success" : "blocked", progress: scanSucceeded ? 1 : 0, message, output: report.reportPath, nextAction: scanSucceeded ? "Xem card, mở link gốc và review quyền trước khi tải." : "Kiểm tra URL creator, extractor và yt-dlp trong Cài đặt." });
      report.platformResults.forEach((result) => {
        const resultState: WorkspaceActivityState = result.status === "success" ? "success" : result.status === "waiting_user" ? "waiting_user" : result.status === "error" ? "error" : "blocked";
        recordWorkspaceActivity({ stage: "preview.creator.platform", tool: report.worker || "yt-dlp", state: resultState, progress: result.status === "success" ? 1 : 0, message: `${previewPlatformLabel(result.platform)}: ${result.message}`, output: result.discoveryUrl });
      });
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi creator scan không xác định";
      const message = `Không chạy được creator scan: ${detail.slice(0, 360)}`;
      setPreviewScanPlan({ ...plan, status: "blocked" });
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", progress: 0, message, nextAction: "Kiểm tra URL đúng nền tảng và yt-dlp.exe trong Cài đặt." });
    } finally {
      setLoading(false);
    }
  }

  async function scanLicensedFootage() {
    if (!selectedProjectId) {
      const message = "Hãy chọn project trước khi quét footage.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "preview.licensed.validate", tool: "Wikimedia Commons", state: "blocked", message, nextAction: "Chọn hoặc tạo project local." });
      return;
    }
    const plan: PreviewScanPlan = {
      platforms: ["wikimedia"],
      maxResults: previewMaxResults,
      scanMode: "licensed_footage",
      previewOnly: true,
      worker: "Wikimedia Commons · license filter",
      status: "planned",
      createdAt: new Date().toISOString(),
    };
    setPreviewScanPlan(plan);
    setPreviewScanReport(null);
    const activityId = recordWorkspaceActivity({ stage: "preview.licensed.scan", tool: "Wikimedia Commons", state: "running", progress: 0, message: "Đang tìm footage tư liệu có license và chấm điểm tiềm năng dựng short…" });
    setLoading(true);
    setNotice("Đang quét footage có license…");
    try {
      if (!isTauri()) throw new Error("Cần mở bản app desktop để chạy worker Wikimedia thật; trang web dev chỉ hiển thị giao diện.");
      const report = await invoke<PreviewScanReport>("scan_licensed_footage_discovery", {
        request: { projectId: selectedProjectId, maxResults: previewMaxResults },
      });
      setPreviewScanReport(report);
      const importedCards = report.cards.filter(isVideoPreviewCard);
      setPreviewCards((current) => {
        const byUrl = new Map(current.map((card) => [card.shareUrl, card]));
        importedCards.forEach((card) => {
          const existing = byUrl.get(card.shareUrl);
          byUrl.set(card.shareUrl, existing ? { ...card, addedToPlan: existing.addedToPlan, reviewStatus: existing.reviewStatus } : card);
        });
        return Array.from(byUrl.values()).slice(0, MAX_PREVIEW_CARDS);
      });
      if (importedCards[0]) setSelectedPreviewId(importedCards[0].previewId);
      const scanSucceeded = report.status === "success" || report.status === "partial";
      setPreviewScanPlan({ ...plan, worker: report.worker || plan.worker, status: scanSucceeded ? "success" : "blocked" });
      const message = report.message || (scanSucceeded ? `Đã nhận ${importedCards.length} footage candidate.` : "Kho footage chưa trả được kết quả.");
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: scanSucceeded ? "success" : "blocked", progress: scanSucceeded ? 1 : 0, message, output: report.reportPath, nextAction: scanSucceeded ? "Xem điểm tiềm năng, license và file page; chỉ tải sau khi xác nhận quyền." : "Kiểm tra kết nối Wikimedia Commons hoặc thử lại sau." });
      report.platformResults.forEach((result) => {
        const resultState: WorkspaceActivityState = result.status === "success" ? "success" : result.status === "error" ? "error" : "blocked";
        recordWorkspaceActivity({ stage: "preview.licensed.platform", tool: report.worker || "Wikimedia Commons", state: resultState, progress: result.status === "success" ? 1 : 0, message: `${previewPlatformLabel(result.platform)}: ${result.message}`, output: result.discoveryUrl });
      });
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi licensed footage scan không xác định";
      const message = `Không chạy được quét footage: ${detail.slice(0, 360)}`;
      setPreviewScanPlan({ ...plan, status: "blocked" });
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", progress: 0, message, nextAction: "Kiểm tra Python và thử lại khi có kết nối mạng." });
    } finally {
      setLoading(false);
    }
  }

  function togglePreviewPlatform(platform: PreviewPlatform) {
    setPreviewPlatforms((current) => {
      return current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform];
    });
  }

  function importPreviewUrls() {
    if (!selectedProjectId) {
      const message = "Hãy chọn project trước khi nạp URL preview.";
      setNotice(message);
      return;
    }
    const lines = previewUrls.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, MAX_PREVIEW_CARDS);
    if (!lines.length) {
      setNotice("Dán ít nhất một URL video, mỗi dòng một URL.");
      return;
    }
    const parsed = lines.map((url, index) => createVideoPreviewCard(url, previewPlatforms.length ? previewPlatforms : null, index)).filter((card): card is VideoPreviewCard => Boolean(card));
    const invalidCount = lines.length - parsed.length;
    if (!parsed.length) {
      const platformLabel = previewPlatforms.length ? previewPlatforms.map(previewPlatformLabel).join(", ") : "đã chọn";
      const message = `Không có URL ${platformLabel} hợp lệ trong danh sách.`;
      setNotice(message);
      recordWorkspaceActivity({ stage: "preview.import.validate", tool: "Preview Radar", state: "blocked", message, nextAction: "Kiểm tra đúng host nền tảng và dùng https." });
      return;
    }
    setPreviewCards((current) => {
      const byUrl = new Map(current.map((card) => [card.shareUrl, card]));
      parsed.forEach((card) => {
        const existing = byUrl.get(card.shareUrl);
        byUrl.set(card.shareUrl, existing ? { ...card, ...existing } : card);
      });
      return Array.from(byUrl.values()).slice(0, MAX_PREVIEW_CARDS);
    });
    setPreviewUrls("");
    const firstNew = parsed[0];
    if (firstNew) setSelectedPreviewId(firstNew.previewId);
    const message = `Đã nạp ${parsed.length} URL vào kho preview${invalidCount ? `; bỏ qua ${invalidCount} URL không đúng nền tảng` : ""}.`;
    setNotice(message);
    recordWorkspaceActivity({ stage: "preview.import.manual", tool: "Preview Radar", state: "success", progress: 1, message, nextAction: "Chọn card để xem preview hoặc đưa vào plan tham khảo." });
  }

  function togglePreviewPlan(previewId: string) {
    const card = previewCards.find((item) => item.previewId === previewId);
    if (!card) return;
    const addedToPlan = !card.addedToPlan;
    setPreviewCards((current) => current.map((item) => item.previewId === previewId ? { ...item, addedToPlan } : item));
    setNotice(addedToPlan ? `Đã đưa “${card.title}” vào plan tham khảo.` : "Đã bỏ video khỏi plan tham khảo.");
    recordWorkspaceActivity({ stage: "preview.plan.reference", tool: "Preview Radar", state: "success", message: addedToPlan ? `Đã chọn ${previewPlatformLabel(card.platform)} làm nguồn tham khảo.` : "Đã bỏ một video khỏi plan tham khảo.", nextAction: "Dùng nhịp, hook và cấu trúc để viết nội dung gốc; không sao chép media nguồn." });
  }

  function clearPreviewLibrary() {
    if (!previewCards.length || !window.confirm("Xóa toàn bộ card preview của project này?")) return;
    setPreviewCards([]);
    setSelectedPreviewId(null);
    setNotice("Đã xóa kho preview của project hiện tại.");
  }

  function selectPreviewCard(previewId: string | null) {
    setSelectedPreviewId(previewId);
    setPreviewRightsStatus("unknown");
    setPreviewDownloadReport(null);
  }

  function reviewSelectedPreview(status: PreviewReviewStatus) {
    const card = previewCards.find((item) => item.previewId === selectedPreviewId);
    if (!card) return;
    const label = status === "keep" ? "Giữ lại để làm nội dung riêng" : status === "skip" ? "Bỏ qua video này" : "Đưa về trạng thái chưa review";
    setPreviewCards((current) => current.map((item) => item.previewId === card.previewId ? { ...item, reviewStatus: status, reviewNote: label } : item));
    setNotice(`${label}: “${card.title}”.`);
    recordWorkspaceActivity({ stage: "preview.review", tool: "Preview Radar", state: "success", progress: 1, message: `${label}: ${previewPlatformLabel(card.platform)}.`, nextAction: status === "keep" ? "Đưa card vào plan sau khi kiểm tra link, quyền và nội dung." : "Chọn card khác để review." });
  }

  function changePreviewRightsStatus(value: AssetView["rightsStatus"]) {
    setPreviewRightsStatus(value);
    const userConfirmed = ["personal", "owned", "licensed", "public_domain"].includes(value);
    if (!selectedPreviewId) return;
    setPreviewCards((current) => current.map((card) => card.previewId === selectedPreviewId
      ? {
          ...card,
          reuseStatus: userConfirmed ? "user_confirmed" : "permission_required",
          reuseEvidence: userConfirmed
            ? "Người dùng đã tự xác nhận quyền trong Rights Gate; app không tự kiểm chứng giấy phép."
            : "Chưa có xác nhận quyền sử dụng; không coi URL public là quyền reup.",
        }
      : card));
  }

  async function downloadSelectedReferenceVideo() {
    const selectedCard = previewCards.find((card) => card.previewId === selectedPreviewId) ?? null;
    if (!selectedProjectId || !selectedCard) {
      const message = "Hãy chọn project và một card video trước khi tải.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "reference_video.download.validate", tool: "yt-dlp", state: "blocked", message, nextAction: "Chọn card preview rồi xác nhận quyền sử dụng." });
      return;
    }
    if (!["personal", "owned", "licensed", "public_domain"].includes(previewRightsStatus)) {
      const message = "Chưa tải: hãy xác nhận bạn có quyền dùng video này trước.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "reference_video.download.rights", tool: "Rights Gate", state: "blocked", message, nextAction: "Chọn personal, owned, licensed hoặc public_domain nếu đúng sự thật." });
      return;
    }
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "reference_video.download", tool: "yt-dlp", state: "running", progress: 0, message: "Đang tải bản video được phép vào project; chưa xử lý watermark và chưa đăng lại." });
    setLoading(true);
    setPreviewDownloadReport(null);
    setNotice("Đang tải video tham khảo…");
    try {
      const report = await invoke<ReferenceVideoDownloadReport>("download_reference_video", {
        request: {
          projectId: selectedProjectId,
          sourceUrl: selectedCard.shareUrl,
          downloadUrl: selectedCard.mediaUrl ?? undefined,
          title: selectedCard.title,
          rightsStatus: previewRightsStatus,
        },
      });
      setPreviewDownloadReport(report);
      if (report.asset) setAssets((current) => [report.asset!, ...current.filter((asset) => asset.assetId !== report.asset!.assetId)]);
      if (report.relativePath && report.status === "succeeded") {
        setVideoVisionPath(report.relativePath);
        setSubtitleVideoPath(report.relativePath);
      }
      const activityState = report.status === "succeeded" ? "success" : report.status === "blocked" ? "blocked" : "error";
      updateWorkspaceActivity(activityId, { state: activityState, progress: report.status === "succeeded" ? 1 : 0, durationMs: Math.round(performance.now() - startedAt), message: report.message, output: report.relativePath ?? undefined, nextAction: report.status === "succeeded" ? "Mở Subtitle Studio để nạp transcript/SRT và review trước khi làm voice." : "Sửa quyền hoặc cấu hình yt-dlp rồi thử lại." });
      setNotice(report.message);
      if (report.status === "succeeded") await refresh();
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi tải video không xác định";
      const message = `Không tải được video tham khảo: ${detail.slice(0, 320)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra yt-dlp.exe trong Cài đặt và thử lại bằng URL công khai." });
    } finally {
      setLoading(false);
    }
  }

  function continueDownloadedToSubtitles() {
    if (!previewDownloadReport?.relativePath) return;
    setSubtitleVideoPath(previewDownloadReport.relativePath);
    setSubtitleProbe(null);
    setActiveNav("subtitles");
    setNotice("Đã chuyển video sang Subtitle Studio. Hãy nạp transcript/SRT, kiểm tra timestamp rồi mới xuất.");
  }

  function continueDownloadedToVoice() {
    setActiveNav("voice");
    setNotice("Đã mở Voice Studio. Video đã tải nằm trong project; hãy chuẩn bị text lời đọc và review quyền giọng trước khi tạo audio.");
  }

  function selectTopicProfile(profileId: string) {
    const profile = topicProfiles.find((item) => item.profileId === profileId);
    setSelectedTopicProfileId(profileId);
    if (profile) {
      setSelectedRecipe(profile.defaultRecipeKind);
      const firstTemplate = promptTemplates.find((template) => profile.promptTemplateIds.includes(template.templateId));
      if (firstTemplate) setSelectedPromptTemplateId(firstTemplate.templateId);
      if (!contentGoal.trim()) setContentGoal(profile.defaultAudience);
    }
  }

  async function previewTopicWorkflow() {
    if (!selectedTopicProfile || topic.trim().length < 3) {
      const message = "Hãy chọn profile và nhập chủ đề ít nhất 3 ký tự trước khi xem prompt.";
      setTopicWorkflowMessage(message);
      setNotice(message);
      recordWorkspaceActivity({ stage: "brief.validate", tool: "Prompt Studio", state: "blocked", message, nextAction: "Nhập chủ đề rồi thử lại." });
      return;
    }
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "prompt.compile", tool: "Prompt Studio", state: "running", message: "Đang biên soạn prompt từ brief; chưa gọi provider.", progress: 0 });
    setLoading(true);
    try {
      const preview = await invoke<TopicPromptPreview>("preview_topic_prompt", {
        request: {
          profileId: selectedTopicProfile.profileId,
          templateId: selectedPromptTemplateId,
          topic: topic.trim(),
          audience: selectedTopicProfile.defaultAudience,
          contentGoal: contentGoal.trim(),
          additionalPrompt: additionalPrompt.trim(),
        },
      });
      setTopicPromptPreview(preview);
      setSelectedRecipe(preview.selectedRecipeKind);
      const message = "Đã tạo bản xem trước prompt; chưa gọi model, chưa tạo media và chưa ghi project.";
      setTopicWorkflowMessage(message);
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra prompt rồi tạo storyboard." });
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      const message = `Không tạo được bản xem trước prompt: ${detail.slice(0, 360)}`;
      setTopicWorkflowMessage(message);
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra profile/template rồi thử lại." });
    } finally {
      setLoading(false);
    }
  }

  async function generateLocalScript(briefApproved: boolean, referenceContext = ""): Promise<LocalScriptDocument | null> {
    if (!selectedProjectId) {
      const message = "Hãy tạo hoặc chọn dự án trước khi sinh script.";
      setTopicWorkflowMessage(message);
      setNotice(message);
      recordWorkspaceActivity({ stage: "storyboard.validate", tool: "Workspace", state: "blocked", message, nextAction: "Tạo hoặc chọn project local." });
      return null;
    }
    if (!topic.trim()) {
      const message = "Hãy nhập prompt chính trước khi xây dựng workflow.";
      setTopicWorkflowMessage(message);
      setNotice(message);
      recordWorkspaceActivity({ stage: "storyboard.validate", tool: "Workspace", state: "blocked", message, nextAction: "Nhập một prompt mô tả video muốn tạo." });
      return null;
    }
    if (!briefApproved) {
      const message = "Hãy xem và duyệt brief trước khi sinh script.";
      setTopicWorkflowMessage(message);
      setNotice(message);
      recordWorkspaceActivity({ stage: "storyboard.validate", tool: "Workspace", state: "blocked", message, nextAction: "Xem brief rồi duyệt trước khi sinh script." });
      return null;
    }
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "storyboard.expand", tool: "Local worker", state: "running", message: "Đang tạo storyboard và shot list từ brief đã duyệt.", progress: 0 });
    setLoading(true);
    try {
      const referenceText = referenceContext.trim();
      const timingRequirements = inferPromptTimingRequirements(topic);
      const sourcePromptHash = await sha256Text(promptSourceFingerprintInput(topic, contentGoal, additionalPrompt, referenceText));
      const report = await invoke<LocalScriptReviewReport>("generate_local_video_script", {
        projectId: selectedProjectId,
        topic: topic.trim(),
        objective: contentGoal.trim() || "Tự phân tích prompt, chia shot và chọn cấu trúc hình ảnh phù hợp.",
        additionalPrompt: additionalPrompt.trim(),
        referenceContext: referenceText || null,
        sourcePromptHash,
        requestedShotCount: timingRequirements.shotCount,
        requestedDurationSeconds: timingRequirements.durationSeconds,
        approved: briefApproved,
      });
      const enrichedScript: LocalScriptDocument = {
        ...report.script,
        sourcePromptHash,
        requestedShotCount: timingRequirements.shotCount ?? report.script.segments.length,
        requestedDurationSeconds: timingRequirements.durationSeconds ?? report.script.totalDurationSeconds,
      };
      if (!scriptMatchesPrompt(enrichedScript, sourcePromptHash, timingRequirements)) {
        throw new Error(`Planner trả script không khớp prompt: cần ${timingRequirements.shotCount ?? "đủ theo brief"} shot và ${timingRequirements.durationSeconds ?? "thời lượng đã suy ra"} giây, nhận ${enrichedScript.segments.length} shot/${enrichedScript.totalDurationSeconds}s. Script bị loại, chưa dựng Blender/Flow.`);
      }
      const enrichedReport: LocalScriptReviewReport = { ...report, script: enrichedScript };
      setLocalScriptReview(enrichedReport);
      setLocalVideoReport(null);
      const message = "Đã phân tích prompt và dựng workflow nháp. Kiểm tra các shot rồi bấm Preview hoặc Xuất video.";
      setTopicWorkflowMessage(message);
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Sửa prompt/shot nếu cần rồi bấm Preview." });
      return enrichedScript;
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      const message = `Không sinh được script: ${detail.slice(0, 360)}`;
      setTopicWorkflowMessage(message);
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra project local và xem chi tiết lỗi." });
      return null;
    } finally {
      setLoading(false);
    }
  }

  function handleTopicInputChange(value: string) {
    setTopic(value);
    setLocalScriptReview(null);
    setLocalVideoReport(null);
    setTopicPromptPreview(null);
  }

  async function renderApprovedLocalVideo(script: LocalScriptDocument, scriptPath: string) {
    if (!selectedProjectId || !localScriptReview) {
      const message = "Chưa có project hoặc script để duyệt và kết xuất.";
      setTopicWorkflowMessage(message);
      setNotice(message);
      recordWorkspaceActivity({ stage: "render.validate", tool: "Workspace", state: "blocked", message, nextAction: "Tạo storyboard và chọn project trước." });
      return;
    }
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "render.local_video", tool: "Blender/FFmpeg", state: "running", message: "Đang tạo voice, subtitle và MP4 cục bộ.", progress: 0 });
    setTopicWorkflowMessage("Đã nhận lệnh duyệt. Đang tạo voice, subtitle và MP4 cục bộ; vui lòng chờ đến khi có kết quả.");
    setNotice("Đã nhận lệnh duyệt script; đang bắt đầu local render…");
    setLoading(true);
    try {
      const normalizedVoiceSettings: VoiceSettings = {
        ...voiceSettings,
        ...(script.voiceSettings ?? {}),
        voiceCueBySegment: { ...voiceSettings.voiceCueBySegment, ...(script.voiceSettings?.voiceCueBySegment ?? {}) },
      };
      const report = await invoke<LocalVideoPipelineReport>("render_approved_local_video", {
        projectId: selectedProjectId,
        scriptPath,
        script: { ...script, approvalStatus: "approved", voiceSettings: normalizedVoiceSettings },
        voice: normalizedVoiceSettings.presetVoice,
        approved: true,
      });
      setLocalVideoReport(report);
      setLocalScriptReview((current) => current ? { ...current, script: { ...script, approvalStatus: "approved" } } : current);
      const successMessage = `Đã kết xuất MP4 ${report.videoPath}; hãy mở file để xem/nghe rồi duyệt bàn giao.`;
      setTopicWorkflowMessage(successMessage);
      setNotice(successMessage);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message: successMessage, output: report.videoPath, nextAction: "Mở preview và kiểm tra chất lượng trước khi bàn giao." });
      await refresh();
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      const errorMessage = `Không kết xuất được video: ${detail.slice(0, 360)}`;
      setTopicWorkflowMessage(errorMessage);
      setNotice(errorMessage);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message: errorMessage, nextAction: "Xem log tool và thử lại khi đã sửa blocker." });
    } finally {
      setLoading(false);
    }
  }

  async function buildBlenderShotPreview(script: LocalScriptDocument, renderVideo = false): Promise<BlenderShotPreviewReport | null> {
    if (!selectedProjectId) {
      const message = "Hãy tạo hoặc chọn project trước khi dựng Blender preview.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "blender.validate", tool: "Blender", state: "blocked", message, nextAction: "Tạo hoặc chọn project local." });
      return null;
    }
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: renderVideo ? "blender.render.final" : "blender.render.preview", tool: "Blender", state: "running", message: renderVideo ? "Đang dựng scene và render Blender output." : "Đang dựng scene 3D preview local.", progress: 0 });
    setLoading(true);
    setNotice("Đang chuyển shot plan sang Blender preview local…");
    try {
      const report = await invoke<BlenderShotPreviewReport>("build_blender_shot_preview", { request: { projectId: selectedProjectId, script, renderVideo } });
      const boardCount = report.shotPreviewPaths?.length ?? report.shotCount;
      setNotice(`Đã dựng storyboard Blender: ${boardCount} shot board + edit plan.`);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message: `Blender đã tạo scene, ${boardCount} shot board và edit plan; output đã trả về để review.`, output: report.editPlanPath ?? report.videoPath ?? report.previewPath, nextAction: "Review storyboard rồi chuẩn bị prompt + ảnh cho Omni." });
      return report;
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "Blender chưa sẵn sàng";
      const message = `Không tạo được Blender preview: ${detail.slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra Blender output và cấu hình tool." });
      return null;
    } finally { setLoading(false); }
  }

  async function prepareBrowserHandoffFromBlender(script: LocalScriptDocument, report: BlenderShotPreviewReport) {
    if (!selectedProjectId) {
      recordWorkspaceActivity({ stage: "browser.handoff.validate", tool: "BrowserMCP", state: "blocked", message: "Chưa có project để tạo handoff pack.", nextAction: "Tạo hoặc chọn project local." });
      return;
    }
    const storyboardPaths = report.shotPreviewPaths?.length ? report.shotPreviewPaths : [report.previewPath];
    const referencePaths = (script.referenceAssetPaths ?? []).filter(Boolean);
    const comfyuiPaths = (script.comfyuiAssetPaths ?? []).filter(Boolean);
    const geminiPaths = (script.geminiAssetPaths ?? []).filter(Boolean);
    // BrowserMCP handoff contract allows at most 8 input assets. Prefer one
    // Gemini still per shot when available; otherwise use the corresponding
    // semantic Blender board. Keep the user's reference in the remaining slot.
    const perShotPaths = storyboardPaths.map((boardPath, index) => comfyuiPaths[index] ?? geminiPaths[index] ?? boardPath).slice(0, 8);
    const assetPaths = [...new Set([...referencePaths, ...perShotPaths])].slice(0, 8);
    const handoffId = `handoff-${Date.now()}`;
    const outputDirectory = `outputs/browser-handoff/${handoffId}`;
    const compact = (value: string, limit: number) => {
      const normalized = value.replace(/\s+/g, " ").trim();
      return normalized.length > limit ? `${normalized.slice(0, Math.max(1, limit - 1)).trimEnd()}…` : normalized;
    };
    const sceneMode = script.segments.find((segment) => segment.sceneMode)?.sceneMode ?? "generic_cinematic";
    const globalPrompt = [
      "GOOGLE FLOW / OMNI FINAL VIDEO REQUEST",
      "Create one coherent, polished final video from the attached Blender storyboard images and shot references.",
      `Project concept: ${compact(script.title, 220)}. Scene mode: ${sceneMode}.`,
      "The attached Blender images are SEMANTIC STORYBOARD BOARDS, not final renders. Their primitive grammar is authoritative: cyan circle/ellipse = main subject, orange capsule = person or scale marker, blue blocks = environment, violet blocks/cylinders = props or clues, yellow block = camera/framing, orange arrow = action direction. Replace every primitive with the subject and world described by the shot prompt; never output the proxy geometry, contact-sheet layout, UI, labels or debug geometry.",
      "Use every beat anchor as a real visual change inside the shot: establish composition, action movement, reveal/new clue or subject, then resolve/transition. Use attached user reference images as identity/style/composition guidance when present.",
      "If ComfyUI or Gemini sketch images are attached, treat them as additional shot design references only; preserve the semantic beat plan and replace any rough shapes with final 3D visuals.",
      "GLOBAL VISUAL BIBLE: keep one hero subject with identical silhouette, proportions, materials, palette and screen direction across every shot. Use physically plausible materials, readable contact shadows, atmospheric depth, clean cinematic motion and a consistent 16:9 composition.",
      "QUALITY AND SAFETY: no random characters or props, no text artifacts, no logos, no watermark, no morphing, no flicker, no broken geometry, no camera jumps. Preserve the intended narration meaning but do not burn subtitles or UI into the generated picture.",
      "SHOT PLAN:",
    ].join("\n");
    const shotBudget = Math.max(220, Math.floor((3900 - globalPrompt.length) / Math.max(1, script.segments.length)));
    const purposeLimit = Math.min(110, Math.max(60, Math.floor(shotBudget * 0.18)));
    const continuityLimit = Math.min(120, Math.max(70, Math.floor(shotBudget * 0.18)));
    const beatLimit = Math.min(260, Math.max(120, Math.floor(shotBudget * 0.3)));
    const visualLimit = Math.max(140, shotBudget - purposeLimit - continuityLimit - beatLimit - 92);
    const shotLines = script.segments.map((segment, index) => {
      const beatText = (segment.beats ?? []).map((beat) => `${beat.imageRole}@${Math.round(beat.timeFraction * 100)}%: ${beat.action}; camera=${beat.cameraPrompt}`).join(" || ");
      const shot = [
        `SHOT ${String(index + 1).padStart(2, "0")} · ${segment.durationSeconds.toFixed(1)}s`,
        `Purpose: ${compact(segment.narration, purposeLimit)}`,
        `Visual direction: ${compact(segment.visualPrompt ?? segment.narration, visualLimit)}`,
        `Beat anchors (semantic storyboard): ${compact(beatText || "establish → action → reveal → resolve", beatLimit)}`,
        `Continuity: ${compact(segment.continuityNotes ?? "Preserve hero identity and screen direction.", continuityLimit)}`,
      ].join(" | ");
      return shot;
    });
    const prompt = `${globalPrompt}\n${shotLines.join("\n")}`;
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "browser.handoff.prepare", tool: "BrowserMCP", state: "running", message: "Đang chuẩn bị handoff pack từ shot revision hiện tại; chưa upload và chưa Generate.", progress: 0 });
    setLoading(true);
    try {
      const handoff = await invoke<BrowserHandoffReport>("prepare_browser_handoff", { request: { projectId: selectedProjectId, handoffId, targetUrl: "https://labs.google/fx/tools/flow", prompt, inputAssets: assetPaths.map((relativePath) => ({ relativePath, mediaKind: "image" })), outputDirectory, paidGeneration: false, rightsStatus: "generated_local", termsReviewed: false } });
      setNotice(`Đã chuẩn bị gói làm việc từ Blender: ${handoff.handoffPath}. BrowserOS neo sẽ được dùng cho bước Omni khi quy trình chạy.`);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message: "Đã tạo handoff pack local; Browser Handoff chỉ giữ kết nối BrowserOS neo.", output: handoff.handoffPath, nextAction: "Kiểm tra kết nối BrowserOS neo ở Connection Center." });
    } catch (error) {
      const message = `Không tạo được BrowserMCP handoff từ Blender: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra output Blender và quyền workspace." });
    } finally { setLoading(false); }
  }

  async function prepareGeminiStoryboardFromBlender(script: LocalScriptDocument, report: BlenderShotPreviewReport) {
    if (!selectedProjectId) {
      const message = "Chưa có project để tạo pack phác Gemini.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "gemini.storyboard.validate", tool: "Gemini / BrowserMCP", state: "blocked", message, nextAction: "Tạo hoặc chọn project local." });
      return;
    }
    const storyboardPaths = report.shotPreviewPaths?.length ? report.shotPreviewPaths : [report.previewPath];
    const inputPaths = [...new Set([...(script.referenceAssetPaths ?? []), ...(script.comfyuiAssetPaths ?? []), ...storyboardPaths])].slice(0, 8);
    const geminiHeader = [
      "GEMINI STORYBOARD IMAGE PASS — create reference stills, not final video.",
      "Generate one clean 16:9 concept image for each numbered SHOT below, one at a time if the interface only returns one image per request.",
      "Use the attached semantic Blender board as layout guidance: cyan circle/ellipse is the main subject, orange capsule is a person/scale marker, blue blocks are environment, violet markers are props/clues, yellow block is camera framing, orange arrow is action direction.",
      "Replace primitives with a readable cinematic 3D sketch matching the user's prompt. Keep the same subject identity, palette and screen direction across shots. Do not draw contact-sheet UI, debug primitives, labels, watermark or text inside the generated image.",
      "Save/label each downloaded image as GEMINI-SHOT-01.png, GEMINI-SHOT-02.png, etc. These stills will be imported locally and attached to the later Google Flow/Omni handoff; they are references, not the final video.",
    ].join("\n");
    const compactGemini = (value: string, limit: number) => {
      const normalized = value.replace(/\s+/g, " ").trim();
      return normalized.length > limit ? `${normalized.slice(0, Math.max(1, limit - 1)).trimEnd()}…` : normalized;
    };
    const perShotLimit = Math.max(180, Math.floor((3900 - geminiHeader.length - 20) / Math.max(1, script.segments.length)));
    const shotLines = script.segments.map((segment, index) => {
      const beatText = (segment.beats ?? []).map((beat) => `${beat.imageRole}: ${beat.action}; camera=${beat.cameraPrompt}`).join(" | ");
      return `SHOT ${String(index + 1).padStart(2, "0")} · ${segment.durationSeconds.toFixed(1)}s · ${compactGemini(`${segment.visualPrompt ?? segment.narration} · BEATS: ${beatText || "establish → action → reveal → resolve"}`, perShotLimit)}`;
    });
    const prompt = `${geminiHeader}\n${shotLines.join("\n")}`;
    const handoffId = `gemini-storyboard-${Date.now()}`;
    const outputDirectory = `outputs/browser-handoff/${handoffId}`;
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "gemini.storyboard.prepare", tool: "Gemini / BrowserMCP", state: "running", message: "Đang chuẩn bị pack prompt + semantic storyboard cho Gemini; chưa upload hay Generate tự động.", progress: 0 });
    setLoading(true);
    try {
      const handoff = await invoke<BrowserHandoffReport>("prepare_browser_handoff", { request: { projectId: selectedProjectId, handoffId, targetUrl: "https://gemini.google.com/app", prompt, inputAssets: inputPaths.map((relativePath) => ({ relativePath, mediaKind: "image" })), outputDirectory, paidGeneration: false, rightsStatus: "generated_local", termsReviewed: false } });
      const message = `Đã tạo pack Gemini: ${handoff.handoffPath}. Mở Gemini, tạo ảnh từng SHOT, tải PNG về rồi bấm “Nhập ảnh Gemini” ở Quy trình video.`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, output: handoff.handoffPath, nextAction: "Mở pack prompt, tạo ảnh từng shot, tải về local và nhập lại workspace." });
    } catch (error) {
      const message = `Không tạo được pack Gemini: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra project, output Blender và BrowserMCP allowlist." });
    } finally { setLoading(false); }
  }

  // Kept only so old native commands/cache records remain source-compatible;
  // no active UI route calls these legacy Blender handoff functions.
  void buildBlenderShotPreview;
  void prepareBrowserHandoffFromBlender;
  void prepareGeminiStoryboardFromBlender;

  async function testCommandCode() {
    setCommandCodeTesting(true);
    try {
      const report = await invoke<CommandCodeProbeReport>("test_commandcode_chat");
      setCommandCodeReport(report);
      setNotice(report.status === "succeeded" ? "Command Code đã trả lời thành công." : `Kiểm tra Command Code: ${displayCommandCodeStatus(report.status)}. ${report.message}`);
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      setNotice(`Không chạy được bước kiểm tra Command Code: ${detail.slice(0, 240)}`);
    } finally {
      setCommandCodeTesting(false);
    }
  }

  async function loadPromptPresets(projectId = selectedProjectId) {
    if (!projectId) {
      setPromptPresets([]);
      return;
    }
    try {
      const presets = await invoke<PromptPreset[]>("list_prompt_presets", { projectId, includeArchived: true });
      setPromptPresets(presets);
    } catch (error) {
      const message = `Không tải được prompt preset: ${String(error).slice(0, 240)}`;
      setNotice(message);
      recordWorkspaceActivity({ stage: "prompt_preset.load", tool: "Prompt Studio", state: "error", message, nextAction: "Kiểm tra project/database rồi thử làm mới." });
    }
  }

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

  async function loadAssetsAndReferenceSets(projectId = selectedProjectId) {
    if (!projectId) {
      setAssets([]);
      setReferenceSets([]);
      setAssetPackReviews([]);
      setAssetPackBlenderBinding(null);
      setAssetPackBlenderRun(null);
      return;
    }
    try {
      const [nextAssets, nextReferenceSets, nextAssetPacks] = await Promise.all([
        invoke<AssetView[]>("list_assets", { projectId, includeArchived: true }),
        invoke<ReferenceSet[]>("list_reference_sets", { projectId, includeArchived: true }),
        invoke<AssetPackReview[]>("list_asset_pack_reviews", { projectId }),
      ]);
      setAssets(nextAssets);
      setReferenceSets(nextReferenceSets);
      setAssetPackReviews(nextAssetPacks);
      setAssetPackBlenderBinding(null);
      setAssetPackBlenderRun(null);
    } catch (error) {
      const message = `Không tải được asset/reference/Asset Pack: ${String(error).slice(0, 240)}`;
      setNotice(message);
      recordWorkspaceActivity({ stage: "asset_library.load", tool: "Asset Library", state: "error", message, nextAction: "Kiểm tra project/database rồi thử làm mới." });
    }
  }

  async function chooseAssetSource(): Promise<string | null> {
    try {
      const selected = await open({
        multiple: false,
        title: "Chọn asset reference local",
        filters: [{ name: "Reference assets", extensions: ["png", "jpg", "jpeg", "webp", "gif", "mp4", "mov", "webm", "wav", "mp3", "flac", "m4a", "ogg", "glb", "gltf", "obj", "fbx", "blend", "srt", "vtt", "ass", "pdf", "md", "json"] }],
      });
      if (typeof selected === "string") return selected;
      return null;
    } catch {
      setNotice("Không mở được hộp thoại chọn asset.");
      return null;
    }
  }

  async function chooseAssetPackSource(): Promise<string | null> {
    try {
      const selected = await open({
        multiple: false,
        title: "Chọn asset-pack.json trong workspace project",
        filters: [{ name: "Auto3Dvideo Asset Pack", extensions: ["json"] }],
      });
      return typeof selected === "string" ? selected : null;
    } catch {
      setNotice("Không mở được hộp thoại chọn Asset Pack.");
      return null;
    }
  }

  async function registerAssetPackSource(packPath: string): Promise<AssetPackReview[] | null> {
    if (!selectedProjectId) return null;
    try {
      const packs = await invoke<AssetPackReview[]>("register_asset_pack_source", { input: { projectId: selectedProjectId, packPath } });
      setAssetPackReviews(packs);
      setNotice(`Đã nạp Asset Pack; ${packs.reduce((count, pack) => count + pack.items.length, 0)} item đang chờ review.`);
      recordWorkspaceActivity({ stage: "asset_pack.register", tool: "Asset Pack Review", state: "success", message: `Đã nạp Asset Pack từ ${packs.find((pack) => pack.source.packRelativePath)?.source.packRelativePath ?? packPath}.`, output: packPath, nextAction: "Review từng item, pass checklist và quyền trước khi approve." });
      return packs;
    } catch (error) {
      const message = `Không nạp được Asset Pack: ${String(error).slice(0, 360)}`;
      setNotice(message);
      recordWorkspaceActivity({ stage: "asset_pack.register", tool: "Asset Pack Review", state: "error", message, nextAction: "Chọn đúng asset-pack.json có asset-items.json cùng thư mục." });
      return null;
    }
  }

  async function updateAssetPackItemReview(input: { packId: string; assetItemId: string; reviewState: AssetPackReviewItem["reviewState"]; rightsStatus: AssetView["rightsStatus"]; acceptanceChecks: AssetPackAcceptanceCheck[]; note: string }): Promise<AssetPackReview | null> {
    if (!selectedProjectId) return null;
    try {
      const updated = await invoke<AssetPackReview>("update_asset_pack_item_review", { input: { projectId: selectedProjectId, ...input } });
      setAssetPackReviews((current) => current.map((pack) => pack.packId === updated.packId ? updated : pack));
      const item = updated.items.find((candidate) => candidate.assetItemId === input.assetItemId);
      const message = item?.reviewState === "approved" ? `Đã approve asset “${item.title}”; output và hash không bị ghi đè.` : `Đã lưu review asset “${item?.title ?? input.assetItemId}”.`;
      setNotice(message);
      recordWorkspaceActivity({ stage: "asset_pack.item_review", tool: "Asset Pack Review", state: "success", message, output: `asset-pack:${updated.packId}/${input.assetItemId}`, nextAction: item?.reviewState === "approved" ? "Chỉ dùng asset approved để bind Blender/shot." : "Hoàn thành checklist và quyền rồi approve." });
      return updated;
    } catch (error) {
      const message = `Không lưu được review Asset Pack: ${String(error).slice(0, 360)}`;
      setNotice(message);
      recordWorkspaceActivity({ stage: "asset_pack.item_review", tool: "Asset Pack Review", state: "error", message, nextAction: "Kiểm tra quyền và các acceptance checks bắt buộc." });
      return null;
    }
  }

  async function prepareAssetPackBlenderBinding(packId: string): Promise<AssetPackBlenderBindingReport | null> {
    if (!selectedProjectId) return null;
    try {
      setAssetPackBlenderBinding(null);
      setAssetPackBlenderRun(null);
      setNotice("Đang kiểm tra approved asset, hash, scale và continuity trước khi tạo Blender job…");
      const report = await invoke<AssetPackBlenderBindingReport>("prepare_asset_pack_blender_binding", { projectId: selectedProjectId, packId });
      setAssetPackBlenderBinding(report);
      const message = report.status === "ready_for_blender_review"
        ? `Đã chuẩn bị Blender binding ${report.bindingId}; chưa chạy Blender.`
        : `Blender binding bị chặn: ${report.blockers.slice(0, 2).join("; ") || "Asset Pack chưa đạt gate"}.`;
      setNotice(message);
      recordWorkspaceActivity({ stage: "asset_pack.blender_binding", tool: "Blender binding", state: report.status === "ready_for_blender_review" ? "success" : "blocked", message, output: report.bindingPath ?? report.jobPath ?? report.bindingId, nextAction: report.status === "ready_for_blender_review" ? "Mở binding/job JSON để review rồi mới cho phép chạy Blender preview." : "Approve đủ item, kiểm tra quyền/hash/scale/continuity rồi thử lại." });
      return report;
    } catch (error) {
      const message = `Không chuẩn bị được Blender binding: ${String(error).slice(0, 360)}`;
      setNotice(message);
      recordWorkspaceActivity({ stage: "asset_pack.blender_binding", tool: "Blender binding", state: "error", message, nextAction: "Kiểm tra Asset Pack source, output file và database review." });
      return null;
    }
  }

  async function runAssetPackBlenderBinding(bindingId: string): Promise<AssetPackBlenderBindingRunReport | null> {
    if (!selectedProjectId) return null;
    setLoading(true);
    try {
      setAssetPackBlenderRun(null);
      setNotice("Đang chạy Blender reference preview local; app sẽ kiểm tra đủ scene, report và frame output trước khi báo thành công…");
      const report = await invoke<AssetPackBlenderBindingRunReport>("run_asset_pack_blender_binding", { projectId: selectedProjectId, bindingId });
      setAssetPackBlenderRun(report);
      setNotice(report.message);
      recordWorkspaceActivity({ stage: "asset_pack.blender_binding.preview", tool: "Blender", state: "success", message: report.message, output: report.reportPath, nextAction: "Mở các frame preview và duyệt chất lượng/reference trước khi dựng final." });
      return report;
    } catch (error) {
      const message = `Không chạy được Blender preview: ${String(error).slice(0, 360)}`;
      setNotice(message);
      recordWorkspaceActivity({ stage: "asset_pack.blender_binding.preview", tool: "Blender", state: "error", message, nextAction: "Kiểm tra Blender đã được cấu hình, binding còn mới và output chưa tồn tại." });
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function importAsset(input: { sourcePath: string; title: string; mediaKind: string; sourceUri: string | null; tags: string[]; note: string; rightsStatus: AssetView["rightsStatus"] }): Promise<AssetView | null> {
    if (!selectedProjectId) {
      const message = "Chưa có project để nhập asset.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "asset.import.validate", tool: "Asset Library", state: "blocked", message, nextAction: "Tạo hoặc chọn project local." });
      return null;
    }
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "asset.import", tool: "Asset Library", state: "running", message: `Đang kiểm tra, hash và nhập asset “${input.title.trim() || "chưa đặt tên"}”.`, progress: 0 });
    setLoading(true);
    try {
      const asset = await invoke<AssetView>("import_asset", { input: { ...input, projectId: selectedProjectId } });
      setAssets((current) => [asset, ...current.filter((item) => item.assetId !== asset.assetId)]);
      const message = asset.status === "quarantined" ? `Đã nhập asset ${asset.title}; đang quarantine vì quyền là ${asset.rightsStatus}.` : `Đã nhập asset ${asset.title}; SHA-256 đã được lưu.`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, output: asset.relativePath, nextAction: "Sửa quyền/metadata rồi gán asset vào reference set." });
      return asset;
    } catch (error) {
      const message = `Không nhập được asset: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra file, loại asset, quyền và workspace rồi thử lại." });
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function updateAssetMetadata(assetId: string, draft: AssetMetadataDraft): Promise<AssetView | null> {
    if (!selectedProjectId) return null;
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "asset.metadata.update", tool: "Asset Library", state: "running", message: "Đang lưu metadata/quyền asset; hash và đường dẫn bất biến.", progress: 0 });
    setLoading(true);
    try {
      const asset = await invoke<AssetView>("update_asset_metadata", { input: { projectId: selectedProjectId, assetId, title: draft.title, sourceUri: draft.sourceUri.trim() || null, tags: draft.tags.split(",").map((value) => value.trim()).filter(Boolean), note: draft.note, rightsStatus: draft.rightsStatus } });
      setAssets((current) => current.map((item) => item.assetId === asset.assetId ? asset : item));
      const message = `Đã lưu metadata asset “${asset.title}”.`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, output: `asset:${asset.assetId}`, nextAction: "Kiểm tra quyền rồi gán vào reference set nếu đã sẵn sàng." });
      return asset;
    } catch (error) {
      const message = `Không lưu được metadata asset: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Sửa trường bị lỗi rồi thử lưu lại." });
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function changeAssetState(asset: AssetView, action: "archive" | "restore") {
    if (!selectedProjectId) return;
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: `asset.${action}`, tool: "Asset Library", state: "running", message: `Đang ${action === "archive" ? "lưu trữ" : "khôi phục"} asset “${asset.title}”.`, progress: 0 });
    setLoading(true);
    try {
      const updated = await invoke<AssetView>(action === "archive" ? "archive_asset" : "restore_asset", { projectId: selectedProjectId, assetId: asset.assetId });
      setAssets((current) => current.map((item) => item.assetId === updated.assetId ? updated : item));
      const message = `Đã ${action === "archive" ? "lưu trữ" : "khôi phục"} asset “${updated.title}”.`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, output: `asset:${updated.assetId}`, nextAction: action === "archive" ? "Khôi phục nếu workflow cần asset này." : "Kiểm tra quyền trước khi dùng cho generation." });
    } catch (error) {
      const message = `Không thể ${action === "archive" ? "lưu trữ" : "khôi phục"} asset: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra log workspace và thử lại." });
    } finally {
      setLoading(false);
    }
  }

  async function createReferenceSet(input: { name: string; scope: ReferenceSet["scope"]; continuityNote: string }): Promise<ReferenceSet | null> {
    if (!selectedProjectId) return null;
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "reference_set.create", tool: "Reference Set", state: "running", message: `Đang tạo reference set “${input.name.trim() || "chưa đặt tên"}”.`, progress: 0 });
    setLoading(true);
    try {
      const set = await invoke<ReferenceSet>("create_reference_set", { input: { ...input, projectId: selectedProjectId } });
      setReferenceSets((current) => [set, ...current.filter((item) => item.referenceSetId !== set.referenceSetId)]);
      const message = `Đã tạo reference set “${set.name}”.`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, output: `reference_set:${set.referenceSetId}`, nextAction: "Chọn asset rồi gán vai trò reference cho set." });
      return set;
    } catch (error) {
      const message = `Không tạo được reference set: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Sửa tên/phạm vi set rồi thử lại." });
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function updateReferenceSet(referenceSetId: string, input: { name: string; scope: ReferenceSet["scope"]; continuityNote: string }): Promise<ReferenceSet | null> {
    if (!selectedProjectId) return null;
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "reference_set.update", tool: "Reference Set", state: "running", message: "Đang lưu cấu hình reference set.", progress: 0 });
    setLoading(true);
    try {
      const set = await invoke<ReferenceSet>("update_reference_set", { referenceSetId, input: { ...input, projectId: selectedProjectId } });
      setReferenceSets((current) => current.map((item) => item.referenceSetId === set.referenceSetId ? set : item));
      const message = `Đã cập nhật reference set “${set.name}”.`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, output: `reference_set:${set.referenceSetId}`, nextAction: "Kiểm tra assignments và dùng set cho shot workflow." });
      return set;
    } catch (error) {
      const message = `Không cập nhật được reference set: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Sửa trường bị lỗi rồi thử lại." });
      return null;
    } finally { setLoading(false); }
  }

  async function changeReferenceSetState(referenceSet: ReferenceSet, action: "archive" | "restore") {
    if (!selectedProjectId) return;
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: `reference_set.${action}`, tool: "Reference Set", state: "running", message: `Đang ${action === "archive" ? "lưu trữ" : "khôi phục"} reference set “${referenceSet.name}”.`, progress: 0 });
    setLoading(true);
    try {
      const updated = await invoke<ReferenceSet>(action === "archive" ? "archive_reference_set" : "restore_reference_set", { projectId: selectedProjectId, referenceSetId: referenceSet.referenceSetId });
      setReferenceSets((current) => current.map((item) => item.referenceSetId === updated.referenceSetId ? updated : item));
      const message = `Đã ${action === "archive" ? "lưu trữ" : "khôi phục"} reference set “${updated.name}”.`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, output: `reference_set:${updated.referenceSetId}`, nextAction: action === "archive" ? "Khôi phục nếu workflow cần set này." : "Tiếp tục gán asset cho set." });
    } catch (error) {
      const message = `Không thể ${action === "archive" ? "lưu trữ" : "khôi phục"} reference set: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra log workspace và thử lại." });
    } finally { setLoading(false); }
  }

  async function assignReference(input: { referenceSetId: string; assetId: string; role: ReferenceAssignment["role"]; strength: number; priority: number; shotId: string; notes: string; approved: boolean }): Promise<ReferenceSet | null> {
    if (!selectedProjectId) return null;
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "reference.assign", tool: "Reference Set", state: "running", message: "Đang gán asset vào reference set và chụp hash continuity.", progress: 0 });
    setLoading(true);
    try {
      const set = await invoke<ReferenceSet>("assign_reference", { input: { projectId: selectedProjectId, referenceSetId: input.referenceSetId, assetId: input.assetId, role: input.role, strength: input.strength, priority: input.priority, shotId: input.shotId.trim() || null, shotRangeStart: null, shotRangeEnd: null, crop: null, notes: input.notes, approved: input.approved } });
      setReferenceSets((current) => current.map((item) => item.referenceSetId === set.referenceSetId ? set : item));
      const message = `Đã gán asset vào set “${set.name}”.`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, output: `reference_set:${set.referenceSetId}`, nextAction: "Dùng reference set này khi compose shot; hash đã được giữ để phát hiện drift." });
      return set;
    } catch (error) {
      const message = `Không gán được reference: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra asset/set và vai trò reference rồi thử lại." });
      return null;
    } finally { setLoading(false); }
  }

  async function detachReference(assignmentId: string) {
    if (!selectedProjectId) return;
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "reference.detach", tool: "Reference Set", state: "running", message: "Đang tháo asset khỏi reference set.", progress: 0 });
    setLoading(true);
    try {
      await invoke("detach_reference", { projectId: selectedProjectId, assignmentId });
      await loadAssetsAndReferenceSets(selectedProjectId);
      const message = "Đã tháo reference assignment.";
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Chọn asset khác nếu shot cần reference mới." });
    } catch (error) {
      const message = `Không tháo được reference: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra assignment và thử lại." });
    } finally { setLoading(false); }
  }

  async function createPromptPreset(draft: PromptPresetDraft): Promise<PromptPreset | null> {
    if (!selectedProjectId) {
      const message = "Chưa có project để lưu prompt preset.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "prompt_preset.validate", tool: "Prompt Studio", state: "blocked", message, nextAction: "Tạo hoặc chọn project local." });
      return null;
    }
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "prompt_preset.create", tool: "Prompt Studio", state: "running", message: `Đang lưu preset “${draft.name.trim() || "chưa đặt tên"}” vào project local.`, progress: 0 });
    setLoading(true);
    try {
      const preset = await invoke<PromptPreset>("create_prompt_preset", { input: { ...draft, projectId: selectedProjectId } });
      setPromptPresets((current) => [preset, ...current.filter((item) => item.presetId !== preset.presetId)]);
      const message = `Đã lưu prompt preset “${preset.name}” ${preset.version}.`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, output: `prompt_preset:${preset.presetId}`, nextAction: "Áp dụng preset vào brief hoặc tiếp tục chỉnh prompt." });
      return preset;
    } catch (error) {
      const message = `Không lưu được prompt preset: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Sửa trường bị lỗi rồi thử lưu lại." });
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function updatePromptPreset(presetId: string, draft: PromptPresetDraft): Promise<PromptPreset | null> {
    if (!selectedProjectId) {
      const message = "Chưa có project để lưu phiên bản prompt.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "prompt_preset.validate", tool: "Prompt Studio", state: "blocked", message, nextAction: "Tạo hoặc chọn project local." });
      return null;
    }
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "prompt_preset.update", tool: "Prompt Studio", state: "running", message: `Đang lưu phiên bản mới cho “${draft.name.trim() || "chưa đặt tên"}”.`, progress: 0 });
    setLoading(true);
    try {
      const preset = await invoke<PromptPreset>("update_prompt_preset", { presetId, input: { ...draft, projectId: selectedProjectId } });
      setPromptPresets((current) => [preset, ...current]);
      const message = `Đã lưu phiên bản mới ${preset.version} cho “${preset.name}”.`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, output: `prompt_preset:${preset.presetId}`, nextAction: "Kiểm tra bản mới rồi áp dụng vào brief." });
      return preset;
    } catch (error) {
      const message = `Không lưu được phiên bản prompt: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Khôi phục preset nếu đang lưu trữ rồi thử lại." });
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function changePromptPresetState(preset: PromptPreset, action: "archive" | "restore") {
    if (!selectedProjectId) return;
    const label = action === "archive" ? "lưu trữ" : "khôi phục";
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: `prompt_preset.${action}`, tool: "Prompt Studio", state: "running", message: `Đang ${label} prompt preset “${preset.name}”.`, progress: 0 });
    setLoading(true);
    try {
      const updated = await invoke<PromptPreset>(action === "archive" ? "archive_prompt_preset" : "restore_prompt_preset", { projectId: selectedProjectId, presetId: preset.presetId });
      setPromptPresets((current) => current.map((item) => item.presetId === updated.presetId ? updated : item));
      const message = `Đã ${label} prompt preset “${updated.name}”.`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, output: `prompt_preset:${updated.presetId}`, nextAction: action === "archive" ? "Khôi phục nếu muốn dùng lại." : "Áp dụng preset vào brief khi sẵn sàng." });
    } catch (error) {
      const message = `Không thể ${label} prompt preset: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra log workspace và thử lại." });
    } finally {
      setLoading(false);
    }
  }

  function applyPromptPreset(draft: PromptPresetDraft, presetName: string) {
    const replacements: Record<string, string> = {
      topic: topic.trim() || "[chủ đề chưa nhập]",
      content_goal: contentGoal.trim() || "[mục tiêu chưa nhập]",
      topic_profile: selectedTopicProfile?.name ?? "[profile chưa chọn]",
      audience: selectedTopicProfile?.defaultAudience ?? "[đối tượng chưa nhập]",
    };
    const appliedPrompt = draft.template.replace(/\{\{([A-Za-z0-9_-]+)\}\}/g, (_match, key: string) => replacements[key] ?? `{{${key}}}`);
    setAdditionalPrompt(appliedPrompt);
    const message = `Đã áp dụng prompt preset “${presetName}” vào brief; chưa gọi provider.`;
    setNotice(message);
    recordWorkspaceActivity({ stage: "prompt_preset.apply", tool: "Prompt Studio", state: "success", message, output: "brief.additionalPrompt", nextAction: "Xem lại prompt rồi bấm Preview brief." });
  }

  async function refresh() {
    try {
      const [nextSnapshot, nextHealth, nextReadiness, nextProjects, nextJobs, nextRecipes, nextTopicProfiles, nextPromptTemplates, nextProviders, nextProviderEnvSnapshot, nextAuditEvents] = await Promise.all([
        invoke<AppSnapshot>("app_snapshot"),
        invoke<HealthStatus>("health_check"),
        invoke<ToolReadinessReport>("list_tool_readiness"),
        invoke<Project[]>("list_projects"),
        invoke<Job[]>("list_jobs"),
        invoke<Recipe[]>("list_recipe_catalog"),
        invoke<TopicProfile[]>("list_topic_profiles"),
        invoke<PromptTemplate[]>("list_prompt_templates"),
        invoke<ProviderProfile[]>("list_provider_catalog"),
        invoke<ProviderEnvSnapshot>("get_provider_env_snapshot"),
        invoke<AuditEvent[]>("list_audit_events", { projectId: null, limit: 20 }),
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

  async function toggleCloudGeneration() {
    const enabled = !snapshot.paidGenerationEnabled;
    try {
      const nextEnabled = await invoke<boolean>("set_cloud_generation_enabled", { enabled });
      setSnapshot((current) => ({ ...current, paidGenerationEnabled: nextEnabled }));
      const nextProviderEnvSnapshot = await invoke<ProviderEnvSnapshot>("get_provider_env_snapshot");
      setProviderEnvSnapshot(nextProviderEnvSnapshot);
      const message = nextEnabled
        ? "Đã bật Cloud/API: lần chạy tiếp theo được phép gọi Nano Banana MCP và nối Google Flow; có thể dùng credit, vẫn giữ gate review."
        : "Đã tắt Cloud/API: app chỉ chạy local, không gọi Nano Banana MCP hoặc Google Flow.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "cloud_generation.toggle", tool: "Provider gate", state: "success", message, nextAction: nextEnabled ? "Nhập prompt rồi bấm Tự làm toàn bộ." : "Bật lại Cloud/API nếu muốn tạo asset/video bên ngoài." });
    } catch (error) {
      setNotice(`Không đổi được trạng thái Cloud/API: ${String(error).slice(0, 280)}`);
    }
  }

  async function ensureCloudGenerationEnabled(): Promise<boolean> {
    if (snapshot.paidGenerationEnabled) return true;
    try {
      const nextEnabled = await invoke<boolean>("set_cloud_generation_enabled", { enabled: true });
      setSnapshot((current) => ({ ...current, paidGenerationEnabled: nextEnabled }));
      const nextProviderEnvSnapshot = await invoke<ProviderEnvSnapshot>("get_provider_env_snapshot");
      setProviderEnvSnapshot(nextProviderEnvSnapshot);
      return nextEnabled;
    } catch (error) {
      setNotice(`Không tự bật được Cloud/API: ${String(error).slice(0, 280)}`);
      return false;
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

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

  async function createProject() {
    setLoading(true);
    try {
      const created = await invoke<Project>("create_project", { name: projectName, workspaceRoot });
      setProjects((current) => [created, ...current]);
      setSelectedProjectId(created.projectId);
      setSnapshot((current) => ({ ...current, projectCount: current.projectCount + 1 }));
      setNotice(`Đã tạo project “${created.name}” với locale vi-VN và policy safe-local.`);
      setShowProjectForm(false);
      setActiveNav("recipes");
    } catch {
      setNotice("Không tạo được project. Kiểm tra tên và workspace path.");
    } finally {
      setLoading(false);
    }
  }

  async function deleteProject(project: Project) {
    const confirmed = window.confirm(`Xóa project “${project.name}”?\n\nDữ liệu project và các bản ghi liên quan sẽ bị xóa khỏi SQLite. Thư mục workspace trên ổ đĩa sẽ không bị xóa.`);
    if (!confirmed) return;
    setLoading(true);
    try {
      await invoke("delete_project", { projectId: project.projectId });
      const remaining = projects.filter((item) => item.projectId !== project.projectId);
      setProjects(remaining);
      if (project.projectId === selectedProjectId) {
        const nextProject = remaining[0];
        setSelectedProjectId(nextProject?.projectId ?? "");
        if (!nextProject) setActiveNav("overview");
      }
      setSnapshot((current) => ({ ...current, projectCount: Math.max(0, current.projectCount - 1) }));
      setNotice(`Đã xoá project “${project.name}”. Thư mục workspace vẫn được giữ nguyên.`);
    } catch (error) {
      setNotice(typeof error === "string" ? error : "Không xoá được project.");
    } finally {
      setLoading(false);
    }
  }

  async function chooseWorkspace() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Chọn thư mục không gian làm việc",
      });
      if (typeof selected === "string") {
        setWorkspaceRoot(selected);
        setNotice("Đã chọn thư mục workspace; hãy kiểm tra lại trước khi tạo project.");
      }
    } catch {
      setNotice("Không mở được hộp thoại chọn thư mục.");
    }
  }

  async function mutateJob(action: JobAction, jobId: string) {
    setLoading(true);
    try {
      const job = await invoke<Job>(action, { jobId });
      setJobs((current) => current.map((item) => (item.jobId === job.jobId ? job : item)));
      setNotice(`Job ${job.jobId} chuyển sang ${job.state}.`);
    } catch {
      setNotice("Không thể chuyển state job; kiểm tra state hiện tại và policy.");
    } finally {
      setLoading(false);
    }
  }

  async function inspectAttempts(jobId: string) {
    setLaunchPlan(null);
    try {
      const rows = await invoke<Attempt[]>("list_job_attempts", { jobId });
      setAttempts(rows);
      setAttemptJobId(jobId);
      if (rows[0]) {
        try {
          setAttemptOutputs(await invoke<AttemptOutput[]>("list_attempt_outputs", { attemptId: rows[0].attemptId }));
        } catch {
          setAttemptOutputs([]);
        }
      } else {
        setAttemptOutputs([]);
      }
      setNotice(rows.length ? `Đã đọc ${rows.length} execution attempt của ${jobId}.` : `Job ${jobId} chưa có attempt persisted.`);
    } catch {
      setAttempts([]);
      setAttemptOutputs([]);
      setAttemptJobId(jobId);
      setNotice("Chưa đọc được execution attempt; hãy mở bằng Tauri sau khi database migration hoàn tất.");
    }
  }

  async function runFfmpegFixture(projectId: string) {
    if (!projectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi chạy fixture.");
      return;
    }
    setLoading(true);
    try {
      const report = await invoke<LocalMediaFixtureReport>("run_ffmpeg_fixture", { projectId });
      setFixtureReport(report);
      setNotice(`FFmpeg/FFprobe fixture PASS: ${report.streamCount} streams, ${report.durationSeconds.toFixed(2)}s; output đã được validate trong workspace.`);
      await refresh();
    } catch {
      setNotice("Fixture FFmpeg bị chặn hoặc thất bại; kiểm tra tool readiness, workspace và output evidence.");
    } finally {
      setLoading(false);
    }
  }

  async function runBlenderFixture(projectId: string) {
    if (!projectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi chạy Blender fixture.");
      return;
    }
    setLoading(true);
    try {
      const report = await invoke<LocalBlenderFixtureReport>("run_blender_fixture", { projectId });
      setBlenderFixtureReport(report);
      setNotice(`Blender fixture PASS: ${report.outputPath} · ${report.sizeBytes} bytes.`);
      await refresh();
    } catch {
      setNotice("Không chạy được Blender fixture; hãy cấu hình đúng blender.exe và kiểm tra tool readiness.");
    } finally {
      setLoading(false);
    }
  }

  async function runTrue3dFixture(projectId: string, renderVideo = false) {
    if (!projectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi dựng true 3D.");
      return;
    }
    setLoading(true);
    setNotice(renderVideo ? "Đang dựng và render video true 3D local…" : "Đang dựng scene true 3D và render preview…");
    try {
      const report = await invoke<True3dFixtureReport>("run_true3d_fixture", { request: { projectId, renderVideo } });
      setTrue3dFixtureReport(report);
      setNotice(`${renderVideo ? "Video true 3D" : "Preview true 3D"} đã tạo; cần review chất lượng trước delivery.`);
      await refresh();
    } catch (error) {
      const message = String(error).replace(/^Error:\s*/i, "").slice(0, 360);
      setNotice(message || "Không chạy được true 3D; kiểm tra Blender/FFmpeg và tool readiness.");
    } finally {
      setLoading(false);
    }
  }

  async function runTrue3dMultishotFixture(projectId: string, renderVideo = false, rerunShotId?: string) {
    if (!projectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi dựng multi-shot true 3D.");
      return;
    }
    setLoading(true);
    setNotice(rerunShotId ? `Đang chạy lại ${rerunShotId} và kiểm tra asset hash…` : "Đang dựng continuity preview cho 8 shot true 3D…");
    try {
      const report = await invoke<True3dMultishotFixtureReport>("run_true3d_multishot_fixture", {
        request: { projectId, renderVideo, rerunShotId: rerunShotId || null },
      });
      setTrue3dMultishotFixtureReport(report);
      setNotice(`Multi-shot ${report.shotCount} shot đã tạo; asset hash unchanged=${String(report.assetHashesUnchanged)}; cần review trước delivery.`);
      await refresh();
    } catch (error) {
      const message = String(error).replace(/^Error:\s*/i, "").slice(0, 360);
      setNotice(message || "Không chạy được multi-shot continuity; kiểm tra Blender và workspace.");
    } finally {
      setLoading(false);
    }
  }

  async function runAssetPipelineCheck(projectId: string) {
    if (!projectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi kiểm tra Asset Pipeline.");
      return;
    }
    setLoading(true);
    setNotice("Đang ingest, phân loại, hash và kiểm tra quyền Asset Library…");
    try {
      const report = await invoke<AssetPipelineCheckReport>("run_asset_pipeline_check", { request: { projectId } });
      setAssetPipelineCheckReport(report);
      setNotice(`Asset Pipeline: ${report.status}; ${report.readyCount}/${report.assetCount} asset sẵn sàng, quarantine=${report.quarantinedCount}.`);
      await refresh();
    } catch (error) {
      const message = String(error).replace(/^Error:\s*/i, "").slice(0, 360);
      setNotice(message || "Không chạy được Asset Pipeline; hãy nhập asset local và kiểm tra Python.");
    } finally {
      setLoading(false);
    }
  }

  async function checkVieneu(projectId: string) {
    if (!projectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi kiểm tra VieNeu.");
      return;
    }
    setLoading(true);
    try {
      const report = await invoke<VieneuReadinessReport>("check_vieneu_local", { projectId });
      setVieneuReadiness(report);
      setNotice(`VieNeu: ${report.status}; package=${report.packageInstalled ? "đã có" : "chưa có"}; check không tải model.`);
    } catch {
      setNotice("Không kiểm tra được VieNeu; hãy cấu hình python.exe trong Cài đặt.");
    } finally {
      setLoading(false);
    }
  }

  async function runVieneuTts(projectId: string, text: string, voice: string, outputPath: string, referenceAudioPath: string, temperature: number, cloneConsent: boolean) {
    if (!projectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi chạy VieNeu.");
      return;
    }
    setLoading(true);
    try {
      const report = await invoke<VieneuTtsReport>("run_vieneu_tts", {
        projectId,
        text,
        voice,
        outputPath,
        referenceAudioPath: referenceAudioPath.trim() || null,
        precision: "int8",
        temperature,
        cloneConsent,
      });
      setVieneuReport(report);
      setNotice(`VieNeu đã tạo ${report.outputPath} (${report.sizeBytes} bytes); cần nghe và duyệt trước delivery.`);
      await refresh();
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : JSON.stringify(error);
      setNotice(`VieNeu chưa tạo được audio: ${detail}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadVoiceProfiles(projectId: string) {
    if (!projectId) return;
    try {
      const profiles = await invoke<VoiceProfile[]>("list_voice_profiles", { projectId });
      setVoiceProfiles(profiles);
      if (profiles.length > 0 && !profiles.some((profile) => profile.voiceProfileId === voiceSettings.voiceProfileId)) {
        const first = profiles[0];
        setVoiceSettings((current) => ({
          ...current,
          voiceProfileId: first.voiceProfileId,
          presetVoice: first.name,
          mode: first.mode,
          language: first.language,
          instruct: first.instruct ?? "",
          cloneEnabled: first.mode === "clone",
          cloneConsent: first.cloneConsent,
          referenceAudioPath: first.referenceAudioPath ?? undefined,
        }));
      }
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "backend chưa kết nối";
      setNotice(`Không tải được thư viện voice profile: ${detail.slice(0, 260)}`);
    }
  }

  async function loadVoiceSamples(projectId: string) {
    if (!projectId) return;
    try {
      const samples = await invoke<VoiceSample[]>("list_project_voice_samples", { projectId });
      setVoiceSamples(samples);
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "backend chưa kết nối";
      setVoiceSamples([]);
      setNotice(`Không đọc được thư mục voice local: ${detail.slice(0, 260)}`);
    }
  }

  async function checkOmniVoice(projectId: string) {
    if (!projectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi kiểm tra OmniVoice.");
      return;
    }
    setLoading(true);
    setNotice("Đang kiểm tra OmniVoice local: package, PyTorch, cache model và device…");
    try {
      const report = await invoke<OmniVoiceReadinessReport>("check_omnivoice_local", { projectId });
      setOmnivoiceReadiness(report);
      const deviceNote = report.device === "cpu" ? " CPU có thể chạy nhưng sẽ chậm." : "";
      setNotice(`Kiểm tra OmniVoice: ${report.status}. ${report.message}${deviceNote}`);
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      setNotice(`Không kiểm tra được OmniVoice: ${detail.slice(0, 360)}`);
    } finally {
      setLoading(false);
    }
  }

  async function prepareOmniVoiceModel(projectId: string) {
    if (!projectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi cài model OmniVoice.");
      return;
    }
    setLoading(true);
    setNotice("Đang tải OmniVoice và tokenizer vào cache local. Bước này có dùng mạng và có thể mất vài phút…");
    try {
      const report = await invoke<OmniVoiceReadinessReport>("prepare_omnivoice_model", { projectId });
      setOmnivoiceReadiness(report);
      setNotice(report.status === "ready" ? "Đã cài OmniVoice local. Chưa tạo audio và chưa phát sinh chi phí cloud." : `Cài OmniVoice chưa hoàn tất: ${report.message}`);
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      setNotice(`Không cài được OmniVoice: ${detail.slice(0, 360)}`);
    } finally {
      setLoading(false);
    }
  }

  async function chooseVoiceReference(): Promise<string | null> {
    try {
      const selected = await open({
        multiple: false,
        title: "Chọn audio mẫu cho voice clone",
        filters: [{ name: "Audio", extensions: ["wav", "mp3", "flac", "m4a", "ogg"] }],
      });
      if (typeof selected === "string") {
        setNotice("Đã chọn audio mẫu; file sẽ được chép vào data workspace khi bạn bấm Tạo profile.");
        return selected;
      }
    } catch {
      setNotice("Không mở được hộp thoại chọn audio mẫu.");
    }
    return null;
  }

  async function createVoiceProfile(input: { name: string; mode: "clone" | "design"; language: string; instruct: string; sourceAudioPath?: string; referenceTranscript?: string; cloneConsent: boolean }) {
    if (!selectedProjectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi tạo voice profile.");
      return;
    }
    setLoading(true);
    setNotice(`Đang tạo voice profile “${input.name}”: kiểm tra quyền và chép dữ liệu local…`);
    try {
      const profile = await invoke<VoiceProfile>("create_voice_profile", { projectId: selectedProjectId, ...input, sourceAudioPath: input.sourceAudioPath ?? null, referenceTranscript: input.referenceTranscript?.trim() || null, instruct: input.instruct.trim() || null });
      setVoiceProfiles((current) => [profile, ...current]);
      setVoiceSettings((current) => ({ ...current, voiceProfileId: profile.voiceProfileId, presetVoice: profile.name, mode: profile.mode, language: profile.language, instruct: profile.instruct ?? "", cloneEnabled: profile.mode === "clone", cloneConsent: profile.cloneConsent, referenceAudioPath: profile.referenceAudioPath ?? undefined }));
      setNotice(profile.status === "ready" ? `Đã tạo profile “${profile.name}” và lưu audio/profile vào workspace.` : `Đã tạo profile “${profile.name}” nhưng đang chờ xác nhận quyền clone.`);
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      setNotice(`Không tạo được voice profile: ${detail.slice(0, 360)}`);
    } finally {
      setLoading(false);
    }
  }

  async function updateVoiceProfile(input: { voiceProfileId: string; name: string; language: string; instruct: string; referenceTranscript?: string; cloneConsent: boolean }) {
    if (!selectedProjectId) return;
    setLoading(true);
    setNotice(`Đang lưu thay đổi voice profile “${input.name}”…`);
    try {
      const profile = await invoke<VoiceProfile>("update_voice_profile", { projectId: selectedProjectId, ...input, referenceTranscript: input.referenceTranscript?.trim() || null, instruct: input.instruct.trim() || null });
      setVoiceProfiles((current) => current.map((item) => item.voiceProfileId === profile.voiceProfileId ? profile : item));
      setVoiceSettings((current) => ({ ...current, presetVoice: profile.name, language: profile.language, instruct: profile.instruct ?? "", cloneConsent: profile.cloneConsent }));
      setNotice(`Đã lưu profile “${profile.name}”.`);
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      setNotice(`Không lưu được voice profile: ${detail.slice(0, 360)}`);
    } finally {
      setLoading(false);
    }
  }

  async function deleteVoiceProfile(profile: VoiceProfile) {
    if (!selectedProjectId) return;
    setLoading(true);
    setNotice(`Đang xoá profile “${profile.name}” khỏi thư viện…`);
    try {
      await invoke("delete_voice_profile", { projectId: selectedProjectId, voiceProfileId: profile.voiceProfileId });
      setVoiceProfiles((current) => current.filter((item) => item.voiceProfileId !== profile.voiceProfileId));
      setVoiceSettings((current) => current.voiceProfileId === profile.voiceProfileId ? { ...current, voiceProfileId: undefined, presetVoice: "", mode: undefined, referenceAudioPath: undefined } : current);
      setOmnivoiceReport(null);
      setNotice(`Đã xoá profile “${profile.name}”. File data cũ được giữ lại để không mất bằng chứng/khôi phục.`);
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      setNotice(`Không xoá được voice profile: ${detail.slice(0, 360)}`);
    } finally {
      setLoading(false);
    }
  }

  async function runOmniVoiceTts(input: { voiceProfileId: string; text: string; language: string; speed: number; durationSeconds?: number; qualityPreset: "preview" | "balanced" | "quality"; classTemperature: number; positionTemperature: number; normalizeText: boolean; emotionCode?: VoiceEmotion }) {
    if (!selectedProjectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi thử giọng.");
      return;
    }
    const outputPath = `.auto3dvideo/voices/${input.voiceProfileId}/previews/test-${Date.now()}.wav`;
    setLoading(true);
    setOmnivoiceReport(null);
    setNotice("Đang chuẩn bị request OmniVoice [1/3]: kiểm tra profile, quyền clone và output path…");
    try {
      setNotice("Đang chạy OmniVoice local [2/3]: model không gọi API và không tự tải thêm trong synthesis…");
      const report = await invoke<OmniVoiceTtsReport>("run_omnivoice_tts", { projectId: selectedProjectId, ...input, outputPath, durationSeconds: input.durationSeconds || null });
      setOmnivoiceReport(report);
      setVoiceProfiles((current) => current.map((profile) => profile.voiceProfileId === report.voiceProfileId ? { ...profile, lastPreviewPath: report.outputPath, updatedAt: new Date().toISOString() } : profile));
      setNotice(`Đã tạo WAV OmniVoice [3/3]: ${report.outputPath}. Hãy nghe và duyệt; chưa tự đưa vào delivery.`);
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      setNotice(`OmniVoice chưa tạo được audio: ${detail.slice(0, 360)}`);
    } finally {
      setLoading(false);
    }
  }

  function toProjectRelativePath(selectedPath: string) {
    const root = selectedProject?.workspaceRoot?.split("\\").join("/").replace(/\/$/, "");
    const normalized = selectedPath.split("\\").join("/");
    if (root && normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
      return normalized.slice(root.length + 1);
    }
    return normalized;
  }

  async function chooseSubtitleVideo() {
    try {
      const selected = await open({ multiple: false, title: "Chọn video local để làm phụ đề", filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "avi"] }] });
      if (typeof selected === "string") {
        setSubtitleVideoPath(toProjectRelativePath(selected));
        setSubtitleProbe(null);
        setNotice("Đã chọn video local; hãy probe để lấy thời lượng trước khi nạp phụ đề.");
      }
    } catch {
      setNotice("Không mở được hộp thoại chọn video.");
    }
  }

  async function chooseSubtitleFile() {
    try {
      const selected = await open({ multiple: false, title: "Chọn file phụ đề SRT hoặc VTT", filters: [{ name: "Subtitle", extensions: ["srt", "vtt"] }] });
      if (typeof selected === "string") {
        setSubtitlePath(toProjectRelativePath(selected));
        setNotice("Đã chọn phụ đề; hãy bấm Nạp để mở editor.");
      }
    } catch {
      setNotice("Không mở được hộp thoại chọn file phụ đề.");
    }
  }

  async function chooseVideoVisionFile() {
    try {
      const selected = await open({ multiple: false, title: "Chọn video local để đọc hiểu", filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "avi"] }] });
      if (typeof selected === "string") {
        setVideoVisionPath(toProjectRelativePath(selected));
        setVideoVisionReport(null);
        setNotice("Đã chọn video local; bước phân tích chỉ đọc file trong workspace và không gọi mạng.");
      }
    } catch {
      setNotice("Không mở được hộp thoại chọn video cho Video Vision.");
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
      const waitForBrowserOs = () => new Promise<void>((resolve) => window.setTimeout(resolve, 1800));
      let report: BrowserMcpRuntimeReport;
      try {
        report = await invoke<BrowserMcpRuntimeReport>("check_browsermcp_session", { projectId: selectedProjectId });
      } catch (firstError) {
        await invoke<string>("open_browseros_flow");
        await waitForBrowserOs();
        report = await invoke<BrowserMcpRuntimeReport>("check_browsermcp_session", { projectId: selectedProjectId });
        if (firstError) {
          recordWorkspaceActivity({ stage: "browser_flow.auto_workspace", tool: "BrowserOS neo", state: "info", message: "Snapshot đầu tiên lỗi; đã tự mở lại BrowserOS rồi thử lại.", nextAction: "Đang xác nhận tab Google Flow mới." });
        }
      }
      const initiallyAttached = report.browserSessionAttached && report.status !== "blocked" && !report.operationResult?.isError;
      if (!initiallyAttached) {
        await invoke<string>("open_browseros_flow");
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
        goal,
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
    for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
      const agent = await runBrowserFlowAgentOnce(latestWorkflow, goal, text);
      if (!agent) return null;
      last = agent;
      latestWorkflow = agent.workflow;
      const action = agent.action?.action;
      if (agent.status !== "ready" || !action || action === "stop") return agent;
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
    const store = (next: BrowserFlowWorkflow) => {
      latestWorkflow = next;
      setBrowserFlowWorkflow(next);
    };
    const step = (operation: string, element: string | null = null, elementRef: string | null = null, time: number | null = null) => invoke<BrowserFlowWorkflowReport>("run_browser_flow_step", { request: { projectId: selectedProjectId, workflowId: latestWorkflow.workflowId, operation, approved: true, url: null, element, elementRef, text: null, submit: false, key: null, time } });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      onActivity({ stage: "browser_flow.composer.snapshot", tool: "BrowserMCP / Google Flow", state: "running", message: `Đọc snapshot mới để tìm composer (lần ${attempt + 1}/3); không dùng ref lịch sử.`, nextAction: "Chờ UI ref hiện tại của Flow." });
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
      }
      const composerState = mode === "image"
        ? inspectBrowserFlowImageComposer(snapshot.workflow.uiRefs)
        : inspectBrowserFlowVideoComposer(snapshot.workflow.uiRefs);
      if (!composerState.verified) {
        if (!composerState.creditGate && attempt < 2) {
          try {
            const agent = await runBrowserFlowAgent(
              snapshot.workflow,
              mode === "image"
                ? "Đọc UI refs hiện tại và mở đúng composer tạo ảnh Nano Banana trong project Flow này. Chỉ click một control Flow an toàn; không dùng chat, credit, tài khoản hoặc tab khác."
                : "Đọc UI refs hiện tại và mở đúng composer Video/Text-to-video trong project Flow này. Chỉ click một control Flow an toàn; không dùng chat, credit, tài khoản hoặc tab khác.",
            );
            if (agent) {
              store(agent.workflow);
              onActivity({ stage: "browser_flow.agent", tool: `Vision Browser / ${agent.model}`, state: agent.status === "ready" ? "success" : "blocked", message: agent.message, output: agent.plannerReportPath ?? undefined, nextAction: agent.status === "ready" ? "Đọc snapshot mới sau action của planner." : "Kiểm tra model planner và UI ref hiện tại." });
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
          : "BLOCKED_VIDEO_COMPOSER: snapshot chưa chứng minh video mode + prompt control + Generate video thật; không type/click.";
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

  async function autoGenerateBrowserFlowSequential(workflow: BrowserFlowWorkflow, script: LocalScriptDocument, runId: string, firstShotAlreadyTyped = false): Promise<{ workflow: BrowserFlowWorkflow; success: boolean; message: string }> {
    if (!selectedProjectId) return { workflow, success: false, message: "Chưa có project để chạy Generate Google Flow." };
    const startedAt = performance.now();
    const flowSegments = flowSegmentsForGeneration(script);
    const shotCount = Math.max(1, flowSegments.length);
    const activityId = recordWorkspaceActivity({ stage: "studio_flow.shot_run", tool: "BrowserMCP / Google Flow", state: "running", progress: 0, message: `Auto mode đã chuyển sang ${shotCount} shot tuần tự; mỗi shot phải có output mới và import local.`, nextAction: "Chờ UI ref mới, output mới và kiểm tra file trước khi sang shot tiếp theo." });
    setBrowserHandoffBusy(true);
    let latestWorkflow = workflow;
    const store = (next: BrowserFlowWorkflow, message: string) => { latestWorkflow = next; setBrowserFlowWorkflow(next); setNotice(message); };
    const step = (operation: string, element: string | null = null, elementRef: string | null = null, text: string | null = null, time: number | null = null) => invoke<BrowserFlowWorkflowReport>("run_browser_flow_step", { request: { projectId: selectedProjectId, workflowId: latestWorkflow.workflowId, operation, approved: true, url: null, element, elementRef, text, submit: false, key: null, time } });
    const snapshot = async () => { const result = await step("snapshot"); applyFreshBrowserFlowWorkflow(result.workflow); store(result.workflow, result.message); return result; };
    const fail = (message: string, nextAction: string) => { updateWorkspaceActivity(activityId, { state: "blocked", progress: Math.min(0.99, (latestWorkflow.currentStep || 0) / Math.max(1, shotCount * 8)), durationMs: Math.round(performance.now() - startedAt), message, nextAction }); setNotice(message); return { workflow: latestWorkflow, success: false, message }; };
    try {
      for (let index = 0; index < flowSegments.length; index += 1) {
        const flowSegment = flowSegments[index];
        const segment = flowSegment.segment;
        const shotId = `SHOT-${String(index + 1).padStart(3, "0")}`;
        const revisionId = `${segment.revisionId || "rev-001"}${flowSegment.partCount > 1 ? `-part-${String(flowSegment.partIndex + 1).padStart(2, "0")}` : ""}`;
        const imageShotId = `SHOT-${String(flowSegment.sourceIndex + 1).padStart(3, "0")}`;
        const imageRevisionId = segment.revisionId || "rev-001";
        const referenceDriven = (script.comfyuiAssetPaths?.length ?? 0) > 0;
        if (referenceDriven) {
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
          const animatedSnapshot = await snapshot();
          latestWorkflow = animatedSnapshot.workflow;
        }
        const composer = await ensureFlowComposer(latestWorkflow, index === 0);
        if (composer.blocked) return fail(`${shotId}: ${composer.message}`, "Mở đúng project/composer Google Flow rồi chạy lại; không dùng ref lịch sử.");
        latestWorkflow = composer.workflow;
        let current: BrowserFlowWorkflowReport = { status: "ready", message: composer.message, workflow: composer.workflow };
        const shotPrompt = buildBrowserFlowShotPrompt(script, segment, index, runId, revisionId, current.workflow.providerProjectIdentity, current.workflow.sessionId);
        const inputHash = await sha256Text(stableBrowserFlowPrompt(shotPrompt));
        const existing = (latestWorkflow.downloadedFiles ?? []).find((file) => file.shotId === shotId && file.revisionId === revisionId && file.inputHash === inputHash && file.mediaKind === "video");
        if (existing) {
          const message = `${shotId} đã có output/import cùng revision ${revisionId} (SHA prompt ${inputHash.slice(0, 12)}…); resume không tạo trùng.`;
          updateWorkspaceActivity(activityId, { state: "running", progress: (index + 1) / shotCount, message, nextAction: "Bỏ qua shot đã có bằng chứng và chuyển shot tiếp theo." });
          continue;
        }
        if (!(index === 0 && firstShotAlreadyTyped && !referenceDriven)) {
          let promptRef = composer.promptRef ?? findBrowserFlowPromptRef(current.workflow.uiRefs);
          let promptAcceptedByAgent = false;
          if (!promptRef) {
            const agent = await runBrowserFlowAgent(
              current.workflow,
              `SHOT ${shotId}: đọc UI refs hiện tại, tìm đúng ô prompt của Google Flow video và nhập text được cấp vào đó; không click Generate, không dùng chat hay metadata.`,
              shotPrompt,
            );
            if (!agent) return fail(`${shotId}: không có project để gọi Vision Browser planner.`, "Chọn project local rồi chạy lại.");
            store(agent.workflow, `${shotId}: Vision Browser đã đọc UI ref và trả action ${agent.action?.action ?? "stop"}.`);
            current = { status: agent.status, message: agent.message, workflow: agent.workflow };
            promptRef = findBrowserFlowPromptRef(current.workflow.uiRefs);
            promptAcceptedByAgent = agent.status === "ready" && agent.action?.action === "type";
          }
          if (!promptRef) return fail(`${shotId}: chưa tìm được ô prompt bằng UI ref mới.`, "Đọc lại trạng thái Flow sau khi mở composer; không dùng tọa độ màn hình.");
          if (!promptAcceptedByAgent) {
            updateWorkspaceActivity(activityId, { state: "running", progress: index / shotCount, message: `${shotId}: đang nạp prompt revision ${revisionId} (${inputHash.slice(0, 12)}…) vào Flow.`, nextAction: "Chờ Flow xác nhận thao tác type rồi mới tìm Generate." });
            const typed = await step("type", promptRef.label, promptRef.reference, shotPrompt);
            if (typed.status !== "ready") return fail(`${shotId}: Flow chưa xác nhận đã nhận prompt: ${typed.message}`, "Kiểm tra ô prompt/Connect; chạy lại sẽ reconcile theo input hash.");
            store(typed.workflow, `${shotId}: prompt đã được nhập một lần; đang đọc UI mới để tìm Generate.`);
            current = await snapshot();
          }
        } else {
          store(current.workflow, `${shotId}: dùng prompt vừa được nạp trong discovery; không gõ lặp.`);
        }
        const composerState = inspectBrowserFlowVideoComposer(current.workflow.uiRefs);
        if (!composerState.verified) {
          const reason = composerState.creditGate ? "BLOCKED_CREDIT_GATE" : composerState.chatOnly ? "BLOCKED_CHAT_ROUTE" : "BLOCKED_VIDEO_COMPOSER";
          return fail(`${shotId}: ${reason}; Flow chưa ở video composer, không click chat/assistant.`, "Mở Video/Text-to-video composer rồi chạy lại snapshot.");
        }
        let approvalRef = findBrowserFlowApprovalRef(current.workflow.uiRefs);
        let generateAcceptedByAgent = false;
        if (!approvalRef) {
          const agent = await runBrowserFlowAgent(
            current.workflow,
            `SHOT ${shotId}: prompt đã được nhập trong Google Flow video composer. Đọc UI refs hiện tại và click đúng nút Generate video/Start generation của composer; không click chat, upgrade hoặc Download.`,
          );
          if (!agent) return fail(`${shotId}: không có project để gọi Vision Browser planner.`, "Chọn project local rồi chạy lại.");
          store(agent.workflow, `${shotId}: Vision Browser đã đọc UI ref để tìm Generate (${agent.action?.action ?? "stop"}).`);
          current = { status: agent.status, message: agent.message, workflow: agent.workflow };
          approvalRef = findBrowserFlowApprovalRef(current.workflow.uiRefs);
          generateAcceptedByAgent = agent.status === "ready" && agent.action?.action === "click";
        }
        if (!approvalRef && !generateAcceptedByAgent) return fail(`${shotId}: Flow chưa trả ref Generate/Approve sau khi nhận prompt.`, "Mở tab Flow kiểm tra composer và đọc trạng thái lại; chưa coi là đã tạo.");
        const clicked = generateAcceptedByAgent
          ? current
          : await step("click", approvalRef!.label, approvalRef!.reference);
        const clickProcess = [...clicked.workflow.processes].reverse().find((process) => process.operation === "click");
        const clickSucceeded = clicked.status === "ready" && clickProcess?.state === "succeeded";
        if (!clickSucceeded) return fail(`${shotId}: click Generate chưa có process success mới: ${clicked.message}`, "Không spam nút; kiểm tra BrowserMCP và UI ref hiện tại.");
        store(clicked.workflow, `${shotId}: GENERATE_CLICKED bằng ref mới; đang xác nhận PROVIDER_ACK, không coi click là hoàn tất.`);
        updateWorkspaceActivity(activityId, { state: "running", progress: (index + 0.15) / shotCount, message: `${shotId}: GENERATE_CLICKED → đọc snapshot mới để xác nhận PROVIDER_ACK.`, nextAction: "Không nhập lại prompt; chỉ tiếp tục khi video composer báo đang tạo hoặc output." });
        current = await snapshot();
        const ackState = inspectBrowserFlowGeneration(current.workflow.uiRefs);
        if (!ackState.verified || (!ackState.isWorking && !ackState.readyForOutput)) {
          return fail(`${shotId}: PROVIDER_ACK không được xác nhận từ video composer; chat response không đủ bằng chứng.`, "Giữ nguyên tab Flow và chạy lại snapshot khi video composer trả trạng thái tạo/output.");
        }
        updateWorkspaceActivity(activityId, { state: "running", progress: (index + 0.25) / shotCount, message: `${shotId}: PROVIDER_ACK → ${ackState.isWorking ? "GENERATING" : "OUTPUT_READY"}.`, nextAction: "Chờ output control của đúng video composer." });
        const beforeFiles = await invoke<{ status: string; files: BrowserFlowDownloadEntry[]; message: string }>("list_browser_flow_downloads", { projectId: selectedProjectId });
        const beforeMap = new Map(beforeFiles.files.map((file) => [file.relativePath, `${file.modifiedAt}:${file.sizeBytes}`]));
        const maxWaitSeconds = Math.min(900, Math.max(120, Math.ceil(segment.durationSeconds * 30 + 90)));
        let waited = 0;
        let downloadRef: BrowserFlowUiRef | undefined;
        while (waited < maxWaitSeconds) {
          const waitFor = Math.min(5, maxWaitSeconds - waited);
          const settled = await step("wait", null, null, null, waitFor);
          waited += waitFor;
          if (settled.status !== "ready") return fail(`${shotId}: Flow bị chặn khi chờ output: ${settled.message}`, "Kiểm tra tab Flow và giữ nguyên session để resume.");
          current = await snapshot();
          const state = inspectBrowserFlowGeneration(current.workflow.uiRefs);
          if (state.readyForOutput) { downloadRef = findBrowserFlowDownloadRef(current.workflow.uiRefs); if (downloadRef) break; }
          updateWorkspaceActivity(activityId, { state: "running", progress: Math.min(0.94, (index + waited / maxWaitSeconds) / shotCount), message: `${shotId}: ${state.isWorking ? "GENERATING" : "đang chờ OUTPUT_READY"} · ${waited}/${maxWaitSeconds}s.`, nextAction: "Tiếp tục chờ video composer; chat response không phải output." });
        }
        if (!downloadRef) return fail(`${shotId}: không có nút Download/Export rõ ràng sau ${maxWaitSeconds}s; không báo thành công.`, "Mở Flow kiểm tra output; chạy lại sẽ dùng input hash để tránh tạo trùng nếu đã import.");
        const downloaded = await step("click", downloadRef.label, downloadRef.reference);
        const downloadProcess = [...downloaded.workflow.processes].reverse().find((process) => process.operation === "click");
        if (downloaded.status !== "ready" || downloadProcess?.state !== "succeeded") return fail(`${shotId}: click Download chưa được xác nhận: ${downloaded.message}`, "Kiểm tra nút Download và không giả đã lưu file.");
        store(downloaded.workflow, `${shotId}: DOWNLOADED request đã xác nhận; đang chờ file mới và ffprobe.`);
        let exact: BrowserFlowDownloadEntry | undefined;
        for (let poll = 0; poll < 24 && !exact; poll += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 5000));
          const report = await invoke<{ status: string; files: BrowserFlowDownloadEntry[]; message: string }>("list_browser_flow_downloads", { projectId: selectedProjectId });
          const freshVideos = report.files
            .filter((file) => file.mediaKind === "video")
            .filter((file) => !beforeMap.has(file.relativePath) || beforeMap.get(file.relativePath) !== `${file.modifiedAt}:${file.sizeBytes}`);
          if (freshVideos.length > 1) {
            return fail(`${shotId}: phát hiện ${freshVideos.length} file video mới sau cùng một lần Download; chưa thể gán output chính xác cho shot này.`, "Giữ nguyên tab Flow và chỉ để một output hoàn tất rồi chạy lại; app không chọn đại file mới nhất.");
          }
          exact = freshVideos[0];
          updateWorkspaceActivity(activityId, { state: "running", progress: Math.min(0.97, (index + 0.7) / shotCount), message: exact ? `${shotId}: DOWNLOADED → đã thấy file mới ${exact.name}; đang validate/import.` : `${shotId}: đã bấm Download nhưng chưa thấy file video mới (${(poll + 1) * 5}s).`, nextAction: "Chỉ import file video mới của lần click này; không lấy file cũ trong Downloads." });
        }
        if (!exact) return fail(`${shotId}: Download không tạo file video mới trong 120 giây; không coi là hoàn tất.`, "Kiểm tra Flow download permission và giữ nguyên session để resume.");
        const imported = await invoke<{ workflow: BrowserFlowWorkflow; importedPath: string; message: string }>("import_browser_flow_download", { request: { projectId: selectedProjectId, workflowId: latestWorkflow.workflowId, relativePath: exact.relativePath, runId, shotId, revisionId, inputHash } });
        store(imported.workflow, `${shotId}: đã import output local qua ffprobe (${imported.importedPath}).`);
        updateWorkspaceActivity(activityId, { state: "running", progress: (index + 1) / shotCount, message: `${shotId}: IMPORTED → generation → Download → ffprobe → import hoàn tất.`, output: imported.importedPath, nextAction: index + 1 < shotCount ? `Chuyển sang ${`SHOT-${String(index + 2).padStart(3, "0")}`} bằng prompt riêng.` : "Đã nhập hết shot; cần bước compose/review cuối và không tự publish." });
      }
      updateWorkspaceActivity(activityId, { state: "running", progress: 0.99, message: `Đã import đủ ${shotCount} shot; đang compose theo thứ tự và kiểm tra output cuối.`, nextAction: "FFmpeg/FFprobe compose không được ghi đè output cũ." });
      const composed = await invoke<{ workflow: BrowserFlowWorkflow; outputPath: string; message: string }>("compose_browser_flow_outputs", { request: { projectId: selectedProjectId, workflowId: latestWorkflow.workflowId, runId, shotIds: flowSegments.map((_, index) => `SHOT-${String(index + 1).padStart(3, "0")}`) } });
      store(composed.workflow, `${composed.message} Output: ${composed.outputPath}`);
      const message = `Đã xử lý tuần tự ${shotCount} shot, import từng output và compose thành ${composed.outputPath}; các output có hash prompt/run/shot/revision. Chưa tự publish.`;
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

  // Retain the legacy whole-session implementation for cache compatibility; the
  // active UI path below uses the sequential runner and never calls this helper.
  void autoGenerateBrowserFlow;

  async function startBrowserFlowDiscovery(script: LocalScriptDocument | null, report: BlenderShotPreviewReport | null, sessionId?: string | null, autoGenerate = false, autoRunId?: string | null): Promise<boolean> {
    if (!selectedProjectId) {
      const message = "Hãy tạo hoặc chọn project trước khi quét route Google Flow.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "browser_flow.discovery.validate", tool: "BrowserMCP", state: "blocked", message, nextAction: "Tạo hoặc chọn project local." });
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
     const startedAt = performance.now();
     const referenceDrivenAutoRun = Boolean(autoGenerate && autoRunId && (script?.comfyuiAssetPaths?.length ?? 0) > 0);
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
         const generated = await autoGenerateBrowserFlowSequential(preserved, script!, autoRunId!, false);
         setBrowserFlowWorkflow(generated.workflow);
         setNotice(generated.message);
         updateWorkspaceActivity(activityId, { state: generated.success ? "success" : "blocked", progress: generated.success ? 1 : 0.99, durationMs: Math.round(performance.now() - startedAt), message: generated.message, nextAction: generated.success ? "Review từng video shot và compose cuối." : "Giữ nguyên workflow hiện tại, sửa đúng shot bị chặn rồi resume." });
         setBrowserHandoffBusy(false);
         return generated.success;
       }
       const result = await invoke<BrowserFlowWorkflowReport>("start_browser_flow_discovery", { request: { projectId: selectedProjectId, name: `${script?.title || topic.trim() || "Video"} · Google Flow workflow`, targetUrl: "https://labs.google/fx/tools/flow", handoffId: null, sessionId: sessionId ?? null, assets, files: fileCandidates } });
      let latestWorkflow = result.workflow;
      applyFreshBrowserFlowWorkflow(latestWorkflow);
      let message = result.message;
      recordWorkspaceActivity({ stage: "browser_flow.visual_fallback", tool: "BrowserMCP screenshot", state: latestWorkflow.visualStatePath ? "success" : "waiting_user", progress: latestWorkflow.visualStatePath ? 1 : 0, message: latestWorkflow.visualStatePath ? "Đã chụp màn hình Flow để làm visual state fallback; không tự bấm theo tọa độ." : "BrowserMCP chưa trả ảnh màn hình; workflow vẫn giữ UI ref/snapshot, chưa dùng tọa độ đoán.", output: latestWorkflow.visualStatePath ?? undefined, nextAction: latestWorkflow.visualStatePath ? "Review ảnh Flow và tiếp tục bằng UI ref thật khi extension trả ref." : "Kiểm tra quyền screenshot của BrowserMCP rồi quét lại." });
      let autoTypeState: WorkspaceActivityState | null = null;
      let autoTypeFailed = false;
      let autoGenerationPassed = false;
      if (script) {
        const referenceDrivenAutoRun = Boolean(autoGenerate && autoRunId && (script.comfyuiAssetPaths?.length ?? 0) > 0);
        if (referenceDrivenAutoRun) {
          // The image stage already created and manually approved one Flow
          // reference per shot. Do not type a text-only video prompt first:
          // the next stage must open Animate from that exact image card.
          const generated = await autoGenerateBrowserFlowSequential(latestWorkflow, script, autoRunId!, false);
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
                ? buildBrowserFlowShotPrompt(script, initialFlowSegment, 0, autoRunId, initialFlowRevision, latestWorkflow.providerProjectIdentity, latestWorkflow.sessionId)
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
            if (autoGenerate && autoRunId && !autoTypeFailed && typed.status === "ready") {
              const generated = await autoGenerateBrowserFlowSequential(latestWorkflow, script, autoRunId, true);
              latestWorkflow = generated.workflow;
              message = generated.message;
              autoGenerationPassed = generated.success;
              autoTypeFailed = !generated.success;
              autoTypeState = generated.success ? "success" : "blocked";
            } else if (promptWasAcceptedButStillLoading) {
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
              setNotice(`Prompt đã được nạp đúng một lần; Flow đang dựng ${shotCount} shot (~${durationSeconds.toFixed(1)} giây). App sẽ chờ trạng thái thật, không gửi Enter lần nữa…`);
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
                if (autoGenerate) {
                  const generated = await autoGenerateBrowserFlowSequential(latestWorkflow, script, autoRunId ?? `auto-${Date.now().toString(36)}`);
                  latestWorkflow = generated.workflow;
                  message = generated.message;
                  autoGenerationPassed = generated.success;
                  autoTypeFailed = !generated.success;
                  autoTypeState = generated.success ? "success" : "blocked";
                } else {
                  autoTypeState = "info";
                  message = `Flow đã trả phản hồi cho ${shotCount} shot và đang chờ bạn duyệt Generate. App không tạo session riêng cho từng shot.`;
                  setNotice(message);
                }
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
      const finalActivityState = autoTypeFailed ? "error" : autoTypeState === "blocked" || (!autoTypeState && result.status === "waiting_user") ? "blocked" : autoTypeState === "info" ? "info" : autoTypeState === "success" || workflowPromptReady || result.status === "ready" ? "success" : "error";
      updateWorkspaceActivity(activityId, { state: finalActivityState, progress: finalActivityState === "success" ? 1 : undefined, durationMs: Math.round(performance.now() - startedAt), message, output: latestWorkflow.discoveryPath ?? undefined, nextAction: latestWorkflow.roadmap.find((item) => item.status === "blocked" || item.status === "waiting_user" || item.status === "pending")?.nextAction ?? "Session, file binding, roadmap và process đã được lưu." });
      return !autoTypeFailed && autoTypeState !== "blocked" && (!autoGenerate || autoGenerationPassed) && (workflowPromptReady || !script);
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

  async function analyzeVideoVision() {
    if (!selectedProjectId || !videoVisionPath.trim()) {
      setNotice("Hãy tạo/chọn project và chọn video local trước khi phân tích.");
      return;
    }
    setLoading(true);
    try {
      const report = await invoke<VideoVisionEvidenceReport>("analyze_video_evidence", { request: {
        projectId: selectedProjectId,
        videoPath: videoVisionPath.trim(),
        outputPath: videoVisionOutputPath.trim(),
        sampleFps: videoVisionSampleFps,
        maxFrames: videoVisionMaxFrames,
        frameWidth: 320,
        frameHeight: 180,
        extractAudio: videoVisionExtractAudio,
      } });
      setVideoVisionReport(report);
      setNotice(`Đã tạo ${report.shotCount} shot và ${report.frameCount} frame evidence; VLM/OCR/STT chưa chạy, cần review.`);
      await refresh();
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      setNotice(`Không phân tích được video: ${detail.slice(0, 320)}`);
    } finally {
      setLoading(false);
    }
  }

  async function probeSubtitleVideo() {
    if (!selectedProjectId || !subtitleVideoPath.trim()) {
      setNotice("Hãy tạo/chọn project và chọn video local trước.");
      return;
    }
    setLoading(true);
    try {
      const report = await invoke<SubtitleVideoProbeReport>("probe_subtitle_video", { request: { projectId: selectedProjectId, videoPath: subtitleVideoPath.trim() } });
      setSubtitleProbe(report);
      setNotice(report.status === "ready" ? `Đã probe video ${report.durationSeconds?.toFixed(2) ?? "?"} giây.` : "Probe video cần kiểm tra thêm.");
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      setNotice(`Không probe được video: ${detail.slice(0, 280)}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadSubtitleDocument() {
    if (!selectedProjectId || !subtitleVideoPath.trim() || !subtitlePath.trim()) {
      setNotice("Hãy chọn project, video và file SRT/VTT trước khi nạp.");
      return;
    }
    setLoading(true);
    try {
      const report = await invoke<SubtitleDocumentReport>("load_subtitle_document", { request: {
        projectId: selectedProjectId,
        inputPath: subtitlePath.trim(),
        sourceVideoPath: subtitleVideoPath.trim(),
        sourceLanguage: subtitleSourceLanguage,
        targetLanguage: subtitleTargetLanguage,
        durationSeconds: subtitleProbe?.durationSeconds ?? 3600,
        format: subtitlePath.toLowerCase().endsWith(".vtt") ? "vtt" : "srt",
      } });
      if (report.document) setSubtitleDocument(report.document);
      setSubtitleReport(report);
      setSubtitleFormat(report.format ?? "srt");
      setNotice(report.message);
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      setNotice(`Không nạp được subtitle: ${detail.slice(0, 280)}`);
    } finally {
      setLoading(false);
    }
  }

  async function saveSubtitleDocument() {
    if (!selectedProjectId || !subtitleDocument) {
      setNotice("Chưa có document phụ đề để xuất.");
      return;
    }
    setLoading(true);
    try {
      const report = await invoke<SubtitleDocumentReport>("save_subtitle_document", { request: { projectId: selectedProjectId, document: { ...subtitleDocument, format: subtitleFormat }, outputPath: subtitleOutputPath.trim(), format: subtitleFormat } });
      setSubtitleReport(report);
      setNotice(`Đã xuất ${report.outputPath ?? "subtitle"}; cần mở lại và review trước delivery.`);
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      setNotice(`Không xuất được subtitle: ${detail.slice(0, 280)}`);
    } finally {
      setLoading(false);
    }
  }

  async function burnInSubtitles() {
    if (!selectedProjectId || !subtitleVideoPath.trim() || !subtitlePath.trim()) {
      setNotice("Cần video và file subtitle đã tồn tại trong workspace để burn-in.");
      return;
    }
    setLoading(true);
    try {
      const report = await invoke<SubtitleBurnInReport>("burn_in_subtitles", { request: { projectId: selectedProjectId, videoPath: subtitleVideoPath.trim(), subtitlePath: subtitlePath.trim(), outputPath: subtitleOutputPath.replace(/\.(srt|vtt)$/i, "-burned.mp4") } });
      setSubtitleBurnInReport(report);
      setNotice(`Đã tạo bản sao burn-in ${report.outputPath}; video gốc không bị thay đổi.`);
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      setNotice(`Không burn-in được subtitle: ${detail.slice(0, 280)}`);
    } finally {
      setLoading(false);
    }
  }

  async function previewNarrativeVisualPlan() {
    setLoading(true);
    try {
      const preview = await invoke<NarrativeVisualPlanPreview>("preview_narrative_visual_plan_fixture");
      setVisualPlanPreview(preview);
      setActiveNav("review");
      setNotice(`Đã compile ${preview.beats.length} beat visual; chưa gọi provider và chưa tạo media.`);
    } catch {
      setNotice("Không compile được NarrativeVisualPlan fixture; kiểm tra native backend và contract.");
    } finally {
      setLoading(false);
    }
  }

  async function runFfmpegFixtureAttempt(projectId: string) {
    if (!projectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi chạy fixture job.");
      return;
    }
    setLoading(true);
    try {
      const launch = await invoke<ExternalFixtureAttemptReport>("run_ffmpeg_fixture_attempt", { projectId });
      setJobs((current) => [launch.job, ...current.filter((job) => job.jobId !== launch.job.jobId)]);
      setSnapshot((current) => ({ ...current, jobCount: current.jobCount + 1 }));
      setActiveNav("jobs");
      setNotice(`Đã chạy external FFmpeg fixture qua job ${launch.job.jobId}; attempt ${launch.attempt.attemptId} đang được theo dõi.`);
      await inspectAttempts(launch.job.jobId);
      const pollId = window.setInterval(() => {
        void refresh();
        void inspectAttempts(launch.job.jobId);
      }, 700);
      window.setTimeout(() => window.clearInterval(pollId), 8_000);
    } catch {
      setNotice("Không chạy được durable FFmpeg fixture; kiểm tra tool readiness và workspace.");
    } finally {
      setLoading(false);
    }
  }

  async function previewWorkerLaunch(attemptId: string) {
    try {
      const plan = await invoke<WorkerLaunchPlan>("preview_worker_launch", { attemptId });
      setLaunchPlan(plan);
      setNotice(plan.canStart ? "Worker launch plan sẵn sàng." : "Worker launch plan bị chặn; chưa chạy process nào.");
    } catch {
      setLaunchPlan(null);
      setNotice("Không đọc được worker launch plan; attempt chưa tồn tại hoặc Tauri backend chưa kết nối.");
    }
  }

  async function startMockAttempt(attemptId: string, jobId: string) {
    setLoading(true);
    try {
      await invoke<Attempt>("start_mock_attempt", { attemptId });
      await inspectAttempts(jobId);
      setNotice(`Mock worker in-process đã claim lease cho ${attemptId}; không spawn executable ngoài.`);
      const pollId = window.setInterval(() => {
        void refresh();
        void inspectAttempts(jobId);
      }, 700);
      window.setTimeout(() => window.clearInterval(pollId), 3_500);
    } catch {
      setNotice("Không start được mock worker; attempt phải ở pending và job phải ở queued.");
    } finally {
      setLoading(false);
    }
  }

  async function prepareAttempt(jobId: string) {
    setLoading(true);
    try {
      const expectedOutput = attemptOutputPath.trim();
      const outputs: PendingOutputSpec[] = expectedOutput ? [{ relativePath: expectedOutput, mediaKind: attemptMediaKind }] : [];
      await invoke<Attempt>("prepare_pending_attempt", {
        jobId,
        executableId: attemptExecutableId || null,
        timeoutSeconds: 1800,
        outputs,
      });
      setJobs((current) => current.map((job) => (job.jobId === jobId ? { ...job, attemptCount: job.attemptCount + 1 } : job)));
      await inspectAttempts(jobId);
      setNotice(`Đã tạo pending attempt cho ${jobId}; chưa claim lease và chưa chạy process.`);
    } catch {
      setNotice("Không tạo được pending attempt; job phải ở queued và không có attempt đang hoạt động.");
    } finally {
      setLoading(false);
    }
  }

  async function queuePendingJob(recipe: Recipe) {
    if (!selectedProjectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi tạo queued job.");
      setActiveNav("overview");
      return;
    }
    setLoading(true);
    try {
      const job = await invoke<Job>("enqueue_pending_job", {
        projectId: selectedProjectId,
        recipeKind: recipe.recipeKind,
      });
      setJobs((current) => [job, ...current]);
      setSnapshot((current) => ({ ...current, jobCount: current.jobCount + 1 }));
      setNotice(`Đã tạo queued job ${job.jobId}; chưa chạy worker hoặc process ngoài.`);
      setActiveNav("jobs");
    } catch {
      setNotice("Không tạo được queued job. Project hoặc recipe chưa hợp lệ.");
    } finally {
      setLoading(false);
    }
  }

  async function runRecipe(recipe: Recipe) {
    if (!selectedProjectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi chạy recipe.");
      setActiveNav("overview");
      return;
    }
    setLoading(true);
    try {
      const validation = await invoke<RecipeValidationResult>("validate_recipe_json", {
        recipeJson: JSON.stringify({
          schemaVersion: "1.0.0",
          recipeId: `ui-${recipe.recipeKind}`,
          kind: recipe.recipeKind,
          fps: 30,
          width: 1080,
          height: 1920,
          durationSeconds: 30,
          policy: { rightsRequired: true, humanReviewRequired: true, externalPublish: false, paidGeneration: false },
        }),
      });
      if (!validation.valid) {
        setNotice(`Recipe bị chặn: ${validation.errors.join("; ")}`);
        return;
      }
      const preview = await invoke<MockRecipePreview>("preview_recipe", { recipeKind: recipe.recipeKind });
      const job = await invoke<Job>("enqueue_mock_job", {
        projectId: selectedProjectId,
        recipeKind: recipe.recipeKind,
      });
      setJobs((current) => [job, ...current]);
      setSnapshot((current) => ({ ...current, jobCount: current.jobCount + 1 }));
      const warningText = validation.warnings.length ? ` Cảnh báo: ${validation.warnings.join("; ")}.` : "";
      setNotice(`${preview.message} ${preview.stages.length} stage; mock job ${job.jobId} đã ghi vào SQLite.${warningText}`);
      setActiveNav("jobs");
    } catch {
      setNotice("Không enqueue được job. Project phải tồn tại trong database local.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (window as unknown as { switchTab?: (t: string) => void }).switchTab = (t: string) => {
      setActiveNav(t);
    };
  }, []);

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
            onEnsureCloudGeneration={ensureCloudGenerationEnabled}
            localScriptReview={localScriptReview}
            videoSessions={videoWorkflowSessions}
            assets={assets}
            browserFlowWorkflow={browserFlowWorkflow}
            browserMcpFreshState={browserMcpFreshState}
            browserFlowBusy={browserHandoffBusy}
            voiceSettings={voiceSettings}
            promptObjective={contentGoal}
            additionalPrompt={additionalPrompt}
            onTopicChange={handleTopicInputChange}
            onActivity={(event) => recordWorkspaceActivity(event)}
            onNotice={setNotice}
            onGenerateScript={(approved, referenceContext) => generateLocalScript(approved, referenceContext)}
            onStartBrowserFlowDiscovery={async (script, report, sessionId, autoGenerate, autoRunId) => startBrowserFlowDiscovery(script, report, sessionId, autoGenerate, autoRunId)}
            onLoadBrowserFlowWorkflow={(sessionId) => { if (sessionId) void loadLatestBrowserFlowWorkflow(selectedProjectId, sessionId); else setBrowserFlowWorkflow(null); }}
            onRunBrowserFlowStep={(operation, element, elementRef) => void runBrowserFlowStep(operation, element ?? null, elementRef ?? null)}
            onSaveSession={(input, announce) => saveVideoWorkflowSession(input, announce)}
            onDeleteSession={(sessionId) => void deleteVideoWorkflowSession(sessionId)}
            onChooseSource={chooseAssetSource}
            onImport={importAsset}
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
        {activeNav === "voice" && <OmniVoiceStudioPanel projectId={selectedProjectId} profiles={voiceProfiles} samples={voiceSamples} readiness={omnivoiceReadiness} report={omnivoiceReport} loading={loading} settings={voiceSettings} onSettingsChange={setVoiceSettings} onCheck={(projectId) => void checkOmniVoice(projectId)} onPrepareModel={(projectId) => void prepareOmniVoiceModel(projectId)} onChooseReference={chooseVoiceReference} onNotice={setNotice} onCreate={(input) => void createVoiceProfile(input)} onUpdate={(input) => void updateVoiceProfile(input)} onDelete={(profile) => void deleteVoiceProfile(profile)} onSynthesize={(input) => void runOmniVoiceTts(input)} />}
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

      {showProjectForm && <div className="modal-backdrop" role="presentation" onClick={() => setShowProjectForm(false)}><div className="modal-card project-modal-card" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title" onClick={(event) => event.stopPropagation()}><div className="section-heading"><div><p className="eyebrow">KHÔNG GIAN LÀM VIỆC CỤC BỘ</p><h3 id="project-dialog-title">Tạo dự án mới</h3></div><button className="icon-button" onClick={() => setShowProjectForm(false)}>×</button></div><p className="modal-description">Dự án lưu thông tin mô tả vào SQLite cục bộ. Tệp phương tiện sẽ nằm trong không gian làm việc bạn chọn.</p><label>Tên dự án<input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label><label>Đường dẫn không gian làm việc<div className="workspace-picker-field"><input value={workspaceRoot} onChange={(event) => setWorkspaceRoot(event.target.value)} aria-label="Đường dẫn không gian làm việc" /><button type="button" className="secondary-button compact-button" onClick={() => void chooseWorkspace()}>Browse</button></div></label><label>Chủ đề / ý tưởng<textarea rows={3} value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Ví dụ: Vì sao cực quang xuất hiện?" /></label><label>Profile nội dung<select value={selectedTopicProfileId} onChange={(event) => selectTopicProfile(event.target.value)}>{topicProfiles.map((profile) => <option value={profile.profileId} key={profile.profileId}>{profile.name}</option>)}</select></label><p className="attempt-note">Prompt nội dung chi tiết sẽ được xem và chỉnh trong tab <strong>Quy trình video</strong>, mục Topic Studio.</p><div className="modal-actions"><button className="secondary-button" onClick={() => setShowProjectForm(false)}>Hủy</button><button className="primary-button" onClick={() => void createProject()} disabled={loading}>Tạo dự án cục bộ</button></div></div></div>}
    </div>
  );
}

function displayJobState(value: string) {
  const labels: Record<string, string> = { queued: "Đang chờ", running: "Đang chạy", succeeded: "Thành công", failed: "Thất bại", cancelled: "Đã hủy", cancel_requested: "Đang yêu cầu hủy", pending: "Chờ chuẩn bị", reconciliation_required: "Cần đối chiếu" };
  return labels[value] ?? value;
}

function displayWorkspaceActivityState(value: WorkspaceActivityState) {
  const labels: Record<WorkspaceActivityState, string> = { running: "Đang chạy", success: "Đã xong", info: "Thông tin", waiting_user: "Chờ bạn", error: "Lỗi", blocked: "Bị chặn", cancelled: "Đã hủy" };
  return labels[value];
}

function displayCommandCodeStatus(value: string) {
  const labels: Record<string, string> = {
    succeeded: "Thành công",
    worker_failed: "Bộ xử lý không chạy được",
    missing_credential: "Thiếu thông tin xác thực",
    invalid_configuration: "Cấu hình không hợp lệ",
    network_error: "Lỗi kết nối mạng",
    http_error: "Nhà cung cấp trả về lỗi HTTP",
    invalid_response: "Phản hồi không đúng định dạng",
    invalid_request: "Yêu cầu không hợp lệ",
  };
  return labels[value] ?? value;
}

function displayCommandCodeCost(value: string) {
  const labels: Record<string, string> = {
    local_gateway_unreported: "Gateway cục bộ chưa báo chi phí",
    not_called: "Chưa gọi",
    provider_deal_unverified: "Chưa xác minh ưu đãi nhà cung cấp",
    provider_declared_free_while_capacity_last: "Nhà cung cấp công bố miễn phí khi còn dung lượng",
  };
  return labels[value] ?? value;
}

function displayCredentialState(value: string) {
  const labels: Record<string, string> = { configured: "Đã cấu hình", missing: "Đang thiếu", unresolved: "Chưa phân giải", rejected: "Bị từ chối" };
  return labels[value] ?? value;
}

function displayPricingMode(value: string) {
  const labels: Record<string, string> = { free: "Miễn phí", paid: "Có phí", unknown: "Chưa rõ chi phí", local: "Cục bộ" };
  return labels[value] ?? value;
}

function displayCapability(value: string) {
  const labels: Record<string, string> = { llm: "Mô hình ngôn ngữ", image: "Hình ảnh", video: "Video", tts: "Giọng nói", stt: "Chuyển giọng thành chữ", audio: "Âm thanh", media: "Phương tiện" };
  return labels[value] ?? value;
}

function TabGuidePanel({ guide }: { guide: TabGuide }) {
  return <section className="tab-guide" aria-label={`Hướng dẫn ${guide.title}`}><div className="tab-guide-heading"><p className="eyebrow accent">{guide.eyebrow}</p><h3>{guide.title}</h3><p>{guide.purpose}</p></div><div className="tab-guide-steps">{guide.steps.map((step, index) => <div className="tab-guide-step" key={step}><span>{String(index + 1).padStart(2, "0")}</span><p>{step}</p></div>)}</div><div className="tab-guide-note"><strong>Lưu ý</strong><span>{guide.note}</span></div></section>;
}

type PreviewLibraryPanelProps = {
  projectId: string;
  projectName: string;
  loading: boolean;
  platforms: PreviewPlatform[];
  maxResults: number;
  creatorUrl: string;
  urls: string;
  cards: VideoPreviewCard[];
  selectedPreviewId: string | null;
  scanPlan: PreviewScanPlan | null;
  scanReport: PreviewScanReport | null;
  rightsStatus: AssetView["rightsStatus"];
  downloadReport: ReferenceVideoDownloadReport | null;
  onTogglePlatform: (value: PreviewPlatform) => void;
  onMaxResultsChange: (value: number) => void;
  onCreatorUrlChange: (value: string) => void;
  onUrlsChange: (value: string) => void;
  onPlanScan: () => void;
  onScanCreator: () => void;
  onScanLicensed: () => void;
  onImportUrls: () => void;
  onSelectPreview: (value: string | null) => void;
  onReviewSelected: (status: PreviewReviewStatus) => void;
  onTogglePlan: (previewId: string) => void;
  onClear: () => void;
  onRightsStatusChange: (value: AssetView["rightsStatus"]) => void;
  onDownloadSelected: () => void;
  onContinueToSubtitles: () => void;
  onContinueToVoice: () => void;
};

function PreviewLibraryPanel({ projectId, projectName, loading, platforms, maxResults, creatorUrl, urls, cards, selectedPreviewId, scanPlan, scanReport, rightsStatus, downloadReport, onTogglePlatform, onMaxResultsChange, onCreatorUrlChange, onUrlsChange, onPlanScan, onScanCreator, onScanLicensed, onImportUrls, onSelectPreview, onReviewSelected, onTogglePlan, onClear, onRightsStatusChange, onDownloadSelected, onContinueToSubtitles, onContinueToVoice }: PreviewLibraryPanelProps) {
  const previewPageSize = 12;
  const [previewPage, setPreviewPage] = useState(0);
  const [activeRadarBucket, setActiveRadarBucket] = useState<PreviewRadarBucket>("all");
  const [activePreviewSource, setActivePreviewSource] = useState<"all" | "social" | "licensed">("social");
  const [activePreviewTopic, setActivePreviewTopic] = useState<"all" | PreviewTopic>("all");
  const selectedCard = cards.find((card) => card.previewId === selectedPreviewId) ?? null;
  const plannedCount = cards.filter((card) => card.addedToPlan).length;
  const sourceCards = cards.filter((card) => activePreviewSource === "all" || (activePreviewSource === "licensed" ? card.platform === "wikimedia" || card.sourceKind === "licensed_public_archive" : card.platform !== "wikimedia" && card.sourceKind !== "licensed_public_archive"));
  const radarBucketCounts = previewRadarBucketOptions.reduce<Record<PreviewRadarBucket, number>>((counts, bucket) => {
    counts[bucket.value] = bucket.value === "all" ? sourceCards.length : sourceCards.filter((card) => previewRadarBuckets(card).includes(bucket.value as Exclude<PreviewRadarBucket, "all">)).length;
    return counts;
  }, { all: sourceCards.length, potential: 0, hot_new: 0, rising: 0, low_clone: 0, fresh: 0, unranked: 0 });
  const topicCards = activePreviewTopic === "all" ? sourceCards : sourceCards.filter((card) => previewTopicForCard(card) === activePreviewTopic);
  const filteredCards = activeRadarBucket === "all" ? topicCards : topicCards.filter((card) => previewRadarBuckets(card).includes(activeRadarBucket as Exclude<PreviewRadarBucket, "all">));
  const previewPageCount = Math.max(1, Math.ceil(filteredCards.length / previewPageSize));
  const previewPageIndex = Math.min(previewPage, previewPageCount - 1);
  const visibleCards = filteredCards.slice(previewPageIndex * previewPageSize, (previewPageIndex + 1) * previewPageSize);
  const rightsLabels: Record<AssetView["rightsStatus"], string> = { unknown: "Chưa xác nhận", pending: "Đang chờ duyệt", personal: "Tôi tự sở hữu / tự quay", owned: "Tôi sở hữu", licensed: "Đã có giấy phép", public_domain: "Phạm vi công cộng", restricted: "Bị hạn chế", rejected: "Không được dùng" };

  useEffect(() => {
    setPreviewPage((current) => Math.min(current, previewPageCount - 1));
  }, [previewPageCount]);
  useEffect(() => {
    setPreviewPage(0);
  }, [activeRadarBucket, activePreviewSource, activePreviewTopic]);
  useEffect(() => {
    if (!selectedCard) return;
    setActivePreviewSource(selectedCard.platform === "wikimedia" || selectedCard.sourceKind === "licensed_public_archive" ? "licensed" : "social");
  }, [selectedCard?.previewId]);

  return <section className="preview-library preview-redesign">
    <section className="panel preview-library-intro">
      <div>
        <p className="eyebrow accent">PREVIEW RADAR</p>
        <h3>Khám phá video có tiềm năng remix</h3>
        <p>Worker tự gom nhiều video public từ các nền tảng đã chọn, xoay qua nhiều chủ đề rồi chấm điểm hook, độ mới, tín hiệu tương tác và mức trùng trong lượt quét. Đây là shortlist để bạn xem, lồng voice và tự edit; không tự kết luận quyền reup.</p>
      </div>
      <div className="preview-library-count"><strong>{cards.length}</strong><span>video trong kho</span><small>{projectId ? projectName : "Chưa chọn project"}</small></div>
    </section>

    <section className="panel preview-scan-panel preview-command-panel">
      <details className="preview-secondary-source">
        <summary>Nguồn footage có license <span>Wikimedia Commons · mở khi cần</span></summary>
        <div className="preview-licensed-scan">
          <div className="preview-command-head"><div><p className="eyebrow accent">NGUỒN PHỤ</p><h3>Quét footage có license</h3><p className="section-subtitle">Tự tìm video tư liệu từ Wikimedia Commons, loại license không rõ hoặc không phù hợp edit, rồi chấm điểm tiềm năng cho short.</p></div><span className="readiness-chip">{previewLicensedSourceOptions[0].label}</span></div>
          <div className="preview-licensed-source-row"><div className="preview-licensed-source-copy"><strong>Wikimedia Commons</strong><span>Video public domain / CC có trang nguồn, tác giả và license để kiểm tra.</span></div><button className="primary-button preview-scan-button" type="button" onClick={() => void onScanLicensed()} disabled={loading || !projectId}>{loading ? "Đang lọc…" : "Quét footage có license"}</button></div>
          <p className="preview-command-note">Bộ lọc ưu tiên khung dọc hoặc dễ crop, độ dài phù hợp short, chủ đề thiên nhiên/khoa học/công nghệ/tư liệu và giảm điểm video cá nhân, phim, nhạc, tin hoặc thể thao. Đây là xếp hạng biên tập, không thay thế review quyền.</p>
        </div>
      </details>
      <div className="preview-command-head"><div><p className="eyebrow accent">MỘT LUỒNG QUÉT</p><h3>Chọn nền tảng rồi quét</h3><p className="section-subtitle">Chọn một hoặc nhiều nền tảng. App tự dùng adapter phù hợp cho từng nền tảng, gom kết quả và chia nhóm để bạn xem preview.</p></div><span className="readiness-chip">{platforms.length} nền tảng</span></div>
      <fieldset className="preview-platform-picker">
        <legend>Nền tảng quét cùng lúc</legend>
        <div className="preview-platform-grid">{previewPlatformOptions.map((option) => <label className={`preview-platform-option ${platforms.includes(option.value) ? "selected" : ""}`} key={option.value}><input type="checkbox" checked={platforms.includes(option.value)} onChange={() => onTogglePlatform(option.value)} /><span>{option.label}</span></label>)}</div>
      </fieldset>
      <div className="preview-command-row">
        <label>Tối đa mỗi nền tảng<select value={maxResults} onChange={(event) => onMaxResultsChange(Number(event.target.value))}>{[24, 48, 96, 200].map((count) => <option key={count} value={count}>{count} video</option>)}</select></label>
        <div className="preview-auto-sort-copy"><strong>Tự sort nhiều chủ đề</strong><span>Bộ xếp hạng nội bộ chia theo chủ đề, hook, mới, đang tăng, ít trùng và độ phù hợp để lồng voice/edit.</span></div>
        <button className="primary-button preview-scan-button" type="button" onClick={() => void onPlanScan()} disabled={loading || !projectId || !platforms.length}>{loading ? "Đang quét…" : "Quét nền tảng đã chọn"}</button>
      </div>
      {scanPlan && <div className={`preview-plan-status ${scanPlan.status}`}><div><strong>{scanPlan.status === "planned" ? "Đang quét" : scanPlan.status === "success" ? "Đã quét xong" : scanPlan.status === "blocked" ? "Phiên quét bị chặn" : "Chưa chạy"}</strong><span>{scanPlan.platforms.map(previewPlatformLabel).join(", ")} · {scanPlan.scanMode === "creator_catalog" ? "catalog creator/playlist công khai" : scanPlan.scanMode === "licensed_footage" ? "kho footage có license" : "luồng khám phá công khai"} · tối đa {scanPlan.maxResults} video</span></div><small>{scanPlan.worker}</small></div>}
      {scanReport && <div className="preview-platform-results"><div className="preview-platform-results-heading"><strong>Kết quả từng nền tảng</strong><span>{scanReport.cards.length} card · {scanReport.worker} · phiên {scanReport.status}</span></div>{scanReport.fallbackReason && <p className="preview-command-note">{scanReport.fallbackReason}</p>}<div className="preview-platform-result-list">{scanReport.platformResults.map((result) => <div className={`preview-platform-result ${result.status}`} key={result.platform}><span className="preview-platform-result-dot" /><div><strong>{previewPlatformLabel(result.platform)}</strong><span>{result.message}</span></div><b>{result.status === "success" ? `${result.scannedCount} video` : result.status === "waiting_user" ? "Chờ bạn" : result.status === "empty" ? "Không có kết quả" : "Bị chặn"}</b></div>)}</div>{scanReport.reportPath && <small className="preview-platform-results-path">Report: {scanReport.reportPath}</small>}</div>}
      <p className="preview-command-note">“Toàn bộ” nghĩa là quét các trang khám phá công khai trong giới hạn mỗi nền tảng. Nếu một nền tảng yêu cầu đăng nhập, CAPTCHA hoặc chặn truy cập, app sẽ báo riêng nền tảng đó.</p>
      <details className="preview-secondary-source">
        <summary>Quét một creator / playlist <span>tuỳ chọn · cần dán link nguồn</span></summary>
        <div className="preview-creator-scan">
          <div className="preview-creator-scan-head"><div><strong>Quét creator / playlist bằng yt-dlp</strong><span>Đường chạy thật để lấy nhiều card từ một nguồn công khai.</span></div><span className="readiness-chip">chỉ 1 nền tảng</span></div>
          <div className="preview-creator-scan-row"><label htmlFor="preview-creator-url">URL creator hoặc playlist<input id="preview-creator-url" value={creatorUrl} onChange={(event) => onCreatorUrlChange(event.target.value)} placeholder="https://www.tiktok.com/@creator" /></label><button className="secondary-button preview-scan-button" type="button" onClick={() => void onScanCreator()} disabled={loading || !projectId || !creatorUrl.trim()}>Quét nguồn</button></div>
          <p className="preview-command-note">Giữ đúng 1 ô nền tảng ở trên và dán link profile/playlist của nền tảng đó. Chế độ này trả URL + metadata preview, không phải bảng trending toàn mạng và không tự tải file.</p>
        </div>
      </details>
    </section>

    <div className="preview-results-layout">
      <section className="panel preview-queue-panel">
        <div className="preview-results-heading"><div><h3>Kết quả tự phân loại</h3><p className="section-subtitle">{cards.length ? `${plannedCount} video đã đưa vào plan tham khảo` : "Worker sẽ tự gom video vào các nhóm sau khi quét."}</p></div><div className="preview-results-actions">{cards.length > 0 && <span>{cards.length} video</span>}{cards.length > 0 && <button className="secondary-button compact-button" type="button" onClick={onClear}>Xóa kho</button>}</div></div>
        <div className="preview-result-filters"><div className="preview-filter-group"><span>Nguồn</span>{(["all", "social", "licensed"] as const).map((source) => <button key={source} className={activePreviewSource === source ? "active" : ""} type="button" onClick={() => setActivePreviewSource(source)}>{source === "all" ? "Tất cả" : source === "social" ? "Trend xã hội" : "Footage có license"}</button>)}</div><label>Chủ đề<select value={activePreviewTopic} onChange={(event) => setActivePreviewTopic(event.target.value as "all" | PreviewTopic)}>{previewTopicOptions.map((topic) => <option key={topic.value} value={topic.value}>{topic.label}</option>)}</select></label></div>
        <div className="preview-radar-buckets" role="tablist" aria-label="Nhóm video tự phân loại">{previewRadarBucketOptions.map((bucket) => <button className={activeRadarBucket === bucket.value ? "active" : ""} type="button" role="tab" aria-selected={activeRadarBucket === bucket.value} key={bucket.value} onClick={() => setActiveRadarBucket(bucket.value)}><span>{bucket.label}</span><strong>{radarBucketCounts[bucket.value]}</strong></button>)}</div>
        <p className="preview-radar-note">Trend xã hội được chấm từ dữ liệu public mà worker đọc được: hook/chủ đề, độ mới, tương tác nếu có và trùng trong lượt quét. “Ít trùng” chỉ là heuristic, không phải giấy phép reup.</p>
        {cards.length === 0 ? <div className="preview-empty-state"><strong>Chưa có video preview</strong><span>Chọn nền tảng ở trên rồi bấm Quét nền tảng đã chọn. Nguồn footage có license nằm trong mục mở rộng.</span></div> : filteredCards.length === 0 ? <div className="preview-empty-state"><strong>Bộ lọc này chưa có video</strong><span>Đổi nguồn/chủ đề hoặc chạy lại lượt quét.</span></div> : <>
          <div className="preview-card-grid">{visibleCards.map((card) => <article className={`preview-card ${selectedPreviewId === card.previewId ? "selected" : ""} ${card.addedToPlan ? "in-plan" : ""}`} key={card.previewId}>
            <button className="preview-card-media-button" type="button" onClick={() => onSelectPreview(card.previewId)} aria-label={`Xem ${card.title}`}><div className="preview-card-media">{card.thumbnailUrl ? <img src={card.thumbnailUrl} alt={`Thumbnail ${card.title}`} onError={(event) => { event.currentTarget.style.display = "none"; event.currentTarget.parentElement?.classList.add("preview-card-media-error"); }} /> : <div className="preview-card-placeholder"><strong>{previewEmbedUrl(card) ? "Có preview nhúng" : previewPlatformLabel(card.platform)}</strong><span>{previewEmbedUrl(card) ? "Bấm để mở video" : "Chỉ có link gốc để xem"}</span></div>}</div></button>
            <div className="preview-card-body"><div className="preview-card-top"><span>{previewPlatformLabel(card.platform)}</span><span>{card.addedToPlan ? "Đã vào plan" : "Chưa chọn"}</span></div><div className="preview-card-badges"><span className="preview-card-topic-badge">{previewTopicLabel(previewTopicForCard(card))}</span><span className={`preview-card-radar-badge ${previewRadarBuckets(card)[0]}`}>{previewRadarBucketLabel(previewRadarBuckets(card)[0])}</span>{typeof card.potentialScore === "number" && <span className="preview-card-potential-badge">Tiềm năng {card.potentialScore}/100</span>}<span className={`preview-card-rights-badge ${previewReuseStatus(card)}`}>{previewReuseStatusLabel(card)}</span>{card.reviewStatus && card.reviewStatus !== "unreviewed" && <span className={`preview-card-review-badge ${card.reviewStatus}`}>{previewReviewStatusLabel(card.reviewStatus)}</span>}</div><h4>{card.title}</h4><p>{card.author}</p>{card.licenseName && <span className="preview-card-license">{card.licenseName}</span>}<span className="preview-card-source" title={card.shareUrl}>{card.shareUrl}</span><div className="preview-card-actions"><button className="small-button" type="button" onClick={() => onTogglePlan(card.previewId)}>{card.addedToPlan ? "Bỏ khỏi plan" : "Đưa vào plan"}</button></div></div>
          </article>)}</div>
          {previewPageCount > 1 && <div className="preview-pagination"><span>Trang {previewPageIndex + 1} / {previewPageCount}</span><div><button className="small-button" type="button" onClick={() => setPreviewPage((current) => Math.max(current - 1, 0))} disabled={previewPageIndex === 0}>Trước</button><button className="small-button" type="button" onClick={() => setPreviewPage((current) => Math.min(current + 1, previewPageCount - 1))} disabled={previewPageIndex >= previewPageCount - 1}>Sau</button></div></div>}
        </>}
      </section>

      <aside className="panel preview-player-panel" aria-label="Preview đang chọn">
        <div className="preview-results-heading"><div><p className="eyebrow">ĐANG CHỌN</p><h3>Xem preview</h3></div><span className="readiness-chip">{selectedCard ? previewPlatformLabel(selectedCard.platform) : "Chưa chọn"}</span></div>
        {selectedCard ? <>
          <div className="preview-player-frame">{selectedCard.mediaUrl ? <video controls playsInline preload="metadata" poster={selectedCard.thumbnailUrl ?? undefined}><source src={selectedCard.mediaUrl} type={selectedCard.mediaMimeType ?? undefined} /></video> : previewEmbedUrl(selectedCard) ? <iframe src={previewEmbedUrl(selectedCard) ?? undefined} title={`TikTok preview ${selectedCard.title}`} loading="lazy" allow="autoplay; fullscreen" /> : selectedCard.thumbnailUrl ? <img src={selectedCard.thumbnailUrl} alt={`Thumbnail ${selectedCard.title}`} /> : <div className="preview-player-empty"><strong>Chưa có preview trực tiếp</strong><span>Nền tảng chưa cung cấp khung embed hoặc media trực tiếp; dùng Mở file page gốc để xem.</span></div>}</div>
          <div className="preview-player-meta"><strong>{selectedCard.title}</strong><span>{selectedCard.author} · quét lúc {formatPreviewScannedAt(selectedCard.scannedAt)}</span>{typeof selectedCard.potentialScore === "number" && <span>Điểm tiềm năng dựng short: <strong>{selectedCard.potentialScore}/100</strong></span>}{selectedCard.potentialEvidence && <small>{selectedCard.potentialEvidence}</small>}<span>Nhóm tự chọn: {previewRadarBucketLabel(previewRadarBuckets(selectedCard)[0])}</span><span>Review nội dung: {previewReviewStatusLabel(selectedCard.reviewStatus ?? "unreviewed")}</span><span className={`preview-player-rights ${previewReuseStatus(selectedCard)}`}>Quyền sử dụng: {previewReuseStatusLabel(selectedCard)}</span>{selectedCard.licenseName && <span>License: <strong>{selectedCard.licenseName}</strong></span>}{selectedCard.reuseEvidence && <small>{selectedCard.reuseEvidence}</small>}{selectedCard.licenseUrl && <a href={selectedCard.licenseUrl} target="_blank" rel="noreferrer">Mở điều kiện license</a>}<a href={selectedCard.shareUrl} target="_blank" rel="noreferrer">Mở file page gốc</a></div>
          <div className="preview-review-actions"><span>Xem video rồi chọn:</span><button className="secondary-button compact-button" type="button" onClick={() => onReviewSelected("keep")}>Giữ nội dung</button><button className="secondary-button compact-button" type="button" onClick={() => onReviewSelected("skip")}>Bỏ qua</button></div>
          <section className="preview-download-panel preview-download-inline">
            <div><h4>Đưa video vào pipeline</h4><p>Chỉ tải khi bạn có quyền sử dụng video này.</p></div>
            <label>Quyền sử dụng<select value={rightsStatus} onChange={(event) => onRightsStatusChange(event.target.value as AssetView["rightsStatus"])}>{Object.entries(rightsLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <button className="primary-button" type="button" onClick={onDownloadSelected} disabled={loading || !projectId || !["personal", "owned", "licensed", "public_domain"].includes(rightsStatus)}>Tải video đã duyệt</button>
            <span className="preview-download-note">Không dùng cookie, không né CAPTCHA, không xoá watermark.</span>
            {downloadReport && <div className={`preview-download-result ${downloadReport.status}`}><strong>{downloadReport.status === "succeeded" ? "Đã tải và nhập asset" : downloadReport.status === "blocked" ? "Chưa tải vì bị chặn" : "Tải thất bại"}</strong><span>{downloadReport.message}</span>{downloadReport.relativePath && <small className="mono">{downloadReport.relativePath}{downloadReport.sizeBytes ? ` · ${Math.round(downloadReport.sizeBytes / 1024 / 1024)} MB` : ""}</small>}{downloadReport.status === "succeeded" && <div className="preview-download-next"><button className="secondary-button compact-button" type="button" onClick={onContinueToSubtitles}>Mở Subtitle Studio</button><button className="secondary-button compact-button" type="button" onClick={onContinueToVoice}>Mở Voice Studio</button></div>}</div>}
          </section>
        </> : <div className="preview-player-empty large"><strong>Chọn một video</strong><span>Bấm vào ảnh trong danh sách để xem thông tin và thao tác tiếp.</span></div>}
      </aside>
    </div>

    <details className="panel preview-manual-import">
      <summary>Thêm bằng URL thủ công</summary>
      <div className="preview-manual-import-body"><p>Dùng khi bạn đã có link công khai. Mỗi link một dòng.</p><textarea value={urls} onChange={(event) => onUrlsChange(event.target.value)} placeholder="https://www.tiktok.com/@creator/video/1234567890&#10;https://www.douyin.com/video/1234567890" rows={4} aria-label="Danh sách URL video preview" /><div className="preview-import-actions"><button className="secondary-button" type="button" onClick={onImportUrls} disabled={loading || !projectId || !urls.trim()}>Thêm vào danh sách</button><span>Chỉ lưu metadata URL. Chưa tải file nguồn.</span></div></div>
    </details>
  </section>;
}

function HealthRow({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className="health-row"><span>{label}</span><span className={`health-value ${tone}`}><i />{value}</span></div>;
}

function MetricCard({ label, value, note, accent }: { label: string; value: number; note: string; accent: string }) {
  return <div className={`metric-card ${accent}`}><span className="metric-label">{label}</span><strong>{value.toString().padStart(2, "0")}</strong><span className="metric-note">{note}</span></div>;
}

function RecipeCard({ recipe, compact = false, onRun }: { recipe: Recipe; compact?: boolean; onRun: () => void }) {
  return <article className={`recipe-card ${compact ? "compact" : ""}`}><div className="recipe-card-top"><span className="recipe-symbol">{recipe.recipeKind === "true_3d" ? "3D" : recipe.recipeKind === "html_to_video" ? "&lt;/&gt;" : recipe.recipeKind === "voiceover_package" ? "VO" : recipe.recipeKind === "screen_demo" ? "REC" : recipe.recipeKind === "hybrid_2d_3d" ? "2+3" : "2D"}</span><span className={`availability ${recipe.localFirst ? "local" : "cloud"}`}>{recipe.localFirst ? "LOCAL" : "HYBRID"}</span></div><h4>{recipe.name}</h4><p>{recipe.worker}</p><div className="recipe-card-bottom"><span>{recipe.requiresApproval ? "Cần người dùng duyệt" : "Sẵn sàng"}</span><button className="small-button" onClick={onRun}>Chọn →</button></div></article>;
}

type ProjectWorkspaceNodeKind = "blank" | "prompt" | "video" | "asset" | "setup" | "output";
type ProjectWorkspaceNode = { id: string; left: string; top: string; kind: ProjectWorkspaceNodeKind; label: string; detail: string };
type ProjectWorkspaceConnection = { from: string; to: string };
type ProjectWorkspaceSnapshot = { nodes: ProjectWorkspaceNode[]; connections: ProjectWorkspaceConnection[] };

const projectWorkspaceDots = [
  { id: "node-01", left: "18%", top: "28%" }, { id: "node-02", left: "39%", top: "28%" },
  { id: "node-03", left: "61%", top: "28%" }, { id: "node-04", left: "24%", top: "61%" },
  { id: "node-05", left: "52%", top: "61%" }, { id: "node-06", left: "78%", top: "61%" },
];

const projectWorkspaceNodeCatalog: Array<{ kind: Exclude<ProjectWorkspaceNodeKind, "blank">; label: string; detail: string }> = [
  { kind: "prompt", label: "Prompt / Brief", detail: "Chủ đề và prompt của workspace" },
  { kind: "video", label: "Video Flow", detail: "Một video/sequence trong project" },
  { kind: "asset", label: "Asset ảnh / video", detail: "Ảnh phác, reference hoặc clip đã tải" },
  { kind: "setup", label: "Shot / Provider setup", detail: "Shot plan, Blender, Omni hoặc Flow" },
  { kind: "output", label: "Output / Review", detail: "Preview, file local và review" },
];

function initialProjectWorkspaceNodes(): ProjectWorkspaceNode[] {
  return projectWorkspaceDots.map((dot) => ({ ...dot, kind: "blank", label: "FLOW SLOT", detail: "Bấm để tạo Flow Card" }));
}

function ProjectWorkspaceCanvas({ projectId, projectName, topic, sessions, assets, activeSessionId, loading, agentBusy, onTopicChange, onOpenSession, onCreateSession, onCreateProject, onRunAgent, onAttachReference, onNotice, onOpenAdvanced }: { projectId: string; projectName: string; topic: string; sessions: VideoWorkflowSession[]; assets: AssetView[]; activeSessionId: string | null; loading: boolean; agentBusy: boolean; onTopicChange: (value: string) => void; onOpenSession: (session: VideoWorkflowSession) => void; onCreateSession: () => void; onCreateProject: () => void; onRunAgent: () => void; onAttachReference: () => void; onNotice: (message: string) => void; onOpenAdvanced: () => void }) {
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<ProjectWorkspaceNode[]>(initialProjectWorkspaceNodes);
  const [connections, setConnections] = useState<ProjectWorkspaceConnection[]>([]);
  const [connectionSourceId, setConnectionSourceId] = useState<string | null>(null);
  const [history, setHistory] = useState<ProjectWorkspaceSnapshot[]>([]);
  const [future, setFuture] = useState<ProjectWorkspaceSnapshot[]>([]);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const nodesRef = useRef(nodes);
  const connectionsRef = useRef(connections);
  const dragRef = useRef<{ id: string; snapshot: ProjectWorkspaceNode[]; startX: number; startY: number; startLeft: number; startTop: number; moved: boolean } | null>(null);
  const connectionDragRef = useRef<string | null>(null);
  const suppressClickRef = useRef(false);
  const videoAssets = assets.filter((asset) => asset.kind === "video" || asset.mimeType.startsWith("video/")).slice(0, 8);
  const imageAssets = assets.filter((asset) => !videoAssets.some((video) => video.assetId === asset.assetId)).slice(0, 8);
  const visibleSessions = sessions.slice(0, 8);
  const activeNode = nodes.find((node) => node.id === activeNodeId) ?? null;
  const renderedNodes = nodes.map((node) => node.kind === "video" && visibleSessions[0] && node.label === "Video Flow 01"
    ? { ...node, label: visibleSessions[0].name, detail: `${visibleSessions[0].status} · ${visibleSessions[0].durationSeconds ? `${visibleSessions[0].durationSeconds.toFixed(1)}s` : "draft"}` }
    : node);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { connectionsRef.current = connections; }, [connections]);
  useEffect(() => {
    const reset = initialProjectWorkspaceNodes();
    nodesRef.current = reset;
    setNodes(reset);
    connectionsRef.current = [];
    setConnections([]);
    setHistory([]);
    setFuture([]);
    setActiveNodeId(null);
  }, [projectId]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        setHistory((current) => {
          const previous = current[current.length - 1];
          if (!previous) return current;
          setFuture((next) => [{ nodes: nodesRef.current, connections: connectionsRef.current }, ...next].slice(0, 40));
          nodesRef.current = previous.nodes;
          connectionsRef.current = previous.connections;
          setNodes(previous.nodes);
          setConnections(previous.connections);
          return current.slice(0, -1);
        });
      } else if (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z")) {
        event.preventDefault();
        setFuture((current) => {
          const next = current[0];
          if (!next) return current;
          setHistory((previous) => [...previous, { nodes: nodesRef.current, connections: connectionsRef.current }].slice(-40));
          nodesRef.current = next.nodes;
          connectionsRef.current = next.connections;
          setNodes(next.nodes);
          setConnections(next.connections);
          return current.slice(1);
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function commitNodes(next: ProjectWorkspaceNode[], previous = nodesRef.current) {
    setHistory((current) => [...current, { nodes: previous, connections: connectionsRef.current }].slice(-40));
    setFuture([]);
    nodesRef.current = next;
    setNodes(next);
  }

  function commitConnections(next: ProjectWorkspaceConnection[]) {
    setHistory((current) => [...current, { nodes: nodesRef.current, connections: connectionsRef.current }].slice(-40));
    setFuture([]);
    connectionsRef.current = next;
    setConnections(next);
  }

  function assignNode(kind: ProjectWorkspaceNodeKind, value?: { label: string; detail: string }) {
    if (!activeNode) return;
    const preset = projectWorkspaceNodeCatalog.find((item) => item.kind === kind);
    if (!preset) return;
    const next = nodes.map((node) => node.id === activeNode.id ? { ...node, kind, label: value?.label ?? preset.label, detail: value?.detail ?? preset.detail } : node);
    commitNodes(next);
    setActiveNodeId(null);
    onNotice(`Đã gán “${value?.label ?? preset.label}” vào node ${activeNode.id}.`);
  }

  function handleNodeClick(node: ProjectWorkspaceNode) {
    if (suppressClickRef.current) return;
    if (node.kind === "blank") {
      const flowNumber = nodes.filter((item) => item.kind === "video").length + 1;
      const next = nodes.map((item) => item.id === node.id ? { ...item, kind: "video" as const, label: `Video Flow ${String(flowNumber).padStart(2, "0")}`, detail: "Flow card mới · bấm để setup prompt/asset" } : item);
      commitNodes(next);
      setActiveNodeId(node.id);
      onNotice(`Đã tạo Flow Card ${String(flowNumber).padStart(2, "0")}. Rê chuột lên card để kéo mũi tên nối với node khác.`);
      return;
    }
    setActiveNodeId((current) => current === node.id ? null : node.id);
  }

  function startConnection(event: ReactPointerEvent<HTMLSpanElement>, nodeId: string) {
    event.preventDefault();
    event.stopPropagation();
    connectionDragRef.current = nodeId;
    setConnectionSourceId(nodeId);
    onNotice(`Đang nối từ ${nodeId}. Kéo mũi tên lên một Flow Card hoặc node khác rồi thả.`);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>, node: ProjectWorkspaceNode) {
    if (event.button !== 0) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: node.id, snapshot: nodesRef.current, startX: event.clientX, startY: event.clientY, startLeft: Number.parseFloat(node.left), startTop: Number.parseFloat(node.top), moved: false };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>, node: ProjectWorkspaceNode) {
    const drag = dragRef.current;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!drag || drag.id !== node.id || !rect) return;
    const dx = ((event.clientX - drag.startX) / rect.width) * 100;
    const dy = ((event.clientY - drag.startY) / rect.height) * 100;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    const next = nodesRef.current.map((item) => item.id === node.id ? { ...item, left: `${Math.min(96, Math.max(4, drag.startLeft + dx))}%`, top: `${Math.min(91, Math.max(10, drag.startTop + dy))}%` } : item);
    nodesRef.current = next;
    setNodes(next);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.moved) {
      setHistory((current) => [...current, { nodes: drag.snapshot, connections: connectionsRef.current }].slice(-40));
      setFuture([]);
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  }

  useEffect(() => {
    const finishConnection = (event: PointerEvent) => {
      const sourceId = connectionDragRef.current;
      if (!sourceId) return;
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-workspace-node-id]")?.dataset.workspaceNodeId ?? null;
      if (target && target !== sourceId && !connectionsRef.current.some((connection) => connection.from === sourceId && connection.to === target)) {
        commitConnections([...connectionsRef.current, { from: sourceId, to: target }]);
        onNotice(`Đã nối ${sourceId} → ${target}.`);
      }
      connectionDragRef.current = null;
      setConnectionSourceId(null);
    };
    window.addEventListener("pointerup", finishConnection);
    return () => window.removeEventListener("pointerup", finishConnection);
  }, []);

  function chooseAsset(asset: AssetView) {
    assignNode("asset", { label: asset.title, detail: `${asset.kind} · ${asset.relativePath}` });
  }

  if (!projectId) return <section className="project-workspace-empty" aria-label="Tạo project workspace"><div><p className="eyebrow accent">PROJECT WORKSPACE</p><h2>Tạo workspace để bắt đầu</h2><p>Project là khung lớn chứa prompt, video flow, asset và output. Tạo một project trước rồi app mở thẳng canvas node.</p><button type="button" className="primary-button" onClick={onCreateProject}>＋ Tạo project / workspace</button></div></section>;

  return <section className="project-workspace-canvas" aria-label="Project workspace canvas">
    <div className="project-workspace-heading"><div><p className="eyebrow accent">PROJECT WORKSPACE / NODE CANVAS</p><h2>{projectName}</h2><p>Mỗi dấu chấm là một Flow Slot. Bấm chấm để tạo Flow Card; rê chuột lên card để hiện mũi tên và kéo nối sang card khác.</p></div><div className="project-workspace-heading-actions"><span className="studio-flow-project-chip"><span className="status-dot" />{sessions.length} VIDEO FLOW · {assets.length} ASSET</span><button type="button" className="secondary-button" onClick={onOpenAdvanced}>Asset Library</button><button type="button" className="secondary-button" onClick={onCreateSession}>＋ Tạo Flow mới</button></div></div>
      <div className="project-workspace-promptbar"><div><label htmlFor="project-workspace-prompt">CHỈ CẦN NHẬP PROMPT VIDEO</label><textarea id="project-workspace-prompt" value={topic} onChange={(event) => onTopicChange(event.target.value)} disabled={loading || agentBusy} rows={5} placeholder="Ví dụ: Một con hổ khổng lồ xuyên không về thời khủng long, gặp T-Rex và chiến đấu trong rừng mưa cinematic 3D…" /><small className="project-workspace-prompt-hint">Agent sẽ tự phân tích chủ đề, tạo style/world bible, chia shot rồi gửi thẳng sang provider.</small></div><div className="project-workspace-prompt-actions"><button type="button" className="secondary-button" onClick={onAttachReference} disabled={loading || agentBusy}>＋ Gắn asset (tùy chọn)</button><button type="button" className="primary-button" onClick={onRunAgent} disabled={loading || agentBusy}>{loading || agentBusy ? "⏳ Đang tự làm…" : "🚀 Tự làm toàn bộ"}</button></div></div>
    <div className="project-workspace-toolbar"><span>CANVAS / {projectName}</span><div><button type="button" onClick={() => { setHistory((current) => { const previous = current[current.length - 1]; if (!previous) return current; setFuture((next) => [{ nodes: nodesRef.current, connections: connectionsRef.current }, ...next].slice(0, 40)); nodesRef.current = previous.nodes; connectionsRef.current = previous.connections; setNodes(previous.nodes); setConnections(previous.connections); return current.slice(0, -1); }); }} disabled={!history.length}>↶ Undo</button><button type="button" onClick={() => { setFuture((current) => { const next = current[0]; if (!next) return current; setHistory((previous) => [...previous, { nodes: nodesRef.current, connections: connectionsRef.current }].slice(-40)); nodesRef.current = next.nodes; connectionsRef.current = next.connections; setNodes(next.nodes); setConnections(next.connections); return current.slice(1); }); }} disabled={!future.length}>↷ Redo</button></div></div>
    <div className="project-workspace-stage" ref={stageRef}>
      <svg className="project-workspace-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="project-workspace-arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 z" fill="rgba(88,213,200,.85)" /></marker></defs>{connections.map((connection) => { const from = nodes.find((node) => node.id === connection.from); const to = nodes.find((node) => node.id === connection.to); return from && to ? <line key={`${connection.from}-${connection.to}`} x1={Number.parseFloat(from.left)} y1={Number.parseFloat(from.top)} x2={Number.parseFloat(to.left)} y2={Number.parseFloat(to.top)} markerEnd="url(#project-workspace-arrow)" /> : null; })}</svg>
      <div className="project-workspace-root"><span className="project-workspace-node-kind">PROJECT ROOT</span><strong>{projectName}</strong><small>{topic.trim() || "Bấm prompt để bắt đầu workspace."}</small></div>
      <div className="project-workspace-flow-chain" aria-label="Các video flow trong project">{visibleSessions.length > 0 ? visibleSessions.map((session) => <button type="button" key={session.sessionId} className={`project-workspace-flow-node ${activeSessionId === session.sessionId ? "active" : ""}`} onClick={() => onOpenSession(session)}><span>VIDEO FLOW</span><strong>{session.name}</strong><small>{session.durationSeconds ? `${session.durationSeconds.toFixed(1)}s` : "draft"} · {session.lastStep || session.status}</small><i>→</i></button>) : <button type="button" className="project-workspace-flow-node empty" onClick={onCreateSession}><span>VIDEO FLOW</span><strong>Chưa có flow video</strong><small>Bấm để tạo Flow đầu tiên trong project</small><i>＋</i></button>}</div>
      <div className="project-workspace-asset-rack"><div><span className="project-workspace-node-kind">ASSET RACK</span><strong>Asset của project</strong></div>{assets.length === 0 ? <small>Chưa có asset. Bấm node hoặc Asset Library để nhập.</small> : assets.slice(0, 10).map((asset) => <button type="button" key={asset.assetId} className="project-workspace-asset-node" onClick={() => chooseAsset(asset)}><span>{asset.kind.toUpperCase()}</span><strong>{asset.title}</strong><small>{asset.relativePath}</small></button>)}</div>
      {renderedNodes.map((node) => <button type="button" key={node.id} data-workspace-node-id={node.id} className={`project-workspace-dot project-workspace-dot-${node.kind} ${activeNodeId === node.id ? "active" : ""} ${connectionSourceId === node.id ? "connection-source" : ""} ${dragRef.current?.id === node.id ? "dragging" : ""}`} style={{ left: node.left, top: node.top }} title={node.kind === "blank" ? "Bấm để tạo Flow Card" : "Rê chuột để hiện mũi tên nối node"} aria-label={`Node ${node.id}: ${node.label}`} onPointerDown={(event) => handlePointerDown(event, node)} onPointerMove={(event) => handlePointerMove(event, node)} onPointerUp={handlePointerUp} onClick={() => handleNodeClick(node)}>{node.kind === "blank" ? "•" : <><b>{node.label}</b><small>{node.detail}</small><span className="project-workspace-connect-handle" role="button" tabIndex={0} aria-label={`Kéo nối từ ${node.label}`} onPointerDown={(event) => startConnection(event, node.id)}>→</span></>}</button>)}
      {activeNode && <div className="project-workspace-menu" role="menu"><div className="project-workspace-menu-head"><strong>NODE {activeNode.id} · CHỌN LOẠI</strong><button type="button" aria-label="Đóng menu" onClick={() => setActiveNodeId(null)}>×</button></div>{projectWorkspaceNodeCatalog.map((item) => <button type="button" key={item.kind} className={`project-workspace-menu-choice ${activeNode.kind === item.kind ? "selected" : ""}`} onClick={() => assignNode(item.kind)}><b>{item.label}</b><small>{item.detail}</small></button>)}<div className="project-workspace-menu-section"><strong>GẮN VIDEO FLOW</strong>{visibleSessions.length ? visibleSessions.map((session) => <button type="button" key={session.sessionId} onClick={() => { assignNode("video", { label: session.name, detail: `${session.status} · ${session.durationSeconds ? `${session.durationSeconds.toFixed(1)}s` : "draft"}` }); onOpenSession(session); }}><b>{session.name}</b><small>{session.status}</small></button>) : <small>Chưa có flow video.</small>}</div><div className="project-workspace-menu-section"><strong>GẮN ASSET VIDEO / ẢNH</strong>{[...videoAssets, ...imageAssets].slice(0, 8).map((asset) => <button type="button" key={asset.assetId} onClick={() => chooseAsset(asset)}><b>{asset.title}</b><small>{asset.kind} · {asset.relativePath}</small></button>)}{assets.length === 0 && <small>Chưa có asset trong project.</small>}</div><button type="button" className="project-workspace-menu-secondary" onClick={() => { setActiveNodeId(null); onOpenAdvanced(); }}>Mở Asset Library</button></div>}
    </div>
    <div className="project-workspace-legend"><span><i className="legend-slot" /> Flow Slot trống</span><span><i className="legend-flow" /> Flow Card</span><span><i className="legend-asset" /> Asset / Setup</span><small>Rê chuột lên Flow Card để kéo mũi tên nối.</small></div>
  </section>;
}

function AssetPackReviewPanel({
  projectId,
  projectName,
  packs,
  loading,
  blenderBinding,
  blenderRun,
  onChoosePack,
  onRegisterPack,
  onReview,
  onPrepareBlenderBinding,
  onRunBlenderBinding,
  onNotice,
}: {
  projectId?: string;
  projectName?: string;
  packs: AssetPackReview[];
  loading: boolean;
  blenderBinding: AssetPackBlenderBindingReport | null;
  blenderRun: AssetPackBlenderBindingRunReport | null;
  onChoosePack: () => Promise<string | null>;
  onRegisterPack: (path: string) => Promise<AssetPackReview[] | null>;
  onReview: (input: { packId: string; assetItemId: string; reviewState: AssetPackReviewItem["reviewState"]; rightsStatus: AssetView["rightsStatus"]; acceptanceChecks: AssetPackAcceptanceCheck[]; note: string }) => Promise<AssetPackReview | null>;
  onPrepareBlenderBinding: (packId: string) => Promise<AssetPackBlenderBindingReport | null>;
  onRunBlenderBinding: (bindingId: string) => Promise<AssetPackBlenderBindingRunReport | null>;
  onNotice: (message: string) => void;
}) {
  const [selectedPackId, setSelectedPackId] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [draft, setDraft] = useState({ reviewState: "in_review" as AssetPackReviewItem["reviewState"], rightsStatus: "pending" as AssetView["rightsStatus"], checks: [] as AssetPackAcceptanceCheck[], note: "" });
  const [preview, setPreview] = useState<AssetPreviewView | null>(null);
  const [previewMessage, setPreviewMessage] = useState("");

  const selectedPack = packs.find((pack) => pack.packId === selectedPackId) ?? packs[0] ?? null;
  const selectedItem = selectedPack?.items.find((item) => item.assetItemId === selectedItemId) ?? selectedPack?.items[0] ?? null;
  const allItemsApproved = Boolean(selectedPack && selectedPack.items.length > 0 && selectedPack.items.every((item) => item.reviewState === "approved"));

  useEffect(() => {
    if (!selectedPackId && packs[0]) setSelectedPackId(packs[0].packId);
    if (selectedPackId && !packs.some((pack) => pack.packId === selectedPackId)) setSelectedPackId(packs[0]?.packId ?? "");
  }, [packs, selectedPackId]);

  useEffect(() => {
    if (!selectedPack || !selectedPack.items.some((item) => item.assetItemId === selectedItemId)) {
      setSelectedItemId(selectedPack?.items[0]?.assetItemId ?? "");
    }
  }, [selectedPack, selectedItemId]);

  useEffect(() => {
    if (!selectedItem) return;
    setDraft({ reviewState: selectedItem.reviewState, rightsStatus: selectedItem.rightsStatus, checks: selectedItem.acceptanceChecks.map((check) => ({ ...check })), note: selectedItem.note });
    setPreview(null);
    setPreviewMessage("");
    const relativePath = selectedItem.outputAssets[0]?.relativePath ?? selectedItem.outputPaths[0];
    if (!projectId || !relativePath) return;
    let cancelled = false;
    void invoke<AssetPreviewView>("read_project_asset_preview", { projectId, relativePath })
      .then((value) => { if (!cancelled) setPreview(value); })
      .catch((error) => { if (!cancelled) setPreviewMessage(String(error).slice(0, 180)); });
    return () => { cancelled = true; };
  }, [projectId, selectedItem]);

  async function loadPack() {
    const path = await onChoosePack();
    if (!path) return;
    onNotice("Đang nạp manifest, item và report của Asset Pack…");
    await onRegisterPack(path);
  }

  async function saveReview(reviewState: AssetPackReviewItem["reviewState"]) {
    if (!selectedPack || !selectedItem) return;
    await onReview({ packId: selectedPack.packId, assetItemId: selectedItem.assetItemId, reviewState, rightsStatus: draft.rightsStatus, acceptanceChecks: draft.checks, note: draft.note });
  }

  function toggleCheck(checkId: string, status: AssetPackAcceptanceCheck["status"]) {
    setDraft((current) => ({ ...current, checks: current.checks.map((check) => check.checkId === checkId ? { ...check, status } : check) }));
  }

  const counts = selectedPack?.items.reduce((result, item) => { result[item.reviewState] = (result[item.reviewState] ?? 0) + 1; return result; }, {} as Record<string, number>) ?? {};

  return <section className="panel asset-pack-review-panel" aria-label="Asset Pack Review">
    <div className="asset-reference-heading">
      <div>
        <p className="eyebrow accent">ASSET PACK / REVIEW GATE</p>
        <h2>Subject, world, prop và scale trước khi vào Blender</h2>
        <p>Manifest/report được đọc từ workspace; review được lưu riêng trong SQLite. Asset đã approve không bị ghi đè, và quyền vẫn là gate trước khi bind.</p>
      </div>
      <div className="asset-reference-summary"><span>PROJECT</span><strong>{projectName ?? "Chưa chọn project"}</strong><small>{packs.length} pack · {selectedPack?.items.length ?? 0} item</small><button type="button" className="small-button" onClick={() => void loadPack()} disabled={loading || !projectId}>＋ Nạp asset-pack.json</button></div>
    </div>
    {packs.length === 0 ? <div className="asset-pack-empty"><strong>Chưa có Asset Pack trong workspace</strong><span>Chọn file <code>asset-pack.json</code>; app sẽ tìm <code>asset-items.json</code> và report cùng thư mục.</span><button type="button" className="primary-button" onClick={() => void loadPack()} disabled={loading || !projectId}>Nạp Asset Pack</button></div> : <div className="asset-pack-review-grid">
      <aside className="asset-pack-list-column">
        <div className="asset-column-toolbar"><strong>Pack đã nạp</strong><span className="asset-pack-count">{counts.approved ?? 0}/{selectedPack?.items.length ?? 0} approved</span></div>
        <div className="asset-pack-items">{packs.map((pack) => <button type="button" key={pack.packId} className={`asset-pack-list-item ${pack.packId === selectedPack?.packId ? "selected" : ""}`} onClick={() => setSelectedPackId(pack.packId)} disabled={loading}><span><b>{pack.title}</b><small>{pack.status} · {pack.items.length} item</small><em>{pack.source.packRelativePath}</em></span><i>{pack.items.filter((item) => item.reviewState === "approved").length}/{pack.items.length}</i></button>)}</div>
        {selectedPack?.report ? <div className="asset-pack-report"><b>GENERATION REPORT</b><span>{selectedPack.report.status} · {selectedPack.report.runId || "chưa có run"}</span><small>{selectedPack.report.relativePath}</small></div> : <div className="asset-pack-report muted"><b>REPORT</b><span>Chưa có asset-generation-report.json</span></div>}
      </aside>
      <aside className="asset-pack-items-column">
        <div className="asset-column-toolbar"><strong>Items theo vai trò</strong><span>{counts.in_review ?? 0} review · {counts.needs_revision ?? 0} cần sửa</span></div>
        <div className="asset-pack-item-list">{selectedPack?.items.map((item) => <button type="button" key={item.assetItemId} className={`asset-pack-item-row ${item.assetItemId === selectedItem?.assetItemId ? "selected" : ""}`} onClick={() => setSelectedItemId(item.assetItemId)} disabled={loading}><span><b>{item.title}</b><small>{item.role} · {item.status} · quyền {item.rightsStatus}</small><em>{item.shotIds.length ? item.shotIds.join(", ") : "chưa gắn shot"}</em></span><i className={`asset-pack-review-pill ${item.reviewState}`}>{item.reviewState}</i></button>)}</div>
      </aside>
      <div className="asset-pack-inspector">
        {selectedItem ? <>
          <div className="asset-inspector-title"><div><p className="eyebrow">ASSET PACK ITEM</p><h3>{selectedItem.title}</h3><small>{selectedItem.assetItemId} · {selectedItem.role} · {selectedItem.scaleMeters ? `${selectedItem.scaleMeters}m` : "scale chưa khai báo"}</small></div><span className={`asset-state-badge ${selectedItem.reviewState}`}>{selectedItem.reviewState}</span></div>
          <div className="asset-pack-preview">{preview ? <img src={`data:${preview.mimeType};base64,${preview.base64Data}`} alt={`Preview ${selectedItem.title}`} /> : <div><strong>Chưa có preview ảnh</strong><span>{previewMessage || selectedItem.outputPaths[0] || "Output chưa được ingest vào Asset Library."}</span></div>}</div>
          <div className="asset-pack-facts"><span><b>Output asset IDs</b><code>{selectedItem.outputAssetIds.join(", ") || "—"}</code></span><span><b>Views</b><code>{selectedItem.requiredViews.join(", ") || "—"}</code></span><span><b>Shot IDs</b><code>{selectedItem.shotIds.join(", ") || "—"}</code></span><span><b>Output paths</b><code>{selectedItem.outputPaths.join(" · ") || "—"}</code></span></div>
          <details className="asset-pack-prompt-details"><summary>Prompt và negative prompt</summary><pre>{selectedItem.prompt}{selectedItem.negativePrompt ? `\n\nNEGATIVE:\n${selectedItem.negativePrompt}` : ""}</pre></details>
          <div className="asset-pack-checks"><div className="asset-column-toolbar"><strong>Acceptance checks</strong><span>Pass đủ check bắt buộc để approve</span></div>{draft.checks.length === 0 ? <span className="muted-copy">Item không khai báo checklist.</span> : draft.checks.map((check) => <label className="asset-pack-check" key={check.checkId}><input type="checkbox" checked={check.status === "pass"} onChange={(event) => toggleCheck(check.checkId, event.target.checked ? "pass" : "pending")} disabled={loading || selectedItem.reviewState === "approved"} /><span><b>{check.description || check.checkId}</b><small>{check.required ? "Bắt buộc" : "Tuỳ chọn"} · {check.status}</small></span></label>)}</div>
          <div className="asset-pack-review-fields"><label>Quyền<select value={draft.rightsStatus} onChange={(event) => setDraft((current) => ({ ...current, rightsStatus: event.target.value as AssetView["rightsStatus"] }))} disabled={loading || selectedItem.reviewState === "approved"}><option value="pending">Cần review</option><option value="personal">Cá nhân</option><option value="owned">Sở hữu</option><option value="licensed">Đã cấp phép</option><option value="public_domain">Public domain</option><option value="restricted">Hạn chế</option><option value="rejected">Từ chối</option></select></label><label>Ghi chú review<textarea value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} disabled={loading || selectedItem.reviewState === "approved"} placeholder="Giữ identity nào, lỗi nào, lý do reject/revision…" /></label></div>
          <div className="asset-actions"><button type="button" className="primary-button" onClick={() => void saveReview("approved")} disabled={loading || selectedItem.reviewState === "approved"}>Approve item</button><button type="button" className="secondary-button" onClick={() => void saveReview("in_review")} disabled={loading || selectedItem.reviewState === "approved"}>Lưu đang review</button><button type="button" className="secondary-button" onClick={() => void saveReview("needs_revision")} disabled={loading || selectedItem.reviewState === "approved"}>Đánh dấu cần tạo lại</button><button type="button" className="danger-button" onClick={() => void saveReview("rejected")} disabled={loading || selectedItem.reviewState === "approved"}>Reject item</button></div>
        </> : <div className="asset-empty-state large"><strong>Chọn một Asset Pack item</strong><span>App sẽ hiện preview, prompt, checklist, quyền và shot references ở đây.</span></div>}
      </div>
    </div>}
    <div className="asset-pack-blender-gate">
      <div>
        <p className="eyebrow accent">BLENDER BINDING / PREVIEW GATE</p>
        <strong>Compile asset approved thành Blender job</strong>
        <span>Kiểm tra identity, hash file, quyền, scale reference, shot IDs và continuity trước khi tạo job. Sau đó có thể chạy Blender preview local bằng worker đã version hóa.</span>
      </div>
      <div className="asset-pack-blender-actions">
        <button type="button" className="secondary-button" onClick={() => selectedPack && void onPrepareBlenderBinding(selectedPack.packId)} disabled={loading || !selectedPack || !allItemsApproved}>Chuẩn bị Blender binding</button>
        <button type="button" className="primary-button" onClick={() => blenderBinding && void onRunBlenderBinding(blenderBinding.bindingId)} disabled={loading || blenderBinding?.packId !== selectedPack?.packId || blenderBinding?.status !== "ready_for_blender_review" || blenderRun?.bindingId === blenderBinding?.bindingId}>Chạy Blender preview</button>
      </div>
      {!allItemsApproved && selectedPack && <small>Approve đủ {selectedPack.items.length} item trước khi bind.</small>}
      {blenderBinding && blenderBinding.packId === selectedPack?.packId && <div className={`asset-pack-binding-result ${blenderBinding.status}`}><b>{blenderBinding.status === "ready_for_blender_review" ? "Binding đã sẵn sàng review" : "Binding bị chặn"}</b><span>{blenderBinding.assetCount} binding · {blenderBinding.shotIds.length} shot · world scale {blenderBinding.worldScaleMeters ?? "—"}m</span><small>{blenderBinding.bindingPath ?? blenderBinding.message}</small>{blenderBinding.blockers.length > 0 && <em>{blenderBinding.blockers.slice(0, 4).join(" · ")}</em>}</div>}
      {blenderRun && blenderRun.bindingId === blenderBinding?.bindingId && <div className="asset-pack-run-result"><b>Blender preview đã chạy · cần duyệt</b><span>{blenderRun.scenePath}</span><small>{blenderRun.previewOutputs.join(" · ")}</small><em>{blenderRun.message}</em></div>}
    </div>
  </section>;
}

function AssetReferencePanel({
  projectName,
  assets,
  referenceSets,
  loading,
  onChooseSource,
  onImport,
  onUpdateAsset,
  onAssetState,
  onCreateSet,
  onUpdateSet,
  onSetState,
  onAssign,
  onDetach,
}: {
  projectName?: string;
  assets: AssetView[];
  referenceSets: ReferenceSet[];
  loading: boolean;
  onChooseSource: () => Promise<string | null>;
  onImport: (input: { sourcePath: string; title: string; mediaKind: string; sourceUri: string | null; tags: string[]; note: string; rightsStatus: AssetView["rightsStatus"] }) => Promise<AssetView | null>;
  onUpdateAsset: (assetId: string, draft: AssetMetadataDraft) => Promise<AssetView | null>;
  onAssetState: (asset: AssetView, action: "archive" | "restore") => void | Promise<void>;
  onCreateSet: (input: { name: string; scope: ReferenceSet["scope"]; continuityNote: string }) => Promise<ReferenceSet | null>;
  onUpdateSet: (referenceSetId: string, input: { name: string; scope: ReferenceSet["scope"]; continuityNote: string }) => Promise<ReferenceSet | null>;
  onSetState: (referenceSet: ReferenceSet, action: "archive" | "restore") => void | Promise<void>;
  onAssign: (input: { referenceSetId: string; assetId: string; role: ReferenceAssignment["role"]; strength: number; priority: number; shotId: string; notes: string; approved: boolean }) => Promise<ReferenceSet | null>;
  onDetach: (assignmentId: string) => void | Promise<void>;
}) {
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [selectedSetId, setSelectedSetId] = useState("");
  const [assetDraft, setAssetDraft] = useState<AssetMetadataDraft>({ title: "", sourceUri: "", tags: "", note: "", rightsStatus: "pending" });
  const [importKind, setImportKind] = useState("image");
  const [importRights, setImportRights] = useState<AssetView["rightsStatus"]>("pending");
  const [setDraft, setSetDraft] = useState({ name: "", scope: "sequence" as ReferenceSet["scope"], continuityNote: "" });
  const [setEditorMode, setSetEditorMode] = useState<"new" | "edit">("new");
  const [assignment, setAssignment] = useState({ assetId: "", role: "identity" as ReferenceAssignment["role"], strength: 1, priority: 0, shotId: "", notes: "", approved: false });

  const selectedAsset = assets.find((asset) => asset.assetId === selectedAssetId) ?? null;
  const selectedSet = referenceSets.find((referenceSet) => referenceSet.referenceSetId === selectedSetId) ?? null;
  const activeAssets = assets.filter((asset) => asset.status !== "archived");
  const activeSets = referenceSets.filter((referenceSet) => referenceSet.status !== "archived");

  useEffect(() => {
    if (!selectedAssetId && activeAssets[0]) setSelectedAssetId(activeAssets[0].assetId);
  }, [activeAssets, selectedAssetId]);

  useEffect(() => {
    if (!selectedSetId && activeSets[0]) setSelectedSetId(activeSets[0].referenceSetId);
  }, [activeSets, selectedSetId]);

  useEffect(() => {
    if (selectedAsset) {
      setAssetDraft({ title: selectedAsset.title, sourceUri: selectedAsset.sourceUri ?? "", tags: selectedAsset.tags.join(", "), note: selectedAsset.note, rightsStatus: selectedAsset.rightsStatus });
      setAssignment((current) => ({ ...current, assetId: current.assetId || selectedAsset.assetId }));
    }
  }, [selectedAsset]);

  useEffect(() => {
    if (selectedSet) {
      setSetDraft({ name: selectedSet.name, scope: selectedSet.scope, continuityNote: selectedSet.continuityNote });
      setSetEditorMode("edit");
    }
  }, [selectedSet]);

  async function importFromDisk() {
    const sourcePath = await onChooseSource();
    if (!sourcePath) return;
    const imported = await onImport({ sourcePath, title: "", mediaKind: importKind, sourceUri: null, tags: [], note: "", rightsStatus: importRights });
    if (imported) setSelectedAssetId(imported.assetId);
  }

  async function saveAsset() {
    if (!selectedAsset) return;
    await onUpdateAsset(selectedAsset.assetId, assetDraft);
  }

  async function saveSet() {
    if (!setDraft.name.trim()) return;
    const saved = setEditorMode === "edit" && selectedSet
      ? await onUpdateSet(selectedSet.referenceSetId, setDraft)
      : await onCreateSet(setDraft);
    if (saved) {
      setSelectedSetId(saved.referenceSetId);
      setSetDraft({ name: saved.name, scope: saved.scope, continuityNote: saved.continuityNote });
      setSetEditorMode("edit");
    }
  }

  async function assignCurrentReference() {
    if (!selectedSet || !assignment.assetId) return;
    await onAssign({ ...assignment, referenceSetId: selectedSet.referenceSetId });
  }

  return <section className="panel asset-reference-panel" aria-label="Asset Library và Reference Sets">
    <div className="asset-reference-heading">
      <div>
        <p className="eyebrow accent">ASSET LIBRARY / REFERENCE SETS</p>
        <h2>Asset local và continuity cho shot</h2>
        <p>Nhập file có hash, quyền và path rõ ràng; sau đó gán vào reference set để prompt/Blender/Omni dùng lại đúng asset.</p>
      </div>
      <div className="asset-reference-summary"><span>PROJECT</span><strong>{projectName ?? "Chưa chọn project"}</strong><small>{activeAssets.length} asset · {activeSets.length} reference set</small></div>
    </div>
    <div className="asset-reference-grid">
      <aside className="asset-library-column">
        <div className="asset-column-toolbar"><strong>Asset local</strong><button type="button" className="small-button" onClick={() => void importFromDisk()} disabled={loading}>+ Nhập file</button></div>
        <div className="asset-import-quick"><label>Loại<select value={importKind} onChange={(event) => setImportKind(event.target.value)} disabled={loading}><option value="image">Image / frame</option><option value="video">Video</option><option value="audio">Audio</option><option value="model3d">Model 3D</option><option value="scene">Blender scene</option><option value="texture">Texture</option><option value="sketch">Sketch</option><option value="render">Render output</option><option value="subtitle">Subtitle</option><option value="document">Document</option></select></label><label>Quyền mặc định<select value={importRights} onChange={(event) => setImportRights(event.target.value as AssetView["rightsStatus"])} disabled={loading}><option value="pending">Cần review</option><option value="personal">Cá nhân</option><option value="owned">Sở hữu</option><option value="licensed">Đã cấp phép</option><option value="public_domain">Public domain</option></select></label></div>
        {assets.length === 0 ? <div className="asset-empty-state"><strong>Chưa có asset local</strong><span>Bấm “Nhập file” để app hash và ghi asset vào project.</span></div> : <div className="asset-items">{assets.map((asset) => <button type="button" key={asset.assetId} className={`asset-item ${asset.assetId === selectedAssetId ? "selected" : ""} ${asset.status === "archived" ? "archived" : ""}`} onClick={() => setSelectedAssetId(asset.assetId)} disabled={loading}><span><b>{asset.title}</b><small>{asset.kind} · {asset.status} · quyền: {asset.rightsStatus}</small><em>{asset.relativePath}</em></span><i>{asset.sha256.slice(0, 8)}</i></button>)}</div>}
      </aside>
      <div className="asset-inspector-column">
        <div className="asset-inspector-title"><div><p className="eyebrow">ASSET INSPECTOR</p><h3>{selectedAsset?.title ?? "Chọn asset để sửa"}</h3></div>{selectedAsset ? <span className={`asset-state-badge ${selectedAsset.status}`}>{selectedAsset.status}</span> : null}</div>
        {selectedAsset ? <>
          <div className="asset-facts"><span><b>SHA-256</b><code>{selectedAsset.sha256}</code></span><span><b>Path</b><code>{selectedAsset.relativePath}</code></span><span><b>MIME / size</b><code>{selectedAsset.mimeType} · {(selectedAsset.sizeBytes / 1024 / 1024).toFixed(2)} MB</code></span></div>
          <div className="asset-editor-fields"><label>Tên hiển thị<input value={assetDraft.title} onChange={(event) => setAssetDraft((current) => ({ ...current, title: event.target.value }))} disabled={loading || selectedAsset.status === "archived"} /></label><label>Quyền sử dụng<select value={assetDraft.rightsStatus} onChange={(event) => setAssetDraft((current) => ({ ...current, rightsStatus: event.target.value as AssetView["rightsStatus"] }))} disabled={loading || selectedAsset.status === "archived"}><option value="pending">Cần review</option><option value="personal">Cá nhân</option><option value="owned">Sở hữu</option><option value="licensed">Đã cấp phép</option><option value="public_domain">Public domain</option><option value="restricted">Hạn chế</option><option value="rejected">Từ chối</option></select></label><label>Tags<input value={assetDraft.tags} onChange={(event) => setAssetDraft((current) => ({ ...current, tags: event.target.value }))} disabled={loading || selectedAsset.status === "archived"} placeholder="character, desert, camera-reference" /></label><label>Nguồn URI (tuỳ chọn)<input value={assetDraft.sourceUri} onChange={(event) => setAssetDraft((current) => ({ ...current, sourceUri: event.target.value }))} disabled={loading || selectedAsset.status === "archived"} placeholder="https://… hoặc để trống" /></label><label className="asset-field-wide">Ghi chú continuity<textarea value={assetDraft.note} onChange={(event) => setAssetDraft((current) => ({ ...current, note: event.target.value }))} disabled={loading || selectedAsset.status === "archived"} placeholder="Màu, chất liệu, identity, điều phải giữ…" /></label></div>
          <div className="asset-actions"><button type="button" className="primary-button" onClick={() => void saveAsset()} disabled={loading || selectedAsset.status === "archived"}>Lưu metadata/quyền</button>{selectedAsset.status === "archived" ? <button type="button" className="secondary-button" onClick={() => void onAssetState(selectedAsset, "restore")} disabled={loading}>Khôi phục asset</button> : <button type="button" className="danger-button" onClick={() => void onAssetState(selectedAsset, "archive")} disabled={loading}>Lưu trữ asset</button>}</div>
        </> : <div className="asset-empty-state large"><strong>Inspector đang trống</strong><span>Chọn một asset hoặc nhập file mới để xem hash, quyền và metadata.</span></div>}
      </div>
    </div>
    <div className="reference-set-workspace">
      <div className="reference-set-column"><div className="asset-column-toolbar"><strong>Reference sets</strong><button type="button" className="small-button" onClick={() => { setSelectedSetId(""); setSetEditorMode("new"); setSetDraft({ name: "", scope: "sequence", continuityNote: "" }); }} disabled={loading}>+ Set mới</button></div>{referenceSets.length === 0 ? <div className="asset-empty-state"><strong>Chưa có reference set</strong><span>Tạo set theo sequence, character, object, world hoặc shot.</span></div> : <div className="reference-set-items">{referenceSets.map((referenceSet) => <button type="button" key={referenceSet.referenceSetId} className={`reference-set-item ${referenceSet.referenceSetId === selectedSetId ? "selected" : ""} ${referenceSet.status === "archived" ? "archived" : ""}`} onClick={() => setSelectedSetId(referenceSet.referenceSetId)} disabled={loading}><span><b>{referenceSet.name}</b><small>{referenceSet.scope} · {referenceSet.assignments.length} assignments · {referenceSet.status}</small></span><em>›</em></button>)}</div>}</div>
      <div className="reference-set-editor"><div className="asset-inspector-title"><div><p className="eyebrow">REFERENCE SET EDITOR</p><h3>{setEditorMode === "edit" && selectedSet ? selectedSet.name : "Tạo reference set"}</h3></div>{selectedSet ? <span className={`asset-state-badge ${selectedSet.status}`}>{selectedSet.status}</span> : null}</div><div className="asset-editor-fields"><label>Tên set<input value={setDraft.name} onChange={(event) => setSetDraft((current) => ({ ...current, name: event.target.value }))} disabled={loading || selectedSet?.status === "archived"} placeholder="Ví dụ: Main character continuity" /></label><label>Phạm vi<select value={setDraft.scope} onChange={(event) => setSetDraft((current) => ({ ...current, scope: event.target.value as ReferenceSet["scope"] }))} disabled={loading || selectedSet?.status === "archived"}><option value="sequence">Sequence</option><option value="character">Character</option><option value="object">Object</option><option value="world">World</option><option value="shot">Shot</option></select></label><label className="asset-field-wide">Continuity note<textarea value={setDraft.continuityNote} onChange={(event) => setSetDraft((current) => ({ ...current, continuityNote: event.target.value }))} disabled={loading || selectedSet?.status === "archived"} placeholder="Điều phải giữ xuyên suốt các shot…" /></label></div><div className="asset-actions"><button type="button" className="primary-button" onClick={() => void saveSet()} disabled={loading || !setDraft.name.trim() || selectedSet?.status === "archived"}>{setEditorMode === "edit" ? "Lưu set" : "Tạo set"}</button>{selectedSet ? selectedSet.status === "archived" ? <button type="button" className="secondary-button" onClick={() => void onSetState(selectedSet, "restore")} disabled={loading}>Khôi phục set</button> : <button type="button" className="danger-button" onClick={() => void onSetState(selectedSet, "archive")} disabled={loading}>Lưu trữ set</button> : null}</div></div>
      <div className="reference-assignment-editor"><div className="asset-inspector-title"><div><p className="eyebrow">ASSIGNMENT / SHOT CONTINUITY</p><h3>Gán asset vào set</h3></div><span className="asset-state-badge info">HASHED</span></div>{selectedSet ? <><div className="asset-editor-fields"><label>Asset<select value={assignment.assetId} onChange={(event) => setAssignment((current) => ({ ...current, assetId: event.target.value }))} disabled={loading || selectedSet.status === "archived"}><option value="">Chọn asset…</option>{activeAssets.map((asset) => <option value={asset.assetId} key={asset.assetId}>{asset.title} · {asset.kind}</option>)}</select></label><label>Vai trò<select value={assignment.role} onChange={(event) => setAssignment((current) => ({ ...current, role: event.target.value as ReferenceAssignment["role"] }))} disabled={loading || selectedSet.status === "archived"}><option value="identity">Identity</option><option value="composition">Composition / layout</option><option value="pose">Pose / action</option><option value="camera">Camera / lens</option><option value="style">Style / material</option><option value="start_frame">Start frame</option><option value="end_frame">End frame</option><option value="negative">Negative / avoid</option></select></label><label>Strength<input type="number" min="0" max="1" step="0.05" value={assignment.strength} onChange={(event) => setAssignment((current) => ({ ...current, strength: Number(event.target.value) }))} disabled={loading || selectedSet.status === "archived"} /></label><label>Priority<input type="number" min="0" step="1" value={assignment.priority} onChange={(event) => setAssignment((current) => ({ ...current, priority: Number(event.target.value) }))} disabled={loading || selectedSet.status === "archived"} /></label><label>Shot ID (tuỳ chọn)<input value={assignment.shotId} onChange={(event) => setAssignment((current) => ({ ...current, shotId: event.target.value }))} disabled={loading || selectedSet.status === "archived"} placeholder="shot-01" /></label><label className="asset-field-wide">Ghi chú assignment<textarea value={assignment.notes} onChange={(event) => setAssignment((current) => ({ ...current, notes: event.target.value }))} disabled={loading || selectedSet.status === "archived"} placeholder="Cách dùng reference này trong shot…" /></label></div><label className="assignment-approval"><input type="checkbox" checked={assignment.approved} onChange={(event) => setAssignment((current) => ({ ...current, approved: event.target.checked }))} disabled={loading || selectedSet.status === "archived"} /> Đã duyệt để workflow dùng</label><button type="button" className="primary-button" onClick={() => void assignCurrentReference()} disabled={loading || selectedSet.status === "archived" || !assignment.assetId}>Gán reference</button><div className="assignment-list">{selectedSet.assignments.length === 0 ? <span className="muted-copy">Set chưa có assignment.</span> : selectedSet.assignments.map((item) => { const asset = assets.find((candidate) => candidate.assetId === item.assetId); return <div className="assignment-row" key={item.assignmentId}><span><b>{asset?.title ?? item.assetId}</b><small>{item.role} · strength {item.strength} · {item.approved ? "đã duyệt" : "chờ duyệt"}</small></span><button type="button" className="small-button" onClick={() => void onDetach(item.assignmentId)} disabled={loading}>Tháo</button></div>; })}</div></> : <div className="asset-empty-state large"><strong>Chưa chọn reference set</strong><span>Chọn hoặc tạo set để gán asset.</span></div>}</div>
    </div>
  </section>;
}

function PromptStudioPanel({
  projectId,
  projectName,
  presets,
  topic,
  contentGoal,
  selectedProfileName,
  selectedAudience,
  loading,
  onActivity,
  onNotice,
  onCreate,
  onUpdate,
  onArchive,
  onRestore,
  onApply,
}: {
  projectId: string;
  projectName?: string;
  presets: PromptPreset[];
  topic: string;
  contentGoal: string;
  selectedProfileName: string;
  selectedAudience: string;
  loading: boolean;
  onActivity: (event: Omit<WorkspaceActivityEvent, "eventId" | "timestamp">) => void;
  onNotice: (message: string) => void;
  onCreate: (draft: PromptPresetDraft) => Promise<PromptPreset | null>;
  onUpdate: (presetId: string, draft: PromptPresetDraft) => Promise<PromptPreset | null>;
  onArchive: (preset: PromptPreset) => void;
  onRestore: (preset: PromptPreset) => void;
  onApply: (draft: PromptPresetDraft, presetName: string) => void;
}) {
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [draft, setDraft] = useState<PromptPresetDraft>({
    name: "Preset cinematic mới",
    description: "Prompt riêng cho shot 3D và video cinematic.",
    scope: "project",
    status: "active",
    version: "v1.0.0",
    template: "Chủ đề: {{topic}}\nProfile: {{topic_profile}}\nĐối tượng: {{audience}}\nMục tiêu: {{content_goal}}\n\nThiết kế shot cinematic 3D có subject rõ, action theo thời gian, camera/lens, ánh sáng, chất liệu, continuity và output dùng được cho Blender/Omni.",
    variableKeys: ["topic", "topic_profile", "audience", "content_goal"],
    negativeTemplate: "no random objects, no text artifacts, no logo, no flicker, no broken geometry",
    providerTargets: ["blender-local", "google-flow-omni"],
    styleBibleId: null,
    rightsLicenseNote: "Dùng asset local hoặc asset có quyền; cần review trước generation/delivery.",
    parentPresetId: null,
  });
  const [editorMessage, setEditorMessage] = useState("Chọn preset để sửa hoặc bấm Preset mới để bắt đầu.");

  function draftFromPreset(preset: PromptPreset): PromptPresetDraft {
    return {
      name: preset.name,
      description: preset.description,
      scope: preset.scope,
      status: preset.status === "archived" ? "active" : preset.status,
      version: preset.version,
      template: preset.template,
      variableKeys: [...preset.variableKeys],
      negativeTemplate: preset.negativeTemplate,
      providerTargets: [...preset.providerTargets],
      styleBibleId: preset.styleBibleId,
      rightsLicenseNote: preset.rightsLicenseNote,
      parentPresetId: preset.presetId,
    };
  }

  useEffect(() => {
    if (!selectedPresetId && presets[0]) {
      setSelectedPresetId(presets[0].presetId);
      setDraft(draftFromPreset(presets[0]));
      setEditorMessage(`Đang chỉnh ${presets[0].name} · ${presets[0].version}.`);
    }
  }, [presets, selectedPresetId]);

  function selectPreset(preset: PromptPreset) {
    setSelectedPresetId(preset.presetId);
    setDraft(draftFromPreset(preset));
    setEditorMessage(preset.status === "archived" ? "Preset đang lưu trữ; khôi phục trước khi lưu phiên bản mới." : `Đang chỉnh ${preset.name} · ${preset.version}.`);
  }

  function startNewPreset() {
    setSelectedPresetId("");
    setDraft((current) => ({ ...current, name: "Preset cinematic mới", description: "", version: "v1.0.0", status: "active", parentPresetId: null }));
    setEditorMessage("Preset mới chưa lưu. Điền prompt rồi bấm Lưu preset.");
    onNotice("Đã mở form preset mới; chưa ghi dữ liệu.");
    onActivity({ stage: "prompt_preset.compose", tool: "Prompt Studio", state: "info", message: "Đã mở form prompt preset mới; chưa lưu và chưa gọi provider.", nextAction: "Điền prompt rồi bấm Lưu preset." });
  }

  function duplicateSelectedPreset() {
    if (!selectedPreset || selectedPreset.status === "archived") return;
    const copied = draftFromPreset(selectedPreset);
    setSelectedPresetId("");
    setDraft({ ...copied, name: `${selectedPreset.name} (bản sao)`, version: "v1.0.0", parentPresetId: selectedPreset.presetId });
    setEditorMessage(`Đã tạo bản nháp sao chép từ ${selectedPreset.name}; chưa lưu.`);
    onNotice("Đã tạo bản nháp sao chép; bấm Lưu preset để ghi vào project.");
    onActivity({ stage: "prompt_preset.duplicate", tool: "Prompt Studio", state: "info", message: `Đã sao chép prompt preset “${selectedPreset.name}”; chưa ghi dữ liệu.`, nextAction: "Kiểm tra tên/prompt rồi bấm Lưu preset." });
  }

  function updateDraft<K extends keyof PromptPresetDraft>(key: K, value: PromptPresetDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function saveDraft() {
    if (!projectId) {
      const message = "Chưa có project; không thể lưu preset.";
      setEditorMessage(message);
      onNotice(message);
      onActivity({ stage: "prompt_preset.validate", tool: "Prompt Studio", state: "blocked", message, nextAction: "Tạo hoặc chọn project local." });
      return;
    }
    if (!draft.name.trim() || !draft.template.trim()) {
      const message = "Tên preset và prompt không được để trống.";
      setEditorMessage(message);
      onNotice(message);
      onActivity({ stage: "prompt_preset.validate", tool: "Prompt Studio", state: "blocked", message, nextAction: "Bổ sung tên và prompt trước khi lưu." });
      return;
    }
    const saved = selectedPresetId ? await onUpdate(selectedPresetId, draft) : await onCreate(draft);
    if (saved) {
      setSelectedPresetId(saved.presetId);
      setDraft(draftFromPreset(saved));
      setEditorMessage(`Đã lưu ${saved.name} · ${saved.version}.`);
    }
  }

  const selectedPreset = presets.find((preset) => preset.presetId === selectedPresetId);
  const canEditSelected = Boolean(selectedPreset && selectedPreset.status !== "archived");

  return <section className="panel prompt-studio-panel" aria-label="Prompt Studio">
    <div className="prompt-studio-heading">
      <div>
        <p className="eyebrow accent">PROMPT STUDIO / PRESET CRUD</p>
        <h2>Prompt của bạn, lưu theo project</h2>
        <p>Viết prompt dài, lưu phiên bản và áp dụng thẳng vào brief. Nút nào cũng ghi rõ trạng thái vào workspace log.</p>
      </div>
      <div className="prompt-studio-project"><span>PROJECT</span><strong>{projectName ?? "Chưa chọn project"}</strong><small>{presets.length} bản prompt đã lưu</small></div>
    </div>
    <div className="prompt-studio-grid">
      <aside className="prompt-preset-list" aria-label="Danh sách prompt preset">
        <div className="prompt-list-heading"><strong>Preset đã lưu</strong><button type="button" className="small-button" onClick={startNewPreset} disabled={loading}>+ Preset mới</button></div>
        {presets.length === 0 ? <div className="prompt-empty-state"><strong>Chưa có preset</strong><span>Preset đầu tiên sẽ được lưu vào SQLite của project này.</span></div> : <div className="prompt-preset-items">{presets.map((preset) => <button type="button" key={preset.presetId} className={`prompt-preset-item ${preset.presetId === selectedPresetId ? "selected" : ""} ${preset.status === "archived" ? "archived" : ""}`} onClick={() => selectPreset(preset)} disabled={loading}><span><b>{preset.name}</b><small>{preset.version} · {preset.status === "archived" ? "Lưu trữ" : "Đang dùng"}</small></span><em>›</em></button>)}</div>}
      </aside>
      <div className="prompt-preset-editor">
        <div className="prompt-editor-toolbar"><div><strong>{selectedPreset ? (canEditSelected ? "Chỉnh prompt / tạo phiên bản mới" : "Preset đang lưu trữ") : "Tạo prompt preset mới"}</strong><span>{editorMessage}</span></div><span className={`prompt-editor-state ${selectedPreset?.status ?? "draft"}`}>{selectedPreset?.version ?? "CHƯA LƯU"}</span></div>
        <div className="prompt-editor-fields">
          <label>Tên preset<input value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} disabled={loading || Boolean(selectedPreset && !canEditSelected)} placeholder="Ví dụ: Deep ocean cinematic" /></label>
          <label>Version<input value={draft.version} onChange={(event) => updateDraft("version", event.target.value)} disabled={loading || Boolean(selectedPreset && !canEditSelected)} placeholder="v1.0.0" /></label>
          <label className="prompt-field-wide">Mô tả ngắn<input value={draft.description} onChange={(event) => updateDraft("description", event.target.value)} disabled={loading || Boolean(selectedPreset && !canEditSelected)} placeholder="Preset này dùng cho loại shot nào?" /></label>
          <label>Scope<select value={draft.scope} onChange={(event) => updateDraft("scope", event.target.value as PromptPresetDraft["scope"])} disabled={loading || Boolean(selectedPreset && !canEditSelected)}><option value="project">Project</option><option value="user">User profile</option></select></label>
          <label>Trạng thái<select value={draft.status} onChange={(event) => updateDraft("status", event.target.value as PromptPresetDraft["status"])} disabled={loading || Boolean(selectedPreset && !canEditSelected)}><option value="active">Đang dùng</option><option value="draft">Bản nháp</option></select></label>
          <label className="prompt-field-wide">Biến được phép <input value={draft.variableKeys.join(", ")} onChange={(event) => updateDraft("variableKeys", event.target.value.split(",").map((value) => value.trim()).filter(Boolean))} disabled={loading || Boolean(selectedPreset && !canEditSelected)} placeholder="topic, topic_profile, audience, content_goal" /></label>
          <label className="prompt-field-wide">Prompt chính<textarea className="prompt-main-editor" value={draft.template} onChange={(event) => updateDraft("template", event.target.value)} disabled={loading || Boolean(selectedPreset && !canEditSelected)} placeholder="Viết prompt đầy đủ: subject, action, camera, lens, lighting, material, continuity, render/style…" /></label>
          <label>Negative constraints<textarea value={draft.negativeTemplate} onChange={(event) => updateDraft("negativeTemplate", event.target.value)} disabled={loading || Boolean(selectedPreset && !canEditSelected)} placeholder="no flicker, no text, no broken geometry…" /></label>
          <label>Provider targets<input value={draft.providerTargets.join(", ")} onChange={(event) => updateDraft("providerTargets", event.target.value.split(",").map((value) => value.trim()).filter(Boolean))} disabled={loading || Boolean(selectedPreset && !canEditSelected)} placeholder="blender-local, google-flow-omni" /></label>
          <label className="prompt-field-wide">Ghi chú quyền / license<input value={draft.rightsLicenseNote} onChange={(event) => updateDraft("rightsLicenseNote", event.target.value)} disabled={loading || Boolean(selectedPreset && !canEditSelected)} placeholder="Nguồn asset, phạm vi dùng, cần review gì…" /></label>
        </div>
        <div className="prompt-variable-preview"><span>Đang dùng brief:</span><b>{topic.trim() || "Chưa nhập chủ đề"}</b><small>{selectedProfileName || "Chưa chọn profile"} · {selectedAudience || "Chưa có audience"} · {contentGoal.trim() || "Chưa có mục tiêu"}</small></div>
        <div className="prompt-editor-actions">
          <button type="button" className="primary-button" onClick={() => void saveDraft()} disabled={loading || Boolean(selectedPreset && !canEditSelected)}>{loading ? "Đang lưu…" : selectedPreset ? "Lưu phiên bản mới" : "Lưu preset"}</button>
          <button type="button" className="secondary-button" onClick={() => onApply(draft, selectedPreset?.name ?? draft.name)} disabled={loading || !draft.template.trim()}>Áp dụng vào brief</button>
          {selectedPreset && selectedPreset.status !== "archived" ? <button type="button" className="secondary-button" onClick={duplicateSelectedPreset} disabled={loading}>Nhân bản</button> : null}
          {selectedPreset?.status === "archived" ? <button type="button" className="secondary-button" onClick={() => onRestore(selectedPreset)} disabled={loading}>Khôi phục preset</button> : selectedPreset ? <button type="button" className="danger-button" onClick={() => onArchive(selectedPreset)} disabled={loading}>Lưu trữ</button> : null}
        </div>
      </div>
    </div>
  </section>;
}

function OnePromptWorkflowPanel({
  projectId,
  projectName,
  onCreateProject,
  workspaceRoot,
  topic,
  loading,
  cloudGenerationEnabled,
  onEnsureCloudGeneration,
  localScriptReview,
  videoSessions,
  assets,
  browserFlowWorkflow,
  browserMcpFreshState,
  browserFlowBusy,
  voiceSettings,
  promptObjective,
  additionalPrompt,
  onTopicChange,
  onActivity,
  onNotice,
  onSaveSession,
  onDeleteSession,
  onStartBrowserFlowDiscovery,
  onLoadBrowserFlowWorkflow,
  onRunBrowserFlowStep,
  onGenerateScript,
  onChooseSource,
  onImport,
  onOpenAdvanced,
}: {
  projectId: string;
  projectName: string;
  onCreateProject: () => void;
  workspaceRoot: string;
  topic: string;
  loading: boolean;
  cloudGenerationEnabled: boolean;
  onEnsureCloudGeneration: () => Promise<boolean>;
  localScriptReview: LocalScriptReviewReport | null;
  videoSessions: VideoWorkflowSession[];
  assets: AssetView[];
  browserFlowWorkflow: BrowserFlowWorkflow | null;
  browserMcpFreshState: BrowserMcpFreshState;
  browserFlowBusy: boolean;
  voiceSettings: VoiceSettings;
  promptObjective: string;
  additionalPrompt: string;
  onTopicChange: (value: string) => void;
  onActivity: (event: Omit<WorkspaceActivityEvent, "eventId" | "timestamp">) => void;
  onNotice: (message: string) => void;
  onSaveSession: (input: VideoWorkflowSessionInput, announce?: boolean) => Promise<VideoWorkflowSession | null>;
  onDeleteSession: (sessionId: string) => void;
  onStartBrowserFlowDiscovery: (script: LocalScriptDocument | null, report: BlenderShotPreviewReport | null, sessionId?: string | null, autoGenerate?: boolean, autoRunId?: string | null) => Promise<boolean>;
  onLoadBrowserFlowWorkflow: (sessionId: string | null) => void;
  onRunBrowserFlowStep: (operation: string, element?: string | null, elementRef?: string | null) => void;
   onGenerateScript: (approved: boolean, referenceContext?: string) => Promise<LocalScriptDocument | null>;
  onChooseSource: () => Promise<string | null>;
  onImport: (input: { sourcePath: string; title: string; mediaKind: string; sourceUri: string | null; tags: string[]; note: string; rightsStatus: AssetView["rightsStatus"] }) => Promise<AssetView | null>;
  onOpenAdvanced: () => void;
}) {
  const [referenceAsset, setReferenceAsset] = useState<AssetView | null>(null);
  const [scriptDraft, setScriptDraft] = useState<LocalScriptDocument | null>(localScriptReview?.script ?? null);
  const [selectedShotIndex, setSelectedShotIndex] = useState(0);
  // The app shell owns the single live terminal. Keep workflow activity in
  // that data source instead of rendering a second copy inside this panel.
  const [blenderPreviewReport, setBlenderPreviewReport] = useState<BlenderShotPreviewReport | null>(null);
  const [previewCacheKey] = useState(() => Date.now());
  const [geminiAssets, setGeminiAssets] = useState<AssetView[]>([]);
  const [revisionPrompt, setRevisionPrompt] = useState("");
  const [comfyuiAssets, setComfyuiAssets] = useState<AssetView[]>([]);
  const [comfyuiGenerating, setComfyuiGenerating] = useState(false);
  const [flowImageReview, setFlowImageReview] = useState<FlowImageReviewRequest | null>(null);
  const flowImageReviewResolverRef = useRef<((approved: boolean) => void) | null>(null);
  const [studioPreview, setStudioPreview] = useState<StudioFlowMediaPreview | null>(null);
  const [, setBrowserDownloads] = useState<BrowserFlowDownloadEntry[]>([]);
  const [, setBrowserDownloadsMessage] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState("Phiên video mới");
  const [sessionSaving, setSessionSaving] = useState(false);
  const [autoPipelineBusy, setAutoPipelineBusy] = useState(false);
  const autoPipelineLockRef = useRef(false);
  const lastAssetGenerationBlockerRef = useRef<string | null>(null);
  const [flowSetupMenu, setFlowSetupMenu] = useState<string | null>(null);
  const [flowSetupNodes, setFlowSetupNodes] = useState<string[]>([]);
  const legacyBrowserFlowRecoveryRef = useRef<string | null>(null);
  const autoResumedProjectRef = useRef<string | null>(null);
  const promptDirtyRef = useRef(false);
  const saveSessionRef = useRef(onSaveSession);

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
    setSelectedShotIndex(0);
    setBlenderPreviewReport(null);
  }, [localScriptReview]);

  useEffect(() => {
    flowImageReviewResolverRef.current?.(false);
    flowImageReviewResolverRef.current = null;
    setFlowImageReview(null);
    setActiveSessionId(null);
    setSessionName("Phiên video mới");
    setScriptDraft(null);
    setReferenceAsset(null);
    setGeminiAssets([]);
    setComfyuiAssets([]);
    setStudioPreview(null);
    setBlenderPreviewReport(null);
    autoResumedProjectRef.current = null;
    promptDirtyRef.current = false;
  }, [projectId]);

  useEffect(() => {
    if (!projectId || promptDirtyRef.current || activeSessionId || scriptDraft || autoResumedProjectRef.current === projectId || videoSessions.length === 0) return;
    const latestSession = videoSessions[0];
    autoResumedProjectRef.current = projectId;
    openVideoSession(latestSession);
  }, [projectId, videoSessions, activeSessionId, scriptDraft]);

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
    setBrowserDownloads([]);
    setBrowserDownloadsMessage(null);
    setStudioPreview(null);
    setSelectedShotIndex(0);
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
    setBrowserDownloads([]);
    setBrowserDownloadsMessage(null);
    setStudioPreview(null);
    setSelectedShotIndex(0);
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

  function makeSessionInput(sessionId = activeSessionId): VideoWorkflowSessionInput | null {
    if (!projectId || !topic.trim()) return null;
    const paths = sessionAssetPaths();
    const script = scriptDraft ? { ...scriptDraft, referenceAssetPaths: paths.referenceAssetPaths, geminiAssetPaths: paths.geminiAssetPaths, comfyuiAssetPaths: paths.comfyuiAssetPaths } : null;
    const status = scriptDraft ? (blenderPreviewReport ? (paths.comfyuiAssetPaths.length ? "comfyui_ready" : paths.geminiAssetPaths.length ? "gemini_ready" : "preview_ready") : "storyboard_ready") : "draft";
    const lastStep = scriptDraft ? (blenderPreviewReport ? (paths.comfyuiAssetPaths.length ? "comfyui-image" : paths.geminiAssetPaths.length ? "gemini" : "blender") : "storyboard") : "topic";
    const typedName = sessionName.trim();
    const placeholderName = !typedName || /^Phiên video mới(?:\s·.*)?$/i.test(typedName);
    const fallbackName = (script?.title || topic.trim().replace(/\s+/g, " ")).slice(0, 160);
    return {
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
    };
  }

  async function saveCurrentSession(announce = true): Promise<VideoWorkflowSession | null> {
    if (sessionSaving) return null;
    const input = makeSessionInput();
    if (!input) {
      onNotice("Nhập chủ đề/prompt trước để tạo hoặc lưu phiên.");
      return null;
    }
    setSessionSaving(true);
    if (announce) {
      onNotice("Đang lưu phiên, manifest và thư mục session…");
      onActivity({ stage: "video_session.save", tool: "Session workspace", state: "running", message: "Đang ghi chủ đề, shot, asset và tiến độ vào phiên local.", nextAction: "Chờ app xác nhận đã lưu xong." });
    }
    try {
      const saved = await saveSessionRef.current(input, announce);
      if (saved) {
        setActiveSessionId(saved.sessionId);
        setSessionName(saved.name);
      }
      return saved;
    } finally {
      setSessionSaving(false);
    }
  }

  function openVideoSession(session: VideoWorkflowSession) {
    resolveFlowImageReview(false);
    promptDirtyRef.current = false;
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
    setStudioPreview(null);
    setSelectedShotIndex(0);
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
    setStudioPreview(null);
    setSelectedShotIndex(0);
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

    return await onStartBrowserFlowDiscovery(nextScript ? { ...nextScript, approvalStatus: "approved", ...paths } : null, nextPreview, sessionId, autoGenerate, autoRunId);
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
      const input = makeSessionInput();
      if (!input) return;
      void saveSessionRef.current(input, false).then((saved) => {
        if (saved && !activeSessionId) {
          setActiveSessionId(saved.sessionId);
          setSessionName(saved.name);
        }
      });
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

  async function verifyBrowserFlowConnection(): Promise<boolean> {
    if (!projectId) return false;
    const startedAt = performance.now();
    onActivity({ stage: "studio_flow.browser_preflight", tool: "BrowserMCP / Google Flow", state: "running", progress: 0, message: "Đang kiểm tra kết nối thật tới tab Google Flow trước khi gọi asset/provider.", nextAction: "Chưa gọi Nano Banana hoặc Generate khi chưa có session browser thật." });
    try {
      const runtime = await invoke<BrowserMcpRuntimeReport>("check_browsermcp_session", { projectId });
      const connected = runtime.browserSessionAttached && runtime.status !== "blocked" && !runtime.operationResult?.isError;
      if (!connected) {
        const message = `Google Flow chưa kết nối thật: ${runtime.message}. Dừng trước bước trả phí, không báo thành công.`;
        onNotice(message);
        onActivity({ stage: "studio_flow.browser_preflight", tool: "BrowserMCP / Google Flow", state: "blocked", progress: 0, durationMs: Math.round(performance.now() - startedAt), message, output: runtime.reportPath, nextAction: "Mở đúng tab Flow, bấm Connect trên BrowserMCP extension rồi bấm Tự làm toàn bộ lại." });
        return false;
      }
      onActivity({ stage: "studio_flow.browser_preflight", tool: "BrowserMCP / Google Flow", state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message: "Đã xác nhận tab Google Flow và BrowserMCP đang kết nối thật.", nextAction: "Có thể tiếp tục chuẩn bị asset và nạp prompt." });
      return true;
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "không rõ lỗi";
      const message = `Không xác nhận được Google Flow: ${detail.slice(0, 300)}. Dừng trước provider.`;
      onNotice(message);
      onActivity({ stage: "studio_flow.browser_preflight", tool: "BrowserMCP / Google Flow", state: "blocked", progress: 0, durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Mở tab Flow và Connect BrowserMCP trước khi chạy tự động." });
      return false;
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
          domComposerDetected = domComposer.status === "ready" && domComposer.composerFound && domComposer.promptEditorFound;
          // Flow renders the image-model picker inside Agent settings. In that
          // state the prompt editor is intentionally hidden, so requiring the
          // editor before opening the model gate deadlocks the workflow. A
          // visible composer + image mode + selected model is sufficient to
          // safely run the non-generating model/Save action; the worker then
          // re-reads the editor after Save.
          domModelGateDetected = domComposer.composerFound
            && domComposer.imageModeFound
            && Boolean(domComposer.selectedModel);
          domComposerDiagnostic = `status=${domComposer.status}, composer=${domComposer.composerFound}, editor=${domComposer.promptEditorFound}, imageMode=${domComposer.imageModeFound}, selectedModel=${Boolean(domComposer.selectedModel)}`;
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
            return { workflow: latestWorkflow, blocked: true, message: `Flow chưa xác nhận đã chọn Nano Banana Pro (modelSelected=${modelReport.modelSelected}, saved=${modelReport.saved}, picker=${modelReport.selectedModel || "trống"}): ${modelReport.message}` };
          }
          // The worker verifies the editor again after Save. This is the
          // transition out of Agent settings and must be used for the return
          // decision; the pre-Save snapshot may legitimately have no editor.
          domComposerDetected = domComposerDetected || Boolean(modelReport.promptEditorFound && modelReport.imageModeFound);
          onActivity({ stage: "google_flow.image_model", tool: "BrowserOS neo DOM / Google Flow", state: "success", message: "Đã tự mở Agent settings, chọn Nano Banana Pro và bấm Save bằng BrowserOS neo trước khi tạo ảnh.", output: modelReport.reportPath, nextAction: "Tiếp tục nhập prompt từng shot trong image composer Pro." });
        } catch (error) {
          const detail = String(error).replace(/^Error:\s*/i, "").slice(0, 320);
          return { workflow: latestWorkflow, blocked: true, message: `Không chọn được Nano Banana Pro trong Flow: ${detail}` };
        }
        if (composer.domPromptComposer || domComposerDetected) {
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
            "Đọc UI refs hiện tại và mở đúng composer tạo ảnh Nano Banana trong project Flow này. Chỉ click một control Flow an toàn; không dùng chat, credit, tài khoản hoặc tab khác.",
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

  async function generateGoogleFlowReferenceAssets(nextScript = scriptDraft, allowCloud = cloudGenerationEnabled, autoApproveImages = false): Promise<NanoBananaImageGenerationReport | null> {
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
    let latestWorkflow: BrowserFlowWorkflow | null = browserFlowWorkflow;

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

    type FlowRevisionResult = {
      asset: AssetView;
      evaluation: BrowserFlowVisualEvaluationReport | null;
      prompt: string;
      revisionId: string;
    };

    // A revision is deliberately a single, serial attempt. It reuses the
    // current Flow project and exact DOM/download guards, then hands the new
    // file back to the same visual evaluator. No second shot can start while
    // this function is waiting or reconciling its output.
    const retryFlowShotOnce = async (
      task: { shotId: string; revisionId: string; segment: LocalScriptSegment },
      previousPrompt: string,
      previousEvaluation: BrowserFlowVisualEvaluationReport,
      attempt: number,
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
      const projectUrl = latestWorkflow.currentUrl
        ?? latestWorkflow.providerProjectIdentity?.currentUrl
        ?? null;
      if (!projectUrl) throw new Error("Không có URL project Flow hiện tại để revision");
      const beforeRevision = await invoke<{ files: BrowserFlowDownloadEntry[] }>("list_browser_flow_downloads", { projectId });
      const beforeRevisionPaths = new Set(beforeRevision.files.map((file) => file.relativePath));
      const baselineDom = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
        projectId,
        request: { projectUrl, mode: "inspect_output", shotId: task.shotId, revisionId, runId },
      });
      const baselineMediaIds = new Set(baselineDom.mediaIds ?? []);
      const observed = await invoke<GoogleFlowPlaywrightReport>("run_google_flow_playwright_action", {
        projectId,
        request: { projectUrl, mode: "observe", runId },
      });
      if (observed.status !== "ready") throw new Error(`BrowserOS không đọc được Flow trước revision: ${observed.message}`);
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
      const maxRevisionWaitSeconds = 300;
      while (waitedSeconds < maxRevisionWaitSeconds) {
        const waitFor = Math.min(2, maxRevisionWaitSeconds - waitedSeconds);
        const waited = await step("wait", null, null, null, false, waitFor);
        store(waited.workflow);
        waitedSeconds += waitFor;
        const refreshed = await snapshot();
        const refreshedUrl = refreshed.workflow.currentUrl
          ?? refreshed.workflow.providerProjectIdentity?.currentUrl
          ?? projectUrl;
        const outputDom = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
          projectId,
          request: { projectUrl: refreshedUrl, mode: "inspect_output", shotId: task.shotId, revisionId, runId },
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
        if (freshMediaIds.length > 1) throw new Error(`${task.shotId}/${revisionId}: Flow trả nhiều media mới, không thể gán chính xác`);
        if (candidateMediaCount > 1) throw new Error(`${task.shotId}/${revisionId}: batch revision trả hơn một media dù cấu hình x1`);
        if (!clickedDownload && !outputDom.generationActive && (candidateMediaCount > 0 || freshMediaIds.length === 1)) {
          const download = await invoke<GoogleFlowPlaywrightReport>("run_google_flow_playwright_action", {
            projectId,
            request: { projectUrl: refreshedUrl, mode: "download_image", shotId: task.shotId, revisionId, runId, mediaId: freshMediaIds.length === 1 ? freshMediaIds[0] : undefined },
          });
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
          onActivity({ stage: "google_flow.image_revision_wait", tool: "Google Flow / Nano Banana Pro", state: "running", progress: undefined, message: `${task.shotId}/${revisionId}: đang chờ output revision (${waitedSeconds}/${maxRevisionWaitSeconds}s).`, nextAction: "Không bấm Generate lại; chờ DOM và file mới." });
          continue;
        }
        const inputHash = await sha256Text(stableBrowserFlowPrompt(revisedPrompt));
        const importedReport = await invoke<BrowserFlowDownloadImportReport>("import_browser_flow_download", { request: { projectId, workflowId: latestWorkflow.workflowId, relativePath: freshImages[0].relativePath, runId, shotId: task.shotId, revisionId, inputHash } });
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
              workflowId: latestWorkflow.workflowId,
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
      }
      throw new Error(`${task.shotId}/${revisionId}: quá thời gian chờ output revision; dừng shot này`);
    };

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
      const imageComposer = await ensureGoogleFlowImageComposer(latestWorkflow);
      latestWorkflow = imageComposer.workflow;
      if (imageComposer.blocked) {
        const message = `Google Flow chưa vào được image composer: ${imageComposer.message}`;
          onActivity({ stage: "google_flow.image_generation", tool: "Google Flow / Nano Banana Pro", state: "blocked", progress: 0, message, nextAction: "Giữ nguyên project vừa được mở; không gõ vào chat và chạy lại sau khi Flow trả composer ảnh." });
        return makeReport("blocked", [], message, "FLOW_IMAGE_COMPOSER_NOT_FOUND");
      }
      const domComposerWorkflow = Boolean(imageComposer.domPromptComposer);

      let localAssets = await invoke<AssetView[]>("list_assets", { projectId, includeArchived: false });
      const generatedAssets: AssetView[] = [];
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
            generatedAssets.push(existingAsset);
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

        let current = await snapshot();
        let composer = inspectBrowserFlowImageComposer(current.workflow.uiRefs);
        let domComposerReady = domComposerWorkflow;
        let currentProjectUrl = current.workflow.currentUrl
          ?? current.workflow.providerProjectIdentity?.currentUrl
          ?? null;
        if (!composer.verified && currentProjectUrl) {
          try {
            const domComposer = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
              projectId,
              request: { projectUrl: currentProjectUrl, mode: "inspect_composer" },
            });
            domComposerReady = domComposerReady || (domComposer.status === "ready" && domComposer.composerFound && domComposer.promptEditorFound);
          } catch {
            // Keep the verified BrowserMCP route as fallback when the DOM probe cannot run.
          }
        }
        if (!composer.verified && !domComposerReady && !composer.creditGate && current.workflow.uiRefs.length > 0) {
          try {
            const agent = await runBrowserFlowAgent(
              projectId,
              current.workflow,
              "Snapshot mới không chứng minh được image composer. Đọc các UI ref mới và tự học trạng thái hiện tại. Nếu có entry image, Nano Banana, ô prompt ảnh hoặc nút mở composer thì chỉ chọn đúng một control an toàn; không dùng chat, tài khoản, credit hoặc tab khác. Nếu chưa đủ bằng chứng, trả stop.",
            );
            store(agent.workflow);
            onActivity({ stage: "google_flow.image_agent", tool: `Gemini Vision Browser / ${agent.model}`, state: agent.status === "ready" ? "success" : "waiting_user", progress: index / tasks.length, message: `${task.shotId}: Gemini đã đọc snapshot mới và trả lời: ${agent.message}`, output: agent.plannerReportPath ?? undefined, nextAction: agent.status === "ready" && agent.action?.action !== "stop" ? "Đọc lại snapshot sau action của Gemini rồi thử composer ảnh." : "Gemini chưa thấy action an toàn; app sẽ thử đọc DOM thật trước khi dừng." });
            if (agent.status === "ready" && agent.action?.action !== "stop") {
              current = await snapshot();
              composer = inspectBrowserFlowImageComposer(current.workflow.uiRefs);
              currentProjectUrl = current.workflow.currentUrl
                ?? current.workflow.providerProjectIdentity?.currentUrl
                ?? currentProjectUrl;
              if (!composer.verified && currentProjectUrl) {
                try {
                  const domComposer = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
                    projectId,
                    request: { projectUrl: currentProjectUrl, mode: "inspect_composer" },
                  });
                  domComposerReady = domComposerReady || (domComposer.status === "ready" && domComposer.composerFound && domComposer.promptEditorFound);
                } catch {
                  // The final guard below remains fail-closed when DOM evidence is unavailable.
                }
              }
            }
          } catch (error) {
            const detail = String(error).replace(/^Error:\s*/i, "").slice(0, 240);
            onActivity({ stage: "google_flow.image_agent", tool: "Gemini Vision Browser", state: "info", progress: index / tasks.length, message: `${task.shotId}: Gemini planner không chạy được: ${detail}`, nextAction: "Tiếp tục bằng locator Playwright/DOM; nếu vẫn không thấy composer sẽ dừng fail-closed." });
          }
        }
        if (!composer.verified && !domComposerReady) {
          const message = composer.creditGate
            ? `${task.shotId}: Flow đang báo credit/quota/gói; app dừng và không giả đã tạo.`
            : `${task.shotId}: snapshot chưa xác nhận composer Nano Banana Pro + ô “Bạn muốn thay đổi gì?”; không gõ vào chat.`;
          onActivity({ stage: "google_flow.image_generation", tool: "Google Flow / Nano Banana Pro", state: "blocked", progress: index / tasks.length, message, nextAction: "Giữ nguyên tab character/image của Flow, Connect BrowserMCP rồi đọc snapshot lại." });
          return makeReport("blocked", generatedAssets, message, composer.creditGate ? "FLOW_CREDIT_GATE" : "FLOW_IMAGE_COMPOSER_NOT_FOUND");
        }
        const domPromptForShot = domComposerReady || composer.domPromptComposer;
        const promptRef = domPromptForShot
          ? undefined
          : findBrowserFlowPromptRef(current.workflow.uiRefs);
        if (!promptRef && !domPromptForShot) {
          const message = `${task.shotId}: BrowserMCP chưa trả ref thật cho ô prompt Nano Banana Pro.`;
          return makeReport("blocked", generatedAssets, message, "FLOW_IMAGE_PROMPT_REF_MISSING");
        }
        let baselineGeneratedMessages = 0;
        let baselineKnown = false;
        let baselineMediaIds = new Set<string>();
        const captureBaselineDom = async (projectUrl: string) => {
          const baselineDom = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
            projectId,
            request: { projectUrl, mode: "inspect_output" },
          });
          baselineGeneratedMessages = baselineDom.generatedMessageCount;
          baselineMediaIds = new Set((baselineDom.mediaIds ?? []).filter(Boolean));
          baselineKnown = true;
          return baselineDom;
        };
        const before = await invoke<{ files: BrowserFlowDownloadEntry[] }>("list_browser_flow_downloads", { projectId });
        const beforePaths = new Set(before.files.map((file) => file.relativePath));
        let clickedDownload = false;
        let downloadedName: string | null = null;
        let downloadAttempted = false;
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
                downloadAttempted = true;
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
        if (promptRef) {
          const typed = await step("type", promptRef.label, promptRef.reference, prompt, true);
          store(typed.workflow);
          if (typed.status !== "ready") {
            const message = `${task.shotId}: Flow chưa xác nhận prompt ảnh: ${typed.message}`;
            return makeReport("blocked", generatedAssets, message, "FLOW_IMAGE_PROMPT_NOT_ACCEPTED");
          }
          if (currentProjectUrl) {
            try {
              await captureBaselineDom(currentProjectUrl);
            } catch (error) {
              const detail = String(error).replace(/^Error:\s*/i, "").slice(0, 220);
              onActivity({ stage: "google_flow.output_inspect", tool: "BrowserOS neo DOM / Google Flow", state: "info", progress: index / tasks.length, message: "Chưa chụp được mốc media trước khi Generate: " + detail, nextAction: "Vẫn tiếp tục, nhưng chỉ nhận file mới nếu Downloads xác nhận đúng." });
            }
          }
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
                if (waitedSeconds >= 45 && outputDom.mediaCount > 0 && candidateMediaCount === 0 && freshMediaIds.length === 0 && !outputDom.generationActive) {
                  const message = `${task.shotId}: Flow có output cũ nhưng chưa có batch mang RUN_ID của lượt hiện tại; không tải nhầm card lịch sử.`;
                  onActivity({ stage: "google_flow.output_inspect", tool: "BrowserOS neo DOM / Google Flow", state: "blocked", progress: Math.min(0.98, (index + 0.5) / tasks.length), message, output: outputDom.reportPath, nextAction: "Giữ nguyên project, kiểm tra prompt/run identity trong Flow rồi chạy lại; app không chờ và không tải card cũ." });
                  return makeReport("blocked", generatedAssets, message, "FLOW_IMAGE_RUN_ID_OUTPUT_NOT_FOUND");
                }
                  if (!clickedDownload && !downloadAttempted && !outputDom.generationActive && (candidateMediaCount > 0 || freshMediaIds.length === 1)) {
                    if (domPromptForShot) {
                      downloadAttempted = true;
                      const playwrightDownload = await invoke<GoogleFlowPlaywrightReport>("run_google_flow_playwright_action", {
                        projectId,
                        request: {
                          projectUrl,
                          mode: "download_image",
                          shotId: task.shotId,
                          revisionId: task.revisionId,
                          runId,
                           mediaId: freshMediaIds.length === 1 ? freshMediaIds[0] : undefined,
                        },
                      });
                      if (playwrightDownload.status !== "ready" || !playwrightDownload.downloadStarted || !playwrightDownload.downloadName || (playwrightDownload.downloadSizeBytes ?? 0) <= 0) {
                        const message = `${task.shotId}: đã định vị đúng batch hiện tại nhưng Download không được xác nhận: ${playwrightDownload.message}`;
                        return makeReport("blocked", generatedAssets, message, "FLOW_IMAGE_DOWNLOAD_NOT_CONFIRMED");
                      }
                      clickedDownload = true;
                      downloadedName = playwrightDownload.downloadName;
                      onActivity({ stage: "google_flow.image_download", tool: "BrowserOS neo download / Google Flow", state: "success", progress: Math.min(0.98, (index + 0.75) / tasks.length), message: `${task.shotId}: BrowserOS đã tải đúng ảnh mới và lưu ${playwrightDownload.downloadName} (${playwrightDownload.downloadSizeBytes} bytes).`, output: playwrightDownload.reportPath, nextAction: "Hash/kiểm tra file mới rồi import vào Asset Library." });
                    } else {
                      const domDownload = await invoke<GoogleFlowDomOutputReport>("inspect_google_flow_dom_output", {
                        projectId,
                        request: { projectUrl, shotId: task.shotId, revisionId: task.revisionId, runId },
                      });
                      if (domDownload.downloadClicked) {
                        clickedDownload = true;
                        onActivity({ stage: "google_flow.image_download", tool: "BrowserOS neo download / Google Flow", state: "success", progress: Math.min(0.98, (index + 0.75) / tasks.length), message: `${task.shotId}: BrowserOS đã bấm Download đúng shot/revision trong DOM Flow.`, output: domDownload.reportPath, nextAction: "Chờ file ảnh mới xuất hiện trong Downloads rồi import vào Asset Library." });
                      }
                    }
                  }
              } catch (error) {
                const detail = String(error).replace(/^Error:\s*/i, "").slice(0, 220);
                if (downloadAttempted) {
                  const message = `${task.shotId}: Download của batch hiện tại bị lỗi sau một lần thử: ${detail}`;
                  return makeReport("blocked", generatedAssets, message, "FLOW_IMAGE_DOWNLOAD_ACTION_FAILED");
                }
                onActivity({ stage: "google_flow.output_inspect", tool: "BrowserOS neo DOM / Google Flow", state: "info", progress: Math.min(0.98, (index + 0.5) / tasks.length), message: `Chưa quét được DOM output: ${detail}`, nextAction: "Tiếp tục chờ Download; nếu vẫn không có output sẽ dừng theo timeout." });
              }
            }
          }
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
                  const message = `${task.shotId}: revision tự động thất bại sau một lần thử: ${detail}`;
                  onActivity({ stage: "google_flow.image_revision", tool: "Gemini revision / Google Flow", state: "blocked", progress: index / tasks.length, message, nextAction: "Dừng tại shot này; kiểm tra output/revision trong Flow rồi chạy lại có chủ đích." });
                  return makeReport("blocked", generatedAssets, message, "FLOW_IMAGE_REVISION_FAILED");
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
          const message = `${task.shotId}: quá ${maxWaitSeconds}s nhưng chưa có ảnh mới được tải về; đã dừng tại shot này, không chạy sang shot kế và không báo thành công.`;
          return makeReport("blocked", generatedAssets, message, "FLOW_IMAGE_DOWNLOAD_TIMEOUT");
        }
      }
      const message = `Google Flow / Nano Banana Pro đã tạo và nhập ${generatedAssets.length}/${tasks.length} ảnh theo từng shot trong cùng project; cần review chất lượng/rights trước khi dựng video.`;
      onLoadBrowserFlowWorkflow(activeSessionId);
      onNotice(message);
      onActivity({ stage: "google_flow.image_generation", tool: "Google Flow / Nano Banana Pro", state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Review ảnh trong Asset Library rồi mới gửi prompt ảnh-to-video/video cho Flow." });
      return makeReport("succeeded_needs_review", generatedAssets, message);
    } catch (error) {
      const message = `Google Flow / Nano Banana Pro bị dừng: ${String(error).replace(/^Error:\s*/i, "").slice(0, 420)}`;
      onNotice(message);
      onActivity({ stage: "google_flow.image_generation", tool: "Google Flow / Nano Banana Pro", state: "blocked", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Không bấm lặp; giữ nguyên project Flow, xem process log và chạy lại để resume theo input hash." });
      return makeReport("blocked", [], message, "FLOW_IMAGE_RUNTIME_ERROR");
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
    onActivity({ stage: "nano_banana.chrome_cdp", tool: "Chrome / Google Flow", state: "running", progress: 0, message: "Đang tự kiểm tra Chrome CDP 9222; nếu chưa có, app sẽ mở Chrome Flow bằng profile riêng.", nextAction: "Chờ Chrome CDP sẵn sàng; không mở worker trước khi cổng trả lời." });
    let chromeCdp: ChromeCdpLaunchReport;
    try {
      chromeCdp = await invoke<ChromeCdpLaunchReport>("ensure_chrome_cdp_session");
    } catch (error) {
      const message = String(error).replace(/^Error:\s*/i, "").slice(0, 420);
      onNotice(message);
      onActivity({ stage: "nano_banana.chrome_cdp", tool: "Chrome / Google Flow", state: "blocked", progress: 0, message, nextAction: "Đảm bảo Chrome đã mở được profile Flow và CDP 9222; app chưa gọi Nano Banana và chưa tiêu credit." });
      return null;
    }
    if (chromeCdp.needsLogin) {
      const message = `${chromeCdp.message} Đăng nhập xong rồi bấm Tự làm toàn bộ lại; chưa gọi Nano Banana và chưa tiêu credit.`;
      onNotice(message);
      onActivity({ stage: "nano_banana.chrome_cdp", tool: "Chrome / Google Flow", state: "waiting_user", progress: 1, message, nextAction: "Đăng nhập Google Flow trong cửa sổ Chrome vừa mở, giữ nguyên profile rồi chạy lại." });
      return null;
    }
    onActivity({ stage: "nano_banana.chrome_cdp", tool: "Chrome / Google Flow", state: "success", progress: 1, message: chromeCdp.message, nextAction: "Chrome CDP đã sẵn sàng; chuyển sang kiểm tra và chạy Nano Banana." });
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

  async function scanBrowserDownloads(): Promise<BrowserFlowDownloadEntry[]> {
    if (!projectId) {
      const message = "Cần có Browser Flow workflow trước khi quét Downloads.";
      onNotice(message);
      return [];
    }
    const startedAt = performance.now();
    onActivity({ stage: "browser_flow.download_scan", tool: "Local Downloads bridge", state: "running", message: "Đang quét Downloads để tìm video/hình ảnh Flow đã tải; chưa copy file.", progress: 0 });
    try {
      const report = await invoke<{ status: string; files: BrowserFlowDownloadEntry[]; message: string }>("list_browser_flow_downloads", { projectId });
      setBrowserDownloads(report.files);
      setBrowserDownloadsMessage(report.message);
      onNotice(report.message);
      onActivity({ stage: "browser_flow.download_scan", tool: "Local Downloads bridge", state: report.files.length ? "success" : "info", progress: 1, durationMs: Math.round(performance.now() - startedAt), message: report.message, nextAction: report.files.length ? "Chọn đúng file Flow vừa tải rồi nhập vào workflow." : "Bấm Download trên Google Flow rồi quét lại." });
      return report.files;
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "không rõ lỗi";
      const message = `Không quét được Downloads: ${detail.slice(0, 320)}`;
      setBrowserDownloadsMessage(message);
      onNotice(message);
      onActivity({ stage: "browser_flow.download_scan", tool: "Local Downloads bridge", state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra thư mục Downloads và quyền đọc file rồi thử lại." });
      return [];
    }
  }

  function updateSegment(index: number, patch: Partial<LocalScriptSegment>) {
    setScriptDraft((current) => current ? { ...current, segments: current.segments.map((segment, segmentIndex) => segmentIndex === index ? { ...segment, ...patch } : segment) } : current);
  }

  async function reviseSelectedShot() {
    if (!scriptDraft || !selectedShot || !revisionPrompt.trim()) {
      onNotice("Chọn một shot và nhập mô tả sửa trước khi chạy lại.");
      return;
    }
    const revisionId = `rev-${Date.now().toString(36)}`;
    const revisedSegment: LocalScriptSegment = {
      ...selectedShot,
      revisionId,
      revisionPrompt: revisionPrompt.trim(),
      dirty: true,
      visualPrompt: `${selectedShot.visualPrompt ?? ""}\nREVISION INTENT: ${revisionPrompt.trim()}`.trim(),
      action: `${selectedShot.action ?? selectedShot.narration}. Revision intent: ${revisionPrompt.trim()}`,
    };
    const nextScript: LocalScriptDocument = { ...scriptDraft, approvalStatus: "approved", segments: scriptDraft.segments.map((segment, index) => index === selectedShotIndex ? revisedSegment : segment) };
    setScriptDraft(nextScript);
    setRevisionPrompt("");
    onNotice(`Đã đánh dấu SHOT-${String(selectedShotIndex + 1).padStart(3, "0")} là ${revisionId}; output cũ giữ nguyên, chỉ chạy lại shot có hash mới.`);
    onActivity({ stage: "studio_flow.shot_revision", tool: "Studio Flow Agent", state: "running", message: `Revision ${revisionId} chỉ áp dụng cho SHOT-${String(selectedShotIndex + 1).padStart(3, "0")}; các shot đã import cùng hash sẽ được bỏ qua.`, nextAction: "Đang chạy lại shot đã chọn qua Flow rồi import output mới." });
    await startBrowserFlowFromWorkspace(nextScript, null, true, `revision-${Date.now().toString(36)}`);
  }

  async function attachRevisionReference() {
    if (!scriptDraft || !selectedShot) return;
    const sourcePath = await onChooseSource();
    if (!sourcePath) return;
    const imported = await onImport({ sourcePath, title: `Revision reference · SHOT-${String(selectedShotIndex + 1).padStart(3, "0")}`, mediaKind: "image", sourceUri: null, tags: ["shot-revision", `shot-${selectedShotIndex + 1}`], note: "Ảnh tham chiếu riêng cho revision của một shot; không phải model 3D.", rightsStatus: "pending" });
    if (!imported) return;
    setReferenceAsset(imported);
    updateSegment(selectedShotIndex, { revisionImagePath: imported.relativePath, dirty: true });
    onNotice(`Đã gắn ảnh revision ${imported.title} cho SHOT-${String(selectedShotIndex + 1).padStart(3, "0")}; ảnh chỉ khóa identity/composition, không biến thành mesh Blender.`);
  }

  async function previewWorkflow() {
    if (!scriptDraft) {
      onNotice("Chưa có workflow để preview. Nhập prompt rồi bấm Phân tích & dựng workflow.");
      return;
    }
    const referenceContext = sessionAssetPaths().referenceAssetPaths.length
      ? `Ảnh tham chiếu local: ${sessionAssetPaths().referenceAssetPaths.join(", ")}`
      : "";
    const promptContract = await currentPromptContract(referenceContext);
    if (!scriptMatchesPrompt(scriptDraft, promptContract.sourcePromptHash, promptContract.requirements)) {
      invalidateStaleWorkflow("Không tạo shot plan: script hiện tại không thuộc prompt hiện tại hoặc lệch shot count/thời lượng yêu cầu.");
      return;
    }
    const paths = sessionAssetPaths();
    onNotice("Shot plan đã sẵn sàng; đang chuyển thẳng sang provider, không dựng preview cục bộ.");
    void startBrowserFlowFromWorkspace({ ...scriptDraft, approvalStatus: "approved", voiceSettings, visualMode: "cinematic-3d", ...paths }, null);
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

  const selectedShot = scriptDraft?.segments[selectedShotIndex] ?? null;
  const activeSession = activeSessionId ? videoSessions.find((session) => session.sessionId === activeSessionId) : null;
  const activeSessionDirectory = activeSession?.sessionDirectory || (activeSessionId ? `outputs/sessions/${activeSessionId}` : null);
  const browserFlowFailed = browserFlowWorkflow?.phase === "failed" || browserFlowWorkflow?.phase === "cancelled";
  const flowAssetPaths = sessionAssetPaths();
  const flowPromptReady = topic.trim().length >= 3;
  const flowOutputReady = Boolean(browserFlowWorkflow?.downloadedFiles?.length);
  const browserFlowLiveVerified = browserMcpFreshState.status === "attached";
  const firstReferencePreview = comfyuiAssets[0] ?? geminiAssets[0] ?? referenceAsset;
  const latestOutputFile = [...(browserFlowWorkflow?.downloadedFiles ?? [])].reverse().find((file) => file.mediaKind === "video" || file.mediaKind === "image");
  const referencePreview: StudioFlowMediaPreview | undefined = firstReferencePreview
    ? { kind: firstReferencePreview.kind === "video" ? "video" : "image", url: workspaceMediaUrl(firstReferencePreview.relativePath), title: firstReferencePreview.title, detail: `${firstReferencePreview.kind} · ${firstReferencePreview.rightsStatus}` }
    : undefined;
  const providerPreview: StudioFlowMediaPreview | undefined = latestOutputFile
    ? { kind: latestOutputFile.mediaKind === "video" ? "video" : "image", url: workspaceMediaUrl(latestOutputFile.relativePath), title: latestOutputFile.name, detail: `${latestOutputFile.mediaKind} · output Flow đã nhập` }
    : undefined;
  const flowNodes: Record<string, StudioFlowNode> = {
    prompt: { id: "prompt", eyebrow: "INPUT / PROMPT", title: "Một prompt duy nhất", detail: flowPromptReady ? `${topic.trim().length}/4000 ký tự · session đã nhớ local` : "Nhập chủ đề video; Agent sẽ tự tách shot và provider.", state: flowPromptReady ? "done" : "waiting", actionLabel: flowPromptReady ? "Agent dựng graph" : undefined },
    reference: { id: "reference", eyebrow: "INPUT / REFERENCE", title: "Ảnh & asset tham chiếu", detail: flowAssetPaths.referenceAssetPaths.length || flowAssetPaths.geminiAssetPaths.length || flowAssetPaths.comfyuiAssetPaths.length ? `${flowAssetPaths.referenceAssetPaths.length + flowAssetPaths.geminiAssetPaths.length + flowAssetPaths.comfyuiAssetPaths.length} file đã gắn vào session` : "Tùy chọn · có thể gắn ảnh sau khi nhập prompt.", state: flowAssetPaths.referenceAssetPaths.length || flowAssetPaths.geminiAssetPaths.length || flowAssetPaths.comfyuiAssetPaths.length ? "done" : "ready", actionLabel: "＋ Gắn ảnh", preview: referencePreview },
    agent: { id: "agent", eyebrow: "AGENT / PLANNER", title: "Agent dựng workflow", detail: scriptDraft ? `${scriptDraft.segments.length} shot · ${scriptDraft.totalDurationSeconds.toFixed(1)} giây · đã tạo shot plan` : flowPromptReady ? "Sẵn sàng phân tích subject, action, camera, continuity." : "Đợi prompt để bắt đầu.", state: scriptDraft ? "done" : flowPromptReady ? "ready" : "waiting", actionLabel: scriptDraft ? undefined : "Phân tích prompt" },
    shots: { id: "shots", eyebrow: "SHOT GRAPH", title: "Shot & beat plan", detail: scriptDraft ? `${scriptDraft.segments.length} shot · ${(scriptDraft.segments[0]?.beats ?? []).length || 4} beat/shot · chỉnh được ở dưới` : "Agent sẽ tạo các shot khác nhau, không lặp một khung hình.", state: scriptDraft ? "done" : "waiting" },
    storyboard: { id: "storyboard", eyebrow: "LOCAL / SHOT PLAN", title: "Shot plan · dựng từ prompt", detail: scriptDraft ? `${scriptDraft.segments.length} shot · prompt riêng từng cảnh · chuyển thẳng sang provider` : "Cần prompt trước.", state: scriptDraft ? "done" : "waiting", actionLabel: undefined, preview: undefined },
    provider: { id: "provider", eyebrow: "PROVIDER / OMNI", title: "Omni · Seedance · Flow", detail: browserFlowFailed ? "Workflow web lỗi; cần quét lại, chưa giả đã tạo video." : !browserFlowLiveVerified && browserFlowWorkflow ? "Workflow cũ đã lưu nhưng chưa có snapshot BrowserMCP mới; chưa coi Flow đang kết nối." : flowOutputReady ? `${browserFlowWorkflow?.downloadedFiles?.length ?? 0} output đã nhập; cần review.` : browserFlowWorkflow ? `${browserFlowWorkflow.phase} · ${browserFlowWorkflow.uiRefCount} UI ref · auto mode chỉ chạy sau fresh snapshot` : scriptDraft ? "Shot plan đã sẵn sàng để gửi thẳng sang provider." : "Provider chỉ chạy sau khi có shot plan.", state: browserFlowFailed ? "blocked" : browserFlowWorkflow && browserFlowLiveVerified ? "ready" : scriptDraft ? "ready" : "waiting", actionLabel: browserFlowWorkflow && browserFlowLiveVerified ? "Đọc trạng thái" : scriptDraft ? "Kiểm tra provider" : undefined, preview: providerPreview },
    output: { id: "output", eyebrow: "OUTPUT / REVIEW", title: "Preview & output", detail: flowOutputReady ? `${browserFlowWorkflow?.downloadedFiles?.length ?? 0} file đã nhập vào session` : "Kết quả sẽ hiện ở đây sau khi provider trả output; chưa có file thì không báo thành công.", state: flowOutputReady ? "done" : "waiting", actionLabel: browserFlowWorkflow ? "Quét Downloads" : undefined, preview: providerPreview },
  };

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
    setFlowSetupNodes(studioFlowNodeCatalog.map((item) => item.id));
    const runId = `auto-${Date.now().toString(36)}`;
    onNotice("Đã nhận một prompt. Agent đang tự chạy toàn bộ các bước an toàn…");
      onActivity({ stage: "studio_flow.auto_run", tool: "Studio Flow Agent", state: "running", progress: 0, message: `Run ${runId}: prompt → shot plan → Google Flow; không dùng Blender.`, nextAction: "Đang phân tích chủ đề và tạo shot plan." });

    let currentStage = "khởi động agent";
    const heartbeatTimer = window.setInterval(() => {
      onActivity({ stage: "studio_flow.heartbeat", tool: "Studio Flow Agent", state: "running", progress: undefined, message: `Agent vẫn đang chạy ở bước: ${currentStage}.`, nextAction: "Nếu bước này đứng quá lâu, terminal sẽ báo blocker hoặc timeout." });
    }, 3000);
    const stopHeartbeat = () => window.clearInterval(heartbeatTimer);
    try {
      const referenceContext = sessionAssetPaths().referenceAssetPaths.length
        ? `Ảnh tham chiếu local: ${sessionAssetPaths().referenceAssetPaths.join(", ")}`
        : "";
      const promptContract = await currentPromptContract(referenceContext);
      let workingScript = scriptDraft;
      const staleScript = workingScript
        ? !scriptMatchesPrompt(workingScript, promptContract.sourcePromptHash, promptContract.requirements)
        : true;
      if (staleScript && workingScript) {
        invalidateStaleWorkflow(`Script cache không khớp prompt hiện tại (${promptContract.requirements.shotCount ?? "theo prompt"} shot / ${promptContract.requirements.durationSeconds ?? "thời lượng suy ra"} giây); đã loại script/preview/asset/Flow cũ.`);
        workingScript = null;
      }
      let providerEnabled = cloudGenerationEnabled;
      if (!providerEnabled) {
        currentStage = "tự bật Cloud/API";
        onActivity({ stage: "studio_flow.cloud_gate", tool: "Provider gate", state: "running", progress: 0.02, message: "Agent tự bật Cloud/API vì bạn đã bấm Tự làm toàn bộ; chưa gọi provider trước khi shot plan kiểm tra xong.", nextAction: "Tiếp tục tạo shot plan rồi gửi sang Flow." });
        providerEnabled = await onEnsureCloudGeneration();
        if (!providerEnabled) {
          onActivity({ stage: "studio_flow.cloud_gate", tool: "Provider gate", state: "blocked", progress: 0.02, message: "Không tự bật được Cloud/API; chưa gọi Nano Banana hoặc Google Flow.", nextAction: "Kiểm tra backend rồi chạy lại." });
          return;
        }
      }

      if (!workingScript) {
        currentStage = "Director phân tích prompt và chia shot";
        onActivity({ stage: "studio_flow.director", tool: "Local worker / Director", state: "running", progress: 0.08, message: "Đang phân tích prompt, khóa chủ thể/bối cảnh và chia shot độc lập.", nextAction: "Chờ shot plan có cấu trúc." });
        const generated = await onGenerateScript(true, referenceContext);
        if (!generated) {
          onActivity({ stage: "studio_flow.director", tool: "Local worker / Director", state: "blocked", progress: 0.35, message: "Director không trả shot plan; agent dừng run này, không chạy bước sau.", nextAction: "Xem lỗi storyboard ở terminal rồi chạy lại." });
          return;
        }
        workingScript = generated;
        if (!scriptMatchesPrompt(workingScript, promptContract.sourcePromptHash, promptContract.requirements)) {
          invalidateStaleWorkflow(`Planner trả script lệch hợp đồng: nhận ${workingScript.segments.length} shot / ${workingScript.totalDurationSeconds}s, không đúng yêu cầu prompt. Đã chặn trước bước Flow.`);
          return;
        }
        setScriptDraft(generated);
        onActivity({ stage: "studio_flow.director", tool: "Local worker / Director", state: "success", progress: 0.35, message: `Đã tạo ${generated.segments.length} shot khác nhau và prompt riêng cho từng shot.`, nextAction: "Chuyển shot plan thẳng sang Google Flow." });
      }

      if (!workingScript) return;

      if (providerEnabled && !(await verifyBrowserFlowConnection())) {
        currentStage = "BrowserMCP preflight bị chặn";
        onActivity({ stage: "studio_flow.auto_run", tool: "Studio Flow Agent", state: "blocked", progress: 0.7, message: "Chưa có kết nối Google Flow thật; agent dừng trước Nano Banana và không tạo task trả phí.", nextAction: "Connect đúng tab Google Flow rồi bấm Tự làm toàn bộ lại." });
        return;
      }

      let scriptForProvider = workingScript;
      const knownFlowAssetPaths = new Set([...(workingScript.comfyuiAssetPaths ?? []), ...comfyuiAssets.map((asset) => asset.relativePath)].filter(Boolean));
      const needsFlowReferenceAssets = knownFlowAssetPaths.size < workingScript.segments.length;
      if (providerEnabled && needsFlowReferenceAssets) {
        currentStage = "Google Flow / Nano Banana Pro tạo asset theo từng shot";
        onActivity({ stage: "studio_flow.asset_references", tool: "Google Flow / Nano Banana Pro", state: "running", progress: 0.72, message: "Đang dùng shot plan/prompt trực tiếp trong composer Nano Banana Pro; mỗi shot tạo và tải một ảnh riêng.", nextAction: "Chờ Flow trả ảnh mới, tải về và đăng ký Asset Library trước khi sang bước video." });
        const assetReport = await generateGoogleFlowReferenceAssets(workingScript, providerEnabled, true);
        if (!assetReport || !isNanoBananaGenerationSuccessful(assetReport, workingScript.segments.length)) {
          const reportState = assetReport ? nanoBananaReportFailureState(assetReport) : "blocked";
          const message = assetReport
            ? `Google Flow / Nano Banana Pro bị ${reportState}: ${assetReport.readyCount}/${assetReport.taskCount} asset hợp lệ, status=${assetReport.status}.${assetReport.failureDetail ? ` Chi tiết: ${assetReport.failureDetail.slice(0, 300)}` : ""} Agent dừng trước bước video.`
            : `Google Flow / Nano Banana Pro bị chặn trước khi tạo asset. Chi tiết: ${lastAssetGenerationBlockerRef.current ?? "hàm tạo asset không trả report hoặc mã lỗi; kiểm tra lại project, shot plan và workflow Flow hiện tại."}`;
          currentStage = "Google Flow / Nano Banana Pro bị chặn/lỗi";
          stopHeartbeat();
          onNotice(message);
          onActivity({ stage: "studio_flow.asset_references", tool: "Google Flow / Nano Banana Pro", state: reportState, progress: 0.72, message, output: assetReport?.reportPath, nextAction: "Mở đúng project Flow, sửa blocker rồi chạy lại; không dùng asset cũ để giả thành công." });
          return;
        }
        const generatedPaths = assetReport.generatedAssets.map((asset) => asset.relativePath);
        scriptForProvider = { ...workingScript, comfyuiAssetPaths: [...new Set([...(workingScript.comfyuiAssetPaths ?? []), ...generatedPaths])] };
      }

      if (!providerEnabled) {
        const message = "Đã tự hoàn tất phần local: prompt → shot plan. Cloud/API đang tắt nên chưa gọi Nano Banana/Google Flow và chưa phát sinh chi phí.";
        onNotice(message);
        onActivity({ stage: "studio_flow.auto_run", tool: "Studio Flow Agent", state: "blocked", progress: 1, message, nextAction: "Bật API/cloud generation nếu muốn tạo asset ảnh hoặc chạy provider web." });
        return;
      }

      currentStage = "BrowserMCP nối vào Google Flow";
      onActivity({ stage: "studio_flow.browser_flow", tool: "BrowserMCP / Google Flow", state: "running", progress: 0.86, message: "Đang nối workflow vào Flow; chế độ Tự làm toàn bộ sẽ tự nạp prompt, bấm Generate bằng UI ref và chờ output.", nextAction: "Chờ BrowserMCP xác nhận tab, prompt và nút Generate thật." });
      currentStage = "Flow auto Generate và chờ output";
      const flowReady = await startBrowserFlowFromWorkspace({ ...scriptForProvider, approvalStatus: "approved", voiceSettings, visualMode: "cinematic-3d" }, null, true, runId);
      if (!flowReady) {
        const message = "Google Flow chưa xác nhận Generate/output thật; agent dừng và không coi là thành công.";
        onNotice(message);
        onActivity({ stage: "studio_flow.auto_run", tool: "Studio Flow Agent", state: "blocked", progress: 0.86, message, nextAction: "Mở Flow, bấm Connect BrowserMCP, kiểm tra tab rồi chạy lại; không cần tạo project/session mới." });
        return;
      }
      const latestFlow = await invoke<BrowserFlowWorkflowReport | null>("get_latest_browser_flow_workflow", { projectId, sessionId: activeSessionId ?? null }).catch(() => null);
      const importedFiles = (latestFlow?.workflow.downloadedFiles ?? browserFlowWorkflow?.downloadedFiles ?? []).filter((file) => file.mediaKind === "video");
      const message = importedFiles.length
        ? `Đã xác minh và import ${importedFiles.length} output video thuộc workflow hiện tại; không tính file Downloads không gắn shot/run. Không tự publish.`
        : "Flow đã phản hồi nhưng chưa có output video được gắn shot/run và import qua ffprobe; không báo hoàn tất. Mở terminal/Flow để kiểm tra.";
      onNotice(message);
      onActivity({ stage: "studio_flow.auto_run", tool: "Studio Flow Agent", state: importedFiles.length ? "success" : "info", progress: importedFiles.length ? 1 : undefined, message, nextAction: importedFiles.length ? "Review từng output, continuity, rights và compose trước delivery." : "Mở Flow kiểm tra Download và chạy resume; không coi file chưa gắn identity là output." });
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi không xác định";
      const message = `Agent dừng ở bước “${currentStage}”: ${detail.slice(0, 420)}`;
      onNotice(message);
      onActivity({ stage: "studio_flow.auto_run", tool: "Studio Flow Agent", state: "error", progress: undefined, message, nextAction: "Không bấm lặp; xem terminal để sửa đúng blocker rồi chạy lại." });
    } finally {
      window.clearInterval(heartbeatTimer);
      autoPipelineLockRef.current = false;
      setAutoPipelineBusy(false);
    }
  }

  function addStudioFlowNode(nodeId: string) {
    const node = studioFlowNodeCatalog.find((item) => item.id === nodeId);
    if (!node) return;
    setFlowSetupNodes((current) => current.includes(nodeId) ? current : [...current, nodeId]);
    setFlowSetupMenu(null);
    const message = `Đã thêm node “${node.label}” vào canvas setup.`;
    onNotice(message);
    onActivity({ stage: "studio_flow.node.add", tool: "Studio Flow Canvas", state: "info", message, nextAction: "Agent sẽ dùng node khi chạy graph; chưa gọi provider trả phí." });
  }

  function autoSetupStudioFlow() {
    if (!flowPromptReady) {
      onNotice("Nhập prompt trước để Agent tự setup canvas.");
      return;
    }
    setFlowSetupNodes(studioFlowNodeCatalog.map((item) => item.id));
    setFlowSetupMenu(null);
    const message = "Đã auto setup canvas theo prompt: ảnh phác → shot → video → voice → compose → review.";
    onNotice(message);
    onActivity({ stage: "studio_flow.auto_setup", tool: "Studio Flow Agent", state: "success", message, nextAction: "Review các node rồi bấm Agent để chạy từng bước; chưa tạo ảnh/video có phí." });
  }

  return <section className="panel one-prompt-workspace" aria-label="Tạo video từ một prompt">
      <ProjectWorkspaceCanvas projectId={projectId} projectName={projectName || "Project workspace"} topic={topic} sessions={videoSessions} assets={assets} activeSessionId={activeSessionId} loading={loading} agentBusy={autoPipelineBusy || browserFlowBusy} onTopicChange={handleTopicChange} onOpenSession={openVideoSession} onCreateSession={createNewVideoSession} onCreateProject={onCreateProject} onRunAgent={() => void runStudioFlowAgent()} onAttachReference={() => void attachReference()} onNotice={onNotice} onOpenAdvanced={onOpenAdvanced} />
    <div className="video-session-strip">
      <div className="video-session-strip-heading">
        <div><p className="eyebrow accent">VIDEO WORK SESSION</p><h3>{activeSessionId ? (videoSessions.find((session) => session.sessionId === activeSessionId)?.name ?? sessionName) : "Phiên video hiện tại"}</h3><p>Nhớ prompt, chủ đề, shot, ảnh tham chiếu và bước đang làm trong workspace local.</p></div>
        <div className="video-session-strip-actions"><button type="button" className="secondary-button" onClick={createNewVideoSession} disabled={loading || sessionSaving}>＋ Phiên mới</button>{topic.trim() && <button type="button" className="primary-button" onClick={() => void saveCurrentSession(true)} disabled={loading || sessionSaving}>{sessionSaving ? "⏳ Đang lưu phiên…" : "Lưu phiên"}</button>}</div>
      </div>
      <label className="video-session-name">Tên phiên đang làm<input value={sessionName} onChange={(event) => setSessionName(event.target.value)} placeholder="Ví dụ: Rãnh Mariana · video 30 giây" /></label>
      {activeSessionDirectory && <div className="video-session-directory"><span>THƯ MỤC PHIÊN ĐANG LÀM</span><code>{activeSessionDirectory}</code><small>Session nhớ prompt, shot và asset; file Flow tải về sẽ được copy vào thư mục phiên này.</small></div>}
      {videoSessions.length > 0 ? <div className="video-session-list">{videoSessions.slice(0, 8).map((session) => <div className={`video-session-item ${activeSessionId === session.sessionId ? "active" : ""}`} key={session.sessionId}><button type="button" onClick={() => openVideoSession(session)} disabled={loading}><strong>{session.name}</strong><span>{session.title || session.topic.slice(0, 90)}</span><small>{session.status} · {session.lastStep} · {session.durationSeconds ? `${session.durationSeconds.toFixed(0)}s` : "chưa có thời lượng"}</small><code>{session.sessionDirectory || `outputs/sessions/${session.sessionId}`}</code></button><button type="button" className="icon-button" aria-label={`Xóa ${session.name}`} onClick={() => onDeleteSession(session.sessionId)} disabled={loading}>×</button></div>)}</div> : <div className="video-session-empty">Chưa có phiên đã lưu. Gõ chủ đề; app sẽ tự tạo phiên và thư mục riêng sau một nhịp lưu.</div>}
    </div>
    <div className="studio-flow-shell" aria-label="Studio Flow workspace" style={{ display: "none" }}>
      <div className="studio-flow-heading"><div><p className="eyebrow accent">AUTO3DVIDEO FLOW / WORKSPACE</p><h2>Canvas workflow của dự án</h2><p>Agent tự nối prompt → shot plan → provider → output. Google Flow chỉ là một provider, không phải workspace chính.</p></div><div className="studio-flow-heading-actions"><span className="studio-flow-project-chip"><span className="status-dot" />{projectId ? "PROJECT ĐANG MỞ" : "CHƯA CÓ PROJECT"}</span><button type="button" className="secondary-button" onClick={onOpenAdvanced} disabled={loading}>Provider & asset</button></div></div>
       <div className="studio-flow-agentbar"><div className="studio-flow-agent-avatar">A</div><div><strong>Studio Flow Agent</strong><p>{!flowPromptReady ? "Nhập một prompt duy nhất; tôi sẽ tự chạy graph." : autoPipelineBusy ? "Đang tự phân tích → chia shot → gửi Google Flow…" : !scriptDraft ? "Đã nhận prompt. Bấm một lần để Agent tự chạy toàn bộ pipeline." : !blenderPreviewReport ? "Đã có shot plan; lần chạy tiếp theo sẽ gửi thẳng sang provider." : browserFlowFailed ? "Provider web bị chặn; output local vẫn được giữ nguyên để sửa hoặc chạy lại." : "Pipeline đã có output; các bước trả phí/delivery chỉ dừng khi cần duyệt."}</p></div><button type="button" className="primary-button" onClick={() => void runStudioFlowAgent()} disabled={loading || autoPipelineBusy || browserFlowBusy || !flowPromptReady}>{loading || autoPipelineBusy || browserFlowBusy ? "⏳ Đang tự làm…" : "🚀 Tự làm toàn bộ"}</button></div>
       <div className="studio-flow-workbench"><aside className="studio-flow-palette"><strong>NODE LIBRARY</strong><span>Prompt</span><span>Reference</span><span>Shot plan</span><span>Provider input</span><span>Omni / Seedance</span><span>Review / output</span><button type="button" className="studio-flow-auto-setup" onClick={autoSetupStudioFlow} disabled={!flowPromptReady || loading || browserFlowBusy}>⚡ Auto setup theo prompt</button><small>Nút node chỉ là cấu hình. Chạy thật luôn ghi log và output.</small></aside><div className="studio-flow-canvas"><div className="studio-flow-canvas-toolbar"><span>FLOW CANVAS / {activeSessionId ? sessionName : "Phiên mới"}</span><div><span>{scriptDraft ? `${scriptDraft.segments.length} shot` : "draft"} · shot plan ready</span><button type="button" className="studio-flow-add-trigger" onClick={() => setFlowSetupMenu((current) => current === "toolbar" ? null : "toolbar")} aria-expanded={flowSetupMenu === "toolbar"}>＋ Thêm node</button></div></div><div className="studio-flow-dot-map" aria-label="Điểm thêm node">{studioFlowDotPositions.map((position, index) => <button type="button" key={`flow-dot-${index}`} className={`studio-flow-dot ${flowSetupMenu === `dot-${index}` ? "active" : ""}`} style={position} aria-label={`Mở menu node ${index + 1}`} onClick={() => setFlowSetupMenu((current) => current === `dot-${index}` ? null : `dot-${index}`)}>•</button>)}{flowSetupMenu && <div className="studio-flow-node-menu" role="menu"><div className="studio-flow-node-menu-head"><strong>THÊM VÀO CANVAS</strong><button type="button" aria-label="Đóng menu node" onClick={() => setFlowSetupMenu(null)}>×</button></div><button type="button" className="studio-flow-menu-auto" onClick={autoSetupStudioFlow}>⚡ Auto setup theo prompt</button>{studioFlowNodeCatalog.map((node) => <button type="button" key={node.id} onClick={() => addStudioFlowNode(node.id)}><b>{node.label}</b><small>{node.detail}</small></button>)}</div>}</div>{flowSetupNodes.length > 0 && <div className="studio-flow-added-nodes"><strong>SETUP ĐÃ CHỌN</strong>{flowSetupNodes.map((nodeId) => { const node = studioFlowNodeCatalog.find((item) => item.id === nodeId); return node ? <span key={node.id}>{node.label}</span> : null; })}</div>}<div className="studio-flow-lanes"><div className="studio-flow-lane"><StudioFlowNodeCard node={flowNodes.prompt} onAction={runStudioFlowAgent} onPreview={setStudioPreview} disabled={loading || browserFlowBusy || !flowPromptReady} /><StudioFlowNodeCard node={flowNodes.reference} onAction={() => void attachReference()} onPreview={setStudioPreview} disabled={loading || browserFlowBusy} /></div><span className="studio-flow-connector" aria-hidden="true">→</span><div className="studio-flow-lane"><StudioFlowNodeCard node={flowNodes.agent} onAction={runStudioFlowAgent} onPreview={setStudioPreview} disabled={loading || browserFlowBusy || !flowPromptReady} /><StudioFlowNodeCard node={flowNodes.shots} onPreview={setStudioPreview} /></div><span className="studio-flow-connector" aria-hidden="true">→</span><div className="studio-flow-lane"><StudioFlowNodeCard node={flowNodes.storyboard} onAction={() => void previewWorkflow()} onPreview={setStudioPreview} disabled={loading || browserFlowBusy || !scriptDraft} /><StudioFlowNodeCard node={flowNodes.provider} onAction={browserFlowWorkflow ? () => onRunBrowserFlowStep("snapshot") : () => void startBrowserFlowFromWorkspace()} onPreview={setStudioPreview} disabled={loading || browserFlowBusy || !scriptDraft} /></div><span className="studio-flow-connector" aria-hidden="true">→</span><div className="studio-flow-lane"><StudioFlowNodeCard node={flowNodes.output} onAction={() => void scanBrowserDownloads()} onPreview={setStudioPreview} disabled={loading || browserFlowBusy || !browserFlowWorkflow} /><div className="studio-flow-minimap"><span /><span /><span /><span /><span /><span /></div></div></div></div></div>
     </div>
     {studioPreview && <div className="studio-flow-preview-backdrop" role="dialog" aria-modal="true" aria-label={studioPreview.title} onClick={() => setStudioPreview(null)}>
       <div className="studio-flow-preview-modal" onClick={(event) => event.stopPropagation()}>
         <div className="studio-flow-preview-modal-head">
           <div><p className="eyebrow accent">MEDIA PREVIEW</p><h3>{studioPreview.title}</h3><span>{studioPreview.detail}</span></div>
           <button type="button" className="icon-button" aria-label="Đóng preview" onClick={() => setStudioPreview(null)}>×</button>
         </div>
         <div className="studio-flow-preview-modal-media">
           {studioPreview.kind === "video" ? <video controls autoPlay preload="metadata" src={studioPreview.url} /> : <img src={studioPreview.url} alt={studioPreview.title} />}
         </div>
         <code>{studioPreview.url}</code>
       </div>
     </div>}
     <div className="one-prompt-header">
      <div>
        <p className="eyebrow accent">AUTO WORKFLOW</p>
        <h2>Nhập một prompt, hệ thống tự dựng workflow</h2>
        <p>AI tự chia shot, viết lời dẫn, tạo visual prompt, chọn camera/ánh sáng và gửi thẳng sang Flow/Omni. Không cần Blender.</p>
      </div>
      <button type="button" className="secondary-button" onClick={onOpenAdvanced} disabled={loading}>Mở quản lý nâng cao</button>
    </div>

    {browserFlowWorkflow && !blenderPreviewReport && <div className="browser-flow-recovery-card"><div><p className="eyebrow accent">BROWSERMCP / WORKFLOW ĐÃ NHỚ</p><strong>{browserFlowWorkflow.name}</strong><span>{browserFlowWorkflow.phase} · workflowId: {browserFlowWorkflow.workflowId} · session: {browserFlowWorkflow.sessionId ?? "chưa gắn"} · {browserFlowWorkflow.processes.length} process · {(browserFlowWorkflow.files ?? []).length} file binding · roadmap đã lưu local</span></div><small>Workflow sẽ tự nối lại khi có prompt và shot plan; không cần bấm lại từng process.</small></div>}

    {scriptDraft && <div className="one-prompt-result">
       <div className="one-prompt-result-head"><div><p className="eyebrow accent">WORKFLOW ĐÃ TỰ DỰNG</p><h3>{scriptDraft.title}</h3><p>{scriptDraft.segments.length} shot · {scriptDraft.totalDurationSeconds.toFixed(1)} giây · prompt đã được tách thành subject / action / camera / lighting / continuity</p></div><span className="readiness-chip enabled">SẴN SÀNG REVIEW</span></div>
       <div className="one-prompt-flow-summary"><span>Prompt</span><i>→</i><span>Shot plan</span><i>→</i><span>Provider dựng từng shot</span><i>→</i><span>Ghép video</span></div>
       {flowImageReview && <div className="flow-image-review-card" role="dialog" aria-modal="true" aria-label={`Xác nhận ảnh ${flowImageReview.shotId}`}><div className="flow-image-review-heading"><div><p className="eyebrow accent">CHỜ BẠN DUYỆT ẢNH</p><h4>{flowImageReview.shotId} · {flowImageReview.revisionId} · lần {flowImageReview.attempt}/2</h4><p>Ảnh đã tải về, import và được Gemini xem thật. Kiểm tra ảnh bên dưới trước khi workflow được phép chạy shot tiếp theo.</p></div><span className="readiness-chip disabled">TẠM DỪNG</span></div><div className="flow-image-review-media"><WorkspaceMediaImage projectId={projectId} relativePath={flowImageReview.asset.relativePath} src={workspaceMediaUrl(flowImageReview.asset.relativePath)} alt={`Ảnh kết quả ${flowImageReview.shotId}`} /></div><div className="flow-image-review-meta"><span><b>File</b><code>{flowImageReview.asset.relativePath}</code></span><span><b>Còn lại</b><strong>{flowImageReview.remainingShots} shot</strong></span>{flowImageReview.evaluation && <span><b>Gemini QA</b><strong>{flowImageReview.evaluation.decision} · {flowImageReview.evaluation.overallScore ?? "?"}/100</strong></span>}</div>{flowImageReview.evaluation && <div className="flow-image-review-evaluation"><strong>ĐÁNH GIÁ GEMINI / {flowImageReview.evaluation.model}</strong><p>{flowImageReview.evaluation.summary}</p>{flowImageReview.evaluation.flags.length > 0 && <small>Cờ cần xem: {flowImageReview.evaluation.flags.join(" · ")}</small>}{flowImageReview.evaluation.revisionInstruction && <small>Hướng sửa nếu chưa đạt: {flowImageReview.evaluation.revisionInstruction}</small>}</div>}{!flowImageReview.evaluation && <div className="flow-image-review-evaluation"><strong>GEMINI QA CHƯA CÓ</strong><p>Không nhận được đánh giá máy; quyết định dựa vào ảnh thật và người duyệt.</p></div>}<div className="flow-image-review-actions"><button type="button" className="primary-button" onClick={() => resolveFlowImageReview(true)}>✅ Ảnh đúng — {flowImageReview.remainingShots > 0 ? "làm tiếp" : "hoàn tất"}</button><button type="button" className="secondary-button" onClick={() => resolveFlowImageReview(false)}>✏️ Ảnh sai — dừng tại shot này</button></div></div>}
      <div className="one-prompt-shot-layout">
        <div className="one-prompt-shot-list">{scriptDraft.segments.map((segment, index) => <button type="button" key={segment.segmentId} className={selectedShotIndex === index ? "selected" : ""} onClick={() => setSelectedShotIndex(index)}><b>SHOT {String(index + 1).padStart(2, "0")}</b><span>{segment.onScreenText || `Cảnh ${index + 1}`}</span><small>{segment.durationSeconds.toFixed(1)}s</small></button>)}</div>
        {selectedShot && <div className="one-prompt-shot-editor"><div className="one-prompt-shot-editor-head"><strong>Shot {selectedShotIndex + 1}</strong><span>{selectedShot.durationSeconds.toFixed(1)}s · {(selectedShot.beats ?? []).length || 4} beat ảnh · {selectedShot.revisionId ? `revision ${selectedShot.revisionId}` : "bản gốc"}</span></div><label>Lời dẫn<textarea value={selectedShot.narration} onChange={(event) => updateSegment(selectedShotIndex, { narration: event.target.value })} rows={3} /></label><label>Visual prompt tự biên soạn<textarea value={selectedShot.visualPrompt ?? ""} onChange={(event) => updateSegment(selectedShotIndex, { visualPrompt: event.target.value })} rows={7} /></label><label>Overlay<input value={selectedShot.onScreenText} onChange={(event) => updateSegment(selectedShotIndex, { onScreenText: event.target.value })} /></label><div className="shot-revision-editor"><strong>SỬA RIÊNG SHOT BẰNG PROMPT</strong><small>Output cũ không bị ghi đè. App tạo revision + input hash, bỏ qua shot khác đã có bằng chứng và chỉ gửi lại shot này.</small><textarea value={revisionPrompt} onChange={(event) => setRevisionPrompt(event.target.value)} rows={4} placeholder="Ví dụ: giữ đúng khủng long T-Rex, bỏ mọi tàu ngầm; camera hạ thấp, T-Rex cao 8m bước từ trái sang phải, ánh hoàng hôn đỏ…" /><div><button type="button" className="secondary-button" onClick={() => void attachRevisionReference()} disabled={loading || browserFlowBusy}>＋ Gắn ảnh cho revision</button><button type="button" className="primary-button" onClick={() => void reviseSelectedShot()} disabled={loading || browserFlowBusy || !revisionPrompt.trim()}>↻ Sửa shot này bằng prompt</button></div><small>{selectedShot.revisionImagePath ? `Ảnh revision: ${selectedShot.revisionImagePath}` : "Có thể gắn ảnh local; ảnh là reference identity/composition, không phải model 3D."}</small></div></div>}
      </div>
       <div className="one-prompt-actions">{scriptDraft && <button type="button" className="primary-button" onClick={() => void generateGoogleFlowReferenceAssets()} disabled={loading || comfyuiGenerating}>{comfyuiGenerating ? "⏳ Đang tạo ảnh trong Flow…" : "🖼️ Tạo ảnh Google Flow · Nano Banana Pro"}</button>}</div>
      {comfyuiAssets.length > 0 && <div className="one-prompt-shot-gallery comfyui-reference-gallery"><div className="one-prompt-blender-preview-head"><div><p className="eyebrow accent">GOOGLE FLOW / NANO BANANA PRO REFERENCES</p><h4>{comfyuiAssets.length} ảnh đã nhập theo shot</h4><span>Ảnh được tạo trong Flow, tải về và đăng ký Asset Library · rights pending review</span></div><span className="readiness-chip disabled">CẦN REVIEW</span></div>{comfyuiAssets.map((asset, index) => <figure key={asset.assetId}><WorkspaceMediaImage projectId={projectId} relativePath={asset.relativePath} src={workspaceMediaUrl(asset.relativePath)} alt={asset.title} /><figcaption>SHOT {String(index + 1).padStart(2, "0")} · {asset.title}</figcaption></figure>)}</div>}
      {/* Legacy local 3D preview removed from the active provider workflow.
      <div className="one-prompt-blender-preview">
        <div className="one-prompt-blender-preview-head">
          <div><p className="eyebrow accent">{blenderPreviewReport.storyboardMode === "prompt_grounded_previs" ? "PROMPT-GROUNDED 3D PREVIEW / EDIT PLAN" : "SEMANTIC 3D STORYBOARD / EDIT PLAN"}</p><h4>{blenderPreviewReport.storyboardMode === "prompt_grounded_previs" ? `Đã dựng ${blenderPreviewReport.shotCount} shot + beat theo prompt` : `Đã phác ${blenderPreviewReport.shotCount} shot + beat ảnh để Omni dựng lại`}</h4><span>{blenderPreviewReport.storyboardMode === "prompt_grounded_previs" ? "Procedural tiger · T-Rex · time-rift · environment · camera · action · lighting" : "Primitive roles: subject · person · environment · prop · camera · action"} · {blenderPreviewReport.status} · hero: {blenderPreviewReport.heroBinding?.assetKind ?? "proxy_previs"} ({blenderPreviewReport.heroBinding?.status ?? "needs_review"}){blenderPreviewReport.heroBinding?.scaleMultiplier ? ` · Hổ ×${blenderPreviewReport.heroBinding.scaleMultiplier} · ${blenderPreviewReport.heroBinding.lengthMeters ?? "—"}m · ${blenderPreviewReport.heroBinding.massKg ?? "—"}kg` : ""}</span></div>
          <span className="readiness-chip enabled">PREVIEW READY</span>
        </div>
        {blenderPreviewReport.videoPath ? <video className="one-prompt-blender-media" controls preload="metadata" src={workspaceMediaUrl(blenderPreviewReport.videoPath)} /> : blenderPreviewReport.previewPath ? <WorkspaceMediaImage projectId={projectId} relativePath={blenderPreviewReport.previewPath} className="one-prompt-blender-media" alt="Blender shot preview" src={workspaceMediaUrl(blenderPreviewReport.previewPath)} /> : <div className="one-prompt-blender-empty">Blender đã tạo scene nhưng chưa trả về ảnh/video preview.</div>}
          <p className="one-prompt-blender-message">{blenderPreviewReport.message} {blenderPreviewReport.storyboardMode === "prompt_grounded_previs" ? "Đây là procedural 3D preview bám prompt; vẫn cần model production, review continuity và duyệt final." : "Blender chỉ phác ngữ nghĩa; không phải video final."}</p>
         {(blenderPreviewReport.shotPreviewPaths ?? []).length > 0 && <div className="one-prompt-shot-gallery">{(blenderPreviewReport.shotPreviewPaths ?? []).map((path, index) => <figure key={path}><WorkspaceMediaImage projectId={projectId} relativePath={path} src={workspaceMediaUrl(path)} alt={`Storyboard shot ${index + 1}`} /><figcaption>SHOT {String(index + 1).padStart(2, "0")} · {scriptDraft?.segments[index]?.durationSeconds.toFixed(1) ?? "—"}s</figcaption></figure>)}</div>}
        <div className="one-prompt-preview-files"><span><b>Scene</b><code>{blenderPreviewReport.scenePath}</code></span><span><b>Preview</b><code>{blenderPreviewReport.previewPath}</code></span>{blenderPreviewReport.editPlanPath && <span><b>Edit plan</b><code>{blenderPreviewReport.editPlanPath}</code></span>}{blenderPreviewReport.videoPath && <span><b>MP4 Blender (tuỳ chọn)</b><code>{blenderPreviewReport.videoPath}</code></span>}</div>
        <div className="browser-flow-workspace-card">
          <div className="browser-flow-workspace-head"><div><p className="eyebrow accent">BROWSERMCP / LIVE WORKFLOW</p><h4>{browserFlowWorkflow ? browserFlowWorkflow.name : "Lần đầu: quét route và tự lập roadmap"}</h4><p>{browserFlowWorkflow ? `${browserFlowWorkflow.phase} · workflowId: ${browserFlowWorkflow.workflowId} · session: ${browserFlowWorkflow.sessionId ?? "chưa gắn"} · ${browserFlowWorkflow.availableTools?.length ?? 0} tool · ${browserFlowWorkflow.uiRefCount} UI ref · ${browserFlowWorkflow.assets.length} asset ID · ${(browserFlowWorkflow.files ?? []).length} file binding` : "App sẽ mở đúng Google Flow, đọc snapshot một lượt, tạo roadmap và ghi process có ID. Các file được gắn vào đúng session."}</p></div><span className={`readiness-chip ${browserFlowFailed ? "disabled" : browserFlowWorkflow?.browserSessionAttached ? "enabled" : "disabled"}`}>{browserFlowWorkflow ? (browserFlowFailed ? "FAILED — CẦN KHÔI PHỤC" : browserFlowWorkflow.discoveryStatus.toUpperCase()) : "CHƯA QUÉT"}</span></div>
          {browserFlowWorkflow?.pinnedBrowserTarget && <div className="browser-flow-target-lock"><strong>🔒 FLOW TARGET ĐÃ GHIM</strong><span>{browserFlowWorkflow.pinnedBrowserTarget.providerProjectLabel}</span><code>{browserFlowWorkflow.pinnedBrowserTarget.pinnedUrl}</code><small>Chỉ thao tác khi tab hiện tại vẫn thuộc project này; đổi project sẽ bị chặn để không gõ/click nhầm.</small></div>}
          <div className="browser-flow-workflow-actions"><button type="button" className="primary-button" onClick={() => void startBrowserFlowFromWorkspace()} disabled={loading || browserFlowBusy}>{browserFlowBusy ? "⏳ Đang quét và cập nhật…" : browserFlowFailed ? "🔄 Khôi phục workflow lỗi" : browserFlowWorkflow ? "🔄 Quét lại & cập nhật roadmap" : "🔎 Quét route lần đầu"}</button>{browserFlowWorkflow && !browserFlowFailed && browserFlowWorkflow.roadmap.some((item) => item.milestoneId === "roadmap-prompt" && ["waiting_user", "blocked"].includes(item.status)) && !browserFlowWorkflow.processes.some((process) => process.operation === "type" && process.state === "succeeded") && <button type="button" className="primary-button" onClick={() => void startBrowserFlowFromWorkspace()} disabled={loading || browserFlowBusy}>{browserFlowBusy ? "⏳ Đang tìm ô prompt…" : "📝 Nạp prompt vào Flow"}</button>}{browserFlowWorkflow && !browserFlowFailed && <button type="button" className="secondary-button" onClick={() => onRunBrowserFlowStep("snapshot")} disabled={loading || browserFlowBusy}>{browserFlowBusy ? "Đang đọc Flow…" : "👁 Đọc trạng thái Flow"}</button>}{browserFlowWorkflow && <button type="button" className="secondary-button" onClick={() => void scanBrowserDownloads()} disabled={loading || browserFlowBusy}>📥 Quét Downloads</button>}{flowIngredientsRef && !browserFlowFailed && <button type="button" className="secondary-button" onClick={() => { onNotice("Đang mở Ingredients trong Flow. Sau đó chọn ảnh tham chiếu trong hộp thoại Flow; app chưa giả upload."); onRunBrowserFlowStep("click_ingredients", flowIngredientsRef.label, flowIngredientsRef.reference); }} disabled={loading || browserFlowBusy}>📎 Mở Ingredients để gắn ảnh</button>}{browserFlowWorkflow && !browserFlowFailed && browserFlowWorkflow.roadmap.some((item) => item.milestoneId === "roadmap-assets" && item.status === "waiting_user") && <button type="button" className="secondary-button" onClick={() => onRunBrowserFlowStep("verify_upload")} disabled={loading || browserFlowBusy}>{browserFlowBusy ? "Đang kiểm tra asset…" : "🔍 Kiểm tra asset đã chọn"}</button>}{flowApprovalRef && !browserFlowFailed && <button type="button" className="primary-button" onClick={() => { onNotice(`Đang bấm “${flowApprovalRef.label}” trên Flow; kiểm tra chi phí hiển thị trong tab trước khi xác nhận.`); onRunBrowserFlowStep("click", flowApprovalRef.label, flowApprovalRef.reference); }} disabled={loading || browserFlowBusy}>✅ Duyệt tạo video trên Flow</button>}</div>
          {browserFlowWorkflow?.visualStatePath && <div className="browser-flow-visual-state"><div><strong>VISUAL STATE / FLOW SCREENSHOT</strong><small>Ảnh chụp thật từ tab Flow để đối chiếu layout; không dùng tọa độ để tự click.</small><code>{browserFlowWorkflow.visualStatePath}</code></div><WorkspaceMediaImage projectId={projectId} relativePath={browserFlowWorkflow.visualStatePath} src={workspaceMediaUrl(browserFlowWorkflow.visualStatePath)} alt="Trạng thái màn hình Google Flow" /></div>}
          {browserFlowWorkflow && (browserDownloads.length > 0 || browserDownloadsMessage) && <div className="browser-flow-downloads"><div><strong>FILE FLOW ĐÃ TẢI VỀ</strong><small>{browserDownloadsMessage ?? "Chưa nhập file nào vào workspace."}</small></div>{browserDownloads.length > 0 ? <div className="browser-flow-download-list">{browserDownloads.map((entry) => <div className="browser-flow-download-row" key={entry.relativePath}><span><b>{entry.name}</b><small>{entry.mediaKind} · {(entry.sizeBytes / (1024 * 1024)).toFixed(1)} MB · Downloads</small></span><button type="button" className="secondary-button" onClick={() => void importBrowserDownload(entry)} disabled={loading || browserFlowBusy}>Nhập vào workflow</button></div>)}</div> : <span className="muted-copy">Không có file được nhập tự động. Quét lại sau khi bấm Download trên Flow.</span>}</div>}
          {(browserFlowWorkflow?.downloadedFiles ?? []).length > 0 && <div className="browser-flow-imported-files"><strong>OUTPUT LOCAL ĐÃ NHẬP</strong>{browserFlowWorkflow?.downloadedFiles?.slice(-4).map((file) => <div className="browser-flow-imported-file" key={file.downloadId}><div><b>{file.name}</b><small>{file.mediaKind} · {(file.sizeBytes / (1024 * 1024)).toFixed(1)} MB · SHA {file.sha256.slice(0, 12)}…{file.shotId ? ` · ${file.shotId} · ${file.revisionId ?? "rev-001"}` : ""}</small><code>{file.relativePath}</code></div>{file.mediaKind === "video" ? <video controls preload="metadata" src={workspaceMediaUrl(file.relativePath)} /> : <WorkspaceMediaImage projectId={projectId} relativePath={file.relativePath} src={workspaceMediaUrl(file.relativePath)} alt={file.name} />}</div>)}</div>}
          {browserFlowWorkflow && <div className="browser-flow-roadmap"><div className="browser-flow-roadmap-title"><strong>ROADMAP TỰ CẬP NHẬT</strong><span>{browserFlowWorkflow.lastMessage}</span></div>{browserFlowWorkflow.roadmap.map((item) => <div className="browser-flow-roadmap-row" key={item.milestoneId}><span className={`browser-flow-status status-${item.status}`}>{item.status}</span><strong>{item.name}</strong><small>{item.nextAction}{item.processId ? ` · process: ${item.processId}` : ""}{item.evidence ? ` · evidence: ${item.evidence}` : ""}</small></div>)}</div>}
          {browserFlowWorkflow && browserFlowWorkflow.uiRefs.length > 0 && <details className="browser-flow-ui-refs"><summary>UI REF ĐÃ HỌC ({browserFlowWorkflow.uiRefs.length})</summary><div>{browserFlowWorkflow.uiRefs.slice(0, 16).map((item) => <span key={`${item.role}-${item.reference}`}><b>{item.role}</b><strong>{item.label}</strong><code>{item.reference}</code></span>)}</div></details>}
          {browserFlowWorkflow && browserFlowWorkflow.assets.length > 0 && <div className="browser-flow-assets"><strong>ASSET ĐÃ ĐÁNH DẤU</strong><div>{browserFlowWorkflow.assets.map((asset) => <span key={asset.assetId}><b>{asset.assetId}</b><small>{asset.name} · {asset.role}</small></span>)}</div></div>}
          {browserFlowWorkflow && browserFlowWorkflow.processes.length > 0 && <details className="browser-flow-processes" open><summary>PROCESS LOG ({browserFlowWorkflow.processes.length})</summary>{browserFlowWorkflow.processes.slice(-8).map((process) => <div className="browser-flow-process-row" key={process.processId}><span className={`browser-flow-status status-${process.state}`}>{process.state}</span><strong>{process.name}</strong><code>{process.processId}</code><small>{process.message}{process.output ? ` · output: ${process.output}` : ""}</small></div>)}</details>}
        </div>
      </div> */}
    </div>}
  </section>;
}

function TopicWorkflowPanel({
  profiles,
  selectedProfileId,
  topic,
  loading,
  localScriptReview,
  localVideoReport,
  voiceSettings,
  projectId,
  activityEvents,
  onActivity,
  onProfileChange,
  onTopicChange,
  onGenerateScript,
  onRenderApprovedLocalVideo,
}: {
  profiles: TopicProfile[];
  templates: PromptTemplate[];
  selectedProfileId: string;
  selectedTemplateId: string;
  topic: string;
  contentGoal: string;
  additionalPrompt: string;
  projectId: string;
  loading: boolean;
  activityEvents: WorkspaceActivityEvent[];
  onActivity: (event: Omit<WorkspaceActivityEvent, "eventId" | "timestamp">) => void;
  localScriptReview: LocalScriptReviewReport | null;
  localVideoReport: LocalVideoPipelineReport | null;
  voiceSettings: VoiceSettings;
  onProfileChange: (value: string) => void;
  onTemplateChange: (value: string) => void;
  onTopicChange: (value: string) => void;
  onContentGoalChange: (value: string) => void;
  onAdditionalPromptChange: (value: string) => void;
  onPreview: () => void;
  onGenerateScript: (briefApproved: boolean) => void;
  onRenderApprovedLocalVideo: (script: LocalScriptDocument, scriptPath: string) => void;
}) {
  const [scriptDraft, setScriptDraft] = useState<LocalScriptDocument | null>(null);
  const [selectedRenderEngine, setSelectedRenderEngine] = useState<string>("ai-3d-cloud");
  const [selectedShotIndex, setSelectedShotIndex] = useState(0);
  const [reviewPreview, setReviewPreview] = useState<"composer" | null>(null);
  const [approvedShotIds, setApprovedShotIds] = useState<string[]>([]);
  const [flowRailCollapsed, setFlowRailCollapsed] = useState(true);
  const [showAdvancedStudio, setShowAdvancedStudio] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(true);

  function topicMediaUrl(relativePath: string) {
    if (isTauri() && projectId.trim()) {
      const params = new URLSearchParams({ projectId: projectId.trim(), path: relativePath });
      return `http://auto3d-media.localhost/media?${params.toString()}`;
    }
    return `/api/stream-file?path=${encodeURIComponent(relativePath)}`;
  }

  function logActivity(text: string) {
    const tool = /blender/i.test(text) ? "Blender" : /render|mp4|ffmpeg/i.test(text) ? "FFmpeg" : "Workspace";
    onActivity({ stage: "workflow.run", tool, state: "info", message: text });
  }

  useEffect(() => {
    setScriptDraft(localScriptReview?.script ?? null);
    setSelectedShotIndex(0);
    if (projectId) {
      void invoke<string[]>("list_shot_approvals", { projectId }).then(setApprovedShotIds).catch(() => setApprovedShotIds([]));
    } else {
      setApprovedShotIds([]);
    }
  }, [localScriptReview, projectId]);

  useEffect(() => {
    if (loading) setConsoleOpen(true);
  }, [loading]);

  function updateScript(patch: Partial<LocalScriptDocument>) {
    setScriptDraft((current) => current ? { ...current, ...patch } : current);
  }

  function updateSegment(index: number, patch: Partial<LocalScriptSegment>) {
    const segmentId = scriptDraft?.segments[index]?.segmentId;
    setScriptDraft((current) => current ? { ...current, segments: current.segments.map((segment, segmentIndex) => segmentIndex === index ? { ...segment, ...patch } : segment) } : current);
    if (segmentId && approvedShotIds.includes(segmentId)) {
      setApprovedShotIds((current) => current.filter((id) => id !== segmentId));
      if (projectId) void invoke("set_shot_approval", { projectId, shotId: segmentId, approved: false });
    }
  }

  function addShot() {
    if (!scriptDraft) return;
    const source = scriptDraft.segments[scriptDraft.segments.length - 1];
    const segmentId = `segment-${String(scriptDraft.segments.length + 1).padStart(2, "0")}`;
    const durationSeconds = 5;
    const segment: LocalScriptSegment = { ...source, segmentId, durationSeconds, narration: "Chuyển cảnh tiếp theo: mở rộng không gian và nhấn mạnh chi tiết quan trọng của chủ đề.", onScreenText: "Chi tiết tiếp theo", claimStatus: "not_applicable", sourceNote: null };
    setScriptDraft({ ...scriptDraft, segments: [...scriptDraft.segments, segment], totalDurationSeconds: scriptDraft.totalDurationSeconds + durationSeconds, approvalStatus: "pending" });
    setSelectedShotIndex(scriptDraft.segments.length);
    setApprovedShotIds([]);
  }


  async function approveAndRender() {
    if (!scriptDraft || !localScriptReview) {
      onActivity({ stage: "run.validate", tool: "Workspace", state: "blocked", message: "Chưa có kịch bản để chạy.", nextAction: "Bấm Tạo kịch bản ở Bước 1 trước." });
      setConsoleOpen(true);
      return;
    }
    logActivity(`Bắt đầu xuất: ${scriptDraft.segments.length} shot · ${scriptDraft.totalDurationSeconds.toFixed(1)}s`);
    logActivity("[1/5] Kiểm tra project, shot plan và prompt đã chỉnh");
    // One-click local production: the export action is itself the explicit approval.
    // Persist approval for every generated shot so users do not have to click six
    // separate review controls before starting the requested local render.
    if (projectId) {
      await Promise.all(scriptDraft.segments.map((segment) => invoke("set_shot_approval", { projectId, shotId: segment.segmentId, approved: true })));
      setApprovedShotIds(scriptDraft.segments.map((segment) => segment.segmentId));
    }
    if (selectedRenderEngine === "ai-3d-cloud") {
      onActivity({ stage: "provider.validate", tool: "AI provider", state: "blocked", message: "AI 3D Cloud chưa được nối provider trong pipeline hiện tại; chưa gửi request.", nextAction: "Cấu hình adapter/provider thật rồi chạy lại." });
      setConsoleOpen(true);
      return;
    }
    onRenderApprovedLocalVideo(
      { ...scriptDraft, approvalStatus: "approved", voiceSettings, visualMode: "space-25d" },
      localScriptReview.scriptPath
    );
  }

  return (
    <section className="panel shot-studio" style={{ maxWidth: "1400px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "24px", padding: "28px" }}>
      {/* Header & Quick Action Buttons */}
      <div style={{ borderBottom: "1px solid var(--border)", paddingBottom: "16px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <p className="eyebrow accent" style={{ margin: "0 0 4px 0" }}>XƯỞNG SẢN XUẤT VIDEO TỰ ĐỘNG</p>
          <h2 style={{ fontSize: "22px", margin: "0 0 6px 0", color: "#fff" }}>🎬 Tạo Video Trực Quan Từng Bước</h2>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "14px" }}>
            Nhập ý tưởng → AI phân cảnh kịch bản → Tùy chỉnh lời thoại & chữ trên màn hình → Xuất video MP4 xem ngay.
          </p>
        </div>

        <button type="button" className="secondary-button" onClick={() => setShowAdvancedStudio((value) => !value)}>
          {showAdvancedStudio ? "Ẩn công cụ phụ" : "Mở công cụ phụ"} <span>⌄</span>
        </button>
      </div>

      {showAdvancedStudio && <div className="studio-advanced-tools">
        <button type="button" className="secondary-button" onClick={() => (window as unknown as { switchTab?: (t: string) => void }).switchTab?.("subtitles")}>📤 Tải video / Phụ đề</button>
        <button type="button" className="secondary-button" onClick={() => (window as unknown as { switchTab?: (t: string) => void }).switchTab?.("voice")}>🎙️ Đổi giọng / Cảm xúc</button>
        <button type="button" className="secondary-button" onClick={() => (window as unknown as { switchTab?: (t: string) => void }).switchTab?.("handoff")}>🌐 BrowserMCP / Omni</button>
      </div>}

      <div className={`shot-studio-workspace ${flowRailCollapsed ? "flow-rail-collapsed" : ""}`}>
      <aside className="shot-flow-rail" aria-label="Luồng sản xuất">
        <button type="button" className="flow-rail-toggle" onClick={() => setFlowRailCollapsed((value) => !value)} aria-label="Thu gọn luồng">{flowRailCollapsed ? "›" : "‹"}</button>
        <p className="eyebrow accent">PRODUCTION FLOW</p>
        <div className="shot-flow-step active"><b>01</b><span>Ý tưởng & brief</span></div>
        <div className={`shot-flow-step ${scriptDraft ? "active" : ""}`}><b>02</b><span>Storyboard / shot list</span></div>
        <div className="shot-flow-step"><b>03</b><span>Shot Composer</span><small>Chờ preview</small></div>
        <div className="shot-flow-step"><b>04</b><span>Provider media</span><small>Chưa gửi</small></div>
        <div className="shot-flow-step"><b>05</b><span>Ghép video</span><small>Chưa chạy</small></div>
        <div className="shot-flow-step"><b>06</b><span>Review / delivery</span></div>
        {scriptDraft && <div className="shot-list-rail"><p className="eyebrow">SHOTS · {approvedShotIds.length}/{scriptDraft.segments.length} DUYỆT</p><div className="shot-approval-meter"><i style={{ width: `${Math.round((approvedShotIds.length / Math.max(1, scriptDraft.segments.length)) * 100)}%` }} /></div>{scriptDraft.segments.map((segment, index) => <button type="button" key={segment.segmentId} className={`shot-nav-item ${selectedShotIndex === index ? "selected" : ""}`} onClick={() => setSelectedShotIndex(index)}><span>{approvedShotIds.includes(segment.segmentId) ? "✓" : String(index + 1).padStart(2, "0")}</span><strong>{segment.durationSeconds.toFixed(1)}s</strong><small>{segment.onScreenText || `Cảnh ${index + 1}`} · {approvedShotIds.includes(segment.segmentId) ? "Đã duyệt" : "Cần review"}</small></button>)}</div>}
      </aside>
      <div className="shot-studio-main">
      <div className={`activity-console ${consoleOpen ? "" : "collapsed"}`}>
        <div className="activity-console-head"><strong>WORKSPACE / LIVE ACTIVITY</strong><div><span>{loading ? "RUNNING" : "IDLE"}</span><button type="button" className="console-toggle" onClick={() => setConsoleOpen((value) => !value)}>{consoleOpen ? "Ẩn log" : "Mở log"}</button></div></div>
        {consoleOpen && <>
          <div className="activity-console-line muted"><b>›</b> Pipeline: {scriptDraft ? `${scriptDraft.segments.length} shot · ${scriptDraft.totalDurationSeconds.toFixed(1)}s · review ${approvedShotIds.length}/${scriptDraft.segments.length}` : "chưa có storyboard"}</div>
          {activityEvents.length ? activityEvents.slice(-12).map((entry, index) => <div className={`activity-console-line ${index === activityEvents.slice(-12).length - 1 ? "" : "muted"}`} key={entry.eventId}><small>{new Date(entry.timestamp).toLocaleTimeString("vi-VN")}</small> <b>›</b> <em className={`activity-state ${entry.state}`}>{displayWorkspaceActivityState(entry.state)}</em> <strong>{entry.tool}</strong> {entry.message}{entry.output ? ` · output: ${entry.output}` : ""}{entry.nextAction ? ` · tiếp: ${entry.nextAction}` : ""}{entry.durationMs ? ` · ${Math.round(entry.durationMs / 100) / 10}s` : ""}</div>) : <div className="activity-console-line muted"><b>›</b> Đang chờ thao tác. Khi chạy, từng bước sẽ hiện ở đây.</div>}
        </>}
      </div>
      {/* BƯỚC 1: NHẬP Ý TƯỞNG VIDEO */}
      <div style={{ background: "var(--panel-soft)", padding: "20px", borderRadius: "10px", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ background: "var(--cyan)", color: "#000", fontWeight: 700, borderRadius: "50%", width: "24px", height: "24px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px" }}>1</span>
          <strong style={{ fontSize: "16px", color: "#fff" }}>Ý tưởng & Thể loại Video</strong>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "16px" }}>
          <div>
            <label style={{ fontSize: "13px", fontWeight: 600, display: "block", marginBottom: "6px" }}>Chủ đề bạn muốn làm:</label>
            <textarea
              rows={3}
              value={topic}
              onChange={(e) => onTopicChange(e.target.value)}
              placeholder="Ví dụ: Vì sao lỗ đen vũ trụ có thể bẻ cong ánh sáng và thời gian?"
              style={{ width: "100%", padding: "10px 12px", borderRadius: "6px", background: "rgba(0,0,0,0.3)", color: "#fff", border: "1px solid var(--border)", fontSize: "14px", resize: "vertical" }}
            />
            {/* Gợi ý 5 chủ đề thịnh hành 1-click */}
            <details className="topic-suggestions" style={{ marginTop: "8px" }}>
              <summary>⚡ Gợi ý chủ đề nhanh (tuỳ chọn)</summary>
            <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "12px", color: "var(--muted)", width: "100%" }}>⚡ 5 Ngách triệu view (Bấm để nạp sẵn kịch bản & prompt 3D):</span>
              <button
                type="button"
                className="secondary-button compact-button"
                style={{ fontSize: "11px", color: "var(--cyan)", borderColor: "rgba(143,232,218,0.3)" }}
                onClick={() => {
                  onTopicChange("Tốc độ ánh sáng và nghịch lý con tàu vũ trụ xé toạc Ngân Hà");
                  onProfileChange("cinematic-3d");
                  setSelectedRenderEngine("ai-3d-cloud");
                }}
              >
                🌌 1. Bí ẩn Vũ trụ & Tốc độ ánh sáng
              </button>
              <button
                type="button"
                className="secondary-button compact-button"
                style={{ fontSize: "11px", color: "#f59e0b", borderColor: "rgba(245,158,11,0.3)" }}
                onClick={() => {
                  onTopicChange("Bên trong Kim Tự Tháp Giza: Mật thất ngầm và công nghệ xây dựng bí ẩn");
                  onProfileChange("history-documentary");
                  setSelectedRenderEngine("ai-3d-cloud");
                }}
              >
                🏛️ 2. Lịch sử Cổ đại & Kim Tự Tháp
              </button>
              <button
                type="button"
                className="secondary-button compact-button"
                style={{ fontSize: "11px", color: "#ec4899", borderColor: "rgba(236,72,153,0.3)" }}
                onClick={() => {
                  onTopicChange("Hành trình một giọt cà phê đi vào cơ thể: Bộ não bị 'đánh lừa' thế nào?");
                  onProfileChange("science-explainer");
                  setSelectedRenderEngine("ai-3d-cloud");
                }}
              >
                🧬 3. Cơ thể Sinh học & Vi mô
              </button>
              <button
                type="button"
                className="secondary-button compact-button"
                style={{ fontSize: "11px", color: "#3b82f6", borderColor: "rgba(59,130,246,0.3)" }}
                onClick={() => {
                  onTopicChange("Bí mật Rãnh Mariana: Nơi đáy đại dương sâu nhất và sinh vật phát quang");
                  onProfileChange("cinematic-3d");
                  setSelectedRenderEngine("ai-3d-cloud");
                }}
              >
                🌊 4. Đáy Đại dương & Vực Mariana
              </button>
              <button
                type="button"
                className="secondary-button compact-button"
                style={{ fontSize: "11px", color: "#10b981", borderColor: "rgba(16,185,129,0.3)" }}
                onClick={() => {
                  onTopicChange("Khám phá Trái Đất năm 2100: Thành phố nổi Cyberpunk và ô tô bay");
                  onProfileChange("cinematic-3d");
                  setSelectedRenderEngine("ai-3d-cloud");
                }}
              >
                🤖 5. Công nghệ Tương lai & Cyberpunk
              </button>
            </div>
            </details>
          </div>
          <div>
            <label style={{ fontSize: "13px", fontWeight: 600, display: "block", marginBottom: "6px" }}>Thể loại nội dung:</label>
            <select
              value={selectedProfileId}
              onChange={(e) => onProfileChange(e.target.value)}
              style={{ width: "100%", padding: "10px", borderRadius: "6px", background: "#161b22", color: "#fff", border: "1px solid var(--border)", fontSize: "14px" }}
            >
              {profiles.map((item) => (
                <option value={item.profileId} key={item.profileId}>{item.name}</option>
              ))}
            </select>
            <small style={{ display: "block", marginTop: "8px", color: "var(--muted)", fontSize: "12px" }}>
              💡 Hệ thống sẽ tự động tối ưu góc nhìn và nhịp dựng phù hợp thể loại này.
            </small>
          </div>
        </div>

        {/* BỘ CHỌN CÔNG NGHỆ DỰNG VIDEO (RENDER ENGINE) */}
        <div>
          <label style={{ fontSize: "13px", fontWeight: 600, display: "block", marginBottom: "8px" }}>Công nghệ kết xuất hình ảnh / Scene:</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
            {[
              {
                id: "space-25d",
                title: "Không Gian 2.5D Cục Bộ",
                tag: "Miễn phí · Chạy Offline",
                desc: "Hiệu ứng thị sai Parallax, chuyển động camera vũ trụ và phụ đề viền.",
                badgeColor: "var(--cyan)",
              },
              {
                id: "ai-3d-cloud",
                title: "AI 3D Siêu Thực (Cloud API)",
                tag: "Seedance / Kling / Runway",
                desc: "Tạo cảnh hoạt hình 3D điện ảnh chân thực từ prompt phân cảnh.",
                badgeColor: "#a855f7",
              },
            ].map((engine) => {
              const active = selectedRenderEngine === engine.id;
              return (
                <div
                  key={engine.id}
                  onClick={() => setSelectedRenderEngine(engine.id)}
                  style={{
                    cursor: "pointer",
                    padding: "14px",
                    borderRadius: "8px",
                    border: active ? "2px solid var(--cyan)" : "1px solid var(--border)",
                    background: active ? "rgba(143,232,218,0.08)" : "rgba(0,0,0,0.25)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong style={{ fontSize: "14px", color: active ? "var(--cyan)" : "#fff" }}>{engine.title}</strong>
                    <input type="radio" checked={active} readOnly />
                  </div>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: engine.badgeColor }}>{engine.tag}</span>
                  <p style={{ margin: 0, fontSize: "12px", color: "var(--muted)", lineHeight: 1.4 }}>{engine.desc}</p>
                </div>
              );
            })}
          </div>

          {selectedRenderEngine === "ai-3d-cloud" && (
            <div style={{ marginTop: "12px", padding: "12px 14px", background: "rgba(168,85,247,0.1)", borderRadius: "6px", border: "1px solid rgba(168,85,247,0.3)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: "13px" }}>
                <span style={{ color: "#d8b4fe", fontWeight: 600 }}>⚡ Chế độ AI 3D Cloud:</span>
                <span style={{ color: "var(--muted)", marginLeft: "6px" }}>Tự động tạo video 3D từ prompt cho từng cảnh.</span>
              </div>
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={() => (window as unknown as { switchTab?: (t: string) => void }).switchTab?.("providers")}
              >
                ⚙️ Cấu hình API Key
              </button>
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="primary-button"
            style={{ padding: "10px 20px", fontSize: "14px" }}
            disabled={loading || !topic.trim()}
            onClick={() => onGenerateScript(true)}
          >
            {loading && !scriptDraft ? "⏳ Đang tạo kịch bản..." : "✨ Tự Động Tạo Kịch Bản Phân Cảnh →"}
          </button>
        </div>
      </div>

      {/* BƯỚC 2: PHÂN CẢNH KỊCH BẢN (STORYBOARD) */}
      {scriptDraft && (
        <div style={{ background: "var(--panel-soft)", padding: "20px", borderRadius: "10px", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ background: "var(--cyan)", color: "#000", fontWeight: 700, borderRadius: "50%", width: "24px", height: "24px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px" }}>2</span>
              <strong style={{ fontSize: "16px", color: "#fff" }}>Kịch Bản Phân Cảnh (Storyboard)</strong>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ fontSize: "13px", color: "var(--cyan)", background: "rgba(143,232,218,0.1)", padding: "4px 10px", borderRadius: "4px" }}>
              {scriptDraft.segments.length} Phân cảnh · Tổng ~{scriptDraft.totalDurationSeconds.toFixed(0)}s
            </span><button type="button" className="small-button" onClick={addShot} disabled={scriptDraft.segments.length >= 24}>+ Thêm shot</button></div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <label style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: "4px" }}>Tiêu đề video:</label>
              <input
                type="text"
                value={scriptDraft.title}
                onChange={(e) => updateScript({ title: e.target.value })}
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "rgba(0,0,0,0.3)", color: "#fff", border: "1px solid var(--border)", fontSize: "14px" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: "4px" }}>Câu mở đầu (Hook giữ chân người xem):</label>
              <input
                type="text"
                value={scriptDraft.hook}
                onChange={(e) => updateScript({ hook: e.target.value })}
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "rgba(0,0,0,0.3)", color: "#fff", border: "1px solid var(--border)", fontSize: "14px" }}
              />
            </div>
          </div>

          {/* Danh sách từng phân cảnh */}
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {scriptDraft.segments.map((segment, index) => (
              <div
                key={segment.segmentId}
                onClick={() => setSelectedShotIndex(index)}
                style={{
                  background: "rgba(0,0,0,0.25)",
                  padding: "14px 16px",
                  borderRadius: "8px",
                  border: selectedShotIndex === index ? "1px solid var(--cyan)" : "1px solid var(--border)",
                  display: "grid",
                  gridTemplateColumns: selectedRenderEngine === "ai-3d-cloud" ? "80px 1.2fr 1.2fr 1fr 110px" : "80px 1.4fr 1fr 120px",
                  gap: "14px",
                  alignItems: "center",
                }}
              >
                <div>
                  <strong style={{ fontSize: "14px", color: "var(--cyan)", display: "block" }}>Cảnh {index + 1}</strong>
                  <span style={{ fontSize: "12px", color: "var(--muted)" }}>⏱️ {segment.durationSeconds.toFixed(1)}s</span>
                </div>

                <div>
                  <label style={{ fontSize: "11px", color: "var(--muted)", display: "block", marginBottom: "2px" }}>Lời dẫn giọng đọc (Voice):</label>
                  <textarea
                    rows={2}
                    value={segment.narration}
                    onChange={(e) => updateSegment(index, { narration: e.target.value })}
                    style={{ width: "100%", padding: "6px 8px", borderRadius: "4px", background: "rgba(255,255,255,0.05)", color: "#fff", border: "1px solid var(--border)", fontSize: "13px" }}
                  />
                </div>

                {selectedRenderEngine === "ai-3d-cloud" && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2px" }}>
                      <label style={{ fontSize: "11px", color: "#d8b4fe" }}>Mô tả góc quay 3D (Prompt chuẩn 5 lớp):</label>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          type="button"
                          className="secondary-button compact-button"
                          style={{ fontSize: "10px", padding: "1px 6px" }}
                          onClick={() => {
                            const p = segment.visualPrompt || `Cinematic 3D space render, hyper-detailed cosmic shot, extreme parallax camera zoom flying through glowing nebula and star cluster, Unreal Engine 5, ray-traced lighting, volumetric space dust, 8k resolution`;
                            navigator.clipboard.writeText(p);
                            alert("Đã copy Prompt 3D chuẩn 5 lớp vào Clipboard!");
                          }}
                        >
                          📋 Copy Prompt
                        </button>
                        <label
                          style={{
                            fontSize: "10px",
                            color: "var(--cyan)",
                            cursor: "pointer",
                            background: "rgba(143,232,218,0.1)",
                            padding: "2px 6px",
                            borderRadius: "4px",
                          }}
                        >
                          📁 Tải video 3D cảnh này
                          <input
                            type="file"
                            accept="video/mp4,image/*"
                            style={{ display: "none" }}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                updateSegment(index, { sourceNote: file.name });
                                alert(`Đã gán file "${file.name}" cho Cảnh ${index + 1}!`);
                              }
                            }}
                          />
                        </label>
                      </div>
                    </div>
                    <textarea
                      rows={3}
                      value={
                        segment.visualPrompt ||
                        (() => {
                          if (topic.includes("Kim Tự Tháp") || selectedProfileId === "history-documentary") {
                            return index === 0
                              ? "Cinematic 3D slow push-in camera shot through a narrow subterranean limestone corridor inside ancient Giza pyramid, golden flickering torchlight casting dramatic shadows on hieroglyphic wall carvings, atmospheric floating ancient dust motes, Unreal Engine 5, ultra-photorealistic, 8k"
                              : "Cinematic 3D aerial architectural cross-section of the Great Pyramid of Giza, glowing hidden burial chambers revealed in ethereal blue volumetric light, hyper-detailed masonry stone textures, Octane render, photorealistic lighting";
                          }
                          if (topic.includes("cà phê") || topic.includes("cơ thể") || selectedProfileId === "science-explainer") {
                            return index === 0
                              ? "Cinematic 3D extreme macro zoom into human bloodstream, glossy red blood cells tumbling in fluid dynamics, glowing caffeine molecules latching onto neural adenosine receptors, bioluminescent micro-particles, Unreal Engine 5, shallow depth of field f/1.4, 8k"
                              : "Cinematic 3D anatomical view inside human brain synapses, bursts of electric blue neuro-signals firing across neural pathways, hyper-detailed nerve fibers, volumetric glow, scientific documentary CGI render";
                          }
                          if (topic.includes("Mariana") || topic.includes("đại dương")) {
                            return index === 0
                              ? "Cinematic 3D deep sea expedition, bright submarine halogen beam cutting through pitch-black abyss of Mariana Trench, mysterious bioluminescent abyssal creatures hovering near camera, deep ocean particulate snow (marine snow), Octane 8k render"
                              : "Cinematic 3D low-angle tracking shot along jagged oceanic trench cliffs, geothermal hydrothermal vents billowing black mineral smoke, eerie atmospheric lighting, Unreal Engine 5 hyper-realistic water physics";
                          }
                          if (topic.includes("2100") || topic.includes("Cyberpunk")) {
                            return index === 0
                              ? "Cinematic 3D FPV drone flying between soaring megastructure skyscrapers in Neo-Earth 2100, rain-slicked futuristic streets reflecting neon magenta and teal billboards, autonomous flying vehicles weaving in 3D parallax, Unreal Engine 5, 8k photorealistic"
                              : "Cinematic 3D close-up of a cybernetic synthetic human eye iris dilating, glowing holographic HUD data interface overlay, ray-traced reflections on chrome implants, Octane render 8k";
                          }
                          return index === 0
                            ? "Cinematic 3D render, high-speed camera flying closely past a massive textured asteroid belt with tumbling metallic rocks, extreme parallax perspective, glowing ion thruster exhaust particles, Unreal Engine 5 aesthetic, volumetric space nebula lighting, sharp depth of field, 8k resolution, ultra photorealistic"
                            : "Cinematic 3D space documentary shot, swirling massive black hole accretion disk with intense glowing photon ring, gravitational lensing warping background starfield, extreme depth of field, Octane render 8k";
                        })()
                      }
                      onChange={(e) => updateSegment(index, { visualPrompt: e.target.value })}
                      placeholder="Mô tả cảnh quay 3D hoặc dán prompt..."
                      style={{ width: "100%", padding: "6px 8px", borderRadius: "4px", background: "rgba(168,85,247,0.05)", color: "#fff", border: "1px solid rgba(168,85,247,0.3)", fontSize: "12px" }}
                    />
                    {segment.sourceNote && (
                      <span style={{ fontSize: "11px", color: "var(--cyan)", display: "block", marginTop: "2px" }}>
                        ✓ File phác thảo: {segment.sourceNote}
                      </span>
                    )}
                  </div>
                )}

                <div>
                  <label style={{ fontSize: "11px", color: "var(--muted)", display: "block", marginBottom: "2px" }}>Chữ hiển thị màn hình (Overlay):</label>
                  <input
                    type="text"
                    value={segment.onScreenText}
                    onChange={(e) => updateSegment(index, { onScreenText: e.target.value })}
                    style={{ width: "100%", padding: "6px 8px", borderRadius: "4px", background: "rgba(255,255,255,0.05)", color: "#fff", border: "1px solid var(--border)", fontSize: "13px" }}
                  />
                </div>

                <div style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ fontSize: "12px", padding: "6px 10px", width: "100%" }}
                    onClick={async () => {
                      try {
                        const res = await fetch("/api/tts", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            text: segment.narration,
                            voice: voiceSettings.presetVoice,
                            referenceAudioPath: voiceSettings.referenceAudioPath,
                            temperature: voiceSettings.temperature,
                          }),
                        });
                        const data = await res.json();
                        if (data.audioUrl) {
                          const audio = new Audio(data.audioUrl);
                          void audio.play();
                        }
                      } catch {
                        alert("Không thể phát thử âm thanh đoạn này");
                      }
                    }}
                  >
                    🔊 Nghe câu này
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px", paddingTop: "12px", borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--muted)" }}>
              <span>🎙️ Đang dùng: <strong>{voiceSettings.referenceAudioPath ? "Giọng thu âm của bạn" : voiceSettings.presetVoice}</strong></span>
              <span>· Cảm xúc: <strong>{voiceSettings.temperature.toFixed(2)}</strong></span>
            </div>

            <button
              type="button"
              className="primary-button"
              style={{ background: "#10b981", borderColor: "#10b981", padding: "10px 24px", fontSize: "15px", fontWeight: 700 }}
              disabled={loading}
              onClick={approveAndRender}
            >
              {loading ? "⏳ Đang dựng video…" : "🎬 Tự xuất video MP4 hoàn chỉnh →"}
            </button>
          </div>
        </div>
      )}
      </div>
      <aside className="shot-review-rail" aria-label="Review shot đang chọn">
        <div className="shot-review-header"><div><p className="eyebrow accent">SHOT REVIEW</p><h3>{scriptDraft ? `Cảnh ${Math.min(selectedShotIndex + 1, scriptDraft.segments.length)}` : "Chưa có shot"}</h3></div><span className="status-text disabled">REVIEW</span></div>
        {scriptDraft?.segments[selectedShotIndex] ? (() => { const segment = scriptDraft.segments[selectedShotIndex]; const prompt = segment.visualPrompt || "Chưa có visual prompt — hãy tạo storyboard hoặc nhập prompt."; return <>
          <div className="shot-review-status"><span className="review-dot" /> {approvedShotIds.includes(segment.segmentId) ? "Shot approved" : "Prompt ready"} <strong>{segment.durationSeconds.toFixed(1)}s</strong></div>
          <div className="shot-review-card"><span className="review-label">Narration</span><p>{segment.narration || "Chưa có lời dẫn"}</p></div>
          <div className="shot-review-card"><span className="review-label">Visual prompt · 5 lớp</span><textarea value={prompt} onChange={(event) => updateSegment(selectedShotIndex, { visualPrompt: event.target.value })} rows={12} /><small>Subject · action · camera · lighting · render/style</small></div>
          <div className="shot-review-card shot-details-card"><span className="review-label">Shot details · dữ liệu cho AI/provider</span><label>Subject<input value={segment.subject ?? ""} onChange={(event) => updateSegment(selectedShotIndex, { subject: event.target.value })} placeholder="Nhân vật/vật thể chính, nhận diện và chất liệu" /></label><label>Action<input value={segment.action ?? ""} onChange={(event) => updateSegment(selectedShotIndex, { action: event.target.value })} placeholder="Hành động và nhịp chuyển động theo thời gian" /></label><label>Camera / lens<input value={segment.cameraIntent ?? ""} onChange={(event) => updateSegment(selectedShotIndex, { cameraIntent: event.target.value })} placeholder="Wide 28mm, slow dolly-in, left-to-right" /></label><label>Lighting / look<input value={segment.lightingIntent ?? ""} onChange={(event) => updateSegment(selectedShotIndex, { lightingIntent: event.target.value })} placeholder="Volumetric blue rim light, high contrast" /></label><label>Continuity anchors<textarea rows={2} value={segment.continuityNotes ?? ""} onChange={(event) => updateSegment(selectedShotIndex, { continuityNotes: event.target.value })} placeholder="Giữ màu tàu, hướng camera, vị trí nhân vật giữa các shot" /></label><label>Negative constraints<textarea rows={2} value={segment.negativePrompt ?? ""} onChange={(event) => updateSegment(selectedShotIndex, { negativePrompt: event.target.value })} placeholder="No extra objects, no text, no logo, no morphing" /></label></div>
          <div className="shot-review-card"><span className="review-label">Pipeline status</span><div className="review-progress"><span>Shot plan</span><b>READY</b></div><div className="review-progress"><span>AI video provider</span><b className="blocked-text">CHƯA GỬI</b></div></div>
          <div className="shot-review-actions"><details className="preview-tools"><summary>Công cụ preview</summary><div className="preview-tools-buttons"><button type="button" className="secondary-button" onClick={() => setReviewPreview("composer")}>▶ Xem Composer</button></div></details></div>
          {reviewPreview === "composer" && <div className="shot-preview-box"><div className="shot-preview-box-heading"><span>SHOT COMPOSER PREVIEW</span><button type="button" onClick={() => setReviewPreview(null)}>×</button></div><div className="composer-preview-canvas"><span className="preview-grid-line line-a" /><span className="preview-grid-line line-b" /><span className="preview-object object-main" /><span className="preview-object object-small" /><span className="preview-camera">CAMERA · 35mm</span><small>Layout preview · camera / subject / depth</small></div></div>}
        </>; })() : <div className="shot-review-empty"><strong>Chọn một shot để review</strong><span>Prompt, camera, continuity và trạng thái pipeline sẽ hiển thị tại đây.</span></div>}
      </aside></div>

      {/* BƯỚC 3: XEM TRƯỚC VIDEO (VIDEO PREVIEW PLAYER) */}
      {localVideoReport && (
        <div style={{ background: "var(--panel-soft)", padding: "20px", borderRadius: "10px", border: "2px solid var(--cyan)", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ background: "#10b981", color: "#fff", fontWeight: 700, borderRadius: "50%", width: "24px", height: "24px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px" }}>✓</span>
            <strong style={{ fontSize: "16px", color: "#fff" }}>Video Đã Hoàn Thành! Bấm Play Để Xem</strong>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", alignItems: "center" }}>
            <div style={{ background: "#000", borderRadius: "8px", overflow: "hidden", aspectRatio: "16/9", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <video
                controls
                autoPlay
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
                src={topicMediaUrl(localVideoReport.videoPath)}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
              <div style={{ padding: "10px", background: "rgba(0,0,0,0.3)", borderRadius: "6px" }}>
                <span style={{ color: "var(--muted)", display: "block" }}>Tệp video:</span>
                <strong style={{ color: "var(--cyan)", wordBreak: "break-all" }}>{localVideoReport.videoPath}</strong>
              </div>
              <div style={{ padding: "10px", background: "rgba(0,0,0,0.3)", borderRadius: "6px" }}>
                <span style={{ color: "var(--muted)", display: "block" }}>Thời lượng:</span>
                <strong>{localVideoReport.durationSeconds ? `${localVideoReport.durationSeconds.toFixed(1)} giây` : "Chuẩn"}</strong>
              </div>
              <div style={{ padding: "10px", background: "rgba(0,0,0,0.3)", borderRadius: "6px" }}>
                <span style={{ color: "var(--muted)", display: "block" }}>Tệp âm thanh & phụ đề đính kèm:</span>
                <span style={{ fontSize: "12px", color: "var(--muted)" }}>{localVideoReport.audioPath} · {localVideoReport.captionsPath}</span>
              </div>
              <div style={{ display: "flex", gap: "10px", marginTop: "6px" }}>
                <a
                  href={topicMediaUrl(localVideoReport.videoPath)}
                  download="final-auto3dvideo.mp4"
                  className="primary-button"
                  style={{ textDecoration: "none", textAlign: "center", flex: 1, padding: "8px 12px", fontSize: "13px" }}
                >
                  📥 Tải Video MP4 Về Máy
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

type VideoVisionPanelProps = {
  projectId: string;
  loading: boolean;
  videoPath: string;
  outputPath: string;
  sampleFps: number;
  maxFrames: number;
  extractAudio: boolean;
  report: VideoVisionEvidenceReport | null;
  onVideoPathChange: (value: string) => void;
  onOutputPathChange: (value: string) => void;
  onSampleFpsChange: (value: number) => void;
  onMaxFramesChange: (value: number) => void;
  onExtractAudioChange: (value: boolean) => void;
  onChooseVideo: () => void;
  onAnalyze: () => void;
};

function VideoVisionPanel({ projectId, loading, videoPath, outputPath, sampleFps, maxFrames, extractAudio, report, onVideoPathChange, onOutputPathChange, onSampleFpsChange, onMaxFramesChange, onExtractAudioChange, onChooseVideo, onAnalyze }: VideoVisionPanelProps) {
  return <section className="panel page-panel video-vision-panel">
    <div className="section-heading"><div><p className="eyebrow accent">VIDEO VISION / LOCAL EVIDENCE</p><h3>Đọc cấu trúc video để lập shot plan</h3><p className="section-subtitle">FFprobe đọc metadata, FFmpeg lấy frame/audio, sau đó worker đo brightness, palette, edge density và cut heuristic. Không tải video từ social, không gọi VLM hoặc API.</p></div><span className="readiness-chip blocked">VLM CHƯA BẬT</span></div>
    <div className="video-vision-source-grid">
      <label>Video local<input value={videoPath} onChange={(event) => onVideoPathChange(event.target.value)} placeholder="assets/reference.mp4" /><button type="button" className="secondary-button compact-button" onClick={onChooseVideo}>Chọn video</button></label>
      <label>Evidence JSON output<input value={outputPath} onChange={(event) => onOutputPathChange(event.target.value)} placeholder="outputs/video-evidence/evidence.json" /><small className="field-hint">File mới trong workspace; không ghi đè evidence cũ.</small></label>
    </div>
    <div className="video-vision-controls">
      <label>Sample FPS<input type="number" min="0.1" max="2" step="0.1" value={sampleFps} onChange={(event) => onSampleFpsChange(Number(event.target.value))} /><small className="field-hint">0.1–2 frame/giây, tối đa 240 frame.</small></label>
      <label>Giới hạn frame<input type="number" min="1" max="240" step="1" value={maxFrames} onChange={(event) => onMaxFramesChange(Number(event.target.value))} /></label>
      <label className="approval-check"><input type="checkbox" checked={extractAudio} onChange={(event) => onExtractAudioChange(event.target.checked)} /> Trích audio WAV 16 kHz để handoff STT sau</label>
      <button className="primary-button" onClick={onAnalyze} disabled={!projectId || !videoPath.trim() || !outputPath.trim() || loading}>{loading ? "Đang đọc video…" : "Phân tích video local"}</button>
    </div>
    {!projectId && <div className="video-vision-empty"><strong>Chưa có project</strong><span>Hãy tạo hoặc chọn project trước; mọi input/output phải nằm trong workspace.</span></div>}
    {!report ? <div className="video-vision-empty"><strong>Chưa có evidence</strong><span>Bản đầu tiên là deterministic evidence: shot boundary heuristic và visual cues. Muốn có object/action/OCR/transcript cần adapter model riêng.</span></div> : <div className="video-vision-result">
      <div className="video-vision-stat-grid"><div><small>Shot</small><strong>{report.shotCount}</strong></div><div><small>Frame</small><strong>{report.frameCount}</strong></div><div><small>Thời lượng</small><strong>{report.durationSeconds.toFixed(2)}s</strong></div><div><small>Khung hình</small><strong>{report.width}×{report.height}</strong></div></div>
      <div className="video-vision-meta"><span>Evidence: <strong className="mono">{report.outputPath}</strong></span><span>SHA source: <strong className="mono">{report.sourceSha256.slice(0, 16)}…</strong></span><span>Audio: <strong>{report.audioPath ? "đã trích" : "không có / không chọn"}</strong></span><span>Status: <strong>{report.status}</strong></span></div>
      <p className="attempt-note">{report.message}</p>
      <div className="video-vision-capability-grid"><span className="status-text enabled">FFprobe ✓</span><span className="status-text enabled">Frame sampling ✓</span><span className="status-text enabled">Cut heuristic ✓</span><span className="status-text disabled">OCR chưa chạy</span><span className="status-text disabled">STT chưa chạy</span><span className="status-text disabled">Qwen3-VL chưa cấu hình</span></div>
      <details><summary>Handoff cho planner / adapter</summary><pre>{`Evidence path: ${report.outputPath}\nFrame dir: ${report.frameDir}\nNext: review shot ranges → optional Qwen3-VL adapter → shot-plan schema\nNetwork: ${report.networkCallsMade ? "có" : "không"} · Cost: ${report.costStatus}`}</pre></details>
    </div>}
    <div className="info-callout"><span className="notice-icon">i</span><span>Evidence này không nói video “đúng”, không xác nhận bản quyền và không tự sao chép video tham khảo. Reference social chỉ được dùng làm moodboard; input phải là file local mà bạn có quyền xử lý. Người dùng phải review trước khi planner hoặc generator dùng kết quả.</span></div>
  </section>;
}

type BrowserHandoffPanelProps = {
  projectId: string;
  loading: boolean;
  runtimeReport: BrowserMcpRuntimeReport | null;
  autoFlowReport: BrowserMcpRuntimeReport | null;
  onCheckSession: () => void;
  onOpenAutoFlow: () => void;
  onProbeRuntime: () => void;
};

function BrowserHandoffPanel({ projectId, loading, runtimeReport, autoFlowReport, onCheckSession, onOpenAutoFlow, onProbeRuntime }: BrowserHandoffPanelProps) {
  const attached = runtimeReport?.browserSessionAttached === true;
  const checked = Boolean(runtimeReport);
  useEffect(() => {
    if (projectId && !runtimeReport) onCheckSession();
    // Connection Center checks once when opened; the button handles explicit retries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  return <section className="panel page-panel browser-handoff-panel browser-connection-center">
    <div className="section-heading"><div><p className="eyebrow accent">BROWSEROS NEO / CONNECTION CENTER</p><h3>Kết nối BrowserOS neo một lần để dùng cho quy trình video</h3><p className="section-subtitle">Trang này chỉ quản lý kết nối BrowserOS MCP. Không chọn asset, không nhập prompt, không tạo handoff pack và không có bước duyệt upload ở đây.</p></div><span className={`readiness-chip ${attached ? "enabled" : checked ? "blocked" : "disabled"}`}>{attached ? "ĐÃ KẾT NỐI" : checked ? "CHƯA KẾT NỐI" : "CHƯA KIỂM TRA"}</span></div>
    <div className="browser-connection-card">
      <div className="browser-connection-card-copy"><span className="browser-connection-icon">◎</span><div><h4>BrowserOS neo / Google Flow</h4><p>{attached ? "BrowserOS neo đã thấy session/UI thật. Khi chạy quy trình video, app sẽ dùng BrowserOS MCP để đọc DOM, thao tác và xác nhận output theo từng shot." : "Mở Google Flow trong BrowserOS neo, đăng nhập bằng chính profile BrowserOS, rồi bấm kiểm tra bên dưới."}</p></div></div>
      <div className="browser-connection-actions">
        <button className="primary-button browser-connect-button" onClick={onOpenAutoFlow} disabled={loading}>{loading ? "Đang mở BrowserOS neo…" : "Mở BrowserOS neo + session"}</button>
        <button className="secondary-button browser-connect-button" onClick={onCheckSession} disabled={!projectId || loading}>{loading ? "Đang kiểm tra BrowserOS…" : attached ? "Kiểm tra lại kết nối" : "Kiểm tra kết nối BrowserOS"}</button>
      </div>
    </div>
    <div className="browser-connection-steps"><div><b>1</b><span>Bấm <strong>Mở BrowserOS neo + session</strong>; app dùng đúng profile BrowserOS và mở/đọc tab Flow task-owned.</span></div><div><b>2</b><span>Đăng nhập Google Flow trong cửa sổ BrowserOS neo nếu Flow đang ở trang <strong>/about</strong>.</span></div><div><b>3</b><span>Bấm <strong>Kiểm tra kết nối BrowserOS</strong>; app phải thấy snapshot/DOM thật trước khi chạy.</span></div><div><b>4</b><span>Vào Quy trình video và chạy; app khóa theo project/shot, không dùng tab Chrome khác.</span></div></div>
    {autoFlowReport && <div className={`browser-connection-result ${autoFlowReport.browserSessionAttached && autoFlowReport.status !== "blocked" ? "ready" : "blocked"}`}><div><strong>{autoFlowReport.browserSessionAttached && autoFlowReport.status !== "blocked" ? "BrowserOS session đã sẵn sàng" : "BrowserOS chưa sẵn sàng"}</strong><span>{autoFlowReport.message}</span></div><div className="browser-connection-meta"><span>Operation: <strong>{autoFlowReport.operation}</strong></span><span>Tools: <strong>{autoFlowReport.toolCount}</strong></span><span>Snapshot: <strong>{autoFlowReport.operationResult?.uiRefCount ?? 0} refs</strong></span></div></div>}
    {runtimeReport && <div className={`browser-connection-result ${attached ? "ready" : "blocked"}`}><div><strong>{attached ? "Kết nối hoạt động" : "Chưa thấy session BrowserOS"}</strong><span>{runtimeReport.message}</span></div><div className="browser-connection-meta"><span>Operation: <strong>{runtimeReport.operation}</strong></span><span>BrowserOS tools: <strong>{runtimeReport.toolCount}</strong></span><span>Network: <strong>{runtimeReport.networkCallsMade ? "đã kiểm tra tab" : "chưa gọi"}</strong></span></div></div>}
    <details className="browser-connection-help"><summary>Không cần bấm gì khác ở đây</summary><p>Asset, shot list, prompt chỉnh sửa, Blender render và bước tạo video nằm ở <strong>Quy trình video</strong>. Browser Handoff chỉ giữ vai trò cầu nối session. App không đọc cookie/token và không giả vờ upload/download nếu BrowserMCP chưa cung cấp công cụ tương ứng.</p><button className="secondary-button" onClick={onProbeRuntime} disabled={!projectId || loading}>Kiểm tra cài đặt BrowserMCP</button></details>
  </section>;
}

type SubtitleStudioPanelProps = {
  projectId: string;
  loading: boolean;
  videoPath: string;
  subtitlePath: string;
  outputPath: string;
  sourceLanguage: string;
  targetLanguage: string;
  format: "srt" | "vtt";
  document: SubtitleDocument | null;
  probe: SubtitleVideoProbeReport | null;
  report: SubtitleDocumentReport | null;
  burnInReport: SubtitleBurnInReport | null;
  onVideoPathChange: (value: string) => void;
  onSubtitlePathChange: (value: string) => void;
  onOutputPathChange: (value: string) => void;
  onSourceLanguageChange: (value: string) => void;
  onTargetLanguageChange: (value: string) => void;
  onFormatChange: (value: "srt" | "vtt") => void;
  onDocumentChange: (document: SubtitleDocument) => void;
  onChooseVideo: () => void;
  onChooseSubtitle: () => void;
  onProbe: () => void;
  onLoad: () => void;
  onSave: () => void;
  onBurnIn: () => void;
  onNotice: (message: string) => void;
};

function SubtitleStudioPanel({ projectId, loading, videoPath, subtitlePath, outputPath, sourceLanguage, targetLanguage, format, document, probe, report, burnInReport, onVideoPathChange, onSubtitlePathChange, onOutputPathChange, onSourceLanguageChange, onTargetLanguageChange, onFormatChange, onDocumentChange, onChooseVideo, onChooseSubtitle, onProbe, onLoad, onSave, onBurnIn, onNotice }: SubtitleStudioPanelProps) {
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const entries = document?.entries ?? [];
  const validation = useMemo(() => {
    const errors: string[] = [];
    const warnings: string[] = [];
    let maxCps = 0;
    entries.forEach((entry, index) => {
      if (entry.endSeconds <= entry.startSeconds) errors.push(`Dòng ${index + 1}: thời điểm kết thúc phải lớn hơn bắt đầu.`);
      if (index > 0 && entry.startSeconds < entries[index - 1].endSeconds - 0.001) errors.push(`Dòng ${index + 1}: bị chồng thời gian với dòng trước.`);
      if (document && entry.endSeconds > document.durationSeconds + 0.05) errors.push(`Dòng ${index + 1}: vượt thời lượng video.`);
      const cps = entry.text.replace(/\s/g, "").length / Math.max(entry.endSeconds - entry.startSeconds, 0.001);
      maxCps = Math.max(maxCps, cps);
      if (cps > 20) warnings.push(`Dòng ${index + 1}: tốc độ ${cps.toFixed(1)} ký tự/giây.`);
      if (!entry.text.includes("\n") && entry.text.length > 72) warnings.push(`Dòng ${index + 1}: quá dài trên một dòng.`);
    });
    return { errors, warnings, maxCps };
  }, [document, entries]);

  function changeDocument(entriesNext: SubtitleEntry[]) {
    if (document) onDocumentChange({ ...document, entries: entriesNext, reviewState: "draft", validation: { valid: validation.errors.length === 0, warnings: validation.warnings, maxCps: validation.maxCps } });
  }
  function updateEntry(index: number, patch: Partial<SubtitleEntry>) {
    changeDocument(entries.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...patch } : entry));
  }
  function addEntry() {
    const start = entries.length ? entries[entries.length - 1].endSeconds + 0.1 : 0;
    changeDocument([...entries, { entryId: `entry-${String(entries.length + 1).padStart(4, "0")}`, startSeconds: start, endSeconds: start + 2, text: "Nội dung mới" }]);
  }
  function deleteEntry(index: number) {
    changeDocument(entries.filter((_, entryIndex) => entryIndex !== index).map((entry, entryIndex) => ({ ...entry, entryId: `entry-${String(entryIndex + 1).padStart(4, "0")}` })));
  }
  function splitEntry(index: number) {
    const entry = entries[index];
    const words = entry.text.trim().split(/\s+/);
    if (words.length < 2 || entry.endSeconds - entry.startSeconds < 0.4) {
      onNotice("Không thể chia dòng này; cần ít nhất hai từ và khoảng thời gian đủ dài.");
      return;
    }
    const midpoint = Math.ceil(words.length / 2);
    const splitTime = entry.startSeconds + (entry.endSeconds - entry.startSeconds) / 2;
    const first = { ...entry, text: words.slice(0, midpoint).join(" "), endSeconds: splitTime };
    const second = { ...entry, entryId: `entry-${String(index + 2).padStart(4, "0")}`, text: words.slice(midpoint).join(" "), startSeconds: splitTime };
    changeDocument([...entries.slice(0, index), first, second, ...entries.slice(index + 1).map((item, itemIndex) => ({ ...item, entryId: `entry-${String(itemIndex + index + 3).padStart(4, "0")}` }))]);
  }
  function mergeEntry(index: number) {
    if (index >= entries.length - 1) return;
    const merged = { ...entries[index], endSeconds: entries[index + 1].endSeconds, text: `${entries[index].text.trim()} ${entries[index + 1].text.trim()}`.trim() };
    changeDocument([...entries.slice(0, index), merged, ...entries.slice(index + 2).map((item, itemIndex) => ({ ...item, entryId: `entry-${String(itemIndex + index + 2).padStart(4, "0")}` }))]);
  }
  function replaceAll() {
    if (!document || !findText) return;
    const next = entries.map((entry) => ({ ...entry, text: entry.text.split(findText).join(replaceText) }));
    changeDocument(next);
    onNotice(`Đã thay thế nội dung trong ${next.filter((entry, index) => entry.text !== entries[index].text).length} dòng.`);
  }

  return <section className="panel page-panel subtitle-studio-panel">
    <div className="section-heading"><div><p className="eyebrow accent">SUBTITLE STUDIO / EDITOR</p><h3>Biên tập phụ đề theo từng câu</h3><p className="section-subtitle">Nạp SRT/VTT, sửa text và timestamp, chia/gộp cue, tìm-thay thế, kiểm tra tốc độ đọc rồi xuất file mới hoặc burn-in vào bản sao video.</p></div><span className="count-chip">{entries.length} dòng</span></div>
    <div className="subtitle-source-grid">
      <label>Video local<input value={videoPath} onChange={(event) => onVideoPathChange(event.target.value)} placeholder="assets/source.mp4" /><button type="button" className="secondary-button compact-button" onClick={onChooseVideo}>Chọn video</button></label>
      <label>Phụ đề SRT/VTT<input value={subtitlePath} onChange={(event) => onSubtitlePathChange(event.target.value)} placeholder="assets/captions.srt" /><button type="button" className="secondary-button compact-button" onClick={onChooseSubtitle}>Chọn phụ đề</button></label>
      <label>Ngôn ngữ nguồn<select value={sourceLanguage} onChange={(event) => onSourceLanguageChange(event.target.value)}><option value="vi-VN">Tiếng Việt</option><option value="en-US">English</option><option value="zh-CN">中文</option><option value="und">Chưa xác định</option></select></label>
      <label>Ngôn ngữ đích<select value={targetLanguage} onChange={(event) => onTargetLanguageChange(event.target.value)}><option value="vi-VN">Tiếng Việt</option><option value="en-US">English</option><option value="zh-CN">中文</option><option value="ja-JP">日本語</option></select></label>
    </div>
    <div className="subtitle-action-row"><button className="secondary-button" onClick={onProbe} disabled={!projectId || !videoPath || loading}>{loading ? "Đang probe…" : "Probe video"}</button><button className="primary-button" onClick={onLoad} disabled={!projectId || !videoPath || !subtitlePath || loading}>{loading ? "Đang nạp…" : "Nạp vào editor"}</button>{probe && <span className="subtitle-probe-chip">{probe.videoCodec ?? "?"} · {probe.width ?? "?"}×{probe.height ?? "?"} · {probe.durationSeconds?.toFixed(2) ?? "?"} giây · audio {probe.audioPresent ? "có" : "không"}</span>}</div>
    {!document ? <div className="subtitle-empty"><strong>Chưa có document phụ đề</strong><span>Chọn video và file SRT/VTT rồi bấm Nạp vào editor. File gốc sẽ chỉ được đọc, không bị ghi đè.</span></div> : <>
      <div className="subtitle-toolbar"><div><label>Tìm<input value={findText} onChange={(event) => setFindText(event.target.value)} placeholder="từ hoặc câu cần tìm" /></label><label>Thay bằng<input value={replaceText} onChange={(event) => setReplaceText(event.target.value)} placeholder="nội dung mới" /></label><button className="secondary-button" onClick={replaceAll} disabled={!findText}>Thay tất cả</button></div><button className="secondary-button" onClick={addEntry}>+ Thêm dòng</button></div>
      <div className="subtitle-editor-meta"><span>Video: <strong className="mono">{document.sourceVideoPath}</strong></span><span>Thời lượng: <strong>{document.durationSeconds.toFixed(2)} giây</strong></span><span>Locale: <strong>{document.sourceLanguage} → {document.targetLanguage}</strong></span><span>Rights: <strong>{document.rightsStatus}</strong></span></div>
      <div className="subtitle-entry-list">{entries.map((entry, index) => <article className={`subtitle-entry-card ${validation.errors.some((error) => error.startsWith(`Dòng ${index + 1}:`)) ? "has-error" : ""}`} key={entry.entryId}><div className="subtitle-entry-head"><strong>#{index + 1}</strong><span className="mono">{entry.startSeconds.toFixed(3)}s → {entry.endSeconds.toFixed(3)}s</span><span className={`status-text ${validation.errors.some((error) => error.startsWith(`Dòng ${index + 1}:`)) ? "blocked" : "enabled"}`}>{validation.errors.some((error) => error.startsWith(`Dòng ${index + 1}:`)) ? "CẦN SỬA" : "HỢP LỆ"}</span></div><div className="subtitle-entry-grid"><label>Bắt đầu (giây)<input type="number" min="0" step="0.001" value={entry.startSeconds} onChange={(event) => updateEntry(index, { startSeconds: Number(event.target.value) })} /></label><label>Kết thúc (giây)<input type="number" min="0" step="0.001" value={entry.endSeconds} onChange={(event) => updateEntry(index, { endSeconds: Number(event.target.value) })} /></label><label className="subtitle-text-field">Nội dung<textarea rows={2} value={entry.text} onChange={(event) => updateEntry(index, { text: event.target.value })} /></label></div><div className="subtitle-entry-actions"><button className="small-button" onClick={() => splitEntry(index)}>Chia đôi</button><button className="small-button" onClick={() => mergeEntry(index)} disabled={index === entries.length - 1}>Gộp dòng sau</button><button className="small-button danger" onClick={() => deleteEntry(index)}>Xóa</button></div></article>)}</div>
      <div className="subtitle-validation-card"><div><strong>{validation.errors.length ? `${validation.errors.length} lỗi cần sửa` : "Không có lỗi timing chính"}</strong><span>{validation.warnings.length} cảnh báo · tốc độ cao nhất {validation.maxCps.toFixed(1)} ký tự/giây</span></div>{validation.errors.length > 0 && <p className="blocked-text">{validation.errors.slice(0, 4).join(" · ")}</p>}{validation.warnings.length > 0 && <p className="attempt-note">{validation.warnings.slice(0, 3).join(" · ")}</p>}</div>
      <div className="subtitle-export-grid"><label>Định dạng<select value={format} onChange={(event) => onFormatChange(event.target.value as "srt" | "vtt")}><option value="srt">SRT</option><option value="vtt">WebVTT</option></select></label><label className="subtitle-output-field">Đường dẫn xuất mới<input value={outputPath} onChange={(event) => onOutputPathChange(event.target.value)} /></label><button className="primary-button" onClick={onSave} disabled={loading || validation.errors.length > 0}>{loading ? "Đang xuất…" : "Xuất sidecar"}</button><button className="secondary-button" onClick={onBurnIn} disabled={loading || !subtitlePath || !videoPath}>{loading ? "Đang dựng…" : "Burn-in vào bản sao MP4"}</button></div>
      {report && <div className="preflight-result"><strong>Sidecar: {report.status}</strong><span>{report.outputPath ?? "-"} · {report.outputSizeBytes ?? 0} bytes · SHA {report.outputSha256?.slice(0, 16) ?? "-"}</span><small>{report.message}</small></div>}
      {burnInReport && <div className="preflight-result"><strong>Burn-in: {burnInReport.status}</strong><span>{burnInReport.outputPath} · {burnInReport.outputSizeBytes} bytes · SHA {burnInReport.outputSha256.slice(0, 16)}</span><small>{burnInReport.message}</small></div>}
      <div className="info-callout"><span className="notice-icon">i</span><span>Muốn dịch tự động, giữ bản nguồn riêng rồi chạy provider STT/LLM đã được cấu hình và duyệt. Tab này hiện tập trung vào biên tập deterministic, không tự gửi video ra mạng.</span></div>
    </>}
  </section>;
}

function RecipeCatalog({ recipes, selectedRecipe, onSelect, onRun, onQueuePending }: { recipes: Recipe[]; selectedRecipe: string; onSelect: (value: string) => void; onRun: (recipe: Recipe) => void; onQueuePending: (recipe: Recipe) => void }) {
  const current = recipes.find((recipe) => recipe.recipeKind === selectedRecipe) ?? recipes[0];
  return <section className="catalog-layout"><div className="panel catalog-list"><div className="section-heading"><div><p className="eyebrow">DANH MỤC QUY TRÌNH</p><h3>Định dạng video</h3></div><span className="count-chip">{recipes.length} quy trình</span></div><div className="recipe-list">{recipes.map((recipe) => <button key={recipe.recipeKind} className={`recipe-list-item ${selectedRecipe === recipe.recipeKind ? "selected" : ""}`} onClick={() => onSelect(recipe.recipeKind)}><span className="list-symbol">{recipe.recipeKind === "true_3d" ? "3D" : recipe.recipeKind === "html_to_video" ? "</>" : "01"}</span><span><strong>{recipe.name}</strong><small>{recipe.worker}</small></span><span className="chevron">→</span></button>)}</div></div><div className="panel recipe-detail"><p className="eyebrow">QUY TRÌNH ĐANG CHỌN</p><div className="detail-symbol">{current?.recipeKind === "true_3d" ? "3D" : "A3"}</div><h3>{current?.name}</h3><p className="detail-copy">Quy trình này đi qua luồng chuẩn hóa: kiểm tra tài sản và quyền → timeline → bộ xử lý chuyên biệt → âm thanh/phụ đề → xuất bằng FFmpeg → người dùng duyệt.</p><div className="detail-facts"><div><span>Bộ xử lý</span><strong>{current?.worker}</strong></div><div><span>Thực thi</span><strong>{current?.localFirst ? "Ưu tiên cục bộ" : "Kết hợp / đám mây"}</strong></div><div><span>Phê duyệt</span><strong>Người dùng duyệt</strong></div></div><button className="primary-button wide" onClick={() => current && onRun(current)}>Chạy bản xem trước mô phỏng <span>→</span></button><button className="secondary-button wide" onClick={() => current && onQueuePending(current)}>Tạo tác vụ chờ an toàn</button><p className="detail-note">Bản xem trước mô phỏng chỉ kiểm tra trạng thái; tác vụ chờ chỉ ghi nhận trạng thái để chuẩn bị attempt, không gọi API và không chạy Blender/FFmpeg thật.</p></div></section>;
}

function CommandCodeProbePanel({ report, testing, onTest }: { report: CommandCodeProbeReport | null; testing: boolean; onTest: () => void }) {
  return <div className="commandcode-panel"><div className="section-heading"><div><p className="eyebrow accent">KẾT NỐI MODEL / OMNIROUTE</p><h4>Kiểm tra Gemini 3.8 Flash Medium</h4><p className="section-subtitle">Bước kiểm tra cố định gửi một câu ngắn qua OmniRoute/9Router tới `ag/gemini-3.8-flash-medium`; không tạo video và không lưu nội dung vào project.</p></div><button className="primary-button" onClick={onTest} disabled={testing}>{testing ? "Đang kiểm tra…" : "Kiểm tra kết nối"}</button></div>{report ? <><div className="commandcode-meta"><span>Trạng thái: <strong>{displayCommandCodeStatus(report.status)}</strong></span><span>HTTP: <strong>{report.httpStatus ?? "-"}</strong></span><span>Mô hình: <strong>{report.model}</strong></span><span>Kết nối mạng: <strong>{report.networkCallsMade ? "đã gọi" : "chưa gọi"}</strong></span><span>Chi phí: <strong>{displayCommandCodeCost(report.costStatus)}</strong></span></div><p className="commandcode-message">{report.message}</p>{report.responseText && <details open><summary>Phản hồi từ mô hình</summary><pre>{report.responseText}</pre></details>}<p className="attempt-note">Số đơn vị: đầu vào {report.promptTokens ?? "-"} · đầu ra {report.completionTokens ?? "-"} · tổng {report.totalTokens ?? "-"}. Khóa chỉ được đọc bên trong bộ xử lý, không đi qua dòng lệnh hoặc nhật ký.</p></> : <p className="attempt-note">Chưa kiểm tra. Nút này chỉ kiểm tra route Director; không tạo video, không gọi giọng nói và không đăng bài.</p>}</div>;
}

function LlmRoutingPanel({ routing }: { routing: ProviderRoutingProfile[] }) {
  return <div className="llm-routing-panel"><div className="llm-routing-heading"><div><p className="eyebrow accent">LLM ROUTING / GỌI TUẦN TỰ</p><h4>Model nào làm việc gì</h4><p className="section-subtitle">Mỗi bước chỉ gọi đúng model của vai trò đó, không chạy bốn model song song. Director lập kế hoạch; Gemini kiểm tra và thao tác; Recovery chỉ bật khi có lỗi đủ nặng.</p></div><span className="status-text enabled">{routing.length} vai trò</span></div><div className="llm-routing-list">{routing.map((role) => <article className="llm-routing-card" key={role.roleId}><div className="routing-role"><strong>{role.label}</strong><small>{role.modelEnv}</small><span className={`status-text ${role.configured ? "enabled" : "disabled"}`}>{role.configured ? "ĐÃ GÁN" : "DÙNG MẶC ĐỊNH"}</span></div><div className="routing-model"><strong className="mono">{role.model}</strong><span>{role.responsibility}</span></div><div className="routing-detail"><div><small>Gọi khi</small><span>{role.trigger}</span></div><div><small>Input → output</small><span>{role.inputArtifact} → {role.outputArtifact}</span></div></div><div className="routing-source"><small>Nguồn</small><strong>{role.source}</strong></div></article>)}</div></div>;
}

function ProviderCatalog({ providers, envSnapshot, cloudGenerationEnabled, onToggleCloudGeneration, commandCodeReport, commandCodeTesting, onTestCommandCode, onAdded, onNotice }: { providers: ProviderProfile[]; envSnapshot: ProviderEnvSnapshot; cloudGenerationEnabled: boolean; onToggleCloudGeneration: () => void; commandCodeReport: CommandCodeProbeReport | null; commandCodeTesting: boolean; onTestCommandCode: () => void; onAdded: (provider: ProviderProfile) => void; onNotice: (message: string) => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [capability, setCapability] = useState("tts");
  const [provider, setProvider] = useState("custom-api");
  const [model, setModel] = useState("model-id");
  const [endpointRef, setEndpointRef] = useState("https://api.example.com/v1");
  const [credentialRef, setCredentialRef] = useState("env:CUSTOM_API_KEY");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function addProfile() {
    if (!capability.trim() || !provider.trim() || !model.trim() || !credentialRef.trim()) {
      setFormError("Hãy điền đủ capability, provider, model và credential reference.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const created = await invoke<ProviderProfile>("create_provider_profile", { capability, provider, model, endpointRef, credentialRef });
      onAdded(created);
      setShowAdd(false);
      onNotice(`Đã lưu profile ${created.profileId}; secret vẫn nằm ngoài database.`);
    } catch {
      setFormError("Không lưu được profile. Credential reference chỉ được là handle env/OS store, không phải secret.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="panel page-panel">
    <div className="section-heading"><div><p className="eyebrow">DANH MỤC NHÀ CUNG CẤP</p><h3>Hồ sơ mô hình & API</h3><p className="section-subtitle">Mỗi chức năng có thể chọn nhà cung cấp, bộ kết nối và mô hình riêng; thông tin bí mật chỉ hiện dưới dạng đã cấu hình/thiếu/bị từ chối.</p></div><button className="secondary-button" onClick={() => setShowAdd((current) => !current)}>{showAdd ? "Đóng biểu mẫu" : "+ Thêm hồ sơ"}</button></div>
    <div className="provider-env-summary"><div><strong>Cấu hình `.env` lúc chạy</strong><span>{envSnapshot.dotenvLoaded ? `Đã nạp ${envSnapshot.dotenvSource}` : "Chưa thấy .env; dùng biến môi trường/mặc định"}</span></div><span className={`status-text ${envSnapshot.dotenvLoaded ? "enabled" : "disabled"}`}>{envSnapshot.dotenvLoaded ? "ĐÃ NẠP" : "CHƯA NẠP"}</span></div>
    <div className="provider-policy-grid"><div><small>Chế độ chạy</small><strong>{envSnapshot.executionProfile}</strong></div><div><small>Nơi giữ bí mật</small><strong>{envSnapshot.secretBackend === "env" ? "Biến môi trường" : "Kho thông tin hệ điều hành"}</strong></div><div><small>Duyệt chi phí</small><strong>{envSnapshot.paidApprovalRequired ? "Bắt buộc" : "Theo chính sách review"}</strong></div><div><small>Gọi cloud</small><strong className={cloudGenerationEnabled ? "status-text enabled" : "status-text disabled"}>{cloudGenerationEnabled ? "ĐANG BẬT" : "ĐANG KHÓA"}</strong><button type="button" className={cloudGenerationEnabled ? "small-button danger" : "small-button"} onClick={onToggleCloudGeneration}>{cloudGenerationEnabled ? "Tắt Cloud/API" : "Bật Cloud/API"}</button></div></div>
    <LlmRoutingPanel routing={envSnapshot.routing} />
    <CommandCodeProbePanel report={commandCodeReport} testing={commandCodeTesting} onTest={onTestCommandCode} />
    {envSnapshot.warnings.length > 0 && <div className="info-callout"><span className="notice-icon">!</span><span>{envSnapshot.warnings.join(" · ")}</span></div>}
    <div className="provider-env-list"><div className="provider-head"><span>Hồ sơ biến môi trường</span><span>Chức năng / bộ kết nối</span><span>Mô hình</span><span>Điểm kết nối</span><span>Thông tin xác thực</span><span>Chính sách</span></div>{envSnapshot.profiles.map((profile) => <div className="provider-row" key={`env-${profile.profileId}`}><strong>{profile.profileId}</strong><span><b className="capability-chip">{displayCapability(profile.capability)}</b><small>{profile.adapter}</small></span><span className="mono">{profile.model}</span><span className="credential-ref">{profile.endpointConfigured ? "đã cấu hình" : "thiếu/không hợp lệ"}<small>{profile.endpointRef}</small></span><span className="credential-ref">{displayCredentialState(profile.credentialState)}<small>{profile.credentialRef}</small></span><span className={`status-text ${profile.enabled && profile.configured ? "enabled" : "disabled"}`}>{profile.enabled ? (profile.configured ? "SẴN SÀNG" : "ĐÃ BẬT / BỊ KHÓA") : "ĐÃ TẮT"}<small>{displayPricingMode(profile.pricingMode)} · chờ {profile.timeoutSeconds} giây · thử lại {profile.maxAttempts} lần</small></span></div>)}</div>
    {showAdd && <div className="provider-form"><div><label>Chức năng<select value={capability} onChange={(event) => setCapability(event.target.value)}><option value="llm">LLM / chat</option><option value="image">Hình ảnh</option><option value="video">Video</option><option value="tts">TTS / giọng nói</option><option value="stt">STT / phụ đề</option><option value="audio">Âm thanh / nhạc</option></select></label><label>Nhà cung cấp<input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="elevenlabs / custom-api" /></label></div><div><label>Mã mô hình<input value={model} onChange={(event) => setModel(event.target.value)} placeholder="model-name" /></label><label>Tham chiếu điểm kết nối<input value={endpointRef} onChange={(event) => setEndpointRef(event.target.value)} placeholder="https://api.example.com/v1" /></label><label>Tham chiếu thông tin xác thực<input value={credentialRef} onChange={(event) => setCredentialRef(event.target.value)} placeholder="env:PROVIDER_API_KEY" /></label></div><div className="form-actions"><span className="form-error">{formError}</span><button className="primary-button" onClick={() => void addProfile()} disabled={saving}>{saving ? "Đang lưu…" : "Lưu hồ sơ"}</button></div></div>}
    <div className="provider-table"><div className="provider-head"><span>Hồ sơ SQLite</span><span>Chức năng</span><span>Nhà cung cấp / mô hình</span><span>Điểm kết nối</span><span>Xác thực</span><span>Trạng thái</span></div>{providers.map((provider) => <div className="provider-row" key={provider.profileId}><strong>{provider.profileId}</strong><span className="capability-chip">{displayCapability(provider.capability)}</span><span>{provider.provider} <small>{provider.model}</small></span><span className="credential-ref">{provider.endpointRef}</span><span className="credential-ref">{provider.credentialRef}</span><span className={`status-text ${provider.configured ? "enabled" : "disabled"}`}>{provider.configured ? "Sẵn sàng" : "Cần cấu hình"}</span></div>)}</div>
    <div className="info-callout"><span className="notice-icon">i</span><span>`.env` chỉ dành cho phát triển và không được commit. Khi bật Cloud/API, app mới được phép gọi Nano Banana MCP và chuẩn bị Google Flow; có thể tiêu credit, nên review và duyệt Generate vẫn giữ nguyên.</span></div>
  </section>;
}

function JobsPanel({ jobs, projects, attempts, attemptOutputs, launchPlan, attemptJobId, attemptExecutableId, attemptOutputPath, attemptMediaKind, onAttemptExecutableChange, onAttemptOutputPathChange, onAttemptMediaKindChange, onAction, onInspect, onPrepareAttempt, onStartMockAttempt, onPreviewLaunch }: { jobs: Job[]; projects: Project[]; attempts: Attempt[]; attemptOutputs: AttemptOutput[]; launchPlan: WorkerLaunchPlan | null; attemptJobId: string; attemptExecutableId: ExecutableId | ""; attemptOutputPath: string; attemptMediaKind: MediaKind; onAttemptExecutableChange: (value: ExecutableId | "") => void; onAttemptOutputPathChange: (value: string) => void; onAttemptMediaKindChange: (value: MediaKind) => void; onAction: (action: JobAction, jobId: string) => void; onInspect: (jobId: string) => void; onPrepareAttempt: (jobId: string) => void; onStartMockAttempt: (attemptId: string, jobId: string) => void; onPreviewLaunch: (attemptId: string) => void }) {
  return <section className="panel page-panel"><div className="section-heading"><div><p className="eyebrow">LỊCH SỬ TÁC VỤ BỀN VỮNG</p><h3>Hàng đợi và lịch sử tác vụ</h3><p className="section-subtitle">Bộ xử lý mô phỏng cục bộ có lease/heartbeat/hủy; tác vụ FFmpeg dùng tham số cố định; bộ xử lý bên ngoài tổng quát vẫn bị khóa.</p></div><button className="secondary-button">Bộ lọc</button></div><div className="attempt-config"><div><p className="eyebrow">CẤU HÌNH LẦN CHẠY CHỜ</p><strong>Cấu hình bằng chứng trước khi chuẩn bị</strong><span>Chỉ ghi thông tin đầu ra dự kiến; không khởi chạy chương trình.</span></div><label>Chương trình<select value={attemptExecutableId} onChange={(event) => onAttemptExecutableChange(event.target.value as ExecutableId | "")}><option value="">Chưa chọn</option><option value="ffmpeg">FFmpeg</option><option value="ffprobe">FFprobe</option><option value="blender">Blender</option><option value="node">Node</option><option value="python">Python</option><option value="obs">OBS</option></select></label><label>Loại phương tiện<select value={attemptMediaKind} onChange={(event) => onAttemptMediaKindChange(event.target.value as MediaKind)}><option value="video">Video</option><option value="audio">Audio</option><option value="image">Image</option><option value="subtitle">Subtitle</option><option value="thumbnail">Thumbnail</option><option value="metadata">Metadata</option><option value="image_sequence">Image sequence</option></select></label><label>Đường dẫn đầu ra dự kiến<input value={attemptOutputPath} onChange={(event) => onAttemptOutputPathChange(event.target.value)} placeholder="preview.mp4" /></label></div>{jobs.length === 0 ? <EmptyState label="Hàng đợi đang trống" detail="Chạy một recipe từ mục Quy trình video để tạo mock job." /> : <div className="job-table"><div className="provider-head"><span>Mã tác vụ</span><span>Quy trình</span><span>Dự án</span><span>Trạng thái</span><span>Tiến độ</span></div>{jobs.map((job) => <div className="provider-row" key={job.jobId}><strong className="mono">{job.jobId}</strong><span>{job.kind}</span><span>{projects.find((project) => project.projectId === job.projectId)?.name ?? job.projectId}</span><span className="status-text enabled">{displayJobState(job.state)}</span><span><div className="progress-track"><i style={{ width: `${job.progress * 100}%` }} /></div>{Math.round(job.progress * 100)}% {job.state === "failed" && <button className="small-button" onClick={() => onAction("retry_job", job.jobId)}>Thử lại</button>}{["queued", "running", "cancel_requested"].includes(job.state) && <button className="small-button danger" onClick={() => onAction("cancel_job", job.jobId)}>Hủy</button>}<button className="small-button" onClick={() => onInspect(job.jobId)}>Lần chạy</button>{job.state === "queued" && <button className="small-button" onClick={() => onPrepareAttempt(job.jobId)}>Chuẩn bị lần chạy</button>}</span></div>)}</div>}
      {attemptJobId && <div className="attempt-panel"><div className="attempt-panel-heading"><div><p className="eyebrow">BẰNG CHỨNG THỰC THI</p><h4>Các lần chạy của {attemptJobId}</h4></div><span className="count-chip">{attempts.length}</span></div>{attempts.length === 0 ? <p className="attempt-empty">Chưa có lần chạy nào được lưu cho tác vụ này.</p> : <div className="attempt-list">{attempts.map((attempt) => <div className="attempt-row" key={attempt.attemptId}><strong className="mono">#{attempt.attemptNumber}</strong><span className="status-text enabled">{displayJobState(attempt.state)}</span><span>{attempt.executionMode === "in_process_mock" ? "bộ xử lý mô phỏng cục bộ" : (attempt.executableId ?? "chưa chọn chương trình")}</span><span>chờ tối đa {attempt.timeoutSeconds} giây</span><span>{attempt.processStarted ? (attempt.executionMode === "external_process" ? "Đã chạy chương trình bên ngoài" : "Đã chạy bộ xử lý mô phỏng") : "Chưa chạy chương trình"} · tác động ngoài chưa rõ: {attempt.externalSideEffectUnknown ? "có" : "không"} {attempt.state === "pending" && <button className="small-button" onClick={() => onStartMockAttempt(attempt.attemptId, attempt.jobId)}>Chạy bộ xử lý mô phỏng</button>}<button className="small-button" onClick={() => onPreviewLaunch(attempt.attemptId)}>Kế hoạch khởi chạy</button></span></div>)}</div>}{launchPlan && <div className="launch-plan"><div><strong>Worker launch plan · attempt #{launchPlan.attemptNumber}</strong><span>{launchPlan.executableId ?? "chưa chọn executable"} · {launchPlan.timeoutSeconds}s · {launchPlan.expectedOutputCount} expected outputs</span></div><b>{launchPlan.canStart ? "READY" : "BLOCKED"}</b><p>{launchPlan.blockers.join(" · ")}</p></div>}{attemptOutputs.length > 0 && <div className="attempt-output-list"><p className="eyebrow">ĐẦU RA DỰ KIẾN / LẦN CHẠY MỚI NHẤT</p>{attemptOutputs.map((output) => <div className="attempt-output-row" key={output.outputId}><span className="mono">{output.relativePath}</span><span>{output.mediaKind}</span><span className="status-text enabled">{output.validationState}</span></div>)}</div>}<p className="attempt-note">Bộ xử lý mô phỏng chạy trong ứng dụng để kiểm thử lease, heartbeat và hủy phối hợp. Tác vụ FFmpeg cố định là đường chạy bên ngoài duy nhất đang bật; Blender, ComfyUI và xử lý phương tiện của người dùng vẫn cần cổng an toàn tiếp theo.</p></div>}
    </section>;
}

function HelpPanel() {
  return <section className="help-layout"><div className="panel help-main"><p className="eyebrow">HƯỚNG DẪN TỪNG BƯỚC</p><h3>Dùng ứng dụng theo đúng thứ tự</h3><p className="help-lead">Auto3Dvideo Studio là bảng điều phối video ưu tiên cục bộ. Hãy bắt đầu từ mục tiêu video, sau đó kiểm tra quyền và chỉ chạy những bước có bằng chứng rõ ràng.</p><div className="help-flow"><HelpStep number="01" title="Tạo project" text="Bấm “+ Project mới”, nhập tên project và chọn workspace trên ổ D hoặc thư mục riêng của bạn." /><HelpStep number="02" title="Chọn quy trình video" text="Vào Quy trình video. Chọn HTML/React nếu làm infographic, ảnh/GIF nếu có asset riêng, lồng tiếng nếu có script, hoặc 3D nếu đã có Blender." /><HelpStep number="03" title="Kiểm tra trước khi chạy" text="Vào Quyền & review để kiểm tra chủ đề, continuity, entity, license, voice/likeness và AI disclosure." /><HelpStep number="04" title="Chạy thử an toàn" text="Dùng mock preview, queued job, dry-run hoặc fixture. Những nút này kiểm tra quy trình và bằng chứng, chưa phải tự động hóa production." /><HelpStep number="05" title="Xem bằng chứng" text="Vào Hàng đợi jobs để xem trạng thái, attempt, timeout và output. Vào Nhật ký cục bộ để đối chiếu lịch sử thao tác." /></div></div><div className="panel help-side"><p className="eyebrow">CHỌN THEO MỤC ĐÍCH</p><h3>Bạn muốn làm gì?</h3><div className="help-purpose"><strong>Video TikTok từ HTML</strong><span>Chọn Quy trình video → HTML / React thành video → kiểm tra tỷ lệ dọc và caption.</span></div><div className="help-purpose"><strong>Video từ ảnh hoặc GIF</strong><span>Chọn recipe ảnh; chỉ nhập asset bạn sở hữu hoặc có license rõ ràng.</span></div><div className="help-purpose"><strong>Video có giọng đọc</strong><span>Chuẩn bị script → chọn TTS profile → kiểm tra voice → tạo caption bằng STT.</span></div><div className="help-purpose"><strong>Video gameplay/demo</strong><span>Nhận file quay của bạn hoặc cấu hình OBS sau; không quay lộ tài khoản, tin nhắn hay dữ liệu riêng tư.</span></div><div className="help-purpose"><strong>Đăng lên nền tảng</strong><span>Hiện chưa bật OAuth và tự động đăng bài. Ứng dụng chỉ chuẩn bị gói bàn giao; người dùng phải duyệt và đăng thủ công.</span></div><div className="help-warning"><strong>Không được làm</strong><span>Không nhập API key vào dự án, không dùng cookie/mật khẩu để tự động đăng bài, không thu thập trái phép/tái đăng, không xóa watermark và không bật đăng bài chỉ bằng file `.env`.</span></div></div></section>;
}

function HelpStep({ number, title, text }: { number: string; title: string; text: string }) {
  return <article className="help-step"><span>{number}</span><div><h4>{title}</h4><p>{text}</p></div></article>;
}

function AuditPanel({ events, onRefresh }: { events: AuditEvent[]; onRefresh: () => void }) {
  return <section className="panel page-panel"><div className="section-heading"><div><p className="eyebrow">NHẬT KÝ THAO TÁC CỤC BỘ</p><h3>Sự kiện nhật ký</h3><p className="section-subtitle">Lịch sử thao tác cục bộ được đọc từ SQLite; dữ liệu bí mật không hiển thị ở đây.</p></div><button className="secondary-button" onClick={onRefresh}>Làm mới nhật ký</button></div>{events.length === 0 ? <EmptyState label="Chưa có sự kiện nhật ký" detail="Tạo dự án hoặc tác vụ cục bộ để sinh bằng chứng." /> : <div className="audit-list">{events.map((event) => <div className="audit-row" key={event.eventId}><span className="audit-time mono">{event.createdAt}</span><strong>{event.eventType}</strong><span>{event.subjectType ?? "hệ thống"} · {event.subjectId ?? "-"}</span><span className="audit-project">{event.projectId ?? "toàn cục"}</span></div>)}</div>}<p className="attempt-note">Nhật ký chỉ là bằng chứng cục bộ. Hiện chưa đồng bộ đám mây, chưa đăng bài và chưa có bộ xử lý bên ngoài tổng quát.</p></section>;
}

function ReviewPanel({ preview, onPreview }: { preview: NarrativeVisualPlanPreview | null; onPreview: () => void }) {
  return <section className="review-grid"><div className="panel review-main"><p className="eyebrow">DUYỆT HÌNH ẢNH THEO NỘI DUNG</p><div className="section-heading"><div><h3>{preview ? `Đã biên dịch ${preview.beats.length} nhịp cảnh` : "Chưa có bản xem trước kế hoạch hình ảnh"}</h3><p>{preview ? `${preview.planId} · ${preview.language} · ${preview.aspectRatio} · ${preview.totalDurationFrames} khung hình` : "Biên dịch fixture để kiểm tra độ phủ lời dẫn, tính liên tục của chủ thể, bằng chứng hình ảnh và prompt trước khi tạo."}</p></div><button className="secondary-button" onClick={onPreview}>{preview ? "Biên dịch lại" : "Biên dịch kế hoạch hình ảnh"}</button></div>{preview && <div className="visual-plan-list">{preview.beats.map((beat) => <article className="visual-plan-beat" key={beat.beatId}><div className="visual-plan-beat-head"><strong>{beat.beatId}</strong><span>{beat.startFrame}–{beat.endFrame}f · {beat.durationFrames}f</span><span className="status-text disabled">{beat.reviewDecision}</span></div><p className="visual-plan-narration">{beat.narrationText}</p><div className="visual-plan-grid"><div><small>Khẳng định nội dung</small><span>{beat.narrativeClaim}</span></div><div><small>Ý định hình ảnh</small><span>{beat.visualIntent}</span></div><div><small>Chủ thể / điểm neo</small><span>{beat.entities.map((entity) => `${entity.name}: ${entity.identityAnchors.join(" · ")}`).join(" | ")}</span></div><div><small>Bằng chứng hình ảnh</small><span>{beat.requiredVisualElements.join(" · ")}</span></div><div><small>Tài sản dự kiến</small><span className="mono">{beat.expectedAssetPath}</span></div><div><small>Trạng thái</small><span>{beat.candidateState} · semantic {beat.semanticState} · continuity {beat.continuityState} · rights {beat.rightsState}</span></div></div><details><summary>Xem prompt có căn cứ</summary><p><strong>Tích cực:</strong> {beat.positivePrompt}</p><p><strong>Loại trừ:</strong> {beat.negativePrompt}</p></details></article>)}</div>}<p className="attempt-note">{preview?.message ?? "Bản xem trước không khởi chạy chương trình: không tạo video, không gọi mạng, không đăng bài, không phát sinh chi phí."}</p></div><div className="panel checklist-panel"><p className="eyebrow">DANH SÁCH KIỂM TRA</p><CheckItem label="Quyền sở hữu / giấy phép tài sản" /><CheckItem label="Cho phép dùng giọng / diện mạo" /><CheckItem label="Quyết định công bố nội dung AI" /><CheckItem label="Phụ đề và khả năng tiếp cận" /><CheckItem label="Thiết lập bàn giao cho nền tảng" /><p className="attempt-note">Mỗi nhịp cảnh phải đạt mức liên quan nội dung và tính liên tục trước khi chọn phương án. Chữ chính xác nên thêm bằng lớp phủ cố định, không phụ thuộc ảnh AI.</p></div></section>;
}

function CheckItem({ label }: { label: string }) {
  return <div className="check-item"><span className="empty-check" />{label}<span className="pending-text">ĐANG CHỜ</span></div>;
}

function ToolReadinessPanel({ readiness, projectId, onNotice, onRefresh }: { readiness: ToolReadinessReport; projectId: string; onNotice: (message: string) => void; onRefresh: () => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingTool, setSavingTool] = useState("");
  const [probingTool, setProbingTool] = useState("");
  const [probeReports, setProbeReports] = useState<Record<string, LocalToolProbeReport>>({});
  const [preflight, setPreflight] = useState<WorkerPreflightReport | null>(null);
  const [checkingWorker, setCheckingWorker] = useState(false);

  useEffect(() => {
    setDrafts(Object.fromEntries(readiness.tools.map((tool) => [tool.toolId, tool.executableRef])));
  }, [readiness.tools]);

  async function runWorkerPreflight() {
    setCheckingWorker(true);
    try {
      const report = await invoke<WorkerPreflightReport>("worker_preflight");
      setPreflight(report);
      onNotice(report.readyToStart ? "Worker preflight đã sẵn sàng." : "Worker preflight bị chặn; chưa chạy process nào.");
    } catch {
      onNotice("Không đọc được worker preflight; Tauri backend chưa kết nối.");
    } finally {
      setCheckingWorker(false);
    }
  }

  async function probeTool(tool: ToolReadinessItem) {
    if (!projectId) {
      onNotice("Hãy tạo hoặc chọn project trước khi probe local tool.");
      return;
    }
    setProbingTool(tool.toolId);
    try {
      const report = await invoke<LocalToolProbeReport>("probe_local_tool", { projectId, toolId: tool.toolId });
      setProbeReports((current) => ({ ...current, [tool.toolId]: report }));
      onNotice(`${tool.toolId}: ${report.status}; processStarted=${String(report.processStarted)}.`);
    } catch {
      onNotice(`Không probe được ${tool.toolId}; kiểm tra executable reference và tool readiness.`);
    } finally {
      setProbingTool("");
    }
  }

  async function saveTool(tool: ToolReadinessItem) {
    const executableRef = (drafts[tool.toolId] ?? "").trim();
    if (!executableRef) {
      onNotice("Executable reference không được để trống.");
      return;
    }
    setSavingTool(tool.toolId);
    try {
      await invoke<ToolReadinessItem>("save_tool_config", { toolId: tool.toolId, executableRef, required: tool.required });
      onNotice(`Đã lưu reference cho ${tool.toolId}; chỉ kiểm tra metadata, chưa chạy binary.`);
      onRefresh();
    } catch {
      onNotice("Không lưu được tool reference; chỉ dùng path hoặc tên binary allowlist, không nhập command string.");
    } finally {
      setSavingTool("");
    }
  }

  return <div className="tool-readiness"><div className="section-heading"><div><strong>Kiểm tra mức sẵn sàng của công cụ cục bộ</strong><span>Phần này chỉ đọc thông tin; nút Kiểm tra mới chạy lệnh phiên bản cục bộ, còn tình trạng mạng được kiểm tra riêng.</span></div><span className={`readiness-chip ${readiness.status === "ready" ? "ready" : "blocked"}`}>{readiness.status}</span></div><div className="worker-gate"><span>Thực thi bộ xử lý</span><strong>{readiness.workerExecutionEnabled ? "ĐÃ BẬT" : "ĐANG KHÓA"}</strong><small>{readiness.workerGate}</small><button className="small-button" onClick={() => void runWorkerPreflight()} disabled={checkingWorker}>{checkingWorker ? "Đang kiểm tra…" : "Kiểm tra trước"}</button></div>{preflight && <div className="preflight-result"><strong>Kiểm tra trước bộ xử lý: {preflight.readyToStart ? "SẴN SÀNG" : "ĐANG KHÓA"}</strong><span>{preflight.blockers.join(" · ")}</span><small>{preflight.checks.join(" · ")}</small></div>}{readiness.tools.length === 0 ? <p className="attempt-empty">Thông tin sẵn sàng chỉ có khi ứng dụng Tauri đã kết nối.</p> : <div className="tool-list">{readiness.tools.map((tool) => <div className="tool-row" key={tool.toolId}><div><strong>{tool.toolId}</strong><small>{tool.required ? "bắt buộc" : "tùy chọn"} · {tool.status}</small>{probeReports[tool.toolId] && <small>{probeReports[tool.toolId].status} · {probeReports[tool.toolId].version.split(/\r?\n/)[0]}</small>}</div><input value={drafts[tool.toolId] ?? ""} onChange={(event) => setDrafts((current) => ({ ...current, [tool.toolId]: event.target.value }))} placeholder={tool.toolId === "python" ? "python.exe" : "C:\\Tools\\...\\binary.exe"} /><button className="small-button" onClick={() => void saveTool(tool)} disabled={savingTool === tool.toolId}>{savingTool === tool.toolId ? "Đang lưu…" : "Lưu cấu hình"}</button>{["blender", "ffmpeg", "ffprobe", "python", "yt-dlp", "obscura"].includes(tool.toolId) && <button className="small-button" onClick={() => void probeTool(tool)} disabled={!projectId || probingTool === tool.toolId}>{probingTool === tool.toolId ? "Đang kiểm tra…" : "Kiểm tra"}</button>}</div>)}</div>}<p className="attempt-note">Obscura là tùy chọn cho quét public nhanh; app tự nhận bản local đã build hoặc path bạn lưu, không dùng stealth/proxy để né CAPTCHA hay giới hạn nền tảng. Công cụ bắt buộc còn thiếu: {readiness.requiredMissing.length ? readiness.requiredMissing.join(", ") : "không có"}. Đã chạy chương trình: {String(readiness.externalProcessesStarted)} · đã kiểm tra mạng: {String(readiness.networkProbePerformed)}.</p></div>;
}

function encodePcm16Wav(samples: Float32Array, sampleRate: number): number[] {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return Array.from(new Uint8Array(buffer));
}

async function mediaBlobToWavBytes(blob: Blob): Promise<number[]> {
  const audioContextWindow = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const audioContextConstructor = audioContextWindow.AudioContext ?? audioContextWindow.webkitAudioContext;
  if (!audioContextConstructor) throw new Error("WebView không hỗ trợ giải mã audio để tạo WAV");
  const audioContext = new audioContextConstructor();
  try {
    const source = await audioContext.decodeAudioData(await blob.arrayBuffer());
    const mono = new Float32Array(source.length);
    for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
      const samples = source.getChannelData(channel);
      for (let index = 0; index < source.length; index += 1) mono[index] += samples[index] / source.numberOfChannels;
    }
    const targetSampleRate = 24000;
    const targetLength = Math.max(1, Math.round(mono.length * targetSampleRate / source.sampleRate));
    const resampled = new Float32Array(targetLength);
    const ratio = source.sampleRate / targetSampleRate;
    for (let index = 0; index < targetLength; index += 1) {
      const position = index * ratio;
      const left = Math.floor(position);
      const right = Math.min(left + 1, mono.length - 1);
      const fraction = position - left;
      resampled[index] = mono[left] * (1 - fraction) + mono[right] * fraction;
    }
    return encodePcm16Wav(resampled, targetSampleRate);
  } finally {
    await audioContext.close();
  }
}

type OmniVoiceStudioPanelProps = {
  projectId: string;
  profiles: VoiceProfile[];
  samples: VoiceSample[];
  readiness: OmniVoiceReadinessReport;
  report: OmniVoiceTtsReport | null;
  loading: boolean;
  settings: VoiceSettings;
  onSettingsChange: (settings: VoiceSettings) => void;
  onCheck: (projectId: string) => void;
  onPrepareModel: (projectId: string) => void;
  onChooseReference: () => Promise<string | null>;
  onNotice: (message: string) => void;
  onCreate: (input: { name: string; mode: "clone" | "design"; language: string; instruct: string; sourceAudioPath?: string; referenceTranscript?: string; cloneConsent: boolean }) => void;
  onUpdate: (input: { voiceProfileId: string; name: string; language: string; instruct: string; referenceTranscript?: string; cloneConsent: boolean }) => void;
  onDelete: (profile: VoiceProfile) => void;
  onSynthesize: (input: { voiceProfileId: string; text: string; language: string; speed: number; durationSeconds?: number; qualityPreset: "preview" | "balanced" | "quality"; classTemperature: number; positionTemperature: number; normalizeText: boolean; emotionCode?: VoiceEmotion }) => void;
};

function OmniVoiceStudioPanel({ projectId, profiles, samples, readiness, report, loading, settings, onSettingsChange, onCheck, onPrepareModel, onChooseReference, onNotice, onCreate, onUpdate, onDelete, onSynthesize }: OmniVoiceStudioPanelProps) {
  const [mode, setMode] = useState<"clone" | "design">("design");
  const [selectedId, setSelectedId] = useState(settings.voiceProfileId ?? profiles[0]?.voiceProfileId ?? "");
  const selected = profiles.find((profile) => profile.voiceProfileId === selectedId) ?? null;
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en");
  const [instruct, setInstruct] = useState("male, middle-aged, low pitch, british accent");
  const [sourceAudioPath, setSourceAudioPath] = useState("");
  const [referenceTranscript, setReferenceTranscript] = useState("");
  const [cloneConsent, setCloneConsent] = useState(false);
  const [text, setText] = useState("Welcome to Auto3Dvideo. This is a local OmniVoice preview for an international documentary narrator.");
  const [emotionCode, setEmotionCode] = useState<VoiceEmotion>(settings.emotionCodeBySegment?.["default"] ?? "neutral");
  const [speed, setSpeed] = useState(1);
  const [durationSeconds, setDurationSeconds] = useState("");
  const [qualityPreset, setQualityPreset] = useState<"preview" | "balanced" | "quality">("preview");
  const [classTemperature, setClassTemperature] = useState(0);
  const [positionTemperature, setPositionTemperature] = useState(5);
  const [normalizeText, setNormalizeText] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSavingRecording, setIsSavingRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordingSecondsRef = useRef(0);
  const [recordingAudioUrl, setRecordingAudioUrl] = useState<string | null>(null);
  const [recordingMessage, setRecordingMessage] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!selectedId && profiles[0]) setSelectedId(profiles[0].voiceProfileId);
    if (selectedId && !profiles.some((profile) => profile.voiceProfileId === selectedId)) setSelectedId(profiles[0]?.voiceProfileId ?? "");
  }, [profiles, selectedId]);

  useEffect(() => {
    if (!selected) return;
    setMode(selected.mode);
    setName(selected.name);
    setLanguage(selected.language);
    setInstruct(selected.instruct ?? "");
    setSourceAudioPath(selected.referenceAudioPath ?? "");
    setReferenceTranscript(selected.referenceTranscript ?? "");
    setCloneConsent(selected.cloneConsent);
    onSettingsChange({ ...settings, voiceProfileId: selected.voiceProfileId, presetVoice: selected.name, mode: selected.mode, language: selected.language, instruct: selected.instruct ?? "", cloneEnabled: selected.mode === "clone", cloneConsent: selected.cloneConsent, referenceAudioPath: selected.referenceAudioPath ?? undefined });
  }, [selected?.voiceProfileId]);

  useEffect(() => {
    if (!report?.outputPath) return;
    const isTauri = typeof window !== "undefined" && Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
    if (!isTauri) return;
    void invoke<string>("read_project_audio_base64", { projectId, relativePath: report.outputPath })
      .then((base64) => setAudioUrl(`data:audio/wav;base64,${base64}`))
      .catch(() => setAudioUrl(null));
  }, [report?.outputPath, projectId]);

  useEffect(() => () => {
    if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current);
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const statusLabel = readiness.status === "ready" ? "SẴN SÀNG" : readiness.status === "model_missing" ? "CẦN CÀI MODEL" : readiness.status === "missing_package" ? "CẦN CÀI PACKAGE" : readiness.status.toUpperCase();
  const canSynthesize = Boolean(projectId && selected?.status === "ready" && readiness.status === "ready" && text.trim() && !loading);

  function selectProfile(profile: VoiceProfile) {
    setSelectedId(profile.voiceProfileId);
    setAudioUrl(null);
  }

  function startNewProfile(nextMode: "clone" | "design") {
    setMode(nextMode);
    setSelectedId("");
    setName(nextMode === "clone" ? "My narrator clone" : "Documentary narrator");
    setLanguage(nextMode === "clone" ? "en" : "en");
    setInstruct(nextMode === "clone" ? "" : "male, middle-aged, low pitch, british accent");
    setSourceAudioPath(nextMode === "clone" ? samples[0]?.relativePath ?? "" : "");
    setReferenceTranscript(nextMode === "clone" ? samples[0]?.transcript ?? "" : "");
    setCloneConsent(false);
    setAudioUrl(null);
    setRecordingAudioUrl(null);
    setRecordingMessage(nextMode === "clone" && samples[0] ? `Đã chọn bản ghi có sẵn: ${samples[0].fileName}. Transcript đã được nạp; hãy kiểm tra trước khi tạo.` : null);
  }

  function selectExistingVoiceSample(sample: VoiceSample) {
    setMode("clone");
    setSelectedId("");
    setName("My narrator clone");
    setLanguage("vi");
    setSourceAudioPath(sample.relativePath);
    setReferenceTranscript(sample.transcript ?? "");
    setRecordingAudioUrl(null);
    setRecordingMessage(sample.transcript ? `Đã chọn ${sample.fileName}. Transcript đã nạp tự động; hãy nghe và kiểm tra.` : `Đã chọn ${sample.fileName}. Hãy nhập transcript chính xác.`);
    onNotice(`Đã chọn file voice mẫu: ${sample.relativePath}. ${sample.transcript ? "Transcript đã nạp; " : "Cần nhập transcript; "}chưa tạo profile và vẫn cần xác nhận quyền.`);
  }

  async function startMicrophoneRecording() {
    if (isRecording || isSavingRecording || loading) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      const message = "Thiết bị này không hỗ trợ thu microphone trong WebView.";
      setRecordingMessage(message);
      onNotice(message);
      return;
    }
    onNotice("Đang xin quyền microphone… Hãy nói tự nhiên khoảng 5–10 giây rồi bấm Dừng thu.");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      const supportedMime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((mime) => MediaRecorder.isTypeSupported(mime));
      const recorder = supportedMime
        ? new MediaRecorder(stream, { mimeType: supportedMime, audioBitsPerSecond: 128000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 128000 });
      recordingStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];
      setRecordingAudioUrl(null);
      setRecordingMessage("Đang thu microphone…");
      recordingSecondsRef.current = 0;
      setRecordingSeconds(0);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        void (async () => {
          stream.getTracks().forEach((track) => track.stop());
          recordingStreamRef.current = null;
          const recordedBlob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" });
          setRecordingAudioUrl(URL.createObjectURL(recordedBlob));
          if (recordingSecondsRef.current < 3) {
            const message = "Bản ghi quá ngắn. Hãy thu ít nhất 3 giây, tốt nhất 5–10 giây để clone ổn định.";
            setRecordingMessage(message);
            onNotice(message);
            return;
          }
          setIsSavingRecording(true);
          setRecordingMessage("Đang chuyển bản ghi sang WAV 24 kHz và lưu vào workspace…");
          onNotice("[1/2] Đang chuyển bản ghi microphone sang WAV chuẩn OmniVoice…");
          try {
            const dataBytes = await mediaBlobToWavBytes(recordedBlob);
            const relativePath = `.auto3dvideo/voice-recordings/mic-${Date.now()}.wav`;
            const savedPath = await invoke<string>("save_recorded_audio_for_project", { projectId, relativePath, dataBytes });
            setSourceAudioPath(savedPath);
            setCloneConsent(false);
            setRecordingMessage("Đã lưu bản ghi. Nghe lại, nhập transcript chính xác rồi xác nhận quyền clone.");
            onNotice("[2/2] Đã lưu bản ghi WAV vào workspace. Còn 2 việc: nhập transcript và xác nhận quyền sử dụng.");
          } catch (error) {
            const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi không xác định";
            setRecordingMessage(`Không lưu được bản ghi: ${detail.slice(0, 260)}`);
            onNotice(`Thu âm thất bại: ${detail.slice(0, 320)}`);
          } finally {
            setIsSavingRecording(false);
          }
        })();
      };
      recorder.start(250);
      setIsRecording(true);
      recordingTimerRef.current = window.setInterval(() => {
        recordingSecondsRef.current += 1;
        setRecordingSeconds(recordingSecondsRef.current);
      }, 1000);
    } catch (error) {
      const detail = error instanceof DOMException && error.name === "NotAllowedError"
        ? "Windows/Chrome chưa cấp quyền microphone cho app. Hãy bật quyền Microphone rồi thử lại."
        : `Không mở được microphone: ${error instanceof Error ? error.message : "lỗi không xác định"}`;
      setRecordingMessage(detail);
      onNotice(detail);
    }
  }

  function stopMicrophoneRecording() {
    if (!mediaRecorderRef.current || !isRecording) return;
    mediaRecorderRef.current.stop();
    setIsRecording(false);
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    onNotice("Đã dừng thu; đang kiểm tra và lưu bản ghi…");
  }

  return <section className="omnivoice-studio">
    <div className="panel omnivoice-header">
      <div><p className="eyebrow accent">VOICE STUDIO / OMNIVOICE LOCAL</p><h2>Giọng đọc cho video quốc tế</h2><p className="section-subtitle">Tạo clone từ file bạn có quyền sử dụng hoặc thiết kế giọng bằng prompt. Profile, audio mẫu và preview được lưu trong data workspace; synthesis không cần API key.</p></div>
      <div className={`omnivoice-status ${readiness.status === "ready" ? "ready" : "blocked"}`}><strong>{statusLabel}</strong><span>{readiness.device} · {readiness.modelCachePresent ? "model đã có" : "model chưa có"}</span></div>
    </div>

    <div className="panel omnivoice-actions-bar"><div><strong>Trạng thái thật</strong><span>{readiness.message}</span><small>Model: {readiness.modelId} · tokenizer: {readiness.audioTokenizerId} · network: {readiness.networkCallsMade ? "đã dùng để cài model" : "không gọi"}</small></div><div className="omnivoice-action-buttons"><button className="secondary-button" onClick={() => onCheck(projectId)} disabled={!projectId || loading}>{loading ? "Đang kiểm tra…" : "Kiểm tra local"}</button><button className="primary-button" onClick={() => onPrepareModel(projectId)} disabled={!projectId || loading || readiness.status === "ready"}>{loading ? "Đang cài…" : "Cài model OmniVoice"}</button></div></div>

    <div className="omnivoice-layout">
      <aside className="panel omnivoice-library"><div className="section-heading"><div><p className="eyebrow">LOCAL VOICE LIBRARY</p><h3>Profile & preset local</h3></div><span className="count-chip">{profiles.length}</span></div><div className="omnivoice-mode-buttons"><button className={mode === "clone" && !selected ? "active" : ""} onClick={() => startNewProfile("clone")} disabled={loading}>+ Clone voice</button><button className={mode === "design" && !selected ? "active" : ""} onClick={() => startNewProfile("design")} disabled={loading}>+ Voice design</button></div>{profiles.length === 0 ? <div className="omnivoice-empty">Chưa có profile. App sẽ nạp preset local khi mở lại project.</div> : <div className="omnivoice-profile-list">{profiles.map((profile) => <button type="button" key={profile.voiceProfileId} className={`omnivoice-profile-card ${selectedId === profile.voiceProfileId ? "selected" : ""}`} onClick={() => selectProfile(profile)}><span className={`voice-profile-dot ${profile.status === "ready" ? "ready" : "blocked"}`} /><span><strong>{profile.name}</strong><small>{profile.mode === "clone" ? "Clone" : "Design"} · {profile.language} · {profile.status}{profile.voiceProfileId.startsWith("voice-en-") || profile.voiceProfileId.startsWith("voice-vi-") ? " · Preset local" : ""}</small></span></button>)}</div>}<div className="omnivoice-rights-note"><strong>Quyền model</strong><span>Preset mặc định là voice design, không phải giọng người thật. Code Apache-2.0; pretrained model OmniVoice CC-BY-NC, cần kiểm tra quyền trước khi thương mại hoá.</span></div></aside>

      <div className="omnivoice-main">
      <div className="panel omnivoice-editor">
        <div className="section-heading"><div><p className="eyebrow">PROFILE EDITOR</p><h3>{selected ? `Chỉnh “${selected.name}”` : mode === "clone" ? "Tạo clone voice" : "Tạo voice design"}</h3></div><span className="readiness-chip">{selected?.status ?? "DRAFT"}</span></div>
        <div className="omnivoice-editor-grid"><label>Tên profile<input value={name} onChange={(event) => setName(event.target.value)} placeholder="International documentary narrator" /></label><label>Ngôn ngữ chính<select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="en">English</option><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option><option value="vi">Vietnamese</option><option value="ja">Japanese</option><option value="ko">Korean</option><option value="zh">Chinese</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option></select></label></div>
        {mode === "design" ? <><label>Voice design tokens<textarea rows={5} value={instruct} onChange={(event) => setInstruct(event.target.value)} placeholder="English: male, middle-aged, low pitch, british accent" /><small className="field-help">Dùng token model hỗ trợ, phân tách bằng dấu phẩy. English: male, female, age, pitch, accent.</small></label><div className="omnivoice-preset-row"><span>Preset nhanh:</span>{["male, middle-aged, low pitch, british accent", "female, young adult, moderate pitch, american accent", "male, elderly, very low pitch, australian accent"].map((preset) => <button type="button" key={preset} onClick={() => setInstruct(preset)} disabled={loading}>{preset}</button>)}</div></> : <>
          <div className="omnivoice-file-row"><label>Audio mẫu đã chọn<input value={sourceAudioPath || selected?.referenceAudioPath || ""} readOnly placeholder="Chưa chọn file audio" /></label><button className="secondary-button" onClick={async () => { const chosen = await onChooseReference(); if (chosen) { setSourceAudioPath(chosen); setRecordingAudioUrl(null); setRecordingMessage("Đã chọn file audio; hãy nhập transcript chính xác."); } }} disabled={loading || isSavingRecording}>Chọn file ngoài</button></div>
          {!selected && samples.length > 0 && <div className="omnivoice-local-samples"><div className="omnivoice-local-samples-heading"><div><strong>Kho voice mẫu local</strong><small>{samples.length} WAV · mẫu có transcript sẽ tự nạp khi chọn</small></div><span>LOCAL</span></div><div className="omnivoice-local-sample-list">{samples.map((sample) => <button type="button" className={`omnivoice-local-sample ${sourceAudioPath === sample.relativePath ? "selected" : ""}`} key={sample.relativePath} onClick={() => selectExistingVoiceSample(sample)} disabled={loading || isSavingRecording}><span><strong>{sample.fileName}</strong><small>{sample.sourceKind === "recording" ? "Bản ghi microphone" : sample.sourceDataset ? `${sample.sourceDataset} · ${sample.license ?? "license chưa ghi"}` : "Audio mẫu"} · {sample.durationSeconds ? `${sample.durationSeconds.toFixed(1)}s` : "WAV"} · {Math.round(sample.sizeBytes / 1024)} KB</small></span><b>{sourceAudioPath === sample.relativePath ? "Đang chọn" : "Dùng bản này"}</b></button>)}</div></div>}
          {!selected && <div className="omnivoice-mic-panel"><div><strong>Hoặc thu trực tiếp bằng microphone</strong><small>Nói rõ 5–10 giây. App chuyển bản ghi thành WAV 24 kHz và giữ toàn bộ xử lý local.</small></div><button type="button" className="secondary-button" onClick={isRecording ? stopMicrophoneRecording : () => void startMicrophoneRecording()} disabled={!projectId || loading || isSavingRecording}>{isRecording ? `⏹ Dừng thu (${recordingSeconds}s)` : isSavingRecording ? "Đang lưu bản ghi…" : "🎙 Thu bằng mic"}</button></div>}
          {recordingAudioUrl && <div className="omnivoice-recording-preview"><span>Nghe lại bản ghi microphone</span><audio controls preload="metadata" src={recordingAudioUrl} /></div>}
          {recordingMessage && <p className="attempt-note">{recordingMessage}</p>}
          <label>Transcript chính xác của audio<textarea rows={4} value={referenceTranscript} onChange={(event) => setReferenceTranscript(event.target.value)} placeholder="Gõ đúng từng câu bạn vừa nói trong audio mẫu để clone ổn định." /></label><label className="omnivoice-consent"><input type="checkbox" checked={cloneConsent} onChange={(event) => setCloneConsent(event.target.checked)} /> Tôi có quyền sử dụng file này và đồng ý tạo clone giọng cho dự án local.</label>
        </>}
        {selected ? <div className="omnivoice-editor-actions"><button className="primary-button" onClick={() => onUpdate({ voiceProfileId: selected.voiceProfileId, name, language, instruct, referenceTranscript, cloneConsent })} disabled={loading || !name.trim()}>{loading ? "Đang lưu…" : "Lưu thay đổi"}</button><button className="danger-button" onClick={() => onDelete(selected)} disabled={loading}>Xoá profile</button></div> : <button className="primary-button" onClick={() => onCreate({ name, mode, language, instruct, sourceAudioPath: sourceAudioPath || undefined, referenceTranscript: referenceTranscript || undefined, cloneConsent })} disabled={loading || !projectId || !name.trim() || (mode === "design" ? !instruct.trim() : !sourceAudioPath || !referenceTranscript.trim())}>{loading ? "Đang tạo…" : mode === "clone" ? "Tạo clone profile" : "Tạo voice design"}</button>} {!projectId && <p className="attempt-note">Hãy tạo hoặc chọn project trước khi lưu profile.</p>}
      </div>

        <div className="panel omnivoice-test"><div className="section-heading"><div><p className="eyebrow">TEST WORKSPACE</p><h3>Nghe thử và tinh chỉnh</h3><p className="section-subtitle">Mỗi lần thử tạo một WAV mới, không ghi đè. Kết quả chỉ là preview cần người nghe duyệt.</p></div><span className="readiness-chip">{selected ? selected.name : "Chưa chọn profile"}</span></div><label>Văn bản thử<textarea rows={5} value={text} onChange={(event) => setText(event.target.value)} placeholder="Nhập câu bằng ngôn ngữ bạn muốn test…" /></label><label>Mã cảm xúc mặc định<select value={emotionCode} onChange={(event) => { const next = event.target.value as VoiceEmotion; setEmotionCode(next); onSettingsChange({ ...settings, emotionCodeBySegment: { ...(settings.emotionCodeBySegment ?? {}), default: next } }); }}>{VOICE_EMOTION_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.code.toUpperCase()} — {option.label} ({option.hint})</option>)}</select></label><p className="attempt-note">Có thể chèn trực tiếp <code>[EXCITED]</code>, <code>[SHOUTING]</code>, <code>[SAD]</code>… trong văn bản. Worker sẽ tách từng đoạn, không đọc thành tiếng mã tag; OmniVoice hiện áp dụng cue fallback an toàn.</p><div className="omnivoice-controls"><label>Language<input value={language} onChange={(event) => setLanguage(event.target.value)} /></label><label>Tốc độ <strong>{speed.toFixed(2)}×</strong><input type="range" min="0.5" max="2" step="0.05" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /></label><label>Ép thời lượng (tuỳ chọn)<input type="number" min="0.5" max="600" step="0.5" value={durationSeconds} onChange={(event) => setDurationSeconds(event.target.value)} placeholder="Tự nhiên" /></label><label>Quality<select value={qualityPreset} onChange={(event) => setQualityPreset(event.target.value as "preview" | "balanced" | "quality")}><option value="preview">Preview nhanh</option><option value="balanced">Balanced</option><option value="quality">Quality</option></select></label><label>Class temp <strong>{classTemperature.toFixed(2)}</strong><input type="range" min="0" max="2" step="0.05" value={classTemperature} onChange={(event) => setClassTemperature(Number(event.target.value))} /></label><label>Position temp <strong>{positionTemperature.toFixed(2)}</strong><input type="range" min="0" max="10" step="0.1" value={positionTemperature} onChange={(event) => setPositionTemperature(Number(event.target.value))} /></label></div><label className="omnivoice-consent"><input type="checkbox" checked={normalizeText} onChange={(event) => setNormalizeText(event.target.checked)} /> Chuẩn hoá text trước khi đọc</label><button className="primary-button omnivoice-synthesize-button" onClick={() => onSynthesize({ voiceProfileId: selectedId, text, language, speed, durationSeconds: durationSeconds ? Number(durationSeconds) : undefined, qualityPreset, classTemperature, positionTemperature, normalizeText, emotionCode })} disabled={!canSynthesize}>{loading ? "Đang chạy OmniVoice…" : "Tạo preview WAV"}</button>{readiness.status !== "ready" && <p className="attempt-note">Chưa thể test: hãy bấm “Kiểm tra local”, sau đó “Cài model OmniVoice”. Synthesis không tự tải model.</p>}{selected?.status !== "ready" && selected && <p className="attempt-note">Profile này chưa ready vì quyền clone chưa đủ; lưu checkbox quyền sử dụng trước khi chạy.</p>}{report && <div className="omnivoice-result"><strong>{report.status === "succeeded" ? "Preview đã tạo — cần review" : "Preview thất bại"}</strong><span>{report.outputPath} · {(report.sizeBytes / 1024).toFixed(0)} KB · {report.language} · {report.device}</span><small>{report.message} · process exit={String(report.process.exitCode ?? "—")} · outputValidated={String(report.outputValidated)}{report.emotionCodesUsed?.length ? ` · emotion=${report.emotionCodesUsed.join(", ")}` : ""}</small>{audioUrl && <audio controls autoPlay src={audioUrl} />}</div>}</div>
      </div>
    </div>
  </section>;
}

function VoiceStudioPanel({ report, loading, settings, onSettingsChange }: { report: VieneuTtsReport | null; loading: boolean; settings: VoiceSettings; onSettingsChange: (settings: VoiceSettings) => void }) {
  const [text, setText] = useState("Xin chào! Đây là bản thử giọng nói tự động cho đồ án Auto3Dvideo.");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Microphone recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const [recordedAudioNotice, setRecordedAudioNotice] = useState<string | null>(null);

  // Tự động load audio base64 khi report xuất hiện để người dùng nghe được ngay 1-chạm
  useEffect(() => {
    if (report && report.outputPath) {
      void (async () => {
        const isTauri = typeof window !== "undefined" && Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
        if (!isTauri) return;
        try {
          const b64 = await invoke<string>("read_workspace_audio_base64", { relativePath: report.outputPath });
          setAudioUrl(`data:audio/wav;base64,${b64}`);
        } catch {
          // fallback
        }
      })();
    }
  }, [report]);

  function patchSettings(patch: Partial<VoiceSettings>) {
    onSettingsChange({ ...settings, ...patch });
  }

  // Thu âm trực tiếp từ microphone
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1,
        },
      });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 128000 });
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(recordedChunksRef.current, { type: "audio/wav" });
        const arrayBuffer = await audioBlob.arrayBuffer();
        const uint8Array = Array.from(new Uint8Array(arrayBuffer));
        const timestamp = Date.now();
        const relPath = `.auto3dvideo/voice-samples/my-voice-${timestamp}.wav`;

        const isTauri = typeof window !== "undefined" && Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
        try {
          if (isTauri) {
            await invoke<string>("save_recorded_audio", {
              relativePath: relPath,
              dataBytes: uint8Array,
            });
          } else {
            // Lưu trực tiếp qua backend middleware của Vite khi mở bằng trình duyệt
            const base64Data = btoa(
              new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
            );
            await fetch("/api/save-audio", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ relPath, data: base64Data }),
            });
          }
          patchSettings({
            referenceAudioPath: relPath,
            cloneEnabled: true,
            cloneConsent: true,
          });
          setRecordedAudioNotice(`Đã lưu mẫu giọng (${(uint8Array.length / 1024).toFixed(0)} KB) và tự động kích hoạt Voice Clone!`);
        } catch (err) {
          setRecordedAudioNotice(`Lỗi lưu âm thanh: ${String(err)}`);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      timerRef.current = window.setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      alert("Không thể truy cập Microphone. Vui lòng cấp quyền micro trong cài đặt hệ thống Windows!");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }

  return (
    <section style={{ maxWidth: "800px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "20px" }}>
      <div className="panel" style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "20px" }}>
        <div>
          <h2 style={{ fontSize: "22px", margin: "0 0 6px 0", color: "#fff" }}>🎙️ Cài Đặt Giọng Đọc Video</h2>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "14px" }}>
            Chọn giọng đọc tiếng Việt hoặc thu âm 5 giây giọng của bạn để AI tự nhân bản (clone).
          </p>
        </div>

        {/* 1. Chọn chế độ giọng */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          {/* Card giọng có sẵn */}
          <div
            onClick={() => {
              patchSettings({ referenceAudioPath: "", cloneEnabled: false, cloneConsent: false });
              setRecordedAudioNotice(null);
            }}
            style={{
              cursor: "pointer",
              padding: "16px",
              borderRadius: "10px",
              border: !settings.referenceAudioPath ? "2px solid var(--cyan)" : "1px solid var(--border)",
              background: !settings.referenceAudioPath ? "rgba(143,232,218,0.06)" : "var(--panel-soft)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <input type="radio" checked={!settings.referenceAudioPath} readOnly />
              <strong style={{ fontSize: "15px" }}>Giọng mẫu có sẵn</strong>
            </div>
            <select
              value={settings.presetVoice}
              disabled={Boolean(settings.referenceAudioPath)}
              onChange={(e) => patchSettings({ presetVoice: e.target.value })}
              style={{ width: "100%", padding: "10px", borderRadius: "6px", background: "#161b22", color: "#fff", border: "1px solid var(--border)", fontSize: "14px" }}
            >
              <optgroup label="Giọng Nam">
                <option value="Phạm Tuyên">Phạm Tuyên — Nam · Giọng Bắc · Truyền cảm, tự nhiên</option>
                <option value="Minh Đức">Minh Đức — Nam · Giọng Bắc · Tin tức, thời sự</option>
                <option value="Thanh Bình">Thanh Bình — Nam · Giọng Bắc · Kể chuyện, sâu lắng</option>
                <option value="Thái Sơn">Thái Sơn — Nam · Giọng Nam · Kể chuyện, review phim</option>
                <option value="Xuân Vĩnh">Xuân Vĩnh — Nam · Giọng Nam · Tự nhiên, đời thường</option>
                <option value="Minh Triết">Minh Triết — Nam · Giọng Nam · Tin tức, thuyết trình</option>
                <option value="Adam">Adam — Nam · Giọng Nam · Trầm ấm</option>
                <option value="Quang Sơn">Quang Sơn — Nam · Giọng Trung · Chân thực, mộc mạc</option>
                <option value="Đức Trí">Đức Trí — Nam · Giọng Nam · Đọc truyện đêm khuya</option>
              </optgroup>
              <optgroup label="Giọng Nữ">
                <option value="Trúc Ly">Trúc Ly — Nữ · Giọng Bắc · Tự nhiên, nhẹ nhàng</option>
                <option value="Ngọc Linh">Ngọc Linh — Nữ · Giọng Bắc · Kể chuyện, truyền cảm</option>
                <option value="Đoan Trang">Đoan Trang — Nữ · Giọng Bắc · Trong trẻo</option>
                <option value="Mai Anh">Mai Anh — Nữ · Giọng Bắc · Thời sự, phát thanh</option>
                <option value="Thục Đoan">Thục Đoan — Nữ · Giọng Nam · Kể chuyện nhẹ nhàng</option>
                <option value="Thùy Dung">Thùy Dung — Nữ · Giọng Nam · Tin tức năng động</option>
                <option value="Ngọc Trân">Ngọc Trân — Nữ · Giọng Trung · Dịu dàng</option>
                <option value="Mỹ Duyên">Mỹ Duyên — Nữ · Giọng Nam · Đọc truyện tình cảm</option>
                <option value="Quỳnh Anh">Quỳnh Anh — Nữ · Giọng Bắc · Đọc truyện</option>
                <option value="Kim Thanh">Kim Thanh — Nữ · Giọng Nam · Đọc truyện, radio</option>
              </optgroup>
            </select>
          </div>

          {/* Card thu âm Clone giọng */}
          <div
            style={{
              padding: "16px",
              borderRadius: "10px",
              border: settings.referenceAudioPath ? "2px solid var(--cyan)" : "1px solid var(--border)",
              background: settings.referenceAudioPath ? "rgba(143,232,218,0.06)" : "var(--panel-soft)",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <input type="radio" checked={Boolean(settings.referenceAudioPath)} readOnly />
                <strong style={{ fontSize: "15px" }}>Thu âm giọng bạn (Clone)</strong>
              </div>
              <p style={{ margin: "0 0 10px 0", fontSize: "12px", color: "var(--muted)" }}>
                Nói vào mic 5-10s, AI sẽ đọc theo đúng chất giọng của bạn.
              </p>
            </div>

            {!settings.referenceAudioPath ? (
              !isRecording ? (
                <button
                  type="button"
                  className="primary-button"
                  style={{ background: "#e11d48", borderColor: "#e11d48", padding: "10px", width: "100%" }}
                  onClick={() => void startRecording()}
                >
                  🔴 Bấm để Thu âm (5s-10s)
                </button>
              ) : (
                <button
                  type="button"
                  className="primary-button"
                  style={{ background: "#f59e0b", borderColor: "#f59e0b", padding: "10px", width: "100%", animation: "pulse 1.5s infinite" }}
                  onClick={stopRecording}
                >
                  ⏹️ Dừng thu ({recordingDuration}s)
                </button>
              )
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(239,68,68,0.1)", padding: "8px 12px", borderRadius: "6px", border: "1px solid rgba(239,68,68,0.3)" }}>
                <span style={{ fontSize: "13px", color: "var(--cyan)", fontWeight: 500 }}>✓ Đã có giọng thu</span>
                <button
                  type="button"
                  onClick={() => {
                    patchSettings({ referenceAudioPath: "", cloneEnabled: false, cloneConsent: false });
                    setRecordedAudioNotice(null);
                    setAudioUrl(null);
                  }}
                  style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: "4px", padding: "4px 10px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
                >
                  🗑️ Xóa thu lại
                </button>
              </div>
            )}
          </div>
        </div>

        {recordedAudioNotice && (
          <div style={{ padding: "10px 14px", background: "rgba(143,232,218,0.1)", borderRadius: "6px", color: "var(--cyan)", fontSize: "13px" }}>
            ✓ {recordedAudioNotice}
          </div>
        )}

        {/* 2. Tinh chỉnh Cảm xúc & Biểu cảm */}
        <div style={{ background: "var(--panel-soft)", padding: "16px 20px", borderRadius: "10px", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 600, fontSize: "14px" }}>🎭 Cảm xúc & Mức độ diễn cảm (Temperature):</span>
            <span style={{ color: "var(--cyan)", fontWeight: 700, fontSize: "14px" }}>{settings.temperature.toFixed(2)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "12px", color: "var(--muted)" }}>Nghiêm túc, chuẩn chỉ (0.6)</span>
            <input
              type="range"
              min="0.6"
              max="1.2"
              step="0.05"
              value={settings.temperature}
              onChange={(e) => patchSettings({ temperature: parseFloat(e.target.value) })}
              style={{ flex: 1, cursor: "pointer", accentColor: "var(--cyan)" }}
            />
            <span style={{ fontSize: "12px", color: "var(--muted)" }}>Tự nhiên, giàu cảm xúc (1.2)</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginTop: "4px" }}>
            {[
              { id: "none", label: "Tiêu chuẩn", icon: "🎙️", desc: "Đọc tự nhiên" },
              { id: "laugh", label: "Hào hứng / Cười", icon: "😄", desc: "Vui vẻ, năng động" },
              { id: "sigh", label: "Trầm lắng / Thở dài", icon: "😌", desc: "Sâu lắng, cảm xúc" },
              { id: "clear_throat", label: "Trịnh trọng", icon: "🧐", desc: "Hắng giọng mở đầu" },
            ].map((cue) => {
              const active = (settings.voiceCueBySegment?.["default"] || "none") === cue.id;
              return (
                <button
                  key={cue.id}
                  type="button"
                  onClick={() =>
                    patchSettings({
                      voiceCueBySegment: { ...(settings.voiceCueBySegment || {}), default: cue.id as VoiceCue },
                    })
                  }
                  style={{
                    padding: "10px 8px",
                    borderRadius: "8px",
                    border: active ? "2px solid var(--cyan)" : "1px solid var(--border)",
                    background: active ? "rgba(143,232,218,0.12)" : "rgba(0,0,0,0.2)",
                    color: active ? "#fff" : "var(--muted)",
                    cursor: "pointer",
                    textAlign: "center",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <span style={{ fontSize: "18px" }}>{cue.icon}</span>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: active ? "var(--cyan)" : "#fff" }}>{cue.label}</span>
                  <span style={{ fontSize: "11px", opacity: 0.8 }}>{cue.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Nghe thử ngay */}
        <div style={{ background: "rgba(0,0,0,0.25)", padding: "18px", borderRadius: "10px", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "12px" }}>
          <label style={{ fontWeight: 600, fontSize: "14px" }}>Câu văn nghe thử:</label>
          <div style={{ display: "flex", gap: "10px" }}>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Nhập câu bạn muốn nghe thử..."
              style={{ flex: 1, padding: "10px 14px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--panel-soft)", color: "var(--text)", fontSize: "14px" }}
            />
            <button
              className="primary-button"
              style={{ minWidth: "150px", fontSize: "14px" }}
              disabled={loading || isGenerating || !text.trim()}
              onClick={async () => {
                setIsGenerating(true);
                setAudioUrl(null);
                try {
                  const res = await fetch("/api/tts", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      text,
                      voice: settings.presetVoice,
                      referenceAudioPath: settings.referenceAudioPath,
                      temperature: settings.temperature,
                      voiceCue: settings.voiceCueBySegment?.["default"] || "none",
                    }),
                  });
                  const data = await res.json();
                  if (data.success && data.audioUrl) {
                    setAudioUrl(data.audioUrl);
                  } else {
                    alert("Lỗi tạo giọng: " + (data.error || "Không xác định"));
                  }
                } catch (err) {
                  alert("Không thể kết nối API TTS: " + String(err));
                } finally {
                  setIsGenerating(false);
                }
              }}
            >
              {isGenerating ? "Đang xử lý…" : "🔊 Nghe thử"}
            </button>
          </div>

          {audioUrl && (
            <div style={{ marginTop: "6px", display: "flex", alignItems: "center", gap: "12px" }}>
              <span style={{ fontSize: "13px", color: "var(--cyan)", fontWeight: 600 }}>Audio:</span>
              <audio controls autoPlay src={audioUrl} style={{ flex: 1, height: "36px" }} />
            </div>
          )}
        </div>

        {/* Thông báo trạng thái áp dụng */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "var(--muted)", fontSize: "13px", borderTop: "1px solid var(--border)", paddingTop: "14px" }}>
          <span>
            Đang áp dụng: <strong style={{ color: "#fff" }}>{settings.referenceAudioPath ? "Giọng bạn (Clone)" : settings.presetVoice}</strong>
          </span>
          <span style={{ color: "var(--cyan)" }}>✓ Tự động lưu cho toàn bộ video</span>
        </div>
      </div>
    </section>
  );
}

function VieneuPanel({ readiness, report, projectId, loading, onCheck, onRun }: { readiness: VieneuReadinessReport; report: VieneuTtsReport | null; projectId: string; loading: boolean; onCheck: (projectId: string) => void; onRun: (projectId: string, text: string, voice: string, outputPath: string, referenceAudioPath: string, temperature: number, cloneConsent: boolean) => void }) {
  const [text, setText] = useState("Xin chào, đây là bản thử giọng VieNeu cho Auto3Dvideo.");
  const [voice, setVoice] = useState("Phạm Tuyên");
  const [outputPath, setOutputPath] = useState(".auto3dvideo/tts/vieneu-preview.wav");
  const [referenceAudioPath, setReferenceAudioPath] = useState("");
  const [temperature, setTemperature] = useState(0.8);
  const [cloneConsent, setCloneConsent] = useState(false);
  const canRun = Boolean(projectId) && readiness.status === "ready" && readiness.packageInstalled && !loading && (!referenceAudioPath.trim() || cloneConsent);
  return <div className="panel vieneu-panel"><div className="section-heading"><div><p className="eyebrow">TTS LOCAL / VIENEUTTS</p><h3>Thử giọng VieNeu trên máy</h3><p className="section-subtitle">Chạy CPU/ONNX, không cần API key. Chế độ kiểm tra không tải model; synthesis chỉ dùng model đã có trong cache cục bộ.</p></div><span className={`readiness-chip ${readiness.status === "ready" ? "ready" : "blocked"}`}>{readiness.status}</span></div><div className="vieneu-summary"><div><small>Model</small><strong>{readiness.modelId}</strong></div><div><small>Backend</small><strong>{readiness.backend}</strong></div><div><small>Package</small><strong>{readiness.packageInstalled ? (readiness.packageVersion ?? "đã cài") : "chưa cài"}</strong></div><div><small>Cache model</small><strong>{readiness.modelCachePresent ? "đã thấy" : "chưa thấy"}</strong></div></div><div className="vieneu-actions"><button className="secondary-button" onClick={() => onCheck(projectId)} disabled={!projectId || loading}>Kiểm tra VieNeu</button><span>{readiness.message}</span></div><div className="vieneu-form"><label>Văn bản thử<textarea value={text} onChange={(event) => setText(event.target.value)} rows={3} /></label><label>Voice preset<input value={voice} onChange={(event) => setVoice(event.target.value)} placeholder="Phạm Tuyên" /></label><label>Đường dẫn WAV tương đối<input value={outputPath} onChange={(event) => setOutputPath(event.target.value)} placeholder=".auto3dvideo/tts/vieneu-preview.wav" /></label><label>Nhiệt độ / độ biến thiên<input type="number" min="0.6" max="1.2" step="0.05" value={temperature} onChange={(event) => setTemperature(Number(event.target.value))} /></label><label>Audio mẫu để clone, tùy chọn<input value={referenceAudioPath} onChange={(event) => { setReferenceAudioPath(event.target.value); if (!event.target.value.trim()) setCloneConsent(false); }} placeholder="references/my-voice.wav" /></label>{referenceAudioPath.trim() && <label className="approval-check"><input type="checkbox" checked={cloneConsent} onChange={(event) => setCloneConsent(event.target.checked)} /> Tôi có quyền sử dụng audio này và đồng ý dùng cho clone local.</label>}</div><button className="primary-button" onClick={() => onRun(projectId, text, voice, outputPath, referenceAudioPath, temperature, cloneConsent)} disabled={!canRun || !text.trim() || !outputPath.trim()}>{loading ? "Đang xử lý…" : "Tạo WAV local"}</button>{!projectId && <p className="attempt-note">Hãy tạo hoặc chọn project trước.</p>}{readiness.status !== "ready" && <p className="attempt-note">Cần cài package `vieneu` và model VieNeu vào cache local trước khi tạo audio. Ứng dụng không tự tải model và không tự gọi mạng.</p>}{report && <div className="preflight-result"><strong>Audio VieNeu: ĐẠT, cần review</strong><span>{report.outputPath} · {report.sizeBytes} bytes · voice {report.voice} · temperature {report.temperature.toFixed(2)} · {report.referenceAudioUsed ? "clone reference đã dùng" : "preset voice"}</span><small>{report.message} · exitCode={String(report.process.exitCode ?? "—")} · outputValidated={String(report.outputValidated)}</small></div>}<p className="attempt-note">Chỉ dùng giọng preset hoặc audio mẫu mà bạn có quyền sử dụng. Không dùng clone để giả mạo người khác; trước delivery vẫn phải nghe, duyệt chất lượng, quyền và công bố AI.</p></div>;
}

function SettingsPanel({ health, readiness, loading, projectId, fixtureReport, blenderFixtureReport, true3dFixtureReport, true3dMultishotFixtureReport, assetPipelineCheckReport, onRunFfmpegFixture, onRunFfmpegFixtureAttempt, onRunBlenderFixture, onRunTrue3dFixture, onRunTrue3dMultishotFixture, onRunAssetPipelineCheck, onNotice, onRefresh }: { health: HealthStatus; readiness: ToolReadinessReport; loading: boolean; projectId: string; fixtureReport: LocalMediaFixtureReport | null; blenderFixtureReport: LocalBlenderFixtureReport | null; true3dFixtureReport: True3dFixtureReport | null; true3dMultishotFixtureReport: True3dMultishotFixtureReport | null; assetPipelineCheckReport: AssetPipelineCheckReport | null; onRunFfmpegFixture: (projectId: string) => void; onRunFfmpegFixtureAttempt: (projectId: string) => void; onRunBlenderFixture: (projectId: string) => void; onRunTrue3dFixture: (projectId: string, renderVideo: boolean) => void; onRunTrue3dMultishotFixture: (projectId: string, renderVideo: boolean, rerunShotId?: string) => void; onRunAssetPipelineCheck: (projectId: string) => void; onNotice: (message: string) => void; onRefresh: () => void }) {
  const [processPlan, setProcessPlan] = useState<ProcessDryRunPlan | null>(null);
  const [comfyEndpoint, setComfyEndpoint] = useState("http://127.0.0.1:8188");
  const [comfyHealth, setComfyHealth] = useState<ComfyUiHealthReport | null>(null);
  const [checkingComfy, setCheckingComfy] = useState(false);
  const [rerunShotId, setRerunShotId] = useState("");
  const databaseReady = health.database === "ready";
  const publishBlocked = health.publishPolicy === "blocked_by_default";
  const blenderReady = readiness.tools.some((tool) => tool.toolId === "blender" && tool.status === "ready");
  const ffmpegReady = readiness.tools.some((tool) => tool.toolId === "ffmpeg" && tool.status === "ready");

  async function checkComfyUi() {
    setCheckingComfy(true);
    try {
      const report = await invoke<ComfyUiHealthReport>("check_comfyui_health", { endpoint: comfyEndpoint });
      setComfyHealth(report);
      onNotice(`ComfyUI: ${report.status}; chưa submit workflow.`);
    } catch {
      onNotice("Không kiểm tra được ComfyUI endpoint; chỉ dùng loopback http://127.0.0.1:port.");
    } finally {
      setCheckingComfy(false);
    }
  }

  async function previewProcess() {
    try {
      const plan = await invoke<ProcessDryRunPlan>("preview_process", {
        spec: {
          executableId: "ffmpeg",
          args: ["-version"],
          workingDirectory: "jobs/dry-run-preview",
          environment: {},
          timeoutSeconds: 60,
          expectedOutputs: ["preview.mp4"],
        },
      });
      setProcessPlan(plan);
      onNotice("Process plan hợp lệ; chưa spawn process và chưa ghi output.");
    } catch {
      onNotice("Native dry-run chưa sẵn sàng; cần mở bằng Tauri sau khi cài MSVC.");
    }
  }

  return <section className="settings-grid"><div className="panel settings-main"><p className="eyebrow">CẤU HÌNH CỤC BỘ</p><h3>Cấu hình môi trường chạy</h3><div className="setting-row"><div><strong>Ngôn ngữ</strong><span>Ngôn ngữ mặc định của dự án và giao diện</span></div><b>Tiếng Việt (vi-VN)</b></div><div className="setting-row"><div><strong>Tiếng Anh</strong><span>Bộ dịch English đầy đủ sẽ được bật sau khi hoàn thiện toàn bộ chuỗi giao diện</span></div><b className="blocked-text">CHƯA BẬT</b></div><div className="setting-row"><div><strong>Chế độ thực thi</strong><span>Fixture FFmpeg chỉ chạy tham số cố định; bộ xử lý tổng quát vẫn bị khóa</span></div><b>FIXTURE + MÔ PHỎNG</b></div><div className="setting-row"><div><strong>Đăng bài</strong><span>Chưa có bộ kết nối đăng bài; cần người dùng duyệt trước khi bàn giao</span></div><b className="blocked-text">{publishBlocked ? "ĐANG KHÓA" : health.publishPolicy}</b></div><div className="setting-row"><div><strong>Sức khỏe môi trường chạy</strong><span>Cơ sở dữ liệu: {health.database}; công cụ: {health.externalTools}</span></div><b className={databaseReady ? "enabled-text" : "blocked-text"}>{databaseReady ? "SẴN SÀNG" : "CẦN KIỂM TRA"}</b></div><div className="setting-row"><div><strong>Chi phí đám mây</strong><span>Chưa gọi API trả phí; chưa có số tiền phát sinh trong trạng thái hiện tại</span></div><b>0 USD</b></div><div className="info-callout settings-policy-note"><span className="notice-icon">i</span><span>Chính sách hiện tại: không gọi đám mây, không chạy bộ xử lý bên ngoài tổng quát, không đọc thông tin bí mật và không tự đăng bài; chỉ có fixture FFmpeg với tham số cố định. Quyền, giọng/diện mạo, công bố AI và riêng tư vẫn cần người dùng duyệt.</span></div><div className="process-preview"><div><strong>Xem trước an toàn chương trình</strong><span>Kiểm tra danh sách cho phép, đường dẫn tương đối, thời gian chờ và ranh giới bí mật mà không chạy chương trình.</span></div><button className="secondary-button" onClick={() => void previewProcess()}>Mô phỏng FFmpeg</button>{processPlan && <code>{processPlan.allowlistedBinaryName} · args={processPlan.argumentCount} · lengths=[{processPlan.argumentLengths.join(",")}] · {processPlan.workingDirectory} · {processPlan.timeoutSeconds}s · processStarted={String(processPlan.processStarted)} · sideEffectsBlocked={String(processPlan.sideEffectsBlocked)}</code>}<button className="primary-button" onClick={() => onRunFfmpegFixture(projectId)} disabled={!projectId || readiness.status !== "ready" || readiness.workerExecutionEnabled || readiness.requiredMissing.length > 0 || loading}>Chạy fixture FFmpeg cục bộ</button><button className="secondary-button" onClick={() => onRunFfmpegFixtureAttempt(projectId)} disabled={!projectId || readiness.status !== "ready" || readiness.requiredMissing.length > 0 || loading}>Chạy FFmpeg qua lần chạy tác vụ</button><button className="secondary-button" onClick={() => onRunBlenderFixture(projectId)} disabled={!projectId || !blenderReady || loading}>Chạy fixture Blender cục bộ</button><button className="primary-button" onClick={() => onRunTrue3dFixture(projectId, false)} disabled={!projectId || !blenderReady || loading}>Dựng shot true 3D preview</button><button className="secondary-button" onClick={() => onRunTrue3dFixture(projectId, true)} disabled={!projectId || !blenderReady || !ffmpegReady || loading}>Render video true 3D local</button><button className="primary-button" onClick={() => onRunTrue3dMultishotFixture(projectId, false)} disabled={!projectId || !blenderReady || loading}>Dựng continuity 8 shot</button><label className="compact-field"><span>Rerun riêng shot</span><input value={rerunShotId} onChange={(event) => setRerunShotId(event.target.value.toUpperCase())} placeholder="SHOT-004" /></label><button className="secondary-button" onClick={() => onRunTrue3dMultishotFixture(projectId, false, rerunShotId.trim())} disabled={!projectId || !blenderReady || loading || !/^SHOT-\d{3}$/.test(rerunShotId.trim())}>Chạy lại shot + kiểm asset hash</button><button className="primary-button" onClick={() => onRunAssetPipelineCheck(projectId)} disabled={!projectId || loading}>Kiểm tra Asset Pipeline</button>{fixtureReport && <div className="preflight-result"><strong>Fixture phương tiện: ĐẠT</strong><span>{fixtureReport.outputPath} · {fixtureReport.sizeBytes} bytes · {fixtureReport.durationSeconds.toFixed(2)}s · {fixtureReport.streamCount} streams</span><small>ffmpeg exit={fixtureReport.ffmpeg.exitCode} · ffprobe exit={fixtureReport.ffprobe.exitCode} · output validation={fixtureReport.ffmpeg.outputEvidence.map((item) => item.validationState).join(",")} · side effects unknown={String(fixtureReport.ffmpeg.externalSideEffectUnknown)}</small></div>}{blenderFixtureReport && <div className="preflight-result"><strong>Fixture Blender: ĐẠT</strong><span>{blenderFixtureReport.outputPath} · {blenderFixtureReport.sizeBytes} bytes</span><small>exit={blenderFixtureReport.process.exitCode} · output validation={blenderFixtureReport.process.outputEvidence.map((item) => item.validationState).join(",")}</small></div>}{true3dFixtureReport && <div className="preflight-result"><strong>True 3D: {true3dFixtureReport.status}</strong><span>{true3dFixtureReport.scenePath} · {true3dFixtureReport.objectCount} objects · frames {true3dFixtureReport.frameRange[0]}–{true3dFixtureReport.frameRange[1]} @ {true3dFixtureReport.fps} fps</span><small>{true3dFixtureReport.videoPath ?? true3dFixtureReport.previewPaths.join(", ")} · scene={true3dFixtureReport.process.exitCode ?? "—"} · ffmpeg={true3dFixtureReport.ffmpegProcess?.exitCode ?? "not-run"}</small></div>}{true3dMultishotFixtureReport && <div className="preflight-result"><strong>Multi-shot continuity: {true3dMultishotFixtureReport.status}</strong><span>{true3dMultishotFixtureReport.shotCount} shot · render: {true3dMultishotFixtureReport.renderedShotIds.join(", ")} · asset hash unchanged={String(true3dMultishotFixtureReport.assetHashesUnchanged)}</span><small>{true3dMultishotFixtureReport.continuityReportPath} · scene={true3dMultishotFixtureReport.process.exitCode ?? "—"} · rerun={true3dMultishotFixtureReport.rerunShotId ?? "all"}</small></div>}{assetPipelineCheckReport && <div className="preflight-result"><strong>Asset Pipeline: {assetPipelineCheckReport.status}</strong><span>{assetPipelineCheckReport.assetCount} asset · ready={assetPipelineCheckReport.readyCount} · quarantine={assetPipelineCheckReport.quarantinedCount}</span><small>{assetPipelineCheckReport.reportPath} · bindings={assetPipelineCheckReport.bindingsPath} · quality={assetPipelineCheckReport.qualityPath ?? "not-run"}</small><small>{assetPipelineCheckReport.message}</small></div>}
</div><ToolReadinessPanel readiness={readiness} projectId={projectId} onNotice={onNotice} onRefresh={onRefresh} /><div className="info-callout settings-policy-note"><span className="notice-icon">i</span><span>Voice Studio đã chuyển sang OmniVoice local. Vào mục Voice Studio để tạo clone/design, nhập file vào data workspace, chỉnh profile và nghe thử.</span></div></div><div className="panel settings-side"><p className="eyebrow">IMAGE PROVIDER / NANO BANANA MCP</p><h3>Kết nối Nano Banana qua Google Flow</h3><p>Đường mặc định của app là BrowserOS neo MCP với profile đã đăng nhập. App đọc DOM/accessibility của Google Flow, nhập từng prompt, chờ output và tải đúng asset theo từng shot; không tự rơi về Chrome CDP.</p><div className="preflight-result"><strong>Không dùng ComfyUI local ở đường mặc định</strong><span>Server entry: D:\Auto3DvideoTools\nano-banana-mcp\dist\index.js</span><small>Ảnh trả về sẽ được copy/hash vào project và giữ rights pending; chưa coi là video final.</small></div><button className="primary-button wide" onClick={() => onNotice("Mở Quy trình video → Dựng semantic storyboard → Tạo asset ảnh Nano Banana. Nếu bị chặn, kiểm tra BrowserOS neo đang chạy và profile Flow đã đăng nhập.")}>Mở hướng dẫn Nano Banana <span>→</span></button><details className="settings-legacy-detail"><summary>ComfyUI legacy fallback</summary><p>Chỉ dùng khi bạn chủ động muốn chạy graph local. Endpoint hiện tại:</p><label>Điểm kết nối<input value={comfyEndpoint} onChange={(event) => setComfyEndpoint(event.target.value)} placeholder="http://127.0.0.1:8188" /></label><button className="secondary-button wide" onClick={() => void checkComfyUi()} disabled={checkingComfy}>{checkingComfy ? "Đang kiểm tra…" : "Kiểm tra ComfyUI fallback"}</button>{comfyHealth && <div className="preflight-result"><strong>ComfyUI: {comfyHealth.status}</strong><span>{comfyHealth.endpoint} · HTTP {comfyHealth.httpStatus ?? "—"}</span><small>{comfyHealth.message} · networkProbe={String(comfyHealth.networkProbePerformed)} · sideEffects={String(comfyHealth.sideEffectsStarted)}</small></div>}</details></div></section>;
}

function ActivityRow({ job }: { job: Job }) {
  return <div className="activity-row"><span className="activity-dot" /><div><strong>{job.kind}</strong><span>{displayJobState(job.state)} · {job.attemptCount} lần chạy</span></div><span className="activity-time">#{job.jobId.slice(-4)}</span></div>;
}

function EmptyState({ label, detail }: { label: string; detail: string }) {
  return <div className="empty-state"><div className="empty-icon">—</div><strong>{label}</strong><span>{detail}</span></div>;
}

export default App;
