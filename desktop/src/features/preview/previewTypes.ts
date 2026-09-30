import type { AssetView } from "../assets/assetTypes";
import type { ProcessRunSummary } from "../../processTypes";

export type PreviewPlatform = "tiktok" | "douyin" | "kuaishou" | "xiaohongshu" | "bilibili" | "xigua" | "huoshan" | "weishi" | "haokan" | "wikimedia";
export type PreviewScanStatus = "idle" | "planned" | "success" | "blocked";
export type PreviewRadarBucket = "all" | "potential" | "hot_new" | "rising" | "low_clone" | "fresh" | "unranked";
export type PreviewReuseStatus = "permission_required" | "license_candidate" | "user_confirmed";
export type PreviewReviewStatus = "unreviewed" | "keep" | "skip";
export type PreviewTopic = "knowledge" | "story" | "nature" | "technology" | "lifestyle" | "entertainment" | "sports" | "other";

export type VideoPreviewCard = {
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

export type PreviewScanPlan = {
  platforms: PreviewPlatform[];
  maxResults: number;
  scanMode: "discovery_all" | "creator_catalog" | "licensed_footage";
  previewOnly: boolean;
  worker: string;
  status: PreviewScanStatus;
  createdAt: string;
};

export type PreviewPlatformScanResult = {
  platform: PreviewPlatform;
  status: "success" | "empty" | "blocked" | "waiting_user" | "error" | string;
  scannedCount: number;
  discoveryUrl: string;
  message: string;
};

export type PreviewScanReport = {
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

export const MAX_PREVIEW_CARDS = 2_000;

export const previewPlatformOptions: Array<{ value: PreviewPlatform; label: string; host: string }> = [
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

export const previewLicensedSourceOptions: Array<{ value: PreviewPlatform; label: string; host: string }> = [
  { value: "wikimedia", label: "Wikimedia Commons", host: "commons.wikimedia.org" },
];

export const previewTopicOptions: Array<{ value: "all" | PreviewTopic; label: string }> = [
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

export const previewRadarBucketOptions: Array<{ value: PreviewRadarBucket; label: string; detail: string }> = [
  { value: "all", label: "Tất cả", detail: "Toàn bộ video worker trả về" },
  { value: "potential", label: "Tiềm năng", detail: "Điểm phù hợp để lồng voice/edit" },
  { value: "hot_new", label: "Hot mới", detail: "Mới, nổi bật và ít tín hiệu trùng" },
  { value: "rising", label: "Đang tăng", detail: "Tương tác tăng nhanh" },
  { value: "low_clone", label: "Ít trùng lượt quét", detail: "Heuristic từ title/thumbnail trong tập này" },
  { value: "fresh", label: "Mới đăng", detail: "Ưu tiên thời gian đăng mới" },
  { value: "unranked", label: "Chưa đủ dữ liệu", detail: "Chưa có metadata để xếp nhóm" },
];

export function previewPlatformLabel(platform: PreviewPlatform) {
  return [...previewPlatformOptions, ...previewLicensedSourceOptions].find((item) => item.value === platform)?.label ?? platform;
}

export function isPreviewPlatform(value: string): value is PreviewPlatform {
  return [...previewPlatformOptions, ...previewLicensedSourceOptions].some((item) => item.value === value);
}

export function previewRadarBucketLabel(bucket: PreviewRadarBucket) {
  return previewRadarBucketOptions.find((item) => item.value === bucket)?.label ?? bucket;
}

export function previewTopicLabel(topic: "all" | PreviewTopic) {
  return previewTopicOptions.find((item) => item.value === topic)?.label ?? topic;
}

export function previewTopicForCard(card: VideoPreviewCard): PreviewTopic {
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

export function previewRadarBuckets(card: VideoPreviewCard): Exclude<PreviewRadarBucket, "all">[] {
  const buckets = card.radarBuckets?.filter((bucket): bucket is Exclude<PreviewRadarBucket, "all"> => previewRadarBucketOptions.some((item) => item.value === bucket)) ?? [];
  return buckets.length ? buckets : ["unranked"];
}

export function previewReuseStatus(card: VideoPreviewCard): PreviewReuseStatus {
  return card.reuseStatus === "user_confirmed" || card.reuseStatus === "license_candidate"
    ? card.reuseStatus
    : "permission_required";
}

export function previewReuseStatusLabel(card: VideoPreviewCard) {
  const status = previewReuseStatus(card);
  return status === "user_confirmed" ? "Người dùng đã xác nhận" : status === "license_candidate" ? "Có license để kiểm tra" : "Cần xin quyền";
}

export function previewReviewStatusLabel(status: PreviewReviewStatus) {
  return status === "keep" ? "Giữ lại" : status === "skip" ? "Bỏ qua" : "Chưa review";
}

export function formatPreviewScannedAt(value: string) {
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

export function previewEmbedUrl(card: VideoPreviewCard) {
  if (card.embedUrl) return card.embedUrl;
  if (card.platform !== "tiktok") return null;
  const tiktokId = card.shareUrl.match(/\/video\/(\d+)/i)?.[1] ?? null;
  return tiktokId ? `https://www.tiktok.com/player/v1/${tiktokId}` : null;
}

export function createVideoPreviewCard(rawUrl: string, allowedPlatforms: PreviewPlatform[] | null, index: number): VideoPreviewCard | null {
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

export function isVideoPreviewCard(value: unknown): value is VideoPreviewCard {
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
export type ReferenceVideoDownloadReport = {
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
