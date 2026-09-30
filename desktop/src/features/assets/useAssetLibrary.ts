import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { AssetMetadataDraft, AssetPackAcceptanceCheck, AssetPackBlenderBindingReport, AssetPackBlenderBindingRunReport, AssetPackReview, AssetPackReviewItem, AssetView, ReferenceAssignment, ReferenceSet } from "./assetTypes";
import type { AppActivityRecorder, AppActivityUpdater, AppNotice, AppStateSetter } from "../shared/appTypes";
import { useState } from "react";

export function useAssetLibrary({ recordWorkspaceActivity, selectedProjectId, setLoading, setNotice, updateWorkspaceActivity }: {
  recordWorkspaceActivity: AppActivityRecorder;
  selectedProjectId: string;
  setLoading: AppStateSetter<boolean>;
  setNotice: AppNotice;
  updateWorkspaceActivity: AppActivityUpdater;
}) {
  const [assets, setAssets] = useState<AssetView[]>([]);

  const [referenceSets, setReferenceSets] = useState<ReferenceSet[]>([]);

  const [assetPackReviews, setAssetPackReviews] = useState<AssetPackReview[]>([]);

  const [assetPackBlenderBinding, setAssetPackBlenderBinding] = useState<AssetPackBlenderBindingReport | null>(null);

  const [assetPackBlenderRun, setAssetPackBlenderRun] = useState<AssetPackBlenderBindingRunReport | null>(null);

  async function loadAssetsAndReferenceSets(projectId = selectedProjectId) {
    if (!projectId) {
      setAssets([]);
      setReferenceSets([]);
      setAssetPackReviews([]);
      setAssetPackBlenderBinding(null);
      setAssetPackBlenderRun(null);
      return;
    }
    try {
      const [nextAssets, nextReferenceSets, nextAssetPacks] = await Promise.all([
        invoke<AssetView[]>("list_assets", { projectId, includeArchived: true }),
        invoke<ReferenceSet[]>("list_reference_sets", { projectId, includeArchived: true }),
        invoke<AssetPackReview[]>("list_asset_pack_reviews", { projectId }),
      ]);
      setAssets(nextAssets);
      setReferenceSets(nextReferenceSets);
      setAssetPackReviews(nextAssetPacks);
      setAssetPackBlenderBinding(null);
      setAssetPackBlenderRun(null);
    } catch (error) {
      const message = `Không tải được asset/reference/Asset Pack: ${String(error).slice(0, 240)}`;
      setNotice(message);
      recordWorkspaceActivity({ stage: "asset_library.load", tool: "Asset Library", state: "error", message, nextAction: "Kiểm tra project/database rồi thử làm mới." });
    }
  }

  async function chooseAssetSource(): Promise<string | null> {
    try {
      const selected = await open({
        multiple: false,
        title: "Chọn asset reference local",
        filters: [{ name: "Reference assets", extensions: ["png", "jpg", "jpeg", "webp", "gif", "mp4", "mov", "webm", "wav", "mp3", "flac", "m4a", "ogg", "glb", "gltf", "obj", "fbx", "blend", "srt", "vtt", "ass", "pdf", "md", "json"] }],
      });
      if (typeof selected === "string") return selected;
      return null;
    } catch {
      setNotice("Không mở được hộp thoại chọn asset.");
      return null;
    }
  }

  async function chooseAssetPackSource(): Promise<string | null> {
    try {
      const selected = await open({
        multiple: false,
        title: "Chọn asset-pack.json trong workspace project",
        filters: [{ name: "Auto3Dvideo Asset Pack", extensions: ["json"] }],
      });
      return typeof selected === "string" ? selected : null;
    } catch {
      setNotice("Không mở được hộp thoại chọn Asset Pack.");
      return null;
    }
  }

  async function registerAssetPackSource(packPath: string): Promise<AssetPackReview[] | null> {
    if (!selectedProjectId) return null;
    try {
      const packs = await invoke<AssetPackReview[]>("register_asset_pack_source", { input: { projectId: selectedProjectId, packPath } });
      setAssetPackReviews(packs);
      setNotice(`Đã nạp Asset Pack; ${packs.reduce((count, pack) => count + pack.items.length, 0)} item đang chờ review.`);
      recordWorkspaceActivity({ stage: "asset_pack.register", tool: "Asset Pack Review", state: "success", message: `Đã nạp Asset Pack từ ${packs.find((pack) => pack.source.packRelativePath)?.source.packRelativePath ?? packPath}.`, output: packPath, nextAction: "Review từng item, pass checklist và quyền trước khi approve." });
      return packs;
    } catch (error) {
      const message = `Không nạp được Asset Pack: ${String(error).slice(0, 360)}`;
      setNotice(message);
      recordWorkspaceActivity({ stage: "asset_pack.register", tool: "Asset Pack Review", state: "error", message, nextAction: "Chọn đúng asset-pack.json có asset-items.json cùng thư mục." });
      return null;
    }
  }

  async function updateAssetPackItemReview(input: { packId: string; assetItemId: string; reviewState: AssetPackReviewItem["reviewState"]; rightsStatus: AssetView["rightsStatus"]; acceptanceChecks: AssetPackAcceptanceCheck[]; note: string }): Promise<AssetPackReview | null> {
    if (!selectedProjectId) return null;
    try {
      const updated = await invoke<AssetPackReview>("update_asset_pack_item_review", { input: { projectId: selectedProjectId, ...input } });
      setAssetPackReviews((current) => current.map((pack) => pack.packId === updated.packId ? updated : pack));
      const item = updated.items.find((candidate) => candidate.assetItemId === input.assetItemId);
      const message = item?.reviewState === "approved" ? `Đã approve asset “${item.title}”; output và hash không bị ghi đè.` : `Đã lưu review asset “${item?.title ?? input.assetItemId}”.`;
      setNotice(message);
      recordWorkspaceActivity({ stage: "asset_pack.item_review", tool: "Asset Pack Review", state: "success", message, output: `asset-pack:${updated.packId}/${input.assetItemId}`, nextAction: item?.reviewState === "approved" ? "Chỉ dùng asset approved để bind Blender/shot." : "Hoàn thành checklist và quyền rồi approve." });
      return updated;
    } catch (error) {
      const message = `Không lưu được review Asset Pack: ${String(error).slice(0, 360)}`;
      setNotice(message);
      recordWorkspaceActivity({ stage: "asset_pack.item_review", tool: "Asset Pack Review", state: "error", message, nextAction: "Kiểm tra quyền và các acceptance checks bắt buộc." });
      return null;
    }
  }

  async function prepareAssetPackBlenderBinding(packId: string): Promise<AssetPackBlenderBindingReport | null> {
    if (!selectedProjectId) return null;
    try {
      setAssetPackBlenderBinding(null);
      setAssetPackBlenderRun(null);
      setNotice("Đang kiểm tra approved asset, hash, scale và continuity trước khi tạo Blender job…");
      const report = await invoke<AssetPackBlenderBindingReport>("prepare_asset_pack_blender_binding", { projectId: selectedProjectId, packId });
      setAssetPackBlenderBinding(report);
      const message = report.status === "ready_for_blender_review"
        ? `Đã chuẩn bị Blender binding ${report.bindingId}; chưa chạy Blender.`
        : `Blender binding bị chặn: ${report.blockers.slice(0, 2).join("; ") || "Asset Pack chưa đạt gate"}.`;
      setNotice(message);
      recordWorkspaceActivity({ stage: "asset_pack.blender_binding", tool: "Blender binding", state: report.status === "ready_for_blender_review" ? "success" : "blocked", message, output: report.bindingPath ?? report.jobPath ?? report.bindingId, nextAction: report.status === "ready_for_blender_review" ? "Mở binding/job JSON để review rồi mới cho phép chạy Blender preview." : "Approve đủ item, kiểm tra quyền/hash/scale/continuity rồi thử lại." });
      return report;
    } catch (error) {
      const message = `Không chuẩn bị được Blender binding: ${String(error).slice(0, 360)}`;
      setNotice(message);
      recordWorkspaceActivity({ stage: "asset_pack.blender_binding", tool: "Blender binding", state: "error", message, nextAction: "Kiểm tra Asset Pack source, output file và database review." });
      return null;
    }
  }

  async function runAssetPackBlenderBinding(bindingId: string): Promise<AssetPackBlenderBindingRunReport | null> {
    if (!selectedProjectId) return null;
    setLoading(true);
    try {
      setAssetPackBlenderRun(null);
      setNotice("Đang chạy Blender reference preview local; app sẽ kiểm tra đủ scene, report và frame output trước khi báo thành công…");
      const report = await invoke<AssetPackBlenderBindingRunReport>("run_asset_pack_blender_binding", { projectId: selectedProjectId, bindingId });
      setAssetPackBlenderRun(report);
      setNotice(report.message);
      recordWorkspaceActivity({ stage: "asset_pack.blender_binding.preview", tool: "Blender", state: "success", message: report.message, output: report.reportPath, nextAction: "Mở các frame preview và duyệt chất lượng/reference trước khi dựng final." });
      return report;
    } catch (error) {
      const message = `Không chạy được Blender preview: ${String(error).slice(0, 360)}`;
      setNotice(message);
      recordWorkspaceActivity({ stage: "asset_pack.blender_binding.preview", tool: "Blender", state: "error", message, nextAction: "Kiểm tra Blender đã được cấu hình, binding còn mới và output chưa tồn tại." });
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function importAsset(input: { sourcePath: string; title: string; mediaKind: string; sourceUri: string | null; tags: string[]; note: string; rightsStatus: AssetView["rightsStatus"] }): Promise<AssetView | null> {
    if (!selectedProjectId) {
      const message = "Chưa có project để nhập asset.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "asset.import.validate", tool: "Asset Library", state: "blocked", message, nextAction: "Tạo hoặc chọn project local." });
      return null;
    }
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "asset.import", tool: "Asset Library", state: "running", message: `Đang kiểm tra, hash và nhập asset “${input.title.trim() || "chưa đặt tên"}”.`, progress: 0 });
    setLoading(true);
    try {
      const asset = await invoke<AssetView>("import_asset", { input: { ...input, projectId: selectedProjectId } });
      setAssets((current) => [asset, ...current.filter((item) => item.assetId !== asset.assetId)]);
      const message = asset.status === "quarantined" ? `Đã nhập asset ${asset.title}; đang quarantine vì quyền là ${asset.rightsStatus}.` : `Đã nhập asset ${asset.title}; SHA-256 đã được lưu.`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, output: asset.relativePath, nextAction: "Sửa quyền/metadata rồi gán asset vào reference set." });
      return asset;
    } catch (error) {
      const message = `Không nhập được asset: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra file, loại asset, quyền và workspace rồi thử lại." });
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function updateAssetMetadata(assetId: string, draft: AssetMetadataDraft): Promise<AssetView | null> {
    if (!selectedProjectId) return null;
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "asset.metadata.update", tool: "Asset Library", state: "running", message: "Đang lưu metadata/quyền asset; hash và đường dẫn bất biến.", progress: 0 });
    setLoading(true);
    try {
      const asset = await invoke<AssetView>("update_asset_metadata", { input: { projectId: selectedProjectId, assetId, title: draft.title, sourceUri: draft.sourceUri.trim() || null, tags: draft.tags.split(",").map((value) => value.trim()).filter(Boolean), note: draft.note, rightsStatus: draft.rightsStatus } });
      setAssets((current) => current.map((item) => item.assetId === asset.assetId ? asset : item));
      const message = `Đã lưu metadata asset “${asset.title}”.`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, output: `asset:${asset.assetId}`, nextAction: "Kiểm tra quyền rồi gán vào reference set nếu đã sẵn sàng." });
      return asset;
    } catch (error) {
      const message = `Không lưu được metadata asset: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Sửa trường bị lỗi rồi thử lưu lại." });
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function changeAssetState(asset: AssetView, action: "archive" | "restore") {
    if (!selectedProjectId) return;
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: `asset.${action}`, tool: "Asset Library", state: "running", message: `Đang ${action === "archive" ? "lưu trữ" : "khôi phục"} asset “${asset.title}”.`, progress: 0 });
    setLoading(true);
    try {
      const updated = await invoke<AssetView>(action === "archive" ? "archive_asset" : "restore_asset", { projectId: selectedProjectId, assetId: asset.assetId });
      setAssets((current) => current.map((item) => item.assetId === updated.assetId ? updated : item));
      const message = `Đã ${action === "archive" ? "lưu trữ" : "khôi phục"} asset “${updated.title}”.`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, output: `asset:${updated.assetId}`, nextAction: action === "archive" ? "Khôi phục nếu workflow cần asset này." : "Kiểm tra quyền trước khi dùng cho generation." });
    } catch (error) {
      const message = `Không thể ${action === "archive" ? "lưu trữ" : "khôi phục"} asset: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra log workspace và thử lại." });
    } finally {
      setLoading(false);
    }
  }

  async function createReferenceSet(input: { name: string; scope: ReferenceSet["scope"]; continuityNote: string }): Promise<ReferenceSet | null> {
    if (!selectedProjectId) return null;
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "reference_set.create", tool: "Reference Set", state: "running", message: `Đang tạo reference set “${input.name.trim() || "chưa đặt tên"}”.`, progress: 0 });
    setLoading(true);
    try {
      const set = await invoke<ReferenceSet>("create_reference_set", { input: { ...input, projectId: selectedProjectId } });
      setReferenceSets((current) => [set, ...current.filter((item) => item.referenceSetId !== set.referenceSetId)]);
      const message = `Đã tạo reference set “${set.name}”.`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, output: `reference_set:${set.referenceSetId}`, nextAction: "Chọn asset rồi gán vai trò reference cho set." });
      return set;
    } catch (error) {
      const message = `Không tạo được reference set: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Sửa tên/phạm vi set rồi thử lại." });
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function updateReferenceSet(referenceSetId: string, input: { name: string; scope: ReferenceSet["scope"]; continuityNote: string }): Promise<ReferenceSet | null> {
    if (!selectedProjectId) return null;
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "reference_set.update", tool: "Reference Set", state: "running", message: "Đang lưu cấu hình reference set.", progress: 0 });
    setLoading(true);
    try {
      const set = await invoke<ReferenceSet>("update_reference_set", { referenceSetId, input: { ...input, projectId: selectedProjectId } });
      setReferenceSets((current) => current.map((item) => item.referenceSetId === set.referenceSetId ? set : item));
      const message = `Đã cập nhật reference set “${set.name}”.`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, output: `reference_set:${set.referenceSetId}`, nextAction: "Kiểm tra assignments và dùng set cho shot workflow." });
      return set;
    } catch (error) {
      const message = `Không cập nhật được reference set: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Sửa trường bị lỗi rồi thử lại." });
      return null;
    } finally { setLoading(false); }
  }

  async function changeReferenceSetState(referenceSet: ReferenceSet, action: "archive" | "restore") {
    if (!selectedProjectId) return;
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: `reference_set.${action}`, tool: "Reference Set", state: "running", message: `Đang ${action === "archive" ? "lưu trữ" : "khôi phục"} reference set “${referenceSet.name}”.`, progress: 0 });
    setLoading(true);
    try {
      const updated = await invoke<ReferenceSet>(action === "archive" ? "archive_reference_set" : "restore_reference_set", { projectId: selectedProjectId, referenceSetId: referenceSet.referenceSetId });
      setReferenceSets((current) => current.map((item) => item.referenceSetId === updated.referenceSetId ? updated : item));
      const message = `Đã ${action === "archive" ? "lưu trữ" : "khôi phục"} reference set “${updated.name}”.`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, output: `reference_set:${updated.referenceSetId}`, nextAction: action === "archive" ? "Khôi phục nếu workflow cần set này." : "Tiếp tục gán asset cho set." });
    } catch (error) {
      const message = `Không thể ${action === "archive" ? "lưu trữ" : "khôi phục"} reference set: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra log workspace và thử lại." });
    } finally { setLoading(false); }
  }

  async function assignReference(input: { referenceSetId: string; assetId: string; role: ReferenceAssignment["role"]; strength: number; priority: number; shotId: string; notes: string; approved: boolean }): Promise<ReferenceSet | null> {
    if (!selectedProjectId) return null;
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "reference.assign", tool: "Reference Set", state: "running", message: "Đang gán asset vào reference set và chụp hash continuity.", progress: 0 });
    setLoading(true);
    try {
      const set = await invoke<ReferenceSet>("assign_reference", { input: { projectId: selectedProjectId, referenceSetId: input.referenceSetId, assetId: input.assetId, role: input.role, strength: input.strength, priority: input.priority, shotId: input.shotId.trim() || null, shotRangeStart: null, shotRangeEnd: null, crop: null, notes: input.notes, approved: input.approved } });
      setReferenceSets((current) => current.map((item) => item.referenceSetId === set.referenceSetId ? set : item));
      const message = `Đã gán asset vào set “${set.name}”.`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, output: `reference_set:${set.referenceSetId}`, nextAction: "Dùng reference set này khi compose shot; hash đã được giữ để phát hiện drift." });
      return set;
    } catch (error) {
      const message = `Không gán được reference: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra asset/set và vai trò reference rồi thử lại." });
      return null;
    } finally { setLoading(false); }
  }

  async function detachReference(assignmentId: string): Promise<boolean> {
    if (!selectedProjectId) return false;
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "reference.detach", tool: "Reference Set", state: "running", message: "Đang tháo asset khỏi reference set.", progress: 0 });
    setLoading(true);
    try {
      await invoke("detach_reference", { projectId: selectedProjectId, assignmentId });
      await loadAssetsAndReferenceSets(selectedProjectId);
      const message = "Đã tháo reference assignment.";
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Chọn asset khác nếu shot cần reference mới." });
      return true;
    } catch (error) {
      const message = `Không tháo được reference: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra assignment và thử lại." });
      return false;
    } finally { setLoading(false); }
  }

  return {
    assetPackBlenderBinding,
    assetPackBlenderRun,
    assetPackReviews,
    assets,
    assignReference,
    changeAssetState,
    changeReferenceSetState,
    chooseAssetPackSource,
    chooseAssetSource,
    createReferenceSet,
    detachReference,
    importAsset,
    loadAssetsAndReferenceSets,
    prepareAssetPackBlenderBinding,
    referenceSets,
    registerAssetPackSource,
    runAssetPackBlenderBinding,
    setAssetPackBlenderBinding,
    setAssetPackBlenderRun,
    setAssetPackReviews,
    setAssets,
    setReferenceSets,
    updateAssetMetadata,
    updateAssetPackItemReview,
    updateReferenceSet,
  };
}
