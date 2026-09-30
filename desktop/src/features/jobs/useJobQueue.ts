import { invoke } from "@tauri-apps/api/core";
import type { Attempt, AttemptOutput, ExecutableId, Job, JobAction, MediaKind, PendingOutputSpec, WorkerLaunchPlan } from "./jobsTypes";
import type { AppNotice, AppRefresh, AppStateSetter } from "../shared/appTypes";
import { useState } from "react";

export function useJobQueue({ refresh, setLoading, setNotice }: {
  refresh: AppRefresh;
  setLoading: AppStateSetter<boolean>;
  setNotice: AppNotice;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);

  const [attempts, setAttempts] = useState<Attempt[]>([]);

  const [attemptOutputs, setAttemptOutputs] = useState<AttemptOutput[]>([]);

  const [launchPlan, setLaunchPlan] = useState<WorkerLaunchPlan | null>(null);

  const [attemptJobId, setAttemptJobId] = useState("");

  const [attemptExecutableId, setAttemptExecutableId] = useState<ExecutableId | "">("ffmpeg");

  const [attemptOutputPath, setAttemptOutputPath] = useState("preview.mp4");

  const [attemptMediaKind, setAttemptMediaKind] = useState<MediaKind>("video");

  async function mutateJob(action: JobAction, jobId: string) {
    setLoading(true);
    try {
      const job = await invoke<Job>(action, { jobId });
      setJobs((current) => current.map((item) => (item.jobId === job.jobId ? job : item)));
      setNotice(`Job ${job.jobId} chuyển sang ${job.state}.`);
    } catch {
      setNotice("Không thể chuyển state job; kiểm tra state hiện tại và policy.");
    } finally {
      setLoading(false);
    }
  }

  async function inspectAttempts(jobId: string) {
    setLaunchPlan(null);
    try {
      const rows = await invoke<Attempt[]>("list_job_attempts", { jobId });
      setAttempts(rows);
      setAttemptJobId(jobId);
      if (rows[0]) {
        try {
          setAttemptOutputs(await invoke<AttemptOutput[]>("list_attempt_outputs", { attemptId: rows[0].attemptId }));
        } catch {
          setAttemptOutputs([]);
        }
      } else {
        setAttemptOutputs([]);
      }
      setNotice(rows.length ? `Đã đọc ${rows.length} execution attempt của ${jobId}.` : `Job ${jobId} chưa có attempt persisted.`);
    } catch {
      setAttempts([]);
      setAttemptOutputs([]);
      setAttemptJobId(jobId);
      setNotice("Chưa đọc được execution attempt; hãy mở bằng Tauri sau khi database migration hoàn tất.");
    }
  }

  async function previewWorkerLaunch(attemptId: string) {
    try {
      const plan = await invoke<WorkerLaunchPlan>("preview_worker_launch", { attemptId });
      setLaunchPlan(plan);
      setNotice(plan.canStart ? "Worker launch plan sẵn sàng." : "Worker launch plan bị chặn; chưa chạy process nào.");
    } catch {
      setLaunchPlan(null);
      setNotice("Không đọc được worker launch plan; attempt chưa tồn tại hoặc Tauri backend chưa kết nối.");
    }
  }

  async function startMockAttempt(attemptId: string, jobId: string) {
    setLoading(true);
    try {
      await invoke<Attempt>("start_mock_attempt", { attemptId });
      await inspectAttempts(jobId);
      setNotice(`Mock worker in-process đã claim lease cho ${attemptId}; không spawn executable ngoài.`);
      const pollId = window.setInterval(() => {
        void refresh();
        void inspectAttempts(jobId);
      }, 700);
      window.setTimeout(() => window.clearInterval(pollId), 3_500);
    } catch {
      setNotice("Không start được mock worker; attempt phải ở pending và job phải ở queued.");
    } finally {
      setLoading(false);
    }
  }

  async function prepareAttempt(jobId: string) {
    setLoading(true);
    try {
      const expectedOutput = attemptOutputPath.trim();
      const outputs: PendingOutputSpec[] = expectedOutput ? [{ relativePath: expectedOutput, mediaKind: attemptMediaKind }] : [];
      await invoke<Attempt>("prepare_pending_attempt", {
        jobId,
        executableId: attemptExecutableId || null,
        timeoutSeconds: 1800,
        outputs,
      });
      setJobs((current) => current.map((job) => (job.jobId === jobId ? { ...job, attemptCount: job.attemptCount + 1 } : job)));
      await inspectAttempts(jobId);
      setNotice(`Đã tạo pending attempt cho ${jobId}; chưa claim lease và chưa chạy process.`);
    } catch {
      setNotice("Không tạo được pending attempt; job phải ở queued và không có attempt đang hoạt động.");
    } finally {
      setLoading(false);
    }
  }

  async function loadJobs() {
    return invoke<Job[]>("list_jobs");
  }
  return {
    attemptExecutableId,
    attemptJobId,
    attemptMediaKind,
    attemptOutputPath,
    attemptOutputs,
    attempts,
    inspectAttempts,
    jobs,
    loadJobs,
    launchPlan,
    mutateJob,
    prepareAttempt,
    previewWorkerLaunch,
    setAttemptExecutableId,
    setAttemptJobId,
    setAttemptMediaKind,
    setAttemptOutputPath,
    setAttemptOutputs,
    setAttempts,
    setJobs,
    setLaunchPlan,
    startMockAttempt,
  };
}
