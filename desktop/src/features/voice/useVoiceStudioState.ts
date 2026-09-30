import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { AppActivityRecorder, AppActivityUpdater, AppNotice, AppRefresh, AppStateSetter } from "../shared/appTypes";
import { fallbackOmniVoiceReadiness, fallbackVieneuReadiness } from "./voiceTypes";
import type { OmniVoiceReadinessReport, OmniVoiceTtsReport, VieneuReadinessReport, VieneuTtsReport, VoiceEmotion, VoiceProfile, VoiceSample, VoiceSettings } from "./voiceTypes";
import { useState } from "react";

export function useVoiceStudioState({ recordWorkspaceActivity, refresh, selectedProjectId, setLoading, setNotice, updateWorkspaceActivity }: {
  recordWorkspaceActivity: AppActivityRecorder;
  refresh: AppRefresh;
  selectedProjectId: string;
  setLoading: AppStateSetter<boolean>;
  setNotice: AppNotice;
  updateWorkspaceActivity: AppActivityUpdater;
}) {
  const [vieneuReadiness, setVieneuReadiness] = useState<VieneuReadinessReport>(fallbackVieneuReadiness);

  const [vieneuReport, setVieneuReport] = useState<VieneuTtsReport | null>(null);

  const [omnivoiceReadiness, setOmnivoiceReadiness] = useState<OmniVoiceReadinessReport>(fallbackOmniVoiceReadiness);

  const [omnivoiceReport, setOmnivoiceReport] = useState<OmniVoiceTtsReport | null>(null);

  const [omnivoiceError, setOmnivoiceError] = useState<string | null>(null);

  const [voiceProfiles, setVoiceProfiles] = useState<VoiceProfile[]>([]);

  const [voiceSamples, setVoiceSamples] = useState<VoiceSample[]>([]);

  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>({
    presetVoice: "OmniVoice documentary narrator",
    temperature: 0.8,
    voiceCueBySegment: {},
    emotionCodeBySegment: { default: "neutral" },
    cloneEnabled: false,
    cloneConsent: false,
    mode: "design",
    language: "en",
    instruct: "male, middle-aged, low pitch, british accent",
    speed: 1,
    qualityPreset: "preview",
  });

  async function checkVieneu(projectId: string) {
    if (!projectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi kiểm tra VieNeu.");
      return;
    }
    setLoading(true);
    try {
      const report = await invoke<VieneuReadinessReport>("check_vieneu_local", { projectId });
      setVieneuReadiness(report);
      setNotice(`VieNeu: ${report.status}; package=${report.packageInstalled ? "đã có" : "chưa có"}; check không tải model.`);
    } catch {
      setNotice("Không kiểm tra được VieNeu; hãy cấu hình python.exe trong Cài đặt.");
    } finally {
      setLoading(false);
    }
  }

  async function runVieneuTts(projectId: string, text: string, voice: string, outputPath: string, referenceAudioPath: string, temperature: number, cloneConsent: boolean) {
    if (!projectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi chạy VieNeu.");
      return;
    }
    setLoading(true);
    try {
      const report = await invoke<VieneuTtsReport>("run_vieneu_tts", {
        projectId,
        text,
        voice,
        outputPath,
        referenceAudioPath: referenceAudioPath.trim() || null,
        precision: "int8",
        temperature,
        cloneConsent,
      });
      setVieneuReport(report);
      setNotice(`VieNeu đã tạo ${report.outputPath} (${report.sizeBytes} bytes); cần nghe và duyệt trước delivery.`);
      await refresh();
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : JSON.stringify(error);
      setNotice(`VieNeu chưa tạo được audio: ${detail}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadVoiceProfiles(projectId: string) {
    if (!projectId) return;
    try {
      const profiles = await invoke<VoiceProfile[]>("list_voice_profiles", { projectId });
      setVoiceProfiles(profiles);
      if (profiles.length > 0 && !profiles.some((profile) => profile.voiceProfileId === voiceSettings.voiceProfileId)) {
        const first = profiles[0];
        setVoiceSettings((current) => ({
          ...current,
          voiceProfileId: first.voiceProfileId,
          presetVoice: first.name,
          mode: first.mode,
          language: first.language,
          instruct: first.instruct ?? "",
          cloneEnabled: first.mode === "clone",
          cloneConsent: first.cloneConsent,
          referenceAudioPath: first.referenceAudioPath ?? undefined,
        }));
      }
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "backend chưa kết nối";
      setNotice(`Không tải được thư viện voice profile: ${detail.slice(0, 260)}`);
    }
  }

  async function loadVoiceSamples(projectId: string) {
    if (!projectId) return;
    try {
      const samples = await invoke<VoiceSample[]>("list_project_voice_samples", { projectId });
      setVoiceSamples(samples);
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "backend chưa kết nối";
      setVoiceSamples([]);
      setNotice(`Không đọc được thư mục voice local: ${detail.slice(0, 260)}`);
    }
  }

  async function checkOmniVoice(projectId: string) {
    if (!projectId) {
      const message = "Hãy tạo hoặc chọn project trước khi kiểm tra OmniVoice.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "voice.readiness.validate", tool: "OmniVoice", state: "blocked", message, nextAction: "Tạo hoặc chọn một project local rồi thử lại." });
      return;
    }
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "voice.readiness.check", tool: "OmniVoice", state: "running", progress: 0, message: "Đang kiểm tra package, PyTorch, cache model/tokenizer và device…", nextAction: "Chờ kiểm tra local; bước này không tải model và không tạo audio." });
    setLoading(true);
    setNotice("Đang kiểm tra OmniVoice local: package, PyTorch, cache model và device…");
    try {
      const report = await invoke<OmniVoiceReadinessReport>("check_omnivoice_local", { projectId });
      setOmnivoiceReadiness(report);
      const deviceNote = report.device === "cpu" ? " CPU có thể chạy nhưng sẽ chậm." : "";
      const message = `Kiểm tra OmniVoice: ${report.status}. ${report.message}${deviceNote}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: report.status === "ready" ? "success" : "blocked", progress: report.status === "ready" ? 1 : 0, durationMs: Math.round(performance.now() - startedAt), message, nextAction: report.status === "ready" ? "Chọn profile ready rồi tạo preview WAV." : "Sửa đúng blocker trong trạng thái thật rồi thử lại; check không tự cài model." });
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      const message = `Không kiểm tra được OmniVoice: ${detail.slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra Python/tool readiness rồi thử lại." });
    } finally {
      setLoading(false);
    }
  }

  async function prepareOmniVoiceModel(projectId: string) {
    if (!projectId) {
      const message = "Hãy tạo hoặc chọn project trước khi cài model OmniVoice.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "voice.model.prepare.validate", tool: "OmniVoice / Hugging Face", state: "blocked", message, nextAction: "Tạo hoặc chọn một project local rồi thử lại." });
      return;
    }
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "voice.model.prepare", tool: "OmniVoice / Hugging Face", state: "running", progress: 0, message: "Đang tải model/tokenizer OmniVoice vào cache local; bước này dùng mạng và có thể mất vài phút…", nextAction: "Chờ cache xác nhận đủ file; không bấm lặp." });
    setLoading(true);
    setNotice("Đang tải OmniVoice và tokenizer vào cache local. Bước này có dùng mạng và có thể mất vài phút…");
    try {
      const report = await invoke<OmniVoiceReadinessReport>("prepare_omnivoice_model", { projectId });
      setOmnivoiceReadiness(report);
      const message = report.status === "ready" ? "Đã cài OmniVoice local. Chưa tạo audio và chưa phát sinh chi phí cloud." : `Không cài xong OmniVoice: ${report.message}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: report.status === "ready" ? "success" : "error", progress: report.status === "ready" ? 1 : 0, durationMs: Math.round(performance.now() - startedAt), message, nextAction: report.status === "ready" ? "Bấm Kiểm tra local rồi tạo preview khi profile đã ready." : "Kiểm tra lỗi mạng/cache/package; không coi model là sẵn sàng khi cache chưa xác nhận." });
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      const message = `Không cài được OmniVoice: ${detail.slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra quyền mạng, dung lượng cache và package rồi thử lại." });
    } finally {
      setLoading(false);
    }
  }

  async function chooseVoiceReference(): Promise<string | null> {
    try {
      const selected = await open({
        multiple: false,
        title: "Chọn audio mẫu cho voice clone",
        filters: [{ name: "Audio", extensions: ["wav", "mp3", "flac", "m4a", "ogg"] }],
      });
      if (typeof selected === "string") {
        setNotice("Đã chọn audio mẫu; file sẽ được chép vào data workspace khi bạn bấm Tạo profile.");
        return selected;
      }
    } catch {
      setNotice("Không mở được hộp thoại chọn audio mẫu.");
    }
    return null;
  }

  async function createVoiceProfile(input: { name: string; mode: "clone" | "design"; language: string; instruct: string; sourceAudioPath?: string; referenceTranscript?: string; cloneConsent: boolean }) {
    if (!selectedProjectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi tạo voice profile.");
      return;
    }
    setLoading(true);
    setNotice(`Đang tạo voice profile “${input.name}”: kiểm tra quyền và chép dữ liệu local…`);
    try {
      const profile = await invoke<VoiceProfile>("create_voice_profile", { projectId: selectedProjectId, ...input, sourceAudioPath: input.sourceAudioPath ?? null, referenceTranscript: input.referenceTranscript?.trim() || null, instruct: input.instruct.trim() || null });
      setVoiceProfiles((current) => [profile, ...current]);
      setVoiceSettings((current) => ({ ...current, voiceProfileId: profile.voiceProfileId, presetVoice: profile.name, mode: profile.mode, language: profile.language, instruct: profile.instruct ?? "", cloneEnabled: profile.mode === "clone", cloneConsent: profile.cloneConsent, referenceAudioPath: profile.referenceAudioPath ?? undefined }));
      setNotice(profile.status === "ready" ? `Đã tạo profile “${profile.name}” và lưu audio/profile vào workspace.` : `Đã tạo profile “${profile.name}” nhưng đang chờ xác nhận quyền clone.`);
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      setNotice(`Không tạo được voice profile: ${detail.slice(0, 360)}`);
    } finally {
      setLoading(false);
    }
  }

  async function updateVoiceProfile(input: { voiceProfileId: string; name: string; language: string; instruct: string; referenceTranscript?: string; cloneConsent: boolean }) {
    if (!selectedProjectId) {
      setNotice("Chưa có project local: hãy tạo hoặc chọn project trước khi lưu voice profile.");
      return;
    }
    setLoading(true);
    setNotice(`Đang lưu thay đổi voice profile “${input.name}”…`);
    try {
      const profile = await invoke<VoiceProfile>("update_voice_profile", { projectId: selectedProjectId, ...input, referenceTranscript: input.referenceTranscript?.trim() || null, instruct: input.instruct.trim() || null });
      setVoiceProfiles((current) => current.map((item) => item.voiceProfileId === profile.voiceProfileId ? profile : item));
      setVoiceSettings((current) => ({ ...current, presetVoice: profile.name, language: profile.language, instruct: profile.instruct ?? "", cloneConsent: profile.cloneConsent }));
      setNotice(`Đã lưu profile “${profile.name}”.`);
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      setNotice(`Không lưu được voice profile: ${detail.slice(0, 360)}`);
    } finally {
      setLoading(false);
    }
  }

  async function deleteVoiceProfile(profile: VoiceProfile) {
    if (!selectedProjectId) return;
    setLoading(true);
    setNotice(`Đang xoá profile “${profile.name}” khỏi thư viện…`);
    try {
      await invoke("delete_voice_profile", { projectId: selectedProjectId, voiceProfileId: profile.voiceProfileId });
      setVoiceProfiles((current) => current.filter((item) => item.voiceProfileId !== profile.voiceProfileId));
      setVoiceSettings((current) => current.voiceProfileId === profile.voiceProfileId ? { ...current, voiceProfileId: undefined, presetVoice: "", mode: undefined, referenceAudioPath: undefined } : current);
      setOmnivoiceReport(null);
      setNotice(`Đã xoá profile “${profile.name}”. File data cũ được giữ lại để không mất bằng chứng/khôi phục.`);
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      setNotice(`Không xoá được voice profile: ${detail.slice(0, 360)}`);
    } finally {
      setLoading(false);
    }
  }

  async function runOmniVoiceTts(input: { voiceProfileId: string; text: string; language: string; speed: number; durationSeconds?: number; qualityPreset: "preview" | "balanced" | "quality"; classTemperature: number; positionTemperature: number; normalizeText: boolean; emotionCode?: VoiceEmotion }) {
    if (!selectedProjectId) {
      const message = "Hãy tạo hoặc chọn project trước khi thử giọng.";
      setOmnivoiceError(message);
      setNotice(message);
      recordWorkspaceActivity({ stage: "voice.synthesis.validate", tool: "OmniVoice", state: "blocked", message, nextAction: "Tạo hoặc chọn một project local rồi thử lại." });
      return;
    }
    const outputPath = `.auto3dvideo/voices/${input.voiceProfileId}/previews/test-${Date.now()}.wav`;
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "voice.synthesis", tool: "OmniVoice", state: "running", progress: 0, message: "[1/3] Đang kiểm tra profile, quyền clone và output path…", nextAction: "Chờ OmniVoice local kiểm tra điều kiện trước khi chạy model." });
    setLoading(true);
    setOmnivoiceReport(null);
    setOmnivoiceError(null);
    setNotice("Đang chuẩn bị request OmniVoice [1/3]: kiểm tra profile, quyền clone và output path…");
    try {
      updateWorkspaceActivity(activityId, { progress: 0.35, message: "[2/3] Đang chạy OmniVoice local; synthesis không gọi API và không tự tải model…", nextAction: "Chờ worker trả WAV; không bấm lặp để tránh tạo nhiều preview." });
      setNotice("Đang chạy OmniVoice local [2/3]: model không gọi API và không tự tải thêm trong synthesis…");
      const report = await invoke<OmniVoiceTtsReport>("run_omnivoice_tts", { projectId: selectedProjectId, ...input, outputPath, durationSeconds: input.durationSeconds || null });
      setOmnivoiceReport(report);
      setVoiceProfiles((current) => current.map((profile) => profile.voiceProfileId === report.voiceProfileId ? { ...profile, lastPreviewPath: report.outputPath, updatedAt: new Date().toISOString() } : profile));
      const message = `Đã tạo WAV OmniVoice [3/3]: ${report.outputPath}. Hãy nghe và duyệt; chưa tự đưa vào delivery.`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, output: report.outputPath, nextAction: "Bấm play để review phát âm/chất lượng; chỉ dùng tiếp sau human review." });
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      const message = `Không tạo được preview OmniVoice: ${detail.slice(0, 360)}`;
      setOmnivoiceError(message);
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", progress: 0, durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Sửa blocker được nêu cạnh nút preview rồi thử lại; output cũ không bị ghi đè." });
    } finally {
      setLoading(false);
    }
  }

  return {
    checkOmniVoice,
    checkVieneu,
    chooseVoiceReference,
    createVoiceProfile,
    deleteVoiceProfile,
    loadVoiceProfiles,
    loadVoiceSamples,
    omnivoiceError,
    omnivoiceReadiness,
    omnivoiceReport,
    prepareOmniVoiceModel,
    runOmniVoiceTts,
    runVieneuTts,
    setOmnivoiceError,
    setOmnivoiceReadiness,
    setOmnivoiceReport,
    setVieneuReadiness,
    setVieneuReport,
    setVoiceProfiles,
    setVoiceSamples,
    setVoiceSettings,
    updateVoiceProfile,
    vieneuReadiness,
    vieneuReport,
    voiceProfiles,
    voiceSamples,
    voiceSettings,
  };
}
