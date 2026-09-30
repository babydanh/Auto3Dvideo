import type { VideoVisionEvidenceReport } from "./videoVisionTypes";

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

export function VideoVisionPanel({ projectId, loading, videoPath, outputPath, sampleFps, maxFrames, extractAudio, report, onVideoPathChange, onOutputPathChange, onSampleFpsChange, onMaxFramesChange, onExtractAudioChange, onChooseVideo, onAnalyze }: VideoVisionPanelProps) {
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
