import { useEffect, useState } from "react";
import type { PromptPreset, PromptPresetDraft, PromptStudioActivity } from "./promptTypes";

export function PromptStudioPanel({
  projectId,
  projectName,
  presets,
  topic,
  contentGoal,
  selectedProfileName,
  selectedAudience,
  loading,
  onActivity,
  onNotice,
  onCreate,
  onUpdate,
  onArchive,
  onRestore,
  onApply,
}: {
  projectId: string;
  projectName?: string;
  presets: PromptPreset[];
  topic: string;
  contentGoal: string;
  selectedProfileName: string;
  selectedAudience: string;
  loading: boolean;
  onActivity: (event: PromptStudioActivity) => void;
  onNotice: (message: string) => void;
  onCreate: (draft: PromptPresetDraft) => Promise<PromptPreset | null>;
  onUpdate: (presetId: string, draft: PromptPresetDraft) => Promise<PromptPreset | null>;
  onArchive: (preset: PromptPreset) => void;
  onRestore: (preset: PromptPreset) => void;
  onApply: (draft: PromptPresetDraft, presetName: string) => void;
}) {
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [draft, setDraft] = useState<PromptPresetDraft>({
    name: "Preset cinematic mới",
    description: "Prompt riêng cho shot 3D và video cinematic.",
    scope: "project",
    status: "active",
    version: "v1.0.0",
    template: "Chủ đề: {{topic}}\nProfile: {{topic_profile}}\nĐối tượng: {{audience}}\nMục tiêu: {{content_goal}}\n\nThiết kế shot cinematic 3D có subject rõ, action theo thời gian, camera/lens, ánh sáng, chất liệu, continuity và output dùng được cho Blender/Omni.",
    variableKeys: ["topic", "topic_profile", "audience", "content_goal"],
    negativeTemplate: "no random objects, no text artifacts, no logo, no flicker, no broken geometry",
    providerTargets: ["blender-local", "google-flow-omni"],
    styleBibleId: null,
    rightsLicenseNote: "Dùng asset local hoặc asset có quyền; cần review trước generation/delivery.",
    parentPresetId: null,
  });
  const [editorMessage, setEditorMessage] = useState("Chọn preset để sửa hoặc bấm Preset mới để bắt đầu.");

  function draftFromPreset(preset: PromptPreset): PromptPresetDraft {
    return {
      name: preset.name,
      description: preset.description,
      scope: preset.scope,
      status: preset.status === "archived" ? "active" : preset.status,
      version: preset.version,
      template: preset.template,
      variableKeys: [...preset.variableKeys],
      negativeTemplate: preset.negativeTemplate,
      providerTargets: [...preset.providerTargets],
      styleBibleId: preset.styleBibleId,
      rightsLicenseNote: preset.rightsLicenseNote,
      parentPresetId: preset.presetId,
    };
  }

  useEffect(() => {
    if (!selectedPresetId && presets[0]) {
      setSelectedPresetId(presets[0].presetId);
      setDraft(draftFromPreset(presets[0]));
      setEditorMessage(`Đang chỉnh ${presets[0].name} · ${presets[0].version}.`);
    }
  }, [presets, selectedPresetId]);

  function selectPreset(preset: PromptPreset) {
    setSelectedPresetId(preset.presetId);
    setDraft(draftFromPreset(preset));
    setEditorMessage(preset.status === "archived" ? "Preset đang lưu trữ; khôi phục trước khi lưu phiên bản mới." : `Đang chỉnh ${preset.name} · ${preset.version}.`);
  }

  function startNewPreset() {
    setSelectedPresetId("");
    setDraft((current) => ({ ...current, name: "Preset cinematic mới", description: "", version: "v1.0.0", status: "active", parentPresetId: null }));
    setEditorMessage("Preset mới chưa lưu. Điền prompt rồi bấm Lưu preset.");
    onNotice("Đã mở form preset mới; chưa ghi dữ liệu.");
    onActivity({ stage: "prompt_preset.compose", tool: "Prompt Studio", state: "info", message: "Đã mở form prompt preset mới; chưa lưu và chưa gọi provider.", nextAction: "Điền prompt rồi bấm Lưu preset." });
  }

  function duplicateSelectedPreset() {
    if (!selectedPreset || selectedPreset.status === "archived") return;
    const copied = draftFromPreset(selectedPreset);
    setSelectedPresetId("");
    setDraft({ ...copied, name: `${selectedPreset.name} (bản sao)`, version: "v1.0.0", parentPresetId: selectedPreset.presetId });
    setEditorMessage(`Đã tạo bản nháp sao chép từ ${selectedPreset.name}; chưa lưu.`);
    onNotice("Đã tạo bản nháp sao chép; bấm Lưu preset để ghi vào project.");
    onActivity({ stage: "prompt_preset.duplicate", tool: "Prompt Studio", state: "info", message: `Đã sao chép prompt preset “${selectedPreset.name}”; chưa ghi dữ liệu.`, nextAction: "Kiểm tra tên/prompt rồi bấm Lưu preset." });
  }

  function updateDraft<K extends keyof PromptPresetDraft>(key: K, value: PromptPresetDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function saveDraft() {
    if (!projectId) {
      const message = "Chưa có project; không thể lưu preset.";
      setEditorMessage(message);
      onNotice(message);
      onActivity({ stage: "prompt_preset.validate", tool: "Prompt Studio", state: "blocked", message, nextAction: "Tạo hoặc chọn project local." });
      return;
    }
    if (!draft.name.trim() || !draft.template.trim()) {
      const message = "Tên preset và prompt không được để trống.";
      setEditorMessage(message);
      onNotice(message);
      onActivity({ stage: "prompt_preset.validate", tool: "Prompt Studio", state: "blocked", message, nextAction: "Bổ sung tên và prompt trước khi lưu." });
      return;
    }
    const saved = selectedPresetId ? await onUpdate(selectedPresetId, draft) : await onCreate(draft);
    if (saved) {
      setSelectedPresetId(saved.presetId);
      setDraft(draftFromPreset(saved));
      setEditorMessage(`Đã lưu ${saved.name} · ${saved.version}.`);
    }
  }

  const selectedPreset = presets.find((preset) => preset.presetId === selectedPresetId);
  const canEditSelected = Boolean(selectedPreset && selectedPreset.status !== "archived");

  return <section className="panel prompt-studio-panel" aria-label="Prompt Studio">
    <div className="prompt-studio-heading">
      <div>
        <p className="eyebrow accent">PROMPT STUDIO / PRESET CRUD</p>
        <h2>Prompt của bạn, lưu theo project</h2>
        <p>Viết prompt dài, lưu phiên bản và áp dụng thẳng vào brief. Nút nào cũng ghi rõ trạng thái vào workspace log.</p>
      </div>
      <div className="prompt-studio-project"><span>PROJECT</span><strong>{projectName ?? "Chưa chọn project"}</strong><small>{presets.length} bản prompt đã lưu</small></div>
    </div>
    <div className="prompt-studio-grid">
      <aside className="prompt-preset-list" aria-label="Danh sách prompt preset">
        <div className="prompt-list-heading"><strong>Preset đã lưu</strong><button type="button" className="small-button" onClick={startNewPreset} disabled={loading}>+ Preset mới</button></div>
        {presets.length === 0 ? <div className="prompt-empty-state"><strong>Chưa có preset</strong><span>Preset đầu tiên sẽ được lưu vào SQLite của project này.</span></div> : <div className="prompt-preset-items">{presets.map((preset) => <button type="button" key={preset.presetId} className={`prompt-preset-item ${preset.presetId === selectedPresetId ? "selected" : ""} ${preset.status === "archived" ? "archived" : ""}`} onClick={() => selectPreset(preset)} disabled={loading}><span><b>{preset.name}</b><small>{preset.version} · {preset.status === "archived" ? "Lưu trữ" : "Đang dùng"}</small></span><em>›</em></button>)}</div>}
      </aside>
      <div className="prompt-preset-editor">
        <div className="prompt-editor-toolbar"><div><strong>{selectedPreset ? (canEditSelected ? "Chỉnh prompt / tạo phiên bản mới" : "Preset đang lưu trữ") : "Tạo prompt preset mới"}</strong><span>{editorMessage}</span></div><span className={`prompt-editor-state ${selectedPreset?.status ?? "draft"}`}>{selectedPreset?.version ?? "CHƯA LƯU"}</span></div>
        <div className="prompt-editor-fields">
          <label>Tên preset<input value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} disabled={loading || Boolean(selectedPreset && !canEditSelected)} placeholder="Ví dụ: Deep ocean cinematic" /></label>
          <label>Version<input value={draft.version} onChange={(event) => updateDraft("version", event.target.value)} disabled={loading || Boolean(selectedPreset && !canEditSelected)} placeholder="v1.0.0" /></label>
          <label className="prompt-field-wide">Mô tả ngắn<input value={draft.description} onChange={(event) => updateDraft("description", event.target.value)} disabled={loading || Boolean(selectedPreset && !canEditSelected)} placeholder="Preset này dùng cho loại shot nào?" /></label>
          <label>Scope<select value={draft.scope} onChange={(event) => updateDraft("scope", event.target.value as PromptPresetDraft["scope"])} disabled={loading || Boolean(selectedPreset && !canEditSelected)}><option value="project">Project</option><option value="user">User profile</option></select></label>
          <label>Trạng thái<select value={draft.status} onChange={(event) => updateDraft("status", event.target.value as PromptPresetDraft["status"])} disabled={loading || Boolean(selectedPreset && !canEditSelected)}><option value="active">Đang dùng</option><option value="draft">Bản nháp</option></select></label>
          <label className="prompt-field-wide">Biến được phép <input value={draft.variableKeys.join(", ")} onChange={(event) => updateDraft("variableKeys", event.target.value.split(",").map((value) => value.trim()).filter(Boolean))} disabled={loading || Boolean(selectedPreset && !canEditSelected)} placeholder="topic, topic_profile, audience, content_goal" /></label>
          <label className="prompt-field-wide">Prompt chính<textarea className="prompt-main-editor" value={draft.template} onChange={(event) => updateDraft("template", event.target.value)} disabled={loading || Boolean(selectedPreset && !canEditSelected)} placeholder="Viết prompt đầy đủ: subject, action, camera, lens, lighting, material, continuity, render/style…" /></label>
          <label>Negative constraints<textarea value={draft.negativeTemplate} onChange={(event) => updateDraft("negativeTemplate", event.target.value)} disabled={loading || Boolean(selectedPreset && !canEditSelected)} placeholder="no flicker, no text, no broken geometry…" /></label>
          <label>Provider targets<input value={draft.providerTargets.join(", ")} onChange={(event) => updateDraft("providerTargets", event.target.value.split(",").map((value) => value.trim()).filter(Boolean))} disabled={loading || Boolean(selectedPreset && !canEditSelected)} placeholder="blender-local, google-flow-omni" /></label>
          <label className="prompt-field-wide">Ghi chú quyền / license<input value={draft.rightsLicenseNote} onChange={(event) => updateDraft("rightsLicenseNote", event.target.value)} disabled={loading || Boolean(selectedPreset && !canEditSelected)} placeholder="Nguồn asset, phạm vi dùng, cần review gì…" /></label>
        </div>
        <div className="prompt-variable-preview"><span>Đang dùng brief:</span><b>{topic.trim() || "Chưa nhập chủ đề"}</b><small>{selectedProfileName || "Chưa chọn profile"} · {selectedAudience || "Chưa có audience"} · {contentGoal.trim() || "Chưa có mục tiêu"}</small></div>
        <div className="prompt-editor-actions">
          <button type="button" className="primary-button" onClick={() => void saveDraft()} disabled={loading || Boolean(selectedPreset && !canEditSelected)}>{loading ? "Đang lưu…" : selectedPreset ? "Lưu phiên bản mới" : "Lưu preset"}</button>
          <button type="button" className="secondary-button" onClick={() => onApply(draft, selectedPreset?.name ?? draft.name)} disabled={loading || !draft.template.trim()}>Áp dụng vào brief</button>
          {selectedPreset && selectedPreset.status !== "archived" ? <button type="button" className="secondary-button" onClick={duplicateSelectedPreset} disabled={loading}>Nhân bản</button> : null}
          {selectedPreset?.status === "archived" ? <button type="button" className="secondary-button" onClick={() => onRestore(selectedPreset)} disabled={loading}>Khôi phục preset</button> : selectedPreset ? <button type="button" className="danger-button" onClick={() => onArchive(selectedPreset)} disabled={loading}>Lưu trữ</button> : null}
        </div>
      </div>
    </div>
  </section>;
}
