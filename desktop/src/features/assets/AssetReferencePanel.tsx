import { useEffect, useState } from "react";
import type { AssetMetadataDraft, AssetView, ReferenceAssignment, ReferenceSet } from "./assetTypes";

export function AssetReferencePanel({
  projectName,
  assets,
  referenceSets,
  loading,
  onChooseSource,
  onImport,
  onUpdateAsset,
  onAssetState,
  onCreateSet,
  onUpdateSet,
  onSetState,
  onAssign,
  onDetach,
}: {
  projectName?: string;
  assets: AssetView[];
  referenceSets: ReferenceSet[];
  loading: boolean;
  onChooseSource: () => Promise<string | null>;
  onImport: (input: { sourcePath: string; title: string; mediaKind: string; sourceUri: string | null; tags: string[]; note: string; rightsStatus: AssetView["rightsStatus"] }) => Promise<AssetView | null>;
  onUpdateAsset: (assetId: string, draft: AssetMetadataDraft) => Promise<AssetView | null>;
  onAssetState: (asset: AssetView, action: "archive" | "restore") => void | Promise<void>;
  onCreateSet: (input: { name: string; scope: ReferenceSet["scope"]; continuityNote: string }) => Promise<ReferenceSet | null>;
  onUpdateSet: (referenceSetId: string, input: { name: string; scope: ReferenceSet["scope"]; continuityNote: string }) => Promise<ReferenceSet | null>;
  onSetState: (referenceSet: ReferenceSet, action: "archive" | "restore") => void | Promise<void>;
  onAssign: (input: { referenceSetId: string; assetId: string; role: ReferenceAssignment["role"]; strength: number; priority: number; shotId: string; notes: string; approved: boolean }) => Promise<ReferenceSet | null>;
  onDetach: (assignmentId: string) => Promise<boolean>;
}) {
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [selectedSetId, setSelectedSetId] = useState("");
  const [assetDraft, setAssetDraft] = useState<AssetMetadataDraft>({ title: "", sourceUri: "", tags: "", note: "", rightsStatus: "pending" });
  const [importKind, setImportKind] = useState("image");
  const [importRights, setImportRights] = useState<AssetView["rightsStatus"]>("pending");
  const [setDraft, setSetDraft] = useState({ name: "", scope: "sequence" as ReferenceSet["scope"], continuityNote: "" });
  const [setEditorMode, setSetEditorMode] = useState<"new" | "edit">("new");
  const [assignment, setAssignment] = useState({ assetId: "", role: "identity" as ReferenceAssignment["role"], strength: 1, priority: 0, shotId: "", notes: "", approved: false });

  const selectedAsset = assets.find((asset) => asset.assetId === selectedAssetId) ?? null;
  const selectedSet = referenceSets.find((referenceSet) => referenceSet.referenceSetId === selectedSetId) ?? null;
  const activeAssets = assets.filter((asset) => asset.status !== "archived");
  const activeSets = referenceSets.filter((referenceSet) => referenceSet.status !== "archived");

  useEffect(() => {
    if (!selectedAssetId && activeAssets[0]) setSelectedAssetId(activeAssets[0].assetId);
  }, [activeAssets, selectedAssetId]);

  useEffect(() => {
    if (!selectedSetId && activeSets[0]) setSelectedSetId(activeSets[0].referenceSetId);
  }, [activeSets, selectedSetId]);

  useEffect(() => {
    if (selectedAsset) {
      setAssetDraft({ title: selectedAsset.title, sourceUri: selectedAsset.sourceUri ?? "", tags: selectedAsset.tags.join(", "), note: selectedAsset.note, rightsStatus: selectedAsset.rightsStatus });
      setAssignment((current) => ({ ...current, assetId: current.assetId || selectedAsset.assetId }));
    }
  }, [selectedAsset]);

  useEffect(() => {
    if (selectedSet) {
      setSetDraft({ name: selectedSet.name, scope: selectedSet.scope, continuityNote: selectedSet.continuityNote });
      setSetEditorMode("edit");
    }
  }, [selectedSet]);

  async function importFromDisk() {
    const sourcePath = await onChooseSource();
    if (!sourcePath) return;
    const imported = await onImport({ sourcePath, title: "", mediaKind: importKind, sourceUri: null, tags: [], note: "", rightsStatus: importRights });
    if (imported) setSelectedAssetId(imported.assetId);
  }

  async function saveAsset() {
    if (!selectedAsset) return;
    await onUpdateAsset(selectedAsset.assetId, assetDraft);
  }

  async function saveSet() {
    if (!setDraft.name.trim()) return;
    const saved = setEditorMode === "edit" && selectedSet
      ? await onUpdateSet(selectedSet.referenceSetId, setDraft)
      : await onCreateSet(setDraft);
    if (saved) {
      setSelectedSetId(saved.referenceSetId);
      setSetDraft({ name: saved.name, scope: saved.scope, continuityNote: saved.continuityNote });
      setSetEditorMode("edit");
    }
  }

  async function assignCurrentReference() {
    if (!selectedSet || !assignment.assetId) return;
    await onAssign({ ...assignment, referenceSetId: selectedSet.referenceSetId });
  }

  return <section className="panel asset-reference-panel" aria-label="Asset Library và Reference Sets">
    <div className="asset-reference-heading">
      <div>
        <p className="eyebrow accent">ASSET LIBRARY / REFERENCE SETS</p>
        <h2>Asset local và continuity cho shot</h2>
        <p>Nhập file có hash, quyền và path rõ ràng; sau đó gán vào reference set để prompt/Blender/Omni dùng lại đúng asset.</p>
      </div>
      <div className="asset-reference-summary"><span>PROJECT</span><strong>{projectName ?? "Chưa chọn project"}</strong><small>{activeAssets.length} asset · {activeSets.length} reference set</small></div>
    </div>
    <div className="asset-reference-grid">
      <aside className="asset-library-column">
        <div className="asset-column-toolbar"><strong>Asset local</strong><button type="button" className="small-button" onClick={() => void importFromDisk()} disabled={loading}>+ Nhập file</button></div>
        <div className="asset-import-quick"><label>Loại<select value={importKind} onChange={(event) => setImportKind(event.target.value)} disabled={loading}><option value="image">Image / frame</option><option value="video">Video</option><option value="audio">Audio</option><option value="model3d">Model 3D</option><option value="scene">Blender scene</option><option value="texture">Texture</option><option value="sketch">Sketch</option><option value="render">Render output</option><option value="subtitle">Subtitle</option><option value="document">Document</option></select></label><label>Quyền mặc định<select value={importRights} onChange={(event) => setImportRights(event.target.value as AssetView["rightsStatus"])} disabled={loading}><option value="pending">Cần review</option><option value="personal">Cá nhân</option><option value="owned">Sở hữu</option><option value="licensed">Đã cấp phép</option><option value="public_domain">Public domain</option></select></label></div>
        {assets.length === 0 ? <div className="asset-empty-state"><strong>Chưa có asset local</strong><span>Bấm “Nhập file” để app hash và ghi asset vào project.</span></div> : <div className="asset-items">{assets.map((asset) => <button type="button" key={asset.assetId} className={`asset-item ${asset.assetId === selectedAssetId ? "selected" : ""} ${asset.status === "archived" ? "archived" : ""}`} onClick={() => setSelectedAssetId(asset.assetId)} disabled={loading}><span><b>{asset.title}</b><small>{asset.kind} · {asset.status} · quyền: {asset.rightsStatus}</small><em>{asset.relativePath}</em></span><i>{asset.sha256.slice(0, 8)}</i></button>)}</div>}
      </aside>
      <div className="asset-inspector-column">
        <div className="asset-inspector-title"><div><p className="eyebrow">ASSET INSPECTOR</p><h3>{selectedAsset?.title ?? "Chọn asset để sửa"}</h3></div>{selectedAsset ? <span className={`asset-state-badge ${selectedAsset.status}`}>{selectedAsset.status}</span> : null}</div>
        {selectedAsset ? <>
          <div className="asset-facts"><span><b>SHA-256</b><code>{selectedAsset.sha256}</code></span><span><b>Path</b><code>{selectedAsset.relativePath}</code></span><span><b>MIME / size</b><code>{selectedAsset.mimeType} · {(selectedAsset.sizeBytes / 1024 / 1024).toFixed(2)} MB</code></span></div>
          <div className="asset-editor-fields"><label>Tên hiển thị<input value={assetDraft.title} onChange={(event) => setAssetDraft((current) => ({ ...current, title: event.target.value }))} disabled={loading || selectedAsset.status === "archived"} /></label><label>Quyền sử dụng<select value={assetDraft.rightsStatus} onChange={(event) => setAssetDraft((current) => ({ ...current, rightsStatus: event.target.value as AssetView["rightsStatus"] }))} disabled={loading || selectedAsset.status === "archived"}><option value="pending">Cần review</option><option value="personal">Cá nhân</option><option value="owned">Sở hữu</option><option value="licensed">Đã cấp phép</option><option value="public_domain">Public domain</option><option value="restricted">Hạn chế</option><option value="rejected">Từ chối</option></select></label><label>Tags<input value={assetDraft.tags} onChange={(event) => setAssetDraft((current) => ({ ...current, tags: event.target.value }))} disabled={loading || selectedAsset.status === "archived"} placeholder="character, desert, camera-reference" /></label><label>Nguồn URI (tuỳ chọn)<input value={assetDraft.sourceUri} onChange={(event) => setAssetDraft((current) => ({ ...current, sourceUri: event.target.value }))} disabled={loading || selectedAsset.status === "archived"} placeholder="https://… hoặc để trống" /></label><label className="asset-field-wide">Ghi chú continuity<textarea value={assetDraft.note} onChange={(event) => setAssetDraft((current) => ({ ...current, note: event.target.value }))} disabled={loading || selectedAsset.status === "archived"} placeholder="Màu, chất liệu, identity, điều phải giữ…" /></label></div>
          <div className="asset-actions"><button type="button" className="primary-button" onClick={() => void saveAsset()} disabled={loading || selectedAsset.status === "archived"}>Lưu metadata/quyền</button>{selectedAsset.status === "archived" ? <button type="button" className="secondary-button" onClick={() => void onAssetState(selectedAsset, "restore")} disabled={loading}>Khôi phục asset</button> : <button type="button" className="danger-button" onClick={() => void onAssetState(selectedAsset, "archive")} disabled={loading}>Lưu trữ asset</button>}</div>
        </> : <div className="asset-empty-state large"><strong>Inspector đang trống</strong><span>Chọn một asset hoặc nhập file mới để xem hash, quyền và metadata.</span></div>}
      </div>
    </div>
    <div className="reference-set-workspace">
      <div className="reference-set-column"><div className="asset-column-toolbar"><strong>Reference sets</strong><button type="button" className="small-button" onClick={() => { setSelectedSetId(""); setSetEditorMode("new"); setSetDraft({ name: "", scope: "sequence", continuityNote: "" }); }} disabled={loading}>+ Set mới</button></div>{referenceSets.length === 0 ? <div className="asset-empty-state"><strong>Chưa có reference set</strong><span>Tạo set theo sequence, character, object, world hoặc shot.</span></div> : <div className="reference-set-items">{referenceSets.map((referenceSet) => <button type="button" key={referenceSet.referenceSetId} className={`reference-set-item ${referenceSet.referenceSetId === selectedSetId ? "selected" : ""} ${referenceSet.status === "archived" ? "archived" : ""}`} onClick={() => setSelectedSetId(referenceSet.referenceSetId)} disabled={loading}><span><b>{referenceSet.name}</b><small>{referenceSet.scope} · {referenceSet.assignments.length} assignments · {referenceSet.status}</small></span><em>›</em></button>)}</div>}</div>
      <div className="reference-set-editor"><div className="asset-inspector-title"><div><p className="eyebrow">REFERENCE SET EDITOR</p><h3>{setEditorMode === "edit" && selectedSet ? selectedSet.name : "Tạo reference set"}</h3></div>{selectedSet ? <span className={`asset-state-badge ${selectedSet.status}`}>{selectedSet.status}</span> : null}</div><div className="asset-editor-fields"><label>Tên set<input value={setDraft.name} onChange={(event) => setSetDraft((current) => ({ ...current, name: event.target.value }))} disabled={loading || selectedSet?.status === "archived"} placeholder="Ví dụ: Main character continuity" /></label><label>Phạm vi<select value={setDraft.scope} onChange={(event) => setSetDraft((current) => ({ ...current, scope: event.target.value as ReferenceSet["scope"] }))} disabled={loading || selectedSet?.status === "archived"}><option value="sequence">Sequence</option><option value="character">Character</option><option value="object">Object</option><option value="world">World</option><option value="shot">Shot</option></select></label><label className="asset-field-wide">Continuity note<textarea value={setDraft.continuityNote} onChange={(event) => setSetDraft((current) => ({ ...current, continuityNote: event.target.value }))} disabled={loading || selectedSet?.status === "archived"} placeholder="Điều phải giữ xuyên suốt các shot…" /></label></div><div className="asset-actions"><button type="button" className="primary-button" onClick={() => void saveSet()} disabled={loading || !setDraft.name.trim() || selectedSet?.status === "archived"}>{setEditorMode === "edit" ? "Lưu set" : "Tạo set"}</button>{selectedSet ? selectedSet.status === "archived" ? <button type="button" className="secondary-button" onClick={() => void onSetState(selectedSet, "restore")} disabled={loading}>Khôi phục set</button> : <button type="button" className="danger-button" onClick={() => void onSetState(selectedSet, "archive")} disabled={loading}>Lưu trữ set</button> : null}</div></div>
      <div className="reference-assignment-editor"><div className="asset-inspector-title"><div><p className="eyebrow">ASSIGNMENT / SHOT CONTINUITY</p><h3>Gán asset vào set</h3></div><span className="asset-state-badge info">HASHED</span></div>{selectedSet ? <><div className="asset-editor-fields"><label>Asset<select value={assignment.assetId} onChange={(event) => setAssignment((current) => ({ ...current, assetId: event.target.value }))} disabled={loading || selectedSet.status === "archived"}><option value="">Chọn asset…</option>{activeAssets.map((asset) => <option value={asset.assetId} key={asset.assetId}>{asset.title} · {asset.kind}</option>)}</select></label><label>Vai trò<select value={assignment.role} onChange={(event) => setAssignment((current) => ({ ...current, role: event.target.value as ReferenceAssignment["role"] }))} disabled={loading || selectedSet.status === "archived"}><option value="identity">Identity</option><option value="composition">Composition / layout</option><option value="pose">Pose / action</option><option value="camera">Camera / lens</option><option value="style">Style / material</option><option value="start_frame">Start frame</option><option value="end_frame">End frame</option><option value="negative">Negative / avoid</option></select></label><label>Strength<input type="number" min="0" max="1" step="0.05" value={assignment.strength} onChange={(event) => setAssignment((current) => ({ ...current, strength: Number(event.target.value) }))} disabled={loading || selectedSet.status === "archived"} /></label><label>Priority<input type="number" min="0" step="1" value={assignment.priority} onChange={(event) => setAssignment((current) => ({ ...current, priority: Number(event.target.value) }))} disabled={loading || selectedSet.status === "archived"} /></label><label>Shot ID (tuỳ chọn)<input value={assignment.shotId} onChange={(event) => setAssignment((current) => ({ ...current, shotId: event.target.value }))} disabled={loading || selectedSet.status === "archived"} placeholder="shot-01" /></label><label className="asset-field-wide">Ghi chú assignment<textarea value={assignment.notes} onChange={(event) => setAssignment((current) => ({ ...current, notes: event.target.value }))} disabled={loading || selectedSet.status === "archived"} placeholder="Cách dùng reference này trong shot…" /></label></div><label className="assignment-approval"><input type="checkbox" checked={assignment.approved} onChange={(event) => setAssignment((current) => ({ ...current, approved: event.target.checked }))} disabled={loading || selectedSet.status === "archived"} /> Đã duyệt để workflow dùng</label><button type="button" className="primary-button" onClick={() => void assignCurrentReference()} disabled={loading || selectedSet.status === "archived" || !assignment.assetId}>Gán reference</button><div className="assignment-list">{selectedSet.assignments.length === 0 ? <span className="muted-copy">Set chưa có assignment.</span> : selectedSet.assignments.map((item) => { const asset = assets.find((candidate) => candidate.assetId === item.assetId); return <div className="assignment-row" key={item.assignmentId}><span><b>{asset?.title ?? item.assetId}</b><small>{item.role} · strength {item.strength} · {item.approved ? "đã duyệt" : "chờ duyệt"}</small></span><button type="button" className="small-button" onClick={() => void onDetach(item.assignmentId)} disabled={loading}>Tháo</button></div>; })}</div></> : <div className="asset-empty-state large"><strong>Chưa chọn reference set</strong><span>Chọn hoặc tạo set để gán asset.</span></div>}</div>
    </div>
  </section>;
}
