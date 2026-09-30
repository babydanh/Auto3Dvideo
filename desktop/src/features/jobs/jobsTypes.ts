export type WorkerLaunchPlan = {
  attemptId: string;
  jobId: string;
  attemptNumber: number;
  state: string;
  executableId: string | null;
  timeoutSeconds: number;
  expectedOutputCount: number;
  canStart: boolean;
  blockers: string[];
  processStarted: boolean;
  externalSideEffectUnknown: boolean;
};

export type Job = {
  jobId: string;
  projectId: string;
  kind: string;
  state: string;
  progress: number;
  attemptCount: number;
  createdAt: string;
};

export type Attempt = {
  attemptId: string;
  jobId: string;
  attemptNumber: number;
  state: string;
  executableId: string | null;
  executionMode: "external_process" | "in_process_mock";
  timeoutSeconds: number;
  processStarted: boolean;
  externalSideEffectUnknown: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ExecutableId = "blender" | "ffmpeg" | "ffprobe" | "node" | "obs" | "python";

export type MediaKind = "video" | "audio" | "image" | "subtitle" | "thumbnail" | "metadata" | "image_sequence";

export type AttemptOutput = {
  outputId: string;
  attemptId: string;
  relativePath: string;
  mediaKind: string;
  validationState: string;
  validationMessage: string | null;
};

export type JobAction = "retry_job" | "cancel_job";

export type PendingOutputSpec = {
  relativePath: string;
  mediaKind: MediaKind;
};
