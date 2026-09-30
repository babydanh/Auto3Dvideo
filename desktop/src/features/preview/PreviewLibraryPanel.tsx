import { useEffect, useState } from "react";
import type { AssetView } from "../assets/assetTypes";
import {
  formatPreviewScannedAt,
  previewEmbedUrl,
  previewLicensedSourceOptions,
  previewPlatformLabel,
  previewPlatformOptions,
  previewRadarBucketLabel,
  previewRadarBucketOptions,
  previewRadarBuckets,
  previewReuseStatus,
  previewReuseStatusLabel,
  previewReviewStatusLabel,
  previewTopicForCard,
  previewTopicLabel,
  previewTopicOptions,
  type PreviewTopic,
  type PreviewPlatform,
  type PreviewRadarBucket,
  type PreviewReviewStatus,
  type PreviewScanPlan,
  type PreviewScanReport,
  type VideoPreviewCard,
  type ReferenceVideoDownloadReport,
} from "./previewTypes";

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
export function PreviewLibraryPanel({ projectId, projectName, loading, platforms, maxResults, creatorUrl, urls, cards, selectedPreviewId, scanPlan, scanReport, rightsStatus, downloadReport, onTogglePlatform, onMaxResultsChange, onCreatorUrlChange, onUrlsChange, onPlanScan, onScanCreator, onScanLicensed, onImportUrls, onSelectPreview, onReviewSelected, onTogglePlan, onClear, onRightsStatusChange, onDownloadSelected, onContinueToSubtitles, onContinueToVoice }: PreviewLibraryPanelProps) {
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
