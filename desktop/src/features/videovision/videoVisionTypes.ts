import type { ProcessRunSummary } from "../../processTypes";

export type VideoVisionEvidenceReport = {
  status: string;
  evidenceId: string;
  sourceVideoPath: string;
  outputPath: string;
  frameDir: string;
  audioPath: string | null;
  sourceSha256: string;
  durationSeconds: number;
  width: number;
  height: number;
  frameCount: number;
  shotCount: number;
  semanticVlm: boolean;
  transcriptAvailable: boolean;
  ocrAvailable: boolean;
  networkCallsMade: boolean;
  costStatus: string;
  humanReviewRequired: boolean;
  message: string;
  ffprobe: ProcessRunSummary;
  frameExtract: ProcessRunSummary;
  audioExtract: ProcessRunSummary | null;
  worker: ProcessRunSummary;
};
