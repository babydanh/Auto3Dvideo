import { useMemo, useState } from "react";
import type { SubtitleBurnInReport, SubtitleDocument, SubtitleDocumentReport, SubtitleEntry, SubtitleVideoProbeReport } from "./subtitleTypes";

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

export function SubtitleStudioPanel({ projectId, loading, videoPath, subtitlePath, outputPath, sourceLanguage, targetLanguage, format, document, probe, report, burnInReport, onVideoPathChange, onSubtitlePathChange, onOutputPathChange, onSourceLanguageChange, onTargetLanguageChange, onFormatChange, onDocumentChange, onChooseVideo, onChooseSubtitle, onProbe, onLoad, onSave, onBurnIn, onNotice }: SubtitleStudioPanelProps) {
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
