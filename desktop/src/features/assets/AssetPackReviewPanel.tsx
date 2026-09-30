import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AssetView, AssetPackAcceptanceCheck, AssetPackBlenderBindingReport, AssetPackBlenderBindingRunReport, AssetPackReview, AssetPackReviewItem, AssetPreviewView } from "./assetTypes";

export function AssetPackReviewPanel({
  projectId,
  projectName,
  packs,
  loading,
  blenderBinding,
  blenderRun,
  onChoosePack,
  onRegisterPack,
  onReview,
  onPrepareBlenderBinding,
  onRunBlenderBinding,
  onNotice,
}: {
  projectId?: string;
  projectName?: string;
  packs: AssetPackReview[];
  loading: boolean;
  blenderBinding: AssetPackBlenderBindingReport | null;
  blenderRun: AssetPackBlenderBindingRunReport | null;
  onChoosePack: () => Promise<string | null>;
  onRegisterPack: (path: string) => Promise<AssetPackReview[] | null>;
  onReview: (input: { packId: string; assetItemId: string; reviewState: AssetPackReviewItem["reviewState"]; rightsStatus: AssetView["rightsStatus"]; acceptanceChecks: AssetPackAcceptanceCheck[]; note: string }) => Promise<AssetPackReview | null>;
  onPrepareBlenderBinding: (packId: string) => Promise<AssetPackBlenderBindingReport | null>;
  onRunBlenderBinding: (bindingId: string) => Promise<AssetPackBlenderBindingRunReport | null>;
  onNotice: (message: string) => void;
}) {
  const [selectedPackId, setSelectedPackId] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [draft, setDraft] = useState({ reviewState: "in_review" as AssetPackReviewItem["reviewState"], rightsStatus: "pending" as AssetView["rightsStatus"], checks: [] as AssetPackAcceptanceCheck[], note: "" });
  const [preview, setPreview] = useState<AssetPreviewView | null>(null);
  const [previewMessage, setPreviewMessage] = useState("");

  const selectedPack = packs.find((pack) => pack.packId === selectedPackId) ?? packs[0] ?? null;
  const selectedItem = selectedPack?.items.find((item) => item.assetItemId === selectedItemId) ?? selectedPack?.items[0] ?? null;
  const allItemsApproved = Boolean(selectedPack && selectedPack.items.length > 0 && selectedPack.items.every((item) => item.reviewState === "approved"));

  useEffect(() => {
    if (!selectedPackId && packs[0]) setSelectedPackId(packs[0].packId);
    if (selectedPackId && !packs.some((pack) => pack.packId === selectedPackId)) setSelectedPackId(packs[0]?.packId ?? "");
  }, [packs, selectedPackId]);

  useEffect(() => {
    if (!selectedPack || !selectedPack.items.some((item) => item.assetItemId === selectedItemId)) {
      setSelectedItemId(selectedPack?.items[0]?.assetItemId ?? "");
    }
  }, [selectedPack, selectedItemId]);

  useEffect(() => {
    if (!selectedItem) return;
    setDraft({ reviewState: selectedItem.reviewState, rightsStatus: selectedItem.rightsStatus, checks: selectedItem.acceptanceChecks.map((check) => ({ ...check })), note: selectedItem.note });
    setPreview(null);
    setPreviewMessage("");
    const relativePath = selectedItem.outputAssets[0]?.relativePath ?? selectedItem.outputPaths[0];
    if (!projectId || !relativePath) return;
    let cancelled = false;
    void invoke<AssetPreviewView>("read_project_asset_preview", { projectId, relativePath })
      .then((value) => { if (!cancelled) setPreview(value); })
      .catch((error) => { if (!cancelled) setPreviewMessage(String(error).slice(0, 180)); });
    return () => { cancelled = true; };
  }, [projectId, selectedItem]);

  async function loadPack() {
    const path = await onChoosePack();
    if (!path) return;
    onNotice("Đang nạp manifest, item và report của Asset Pack…");
    await onRegisterPack(path);
  }

  async function saveReview(reviewState: AssetPackReviewItem["reviewState"]) {
    if (!selectedPack || !selectedItem) return;
    await onReview({ packId: selectedPack.packId, assetItemId: selectedItem.assetItemId, reviewState, rightsStatus: draft.rightsStatus, acceptanceChecks: draft.checks, note: draft.note });
  }

  function toggleCheck(checkId: string, status: AssetPackAcceptanceCheck["status"]) {
    setDraft((current) => ({ ...current, checks: current.checks.map((check) => check.checkId === checkId ? { ...check, status } : check) }));
  }

  const counts = selectedPack?.items.reduce((result, item) => { result[item.reviewState] = (result[item.reviewState] ?? 0) + 1; return result; }, {} as Record<string, number>) ?? {};

  return <section className="panel asset-pack-review-panel" aria-label="Asset Pack Review">
    <div className="asset-reference-heading">
      <div>
        <p className="eyebrow accent">ASSET PACK / REVIEW GATE</p>
        <h2>Subject, world, prop và scale trước khi vào Blender</h2>
        <p>Manifest/report được đọc từ workspace; review được lưu riêng trong SQLite. Asset đã approve không bị ghi đè, và quyền vẫn là gate trước khi bind.</p>
      </div>
      <div className="asset-reference-summary"><span>PROJECT</span><strong>{projectName ?? "Chưa chọn project"}</strong><small>{packs.length} pack · {selectedPack?.items.length ?? 0} item</small><button type="button" className="small-button" onClick={() => void loadPack()} disabled={loading || !projectId}>＋ Nạp asset-pack.json</button></div>
    </div>
    {packs.length === 0 ? <div className="asset-pack-empty"><strong>Chưa có Asset Pack trong workspace</strong><span>Chọn file <code>asset-pack.json</code>; app sẽ tìm <code>asset-items.json</code> và report cùng thư mục.</span><button type="button" className="primary-button" onClick={() => void loadPack()} disabled={loading || !projectId}>Nạp Asset Pack</button></div> : <div className="asset-pack-review-grid">
      <aside className="asset-pack-list-column">
        <div className="asset-column-toolbar"><strong>Pack đã nạp</strong><span className="asset-pack-count">{counts.approved ?? 0}/{selectedPack?.items.length ?? 0} approved</span></div>
        <div className="asset-pack-items">{packs.map((pack) => <button type="button" key={pack.packId} className={`asset-pack-list-item ${pack.packId === selectedPack?.packId ? "selected" : ""}`} onClick={() => setSelectedPackId(pack.packId)} disabled={loading}><span><b>{pack.title}</b><small>{pack.status} · {pack.items.length} item</small><em>{pack.source.packRelativePath}</em></span><i>{pack.items.filter((item) => item.reviewState === "approved").length}/{pack.items.length}</i></button>)}</div>
        {selectedPack?.report ? <div className="asset-pack-report"><b>GENERATION REPORT</b><span>{selectedPack.report.status} · {selectedPack.report.runId || "chưa có run"}</span><small>{selectedPack.report.relativePath}</small></div> : <div className="asset-pack-report muted"><b>REPORT</b><span>Chưa có asset-generation-report.json</span></div>}
      </aside>
      <aside className="asset-pack-items-column">
        <div className="asset-column-toolbar"><strong>Items theo vai trò</strong><span>{counts.in_review ?? 0} review · {counts.needs_revision ?? 0} cần sửa</span></div>
        <div className="asset-pack-item-list">{selectedPack?.items.map((item) => <button type="button" key={item.assetItemId} className={`asset-pack-item-row ${item.assetItemId === selectedItem?.assetItemId ? "selected" : ""}`} onClick={() => setSelectedItemId(item.assetItemId)} disabled={loading}><span><b>{item.title}</b><small>{item.role} · {item.status} · quyền {item.rightsStatus}</small><em>{item.shotIds.length ? item.shotIds.join(", ") : "chưa gắn shot"}</em></span><i className={`asset-pack-review-pill ${item.reviewState}`}>{item.reviewState}</i></button>)}</div>
      </aside>
      <div className="asset-pack-inspector">
        {selectedItem ? <>
          <div className="asset-inspector-title"><div><p className="eyebrow">ASSET PACK ITEM</p><h3>{selectedItem.title}</h3><small>{selectedItem.assetItemId} · {selectedItem.role} · {selectedItem.scaleMeters ? `${selectedItem.scaleMeters}m` : "scale chưa khai báo"}</small></div><span className={`asset-state-badge ${selectedItem.reviewState}`}>{selectedItem.reviewState}</span></div>
          <div className="asset-pack-preview">{preview ? <img src={`data:${preview.mimeType};base64,${preview.base64Data}`} alt={`Preview ${selectedItem.title}`} /> : <div><strong>Chưa có preview ảnh</strong><span>{previewMessage || selectedItem.outputPaths[0] || "Output chưa được ingest vào Asset Library."}</span></div>}</div>
          <div className="asset-pack-facts"><span><b>Output asset IDs</b><code>{selectedItem.outputAssetIds.join(", ") || "—"}</code></span><span><b>Views</b><code>{selectedItem.requiredViews.join(", ") || "—"}</code></span><span><b>Shot IDs</b><code>{selectedItem.shotIds.join(", ") || "—"}</code></span><span><b>Output paths</b><code>{selectedItem.outputPaths.join(" · ") || "—"}</code></span></div>
          <details className="asset-pack-prompt-details"><summary>Prompt và negative prompt</summary><pre>{selectedItem.prompt}{selectedItem.negativePrompt ? `\n\nNEGATIVE:\n${selectedItem.negativePrompt}` : ""}</pre></details>
          <div className="asset-pack-checks"><div className="asset-column-toolbar"><strong>Acceptance checks</strong><span>Pass đủ check bắt buộc để approve</span></div>{draft.checks.length === 0 ? <span className="muted-copy">Item không khai báo checklist.</span> : draft.checks.map((check) => <label className="asset-pack-check" key={check.checkId}><input type="checkbox" checked={check.status === "pass"} onChange={(event) => toggleCheck(check.checkId, event.target.checked ? "pass" : "pending")} disabled={loading || selectedItem.reviewState === "approved"} /><span><b>{check.description || check.checkId}</b><small>{check.required ? "Bắt buộc" : "Tuỳ chọn"} · {check.status}</small></span></label>)}</div>
          <div className="asset-pack-review-fields"><label>Quyền<select value={draft.rightsStatus} onChange={(event) => setDraft((current) => ({ ...current, rightsStatus: event.target.value as AssetView["rightsStatus"] }))} disabled={loading || selectedItem.reviewState === "approved"}><option value="pending">Cần review</option><option value="personal">Cá nhân</option><option value="owned">Sở hữu</option><option value="licensed">Đã cấp phép</option><option value="public_domain">Public domain</option><option value="restricted">Hạn chế</option><option value="rejected">Từ chối</option></select></label><label>Ghi chú review<textarea value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} disabled={loading || selectedItem.reviewState === "approved"} placeholder="Giữ identity nào, lỗi nào, lý do reject/revision…" /></label></div>
          <div className="asset-actions"><button type="button" className="primary-button" onClick={() => void saveReview("approved")} disabled={loading || selectedItem.reviewState === "approved"}>Approve item</button><button type="button" className="secondary-button" onClick={() => void saveReview("in_review")} disabled={loading || selectedItem.reviewState === "approved"}>Lưu đang review</button><button type="button" className="secondary-button" onClick={() => void saveReview("needs_revision")} disabled={loading || selectedItem.reviewState === "approved"}>Đánh dấu cần tạo lại</button><button type="button" className="danger-button" onClick={() => void saveReview("rejected")} disabled={loading || selectedItem.reviewState === "approved"}>Reject item</button></div>
        </> : <div className="asset-empty-state large"><strong>Chọn một Asset Pack item</strong><span>App sẽ hiện preview, prompt, checklist, quyền và shot references ở đây.</span></div>}
      </div>
    </div>}
    <div className="asset-pack-blender-gate">
      <div>
        <p className="eyebrow accent">BLENDER BINDING / PREVIEW GATE</p>
        <strong>Compile asset approved thành Blender job</strong>
        <span>Kiểm tra identity, hash file, quyền, scale reference, shot IDs và continuity trước khi tạo job. Sau đó có thể chạy Blender preview local bằng worker đã version hóa.</span>
      </div>
      <div className="asset-pack-blender-actions">
        <button type="button" className="secondary-button" onClick={() => selectedPack && void onPrepareBlenderBinding(selectedPack.packId)} disabled={loading || !selectedPack || !allItemsApproved}>Chuẩn bị Blender binding</button>
        <button type="button" className="primary-button" onClick={() => blenderBinding && void onRunBlenderBinding(blenderBinding.bindingId)} disabled={loading || blenderBinding?.packId !== selectedPack?.packId || blenderBinding?.status !== "ready_for_blender_review" || blenderRun?.bindingId === blenderBinding?.bindingId}>Chạy Blender preview</button>
      </div>
      {!allItemsApproved && selectedPack && <small>Approve đủ {selectedPack.items.length} item trước khi bind.</small>}
      {blenderBinding && blenderBinding.packId === selectedPack?.packId && <div className={`asset-pack-binding-result ${blenderBinding.status}`}><b>{blenderBinding.status === "ready_for_blender_review" ? "Binding đã sẵn sàng review" : "Binding bị chặn"}</b><span>{blenderBinding.assetCount} binding · {blenderBinding.shotIds.length} shot · world scale {blenderBinding.worldScaleMeters ?? "—"}m</span><small>{blenderBinding.bindingPath ?? blenderBinding.message}</small>{blenderBinding.blockers.length > 0 && <em>{blenderBinding.blockers.slice(0, 4).join(" · ")}</em>}</div>}
      {blenderRun && blenderRun.bindingId === blenderBinding?.bindingId && <div className="asset-pack-run-result"><b>Blender preview đã chạy · cần duyệt</b><span>{blenderRun.scenePath}</span><small>{blenderRun.previewOutputs.join(" · ")}</small><em>{blenderRun.message}</em></div>}
    </div>
  </section>;
}
