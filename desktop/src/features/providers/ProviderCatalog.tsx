import { invoke } from "@tauri-apps/api/core";
import { displayCapability, displayCommandCodeCost, displayCommandCodeStatus, displayCredentialState, displayPricingMode } from "./providerTypes";
import type { CommandCodeProbeReport, ProviderEnvSnapshot, ProviderProfile, ProviderRoutingProfile } from "./providerTypes";
import { useState } from "react";

function CommandCodeProbePanel({ report, testing, onTest }: { report: CommandCodeProbeReport | null; testing: boolean; onTest: () => void }) {
  return <div className="commandcode-panel"><div className="section-heading"><div><p className="eyebrow accent">KẾT NỐI MODEL / OMNIROUTE</p><h4>Kiểm tra Gemini 3.8 Flash Medium</h4><p className="section-subtitle">Bước kiểm tra cố định gửi một câu ngắn qua OmniRoute/9Router tới `ag/gemini-3.8-flash-medium`; không tạo video và không lưu nội dung vào project.</p></div><button className="primary-button" onClick={onTest} disabled={testing}>{testing ? "Đang kiểm tra…" : "Kiểm tra kết nối"}</button></div>{report ? <><div className="commandcode-meta"><span>Trạng thái: <strong>{displayCommandCodeStatus(report.status)}</strong></span><span>HTTP: <strong>{report.httpStatus ?? "-"}</strong></span><span>Mô hình: <strong>{report.model}</strong></span><span>Kết nối mạng: <strong>{report.networkCallsMade ? "đã gọi" : "chưa gọi"}</strong></span><span>Chi phí: <strong>{displayCommandCodeCost(report.costStatus)}</strong></span></div><p className="commandcode-message">{report.message}</p>{report.responseText && <details open><summary>Phản hồi từ mô hình</summary><pre>{report.responseText}</pre></details>}<p className="attempt-note">Số đơn vị: đầu vào {report.promptTokens ?? "-"} · đầu ra {report.completionTokens ?? "-"} · tổng {report.totalTokens ?? "-"}. Khóa chỉ được đọc bên trong bộ xử lý, không đi qua dòng lệnh hoặc nhật ký.</p></> : <p className="attempt-note">Chưa kiểm tra. Nút này chỉ kiểm tra route Director; không tạo video, không gọi giọng nói và không đăng bài.</p>}</div>;
}

function LlmRoutingPanel({ routing }: { routing: ProviderRoutingProfile[] }) {
  return <div className="llm-routing-panel"><div className="llm-routing-heading"><div><p className="eyebrow accent">LLM ROUTING / GỌI TUẦN TỰ</p><h4>Model nào làm việc gì</h4><p className="section-subtitle">Mỗi bước chỉ gọi đúng model của vai trò đó, không chạy bốn model song song. Director lập kế hoạch; Gemini kiểm tra và thao tác; Recovery chỉ bật khi có lỗi đủ nặng.</p></div><span className="status-text enabled">{routing.length} vai trò</span></div><div className="llm-routing-list">{routing.map((role) => <article className="llm-routing-card" key={role.roleId}><div className="routing-role"><strong>{role.label}</strong><small>{role.modelEnv}</small><span className={`status-text ${role.configured ? "enabled" : "disabled"}`}>{role.configured ? "ĐÃ GÁN" : "DÙNG MẶC ĐỊNH"}</span></div><div className="routing-model"><strong className="mono">{role.model}</strong><span>{role.responsibility}</span></div><div className="routing-detail"><div><small>Gọi khi</small><span>{role.trigger}</span></div><div><small>Input → output</small><span>{role.inputArtifact} → {role.outputArtifact}</span></div></div><div className="routing-source"><small>Nguồn</small><strong>{role.source}</strong></div></article>)}</div></div>;
}

export function ProviderCatalog({ providers, envSnapshot, cloudGenerationEnabled, onToggleCloudGeneration, commandCodeReport, commandCodeTesting, onTestCommandCode, onAdded, onNotice }: { providers: ProviderProfile[]; envSnapshot: ProviderEnvSnapshot; cloudGenerationEnabled: boolean; onToggleCloudGeneration: () => void; commandCodeReport: CommandCodeProbeReport | null; commandCodeTesting: boolean; onTestCommandCode: () => void; onAdded: (provider: ProviderProfile) => void; onNotice: (message: string) => void }) {
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
    <div className="info-callout"><span className="notice-icon">i</span><span>`.env` chỉ dành cho phát triển và không được commit. Cloud/API được lưu qua lần mở app; khi bật, app mới cho phép gọi Nano Banana MCP và chuẩn bị Google Flow, có thể tiêu credit. Tắt Cloud/API để khóa các lần gọi tiếp theo; review và duyệt Generate vẫn giữ nguyên.</span></div>
  </section>;
}
