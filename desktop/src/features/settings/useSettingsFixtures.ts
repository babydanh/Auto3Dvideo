import { invoke } from "@tauri-apps/api/core";
import type { Job } from "../jobs/jobsTypes";
import type { AssetPipelineCheckReport, ExternalFixtureAttemptReport, LocalBlenderFixtureReport, LocalMediaFixtureReport, True3dFixtureReport, True3dMultishotFixtureReport } from "./settingsTypes";
import type { AppNotice, AppRefresh, AppSnapshot, AppStateSetter } from "../shared/appTypes";
import { useState } from "react";

export function useSettingsFixtures({ inspectAttempts, refresh, setActiveNav, setJobs, setLoading, setNotice, setSnapshot }: {
  inspectAttempts: (jobId: string) => Promise<void>;
  refresh: AppRefresh;
  setActiveNav: AppStateSetter<string>;
  setJobs: AppStateSetter<Job[]>;
  setLoading: AppStateSetter<boolean>;
  setNotice: AppNotice;
  setSnapshot: AppStateSetter<AppSnapshot>;
}) {
  const [fixtureReport, setFixtureReport] = useState<LocalMediaFixtureReport | null>(null);

  const [blenderFixtureReport, setBlenderFixtureReport] = useState<LocalBlenderFixtureReport | null>(null);

  const [true3dFixtureReport, setTrue3dFixtureReport] = useState<True3dFixtureReport | null>(null);

  const [true3dMultishotFixtureReport, setTrue3dMultishotFixtureReport] = useState<True3dMultishotFixtureReport | null>(null);

  const [assetPipelineCheckReport, setAssetPipelineCheckReport] = useState<AssetPipelineCheckReport | null>(null);

  async function runFfmpegFixture(projectId: string) {
    if (!projectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi chạy fixture.");
      return;
    }
    setLoading(true);
    try {
      const report = await invoke<LocalMediaFixtureReport>("run_ffmpeg_fixture", { projectId });
      setFixtureReport(report);
      setNotice(`FFmpeg/FFprobe fixture PASS: ${report.streamCount} streams, ${report.durationSeconds.toFixed(2)}s; output đã được validate trong workspace.`);
      await refresh();
    } catch {
      setNotice("Fixture FFmpeg bị chặn hoặc thất bại; kiểm tra tool readiness, workspace và output evidence.");
    } finally {
      setLoading(false);
    }
  }

  async function runBlenderFixture(projectId: string) {
    if (!projectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi chạy Blender fixture.");
      return;
    }
    setLoading(true);
    try {
      const report = await invoke<LocalBlenderFixtureReport>("run_blender_fixture", { projectId });
      setBlenderFixtureReport(report);
      setNotice(`Blender fixture PASS: ${report.outputPath} · ${report.sizeBytes} bytes.`);
      await refresh();
    } catch {
      setNotice("Không chạy được Blender fixture; hãy cấu hình đúng blender.exe và kiểm tra tool readiness.");
    } finally {
      setLoading(false);
    }
  }

  async function runTrue3dFixture(projectId: string, renderVideo = false) {
    if (!projectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi dựng true 3D.");
      return;
    }
    setLoading(true);
    setNotice(renderVideo ? "Đang dựng và render video true 3D local…" : "Đang dựng scene true 3D và render preview…");
    try {
      const report = await invoke<True3dFixtureReport>("run_true3d_fixture", { request: { projectId, renderVideo } });
      setTrue3dFixtureReport(report);
      setNotice(`${renderVideo ? "Video true 3D" : "Preview true 3D"} đã tạo; cần review chất lượng trước delivery.`);
      await refresh();
    } catch (error) {
      const message = String(error).replace(/^Error:\s*/i, "").slice(0, 360);
      setNotice(message || "Không chạy được true 3D; kiểm tra Blender/FFmpeg và tool readiness.");
    } finally {
      setLoading(false);
    }
  }

  async function runTrue3dMultishotFixture(projectId: string, renderVideo = false, rerunShotId?: string) {
    if (!projectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi dựng multi-shot true 3D.");
      return;
    }
    setLoading(true);
    setNotice(rerunShotId ? `Đang chạy lại ${rerunShotId} và kiểm tra asset hash…` : "Đang dựng continuity preview cho 8 shot true 3D…");
    try {
      const report = await invoke<True3dMultishotFixtureReport>("run_true3d_multishot_fixture", {
        request: { projectId, renderVideo, rerunShotId: rerunShotId || null },
      });
      setTrue3dMultishotFixtureReport(report);
      setNotice(`Multi-shot ${report.shotCount} shot đã tạo; asset hash unchanged=${String(report.assetHashesUnchanged)}; cần review trước delivery.`);
      await refresh();
    } catch (error) {
      const message = String(error).replace(/^Error:\s*/i, "").slice(0, 360);
      setNotice(message || "Không chạy được multi-shot continuity; kiểm tra Blender và workspace.");
    } finally {
      setLoading(false);
    }
  }

  async function runAssetPipelineCheck(projectId: string) {
    if (!projectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi kiểm tra Asset Pipeline.");
      return;
    }
    setLoading(true);
    setNotice("Đang ingest, phân loại, hash và kiểm tra quyền Asset Library…");
    try {
      const report = await invoke<AssetPipelineCheckReport>("run_asset_pipeline_check", { request: { projectId } });
      setAssetPipelineCheckReport(report);
      setNotice(`Asset Pipeline: ${report.status}; ${report.readyCount}/${report.assetCount} asset sẵn sàng, quarantine=${report.quarantinedCount}.`);
      await refresh();
    } catch (error) {
      const message = String(error).replace(/^Error:\s*/i, "").slice(0, 360);
      setNotice(message || "Không chạy được Asset Pipeline; hãy nhập asset local và kiểm tra Python.");
    } finally {
      setLoading(false);
    }
  }

  async function runFfmpegFixtureAttempt(projectId: string) {
    if (!projectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi chạy fixture job.");
      return;
    }
    setLoading(true);
    try {
      const launch = await invoke<ExternalFixtureAttemptReport>("run_ffmpeg_fixture_attempt", { projectId });
      setJobs((current) => [launch.job, ...current.filter((job) => job.jobId !== launch.job.jobId)]);
      setSnapshot((current) => ({ ...current, jobCount: current.jobCount + 1 }));
      setActiveNav("jobs");
      setNotice(`Đã chạy external FFmpeg fixture qua job ${launch.job.jobId}; attempt ${launch.attempt.attemptId} đang được theo dõi.`);
      await inspectAttempts(launch.job.jobId);
      const pollId = window.setInterval(() => {
        void refresh();
        void inspectAttempts(launch.job.jobId);
      }, 700);
      window.setTimeout(() => window.clearInterval(pollId), 8_000);
    } catch {
      setNotice("Không chạy được durable FFmpeg fixture; kiểm tra tool readiness và workspace.");
    } finally {
      setLoading(false);
    }
  }

  return {
    assetPipelineCheckReport,
    blenderFixtureReport,
    fixtureReport,
    runAssetPipelineCheck,
    runBlenderFixture,
    runFfmpegFixture,
    runFfmpegFixtureAttempt,
    runTrue3dFixture,
    runTrue3dMultishotFixture,
    setAssetPipelineCheckReport,
    setBlenderFixtureReport,
    setFixtureReport,
    setTrue3dFixtureReport,
    setTrue3dMultishotFixtureReport,
    true3dFixtureReport,
    true3dMultishotFixtureReport,
  };
}
