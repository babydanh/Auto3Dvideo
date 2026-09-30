import type { AuditEvent } from "./auditTypes";
import { EmptyState } from "../shared/ui";

export function AuditPanel({ events, onRefresh }: { events: AuditEvent[]; onRefresh: () => void }) {
  return <section className="panel page-panel"><div className="section-heading"><div><p className="eyebrow">NHẬT KÝ THAO TÁC CỤC BỘ</p><h3>Sự kiện nhật ký</h3><p className="section-subtitle">Lịch sử thao tác cục bộ được đọc từ SQLite; dữ liệu bí mật không hiển thị ở đây.</p></div><button className="secondary-button" onClick={onRefresh}>Làm mới nhật ký</button></div>{events.length === 0 ? <EmptyState label="Chưa có sự kiện nhật ký" detail="Tạo dự án hoặc tác vụ cục bộ để sinh bằng chứng." /> : <div className="audit-list">{events.map((event) => <div className="audit-row" key={event.eventId}><span className="audit-time mono">{event.createdAt}</span><strong>{event.eventType}</strong><span>{event.subjectType ?? "hệ thống"} · {event.subjectId ?? "-"}</span><span className="audit-project">{event.projectId ?? "toàn cục"}</span></div>)}</div>}<p className="attempt-note">Nhật ký chỉ là bằng chứng cục bộ. Hiện chưa đồng bộ đám mây, chưa đăng bài và chưa có bộ xử lý bên ngoài tổng quát.</p></section>;
}
