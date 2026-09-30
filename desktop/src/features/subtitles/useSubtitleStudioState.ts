import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { AppNotice, AppStateSetter } from "../shared/appTypes";
import type { Project } from "../shared/projectTypes";
import type { SubtitleBurnInReport, SubtitleDocument, SubtitleDocumentReport, SubtitleVideoProbeReport } from "./subtitleTypes";
import { useState } from "react";

export function useSubtitleStudioState({ selectedProject, selectedProjectId, setLoading, setNotice }: {
  selectedProject: Project | undefined;
  selectedProjectId: string;
  setLoading: AppStateSetter<boolean>;
  setNotice: AppNotice;
}) {
  const [subtitleDocument, setSubtitleDocument] = useState<SubtitleDocument | null>(null);

  const [subtitleVideoPath, setSubtitleVideoPath] = useState("");

  const [subtitlePath, setSubtitlePath] = useState("");

  const [subtitleOutputPath, setSubtitleOutputPath] = useState(".auto3dvideo/subtitles/edited-captions.srt");

  const [subtitleSourceLanguage, setSubtitleSourceLanguage] = useState("vi-VN");

  const [subtitleTargetLanguage, setSubtitleTargetLanguage] = useState("vi-VN");

  const [subtitleFormat, setSubtitleFormat] = useState<"srt" | "vtt">("srt");

  const [subtitleProbe, setSubtitleProbe] = useState<SubtitleVideoProbeReport | null>(null);

  const [subtitleReport, setSubtitleReport] = useState<SubtitleDocumentReport | null>(null);

  const [subtitleBurnInReport, setSubtitleBurnInReport] = useState<SubtitleBurnInReport | null>(null);

  function toProjectRelativePath(selectedPath: string) {
    const root = selectedProject?.workspaceRoot?.split("\\").join("/").replace(/\/$/, "");
    const normalized = selectedPath.split("\\").join("/");
    if (root && normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
      return normalized.slice(root.length + 1);
    }
    return normalized;
  }

  async function chooseSubtitleVideo() {
    try {
      const selected = await open({ multiple: false, title: "Chọn video local để làm phụ đề", filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "avi"] }] });
      if (typeof selected === "string") {
        setSubtitleVideoPath(toProjectRelativePath(selected));
        setSubtitleProbe(null);
        setNotice("Đã chọn video local; hãy probe để lấy thời lượng trước khi nạp phụ đề.");
      }
    } catch {
      setNotice("Không mở được hộp thoại chọn video.");
    }
  }

  async function chooseSubtitleFile() {
    try {
      const selected = await open({ multiple: false, title: "Chọn file phụ đề SRT hoặc VTT", filters: [{ name: "Subtitle", extensions: ["srt", "vtt"] }] });
      if (typeof selected === "string") {
        setSubtitlePath(toProjectRelativePath(selected));
        setNotice("Đã chọn phụ đề; hãy bấm Nạp để mở editor.");
      }
    } catch {
      setNotice("Không mở được hộp thoại chọn file phụ đề.");
    }
  }

  async function probeSubtitleVideo() {
    if (!selectedProjectId || !subtitleVideoPath.trim()) {
      setNotice("Hãy tạo/chọn project và chọn video local trước.");
      return;
    }
    setLoading(true);
    try {
      const report = await invoke<SubtitleVideoProbeReport>("probe_subtitle_video", { request: { projectId: selectedProjectId, videoPath: subtitleVideoPath.trim() } });
      setSubtitleProbe(report);
      setNotice(report.status === "ready" ? `Đã probe video ${report.durationSeconds?.toFixed(2) ?? "?"} giây.` : "Probe video cần kiểm tra thêm.");
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      setNotice(`Không probe được video: ${detail.slice(0, 280)}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadSubtitleDocument() {
    if (!selectedProjectId || !subtitleVideoPath.trim() || !subtitlePath.trim()) {
      setNotice("Hãy chọn project, video và file SRT/VTT trước khi nạp.");
      return;
    }
    setLoading(true);
    try {
      const report = await invoke<SubtitleDocumentReport>("load_subtitle_document", { request: {
        projectId: selectedProjectId,
        inputPath: subtitlePath.trim(),
        sourceVideoPath: subtitleVideoPath.trim(),
        sourceLanguage: subtitleSourceLanguage,
        targetLanguage: subtitleTargetLanguage,
        durationSeconds: subtitleProbe?.durationSeconds ?? 3600,
        format: subtitlePath.toLowerCase().endsWith(".vtt") ? "vtt" : "srt",
      } });
      if (report.document) setSubtitleDocument(report.document);
      setSubtitleReport(report);
      setSubtitleFormat(report.format ?? "srt");
      setNotice(report.message);
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      setNotice(`Không nạp được subtitle: ${detail.slice(0, 280)}`);
    } finally {
      setLoading(false);
    }
  }

  async function saveSubtitleDocument() {
    if (!selectedProjectId || !subtitleDocument) {
      setNotice("Chưa có document phụ đề để xuất.");
      return;
    }
    setLoading(true);
    try {
      const report = await invoke<SubtitleDocumentReport>("save_subtitle_document", { request: { projectId: selectedProjectId, document: { ...subtitleDocument, format: subtitleFormat }, outputPath: subtitleOutputPath.trim(), format: subtitleFormat } });
      setSubtitleReport(report);
      setNotice(`Đã xuất ${report.outputPath ?? "subtitle"}; cần mở lại và review trước delivery.`);
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      setNotice(`Không xuất được subtitle: ${detail.slice(0, 280)}`);
    } finally {
      setLoading(false);
    }
  }

  async function burnInSubtitles() {
    if (!selectedProjectId || !subtitleVideoPath.trim() || !subtitlePath.trim()) {
      setNotice("Cần video và file subtitle đã tồn tại trong workspace để burn-in.");
      return;
    }
    setLoading(true);
    try {
      const report = await invoke<SubtitleBurnInReport>("burn_in_subtitles", { request: { projectId: selectedProjectId, videoPath: subtitleVideoPath.trim(), subtitlePath: subtitlePath.trim(), outputPath: subtitleOutputPath.replace(/\.(srt|vtt)$/i, "-burned.mp4") } });
      setSubtitleBurnInReport(report);
      setNotice(`Đã tạo bản sao burn-in ${report.outputPath}; video gốc không bị thay đổi.`);
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      setNotice(`Không burn-in được subtitle: ${detail.slice(0, 280)}`);
    } finally {
      setLoading(false);
    }
  }

  return {
    burnInSubtitles,
    chooseSubtitleFile,
    chooseSubtitleVideo,
    loadSubtitleDocument,
    probeSubtitleVideo,
    saveSubtitleDocument,
    setSubtitleBurnInReport,
    setSubtitleDocument,
    setSubtitleFormat,
    setSubtitleOutputPath,
    setSubtitlePath,
    setSubtitleProbe,
    setSubtitleReport,
    setSubtitleSourceLanguage,
    setSubtitleTargetLanguage,
    setSubtitleVideoPath,
    subtitleBurnInReport,
    subtitleDocument,
    subtitleFormat,
    subtitleOutputPath,
    subtitlePath,
    subtitleProbe,
    subtitleReport,
    subtitleSourceLanguage,
    subtitleTargetLanguage,
    subtitleVideoPath,
    toProjectRelativePath,
  };
}
