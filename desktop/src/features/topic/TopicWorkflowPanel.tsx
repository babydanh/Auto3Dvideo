import { invoke, isTauri } from "@tauri-apps/api/core";
import type { CodingAudioMode, LocalScriptDocument, LocalScriptReviewReport, LocalScriptSegment, LocalVisualMode } from "../shared/scriptTypes";
import { displayWorkspaceActivityState } from "../shared/workspaceActivityTypes";
import type { WorkspaceActivityEvent } from "../shared/workspaceActivityTypes";
import type { LocalVideoPipelineReport, PromptTemplate, TopicProfile } from "./topicTypes";
import type { VoiceSettings } from "../voice/voiceTypes";
import { useEffect, useState } from "react";
import { CodingLessonReview, CodingSceneReview } from "./codingSceneReview";

const CODING_PRESETS: { label: string; topic: string }[] = [
  { label: "1. Two Sum", topic: "LeetCode Two Sum: tìm hai chỉ số có tổng bằng target bằng bảng tra cứu, tra trước rồi chèn sau. Giảng thuật toán theo từng bước." },
  { label: "2. Binary Search", topic: "LeetCode Binary Search: tìm kiếm nhị phân trên mảng đã sắp xếp, giải thích thuật toán và biến lo/hi mỗi vòng lặp." },
  { label: "3. Sliding Window", topic: "LeetCode Longest Substring Without Repeating Characters: sliding window trên chuỗi, giải thích thuật toán và bất biến cửa sổ không lặp ký tự." },
  { label: "4. BFS trên đồ thị", topic: "Breadth-First Search trên đồ thị: BFS đánh dấu node ngay khi enqueue để mỗi node chỉ được thăm một lần. Giảng thuật toán." },
  { label: "5. Cache-aside", topic: "System design cache-aside: read path miss → đọc database → ghi cache TTL → hit, kèm caveat stale và invalidation." },
  { label: "6. Token bucket", topic: "System design token-bucket rate limiter: không cấp phép request khi hết token, giải thích concurrency, refill và phạm vi scope." },
  { label: "7. Message queue", topic: "System design message queue: at-least-once delivery với consumer idempotent, dedup key và transaction cho database effect." },
  { label: "8. URL shortener", topic: "System design URL shortener: sinh mã duy nhất, redirect 301/302 và cách xử lý va chạm mã." },
];

