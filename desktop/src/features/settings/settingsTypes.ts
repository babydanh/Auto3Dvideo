import type { Attempt, Job } from "../jobs/jobsTypes";
import type { ProcessRunSummary } from "../../processTypes";

export type HealthStatus = {
  database: string;
  externalTools: string;
  publishPolicy: string;
  locale: string;
};

export type ToolReadinessItem = {
  toolId: string;
  executableRef: string;
  required: boolean;
  configured: boolean;
  available: boolean;
  status: string;
};

export type ToolReadinessReport = {
  status: string;
  requiredMissing: string[];
  tools: ToolReadinessItem[];
  externalProcessesStarted: boolean;
  networkProbePerformed: boolean;
  allowShellWrapper: boolean;
  rejectPathsOutsideProject: boolean;
  workerExecutionEnabled: boolean;
  workerGate: string;
};

export type WorkerPreflightReport = {
  readyToStart: boolean;
  blockers: string[];
  checks: string[];
  externalProcessesStarted: boolean;
  networkProbePerformed: boolean;
  publishEnabled: boolean;
  paidGenerationEnabled: boolean;
};

export type LocalToolProbeReport = {
  toolId: string;
  executablePath: string;
  status: string;
  exitCode: number | null;
  version: string;
  stdoutBytes: number;
  stderrBytes: number;
  processStarted: boolean;
  externalSideEffectUnknown: boolean;
};

export type ComfyUiHealthReport = {
  endpoint: string;
  status: string;
  httpStatus: number | null;
  message: string;
  networkProbePerformed: boolean;
  sideEffectsStarted: boolean;
};

export type LocalBlenderFixtureReport = {
  outputPath: string;
  sizeBytes: number;
  process: ProcessRunSummary;
};

export type True3dFixtureReport = {
  runId: string;
  scenePath: string;
  manifestPath: string;
  qualityPath: string;
  previewPaths: string[];
  videoPath?: string | null;
  frameRange: [number, number];
  fps: number;
  objectCount: number;
  status: string;
  process: ProcessRunSummary;
  ffmpegProcess?: ProcessRunSummary | null;
  message: string;
};

export type True3dMultishotFixtureReport = {
  runId: string;
  scenePath: string;
  sceneManifestPath: string;
  assetLibraryPath: string;
  assetBindingsPath: string;
  continuityReportPath: string;
  qualityPath: string;
  shotCount: number;
  renderedShotIds: string[];
  assetHashesUnchanged: boolean;
  rerunShotId?: string | null;
  status: string;
  process: ProcessRunSummary;
  message: string;
};

export type AssetPipelineCheckReport = {
  runId: string;
  reportPath: string;
  bindingsPath: string;
  quarantinePath: string;
  qualityPath?: string | null;
  assetCount: number;
  readyCount: number;
  quarantinedCount: number;
  status: string;
  process: ProcessRunSummary;
  qualityProcess?: ProcessRunSummary | null;
  message: string;
};

export type LocalMediaFixtureReport = {
  outputPath: string;
  sizeBytes: number;
  durationSeconds: number;
  streamCount: number;
  ffmpeg: ProcessRunSummary;
  ffprobe: ProcessRunSummary;
};

export type ProcessDryRunPlan = {
  executableId: string;
  allowlistedBinaryName: string;
  argumentCount: number;
  argumentLengths: number[];
  workingDirectory: string;
  environmentKeys: string[];
  expectedOutputs: string[];
  timeoutSeconds: number;
  processStarted: boolean;
  sideEffectsBlocked: boolean;
  policyMessages: string[];
};

export type ExternalFixtureAttemptReport = {
  job: Job;
  attempt: Attempt;
  outputPath: string;
};
