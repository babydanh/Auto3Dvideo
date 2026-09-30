import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AssetView } from "../assets/assetTypes";
import { MAX_PREVIEW_CARDS, createVideoPreviewCard, isVideoPreviewCard, previewPlatformLabel } from "./previewTypes";
import type { PreviewPlatform, PreviewReviewStatus, PreviewScanPlan, PreviewScanReport, PreviewScanStatus, ReferenceVideoDownloadReport, VideoPreviewCard } from "./previewTypes";
import type { AppActivityRecorder, AppActivityUpdater, AppNotice, AppRefresh, AppStateSetter } from "../shared/appTypes";
import type { WorkspaceActivityState } from "../shared/workspaceActivityTypes";
import type { SubtitleVideoProbeReport } from "../subtitles/subtitleTypes";
import { useEffect, useState } from "react";

export function usePreviewLibraryState({ recordWorkspaceActivity, refresh, selectedProjectId, setActiveNav, setAssets, setLoading, setNotice, setSubtitleProbe, setSubtitleVideoPath, setVideoVisionPath, updateWorkspaceActivity }: {
  recordWorkspaceActivity: AppActivityRecorder;
  refresh: AppRefresh;
  selectedProjectId: string;
  setActiveNav: AppStateSetter<string>;
  setAssets: AppStateSetter<AssetView[]>;
  setLoading: AppStateSetter<boolean>;
  setNotice: AppNotice;
  setSubtitleProbe: AppStateSetter<SubtitleVideoProbeReport | null>;
  setSubtitleVideoPath: AppStateSetter<string>;
  setVideoVisionPath: AppStateSetter<string>;
  updateWorkspaceActivity: AppActivityUpdater;
}) {
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

  return {
    changePreviewRightsStatus,
    clearPreviewLibrary,
    continueDownloadedToSubtitles,
    continueDownloadedToVoice,
    createPreviewScanPlan,
    downloadSelectedReferenceVideo,
    importPreviewUrls,
    previewCards,
    previewCreatorUrl,
    previewDownloadReport,
    previewMaxResults,
    previewPlatforms,
    previewRightsStatus,
    previewScanPlan,
    previewScanReport,
    previewStorageReadyFor,
    previewUrls,
    reviewSelectedPreview,
    scanLicensedFootage,
    scanPreviewCreatorCatalog,
    selectPreviewCard,
    selectedPreviewId,
    setPreviewCards,
    setPreviewCreatorUrl,
    setPreviewDownloadReport,
    setPreviewMaxResults,
    setPreviewPlatforms,
    setPreviewRightsStatus,
    setPreviewScanPlan,
    setPreviewScanReport,
    setPreviewStorageReadyFor,
    setPreviewUrls,
    setSelectedPreviewId,
    togglePreviewPlan,
    togglePreviewPlatform,
  };
}
