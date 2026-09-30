import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { AppNotice, AppRefresh, AppStateSetter } from "../shared/appTypes";
import type { VideoVisionEvidenceReport } from "./videoVisionTypes";
import { useState } from "react";

export function useVideoVisionState({ refresh, selectedProjectId, setLoading, setNotice, toProjectRelativePath }: {
  refresh: AppRefresh;
  selectedProjectId: string;
  setLoading: AppStateSetter<boolean>;
  setNotice: AppNotice;
  toProjectRelativePath: (selectedPath: string) => string;
}) {
  const [videoVisionPath, setVideoVisionPath] = useState("");

  const [videoVisionOutputPath, setVideoVisionOutputPath] = useState("outputs/video-evidence/evidence.json");

  const [videoVisionSampleFps, setVideoVisionSampleFps] = useState(1);

  const [videoVisionMaxFrames, setVideoVisionMaxFrames] = useState(120);

  const [videoVisionExtractAudio, setVideoVisionExtractAudio] = useState(true);

  const [videoVisionReport, setVideoVisionReport] = useState<VideoVisionEvidenceReport | null>(null);

  async function chooseVideoVisionFile() {
    try {
      const selected = await open({ multiple: false, title: "Chọn video local để đọc hiểu", filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "avi"] }] });
      if (typeof selected === "string") {
        setVideoVisionPath(toProjectRelativePath(selected));
        setVideoVisionReport(null);
        setNotice("Đã chọn video local; bước phân tích chỉ đọc file trong workspace và không gọi mạng.");
      }
    } catch {
      setNotice("Không mở được hộp thoại chọn video cho Video Vision.");
    }
  }

  async function analyzeVideoVision() {
    if (!selectedProjectId || !videoVisionPath.trim()) {
      setNotice("Hãy tạo/chọn project và chọn video local trước khi phân tích.");
      return;
    }
    setLoading(true);
    try {
      const report = await invoke<VideoVisionEvidenceReport>("analyze_video_evidence", { request: {
        projectId: selectedProjectId,
        videoPath: videoVisionPath.trim(),
        outputPath: videoVisionOutputPath.trim(),
        sampleFps: videoVisionSampleFps,
        maxFrames: videoVisionMaxFrames,
        frameWidth: 320,
        frameHeight: 180,
        extractAudio: videoVisionExtractAudio,
      } });
      setVideoVisionReport(report);
      setNotice(`Đã tạo ${report.shotCount} shot và ${report.frameCount} frame evidence; VLM/OCR/STT chưa chạy, cần review.`);
      await refresh();
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      setNotice(`Không phân tích được video: ${detail.slice(0, 320)}`);
    } finally {
      setLoading(false);
    }
  }

  return {
    analyzeVideoVision,
    chooseVideoVisionFile,
    setVideoVisionExtractAudio,
    setVideoVisionMaxFrames,
    setVideoVisionOutputPath,
    setVideoVisionPath,
    setVideoVisionReport,
    setVideoVisionSampleFps,
    videoVisionExtractAudio,
    videoVisionMaxFrames,
    videoVisionOutputPath,
    videoVisionPath,
    videoVisionReport,
    videoVisionSampleFps,
  };
}
