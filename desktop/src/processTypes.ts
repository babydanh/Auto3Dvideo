export type ProcessRunSummary = {
  executableId: string;
  exitCode: number | null;
  succeeded: boolean;
  timedOut: boolean;
  cancelled: boolean;
  terminationMode: string;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  externalSideEffectUnknown: boolean;
  outputEvidence: { relativePath: string; sizeBytes: number | null; validationState: string; validationMessage: string | null }[];
};
