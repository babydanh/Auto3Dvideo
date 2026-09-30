import { invoke } from "@tauri-apps/api/core";
import type { PromptPreset, PromptPresetDraft } from "./promptTypes";
import type { AppActivityRecorder, AppActivityUpdater, AppNotice, AppStateSetter } from "../shared/appTypes";
import type { TopicProfile } from "../topic/topicTypes";
import { useState } from "react";

export function usePromptPresets({ contentGoal, recordWorkspaceActivity, selectedProjectId, selectedTopicProfile, setAdditionalPrompt, setLoading, setNotice, topic, updateWorkspaceActivity }: {
  contentGoal: string;
  recordWorkspaceActivity: AppActivityRecorder;
  selectedProjectId: string;
  selectedTopicProfile: TopicProfile | undefined;
  setAdditionalPrompt: AppStateSetter<string>;
  setLoading: AppStateSetter<boolean>;
  setNotice: AppNotice;
  topic: string;
  updateWorkspaceActivity: AppActivityUpdater;
}) {
  const [promptPresets, setPromptPresets] = useState<PromptPreset[]>([]);

  async function loadPromptPresets(projectId = selectedProjectId) {
    if (!projectId) {
      setPromptPresets([]);
      return;
    }
    try {
      const presets = await invoke<PromptPreset[]>("list_prompt_presets", { projectId, includeArchived: true });
      setPromptPresets(presets);
    } catch (error) {
      const message = `Không tải được prompt preset: ${String(error).slice(0, 240)}`;
      setNotice(message);
      recordWorkspaceActivity({ stage: "prompt_preset.load", tool: "Prompt Studio", state: "error", message, nextAction: "Kiểm tra project/database rồi thử làm mới." });
    }
  }

  async function createPromptPreset(draft: PromptPresetDraft): Promise<PromptPreset | null> {
    if (!selectedProjectId) {
      const message = "Chưa có project để lưu prompt preset.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "prompt_preset.validate", tool: "Prompt Studio", state: "blocked", message, nextAction: "Tạo hoặc chọn project local." });
      return null;
    }
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "prompt_preset.create", tool: "Prompt Studio", state: "running", message: `Đang lưu preset “${draft.name.trim() || "chưa đặt tên"}” vào project local.`, progress: 0 });
    setLoading(true);
    try {
      const preset = await invoke<PromptPreset>("create_prompt_preset", { input: { ...draft, projectId: selectedProjectId } });
      setPromptPresets((current) => [preset, ...current.filter((item) => item.presetId !== preset.presetId)]);
      const message = `Đã lưu prompt preset “${preset.name}” ${preset.version}.`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, output: `prompt_preset:${preset.presetId}`, nextAction: "Áp dụng preset vào brief hoặc tiếp tục chỉnh prompt." });
      return preset;
    } catch (error) {
      const message = `Không lưu được prompt preset: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Sửa trường bị lỗi rồi thử lưu lại." });
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function updatePromptPreset(presetId: string, draft: PromptPresetDraft): Promise<PromptPreset | null> {
    if (!selectedProjectId) {
      const message = "Chưa có project để lưu phiên bản prompt.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "prompt_preset.validate", tool: "Prompt Studio", state: "blocked", message, nextAction: "Tạo hoặc chọn project local." });
      return null;
    }
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "prompt_preset.update", tool: "Prompt Studio", state: "running", message: `Đang lưu phiên bản mới cho “${draft.name.trim() || "chưa đặt tên"}”.`, progress: 0 });
    setLoading(true);
    try {
      const preset = await invoke<PromptPreset>("update_prompt_preset", { presetId, input: { ...draft, projectId: selectedProjectId } });
      setPromptPresets((current) => [preset, ...current]);
      const message = `Đã lưu phiên bản mới ${preset.version} cho “${preset.name}”.`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, output: `prompt_preset:${preset.presetId}`, nextAction: "Kiểm tra bản mới rồi áp dụng vào brief." });
      return preset;
    } catch (error) {
      const message = `Không lưu được phiên bản prompt: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Khôi phục preset nếu đang lưu trữ rồi thử lại." });
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function changePromptPresetState(preset: PromptPreset, action: "archive" | "restore") {
    if (!selectedProjectId) return;
    const label = action === "archive" ? "lưu trữ" : "khôi phục";
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: `prompt_preset.${action}`, tool: "Prompt Studio", state: "running", message: `Đang ${label} prompt preset “${preset.name}”.`, progress: 0 });
    setLoading(true);
    try {
      const updated = await invoke<PromptPreset>(action === "archive" ? "archive_prompt_preset" : "restore_prompt_preset", { projectId: selectedProjectId, presetId: preset.presetId });
      setPromptPresets((current) => current.map((item) => item.presetId === updated.presetId ? updated : item));
      const message = `Đã ${label} prompt preset “${updated.name}”.`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, output: `prompt_preset:${updated.presetId}`, nextAction: action === "archive" ? "Khôi phục nếu muốn dùng lại." : "Áp dụng preset vào brief khi sẵn sàng." });
    } catch (error) {
      const message = `Không thể ${label} prompt preset: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra log workspace và thử lại." });
    } finally {
      setLoading(false);
    }
  }

  function applyPromptPreset(draft: PromptPresetDraft, presetName: string) {
    const replacements: Record<string, string> = {
      topic: topic.trim() || "[chủ đề chưa nhập]",
      content_goal: contentGoal.trim() || "[mục tiêu chưa nhập]",
      topic_profile: selectedTopicProfile?.name ?? "[profile chưa chọn]",
      audience: selectedTopicProfile?.defaultAudience ?? "[đối tượng chưa nhập]",
    };
    const appliedPrompt = draft.template.replace(/\{\{([A-Za-z0-9_-]+)\}\}/g, (_match, key: string) => replacements[key] ?? `{{${key}}}`);
    setAdditionalPrompt(appliedPrompt);
    const message = `Đã áp dụng prompt preset “${presetName}” vào brief; chưa gọi provider.`;
    setNotice(message);
    recordWorkspaceActivity({ stage: "prompt_preset.apply", tool: "Prompt Studio", state: "success", message, output: "brief.additionalPrompt", nextAction: "Xem lại prompt rồi bấm Preview brief." });
  }

  return {
    applyPromptPreset,
    changePromptPresetState,
    createPromptPreset,
    loadPromptPresets,
    promptPresets,
    setPromptPresets,
    updatePromptPreset,
  };
}