export function TopicWorkflowPanel({
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
  const [codingAudioMode, setCodingAudioMode] = useState<CodingAudioMode>("caption-only");
  const codingScript = Boolean(scriptDraft?.codingLesson) || Boolean(scriptDraft?.segments.some((segment) => segment.teachingScene));
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
      const reason = codingScript
        ? "Bài coding chỉ dựng được bằng engine 2.5D cục bộ; AI 3D Cloud chưa được nối provider và không nhận dữ liệu teachingScene."
        : "AI 3D Cloud chưa được nối provider trong pipeline hiện tại; chưa gửi request.";
      onActivity({ stage: "provider.validate", tool: "AI provider", state: "blocked", message: reason, nextAction: "Chọn engine 2.5D cục bộ rồi chạy lại." });
      setConsoleOpen(true);
      return;
    }
    if (selectedRenderEngine === "coding-25d" && !codingScript) {
      onActivity({ stage: "run.validate", tool: "Workspace", state: "blocked", message: "Kịch bản hiện tại không có dữ liệu bài giảng coding (codingLesson/teachingScene) nên engine coding-25d sẽ bị từ chối.", nextAction: "Chọn một mẫu bài coding ở Bước 1 rồi tạo lại kịch bản." });
      setConsoleOpen(true);
      return;
    }
    // A coding lesson keeps coding-25d end to end; never relabel it as space-25d.
    const visualMode: LocalVisualMode = codingScript ? "coding-25d" : "space-25d";
    const audioMode: CodingAudioMode = codingScript ? codingAudioMode : "narrated";
    logActivity(`Chế độ xuất: ${visualMode} · audio ${audioMode}`);
    onRenderApprovedLocalVideo(
      { ...scriptDraft, approvalStatus: "approved", voiceSettings, visualMode, audioMode },
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
            <details className="topic-suggestions" style={{ marginTop: "8px" }}>
              <summary>⌨️ Mẫu bài coding — thuật toán & thiết kế hệ thống</summary>
              <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                {CODING_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="secondary-button compact-button"
                    style={{ fontSize: "11px", color: "var(--cyan)", borderColor: "var(--border-strong)" }}
                    onClick={() => {
                      onTopicChange(preset.topic);
                      onProfileChange("science-explainer");
                      setSelectedRenderEngine("coding-25d");
                      setCodingAudioMode("caption-only");
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <small style={{ display: "block", marginTop: "8px", color: "var(--muted)", fontSize: "12px", lineHeight: 1.45 }}>
                Mẫu chọn sẵn engine Video Giảng Dạy Lập Trình 2.5D và chế độ caption-only. Bài coding chỉ dựng được bằng engine cục bộ.
              </small>
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }} role="radiogroup" aria-label="Công nghệ kết xuất hình ảnh / Scene">
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
              {
                id: "coding-25d",
                title: "Giảng Dạy Lập Trình 2.5D",
                tag: "Offline · Pillow + FFmpeg · 1280×720",
                desc: "Mảng, đồ thị kiến trúc, highlight dòng code và trace từng trạng thái từ dữ liệu teachingScene.",
                badgeColor: "var(--blue)",
              },
            ].map((engine) => {
              const active = selectedRenderEngine === engine.id;
              return (
                <button
                  key={engine.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setSelectedRenderEngine(engine.id);
                    if (engine.id === "coding-25d") setCodingAudioMode("caption-only");
                  }}
                  style={{
                    cursor: "pointer",
                    textAlign: "left",
                    font: "inherit",
                    color: "inherit",
                    padding: "14px",
                    borderRadius: "8px",
                    border: active ? "2px solid var(--cyan)" : "1px solid var(--border)",
                    background: active ? "var(--panel-raised)" : "var(--panel-soft)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  <strong style={{ fontSize: "14px", color: active ? "var(--cyan)" : "var(--text)" }}>{engine.title}</strong>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: engine.badgeColor }}>{engine.tag}</span>
                  <p style={{ margin: 0, fontSize: "12px", color: "var(--muted)", lineHeight: 1.4 }}>{engine.desc}</p>
                </button>
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

          {(selectedRenderEngine === "coding-25d" || codingScript) && (
            <div className="coding-engine-note">
              <div>
                <strong>Chế độ âm thanh của bài coding</strong>
                <div style={{ marginTop: "8px" }}>
                  <span style={{ display: "block", marginBottom: "6px", color: "var(--muted-bright)", fontSize: "12px" }}>
                    Bài coding mặc định chỉ có phụ đề. Chọn "Có giọng đọc" chỉ khi OmniVoice đã cài và profile sẵn sàng.
                  </span>
                  <div className="coding-audio-options" role="radiogroup" aria-label="Chế độ âm thanh của bài coding">
                    <label className={`coding-audio-option ${codingAudioMode === "caption-only" ? "selected" : ""}`}>
                      <input
                        type="radio"
                        name="coding-audio-mode"
                        checked={codingAudioMode === "caption-only"}
                        onChange={() => setCodingAudioMode("caption-only")}
                      />
                      <span>
                        <strong>Chỉ phụ đề (caption-only)</strong>
                        Không gọi OmniVoice, không ghi file audio. Video vẫn có đủ khung hình và dòng thời gian.
                      </span>
                    </label>
                    <label className={`coding-audio-option ${codingAudioMode === "narrated" ? "selected" : ""}`}>
                      <input
                        type="radio"
                        name="coding-audio-mode"
                        checked={codingAudioMode === "narrated"}
                        onChange={() => setCodingAudioMode("narrated")}
                      />
                      <span>
                        <strong>Có giọng đọc (narrated)</strong>
                        Chạy OmniVoice như các video khác. Nếu chưa cài OmniVoice, lệnh sẽ dừng và báo lỗi, không tạo audio giả.
                      </span>
                    </label>
                  </div>
                </div>
              </div>
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

          {scriptDraft.codingLesson ? (
            <div className="coding-lesson-review" aria-label="Mục tiêu và giả định của bài coding">
              <CodingLessonReview lesson={scriptDraft.codingLesson} />
            </div>
          ) : null}

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
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", fontSize: "13px", color: "var(--muted)" }}>
              {scriptDraft.codingLesson ? (
                <div className="coding-export-summary">
                  <span className="coding-kind-badge">{selectedRenderEngine === "coding-25d" ? "coding-25d" : "coding-25d · cần engine coding"}</span>
                  <span>· Audio: <strong style={{ color: "var(--text)" }}>{selectedRenderEngine === "coding-25d" && codingAudioMode === "caption-only" ? "chỉ phụ đề" : "có giọng đọc"}</strong></span>
                  <span>· Claim: <strong style={{ color: "var(--orange)" }}>cần người kiểm tra</strong></span>
                </div>
              ) : (
                <>
                  <span>🎙️ Đang dùng: <strong>{voiceSettings.referenceAudioPath ? "Giọng thu âm của bạn" : voiceSettings.presetVoice}</strong></span>
                  <span>· Cảm xúc: <strong>{voiceSettings.temperature.toFixed(2)}</strong></span>
                </>
              )}
            </div>

            <button
              type="button"
              className="primary-button"
              style={{ background: "var(--green)", borderColor: "var(--green)", color: "var(--bg)", padding: "10px 24px", fontSize: "15px", fontWeight: 700 }}
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
          {segment.teachingScene ? (
            <div className="shot-review-card">
              <span className="review-label">Teaching scene · dữ liệu dựng video</span>
              <CodingSceneReview scene={segment.teachingScene} />
            </div>
          ) : (
            <>
          <div className="shot-review-card"><span className="review-label">Visual prompt · 5 lớp</span><textarea value={prompt} onChange={(event) => updateSegment(selectedShotIndex, { visualPrompt: event.target.value })} rows={12} /><small>Subject · action · camera · lighting · render/style</small></div>
          <div className="shot-review-card shot-details-card"><span className="review-label">Shot details · dữ liệu cho AI/provider</span><label>Subject<input value={segment.subject ?? ""} onChange={(event) => updateSegment(selectedShotIndex, { subject: event.target.value })} placeholder="Nhân vật/vật thể chính, nhận diện và chất liệu" /></label><label>Action<input value={segment.action ?? ""} onChange={(event) => updateSegment(selectedShotIndex, { action: event.target.value })} placeholder="Hành động và nhịp chuyển động theo thời gian" /></label><label>Camera / lens<input value={segment.cameraIntent ?? ""} onChange={(event) => updateSegment(selectedShotIndex, { cameraIntent: event.target.value })} placeholder="Wide 28mm, slow dolly-in, left-to-right" /></label><label>Lighting / look<input value={segment.lightingIntent ?? ""} onChange={(event) => updateSegment(selectedShotIndex, { lightingIntent: event.target.value })} placeholder="Volumetric blue rim light, high contrast" /></label><label>Continuity anchors<textarea rows={2} value={segment.continuityNotes ?? ""} onChange={(event) => updateSegment(selectedShotIndex, { continuityNotes: event.target.value })} placeholder="Giữ màu tàu, hướng camera, vị trí nhân vật giữa các shot" /></label><label>Negative constraints<textarea rows={2} value={segment.negativePrompt ?? ""} onChange={(event) => updateSegment(selectedShotIndex, { negativePrompt: event.target.value })} placeholder="No extra objects, no text, no logo, no morphing" /></label></div>
            </>
          )}
          <div className="shot-review-card"><span className="review-label">Pipeline status</span><div className="review-progress"><span>Shot plan</span><b>READY</b></div><div className="review-progress"><span>AI video provider</span><b className="blocked-text">CHƯA GỬI</b></div></div>
          <div className="shot-review-actions"><details className="preview-tools"><summary>Công cụ preview</summary><div className="preview-tools-buttons"><button type="button" className="secondary-button" onClick={() => setReviewPreview("composer")}>▶ Xem Composer</button></div></details></div>
          {reviewPreview === "composer" && <div className="shot-preview-box"><div className="shot-preview-box-heading"><span>SHOT COMPOSER PREVIEW</span><button type="button" onClick={() => setReviewPreview(null)}>×</button></div><div className="composer-preview-canvas"><span className="preview-grid-line line-a" /><span className="preview-grid-line line-b" /><span className="preview-object object-main" /><span className="preview-object object-small" /><span className="preview-camera">CAMERA · 35mm</span><small>Layout preview · camera / subject / depth</small></div></div>}
        </>; })() : <div className="shot-review-empty"><strong>Chọn một shot để review</strong><span>Prompt, camera, continuity và trạng thái pipeline sẽ hiển thị tại đây.</span></div>}
      </aside></div>

      {/* BƯỚC 3: XEM TRƯỚC VIDEO (VIDEO PREVIEW PLAYER) */}
      {localVideoReport && (
        <div style={{ background: "var(--panel-soft)", padding: "20px", borderRadius: "10px", border: "2px solid var(--cyan)", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ background: "var(--green)", color: "var(--bg)", fontWeight: 700, borderRadius: "50%", width: "24px", height: "24px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px" }}>✓</span>
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
                <span style={{ fontSize: "12px", color: "var(--muted)" }}>{localVideoReport.audioPath || "không có tệp audio (caption-only)"} · {localVideoReport.captionsPath}</span>
              </div>
              <div style={{ padding: "10px", background: "var(--panel-soft)", borderRadius: "6px", border: "1px solid var(--border-strong)" }}>
                <span style={{ color: "var(--muted)", display: "block" }}>Chế độ đã dựng:</span>
                <strong>{localVideoReport.visualMode} · {localVideoReport.audioMode === "caption-only" ? "chỉ phụ đề, không có audio" : "có giọng đọc"}</strong>
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
