import type { BrowserMcpRuntimeReport } from "../browserflow/browserFlowTypes";
import { useEffect } from "react";

type BrowserHandoffPanelProps = {
  projectId: string;
  loading: boolean;
  runtimeReport: BrowserMcpRuntimeReport | null;
  autoFlowReport: BrowserMcpRuntimeReport | null;
  onCheckSession: () => void;
  onOpenAutoFlow: () => void;
  onProbeRuntime: () => void;
};

export function BrowserHandoffPanel({ projectId, loading, runtimeReport, autoFlowReport, onCheckSession, onOpenAutoFlow, onProbeRuntime }: BrowserHandoffPanelProps) {
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
