import { invoke } from "@tauri-apps/api/core";
import type { AssetPipelineCheckReport, ComfyUiHealthReport, HealthStatus, LocalBlenderFixtureReport, LocalMediaFixtureReport, LocalToolProbeReport, ProcessDryRunPlan, ToolReadinessItem, ToolReadinessReport, True3dFixtureReport, True3dMultishotFixtureReport, WorkerPreflightReport } from "./settingsTypes";
import { useEffect, useState } from "react";

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

export function SettingsPanel({ health, readiness, loading, projectId, fixtureReport, blenderFixtureReport, true3dFixtureReport, true3dMultishotFixtureReport, assetPipelineCheckReport, onRunFfmpegFixture, onRunFfmpegFixtureAttempt, onRunBlenderFixture, onRunTrue3dFixture, onRunTrue3dMultishotFixture, onRunAssetPipelineCheck, onNotice, onRefresh }: { health: HealthStatus; readiness: ToolReadinessReport; loading: boolean; projectId: string; fixtureReport: LocalMediaFixtureReport | null; blenderFixtureReport: LocalBlenderFixtureReport | null; true3dFixtureReport: True3dFixtureReport | null; true3dMultishotFixtureReport: True3dMultishotFixtureReport | null; assetPipelineCheckReport: AssetPipelineCheckReport | null; onRunFfmpegFixture: (projectId: string) => void; onRunFfmpegFixtureAttempt: (projectId: string) => void; onRunBlenderFixture: (projectId: string) => void; onRunTrue3dFixture: (projectId: string, renderVideo: boolean) => void; onRunTrue3dMultishotFixture: (projectId: string, renderVideo: boolean, rerunShotId?: string) => void; onRunAssetPipelineCheck: (projectId: string) => void; onNotice: (message: string) => void; onRefresh: () => void }) {
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
